import type { DiscordBotRestClient } from '@picket/discord';
import type { GatewayDelivery, GatewayEvent, GatewayEventHandler, GatewayVoicePerson } from '@picket/discord';
import type { Lease } from '@picket/coordination';
import type { Logger } from '@picket/kernel';
import { eligible, type StatsConfig, type VoiceObservation } from '../domain/model';
import type { DurableVoiceBuffer } from '../application/store';
import { PostgresStatsStore, StatsLeaseLostError } from './postgres-stats-store';

const NAME_SWEEP_PAUSE_MS = 30 * 60_000;
interface NameSweep {
  guildAfter: number;
  member: { after: string; next: number };
  channel: { after: string; next: number };
}

export class VoiceCollector implements GatewayEventHandler {
  readonly #unavailable = new Set<string>();
  readonly #people = new Map<string, Map<string, GatewayVoicePerson>>();
  readonly #channels = new Map<string, Readonly<Record<string, string>>>();
  readonly #channelRetryAfter = new Map<string, number>();
  readonly #config = new Map<string, { config: StatsConfig; loaded: number }>();
  readonly #connections = new Map<number, Lease>();
  readonly #guildShards = new Map<string, number>();
  readonly #followed = new Set<string>();
  readonly #ticked = new Map<string, number>();
  readonly #nameSweeps = new Map<string, NameSweep>();
  readonly #nameVersions = new Map<string, number>();
  #nameRefresh: Promise<void> | undefined;
  #nameGuildCursor = '';
  #nextNameSweep: number;
  #openUntil = 0;
  #backlog = false;
  readonly #bufferedGuilds = new Set<string>();
  readonly #pendingInterruptions = new Set<number>();
  #failures = 0;
  #busy = false;
  #tail: Promise<void> = Promise.resolve();
  private serial(work: () => Promise<void>): Promise<void> {
    const run = this.#tail.then(work);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  constructor(
    readonly store: PostgresStatsStore,
    readonly buffer: DurableVoiceBuffer,
    readonly logger: Logger,
    readonly now: () => Date = () => new Date(),
    readonly rest?: DiscordBotRestClient,
  ) {
    // Gateway events and ID-only repair run immediately; spread periodic work after startup.
    this.#nextNameSweep = this.now().getTime() + NAME_SWEEP_PAUSE_MS;
  }

  private async config(guildId: string, refresh = false): Promise<StatsConfig> {
    const cached = this.#config.get(guildId);
    if (cached && !refresh && this.now().getTime() - cached.loaded < 15_000) return cached.config;
    try {
      const config = await this.store.config(guildId);
      this.#config.set(guildId, { config, loaded: this.now().getTime() });
      return config;
    } catch (error) {
      if (cached && this.now().getTime() - cached.loaded < 120_000) return cached.config;
      throw error;
    }
  }

  private async hydrate(guildId: string): Promise<Map<string, GatewayVoicePerson>> {
    const existing = this.#people.get(guildId);
    if (existing) return existing;
    this.#channels.set(guildId, { ...await this.store.channelNames(guildId), ...this.#channels.get(guildId) });
    const people = new Map<string, GatewayVoicePerson>();
    for (const row of await this.store.presence(guildId))
      people.set(row.user_id, {
        userId: row.user_id,
        channelId: row.channel_id,
        roles: row.roles,
        bot: false,
        name: row.name ?? row.user_id,
      });
    this.#people.set(guildId, people);
    return people;
  }

  private async known(guildId: string, person: GatewayVoicePerson): Promise<GatewayVoicePerson> {
    if (
      person.rolesKnown !== false ||
      !person.channelId ||
      !this.rest ||
      !(await this.config(guildId)).enabled
    )
      return person;
    let result: unknown;
    try {
      result = await this.rest.get(`/guilds/${guildId}/members/${person.userId}`);
    } catch (error) {
      if ((error as { status?: number }).status === 404)
        return { ...person, channelId: null, roles: [], rolesKnown: true };
      throw error;
    }
    const member = result as {
      roles?: unknown;
      nick?: string | null;
      user?: { id?: string; username?: string; global_name?: string | null; bot?: boolean };
    };
    if (
      member.user?.id !== person.userId ||
      !Array.isArray(member.roles) ||
      !member.roles.every((role) => typeof role === 'string' && /^\d{15,25}$/.test(role))
    )
      throw new Error('Voice member identity unavailable');
    return {
      ...person,
      roles: member.roles as string[],
      rolesKnown: true,
      bot: member.user.bot === true,
      name: member.nick ?? member.user.global_name ?? member.user.username ?? person.userId,
    };
  }

  private async write(event: VoiceObservation, lease?: Lease): Promise<void> {
    if (await this.buffer.isExcluded?.(event.guildId, event.userId)) return;
    if (this.#backlog || this.now().getTime() < this.#openUntil) {
      await this.buffer.append(event);
      return;
    }
    try {
      await this.store.observe(event, lease);
      this.#failures = 0;
    } catch (error) {
      if (error instanceof StatsLeaseLostError) throw error;
      await this.buffer.append(event);
      this.#backlog = true;
      this.#failures++;
      if (this.#failures >= 3) this.#openUntil = this.now().getTime() + 30_000;
      this.logger.warn(
        { guild_id: event.guildId, failures: this.#failures },
        'voice write buffered on persistent disk',
      );
    }
  }

  private async observe(
    guildId: string,
    person: GatewayVoicePerson,
    delivery: GatewayDelivery,
    quality: VoiceObservation['quality'] = 'observed',
  ): Promise<void> {
    let config = await this.config(guildId);
    if (!config.enabled) config = await this.config(guildId, true);
    const was = this.#followed.has(`${guildId}:${person.userId}`);
    const follow = eligible(config, person);
    if (follow && person.channelId && !this.#channels.get(guildId)?.[person.channelId])
      this.#channels.set(guildId, { ...this.#channels.get(guildId), [person.channelId]: person.channelId });
    // Temporary connected state can be persisted in healthy enabled guilds to support later role gains.
    // Only eligible transitions or closure of an existing tracked presence may enter the disk journal.
    const observation: VoiceObservation = {
      ...person,
      key: `${delivery.key}:${person.userId}`,
      guildId,
      shardId: delivery.shardId,
      at: delivery.at.toISOString(),
      quality: delivery.replayed ? 'replayed' : quality,
      channelName: person.channelId
        ? (this.#channels.get(guildId)?.[person.channelId] ?? person.channelId)
        : '',
    };
    if (follow || was) await this.write(observation, delivery.lease);
    else if (config.enabled && this.#openUntil <= this.now().getTime())
      await this.store.observe(observation, delivery.lease);
    if (follow) this.#followed.add(`${guildId}:${person.userId}`);
    else this.#followed.delete(`${guildId}:${person.userId}`);
  }

  handle(event: GatewayEvent, delivery?: GatewayDelivery): Promise<void> {
    return this.serial(() => this.consume(event, delivery));
  }
  private async consume(event: GatewayEvent, delivery?: GatewayDelivery): Promise<void> {
    if (!delivery) return;
    if ('guildId' in event) this.#guildShards.set(event.guildId, delivery.shardId);
    if ('guildId' in event && ['guild_available', 'guild_voice_metadata', 'voice_member', 'voice_state',
      'channel_unusable', 'guild_removed'].includes(event.type))
      this.#nameVersions.set(event.guildId, (this.#nameVersions.get(event.guildId) ?? 0) + 1);
    switch (event.type) {
      case 'guild_voice_unavailable':
        this.#unavailable.add(event.guildId);
        await this.store.interrupt(event.guildId, delivery.lease);
        return;
      case 'guild_available': {
        if (!event.voiceSnapshot) return;
        this.#unavailable.add(event.guildId);
        const old = await this.hydrate(event.guildId);
        this.#channels.set(event.guildId, { ...this.#channels.get(event.guildId), ...event.voiceSnapshot.channels });
        await this.store.rememberChannelNames(event.guildId, event.voiceSnapshot.channels, delivery.lease);
        const resolved = [];
        for (const person of event.voiceSnapshot.people)
          resolved.push(await this.known(event.guildId, person));
        const people = new Map(resolved.filter((p) => p.channelId !== null).map((p) => [p.userId, p]));
        this.#people.set(event.guildId, people);
        await this.store.metadata(
          event.guildId,
          event.voiceSnapshot.name,
          event.voiceSnapshot.afkChannelId,
          delivery.lease,
        );
        for (const person of old.values())
          if (!people.has(person.userId))
            await this.observe(event.guildId, { ...person, channelId: null }, delivery, 'snapshot');
        for (const person of people.values()) await this.observe(event.guildId, person, delivery, 'snapshot');
        this.#unavailable.delete(event.guildId);
        return;
      }
      case 'guild_voice_metadata':
        await this.store.metadata(event.guildId, event.name, event.afkChannelId, delivery.lease);
        this.#config.delete(event.guildId);
        return;
      case 'voice_state': {
        const people = await this.hydrate(event.guildId);
        const previous = people.get(event.person.userId);
        const resolved = await this.known(event.guildId, event.person);
        const person =
          resolved.rolesKnown !== false || !previous
            ? resolved
            : { ...resolved, roles: previous.roles, bot: previous.bot, name: previous.name };
        if (person.channelId === null) people.delete(person.userId);
        else people.set(person.userId, person);
        if (
          previous &&
          previous.channelId === person.channelId &&
          previous.bot === person.bot &&
          previous.name === person.name &&
          previous.roles.length === person.roles.length &&
          previous.roles.every((role) => person.roles.includes(role))
        )
          return;
        await this.observe(event.guildId, person, delivery);
        return;
      }
      case 'voice_member': {
        await this.store.rememberMemberName(event.guildId, event.userId, event.name, delivery.lease);
        const people = await this.hydrate(event.guildId);
        const previous = people.get(event.userId);
        if (!previous) return;
        const person = { ...previous, roles: event.roles, name: event.name, bot: event.bot };
        people.set(event.userId, person);
        await this.observe(event.guildId, person, delivery);
        return;
      }
      case 'voice_member_removed': {
        const people = await this.hydrate(event.guildId);
        const previous = people.get(event.userId);
        if (previous) {
          people.delete(event.userId);
          await this.observe(event.guildId, { ...previous, channelId: null }, delivery);
        }
        return;
      }
      case 'guild_removed':
        await this.store.interrupt(event.guildId, delivery.lease);
        this.#people.delete(event.guildId);
        this.#config.delete(event.guildId);
        this.#channels.delete(event.guildId);
        this.#nameSweeps.delete(event.guildId);
        for (const key of this.#channelRetryAfter.keys())
          if (key.startsWith(`${event.guildId}:`)) this.#channelRetryAfter.delete(key);
        return;
      case 'channel_unusable': {
        if (event.name)
          await this.store.channelName(event.guildId, event.channelId, event.name, delivery.lease);
        if (event.name)
          this.#channels.set(event.guildId, {
            ...this.#channels.get(event.guildId),
            [event.channelId]: event.name,
          });
        if (!event.deleted) return;
        const people = await this.hydrate(event.guildId);
        for (const person of [...people.values()])
          if (person.channelId === event.channelId) {
            people.delete(person.userId);
            await this.observe(event.guildId, { ...person, channelId: null }, delivery);
          }
        return;
      }
      case 'role_deleted':
        this.#config.delete(event.guildId);
        return;
      case 'ready':
        // A fresh IDENTIFY must wait for each guild snapshot. RESUMED instead
        // keeps the hydrated state, updated by the replayed Gateway events.
        for (const guildId of event.guildIds) this.#unavailable.add(guildId);
        return;
    }
  }

  connectionChanged(shardId: number, connected: boolean, lease: Lease): Promise<void> {
    return this.serial(() => this.connection(shardId, connected, lease));
  }
  private async connection(shardId: number, connected: boolean, lease: Lease): Promise<void> {
    if (connected) {
      this.#backlog = (await this.buffer.status()).count > 0;
      if (this.#pendingInterruptions.has(shardId)) await this.connection(shardId, false, lease);
      this.#connections.set(shardId, lease);
      return;
    }
    this.#pendingInterruptions.add(shardId);
    this.#connections.delete(shardId);
    for (const guildId of await this.store.guildIds()) {
      // Discord shard assignment is stable; no need for a complete member list.
      if (Number((BigInt(guildId) >> 22n) % BigInt(this.shardCount)) !== shardId) continue;
      this.#guildShards.set(guildId, shardId);
      await this.store.interrupt(guildId, lease);
      const people = await this.hydrate(guildId);
      for (const person of people.values()) this.#followed.delete(`${guildId}:${person.userId}`);
    }
    this.#pendingInterruptions.delete(shardId);
  }

  shardCount = 1;

  private async applyNameRefresh(guildId: string, lease: Lease, version: number, work: () => Promise<void>): Promise<void> {
    await this.serial(async () => {
      const shard = this.#guildShards.get(guildId);
      if (shard === undefined || this.#connections.get(shard) !== lease || !this.#people.has(guildId) ||
        this.#unavailable.has(guildId) || (this.#nameVersions.get(guildId) ?? 0) !== version) return;
      await work();
    });
  }

  private async resolveChannelName(guildId: string, channelId: string, lease: Lease): Promise<void> {
    if (!this.rest) return;
    const version = this.#nameVersions.get(guildId) ?? 0;
    const key = `${guildId}:${channelId}`;
    this.#channelRetryAfter.set(key, this.now().getTime() + 300_000);
    try {
      const data = await this.rest.get(`/channels/${channelId}`) as {
        id?: unknown; guild_id?: unknown; name?: unknown; type?: unknown;
      };
      if (data.id !== channelId || data.guild_id !== guildId || (data.type !== 2 && data.type !== 13) ||
        typeof data.name !== 'string' || !data.name.trim()) throw new Error('Invalid voice channel metadata');
      const name = data.name;
      const apply = async () => {
        await this.store.channelName(guildId, channelId, name, lease);
        this.#channels.set(guildId, { ...this.#channels.get(guildId), [channelId]: name });
      };
      await this.applyNameRefresh(guildId, lease, version, apply);
      this.#channelRetryAfter.delete(key);
    } catch (error) {
      if (error instanceof StatsLeaseLostError) throw error;
      this.logger.warn({ guild_id: guildId, channel_id: channelId }, 'voice channel name unavailable; retrying later');
    }
  }

  private async refreshNames(budget: number): Promise<void> {
    const at = this.now().getTime();
    if (!this.rest || budget <= 0 || at < this.#nextNameSweep) return;
    this.#nextNameSweep = at + 10_000;
    // Rotate guilds fairly, including those with closed retained history and stats now disabled.
    const guilds = [...this.#guildShards.keys()].filter(id => !this.#unavailable.has(id) &&
      this.#people.has(id) && this.#connections.has(this.#guildShards.get(id)!)).sort();
    const guildId = guilds.find(id => id > this.#nameGuildCursor) ?? guilds[0];
    if (!guildId) return;
    this.#nameGuildCursor = guildId;
    const lease = this.#connections.get(this.#guildShards.get(guildId)!)!;
    const sweep = this.#nameSweeps.get(guildId) ?? {
      guildAfter: 0, member: { after: '', next: 0 }, channel: { after: '', next: 0 },
    };
    this.#nameSweeps.set(guildId, sweep);
    if (at >= sweep.guildAfter) {
      const version = this.#nameVersions.get(guildId) ?? 0;
      sweep.guildAfter = at + NAME_SWEEP_PAUSE_MS;
      budget--;
      try {
        const guild = await this.rest.get(`/guilds/${guildId}`) as { id?: unknown; name?: unknown };
        if (guild.id !== guildId || typeof guild.name !== 'string' || !guild.name.trim())
          throw new Error('Invalid guild identity');
        const name = guild.name;
        await this.applyNameRefresh(guildId, lease, version, () => this.store.rememberGuildName(guildId, name, lease));
      } catch (error) {
        if (error instanceof StatsLeaseLostError) throw error;
        this.logger.warn({ guild_id: guildId }, 'guild name unavailable; retaining last known name');
      }
    }
    for (const kind of ['channel', 'member'] as const) {
      const cursor = sweep[kind];
      if (budget <= 0 || at < cursor.next) continue;
      const targets = await this.store.nameTargets(guildId, kind, cursor.after, Math.min(budget, kind === 'channel' ? 1 : 3));
      if (!targets.length) {
        cursor.after = '';
        cursor.next = at + NAME_SWEEP_PAUSE_MS;
        continue;
      }
      for (const id of targets) {
        cursor.after = id;
        budget--;
        if (kind === 'channel') {
          if ((this.#channelRetryAfter.get(`${guildId}:${id}`) ?? 0) <= at)
            await this.resolveChannelName(guildId, id, lease);
          continue;
        }
        try {
          const version = this.#nameVersions.get(guildId) ?? 0;
          const member = await this.rest.get(`/guilds/${guildId}/members/${id}`) as {
            nick?: string | null; user?: { id?: string; global_name?: string | null; username?: string };
          };
          const name = member.nick ?? member.user?.global_name ?? member.user?.username;
          if (member.user?.id !== id || typeof name !== 'string' || !name.trim())
            throw new Error('Invalid member identity');
          await this.applyNameRefresh(guildId, lease, version, async () => {
            await this.store.rememberMemberName(guildId, id, name, lease);
            const person = this.#people.get(guildId)?.get(id);
            if (person) this.#people.get(guildId)!.set(id, { ...person, name });
          });
        } catch (error) {
          if (error instanceof StatsLeaseLostError) throw error;
          // Deleted members retain their historical label; never recreate erased/expired rows.
          if ((error as { status?: number }).status !== 404)
            this.logger.warn({ guild_id: guildId, user_id: id }, 'member name unavailable; retaining last known name');
        }
      }
    }
  }

  async refreshMetadata(): Promise<void> {
    if (this.#nameRefresh) return this.#nameRefresh;
    const pending = this.checkNames();
    this.#nameRefresh = pending;
    try { await pending; } finally { this.#nameRefresh = undefined; }
  }

  private async checkNames(): Promise<void> {
    if (!this.rest || this.#backlog || this.now().getTime() < this.#openUntil) return;
    let budget = 5;
    // Repair ID-only history first, outside both the voice queue and its checkpoint loop.
    for (const guildId of this.#people.keys()) {
      const shard = this.#guildShards.get(guildId);
      const lease = shard === undefined ? undefined : this.#connections.get(shard);
      if (!lease || this.#unavailable.has(guildId)) continue;
      for (const [channelId, name] of Object.entries(this.#channels.get(guildId) ?? {})) {
        if (name !== channelId || budget <= 0 ||
          (this.#channelRetryAfter.get(`${guildId}:${channelId}`) ?? 0) > this.now().getTime()) continue;
        budget--;
        await this.resolveChannelName(guildId, channelId, lease);
      }
    }
    await this.refreshNames(budget);
  }

  tick(): Promise<void> {
    return this.serial(() => this.flush());
  }
  private async flush(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      if (this.now().getTime() >= this.#openUntil) {
        try {
          const replayed = await this.buffer.replay(
            async (event) => {
              const lease = this.#connections.get(event.shardId);
              if (!lease) throw new StatsLeaseLostError('Shard disconnected during replay');
              if (!(await this.buffer.isExcluded?.(event.guildId, event.userId)))
                await this.store.observe(event, lease);
              this.#guildShards.set(event.guildId, event.shardId);
              this.#bufferedGuilds.add(event.guildId);
            },
            100,
            [...this.#connections.keys()],
          );
          if (replayed >= 100) {
            this.#backlog = true;
            return;
          }
          for (const guildId of this.#bufferedGuilds) {
            const shard = this.#guildShards.get(guildId);
            const lease = shard === undefined ? undefined : this.#connections.get(shard);
            if (lease) await this.store.interrupt(guildId, lease);
          }
          this.#bufferedGuilds.clear();
          this.#backlog = false;
          this.#failures = 0;
        } catch {
          this.#backlog = true;
          this.#openUntil = this.now().getTime() + 30_000;
          return;
        }
      }
      if (this.#backlog || this.now().getTime() < this.#openUntil) return;
      for (const [guildId, people] of this.#people) {
        if (this.#unavailable.has(guildId)) continue;
        if (this.now().getTime() - (this.#ticked.get(guildId) ?? 0) < 30_000) continue;
        const shard = this.#guildShards.get(guildId);
        const lease = shard === undefined ? undefined : this.#connections.get(shard);
        if (!lease || shard === undefined) continue;
        const config = await this.config(guildId);
        if (!config.enabled) continue;
        const open = await this.store.openUserIds(guildId);
        // Handles activation, opt-in and target changes while a person is already connected.
        for (const unknown of people.values()) {
          const person = await this.known(guildId, unknown);
          people.set(person.userId, person);
          if (open.has(person.userId) || !eligible(config, person)) continue;
          const key = `reconcile:${lease.token}:${guildId}:${person.userId}:${this.now().getTime()}`;
          await this.observe(
            guildId,
            person,
            { key, shardId: shard, at: this.now(), replayed: false, lease },
            'snapshot',
          );
        }
        if (this.#connections.get(shard) !== lease) continue;
        await this.store.checkpoint(guildId, lease, this.now());
        this.#ticked.set(guildId, this.now().getTime());
      }
    } finally {
      this.#busy = false;
    }
  }

  async shutdown(): Promise<void> {
    for (const [shard, lease] of this.#connections)
      await this.connectionChanged(shard, false, lease).catch(() => undefined);
  }
}

import type { Lease } from '@picket/coordination';
import { WAR_ICONS, KNOWN_UNTRACKED_ICONS, warZoneOf } from '@picket/game-data';
import type { Clock, Logger } from '@picket/kernel';
import { isActiveWar, mapObject, snapshotEvents, type MapLabel, type PollSnapshot, type WarObject } from '../domain/model';
import type { WarApi, WarStore } from './ports';

export class WarPoller {
  #snapshot: PollSnapshot | null = null;
  #labels: Readonly<Record<string, readonly MapLabel[]>> = {};
  #recovering = true;
  #retryAt = 0;
  #failures = 0;
  #begun = false;
  #lastSuccessAt: number | null = null;
  constructor(private readonly api: WarApi, private readonly store: WarStore, private readonly lease: Lease, private readonly clock: Clock, private readonly logger: Logger, private readonly intervalMs = 15_000) {}

  async tick(): Promise<void> {
    if (this.clock.now().getTime() < this.#retryAt) return;
    // A process may have been suspended without seeing any HTTP error. Missed polling periods need a new baseline too.
    if (!this.#recovering && this.#lastSuccessAt !== null && this.clock.now().getTime() - this.#lastSuccessAt > this.intervalMs * 3) {
      this.#recovering = true; this.#begun = false; this.#snapshot = null;
    }
    try {
      if (!this.#begun) {
        if (!await this.store.recover(this.lease)) return;
        this.api.reset(); this.#begun = true;
      }
      const war = await this.api.war();
      const saved = await this.store.state();
      if (war.number < saved.highestWar) { this.logger.warn({ war: war.number }, 'replayed war ignored'); return; }
      const baseline = this.#recovering || this.#snapshot?.war.id !== war.id || (this.#snapshot && !isActiveWar(this.#snapshot.war) && isActiveWar(war));
      if (baseline && !this.#recovering) { if (!await this.store.recover(this.lease)) return; this.api.reset(); }
      const regions: Record<string, Awaited<ReturnType<WarApi['map']>>> = {};
      const receivedAt: Record<string, number> = {};
      const objects: Record<string, WarObject> = {};
      if (isActiveWar(war)) {
        const names = baseline ? await this.api.maps() : Object.keys(this.#snapshot!.regions);
        if (!names.length) throw new Error('No active public maps');
        if (baseline) {
          const unassigned = names.filter(region => !warZoneOf(region));
          if (unassigned.length) this.logger.warn({ regions: unassigned }, 'War API regions need a geographic catalogue update');
        }
        if (baseline) {
          const labels: Record<string, readonly MapLabel[]> = {};
          await this.#each(names, async region => { labels[region] = await this.api.labels(region); });
          this.#labels = labels;
        }
        const unknown = new Set<number>();
        await this.#each(names, async region => {
          const map = await this.api.map(region);
          receivedAt[region] = this.clock.now().getTime();
          regions[region] = map;
          for (const item of map.items) {
            if (!WAR_ICONS[item.iconType] && !KNOWN_UNTRACKED_ICONS.includes(item.iconType)) unknown.add(item.iconType);
            const candidate = mapObject(region, item, this.#labels[region] ?? [], map.updatedAt);
            if (candidate) objects[candidate.key] = mapObject(region, item, this.#labels[region] ?? [], map.updatedAt, baseline ? undefined : this.#snapshot?.objects[candidate.key])!;
          }
        });
        if (unknown.size) this.logger.warn({ icons: [...unknown] }, 'unknown War API icons');
        const checked = await this.api.war();
        if (checked.id !== war.id || checked.number !== war.number || isActiveWar(checked) !== isActiveWar(war)) throw new Error('War changed while loading maps');
      } else if (!baseline && this.#snapshot) {
        Object.assign(regions, this.#snapshot.regions); Object.assign(objects, this.#snapshot.objects);
      }
      const snapshot: PollSnapshot = { war, regions, objects };
      const now = this.clock.now();
      const events = baseline || !this.#snapshot || !isActiveWar(war) ? [] : snapshotEvents(this.#snapshot, snapshot, now.getTime())
        .map(event => ({ ...event, detectedAt: event.object ? receivedAt[event.object.region] ?? event.detectedAt : event.detectedAt }));
      if (!baseline && this.#snapshot && (this.#snapshot.war.endedAt === null || this.#snapshot.war.winner === 'NONE') && war.endedAt !== null && war.winner !== 'NONE') events.push({ type: 'war_ended', war: war.number, object: null, faction: war.winner, occurredAt: war.endedAt, detectedAt: now.getTime() });
      if (!await this.store.commit(this.lease, snapshot, events, baseline, now)) return;
      this.#snapshot = snapshot; this.#recovering = false; this.#failures = 0; this.#retryAt = 0;
      this.#lastSuccessAt = this.clock.now().getTime();
    } catch (error) {
      this.#failures += 1;
      this.#retryAt = this.clock.now().getTime() + Math.min(300_000, this.intervalMs * 2 ** Math.min(this.#failures - 1, 5));
      this.logger.warn({ err: error, retry_at: this.#retryAt }, 'war poll failed, rebuilding baseline');
      this.#recovering = true; this.#begun = false; this.#snapshot = null;
      // Pause clients immediately. The next cycle retries even when initial loading failed.
      await this.store.recover(this.lease).catch(() => undefined);
    }
  }

  async #each(names: readonly string[], work: (region: string) => Promise<void>): Promise<void> {
    // All requests settle before another baseline can start; no overlapping cycles after one rejection.
    for (let start = 0; start < names.length; start += 6) {
      const results = await Promise.allSettled(names.slice(start, start + 6).map(work));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
  }
  stop(): void { this.api.stop(); }
}

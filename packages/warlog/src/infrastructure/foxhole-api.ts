import type { WarApi } from '../application/ports';
import type { MapData, MapItem, MapLabel, War } from '../domain/model';

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Malformed War API object');
  return value as Record<string, unknown>;
};
const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Malformed War API number'); return value; };
const integer = (value: unknown): number => { const n = number(value); if (!Number.isSafeInteger(n)) throw new Error('Malformed War API integer'); return n; };
const text = (value: unknown): string => { if (typeof value !== 'string' || !value.length || value.length > 256) throw new Error('Malformed War API text'); return value; };
const team = (value: unknown): War['winner'] => { if (value !== 'NONE' && value !== 'WARDENS' && value !== 'COLONIALS') throw new Error('Malformed War API faction'); return value; };
const timestamp = (value: unknown): number | null => value === null ? null : integer(value);
const coordinate = (value: unknown): number => { const n = number(value); if (n > 1) throw new Error('Malformed map coordinate'); return n; };
const list = (value: unknown): unknown[] => { if (!Array.isArray(value) || value.length > 10_000) throw new Error('Malformed War API list'); return value; };

export class FoxholeApi implements WarApi {
  readonly #abort = new AbortController();
  readonly #cache = new Map<string, { etag: string | null; value: unknown; freshUntil: number }>();
  readonly #failures = new Map<string, { count: number; retryAt: number }>();
  constructor(private readonly baseUrl: string, private readonly version: string, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  reset(): void { this.#cache.clear(); }
  stop(): void { this.#abort.abort(); }

  async #get(path: string, validate: (value: unknown) => unknown): Promise<unknown> {
    const cached = this.#cache.get(path);
    if (cached && cached.freshUntil > this.now()) return cached.value;
    const failed = this.#failures.get(path);
    if (failed && failed.retryAt > this.now()) throw new Error('War API endpoint cooling down');
    try {
      const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/api/worldconquest/${path}`, {
        headers: { 'User-Agent': `PICKET/${this.version} (+https://github.com/NapoSky/picket)`, ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
        signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(10_000)]),
      });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - this.now()) : 30_000;
        this.#failures.set(path, { count: (failed?.count ?? 0) + 1, retryAt: this.now() + (Number.isFinite(delay) ? delay : 30_000) });
        throw new Error('War API rate limited');
      }
      const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
      const age = Number(response.headers.get('age') ?? 0);
      const freshUntil = this.now() + Math.max(0, Number(maxAge?.[1] ?? 0) - (Number.isFinite(age) ? age : 0)) * 1000;
      if (response.status === 304) {
        if (!cached) throw new Error('War API returned 304 without cached data');
        this.#cache.set(path, { ...cached, freshUntil }); this.#failures.delete(path); return cached.value;
      }
      if (!response.ok) throw new Error(`War API HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > 5_000_000) throw new Error('War API response too large');
      const value: unknown = JSON.parse(body);
      validate(value);
      this.#cache.set(path, { etag: response.headers.get('etag'), value, freshUntil });
      this.#failures.delete(path);
      return value;
    } catch (error) {
      if (!this.#failures.has(path) || this.#failures.get(path)!.retryAt <= this.now()) {
        const count = (failed?.count ?? 0) + 1;
        this.#failures.set(path, { count, retryAt: this.now() + (count >= 3 ? 30_000 : 0) });
      }
      // Never retain request errors containing configurable URLs or response bodies in logs.
      throw new Error(error instanceof Error && /^(War API|Malformed)/.test(error.message) ? error.message : 'War API request failed');
    }
  }

  async war(): Promise<War> {
    const parse = (value: unknown): War => {
      const data = record(value);
      return { id: text(data.warId), number: integer(data.warNumber), startedAt: timestamp(data.conquestStartTime), endedAt: timestamp(data.conquestEndTime), winner: team(data.winner) };
    };
    return parse(await this.#get('war', parse));
  }
  async maps(): Promise<readonly string[]> {
    const parse = (value: unknown) => list(value).map(text).filter(name => name !== 'HomeRegionC' && name !== 'HomeRegionW');
    const names = parse(await this.#get('maps', parse));
    if (new Set(names).size !== names.length || names.some(name => !/^[A-Za-z0-9]+$/.test(name))) throw new Error('Malformed map names');
    return names;
  }
  async labels(region: string): Promise<readonly MapLabel[]> {
    const parse = (value: unknown) => list(record(value).mapTextItems).map((entry): MapLabel => {
      const label = record(entry);
      if (label.mapMarkerType !== 'Major' && label.mapMarkerType !== 'Minor') throw new Error('Malformed map label');
      return { text: text(label.text), x: coordinate(label.x), y: coordinate(label.y), major: label.mapMarkerType === 'Major' };
    });
    return parse(await this.#get(`maps/${encodeURIComponent(region)}/static`, parse));
  }
  async map(region: string): Promise<MapData> {
    const parse = (value: unknown): MapData => {
      const data = record(value);
      return { version: integer(data.version), updatedAt: integer(data.lastUpdated), items: list(data.mapItems).map((entry): MapItem => {
        const item = record(entry);
        return { iconType: integer(item.iconType), x: coordinate(item.x), y: coordinate(item.y), flags: integer(item.flags), teamId: team(item.teamId) };
      }) };
    };
    return parse(await this.#get(`maps/${encodeURIComponent(region)}/dynamic/public`, parse));
  }
}

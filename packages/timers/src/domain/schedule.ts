import { deadline, type TimerAsset } from './asset';
import type { BoardSettings } from './board-settings';

/** Une alerte déjà réclamée en base pour (asset, échéance, seuil). */
export interface AlertRow {
  readonly assetId: string;
  readonly dueAt: Date;
  readonly thresholdMin: number;
  /** `null` : seuil rattrapé sans message, ou message déjà retiré. */
  readonly messageId: string | null;
  readonly ackedAt: Date | null;
}

export interface AlertClaim {
  readonly assetId: string;
  readonly dueAt: Date;
  readonly thresholdMin: number;
  /** Seul le seuil le plus proche de l'échéance envoie un message ; les plus lointains sont rattrapés en silence. */
  readonly send: boolean;
}

const MINUTE_MS = 60_000;

/**
 * Seuils atteints et pas encore réclamés. Après une interruption, on n'envoie qu'une alerte (le seuil le plus
 * proche de l'échéance) au lieu de tout rejouer d'un coup. Un refresh change l'échéance : tout est ré-armé.
 */
export function planAlerts(
  assets: readonly TimerAsset[],
  existing: readonly AlertRow[],
  settings: BoardSettings,
  now: Date,
): AlertClaim[] {
  if (!settings.alertsEnabled) return [];
  const ascending = [...settings.alertThresholdsMin].sort((a, b) => a - b);
  const claims: AlertClaim[] = [];
  for (const asset of assets) {
    const end = deadline(asset);
    if (end === null || end.getTime() <= now.getTime()) continue;
    const remaining = end.getTime() - now.getTime();
    const reached = ascending.filter((threshold) => threshold * MINUTE_MS >= remaining);
    const closest = reached[0];
    if (closest === undefined) continue;
    const known = new Set(
      existing.filter((row) => row.assetId === asset.id && row.dueAt.getTime() === end.getTime()).map((row) => row.thresholdMin),
    );
    for (const threshold of reached) {
      if (!known.has(threshold)) claims.push({ assetId: asset.id, dueAt: end, thresholdMin: threshold, send: threshold === closest });
    }
  }
  return claims;
}

/**
 * Messages d'alerte à retirer : asset barré, supprimé ou rafraîchi (échéance changée), échéance passée, ou alerte
 * remplacée par une plus proche de l'échéance.
 */
export function staleAlerts(assets: readonly TimerAsset[], existing: readonly AlertRow[], now: Date): AlertRow[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const live = existing.filter((row) => row.messageId !== null);
  return live.filter((row) => {
    const end = byId.get(row.assetId) === undefined ? null : deadline(byId.get(row.assetId) as TimerAsset);
    if (end === null || end.getTime() <= now.getTime() || end.getTime() !== row.dueAt.getTime()) return true;
    const closer = live.some(
      (other) => other.assetId === row.assetId && other.dueAt.getTime() === row.dueAt.getTime() && other.thresholdMin < row.thresholdMin,
    );
    return closer;
  });
}

/** Assets à supprimer : barrés ou expirés depuis plus longtemps que le délai de purge du board. */
export function purgeCandidates(assets: readonly TimerAsset[], settings: BoardSettings, now: Date): TimerAsset[] {
  if (settings.purgeAfterHours === null) return [];
  const delay = settings.purgeAfterHours * 3_600_000;
  return assets.filter((asset) => {
    const reference = asset.status === 'struck' ? asset.struckAt : deadline(asset);
    return reference !== null && reference.getTime() + delay <= now.getTime();
  });
}

export interface WakeInput {
  readonly assets: readonly TimerAsset[];
  readonly settings: BoardSettings;
  readonly now: Date;
  readonly needsSync: boolean;
}

/**
 * Prochain instant où ce board demande du travail : rendu en attente, seuil d'alerte, échéance (le board affiche
 * alors « expiré »), purge. `null` : rien à planifier.
 */
export function nextWake(input: WakeInput): Date | null {
  const { assets, settings, now } = input;
  if (input.needsSync) return now;
  const nowMs = now.getTime();
  const candidates: number[] = [];
  for (const asset of assets) {
    const end = deadline(asset);
    if (end !== null && end.getTime() > nowMs) {
      candidates.push(end.getTime());
      if (settings.alertsEnabled) {
        for (const threshold of settings.alertThresholdsMin) {
          const fire = end.getTime() - threshold * MINUTE_MS;
          if (fire > nowMs) candidates.push(fire);
        }
      }
    }
    if (settings.purgeAfterHours !== null) {
      const reference = asset.status === 'struck' ? asset.struckAt : end;
      if (reference !== null) {
        const at = reference.getTime() + settings.purgeAfterHours * 3_600_000;
        candidates.push(at > nowMs ? at : nowMs);
      }
    }
  }
  return candidates.length === 0 ? null : new Date(Math.min(...candidates));
}

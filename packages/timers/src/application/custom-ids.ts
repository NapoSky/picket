import { encodeCustomId } from '@picket/discord';
import { UserId } from '@picket/kernel';
import { ASSET_TYPES, assetTypeByShort, type AssetTypeId } from '../domain/asset-types';

export const TIMERS_NAMESPACE = 'tm';
export const TIMERS_VERSION = 1;

export const NAME_FIELD_ID = 'name';
export const CODE_FIELD_ID = 'code';
export const DURATION_FIELD_ID = 'duration';

const ASSET_ID = /^[a-z0-9]{8,16}$/u;
const KEY = /^[a-z0-9]{1,24}$/u;

export type TimersPayload =
  | { readonly kind: 'refresh'; readonly assetId: string }
  | { readonly kind: 'ack'; readonly assetId: string; readonly thresholdMin: number }
  | {
      readonly kind: 'add';
      readonly type: AssetTypeId;
      readonly regionKey: string;
      readonly locationKey: string;
      readonly ownerId: UserId;
    };

/** Bouton de remise à zéro d'un asset : l'identifiant suffit, aucun état n'est porté par le message. */
export const refreshCustomId = (assetId: string): string => encodeCustomId(TIMERS_NAMESPACE, TIMERS_VERSION, `r:${assetId}`);

/** Bouton d'acquittement d'une alerte : l'asset et le seuil ; l'échéance concernée est celle de l'asset à cet instant. */
export const ackCustomId = (assetId: string, thresholdMin: number): string =>
  encodeCustomId(TIMERS_NAMESPACE, TIMERS_VERSION, `k:${assetId}:${thresholdMin}`);

/** Modale d'ajout : ce que la commande a déjà choisi (type, lieu, propriétaire) voyage dans l'identifiant. */
export const addModalCustomId = (type: AssetTypeId, regionKey: string, locationKey: string, ownerId: UserId): string =>
  encodeCustomId(TIMERS_NAMESPACE, TIMERS_VERSION, `a:${ASSET_TYPES[type].short}:${regionKey}:${locationKey}:${ownerId}`);

/** Valide tout ce qui vient du `custom_id` : il est contrôlé par l'utilisateur, pas par nous. */
export function parseTimersPayload(payload: string): TimersPayload | null {
  const parts = payload.split(':');
  const [kind, ...rest] = parts;
  if (kind === 'r' && rest.length === 1 && ASSET_ID.test(rest[0] as string)) return { kind: 'refresh', assetId: rest[0] as string };
  if (kind === 'k' && rest.length === 2 && ASSET_ID.test(rest[0] as string) && /^\d{1,5}$/u.test(rest[1] as string)) {
    return { kind: 'ack', assetId: rest[0] as string, thresholdMin: Number(rest[1]) };
  }
  if (kind === 'a' && rest.length === 4) {
    const [short, regionKey, locationKey, owner] = rest as [string, string, string, string];
    const type = assetTypeByShort(short);
    const ownerId = UserId.parse(owner);
    if (type !== undefined && KEY.test(regionKey) && KEY.test(locationKey) && ownerId.ok) {
      return { kind: 'add', type: type.id, regionKey, locationKey, ownerId: ownerId.value };
    }
  }
  return null;
}

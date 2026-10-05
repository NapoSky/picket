import { encodeCustomId } from '@picket/discord';

export const TODOLIST_NAMESPACE = 'td';
export const TODOLIST_VERSION = 1;
export const CREATE_MODAL_PAYLOAD = 'create';
export const CONTENT_FIELD_ID = 'content';

const ITEM_PAYLOAD = /^i(\d{1,2})$/;
const MAX_LETTER_INDEX = 25;

/** Un seul format de `custom_id`, sans page ni lettre saisie : `td:1:i<index de l'item sur la page>`. */
export const itemCustomId = (index: number): string => encodeCustomId(TODOLIST_NAMESPACE, TODOLIST_VERSION, `i${index}`);

export function parseItemPayload(payload: string): number | null {
  const match = ITEM_PAYLOAD.exec(payload);
  if (!match) return null;
  const index = Number(match[1]);
  return index <= MAX_LETTER_INDEX ? index : null;
}

export const createModalCustomId = (): string =>
  encodeCustomId(TODOLIST_NAMESPACE, TODOLIST_VERSION, CREATE_MODAL_PAYLOAD);

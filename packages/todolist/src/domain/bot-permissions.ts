const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;
const ADMINISTRATOR = 1n << 3n;

export type BotPermission = 'view_channel' | 'send_messages' | 'embed_links';

/**
 * Droits du bot qui manquent pour publier une todolist dans le canal de l'interaction (`app_permissions`).
 * `null` (non fourni par Discord) : on tente, et une erreur de l'API sera expliquée.
 */
export function missingBotPermissions(appPermissions: bigint | null): readonly BotPermission[] {
  if (appPermissions === null || (appPermissions & ADMINISTRATOR) !== 0n) return [];
  const has = (bit: bigint): boolean => (appPermissions & bit) !== 0n;
  const missing: BotPermission[] = [];
  if (!has(VIEW_CHANNEL)) missing.push('view_channel');
  // Dans un fil, c'est « Envoyer des messages dans les fils » qui compte.
  if (!has(SEND_MESSAGES) && !has(SEND_MESSAGES_IN_THREADS)) missing.push('send_messages');
  if (!has(EMBED_LINKS)) missing.push('embed_links');
  return missing;
}

/** Public export contract, shared by Discord attachments and the dashboard. */
export interface ExportActivity {
  readonly guildId: string;
  readonly userId: string;
  readonly name: string;
  readonly seconds: number;
  readonly lastActivity: string;
}

export function exportActivity(
  rows: readonly ExportActivity[],
  format: 'json' | 'csv',
  includeGuild = false,
): string {
  const users = rows.map((row) => ({
    ...(includeGuild ? { guildId: row.guildId } : {}),
    userId: row.userId,
    username: row.name,
    totalSeconds: row.seconds,
    lastActivityDate: row.lastActivity.replace(/(?:\.000)?Z$/, '+00:00'),
  }));
  if (format === 'json') return JSON.stringify(users, null, 2);

  // Neutralise spreadsheet formulas, then preserve commas, quotes and newlines.
  const cell = (value: string | number) => {
    const text = String(value).replace(/^[\s\u0000-\u001f]*[=+@-]/, "'$&");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    `${includeGuild ? 'guild_id,' : ''}user_id,username,total_seconds,last_activity_date`,
    ...users.map((user) => [
      ...(includeGuild ? [user.guildId!] : []),
      user.userId, user.username, user.totalSeconds, user.lastActivityDate,
    ].map(cell).join(',')),
  ].join('\r\n') + '\r\n';
}

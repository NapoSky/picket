import { missingBotPermissions } from '@picket/todolist';

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const EMBED = 1n << 14n;
const SEND_IN_THREADS = 1n << 38n;
const ADMINISTRATOR = 1n << 3n;

describe('bot permissions needed to post a todolist (XCT-EC-07, TDL-EC-23)', () => {
  it('needs nothing when Discord does not tell us: the API error is explained afterwards', () => {
    expect(missingBotPermissions(null)).toEqual([]);
  });

  it('accepts the three required permissions, and Administrator', () => {
    expect(missingBotPermissions(VIEW | SEND | EMBED)).toEqual([]);
    expect(missingBotPermissions(ADMINISTRATOR)).toEqual([]);
  });

  it('names each permission that is missing', () => {
    expect(missingBotPermissions(0n)).toEqual(['view_channel', 'send_messages', 'embed_links']);
    expect(missingBotPermissions(VIEW | SEND)).toEqual(['embed_links']);
    expect(missingBotPermissions(SEND | EMBED)).toEqual(['view_channel']);
  });

  it('accepts sending in threads instead of sending messages', () => {
    expect(missingBotPermissions(VIEW | SEND_IN_THREADS | EMBED)).toEqual([]);
  });
});

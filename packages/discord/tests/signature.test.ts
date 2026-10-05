import { createSignatureVerifier, isTimestampFresh } from '@picket/discord';
import { createTestKeys } from '@picket/testing';

describe('Ed25519 request signature', () => {
  const keys = createTestKeys();
  const verify = createSignatureVerifier(keys.publicKeyHex);
  const timestamp = '1760000000';
  const body = '{"type":1}';

  it('accepts a genuine signature', () => {
    expect(verify(keys.signRequest(timestamp, body), timestamp, Buffer.from(body))).toBe(true);
  });

  it('rejects a tampered body or timestamp', () => {
    const signature = keys.signRequest(timestamp, body);
    expect(verify(signature, timestamp, Buffer.from('{"type":2}'))).toBe(false);
    expect(verify(signature, '1760000001', Buffer.from(body))).toBe(false);
  });

  it('rejects a signature made with another key', () => {
    const other = createTestKeys();
    expect(verify(other.signRequest(timestamp, body), timestamp, Buffer.from(body))).toBe(false);
  });

  it.each(['', 'zz', 'a'.repeat(127), 'a'.repeat(129), 'g'.repeat(128)])('rejects malformed signature %#', (value) => {
    expect(verify(value, timestamp, Buffer.from(body))).toBe(false);
  });

  it('refuses an invalid public key at construction', () => {
    expect(() => createSignatureVerifier('abc')).toThrow('Invalid Discord public key');
  });
});

describe('isTimestampFresh', () => {
  const nowMs = 1_760_000_000_000;

  it('accepts timestamps within the tolerance, in both directions', () => {
    expect(isTimestampFresh('1760000000', nowMs, 300)).toBe(true);
    expect(isTimestampFresh('1759999800', nowMs, 300)).toBe(true);
    expect(isTimestampFresh('1760000300', nowMs, 300)).toBe(true);
  });

  it('rejects stale, future and malformed timestamps', () => {
    expect(isTimestampFresh('1759999699', nowMs, 300)).toBe(false);
    expect(isTimestampFresh('1760000301', nowMs, 300)).toBe(false);
    expect(isTimestampFresh('abc', nowMs, 300)).toBe(false);
    expect(isTimestampFresh('', nowMs, 300)).toBe(false);
    expect(isTimestampFresh('-5', nowMs, 300)).toBe(false);
  });
});

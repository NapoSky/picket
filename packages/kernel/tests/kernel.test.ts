import { ApplicationId, GuildId, InvalidIdError, Secret, err, ok } from '@picket/kernel';

describe('snowflake ids', () => {
  it('accepts a valid snowflake', () => {
    const result = GuildId.parse('123456789012345678');
    expect(result).toEqual({ ok: true, value: '123456789012345678' });
  });

  it.each(['', '123', 'abc', '12345678901234567a', ' 123456789012345678', 42, null, undefined])(
    'rejects %p',
    (value) => {
      const result = GuildId.parse(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(InvalidIdError);
    },
  );

  it('assert throws a typed error', () => {
    expect(() => ApplicationId.assert('nope')).toThrow(InvalidIdError);
  });
});

describe('result helpers', () => {
  it('builds discriminated results', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
  });
});

describe('Secret', () => {
  const secret = new Secret('super-token');

  it('reveals only on demand', () => {
    expect(secret.reveal()).toBe('super-token');
  });

  it('never leaks through string conversions', () => {
    expect(`${secret}`).not.toContain('super-token');
    expect(JSON.stringify({ secret })).not.toContain('super-token');
    expect(JSON.stringify({ secret })).toContain('[REDACTED]');
  });
});

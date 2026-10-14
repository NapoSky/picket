import { err, ok, type Result } from '@picket/kernel';

export type DurationUnit = 'minutes' | 'hours';

const UNIT_SECONDS = { d: 86_400, h: 3_600, m: 60 } as const;
type UnitLetter = keyof typeof UNIT_SECONDS;

const MAX_INPUT_LENGTH = 40;
// Scan sequentially rather than with one repeated regex: avoid exponential backtracking on hostile input.
const TOKEN = /\s*(\d+(?:[.,]\d+)?)\s*([dhm])?/iyu;

/**
 * `50`, `1.5`, `1,5h`, `90m`, `2d`, `1d 12h`, `2h30m`: a lone number uses the default unit; multiple pieces
 * each require their own unit (2h30 is ambiguous). Return whole seconds.
 */
export function parseDuration(input: string, defaultUnit: DurationUnit): Result<number, 'invalid'> {
  const text = input.trim();
  if (text === '' || text.length > MAX_INPUT_LENGTH) return err('invalid');

  const tokens: { value: string; unit: UnitLetter | undefined }[] = [];
  let index = 0;
  while (index < text.length) {
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(text);
    if (match === null) return err('invalid');
    tokens.push({ value: match[1] as string, unit: match[2]?.toLowerCase() as UnitLetter | undefined });
    index = TOKEN.lastIndex;
  }

  if (tokens.length === 1) {
    const [token] = tokens as [(typeof tokens)[number]];
    const unit = token.unit ?? (defaultUnit === 'hours' ? 'h' : 'm');
    const seconds = Math.round(Number(token.value.replace(',', '.')) * UNIT_SECONDS[unit]);
    return Number.isFinite(seconds) ? ok(seconds) : err('invalid');
  }

  let total = 0;
  for (const token of tokens) {
    if (token.unit === undefined || !/^\d+$/u.test(token.value)) return err('invalid');
    total += Number(token.value) * UNIT_SECONDS[token.unit];
  }
  return Number.isFinite(total) ? ok(total) : err('invalid');
}

/** `1d 12h`, `50h`, `2h 30m`: shortest exact representation. */
export function formatDuration(totalSeconds: number): string {
  let rest = Math.max(0, Math.round(totalSeconds));
  const parts: string[] = [];
  for (const [letter, size] of [['d', 86_400], ['h', 3_600], ['m', 60]] as const) {
    const count = Math.floor(rest / size);
    if (count > 0) parts.push(`${count}${letter}`);
    rest -= count * size;
  }
  if (rest > 0) parts.push(`${rest}s`);
  return parts.length === 0 ? '0m' : parts.join(' ');
}

/** `6h, 2h, 30m` (commas or semicolons): whole minutes; a lone number is in minutes. */
export function parseThresholds(input: string): Result<number[], 'invalid'> {
  const parts = input.split(/[,;]/u).map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0 || parts.length > 20) return err('invalid');
  const minutes: number[] = [];
  for (const part of parts) {
    const parsed = parseDuration(part, 'minutes');
    if (!parsed.ok || parsed.value % 60 !== 0) return err('invalid');
    minutes.push(parsed.value / 60);
  }
  return ok(minutes);
}

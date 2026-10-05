import { findLocation, findRegion } from '@picket/game-data';
import { normalizeName, validateAssetInput, type AssetInput, type ValidationError } from '@picket/timers';
import { LOCATION, REGION } from './fixtures';

const input = (overrides: Partial<AssetInput> = {}): AssetInput => ({
  type: 'stockpile',
  regionKey: REGION,
  locationKey: LOCATION,
  name: 'Depot',
  code: '123456',
  duration: '50',
  ...overrides,
});

const valid = (overrides: Partial<AssetInput> = {}) => {
  const result = validateAssetInput(input(overrides));
  if (!result.ok) throw new Error(`expected a valid asset, got ${JSON.stringify(result.error)}`);
  return result.value;
};
const invalid = (overrides: Partial<AssetInput> = {}): ValidationError => {
  const result = validateAssetInput(input(overrides));
  if (result.ok) throw new Error('expected a validation error');
  return result.error;
};

describe('the test fixtures point at real game data', () => {
  it('knows the region and the location', () => {
    expect(findRegion(REGION)).toBeDefined();
    expect(findLocation(REGION, LOCATION)).toBeDefined();
  });
});

describe('validateAssetInput', () => {
  it('accepts a stockpile with its 6-digit code and a duration in hours', () => {
    expect(valid({ name: '  Depot   A ' })).toEqual({
      type: 'stockpile',
      regionKey: REGION,
      locationKey: LOCATION,
      name: 'Depot A',
      code: '123456',
      durationS: 180_000,
      direction: 'down',
    });
  });

  it('requires a 6-digit code for a stockpile, and the same rule everywhere (TIM-EC-12)', () => {
    expect(invalid({ code: '' })).toEqual({ code: 'code_required' });
    expect(invalid({ code: '12345' })).toEqual({ code: 'code_invalid' });
    expect(invalid({ code: 'abc123' })).toEqual({ code: 'code_invalid' });
    expect(valid({ code: '12 34 56' }).code).toBe('123456');
  });

  it.each(['naval_ship', 'tank', 'train'])('%s: the code is optional, 3 to 6 alphanumerics, stored in capitals', (type) => {
    expect(valid({ type, code: '' }).code).toBeNull();
    expect(valid({ type, code: 'ab12' }).code).toBe('AB12');
    expect(invalid({ type, code: 'a' })).toEqual({ code: 'code_invalid' });
    expect(invalid({ type, code: '1234567' })).toEqual({ code: 'code_invalid' });
    expect(invalid({ type, code: 'ab-12' })).toEqual({ code: 'code_invalid' });
    expect(valid({ type, duration: '48' }).durationS).toBe(172_800);
  });

  it('keeps no code for a facility or a field, whatever was typed', () => {
    expect(valid({ type: 'facility', code: '123456' }).code).toBeNull();
    expect(valid({ type: 'field', code: 'zzz' }).code).toBeNull();
  });

  it('a field counts an age: no duration is asked, a typed one is ignored (TIM-EC-14)', () => {
    const field = valid({ type: 'field', duration: 'not a duration' });
    expect(field.direction).toBe('up');
    expect(field.durationS).toBe(3_600);
  });

  it('TIM-EC-20: measures the name after normalisation, in characters and not in UTF-16 units', () => {
    expect(invalid({ name: '   ' })).toEqual({ code: 'name_empty' });
    expect(invalid({ name: '\u200b\n\t' })).toEqual({ code: 'name_empty' });
    expect(valid({ name: 'a'.repeat(15) }).name).toHaveLength(15);
    expect(invalid({ name: 'a'.repeat(16) })).toEqual({ code: 'name_too_long', max: 15 });
    expect(valid({ name: '🇦'.repeat(15) }).name).toBe('🇦'.repeat(15));
    expect(invalid({ name: '🇦'.repeat(16) })).toEqual({ code: 'name_too_long', max: 15 });
    // Les espaces multiples comptent pour un seul : « a    b » tient en 3 caractères.
    expect(valid({ name: `a${' '.repeat(40)}b` }).name).toBe('a b');
  });

  it('stores the name as typed (no escaping): Markdown and mentions are neutralised when rendering', () => {
    expect(valid({ name: '**x** <@1>' }).name).toBe('**x** <@1>');
    expect(normalizeName('a\u200bb\nc')).toBe('a b c');
  });

  it('bounds the duration between one minute and thirty days (TIM-RQ-05)', () => {
    expect(invalid({ duration: 'abc' })).toEqual({ code: 'duration_invalid' });
    expect(invalid({ duration: '' })).toEqual({ code: 'duration_invalid' });
    expect(invalid({ duration: '0.01' })).toEqual({ code: 'duration_too_short', minSeconds: 60 });
    expect(valid({ duration: '1m' }).durationS).toBe(60);
    expect(valid({ duration: '720' }).durationS).toBe(30 * 86_400);
    expect(invalid({ duration: '721' })).toEqual({ code: 'duration_too_long', maxSeconds: 30 * 86_400 });
    expect(invalid({ duration: '1e9' })).toEqual({ code: 'duration_invalid' });
  });

  it('refuses an unknown type, region or location instead of correcting it (TIM-EC-18)', () => {
    expect(invalid({ type: 'castle' })).toEqual({ code: 'unknown_type' });
    expect(invalid({ regionKey: 'atlantis' })).toEqual({ code: 'unknown_region' });
    expect(invalid({ locationKey: 'mercyswal' })).toEqual({ code: 'unknown_location' });
    expect(invalid({ regionKey: 'westgate' })).toEqual({ code: 'unknown_location' });
  });
});

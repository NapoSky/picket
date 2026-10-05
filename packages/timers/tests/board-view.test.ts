import { MAX_EMBED_FIELDS, MAX_EMBEDS_PER_MESSAGE, MAX_EMBEDS_TOTAL_LENGTH, MAX_FIELD_NAME, MAX_FIELD_VALUE, embedsLength, toRestMessage } from '@picket/discord';
import { allRegions } from '@picket/game-data';
import {
  escapeMarkdown,
  indicatorEmoji,
  refreshCustomId,
  renderBoard,
  strikeAsset,
  type BoardTexts,
  type TimerAsset,
} from '@picket/timers';
import { HOUR_MS, NOW, OTHER, OWNER, makeAsset, unix } from './fixtures';

const texts: BoardTexts = {
  title: '⏱️ Timers',
  empty: 'No timer yet.',
  footer: (page, total) => `⏱️ ${page}/${total}`,
};
const render = (assets: readonly TimerAsset[], now = NOW) => renderBoard({ assets, texts, now });
const later = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);

describe('renderBoard', () => {
  it('TIM-EC-21: an empty board is one message with no button, never zero pages', () => {
    const pages = render([]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.view).toEqual({ embeds: [{ description: 'No timer yet.', color: 0x2b5fb3, title: '⏱️ Timers' }], buttons: [] });
    expect(pages[0]?.activeAssetIds).toEqual([]);
  });

  it('writes one field per location and one line per asset, with the letter of its button', () => {
    const first = makeAsset({ name: 'Depot', code: '123456', ownerId: OWNER });
    const second = makeAsset({ name: 'Garage', type: 'facility', code: null, ownerId: OTHER });
    const pages = render([second, first]);
    expect(pages).toHaveLength(1);
    const [embed] = pages[0]?.view.embeds ?? [];
    expect(embed).toMatchObject({ title: '⏱️ Timers', color: 0x2b5fb3 });
    expect(embed?.fields).toEqual([
      {
        name: "🏞️ Allod's Bight・🏙️ Mercy's Wail",
        value: [
          `🇦・📦 **Depot** \`123456\`・<t:${unix(later(50))}:R>・<@${OWNER}>`,
          `🇧・🏭 **Garage**・<t:${unix(later(50))}:R>・<@${OTHER}>`,
        ].join('\n'),
      },
    ]);
    expect(pages[0]?.view.buttons).toEqual([
      { customId: refreshCustomId(first.id), emoji: '🇦' },
      { customId: refreshCustomId(second.id), emoji: '🇧' },
    ]);
    expect(pages[0]?.activeAssetIds).toEqual([first.id, second.id]);
  });

  it('starts a new field for each place, and shows an age as a past moment', () => {
    const field = makeAsset({ type: 'field', direction: 'up', code: null, name: 'Iron', locationKey: 'rumhold' });
    const depot = makeAsset({ name: 'Depot' });
    const fields = render([field, depot])[0]?.view.embeds[0]?.fields ?? [];
    expect(fields.map((entry) => entry.name)).toEqual(["🏞️ Allod's Bight・🏙️ Mercy's Wail", "🏞️ Allod's Bight・🏙️ Rumhold"]);
    // Les lettres se suivent sur toute la page, d'un lieu au suivant.
    expect(fields[0]?.value.startsWith('🇦・📦')).toBe(true);
    expect(fields[1]?.value).toBe(`🇧・⛏️ **Iron**・<t:${unix(NOW)}:R>・<@${OWNER}>`);
  });

  it('shows a struck asset crossed out, without a button, and does not count it for the letters', () => {
    const struck = strikeAsset(makeAsset({ name: 'Old', type: 'facility', code: null }), later(1));
    const live = makeAsset({ name: 'Live', type: 'tank', code: null });
    const [page] = render([struck, live]);
    const value = page?.view.embeds[0]?.fields?.[0]?.value ?? '';
    expect(value.split('\n')).toEqual([
      `~~❌・🏭 Old・<t:${unix(later(50))}:R>~~・<@${OWNER}>`,
      `🇦・⚙️ **Live**・<t:${unix(later(50))}:R>・<@${OWNER}>`,
    ]);
    expect(page?.view.buttons).toHaveLength(1);
    expect(page?.activeAssetIds).toEqual([live.id]);
  });

  it('marks an expired countdown, which changes the page content and so its hash', () => {
    const asset = makeAsset();
    const before = render([asset], later(49))[0];
    const after = render([asset], later(51))[0];
    expect(before?.view.embeds[0]?.fields?.[0]?.value).not.toContain('⌛');
    expect(after?.view.embeds[0]?.fields?.[0]?.value).toContain(`⌛ <t:${unix(later(50))}:R>`);
    expect(after?.hash).not.toBe(before?.hash);
  });

  it('is deterministic: same state, same messages, same hashes, whatever the input order', () => {
    const assets = Array.from({ length: 12 }, (_value, index) => makeAsset({ name: `T${index}`, locationKey: index % 2 === 0 ? 'mercyswail' : 'rumhold' }));
    const a = render(assets);
    const b = render([...assets].reverse());
    expect(b).toEqual(a);
    expect(a.map((page) => page.hash)).toEqual(b.map((page) => page.hash));
    expect(render(assets.slice(1))[0]?.hash).not.toBe(a[0]?.hash);
  });

  it('TIM-EC-20: neutralises Markdown, links and mentions in a name', () => {
    const asset = makeAsset({ name: '**b** _i_ [x](y) <@1> @everyone' });
    const line = render([asset])[0]?.view.embeds[0]?.fields?.[0]?.value ?? '';
    expect(line).not.toContain('<@1>');
    expect(line).not.toContain('@everyone');
    expect(line).toContain('\\*\\*b\\*\\*');
    expect(line).toContain('\\[x\\](y)');
    expect(escapeMarkdown('a|b ~c~ `d` #e >f')).toBe('a\\|b \\~c\\~ \\`d\\` \\#e \\>f');
  });

  it('puts 25 active assets on a page at most, with a footer once there is more than one page', () => {
    const assets = Array.from({ length: 26 }, (_value, index) => makeAsset({ name: `T${String(index).padStart(2, '0')}` }));
    const pages = render(assets);
    expect(pages.map((page) => page.view.buttons.length)).toEqual([25, 1]);
    expect(pages[0]?.view.embeds.at(-1)?.footer).toBe('⏱️ 1/2');
    expect(pages[1]?.view.embeds.at(-1)?.footer).toBe('⏱️ 2/2');
    expect(render(assets.slice(0, 25))[0]?.view.embeds[0]).not.toHaveProperty('footer');
    expect(pages[1]?.view.buttons[0]?.emoji).toBe(indicatorEmoji(0));
  });

  it('keeps a struck asset next to its neighbours: it costs no button and does not force a page', () => {
    const live = Array.from({ length: 25 }, (_value, index) => makeAsset({ name: `L${String(index).padStart(2, '0')}` }));
    const struck = strikeAsset(makeAsset({ name: 'A struck' }), later(1));
    expect(render([...live, struck])).toHaveLength(1);
  });
});

describe('renderBoard properties (TIM-RQ-19)', () => {
  // Générateur pseudo-aléatoire à graine : les cas sont reproductibles.
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  function crowd(seed: number, count: number): TimerAsset[] {
    const next = random(seed);
    const regions = allRegions();
    const types = ['stockpile', 'facility', 'field', 'naval_ship', 'tank', 'train'] as const;
    return Array.from({ length: count }, (_value, index) => {
      const region = regions[Math.floor(next() * regions.length)] as (typeof regions)[number];
      const location = region.locations[Math.floor(next() * region.locations.length)] as (typeof region.locations)[number];
      const type = types[Math.floor(next() * types.length)] as (typeof types)[number];
      const asset = makeAsset({
        id: `crowd${String(seed)}${String(index).padStart(4, '0')}`,
        type,
        direction: type === 'field' ? 'up' : 'down',
        code: type === 'stockpile' ? String(100_000 + Math.floor(next() * 899_999)) : null,
        regionKey: region.key,
        locationKey: location.key,
        name: `${'Nm'.repeat(Math.floor(next() * 8))}${index}`.slice(0, 15),
        ownerId: next() > 0.5 ? OWNER : OTHER,
      });
      return next() > 0.7 ? strikeAsset(asset, later(1)) : asset;
    });
  }

  it.each([
    [1, 0],
    [2, 1],
    [3, 25],
    [4, 26],
    [5, 60],
    [6, 150],
    [7, 400],
  ])('seed %i, %i assets: every page fits what Discord accepts, and every asset is shown exactly once', (seed, count) => {
    const assets = crowd(seed, count);
    const pages = render(assets);
    expect(pages.length).toBeGreaterThanOrEqual(1);

    const activeIds = new Set<string>();
    for (const page of pages) {
      const { view } = page;
      expect(view.buttons.length).toBeLessThanOrEqual(25);
      expect(view.embeds.length).toBeLessThanOrEqual(MAX_EMBEDS_PER_MESSAGE);
      expect(embedsLength(view.embeds)).toBeLessThanOrEqual(MAX_EMBEDS_TOTAL_LENGTH);
      for (const embed of view.embeds) {
        expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(MAX_EMBED_FIELDS);
        for (const field of embed.fields ?? []) {
          expect(field.name.length).toBeLessThanOrEqual(MAX_FIELD_NAME);
          expect(field.value.length).toBeLessThanOrEqual(MAX_FIELD_VALUE);
        }
      }
      for (const button of view.buttons) expect(button.customId.length).toBeLessThanOrEqual(100);
      expect(new Set(view.buttons.map((button) => button.customId)).size).toBe(view.buttons.length);
      expect(view.buttons.map((button) => button.emoji)).toEqual(page.activeAssetIds.map((_id, index) => indicatorEmoji(index)));
      // Ce que l'adaptateur REST accepterait réellement.
      expect(() => toRestMessage(view)).not.toThrow();
      for (const id of page.activeAssetIds) activeIds.add(id);
    }
    expect([...activeIds].sort()).toEqual(assets.filter((asset) => asset.status === 'active').map((asset) => asset.id).sort());

    const lines = pages.flatMap((page) => page.view.embeds.flatMap((embed) => (embed.fields ?? []).flatMap((field) => field.value.split('\n'))));
    expect(lines).toHaveLength(assets.length);
  });

  it('a page with long names in many places still fits the 6 000 characters', () => {
    const assets = allRegions()
      .slice(0, 12)
      .flatMap((region) => region.locations.slice(0, 3).map((location) => makeAsset({ regionKey: region.key, locationKey: location.key, name: '*'.repeat(15) })));
    for (const page of render(assets)) expect(embedsLength(page.view.embeds)).toBeLessThanOrEqual(MAX_EMBEDS_TOTAL_LENGTH);
  });
});

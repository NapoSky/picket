import { MAX_EMBED_FIELDS, MAX_EMBEDS_PER_MESSAGE, MAX_EMBEDS_TOTAL_LENGTH, MAX_FIELD_NAME, MAX_FIELD_VALUE, embedsLength, toRestMessage } from '@picket/discord';
import { allRegions } from '@picket/game-data';
import {
  escapeMarkdown,
  indicatorEmoji,
  refreshCustomId,
  renderBoard,
  strikeAsset,
  type BoardTexts,
  type RenderedPage,
  type TimerAsset,
} from '@picket/timers';
import { HOUR_MS, NOW, OTHER, OWNER, makeAsset, unix } from './fixtures';

const texts: BoardTexts = {
  title: '⏱️ Gestion des timers et refreshs',
  empty: 'No timer yet.',
  updated: '🕓 Dernière mise à jour',
  assetColumn: 'Asset',
  codeColumn: 'Code',
  timerColumn: 'Timer',
};
const render = (assets: readonly TimerAsset[], now = NOW, icons?: { region: string; location: string }) =>
  renderBoard({ assets, texts, now, ...(icons ? { icons } : {}) });
const later = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);
const moment = (hours: number) => `<t:${unix(later(hours))}:R>`;

const fieldsOf = (page: RenderedPage | undefined) => page?.view.embeds.flatMap((embed) => embed.fields ?? []) ?? [];
const column = (page: RenderedPage | undefined, name: string) => fieldsOf(page).filter((field) => field.name === name).flatMap((field) => field.value.split('\n'));
const THIN = '\u2009';
const ZERO = '\u200b';

describe('renderBoard: the layout of the original bot (Asset, Code and Timer columns under a place header)', () => {
  it('TIM-EC-21: an empty board is one message with no button, never zero pages', () => {
    const pages = render([]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.view.embeds).toEqual([
      { description: 'No timer yet.', color: 0x2b5fb3, title: texts.title, footer: texts.updated, timestamp: NOW.toISOString() },
    ]);
    expect(pages[0]?.view.buttons).toEqual([]);
    expect(pages[0]?.activeAssetIds).toEqual([]);
  });

  it('writes a header per place, then the three columns side by side', () => {
    const first = makeAsset({ name: 'Depot', code: '123456', ownerId: OWNER });
    const second = makeAsset({ name: 'Garage', type: 'facility', code: null, ownerId: OTHER });
    const [page] = render([second, first]);
    expect(page?.view.embeds).toHaveLength(1);
    expect(page?.view.embeds[0]).toMatchObject({ title: texts.title, color: 0x2b5fb3, footer: texts.updated, timestamp: NOW.toISOString() });
    expect(fieldsOf(page)).toEqual([
      { name: "<:region:1556691725001687090> Allod's Bight", value: "<:Storage:1556691752050499734> **Mercy's Wail**" },
      { name: 'Asset', value: [`📦${THIN}🇦・Depot`, `🏭${THIN}🇧・Garage`].join('\n'), inline: true },
      { name: 'Code', value: ['123456', ZERO].join('\n'), inline: true },
      { name: 'Timer', value: [`${moment(50)}・<@${OWNER}>`, `${moment(50)}・<@${OTHER}>`].join('\n'), inline: true },
    ]);
    expect(page?.view.buttons).toEqual([
      { customId: refreshCustomId(first.id), emoji: '🇦' },
      { customId: refreshCustomId(second.id), emoji: '🇧' },
    ]);
    expect(page?.activeAssetIds).toEqual([first.id, second.id]);
  });

  it('writes the region only when it changes, and separates the places with an empty line, except after the last', () => {
    const rumhold = makeAsset({ name: 'A', locationKey: 'rumhold' });
    const mercy = makeAsset({ name: 'B', locationKey: 'mercyswail' });
    const deadlands = makeAsset({ name: 'C', regionKey: 'thedeadlands', locationKey: 'abandonedward' });
    const fields = fieldsOf(render([deadlands, rumhold, mercy])[0]);
    expect(fields.filter((field) => field.inline !== true).map((field) => [field.name, field.value])).toEqual([
      ["<:region:1556691725001687090> Allod's Bight", "<:Storage:1556691752050499734> **Mercy's Wail**"],
      [ZERO, '<:Storage:1556691752050499734> **Rumhold**'],
      ['<:region:1556691725001687090> The Deadlands', '<:Storage:1556691752050499734> **Abandoned Ward**'],
    ]);
    const timers = fields.filter((field) => field.name === 'Timer').map((field) => field.value);
    expect(timers[0]?.endsWith(`\n${ZERO}`)).toBe(true);
    expect(timers[1]?.endsWith(`\n${ZERO}`)).toBe(true);
    expect(timers[2]?.endsWith(ZERO)).toBe(false);
  });

  it('puts the letters one after the other over the whole message, from one place to the next', () => {
    const a = makeAsset({ name: 'A' });
    const b = makeAsset({ name: 'B', locationKey: 'rumhold' });
    const [page] = render([b, a]);
    expect(column(page, 'Asset')).toEqual([`📦${THIN}🇦・A`, `📦${THIN}🇧・B`]);
  });

  it('shows an age without owner (a field has nobody to chase), and the moment it started', () => {
    const field = makeAsset({ type: 'field', direction: 'up', code: null, name: 'Iron' });
    const [page] = render([field]);
    expect(column(page, 'Timer')).toEqual([moment(0)]);
    expect(column(page, 'Asset')).toEqual([`⛏️${THIN}🇦・Iron`]);
  });

  it('shows a struck asset crossed out with a cross instead of its letter, and does not count it for the letters', () => {
    const struck = strikeAsset(makeAsset({ name: 'Old', type: 'facility', code: null }), later(1));
    const live = makeAsset({ name: 'Live', type: 'tank', code: null });
    const [page] = render([struck, live]);
    expect(column(page, 'Asset')).toEqual([`~~🏭${THIN}❌・Old~~`, `⚙️${THIN}🇦・Live`]);
    expect(column(page, 'Code').slice(0, 2)).toEqual([`~~${ZERO}~~`, ZERO]);
    expect(column(page, 'Timer')).toEqual([`~~${moment(50)}~~`, `${moment(50)}・<@${OWNER}>`]);
    expect(page?.view.buttons).toHaveLength(1);
    expect(page?.activeAssetIds).toEqual([live.id]);
  });

  it('shows the code of a struck asset crossed out too', () => {
    const [page] = render([strikeAsset(makeAsset({ code: '654321' }), later(1))]);
    expect(column(page, 'Code')).toEqual(['~~654321~~']);
  });

  it('uses the icons the board chose, for example the custom emojis of a regiment', () => {
    const icons = { region: '<:forge_region:1426712511796871211>', location: '<:Storage:1173161948569944064>' };
    const fields = fieldsOf(render([makeAsset()], NOW, icons)[0]);
    expect(fields[0]).toEqual({ name: "<:forge_region:1426712511796871211> Allod's Bight", value: "<:Storage:1173161948569944064> **Mercy's Wail**" });
  });

  it('does not change at the deadline: the countdown shows itself as past, with no re-render needed', () => {
    const asset = makeAsset();
    expect(render([asset], later(49))[0]?.hash).toBe(render([asset], later(51))[0]?.hash);
  });
});

describe('renderBoard: messages, footer and hash', () => {
  const crowd = (count: number) => Array.from({ length: count }, (_value, index) => makeAsset({ name: `T${String(index).padStart(2, '0')}`, code: String(100_000 + index) }));

  it('puts 25 active assets on a message at most, and the title on each message', () => {
    const pages = render(crowd(26));
    expect(pages.map((page) => page.view.buttons.length)).toEqual([25, 1]);
    expect(pages.map((page) => page.view.embeds[0]?.title)).toEqual([texts.title, texts.title]);
    expect(pages[1]?.view.buttons[0]?.emoji).toBe(indicatorEmoji(0));
  });

  it('shows the last update only under the first message, and no page counter', () => {
    const pages = render(crowd(26));
    expect(pages[0]?.view.embeds[0]).toMatchObject({ footer: texts.updated, timestamp: NOW.toISOString() });
    expect(pages[1]?.view.embeds.every((embed) => embed.footer === undefined && embed.timestamp === undefined)).toBe(true);
    expect(JSON.stringify(pages)).not.toMatch(/1\/2/);
  });

  it('puts the title on the first embed of a message only, 24 fields at most per embed', () => {
    const assets = allRegions().slice(0, 4).flatMap((region) => region.locations.slice(0, 2).map((location) => makeAsset({ regionKey: region.key, locationKey: location.key })));
    const [page] = render(assets);
    const embeds = page?.view.embeds ?? [];
    expect(embeds.length).toBeGreaterThan(1);
    expect(embeds[0]?.title).toBe(texts.title);
    expect(embeds.slice(1).every((embed) => embed.title === undefined)).toBe(true);
    expect(embeds.every((embed) => (embed.fields?.length ?? 0) <= 24)).toBe(true);
    // Un lieu n'est jamais coupé entre deux embeds : chacun commence par un en-tête.
    expect(embeds.map((embed) => embed.fields?.[0]?.inline)).toEqual(embeds.map(() => undefined));
  });

  it('is deterministic, and its hash ignores the date of the last update (no edit for a mere clock tick)', () => {
    const assets = crowd(12).map((asset, index) => ({ ...asset, locationKey: index % 2 === 0 ? 'mercyswail' : 'rumhold' }));
    const a = render(assets);
    const b = render([...assets].reverse());
    expect(b.map((page) => page.hash)).toEqual(a.map((page) => page.hash));
    const later1 = render(assets, later(1));
    expect(later1.map((page) => page.hash)).toEqual(a.map((page) => page.hash));
    expect(later1[0]?.view.embeds[0]?.timestamp).toBe(later(1).toISOString());
    expect(render(assets.slice(1))[0]?.hash).not.toBe(a[0]?.hash);
  });

  it('changes the hash when an icon changes', () => {
    const asset = makeAsset();
    expect(render([asset], NOW, { region: '🌍', location: '📍' })[0]?.hash).not.toBe(render([asset])[0]?.hash);
  });

  it('TIM-EC-20: neutralises Markdown, links and mentions in a name', () => {
    const asset = makeAsset({ name: '**b** _i_ [x](y) <@1> @everyone' });
    const line = column(render([asset])[0], 'Asset')[0] ?? '';
    expect(line).not.toContain('<@1>');
    expect(line).not.toContain('@everyone');
    expect(line).toContain('\\*\\*b\\*\\*');
    expect(line).toContain('\\[x\\](y)');
    expect(escapeMarkdown('a|b ~c~ `d` #e >f')).toBe('a\\|b \\~c\\~ \\`d\\` \\#e \\>f');
  });

  it('keeps a struck asset beside its neighbours: it costs no button and does not force a page', () => {
    const live = crowd(25);
    expect(render([...live, strikeAsset(makeAsset({ name: 'A struck' }), later(1))])).toHaveLength(1);
  });

  it('splits a place whose columns would pass 1 024 characters, with no new header', () => {
    const struck = Array.from({ length: 90 }, (_value, index) => strikeAsset(makeAsset({ name: `S${index}`, code: null, type: 'facility' }), later(1)));
    const pages = render(struck);
    for (const page of pages) for (const field of fieldsOf(page)) expect(field.value.length).toBeLessThanOrEqual(MAX_FIELD_VALUE);
    expect(pages.flatMap((page) => column(page, 'Asset'))).toHaveLength(90);
    const headers = pages.flatMap((page) => fieldsOf(page).filter((field) => field.inline !== true));
    expect(headers.every((field) => field.value === "<:Storage:1556691752050499734> **Mercy's Wail**")).toBe(true);
    expect(headers.length).toBe(pages.length);
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
  ])('seed %i, %i assets: every message fits what Discord accepts, and every asset is shown exactly once', (seed, count) => {
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
    expect(pages.flatMap((page) => column(page, 'Asset'))).toHaveLength(assets.length);
  });

  it('a message with long names in many places still fits the 6 000 characters', () => {
    const assets = allRegions()
      .slice(0, 12)
      .flatMap((region) => region.locations.slice(0, 3).map((location) => makeAsset({ regionKey: region.key, locationKey: location.key, name: '*'.repeat(15) })));
    for (const page of render(assets)) expect(embedsLength(page.view.embeds)).toBeLessThanOrEqual(MAX_EMBEDS_TOTAL_LENGTH);
  });
});

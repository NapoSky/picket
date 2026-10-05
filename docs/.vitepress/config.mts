import { defineConfig, type DefaultTheme } from 'vitepress';

// Sur GitHub Pages le site vit sous /<dépôt>/ ; le workflow fournit la valeur exacte.
const base = process.env['DOCS_BASE'] ?? '/picket/';

type Lang = 'en' | 'fr';

const t = {
  en: {
    guide: 'Guide',
    selfHosting: 'Self-hosting',
    contributing: 'Contributing',
    sections: {
      guide: ['Getting started', 'Commands', 'Todo lists', 'Permissions', 'Privacy and data'],
      selfHosting: ['Installation', 'Configuration'],
      contributing: ['Translating', 'Architecture'],
    },
  },
  fr: {
    guide: 'Guide',
    selfHosting: 'Auto-hébergement',
    contributing: 'Contribuer',
    sections: {
      guide: ['Prise en main', 'Commandes', 'Todolists', 'Permissions', 'Confidentialité et données'],
      selfHosting: ['Installation', 'Configuration'],
      contributing: ['Traduire', 'Architecture'],
    },
  },
} as const;

function sidebar(lang: Lang): DefaultTheme.Sidebar {
  const prefix = lang === 'en' ? '' : '/fr';
  const s = t[lang];
  return [
    {
      text: s.guide,
      items: [
        { text: s.sections.guide[0], link: `${prefix}/guide/getting-started` },
        { text: s.sections.guide[1], link: `${prefix}/guide/commands` },
        { text: s.sections.guide[2], link: `${prefix}/guide/todolists` },
        { text: s.sections.guide[3], link: `${prefix}/guide/permissions` },
        { text: s.sections.guide[4], link: `${prefix}/guide/privacy` },
      ],
    },
    {
      text: s.selfHosting,
      items: [
        { text: s.sections.selfHosting[0], link: `${prefix}/self-hosting/install` },
        { text: s.sections.selfHosting[1], link: `${prefix}/self-hosting/configuration` },
      ],
    },
    {
      text: s.contributing,
      items: [
        { text: s.sections.contributing[0], link: `${prefix}/contributing/translating` },
        { text: s.sections.contributing[1], link: `${prefix}/contributing/architecture` },
      ],
    },
  ];
}

export default defineConfig({
  title: 'PICKET',
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: { provider: 'local' },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      description: 'Operational watchpost for Foxhole regiments on Discord',
      themeConfig: {
        sidebar: sidebar('en'),
        nav: [
          { text: t.en.guide, link: '/guide/getting-started' },
          { text: t.en.selfHosting, link: '/self-hosting/install' },
          { text: t.en.contributing, link: '/contributing/translating' },
        ],
      },
    },
    fr: {
      label: 'Français',
      lang: 'fr',
      link: '/fr/',
      description: 'Poste de veille opérationnel pour les régiments Foxhole sur Discord',
      themeConfig: {
        sidebar: sidebar('fr'),
        nav: [
          { text: t.fr.guide, link: '/fr/guide/getting-started' },
          { text: t.fr.selfHosting, link: '/fr/self-hosting/install' },
          { text: t.fr.contributing, link: '/fr/contributing/translating' },
        ],
      },
    },
  },
});

import { defineConfig, type DefaultTheme } from 'vitepress';

// Sur GitHub Pages le site vit sous /<dépôt>/ ; le workflow fournit la valeur exacte.
const base = process.env['DOCS_BASE'] ?? '/picket/';
const supportDiscord = 'https://discord.gg/EUnVfq5EYs';

type Lang = 'en' | 'fr';

const t = {
  en: {
    guide: 'Guide',
    selfHosting: 'Self-hosting',
    contributing: 'Contributing',
    legal: 'Legal',
    sections: {
      guide: ['Getting started', 'Commands', 'Todo lists', 'Timers', 'Permissions'],
      selfHosting: ['Installation', 'Configuration'],
      contributing: ['Translating', 'Architecture'],
      legal: ['Terms of Service', 'Privacy Policy'],
    },
  },
  fr: {
    guide: 'Guide',
    selfHosting: 'Auto-hébergement',
    contributing: 'Contribuer',
    legal: 'Mentions légales',
    sections: {
      guide: ['Prise en main', 'Commandes', 'Todolists', 'Timers', 'Permissions'],
      selfHosting: ['Installation', 'Configuration'],
      contributing: ['Traduire', 'Architecture'],
      legal: ["Conditions d'utilisation", 'Politique de confidentialité'],
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
        { text: s.sections.guide[3], link: `${prefix}/guide/timers` },
        { text: s.sections.guide[4], link: `${prefix}/guide/permissions` },
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
    {
      text: s.legal,
      items: [
        { text: s.sections.legal[0], link: `${prefix}/legal/terms` },
        { text: s.sections.legal[1], link: `${prefix}/legal/privacy` },
      ],
    },
  ];
}

function footerLinks(lang: Lang): string {
  const root = lang === 'en' ? base : `${base}fr/`;
  const s = t[lang].sections.legal;
  return `<a href="${root}legal/terms">${s[0]}</a><a href="${root}legal/privacy">${s[1]}</a>`;
}

export default defineConfig({
  title: 'PICKET',
  base,
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#0d1013' }],
  ],
  themeConfig: {
    logo: '/logo.png',
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/NapoSky/picket' },
      { icon: 'discord', link: supportDiscord, ariaLabel: 'PICKET support Discord' },
    ],
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      description: 'Operational watchpost for Foxhole regiments on Discord',
      themeConfig: {
        sidebar: sidebar('en'),
        footer: {
          message: footerLinks('en'),
          copyright: 'PICKET is an independent community project, not affiliated with Siege Camp.',
        },
        nav: [
          { text: t.en.guide, link: '/guide/getting-started' },
          { text: t.en.selfHosting, link: '/self-hosting/install' },
          { text: t.en.contributing, link: '/contributing/translating' },
          { text: 'Support', link: supportDiscord },
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
        footer: {
          message: footerLinks('fr'),
          copyright: "PICKET est un projet communautaire indépendant, non affilié à Siege Camp.",
        },
        nav: [
          { text: t.fr.guide, link: '/fr/guide/getting-started' },
          { text: t.fr.selfHosting, link: '/fr/self-hosting/install' },
          { text: t.fr.contributing, link: '/fr/contributing/translating' },
          { text: 'Support', link: supportDiscord },
        ],
      },
    },
  },
});

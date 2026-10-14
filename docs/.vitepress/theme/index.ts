import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import Landing from './Landing.vue';
import LandingBackdrop from './LandingBackdrop.vue';
import ArchifyDiagram from './ArchifyDiagram.vue';
import type { Theme } from 'vitepress';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ArchifyDiagram', ArchifyDiagram);
  },
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-before': () => h(LandingBackdrop),
      'home-features-after': () => h(Landing),
    }),
} satisfies Theme;

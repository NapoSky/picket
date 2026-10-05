import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import Landing from './Landing.vue';
import LandingBackdrop from './LandingBackdrop.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-before': () => h(LandingBackdrop),
      'home-features-after': () => h(Landing),
    }),
};

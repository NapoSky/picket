<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

interface Module {
  name: string;
  text: string;
  link?: string;
  soon?: string;
}
interface Card {
  title: string;
  text: string;
  link: string;
}
interface LandingData {
  modules: { title: string; subtitle: string; items: Module[] };
  steps: { title: string; items: { title: string; text: string }[] };
  neutral: { title: string; text: string; swatches: { label: string; color: string }[] };
  cta: { title: string; text: string; cards: Card[] };
}

const { frontmatter } = useData();
const landing = computed(() => frontmatter.value['landing'] as LandingData | undefined);
</script>

<template>
  <div v-if="landing" class="picket-landing">
    <section class="picket-section">
      <h2>{{ landing.modules.title }}</h2>
      <p class="picket-lead">{{ landing.modules.subtitle }}</p>
      <div class="picket-grid picket-grid-4">
        <component
          :is="m.link ? 'a' : 'div'"
          v-for="m in landing.modules.items"
          :key="m.name"
          class="picket-card"
          :class="{ 'is-soon': m.soon }"
          :href="m.link ? withBase(m.link) : undefined"
        >
          <span v-if="m.soon" class="picket-badge">{{ m.soon }}</span>
          <h3>{{ m.name }}</h3>
          <p>{{ m.text }}</p>
        </component>
      </div>
    </section>

    <section class="picket-section">
      <h2>{{ landing.steps.title }}</h2>
      <ol class="picket-steps">
        <li v-for="(s, i) in landing.steps.items" :key="s.title">
          <span class="picket-step-n">{{ i + 1 }}</span>
          <h3>{{ s.title }}</h3>
          <p>{{ s.text }}</p>
        </li>
      </ol>
    </section>

    <section class="picket-section picket-neutral">
      <div>
        <h2>{{ landing.neutral.title }}</h2>
        <p class="picket-lead">{{ landing.neutral.text }}</p>
      </div>
      <ul class="picket-swatches">
        <li v-for="s in landing.neutral.swatches" :key="s.label">
          <span class="picket-swatch" :style="{ background: s.color }" />
          {{ s.label }}
        </li>
      </ul>
    </section>

    <section class="picket-section">
      <h2>{{ landing.cta.title }}</h2>
      <p class="picket-lead">{{ landing.cta.text }}</p>
      <div class="picket-grid picket-grid-3">
        <a v-for="c in landing.cta.cards" :key="c.title" class="picket-card" :href="withBase(c.link)">
          <h3>{{ c.title }}</h3>
          <p>{{ c.text }}</p>
        </a>
      </div>
    </section>
  </div>
</template>

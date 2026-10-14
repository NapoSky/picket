<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

const props = defineProps<{
  diagram: 'self-hosted' | 'data-lifecycle';
  title: string;
}>();
const { lang } = useData();
const french = computed(() => lang.value.startsWith('fr'));
const source = computed(() => withBase(`/diagrams/${french.value ? 'fr' : 'en'}/${props.diagram}.html`));
</script>

<template>
  <figure class="archify-diagram">
    <figcaption>
      <span>{{ title }}</span>
      <a :href="source" target="_blank" rel="noopener">
        {{ french ? 'Ouvrir en grand ↗' : 'Open full size ↗' }}
      </a>
    </figcaption>
    <iframe :src="source" :title="title" loading="lazy" />
    <p class="archify-help">
      {{ french
        ? 'Faites défiler le diagramme. Ses outils permettent de zoomer, rechercher et exporter une image.'
        : 'Scroll through the diagram. Its tools let you zoom, search and export an image.' }}
    </p>
  </figure>
</template>

<style scoped>
.archify-diagram {
  margin: 24px 0;
}
figcaption {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 10px;
  font-size: 14px;
}
figcaption span {
  font-weight: 600;
}
iframe {
  display: block;
  width: 100%;
  height: min(80vh, 840px);
  min-height: 480px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
}
.archify-help {
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.6;
}
</style>

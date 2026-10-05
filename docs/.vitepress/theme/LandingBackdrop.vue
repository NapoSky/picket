<script setup lang="ts">
import { withBase } from 'vitepress';

const style = { backgroundImage: `url(${withBase('/banner.jpg')})` };
</script>

<template>
  <div class="picket-backdrop" :style="style" aria-hidden="true" />
</template>

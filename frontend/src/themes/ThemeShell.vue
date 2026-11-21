<template>
  <component :is="layout" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getTheme } from './registry'

const layout = computed(() => getTheme('harbor').layout)
</script>

<template>
  <component :is="login" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getTheme } from './registry'

const login = computed(() => getTheme('harbor').login)
</script>

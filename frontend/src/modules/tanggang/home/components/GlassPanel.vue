<script setup lang="ts">
defineProps<{ title: string }>()
</script>
<template>
  <section class="glass-panel">
    <header class="panel-heading">
      <h2>{{ title }}</h2>
      <slot name="action" />
    </header>
    <slot />
  </section>
</template>

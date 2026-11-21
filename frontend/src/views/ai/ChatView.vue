<template>
  <AiChatPanel />
</template>

<script setup lang="ts">
import AiChatPanel from '@/components/AiChatPanel.vue'
</script>

<style scoped>
:deep(.ai-chat-panel) {
  height: calc(100vh - 120px);
}
</style>

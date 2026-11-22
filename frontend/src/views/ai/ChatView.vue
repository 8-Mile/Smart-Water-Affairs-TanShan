<template>
  <div class="ai-operations">
    <el-button @click="router.push('/port/water/supply')">供水推演</el-button>
    <el-button @click="router.push('/port/analysis/boards')">我的看板</el-button>
    <el-button @click="router.push('/port/analysis/reports')">运行复盘</el-button>
    <el-button v-if="hasPerm('eq:create')" @click="router.push('/port/analysis/equipment-drafts')">演示设备录入</el-button>
  </div>
  <AiChatPanel />
</template>

<script setup lang="ts">
import AiChatPanel from '@/components/AiChatPanel.vue'
import {useRouter} from 'vue-router'
import {usePermissions} from '@/utils/permissions'
const router=useRouter()
const {hasPerm}=usePermissions()
</script>

<style scoped>
:deep(.ai-chat-panel) {
  height: calc(100vh - 160px);
}
.ai-operations{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:7px;margin:0 0 8px}
</style>

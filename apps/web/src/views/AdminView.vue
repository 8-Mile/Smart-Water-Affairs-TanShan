<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AssetConfigPanel from "../components/admin/AssetConfigPanel.vue";
import PermissionMatrix from "../components/admin/PermissionMatrix.vue";
import ScenarioAuditPanel from "../components/admin/ScenarioAuditPanel.vue";
import TemplatePanel from "../components/admin/TemplatePanel.vue";

const route = useRoute();
const page = computed(() => String(route.name ?? ""));
</script>

<template>
  <PermissionMatrix v-if="page === 'admin-roles'" />
  <AssetConfigPanel v-else-if="page === 'admin-asset-config'" />
  <TemplatePanel v-else-if="page === 'admin-templates'" />
  <ScenarioAuditPanel v-else-if="page === 'admin-demo'" />
  <p v-else class="unknown-page">未识别的管理页面，请从系统管理菜单重新进入。</p>
</template>

<style scoped>
.unknown-page {
  margin: 0;
  padding: 14px;
  border: 1px dashed #dbe8f1;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
  font-size: 11.5px;
  color: #8296a8;
}
</style>

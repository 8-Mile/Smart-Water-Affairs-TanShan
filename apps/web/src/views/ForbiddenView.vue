<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import PlaceholderPanel from "../components/PlaceholderPanel.vue";
import { roleNames } from "../demo/permissions";
import { useDemoStore } from "../demo/store";

const route = useRoute();
const store = useDemoStore();
const from = computed(() =>
  typeof route.query.from === "string" ? route.query.from : "目标页面",
);
const permission = computed(() =>
  typeof route.query.permission === "string" ? route.query.permission : "read",
);
</script>

<template>
  <PlaceholderPanel
    title="当前角色无权限"
    :description="`角色「${roleNames[store.role]}」没有访问 ${from} 所需的 ${permission} 权限。此页面不会静默跳转，请切换角色或返回可访问页面。`"
    :items="[
      '系统管理仅对系统管理员开放',
      '只读访客只能浏览，写入命令会被拒绝并记录审计',
      '角色可在顶栏切换，菜单与按钮会即时更新',
    ]"
  >
    <RouterLink class="back-link" to="/overview">返回综合总览 →</RouterLink>
  </PlaceholderPanel>
</template>

<style scoped>
.back-link {
  display: inline-block;
  margin-top: 16px;
  font-size: 13px;
  color: #247ba8;
}
</style>

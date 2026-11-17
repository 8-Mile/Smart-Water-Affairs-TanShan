<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { NTag } from "naive-ui";
import AppHeader from "./components/layout/AppHeader.vue";
import AppSidebar from "./components/layout/AppSidebar.vue";
import { roleNames } from "./demo/permissions";
import { SCENARIO_NAMES } from "./demo/scenarioLabels";
import { useDemoStore } from "./demo/store";
import { useUiStore } from "./demo/ui";
import { navGroupLabel, navTitle } from "./navigation";

// 懒加载全局抽屉：路由首屏不加载AI解析器与设备趋势图依赖。
const GlobalAiDrawer = defineAsyncComponent(() => import("./components/GlobalAiDrawer.vue"));
const AssetDrawer = defineAsyncComponent(() => import("./components/AssetDrawer.vue"));

const store = useDemoStore();
const ui = useUiStore();
const route = useRoute();
const navOpen = ref(false);

const pageTitle = computed(() => {
  if (route.name === "process") return navTitle(route.path);
  return (route.meta.title as string | undefined) ?? navTitle(route.path);
});
const groupLabel = computed(() =>
  route.name === "process" ? "工艺监控" : navGroupLabel(route.path),
);
</script>

<template>
  <div class="app-shell panorama-shell" :class="{ 'overview-nav-open': navOpen }">
    <AppHeader :nav-open="navOpen" @toggle-nav="navOpen = !navOpen" />

    <div class="shell-body">
      <AppSidebar />

      <main class="main-area">
        <div class="page-head" :class="{ 'overview-page-title': route.name === 'overview' }">
          <div>
            <div class="eyebrow">智慧水务 / {{ groupLabel }}</div>
            <h1 v-if="route.name !== 'process-spray'" class="page-title">{{ pageTitle }}</h1>
          </div>
          <div class="page-meta">
            <NTag size="small" :bordered="false" type="info">
              {{ SCENARIO_NAMES[store.scenarioId] }}
            </NTag>
            <NTag size="small" :bordered="false">
              {{ roleNames[store.role] }}
            </NTag>
            <span class="seed">seed {{ store.seedVersion }}</span>
          </div>
        </div>
        <div class="content">
          <RouterLink
            v-if="typeof route.query.returnTo === 'string' && /^\/(?![\/\\])/.test(route.query.returnTo) && route.query.returnTo !== route.path"
            :to="route.query.returnTo"
          >
            返回来源页面
          </RouterLink>
          <RouterView />
        </div>
      </main>
    </div>

    <AssetDrawer v-if="ui.drawerAssetId" />

    <GlobalAiDrawer v-if="ui.aiOpen" />
  </div>
</template>

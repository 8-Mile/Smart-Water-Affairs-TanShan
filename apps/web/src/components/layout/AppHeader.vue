<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { NDropdown, NInput } from "naive-ui";
import OverviewIcon from "../overview/OverviewIcon.vue";
import LiveClock from "../overview/LiveClock.vue";
import { can, roleNames } from "../../demo/permissions";
import { SCENARIO_NAMES } from "../../demo/scenarioLabels";
import { useDemoStore } from "../../demo/store";
import {useDemoTour} from "../../demo/demoTour";
import { useUiStore } from "../../demo/ui";
import type { AiContext } from "../../demo/ui";
import type { Role } from "../../demo/types";
import { navTitle } from "../../navigation";

defineProps<{ navOpen: boolean }>();
const emit = defineEmits<{ toggleNav: [] }>();

const store = useDemoStore();
const demoTour=useDemoTour();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const ROLES: Role[] = ["manager", "duty", "engineer", "water", "admin", "viewer"];
const roleOptions = ROLES.map((role) => ({ value: role, label: roleNames[role] }));
const keyword = ref("");
const searchOpen = ref(false);

function searchScore(code: string, name: string, query: string): number {
  if (code === query) return 0;
  if (code.startsWith(query)) return 1;
  if (code.includes(query)) return 2;
  if (name.includes(query)) return 3;
  return 99;
}

const searchResults = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return [];
  return store.assets
    .filter((asset) => !asset.archived)
    .map((asset) => ({
      asset,
      score: searchScore(asset.code.toLowerCase(), asset.name.toLowerCase(), query),
    }))
    .filter((item) => item.score < 99)
    .sort((a, b) => a.score - b.score || a.asset.code.localeCompare(b.asset.code))
    .slice(0, 8)
    .map((item) => item.asset);
});

watch(
  () => route.path,
  () => {
    searchOpen.value = false;
    keyword.value = "";
  },
);

function openAsset(id: string): void {
  ui.openAsset(id);
  keyword.value = "";
  searchOpen.value = false;
}

function onSearchBlur(): void {
  window.setTimeout(() => {
    searchOpen.value = false;
  }, 150);
}

function changeRole(role: Role): void {
  store.setRole(role);
  const permission = route.meta.permission;
  if (permission && !can(role, permission)) {
    void router.replace({
      name: "forbidden",
      query: { from: route.fullPath, permission },
    });
  }
}

function askAi(): void {
  const queryAsset = typeof route.query.assetId === "string" ? route.query.assetId : undefined;
  const context: AiContext = {
    assetId: ui.drawerAssetId ?? queryAsset,
    subsystemId:
      typeof route.params.subsystemId === "string"
        ? route.params.subsystemId
        : undefined,
  };
  ui.openAi(context);
}
</script>

<template>
  <header class="topbar overview-topbar">
    <RouterLink to="/overview" class="overview-brand">
      <OverviewIcon name="logo" />
      <strong>唐山港京唐港区智慧水务平台</strong>
    </RouterLink>
    <span class="overview-subtitle">港区智慧水务一体化管理</span>
    <button type="button" class="overview-scene overview-demo-launch" aria-label="演示路线"
      @click="demoTour.launcherOpen=true">演示路线 · {{ SCENARIO_NAMES[store.scenarioId] }} <span aria-hidden="true">⌄</span></button>
    <div class="overview-topbar-spacer" />

    <div class="search-box overview-search" @focusout="onSearchBlur">
      <NInput
        v-model:value="keyword"
        placeholder="搜索设备编号或名称"
        size="small"
        round
        clearable
        @focus="searchOpen = true"
        @keydown.esc="searchOpen = false"
      />
      <div v-if="searchOpen && keyword.trim()" class="search-panel">
        <button
          v-for="asset in searchResults"
          :key="asset.id"
          type="button"
          class="search-item"
          @click="openAsset(asset.id)"
        >
          <strong>{{ asset.name }}</strong>
          <span>{{ asset.code }} · {{ navTitle(`/process/${asset.subsystemId}`) }}</span>
        </button>
        <p v-if="!searchResults.length" class="search-empty">
          未找到匹配设备，可尝试编号（如 P-002）
        </p>
      </div>
    </div>

    <div class="overview-weather" title="设计稿天气样例，未接入实时气象">
      <OverviewIcon name="weather" /><b>多云 6～14℃</b>
    </div>
    <button
      class="overview-menu-toggle"
      :aria-expanded="navOpen"
      aria-controls="primary-navigation"
      @click="emit('toggleNav')"
    >
      菜单
    </button>
    <LiveClock />
    <RouterLink to="/operations/alarms?status=active" class="overview-notification" aria-label="查看未处理告警">
      <OverviewIcon name="bell" /><b>{{ store.alarms.filter(a => a.status === "active").length }}</b>
    </RouterLink>
    <button class="overview-ai" aria-label="问 AI" @click="askAi">AI 助手</button>
    <NDropdown
      :options="roleOptions.map(o => ({ label: o.label, key: o.value }))"
      trigger="click"
      @select="(key: Role) => changeRole(key)"
    >
      <button class="overview-user" aria-label="切换演示角色">
        <OverviewIcon name="user" />
        <b>{{ store.role === "admin" ? "港区管理员" : roleNames[store.role] }}</b>
        <span>⌄</span>
      </button>
    </NDropdown>
  </header>
</template>

<style scoped>
.overview-demo-launch{border:1px solid #a4d0e2;cursor:pointer;display:inline-flex;align-items:center;gap:5px;background:#f3fbff;color:#317a9b;border-radius:6px;padding:5px 8px;font-weight:700}
.overview-demo-launch:hover{border-color:#6ab4d2;background:#e4f6fd}
.overview-demo-launch:focus-visible{outline:2px solid #247ba8;outline-offset:2px}
.overview-search { flex:0 1 230px; min-width:130px; max-width:260px; }
.overview-search :deep(.n-input) { border-radius:16px; background:#ffffffe6; box-shadow:0 1px 4px #2f7fc23d,inset 0 0 0 1px #a9d3f7; }
.overview-search :deep(.n-input .n-input__border),
.overview-search :deep(.n-input .n-input__state-border) { display:none; }
.overview-search .search-panel { top:38px; }
@media(max-width:1100px) {
  .overview-search { flex-basis:190px; }
}
@media(max-width:900px) {
  .overview-search { display:none; }
}
</style>

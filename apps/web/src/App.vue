<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { NTag } from "naive-ui";
import AppHeader from "./components/layout/AppHeader.vue";
import AppSidebar from "./components/layout/AppSidebar.vue";
import {useDemoTour,tourTarget} from "./demo/demoTour";
import { roleNames } from "./demo/permissions";
import { SCENARIO_NAMES } from "./demo/scenarioLabels";
import { useDemoStore } from "./demo/store";
import { useUiStore } from "./demo/ui";
import { navGroupLabel, navTitle } from "./navigation";

// 懒加载全局抽屉：路由首屏不加载AI解析器与设备趋势图依赖。
const GlobalAiDrawer = defineAsyncComponent(() => import("./components/GlobalAiDrawer.vue"));
const AssetDrawer = defineAsyncComponent(() => import("./components/AssetDrawer.vue"));
const DemoTourDock = defineAsyncComponent(() => import("./components/DemoTourDock.vue"));

const store = useDemoStore();
const ui = useUiStore();
const demoTour = useDemoTour();
const route = useRoute();
const navOpen = ref(false);
const tourStageLocation=computed(()=>{
 if(!demoTour.record||!demoTour.step||route.name==="overview")return null;
 const candidateId=typeof route.query.supplyDraftId==="string"?route.query.supplyDraftId:undefined;
 const target=tourTarget(demoTour.step.id,candidateId);
 return {onTarget:!!target&&route.path===target.path,
  index:demoTour.record.step+1,total:demoTour.definition?.steps.length??0,
  name:demoTour.step.name,flow:demoTour.definition?.label??"",
  context:demoTour.step.context};
});

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
          <div v-if="tourStageLocation" class="demo-stage-ribbon"
            :class="{offstage:!tourStageLocation.onTarget}" aria-label="本轮演示页面指引">
            <div class="stage-ribbon-index">{{ tourStageLocation.index }}/{{ tourStageLocation.total }}</div>
            <div class="stage-ribbon-copy">
              <strong>{{ tourStageLocation.flow }} · {{ tourStageLocation.name }}</strong>
              <span>{{ tourStageLocation.onTarget?tourStageLocation.context:'当前为补充页面；可通过演示导览返回本步目标页面。' }}</span>
            </div>
            <button type="button" @click="demoTour.minimized=false">展开演示步骤</button>
          </div>
          <RouterView />
        </div>
      </main>
    </div>

    <AssetDrawer v-if="ui.drawerAssetId" />

    <GlobalAiDrawer v-if="ui.aiOpen" />
    <DemoTourDock v-if="demoTour.record || demoTour.launcherOpen" />
    <button v-if="!demoTour.record && !demoTour.launcherOpen" type="button"
      class="tour-mobile-launcher" @click="demoTour.launcherOpen=true">演示路线</button>
  </div>
</template>
<style scoped>
.demo-stage-ribbon{display:flex;gap:11px;align-items:center;min-width:0;
  margin:0 0 11px;padding:9px 12px;background:linear-gradient(100deg,#e5f4fa,#f7fcff);
  color:#326980;border-radius:8px;border:1px solid #c7e4ef}
.demo-stage-ribbon.offstage{background:#fff9f0;border-color:#eadbc5}
.stage-ribbon-index{flex:none;display:grid;place-items:center;font-weight:800;
  font-size:12px;color:#fff;background:#247a9c;border-radius:6px;min-width:42px;height:34px}
.stage-ribbon-copy{display:grid;gap:3px;flex:1;min-width:0}
.stage-ribbon-copy strong{font-size:12px;color:#246784}
.stage-ribbon-copy span{font-size:10px;color:#718d9e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.demo-stage-ribbon button{flex:none;padding:6px 9px;background:white;color:#257595;
  border:1px solid #a9d4e5;border-radius:6px;font-size:11px;cursor:pointer}
@media(max-width:670px){
  .demo-stage-ribbon{gap:8px;padding:8px}
  .stage-ribbon-copy span{display:none}
  .demo-stage-ribbon button{font-size:10px;padding:5px}
}
.tour-mobile-launcher{display:none}
@media(max-width:900px){
  .tour-mobile-launcher{
    display:block;position:fixed;z-index:3500;right:12px;bottom:14px;
    border:1px solid #90c9df;background:#eefaff;color:#24769a;
    font-size:11px;border-radius:9px;padding:10px 13px;
    box-shadow:0 4px 16px #163e5455;cursor:pointer
  }
}
</style>

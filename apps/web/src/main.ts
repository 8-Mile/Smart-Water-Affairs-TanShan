import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import App from "./Root.vue";
import "virtual:uno.css";
import "./style.css";
import { can } from "./demo/permissions";
import type { Action } from "./demo/permissions";
import { useDemoStore } from "./demo/store";

declare module "vue-router" {
  interface RouteMeta {
    permission?: Action;
    title?: string;
  }
}

const read: Action = "process:read";

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/overview" },
  {
    path: "/overview",
    name: "overview",
    component: () => import("./views/Overview.vue"),
    meta: { title: "综合总览", permission: read },
  },
  {
    path: "/operations/events",
    name: "event-center",
    component: () => import("./views/EventCenterView.vue"),
    meta: { title: "值守与事件中心", permission: read },
  },
  {
    path: "/process/spray",
    name: "process-spray",
    component: () => import("./views/SprayProcessView.vue"),
    meta: { title: "射雾器除尘", permission: read },
  },
  {
    path: "/process/:subsystemId",
    name: "process",
    component: () => import("./views/ProcessView.vue"),
    meta: { title: "工艺监控", permission: read },
  },
  { path: "/intelligent/unattended", name: "unattended", component: () => import("./views/UnattendedView.vue"),
    meta: { title: "集中值守中心", permission: read } },
  { path: "/intelligent/correlation", name: "correlation", component: () => import("./views/CorrelationView.vue"),
    meta: { title: "跨系统关联处置", permission: read } },
  { path: "/engineering/registry", name: "engineering",
    component: () => import("./views/EngineeringView.vue"),
    meta: { title: "工程核查与证据", permission: read } },
  { path: "/water/port-chain", name: "port-chain",
    component: () => import("./views/PortChainView.vue"),
    meta: { title: "港口环保水业务链", permission: read } },
  {
    path: "/water/overview",
    name: "water-overview",
    component: () => import("./views/WaterView.vue"),
    meta: { title: "水资源总览", permission: read },
  },
  { path: "/water/dispatch", name: "water-dispatch", component: () => import("./views/WaterDispatchView.vue"),
    meta: { title: "智能调蓄决策", permission: read } },
  { path: "/water/multi-source", name: "multi-source", component: () => import("./views/MultiSourceView.vue"),
    meta: { title: "多水源协同优化", permission: read } },
  { path: "/water/green-benefit", name: "green-benefit",
    component: () => import("./views/GreenBenefitView.vue"),
    meta: { title: "绿色运营效益核算", permission: read } },
  {
    path: "/water/ledger",
    name: "water-ledger",
    component: () => import("./views/WaterView.vue"),
    meta: { title: "水量账本", permission: read },
  },
  {
    path: "/water/rainfall",
    name: "water-rainfall",
    component: () => import("./views/WaterView.vue"),
    meta: { title: "雨次分析", permission: read },
  },
  {
    path: "/decision/health",
    name: "health",
    component: () => import("./views/HealthView.vue"),
    meta: { title: "健康与能效", permission: read },
  },
  { path: "/decision/knowledge", name: "knowledge", component: () => import("./views/KnowledgeView.vue"),
    meta: { title: "证据知识与诊断", permission: read } },
  {
    path: "/decision/four-pre",
    name: "four-pre",
    component: () => import("./views/FourPreView.vue"),
    meta: { title: "微观四预", permission: read },
  },
  {
    path: "/archives",
    name: "archives",
    component: () => import("./views/AssetsView.vue"),
    meta: { title: "档案管理", permission: read },
  },
  {
    path: "/operations/asset-workspace",
    name: "asset-workspace",
    component: () => import("./views/AssetWorkspaceView.vue"),
    meta: { title: "设备统一工作台", permission: read },
  },
  {
    path: "/operations/assets",
    name: "assets",
    component: () => import("./views/AssetsView.vue"),
    meta: { title: "设备台账", permission: read },
  },
  {
    path: "/operations/alarms",
    name: "alarms",
    component: () => import("./views/AlarmsView.vue"),
    meta: { title: "告警事件", permission: read },
  },
  {
    path: "/operations/workorders",
    name: "workorders",
    component: () => import("./views/WorkOrdersView.vue"),
    meta: { title: "工单任务", permission: read },
  },
  {
    path: "/data/reports",
    name: "reports",
    component: () => import("./views/ReportsView.vue"),
    meta: { title: "常用报表", permission: read },
  },
  {
    path: "/data/ai-workspace",
    name: "ai-workspace",
    component: () => import("./views/WorkspaceView.vue"),
    meta: { title: "AI 分析工作台", permission: read },
  },
  {
    path: "/data/my-dashboards",
    name: "my-dashboards",
    component: () => import("./views/DashboardsView.vue"),
    meta: { title: "我的看板", permission: read },
  },
  {
    path: "/admin/roles",
    name: "admin-roles",
    component: () => import("./views/AdminView.vue"),
    meta: { title: "角色权限", permission: "admin:write" },
  },
  {
    path: "/admin/asset-config",
    name: "admin-asset-config",
    component: () => import("./views/AdminView.vue"),
    meta: { title: "设备配置", permission: "admin:write" },
  },
  {
    path: "/admin/templates",
    name: "admin-templates",
    component: () => import("./views/AdminView.vue"),
    meta: { title: "页面模板", permission: "admin:write" },
  },
  {
    path: "/admin/demo",
    name: "admin-demo",
    component: () => import("./views/AdminView.vue"),
    meta: { title: "场景与操作日志", permission: "admin:write" },
  },
  {
    path: "/forbidden",
    name: "forbidden",
    component: () => import("./views/ForbiddenView.vue"),
    meta: { title: "当前角色无权限" },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("./views/NotFound.vue"),
    meta: { title: "页面不存在" },
  },
];

const pinia = createPinia();
const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const permission = to.meta.permission;
  if (!permission) return true;
  const demo = useDemoStore(pinia);
  if (can(demo.role, permission)) return true;
  return {
    name: "forbidden",
    query: { from: to.fullPath, permission },
  };
});

createApp(App).use(pinia).use(router).mount("#app");

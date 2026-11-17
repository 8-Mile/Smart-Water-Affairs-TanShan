import type { Action } from "./demo/permissions";

export interface NavChild {
  label: string;
  to: string;
  permission: Action;
}

export interface NavGroup {
  id: string;
  label: string;
  to?: string;
  permission: Action;
  children?: NavChild[];
}

const read = "process:read" as const;

export const SUBSYSTEM_NAV: NavChild[] = [
  { label: "射雾器除尘", to: "/process/spray", permission: read },
  { label: "中压供水", to: "/process/medium-pressure", permission: read },
  { label: "含矿污水处理", to: "/process/mining", permission: read },
  { label: "雨水收集", to: "/process/rainwater", permission: read },
  { label: "水池供水", to: "/process/pool", permission: read },
  { label: "生活污水外送管理", to: "/process/domestic", permission: read },
];

export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "综合总览", to: "/overview", permission: read },
  {
    id: "business", label: "港口核心业务", permission: read,
    children: [
      { label: "污染水处理与回用业务链", to: "/water/port-chain", permission: read },
      { label: "环保供水异常协同", to: "/intelligent/correlation", permission: read },
    ],
  },
  { id: "process", label: "工艺监控", permission: read, children: SUBSYSTEM_NAV },
  {
    id: "intelligent", label: "智能运行", permission: read,
    children: [
      { label: "集中值守中心", to: "/intelligent/unattended", permission: read },
      { label: "设备健康与能效", to: "/decision/health", permission: read },
      { label: "知识与证据诊断", to: "/decision/knowledge", permission: read },
      { label: "微观四预", to: "/decision/four-pre", permission: read },
    ],
  },
  {
    id: "operations", label: "设备与运维", permission: read,
    children: [
      { label: "设备台账", to: "/operations/assets", permission: read },
      { label: "告警事件", to: "/operations/alarms", permission: read },
      { label: "工单任务", to: "/operations/workorders", permission: read },
      { label: "档案管理", to: "/archives", permission: read },
    ],
  },
  {
    id: "engineering", label: "工程基础", permission: read,
    children: [{ label: "工程核查与证据", to: "/engineering/registry", permission: read }],
  },
  {
    id: "water", label: "水资源管理", permission: read,
    children: [
      { label: "水资源总览", to: "/water/overview", permission: read },
      { label: "雨次分析", to: "/water/rainfall", permission: read },
      { label: "智能调蓄决策", to: "/water/dispatch", permission: read },
      { label: "水量账本", to: "/water/ledger", permission: read },
      { label: "多水源协同优化", to: "/water/multi-source", permission: read },
      { label: "绿色运营效益核算", to: "/water/green-benefit", permission: read },
    ],
  },
  {
    id: "data", label: "分析与看板", permission: read,
    children: [
      { label: "常用报表", to: "/data/reports", permission: read },
      { label: "AI 分析工作台", to: "/data/ai-workspace", permission: read },
      { label: "我的看板", to: "/data/my-dashboards", permission: read },
    ],
  },
  {
    id: "admin", label: "系统管理", permission: "admin:write",
    children: [
      { label: "角色权限", to: "/admin/roles", permission: "admin:write" },
      { label: "设备配置", to: "/admin/asset-config", permission: "admin:write" },
      { label: "页面模板", to: "/admin/templates", permission: "admin:write" },
      { label: "场景与操作日志", to: "/admin/demo", permission: "admin:write" },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/archives": "档案管理",
  "/overview": "综合总览",
  "/intelligent/unattended": "集中值守中心",
  "/intelligent/correlation": "跨系统关联处置",
  "/engineering/registry": "工程核查与证据",
  "/water/port-chain": "港口环保水业务链",
  "/water/overview": "水资源总览",
  "/water/dispatch": "智能调蓄决策",
  "/water/multi-source": "多水源协同优化",
  "/water/green-benefit": "绿色运营效益核算",
  "/water/ledger": "水量账本",
  "/water/rainfall": "雨次分析",
  "/decision/health": "健康与能效",
  "/decision/knowledge": "证据知识与诊断",
  "/decision/four-pre": "微观四预",
  "/operations/assets": "设备台账",
  "/operations/alarms": "告警事件",
  "/operations/workorders": "工单任务",
  "/data/reports": "常用报表",
  "/data/ai-workspace": "AI 分析工作台",
  "/data/my-dashboards": "我的看板",
  "/admin/roles": "角色权限",
  "/admin/asset-config": "设备配置",
  "/admin/templates": "页面模板",
  "/admin/demo": "场景与操作日志",
};

export function navTitle(path: string): string {
  if (path.startsWith("/process/")) {
    return (
      SUBSYSTEM_NAV.find((item) => item.to === path)?.label ?? "工艺监控"
    );
  }
  return TITLES[path] ?? "页面不存在";
}

export function navGroupLabel(path: string): string {
  const group = NAV_GROUPS.find(
    (item) => item.to === path || item.children?.some((child) => child.to === path),
  );
  return group?.label ?? "智慧水务";
}

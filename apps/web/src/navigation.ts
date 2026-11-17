import type { Action } from "./demo/permissions";

export interface NavChild {
  label: string;
  to: string;
  permission: Action;
  /** Compatible legacy locations; keep routes working while consolidating menu entries. */
  aliases?: string[];
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
    id: "running", label: "运行中心", permission: read,
    children: [
      { label: "值守与事件中心", to: "/operations/events", permission: read,
        aliases: ["/operations/alarms", "/intelligent/unattended", "/intelligent/correlation"] },
      { label: "港口水务业务链", to: "/water/port-chain", permission: read },
    ],
  },
  { id: "process", label: "工艺监控", permission: read, children: SUBSYSTEM_NAV },
  {
    id: "operations", label: "设备运维", permission: read,
    children: [
      { label: "设备与档案", to: "/operations/assets", permission: read, aliases: ["/archives", "/operations/asset-workspace"] },
      { label: "工单与巡检", to: "/operations/workorders", permission: read },
      { label: "健康与能效", to: "/decision/health", permission: read },
      { label: "工程底账", to: "/engineering/registry", permission: read },
    ],
  },
  {
    id: "water", label: "水资源管理", permission: read,
    children: [
      { label: "水资源总览", to: "/water/overview", permission: read,
        aliases: ["/water/rainfall", "/water/ledger"] },
      { label: "调蓄与四预", to: "/water/dispatch", permission: read,
        aliases: ["/decision/four-pre"] },
      { label: "水源优化与效益", to: "/water/multi-source", permission: read,
        aliases: ["/water/green-benefit"] },
    ],
  },
  {
    id: "data", label: "分析中心", permission: read,
    children: [
      { label: "报表与交接班", to: "/data/reports", permission: read },
      { label: "AI 工作台与看板", to: "/data/ai-workspace", permission: read,
        aliases: ["/data/my-dashboards"] },
      { label: "知识与证据", to: "/decision/knowledge", permission: read },
    ],
  },
  {
    id: "admin", label: "系统设置", permission: "admin:write",
    children: [
      { label: "管理工作台", to: "/admin/roles", permission: "admin:write",
        aliases: ["/admin/asset-config", "/admin/templates", "/admin/demo"] },
    ],
  },
];

/** Determines active category for both new and historic routes. */
export function navGroupForPath(path: string): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.to === path ||
    group.children?.some((child) => child.to === path || child.aliases?.includes(path)));
}

export function navChildForPath(path: string): NavChild | undefined {
  return NAV_GROUPS.flatMap((group) => group.children ?? [])
    .find((child) => child.to === path || child.aliases?.includes(path));
}

const TITLES: Record<string, string> = {
  "/archives": "档案管理",
  "/overview": "综合总览",
  "/operations/events": "值守与事件中心",
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
  "/operations/asset-workspace": "设备统一工作台",
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
  return navGroupForPath(path)?.label ?? "智慧水务";
}

import { z } from "zod";
export const roles = [
  "manager",
  "duty",
  "engineer",
  "water",
  "admin",
  "viewer",
  "demo",
] as const;
export type Role = (typeof roles)[number];
export const scenarios = [
  "SCN-BASE",
  "SCN-RAIN",
  "SCN-PUMP",
  "SCN-MINE",
] as const;
export type ScenarioId = (typeof scenarios)[number];
export const scenarioNames: Record<ScenarioId, string> = {
  "SCN-BASE": "正常运行",
  "SCN-RAIN": "连续降雨",
  "SCN-PUMP": "泵组异常",
  "SCN-MINE": "污水负荷",
};
export const roleNames: Record<Role, string> = {
  manager: "管理者",
  duty: "运行值班员",
  engineer: "设备运维",
  water: "水资源人员",
  admin: "平台管理员",
  viewer: "只读访客",
  demo: "演示主持人",
};
export type Permission =
  | "process:read"
  | "alarm:ack"
  | "workorder:create"
  | "workorder:handle"
  | "workorder:review"
  | "dashboard:write"
  | "scenario:write"
  | "admin:write"
  | "audit:read"
  | "decision:run";
export const permissions: Record<Role, readonly Permission[]> = {
  manager: [
    "process:read",
    "workorder:review",
    "dashboard:write",
    "decision:run",
  ],
  duty: ["process:read", "alarm:ack", "workorder:create", "dashboard:write"],
  engineer: ["process:read", "workorder:handle", "dashboard:write"],
  water: [
    "process:read",
    "workorder:create",
    "dashboard:write",
    "decision:run",
  ],
  admin: [
    "process:read",
    "admin:write",
    "audit:read",
    "scenario:write",
    "dashboard:write",
  ],
  viewer: ["process:read"],
  demo: ["process:read", "scenario:write"],
};
export const roleScopes: Record<Role, readonly string[]> = {
  manager: ["north", "south"],
  duty: ["north"],
  engineer: ["north"],
  water: ["north", "south"],
  admin: ["north", "south"],
  viewer: ["north"],
  demo: ["north", "south"],
};
export const asOf = "2026-11-14T08:00:00+08:00";
export const processes = [
  {
    id: "spray",
    name: "射雾器除尘",
    metric: "运行台数",
    unit: "台",
    base: 12,
    description: "作业区域、设备状态与低压事件",
  },
  {
    id: "medium-pressure",
    name: "中压供水",
    metric: "出口压力",
    unit: "MPa",
    base: 0.65,
    description: "泵组压力、流量与同工况能效",
  },
  {
    id: "mining",
    name: "含矿污水处理",
    metric: "模拟处理流量",
    unit: "m³/h",
    base: 320,
    description: "处理负荷、监测状态与回用关联",
  },
  {
    id: "rainwater",
    name: "雨水收集",
    metric: "模拟储水量",
    unit: "m³",
    base: 4200,
    description: "南北雨次、储量变化与轻量四预",
  },
  {
    id: "pool",
    name: "水池供水",
    metric: "模拟可用水量",
    unit: "m³",
    base: 2800,
    description: "补水来源、供需关系与保障估算",
  },
  {
    id: "domestic",
    name: "生活污水处理",
    metric: "模拟处理流量",
    unit: "m³/h",
    base: 18,
    description: "处理单元结构示意；详细工艺待确认",
  },
] as const;

export type ProcessId = (typeof processes)[number]["id"];
export interface Meta {
  dataMode: "SIM" | "REF" | "CALC" | "AI";
  scenarioId: ScenarioId;
  asOf: string;
  quality: string;
  metricCode?: string;
  unit?: string;
  formulaVersion?: string;
  assumptions?: string[];
  inputRefs?: string[];
}
export interface ProcessSummary extends Meta {
  id: string;
  name: string;
  metric: string;
  unit: string;
  value: number;
  description: string;
  status: string;
  metrics: { label: string; value: number | null; unit: string }[];
}
export interface ApiResult<T> {
  result: T;
  requestId: string;
  meta: Meta;
}
export interface User {
  id: string;
  role: Role;
  name: string;
  scopes: readonly string[];
  permissions: readonly Permission[];
}
export interface Asset {
  id: string;
  name: string;
  subsystemId: ProcessId;
  area: string;
  type: string;
  status: string;
  volume: number | null;
  energy: number | null;
  runtime: number;
  pressure: number | null;
  faults: number;
  condition: string;
  monitoring: string;
  healthTelemetry?: HealthTelemetry;
}
export interface MetricRow {
  label: string;
  area: string;
  value: number | null;
  energy: number | null;
}
export const alarmStatuses = [
  "new",
  "acknowledged",
  "handling",
  "recovered",
  "closed",
] as const;
export const workStatuses = [
  "draft",
  "submitted",
  "assigned",
  "in_progress",
  "pending_review",
  "closed",
  "cancelled",
] as const;
export interface Timeline {
  at: string;
  actor: string;
  action: string;
  note: string;
}
export interface Alarm {
  id: string;
  assetId: string;
  title: string;
  level: "重要" | "一般";
  status: (typeof alarmStatuses)[number];
  history: Timeline[];
}
export interface WorkOrder {
  id: string;
  assetId: string;
  eventId: string | null;
  title: string;
  description: string;
  assignee: string | null;
  createdBy: string;
  status: (typeof workStatuses)[number];
  history: Timeline[];
  version: number;
}
export interface ScenarioState {
  id: ScenarioId;
  epoch: number;
  assets: Asset[];
  alarms: Alarm[];
  workorders: WorkOrder[];
}
export interface Audit {
  id: string;
  at: string;
  actor: string;
  action: string;
  resource: string;
  detail: string;
}
export const WidgetSchema = z
  .object({
    id: z.string().min(1).max(60),
    type: z.enum([
      "KpiCard",
      "LineChart",
      "BarChart",
      "DualAxisChart",
      "DataTable",
      "TextSummary",
      "AlertList",
    ]),
    title: z.string().min(1).max(100),
    dataset: z.enum(["rain", "energy", "alarms"]),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(100),
    w: z.number().int().min(2).max(12),
    h: z.number().int().min(2).max(10),
    locked: z.boolean().default(false),
    sort: z.enum(["default", "asc", "desc"]).default("default"),
    average: z.boolean().default(false),
    columns: z
      .array(z.enum(["label", "area", "value", "energy"]))
      .min(1)
      .default(["label", "area", "value"]),
  })
  .strict();
export const DashboardSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    title: z.string().min(1).max(100),
    widgets: z.array(WidgetSchema).min(1).max(16),
    areas: z.array(z.enum(["north", "south"])).min(1),
    range: z.enum(["latest3", "latest2"]).default("latest3"),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (new Set(s.widgets.map((w) => w.id)).size !== s.widgets.length)
      ctx.addIssue({ code: "custom", message: "组件 ID 重复" });
    for (const w of s.widgets)
      if (w.x + w.w > 12)
        ctx.addIssue({ code: "custom", message: "组件超出网格边界" });
  });
export type DashboardLayout = z.infer<typeof DashboardSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export interface Dashboard {
  id: string;
  ownerId: string;
  version: number;
  layout: DashboardLayout;
  history: { version: number; layout: DashboardLayout; at: string }[];
}
export interface AiTask {
  id: string;
  ownerId: string;
  scenarioId: ScenarioId;
  epoch: number;
  status:
    "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  mode: "规则/预置模板" | "模型";
  prompt: string;
  modelVersion: string;
  steps: { tool: string; status: string; detail: string }[];
  output: string;
  layout?: DashboardLayout;
  workorderId?: string;
  createdAt: string;
}
export const RainInput = z
  .object({
    rainMm: z.number().min(0).max(500),
    areaM2: z.number().min(1).max(10000000),
    coefficient: z.number().min(0).max(1),
    initial: z.number().min(0),
    capacity: z.number().positive().max(1000000),
    outflow: z.number().min(0).max(10000),
    hours: z.number().int().min(1).max(72),
  })
  .strict()
  .refine((x) => x.initial <= x.capacity, { message: "初始储量不能大于容量" });
export type RainParams = z.infer<typeof RainInput>;
export interface RainResult {
  points: { hour: number; volume: number; overflow: number; outflow: number }[];
  peak: number;
  overflow: number;
  totalInflow: number;
  totalOutflow: number;
  firstRiskHour: number | null;
  formula: string;
  assumptions: string[];
}
export type HealthMode = "normal" | "degrading" | "recovered";
export interface HealthSample {
  at: string;
  vibration: number | null;
  temperature: number | null;
  current: number | null;
  operating: boolean;
}
export interface HealthTelemetry {
  mode: HealthMode;
  starts: number;
  maintenanceAt?: string;
  samples: HealthSample[];
}
export interface HealthFactor {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  start: number;
  limit: number;
  weight: number;
  deduction: number | null;
}
export interface HealthTrend {
  key: "vibration" | "temperature" | "current";
  label: string;
  unit: string;
  threshold: number;
  slope: number | null;
  hoursToThreshold: number | null;
  status: string;
  points: { hour: number; value: number }[];
}
export interface Health {
  grade: string;
  formulaVersion: string;
  dataMode: "SIM";
  mode: HealthMode | null;
  evaluatedAt: string | null;
  factors: HealthFactor[];
  history: (HealthSample & { score: number | null })[];
  trends: HealthTrend[];
  forecastSummary: string;
  advice: string;
  maintenanceAt: string | null;
  assetId: string;
  name: string;
  score: number | null;
  specificEnergy: number | null;
  confidence: string;
  reasons: string[];
  comparable: boolean;
}
export interface AppData {
  user: User;
  scenarioId: ScenarioId;
  epoch: number;
  features: Record<string, boolean>;
  subsystems: ProcessSummary[];
  assets: Asset[];
  alarms: Alarm[];
  workorders: WorkOrder[];
  kpis: { label: string; value: string; formula: string }[];
  ledger: {
    id: string;
    source: string;
    inflow: number;
    consumption: number;
    storageChange: number;
    tap: number;
    rainwater: number;
    reclaimed: number;
    note: string;
  }[];
  rain: MetricRow[];
  health: Health[];
  templates: { id: string; title: string; layout: DashboardLayout }[];
  modelConfigured: boolean;
}
export function defaultLayout(areas: readonly string[]): DashboardLayout {
  return {
    schemaVersion: "1.0",
    title: "我的雨水分析",
    areas: areas as ("north" | "south")[],
    range: "latest3",
    widgets: [
      {
        id: "safety",
        type: "AlertList",
        title: "关键告警（锁定）",
        dataset: "alarms",
        x: 0,
        y: 0,
        w: 12,
        h: 2,
        locked: true,
        sort: "default",
        average: false,
        columns: ["label", "value"],
      },
      {
        id: "rain-chart",
        type: "BarChart",
        title: "最近三次降雨收水量",
        dataset: "rain",
        x: 0,
        y: 2,
        w: 8,
        h: 4,
        locked: false,
        sort: "default",
        average: false,
        columns: ["label", "area", "value"],
      },
    ],
  };
}

export const metricDefinitions = [
  {
    code: "water.terminal_m3",
    name: "终端用水量",
    unit: "m³",
    formula: "授权区域终端消耗合计",
    source: "SIM",
  },
  {
    code: "rain.collected_m3",
    name: "雨次收水量",
    unit: "m³",
    formula: "按雨次及区域查询固定种子",
    source: "SIM",
  },
  {
    code: "pump.specific_kwh_m3",
    name: "单位水电耗",
    unit: "kWh/m³",
    formula: "energy_kwh / volume_m3；缺项或零分母不可计算",
    source: "CALC",
  },
  {
    code: "alarm.open_count",
    name: "待处置事件",
    unit: "条",
    formula: "授权范围内 status != closed",
    source: "CALC",
  },
  {
    code: "pool.supply_hours",
    name: "供水保障估算",
    unit: "h",
    formula: "max(0,storage-reserve)/demand",
    source: "CALC",
  },
] as const;
export const SupplyInput = z
  .object({
    storage: z.number().min(0).max(1000000),
    reserve: z.number().min(0).max(1000000),
    demand: z.number().positive().max(10000),
  })
  .strict()
  .refine((p) => p.reserve <= p.storage, {
    message: "保留储量不能超过当前储量",
  });

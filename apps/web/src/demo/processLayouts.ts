import { rainStorage as pairedRainStorage } from "./water";
import type {
  Alarm,
  Asset,
  DataSource,
  MeasurePoint,
  RainEvent,
  TelemetrySample,
} from "./types";

/**
 * 六工艺示意底图与指标口径。
 * 坐标统一为 0~1 归一化值，与 ProcessBinding 的 xPct/yPct 同坐标系。
 * 底图只表达工艺单元与管线走向，不代表真实管网拓扑，也不代表设备清单。
 */

export type ProcessBlockKind = "tank" | "unit" | "building" | "yard" | "outfall";

export interface ProcessBlock {
  id: string;
  label: string;
  kind: ProcessBlockKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProcessPipe {
  d: string;
  dashed?: boolean;
}

export interface MetricContext {
  /** 当前子系统的在用设备（已过滤归档）。 */
  assets: Asset[];
  /** 当前子系统的活动告警。 */
  alarms: Alarm[];
  /** 全局雨次数据。 */
  rainEvents: RainEvent[];
  latest(pointId: string): TelemetrySample | null;
  pointsOf(assetId: string): MeasurePoint[];
}

export type MetricValue = number | string | null;

export interface ProcessMetric {
  id: string;
  label: string;
  unit: string;
  /** 计算口径，直接展示给用户。 */
  formula: string;
  source: DataSource;
  value(ctx: MetricContext): MetricValue;
  hint?(ctx: MetricContext): string;
}

export interface ProcessLayout {
  subsystemId: string;
  title: string;
  /** 与子系统描述互补的差异化说明。 */
  tagline: string;
  /** 管线与工艺流向说明。 */
  flowCaption: string;
  accent: string;
  blocks: ProcessBlock[];
  pipes: ProcessPipe[];
  keyCategories: string[];
  aiQuestions: string[];
  metrics: ProcessMetric[];
}

function numericLatest(
  ctx: MetricContext,
  asset: Asset,
  keyword: string,
): number | null {
  const point = ctx
    .pointsOf(asset.id)
    .find((item) => item.kind === "number" && item.label.includes(keyword));
  if (!point) return null;
  const sample = ctx.latest(point.id);
  return sample && typeof sample.value === "number" ? sample.value : null;
}

function average(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function total(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0);
}

function running(assets: Asset[]): Asset[] {
  return assets.filter((asset) => asset.status === "running");
}

function countBy(assets: Asset[], status: Asset["status"]): number {
  return assets.filter((asset) => asset.status === status).length;
}

function statusText(asset: Asset | undefined): string | null {
  if (!asset) return null;
  switch (asset.status) {
    case "running":
      return "补水中";
    case "stopped":
      return "未补水（停机）";
    case "fault":
      return "补水异常";
    default:
      return "状态未知";
  }
}

function lastRainEvent(ctx: MetricContext): RainEvent | undefined {
  return ctx.rainEvents[ctx.rainEvents.length - 1];
}

function rainStorage(event: RainEvent | undefined): number | null {
  return pairedRainStorage(event).end?.total ?? null;
}

const spray: ProcessLayout = {
  subsystemId: "spray",
  title: "射雾器除尘",
  tagline: "堆场抑尘以压力水为主，关注末端压力、运行台数与喷射流量",
  flowCaption:
    "蓄水池经加压泵房向堆场主水管供水，各射雾器由支管取水；工艺图只表达工艺关系与流向，非真实管网拓扑。",
  accent: "#3f8fb0",
  blocks: [
    { id: "s-tank", label: "蓄水池", kind: "tank", x: 0.02, y: 0.05, w: 0.15, h: 0.16 },
    { id: "s-pump", label: "加压泵房", kind: "building", x: 0.02, y: 0.26, w: 0.12, h: 0.16 },
    { id: "s-yard-a", label: "堆场 A 区", kind: "yard", x: 0.2, y: 0.5, w: 0.34, h: 0.32 },
    { id: "s-yard-b", label: "堆场 B 区", kind: "yard", x: 0.58, y: 0.54, w: 0.36, h: 0.3 },
    { id: "s-control", label: "控制室", kind: "unit", x: 0.76, y: 0.06, w: 0.2, h: 0.14 },
  ],
  pipes: [
    { d: "M9.5 21 V26" },
    { d: "M17 34 H97" },
    { d: "M16 34 V32" },
    { d: "M38 34 V30" },
    { d: "M58 34 V36" },
    { d: "M78 34 V40" },
    { d: "M27 34 V50", dashed: true },
    { d: "M72 34 V54", dashed: true },
  ],
  keyCategories: ["射雾器", "加压泵组", "主水管", "堆场支管"],
  aiQuestions: [
    "本系统当前有哪些射雾器停机？",
    "最近 24 小时末端压力是否稳定？",
    "射雾器喷嘴清洗应参考哪份档案？",
  ],
  metrics: [
    {
      id: "spray-running",
      label: "运行射雾器",
      unit: "台",
      formula: "status=running 的射雾器数量",
      source: "CALCULATED",
      value: (ctx) => running(ctx.assets).length,
      hint: (ctx) =>
        `共 ${ctx.assets.length} 台，停机 ${countBy(ctx.assets, "stopped")} 台`,
    },
    {
      id: "spray-pressure",
      label: "末端压力均值",
      unit: "MPa",
      formula:
        "各射雾器「末端压力」测点最新有效值平均，缺测不参与；无有效数据时显示缺数，不以 0 代替。演示阈值 0.45 MPa 为可配置参数，非厂家规定值。",
      source: "CALCULATED",
      value: (ctx) =>
        average(ctx.assets.map((asset) => numericLatest(ctx, asset, "压力"))),
      hint: (ctx) => {
        const covered = ctx.assets.filter(
          (asset) => numericLatest(ctx, asset, "压力") !== null,
        ).length;
        return `有效测点 ${covered}/${ctx.assets.length} 台，采样周期 30 分钟`;
      },
    },
    {
      id: "spray-flow",
      label: "瞬时喷射流量",
      unit: "m³/h",
      formula:
        "仅累加 status=running 且喷射流量测点有效的射雾器；缺数不按额定流量补齐。",
      source: "CALCULATED",
      value: (ctx) =>
        total(
          running(ctx.assets).map((asset) => numericLatest(ctx, asset, "喷射流量")),
        ),
      hint: (ctx) => {
        const active = running(ctx.assets);
        const covered = active.filter(
          (asset) => numericLatest(ctx, asset, "喷射流量") !== null,
        ).length;
        return `有效流量 ${covered}/${active.length} 台运行设备`;
      },
    },
    {
      id: "spray-alarm",
      label: "待关注事件",
      unit: "条",
      formula: "status=active 的告警数量",
      source: "CALCULATED",
      value: (ctx) => ctx.alarms.length,
      hint: (ctx) =>
        ctx.alarms.length
          ? ctx.alarms
              .slice(0, 2)
              .map((alarm) => alarm.title)
              .join("；")
          : "当前无活动告警",
    },
  ],
};

const mediumPressure: ProcessLayout = {
  subsystemId: "medium-pressure",
  title: "中压供水",
  tagline: "三台泵并联加压，主泵 P-002 为健康趋势观察对象",
  flowCaption:
    "原水由吸水井进入中压泵房，运行泵并联接入出口母管，向厂区管网与高位水池供水，备用泵保持热备。",
  accent: "#247ba8",
  blocks: [
    { id: "m-well", label: "吸水井", kind: "tank", x: 0.02, y: 0.3, w: 0.13, h: 0.28 },
    { id: "m-house", label: "中压泵房", kind: "building", x: 0.15, y: 0.28, w: 0.56, h: 0.28 },
    { id: "m-network", label: "厂区管网", kind: "unit", x: 0.74, y: 0.26, w: 0.24, h: 0.28 },
    { id: "m-pool", label: "高位水池", kind: "tank", x: 0.74, y: 0.64, w: 0.2, h: 0.2 },
  ],
  pipes: [
    { d: "M15 44 H17" },
    { d: "M17 44 H74" },
    { d: "M74 44 H98" },
    { d: "M20 44 V56" },
    { d: "M44 44 V56" },
    { d: "M64 44 V52" },
    { d: "M86 54 V64" },
  ],
  keyCategories: ["离心泵", "出口母管", "吸水井", "高位水池"],
  aiQuestions: [
    "2 号泵振动趋势为何被列为主要观察项？",
    "当前出口压力与流量是否匹配额定工况？",
    "备用泵多久未启动，是否需要试转？",
  ],
  metrics: [
    {
      id: "mp-pressure",
      label: "出口压力",
      unit: "MPa",
      formula: "运行泵「出口压力」测点最新值平均，停机泵不参与",
      source: "CALCULATED",
      value: (ctx) =>
        average(running(ctx.assets).map((asset) => numericLatest(ctx, asset, "压力"))),
      hint: (ctx) =>
        running(ctx.assets).length
          ? `统计 ${running(ctx.assets).length} 台运行泵`
          : "当前无运行泵，缺数",
    },
    {
      id: "mp-flow",
      label: "出口流量",
      unit: "m³/h",
      formula: "运行泵「出口流量」测点最新值合计",
      source: "CALCULATED",
      value: (ctx) =>
        total(running(ctx.assets).map((asset) => numericLatest(ctx, asset, "流量"))),
      hint: (ctx) =>
        running(ctx.assets).length
          ? `统计 ${running(ctx.assets).length} 台运行泵`
          : "当前无运行泵，缺数",
    },
    {
      id: "mp-running",
      label: "运行泵数",
      unit: "台",
      formula: "status=running 的泵组数量（含备用泵）",
      source: "CALCULATED",
      value: (ctx) => running(ctx.assets).length,
      hint: (ctx) => `共 ${ctx.assets.length} 台，热备 ${countBy(ctx.assets, "stopped")} 台`,
    },
  ],
};

const mining: ProcessLayout = {
  subsystemId: "mining",
  title: "含矿污水处理",
  tagline: "加药反应 + 沉淀分离，关注处理负荷与出水监测缺口",
  flowCaption:
    "含矿污水由调节池进入加药反应单元，经沉淀池泥水分离后出水回用，底部污泥排入污泥池脱水外运。",
  accent: "#5f7fb5",
  blocks: [
    { id: "g-adjust", label: "调节池", kind: "tank", x: 0.02, y: 0.26, w: 0.15, h: 0.3 },
    { id: "g-dose", label: "加药反应", kind: "unit", x: 0.2, y: 0.28, w: 0.16, h: 0.24 },
    { id: "g-settle", label: "沉淀池", kind: "tank", x: 0.39, y: 0.26, w: 0.22, h: 0.32 },
    { id: "g-sludge", label: "污泥池", kind: "tank", x: 0.39, y: 0.66, w: 0.2, h: 0.2 },
    { id: "g-out", label: "出水口", kind: "unit", x: 0.67, y: 0.28, w: 0.15, h: 0.16 },
    { id: "g-reuse", label: "回用管网", kind: "unit", x: 0.7, y: 0.52, w: 0.26, h: 0.24 },
  ],
  pipes: [
    { d: "M17 40 H20" },
    { d: "M36 40 H39" },
    { d: "M61 40 H67" },
    { d: "M50 58 V66", dashed: true },
    { d: "M74 44 V52" },
  ],
  keyCategories: ["计量泵", "螺杆泵", "加药单元", "沉淀池"],
  aiQuestions: [
    "本系统处理负荷与药剂消耗是否匹配？",
    "为什么出水指标显示缺数？需要补哪些测点？",
    "污泥泵出口压力波动应参考哪份规程？",
  ],
  metrics: [
    {
      id: "g-load",
      label: "处理负荷",
      unit: "m³/h",
      formula: "各设备「流量」测点最新值合计，缺测不计入",
      source: "CALCULATED",
      value: (ctx) =>
        total(ctx.assets.map((asset) => numericLatest(ctx, asset, "流量"))),
      hint: (ctx) => {
        const points = ctx.assets.flatMap((asset) =>
          ctx.pointsOf(asset.id).filter(
            (point) => point.kind === "number" && point.label.includes("流量"),
          ),
        );
        return points.length
          ? `按 ${points.length} 个流量测点合计`
          : "无流量测点，缺数";
      },
    },
    {
      id: "g-effluent",
      label: "出水指标",
      unit: "",
      formula: "需出水水质测点（如 COD、悬浮物）；种子未提供",
      source: "CALCULATED",
      value: (ctx) => {
        const point = ctx.assets
          .flatMap((asset) => ctx.pointsOf(asset.id))
          .find((item) => item.kind === "number" && item.label.includes("出水"));
        if (!point) return null;
        const sample = ctx.latest(point.id);
        return sample && typeof sample.value === "number" ? sample.value : null;
      },
      hint: () => "缺少出水水质测点，按缺数处理，不替代在线监测",
    },
    {
      id: "g-alarm",
      label: "活动告警",
      unit: "条",
      formula: "status=active 的告警数量",
      source: "CALCULATED",
      value: (ctx) => ctx.alarms.length,
      hint: (ctx) =>
        ctx.alarms.length
          ? ctx.alarms.slice(0, 2).map((alarm) => alarm.title).join("；")
          : "当前无活动告警",
    },
  ],
};

const rainwater: ProcessLayout = {
  subsystemId: "rainwater",
  title: "雨水收集",
  tagline: "以雨次驱动的收集与回用，可用容量缺少设计参数",
  flowCaption:
    "降雨经汇水渠与初沉池进入雨水收集池，提升泵按液位启停并回用，超出设计库容部分经溢流口外排。",
  accent: "#3e8fa0",
  blocks: [
    { id: "r-gate", label: "雨水汇流", kind: "unit", x: 0.02, y: 0.18, w: 0.13, h: 0.12 },
    { id: "r-primary", label: "初沉池", kind: "tank", x: 0.02, y: 0.36, w: 0.16, h: 0.24 },
    { id: "r-store", label: "雨水收集池", kind: "tank", x: 0.24, y: 0.3, w: 0.3, h: 0.36 },
    { id: "r-pump", label: "提升泵房", kind: "building", x: 0.58, y: 0.34, w: 0.16, h: 0.24 },
    { id: "r-reuse", label: "回用管网", kind: "unit", x: 0.78, y: 0.3, w: 0.2, h: 0.18 },
    { id: "r-overflow", label: "溢流口", kind: "outfall", x: 0.78, y: 0.6, w: 0.18, h: 0.14 },
  ],
  pipes: [
    { d: "M8.5 30 V36" },
    { d: "M18 48 H24" },
    { d: "M54 50 H58" },
    { d: "M74 44 H78" },
    { d: "M54 66 V74 H86", dashed: true },
  ],
  keyCategories: ["潜水泵", "回用泵", "收集池", "溢流口"],
  aiQuestions: [
    "最近一次降雨后收集池储量变化如何？",
    "可用容量为什么是缺数？需要补什么数据？",
    "提升泵在降雨场景下的启停是否合理？",
  ],
  metrics: [
    {
      id: "r-storage",
      label: "当前库容",
      unit: "m³",
      formula: "最近雨次南北分区末值合计（雨次模拟数据）",
      source: "CALCULATED",
      value: (ctx) => rainStorage(lastRainEvent(ctx)),
      hint: (ctx) => {
        const event = lastRainEvent(ctx);
        return event ? `${event.name} · 南北分区合计` : "暂无雨次数据，缺数";
      },
    },
    {
      id: "r-capacity",
      label: "可用容量",
      unit: "m³",
      formula: "设计库容 − 当前库容；种子未提供设计库容参数",
      source: "CALCULATED",
      value: () => null,
      hint: () => "缺少设计库容资料，不估算",
    },
    {
      id: "r-rain",
      label: "最近雨次降雨量",
      unit: "mm",
      formula: "最近一次雨次记录的降雨量",
      source: "MOCK",
      value: (ctx) => lastRainEvent(ctx)?.rainfallMm ?? null,
      hint: (ctx) => {
        const event = lastRainEvent(ctx);
        return event ? `${event.name} · ${event.occurredAt.slice(0, 10)}` : "暂无雨次记录";
      },
    },
  ],
};

const pool: ProcessLayout = {
  subsystemId: "pool",
  title: "水池供水",
  tagline: "生产水池供水，可用量与保障天数缺少计量基础",
  flowCaption:
    "补水经补水口进入生产水池，供水泵从池内取水加压送入生产管网，补水状态由补水泵运行状态反映。",
  accent: "#54a892",
  blocks: [
    { id: "p-inlet", label: "补水口", kind: "unit", x: 0.03, y: 0.08, w: 0.15, h: 0.1 },
    { id: "p-tank", label: "生产水池", kind: "tank", x: 0.14, y: 0.26, w: 0.4, h: 0.4 },
    { id: "p-house", label: "供水泵房", kind: "building", x: 0.58, y: 0.3, w: 0.16, h: 0.26 },
    { id: "p-network", label: "生产管网", kind: "unit", x: 0.79, y: 0.26, w: 0.17, h: 0.42 },
    { id: "p-meter", label: "计量间", kind: "unit", x: 0.03, y: 0.7, w: 0.14, h: 0.14 },
  ],
  pipes: [
    { d: "M10 18 V26" },
    { d: "M54 46 H58" },
    { d: "M74 46 H79" },
    { d: "M10 74 H14", dashed: true },
  ],
  keyCategories: ["离心泵", "生产水池", "补水口", "生产管网"],
  aiQuestions: [
    "生产水池有效可用量为什么无法给出？",
    "当前补水泵处于什么状态？",
    "保障天数需要哪些数据才能计算？",
  ],
  metrics: [
    {
      id: "p-available",
      label: "有效可用量",
      unit: "m³",
      formula: "水池液位 × 有效容积 − 死水位；种子未提供液位与容积",
      source: "CALCULATED",
      value: () => null,
      hint: () => "缺少水池液位与有效容积资料，按缺数处理",
    },
    {
      id: "p-days",
      label: "保障天数",
      unit: "天",
      formula: "有效可用量 ÷ 日均供水量；前置有效可用量缺数",
      source: "CALCULATED",
      value: () => null,
      hint: () => "前置数据缺数，不推算保障天数",
    },
    {
      id: "p-makeup",
      label: "补水状态",
      unit: "",
      formula: "补水泵运行状态映射（运行=补水中，停机=未补水）",
      source: "CALCULATED",
      value: (ctx) =>
        statusText(
          ctx.assets.find(
            (asset) => asset.type.includes("补水") || asset.name.includes("补水"),
          ),
        ),
      hint: (ctx) => {
        const asset = ctx.assets.find((item) => item.name.includes("补水"));
        return asset ? `${asset.code} · ${asset.name}` : "本系统未维护补水泵";
      },
    },
  ],
};

const domestic: ProcessLayout = {
  subsystemId: "domestic",
  title: "生活污水收集与外送",
  tagline: "关注收集、计量、外送接管及委托处理责任，非默认建设本地污水处理站",
  flowCaption:
    "港区生活污水→收集与提升→交接计量→既有处理单位（项目范围外）；连接、设备归属和接口数据须核设计文件与合同。",
  accent: "#4f9484",
  blocks: [
    { id: "d-source", label: "生活污水来源", kind: "yard", x: 0.02, y: 0.30, w: 0.18, h: 0.23 },
    { id: "d-collect", label: "收集井/提升", kind: "tank", x: 0.28, y: 0.3, w: 0.18, h: 0.23 },
    { id: "d-meter", label: "接管计量", kind: "unit", x: 0.54, y: 0.3, w: 0.15, h: 0.23 },
    { id: "d-external", label: "既有处理站 · 范围外", kind: "building", x: 0.75, y: 0.3, w: 0.23, h: 0.23 },
  ],
  pipes: [
    { d: "M20 42 H28",dashed: true },
    { d: "M46 42 H54",dashed: true },
    { d: "M69 42 H75",dashed: true },
  ],
  keyCategories: ["收集井", "提升泵", "外送接口", "计量/交接记录"],
  aiQuestions: [
    "生活污水接管点和责任单位是否已由正式文件确认？",
    "外送计量、接管量和联单是否有授权数据？",
    "外送受阻时的应急责任和批准处置程序是什么？",
  ],
  metrics: [
    {
      id: "d-collection",
      label: "收集模拟流量",
      unit: "m³/h",
      formula: "仅示例资产有效流量测点的合计，尚不能作为实际外送交接量。",
      source: "CALCULATED",
      value: (ctx) => total(ctx.assets.map(asset => numericLatest(ctx, asset, "流量"))),
      hint: () => "数据为MOCK；现场外送计量点 PT-028 与交接协议 CK-018 待核验",
    },
    {
      id: "d-handover",
      label: "外送接管核验",
      unit: "",
      formula: "没有正式接管协议、交接计量及处理单位授权数据，不得显示处理达标。",
      source: "CALCULATED",
      value: () => "待核验",
      hint: () => "不假定项目自建缺氧池、好氧池、二沉池及曝气系统",
    },
    {
      id: "d-alarm",
      label: "模拟活动告警",
      unit: "条",
      formula: "仅统计当前场景活动告警数，不表示污水外送合规状态。",
      source: "CALCULATED",
      value: (ctx) => ctx.alarms.length,
      hint: () => "即使没有活动告警，现场交接、外送和水质状态仍然待核实",
    },
  ],
};

export const PROCESS_LAYOUTS: Record<string, ProcessLayout> = {
  spray,
  "medium-pressure": mediumPressure,
  mining,
  rainwater,
  pool,
  domestic,
};

export function getProcessLayout(subsystemId: string): ProcessLayout | undefined {
  return PROCESS_LAYOUTS[subsystemId];
}

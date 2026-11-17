import type {
  Alarm,
  Asset,
  AssetStatus,
  DataSource,
  Quality,
  ScenarioId,
  TelemetrySample,
} from "./types";

/**
 * 射雾器除尘页的生产/环境上下文与纯计算。
 * 所有数据均为 MOCK 演示数据，不代表真实生产作业、粉尘监测或 PLC 点位。
 */

export interface SprayAreaState {
  id: "A" | "B";
  name: string;
  /** 区域是否处于生产作业中（演示值）。 */
  working: boolean;
  task: string;
  /** 距作业结束的分钟数；作业中为 null。 */
  stoppedMinutesAgo: number | null;
  /** 演示运行计划中该区域是否仍保留喷雾。 */
  plannedSpray: boolean;
  note: string;
  source: DataSource;
}

export interface SprayEnvironmentState {
  windSpeedMs: number;
  windDirection: string;
  /** 风向角度（演示值，0° 为正北）。 */
  windDirectionDeg: number;
  /** 粉尘浓度；无监测数据时为 null（缺数），不得用 0 代替。 */
  dustMgM3: number | null;
  dustQuality: Quality;
  source: DataSource;
}

/** 蓄水池演示状态；无真实液位/水量测点，统一标记 MOCK。 */
export interface SprayTankState {
  levelM: number;
  availableM3: number;
  source: DataSource;
}

export interface SprayProductionContext {
  scenarioId: ScenarioId;
  areas: SprayAreaState[];
  environment: SprayEnvironmentState;
  tank: SprayTankState;
  source: DataSource;
  note: string;
}

/** 演示参数，可在页面上说明与调整；不是厂家规定值或环保法定阈值。 */
export const SPRAY_DEMO_RULES = {
  /** 末端压力演示关注阈值（MPa）。 */
  pressureLowMpa: 0.45,
  /** 作业结束后继续观察残余扬尘的分钟数。 */
  residualDustMinutes: 60,
  /** 粉尘浓度演示关注值（mg/m³）。 */
  dustWatchMgM3: 0.15,
  /** 风速演示关注值（m/s）。 */
  windWatchMs: 4,
} as const;

function area(
  id: "A" | "B",
  name: string,
  working: boolean,
  task: string,
  stoppedMinutesAgo: number | null,
  plannedSpray: boolean,
  note: string,
): SprayAreaState {
  return {
    id,
    name,
    working,
    task,
    stoppedMinutesAgo,
    plannedSpray,
    note,
    source: "MOCK",
  };
}

function environment(
  windSpeedMs: number,
  windDirection: string,
  windDirectionDeg: number,
  dustMgM3: number | null,
): SprayEnvironmentState {
  return {
    windSpeedMs,
    windDirection,
    windDirectionDeg,
    dustMgM3,
    dustQuality: dustMgM3 === null ? "missing" : "valid",
    source: "MOCK",
  };
}

function tank(levelM: number, availableM3: number): SprayTankState {
  return { levelM, availableM3, source: "MOCK" };
}

/** 按演示场景返回生产作业与环境上下文；未配置的场景回落到常态数据。 */
export function buildSprayContext(scenarioId: ScenarioId): SprayProductionContext {
  switch (scenarioId) {
    case "SCN-YARD-STOP":
      return {
        scenarioId,
        areas: [
          area("A", "堆场 A 区", false, "煤炭装车作业已结束", 75, true, "作业结束 75 分钟，仍保留 1 台射雾器运行"),
          area("B", "堆场 B 区", true, "矿石卸船作业中", null, true, "按演示计划持续喷雾"),
        ],
        environment: environment(2.1, "西北风", 315, 0.39),
        tank: tank(3.48, 1740),
        source: "MOCK",
        note: "演示场景：A 区作业结束后，残余扬尘与环保要求可能仍需短时喷雾。",
      };
    case "SCN-PUMP-FAULT":
      return {
        scenarioId,
        areas: [
          area("A", "堆场 A 区", true, "煤炭装车作业中", null, true, "按演示计划持续喷雾"),
          area("B", "堆场 B 区", true, "矿石卸船作业中", null, true, "按演示计划持续喷雾"),
        ],
        environment: environment(2.8, "北风", 0, 0.45),
        tank: tank(2.95, 1480),
        source: "MOCK",
        note: "演示场景：供水侧故障演示，射雾器末端压力偏低。",
      };
    case "SCN-RAIN":
      return {
        scenarioId,
        areas: [
          area("A", "堆场 A 区", false, "降雨停工", 45, false, "雨天暂停作业与喷雾"),
          area("B", "堆场 B 区", false, "降雨停工", 40, false, "雨天暂停作业与喷雾"),
        ],
        environment: environment(6.4, "东南风", 135, 0.18),
        tank: tank(3.9, 1950),
        source: "MOCK",
        note: "演示场景：降雨过程，粉尘偏低但风速偏大。",
      };
    case "SCN-MINING":
      return {
        scenarioId,
        areas: [
          area("A", "堆场 A 区", true, "煤炭装车作业中", null, true, "按演示计划持续喷雾"),
          area("B", "堆场 B 区", false, "矿石转运结束", 30, true, "作业结束 30 分钟，仍在喷雾"),
        ],
        environment: environment(3.4, "西风", 270, 0.41),
        tank: tank(3.55, 1775),
        source: "MOCK",
        note: "演示场景：含矿污水处理波动，与堆场作业状态独立。",
      };
    case "SCN-NORMAL":
    default:
      return {
        scenarioId,
        areas: [
          area("A", "堆场 A 区", true, "煤炭装车作业中", null, true, "按演示计划持续喷雾"),
          area("B", "堆场 B 区", true, "矿石卸船作业中", null, true, "按演示计划持续喷雾"),
        ],
        environment: environment(3.2, "西北风", 315, 0.086),
        tank: tank(3.62, 1810),
        source: "MOCK",
        note: "演示场景：两个堆场均处于生产作业状态。",
      };
  }
}

/** 页面侧使用的单台射雾器快照（来自统一设备台账与测点）。 */
export interface SprayAssetSnapshot {
  assetId: string;
  code: string;
  name: string;
  area: "A" | "B";
  status: AssetStatus;
  /** 末端压力（原「管网压力」测点）最新有效值。 */
  pressureMpa: number | null;
  /** 喷射流量最新有效值。 */
  flowM3h: number | null;
}

export interface SprayMetricSummary {
  /** 有效末端压力均值；无有效测点时 null（页面显示缺数）。 */
  pressureMeanMpa: number | null;
  pressureCovered: number;
  pressureTotal: number;
  /** 运行设备有效流量合计；无有效流量测点时 null。 */
  flowTotalM3h: number | null;
  flowCovered: number;
  runningCount: number;
  runningAssetIds: string[];
}

export function summarizeSpray(snapshots: SprayAssetSnapshot[]): SprayMetricSummary {
  const running = snapshots.filter((item) => item.status === "running");
  const pressureValues = snapshots
    .map((item) => item.pressureMpa)
    .filter((value): value is number => typeof value === "number");
  const flowValues = running
    .map((item) => item.flowM3h)
    .filter((value): value is number => typeof value === "number");
  return {
    pressureMeanMpa: pressureValues.length
      ? pressureValues.reduce((sum, value) => sum + value, 0) / pressureValues.length
      : null,
    pressureCovered: pressureValues.length,
    pressureTotal: snapshots.length,
    flowTotalM3h: flowValues.length ? flowValues.reduce((sum, value) => sum + value, 0) : null,
    flowCovered: flowValues.length,
    runningCount: running.length,
    runningAssetIds: running.map((item) => item.assetId),
  };
}

/** 由统一设备台账与测点读取函数生成页面/建议共用的快照。 */
export function toSpraySnapshots(
  assets: Pick<Asset, "id" | "code" | "name" | "area" | "status">[],
  readNumber: (assetId: string, keyword: string) => number | null,
): SprayAssetSnapshot[] {
  return assets.map((asset) => ({
    assetId: asset.id,
    code: asset.code,
    name: asset.name,
    area: asset.area === "north" ? "A" : "B",
    status: asset.status,
    pressureMpa: readNumber(asset.id, "压力"),
    flowM3h: readNumber(asset.id, "流量"),
  }));
}

export interface SpraySuggestion {
  id: string;
  level: "attention" | "action" | "info";
  title: string;
  /** 发现了什么现象。 */
  finding: string;
  /** 使用了哪些数据。 */
  dataUsed: string[];
  /** 应用了什么业务规则。 */
  rule: string;
  /** 建议检查或调整什么。 */
  action: string;
  /** 风险与限制。 */
  risk: string;
  /** 是否需要人工确认后才能形成任务。 */
  needsConfirm: boolean;
  relatedAssetIds: string[];
}

export interface SprayAnalysisInput {
  context: SprayProductionContext;
  snapshots: SprayAssetSnapshot[];
  summary: SprayMetricSummary;
  alarms: Alarm[];
}

function areaOf(snapshot: SprayAssetSnapshot, id: "A" | "B"): boolean {
  return snapshot.area === id;
}

/** 基于可解释规则的运行建议；不使用模型推理，也不直接控制设备。 */
export function analyzeSprayScene(input: SprayAnalysisInput): SpraySuggestion[] {
  const { context, snapshots, summary, alarms } = input;
  const suggestions: SpraySuggestion[] = [];
  const rules = SPRAY_DEMO_RULES;

  for (const zone of context.areas) {
    const inArea = snapshots.filter((item) => areaOf(item, zone.id));
    const runningInArea = inArea.filter((item) => item.status === "running");
    const measuredFlow = runningInArea
      .map((item) => item.flowM3h)
      .filter((value): value is number => typeof value === "number");

    if (zone.working && runningInArea.length === 0) {
      suggestions.push({
        id: `work-no-spray-${zone.id}`,
        level: "action",
        title: `${zone.name}作业中但无射雾器运行`,
        finding: `${zone.name}处于「${zone.task}」，当前该区域 ${inArea.length} 台射雾器均未运行。`,
        dataUsed: [
          `区域作业状态：${zone.name} ${zone.task}（MOCK）`,
          `设备状态：${inArea.map((item) => `${item.code} ${item.status}`).join("、") || "无设备"}`,
        ],
        rule: "作业区域应至少保留 1 台射雾器运行，否则抑尘覆盖不足。",
        action: "核实该区域射雾器是否被误停，按演示运行计划恢复；本页不会自动启停设备。",
        risk: "若现场确实无需喷雾（如物料含水率高），需由值班人员确认后再调整计划。",
        needsConfirm: true,
        relatedAssetIds: inArea.map((item) => item.assetId),
      });
      continue;
    }

    if (zone.working && runningInArea.length > 0 && measuredFlow.length === 0) {
      suggestions.push({
        id: `flow-missing-${zone.id}`,
        level: "attention",
        title: `${zone.name}喷射流量缺数`,
        finding: `${zone.name}有 ${runningInArea.length} 台射雾器运行，但没有有效的喷射流量测点数据。`,
        dataUsed: [`运行设备：${runningInArea.map((item) => item.code).join("、")}`, "流量测点：无有效样本"],
        rule: "缺数不参与合计，也不以额定流量代替实时流量。",
        action: "检查流量测点通讯与采样质量；在数据恢复前，用水分析只展示额定参数的理论估算。",
        risk: "缺数期间的用水量无法按实测统计，只能用理论值，不能对外宣称实际节水量。",
        needsConfirm: false,
        relatedAssetIds: runningInArea.map((item) => item.assetId),
      });
    }

    if (!zone.working && zone.stoppedMinutesAgo !== null) {
      const overWatch = zone.stoppedMinutesAgo >= rules.residualDustMinutes;
      const dust = context.environment.dustMgM3;
      const wind = context.environment.windSpeedMs;
      const keepSpray = runningInArea.length > 0;
      if (keepSpray && (overWatch || (dust !== null && dust >= rules.dustWatchMgM3) || wind >= rules.windWatchMs)) {
        suggestions.push({
          id: `idle-spray-${zone.id}`,
          level: "attention",
          title: `${zone.name}作业结束后仍保留喷雾`,
          finding: `${zone.name}已停止作业 ${zone.stoppedMinutesAgo} 分钟，仍有 ${runningInArea.length} 台射雾器运行（${runningInArea
            .map((item) => item.code)
            .join("、")}）。`,
          dataUsed: [
            `作业状态：${zone.task}，结束于 ${zone.stoppedMinutesAgo} 分钟前（MOCK）`,
            `粉尘浓度：${dust === null ? "缺数" : `${dust} mg/m³`}`,
            `风速：${wind} m/s，${context.environment.windDirection}`,
            `运行设备：${runningInArea.map((item) => item.code).join("、")}`,
          ],
          rule: `作业结束超过 ${rules.residualDustMinutes} 分钟，或粉尘 ≥ ${rules.dustWatchMgM3} mg/m³、风速 ≥ ${rules.windWatchMs} m/s 时，需要核查持续喷雾的必要性；停止作业不等于必须关闭射雾器。`,
          action: "生成待确认的运行计划核查任务，由值班人员结合残余扬尘与环保要求决定是否降频或停运。",
          risk: "直接停运可能造成残余扬尘反弹；演示环境不执行任何真实启停控制。",
          needsConfirm: true,
          relatedAssetIds: runningInArea.map((item) => item.assetId),
        });
      } else if (!keepSpray) {
        suggestions.push({
          id: `idle-ok-${zone.id}`,
          level: "info",
          title: `${zone.name}作业结束且已停止喷雾`,
          finding: `${zone.name}停止作业 ${zone.stoppedMinutesAgo} 分钟，当前无射雾器运行。`,
          dataUsed: [`作业状态：${zone.task}`, `粉尘：${dust === null ? "缺数" : `${dust} mg/m³`}`, `风速：${wind} m/s`],
          rule: "停产后粉尘与风速均低于演示关注值时，维持停机并保持巡检即可。",
          action: "按常规巡检确认堆场表面含水率，暂不需要调整运行计划。",
          risk: "若后续风速升高或粉尘反弹，需要重新评估。",
          needsConfirm: false,
          relatedAssetIds: inArea.map((item) => item.assetId),
        });
      }
    }
  }

  if (summary.pressureMeanMpa !== null && summary.pressureMeanMpa < rules.pressureLowMpa) {
    const lowAssets = snapshots.filter(
      (item) => typeof item.pressureMpa === "number" && item.pressureMpa < rules.pressureLowMpa,
    );
    const relatedAlarms = alarms.filter((alarm) => alarm.status === "active" && alarm.subsystemId === "spray");
    suggestions.push({
      id: "pressure-low",
      level: "action",
      title: "末端压力低于演示关注阈值",
      finding: `当前末端压力均值 ${summary.pressureMeanMpa.toFixed(2)} MPa，低于演示阈值 ${rules.pressureLowMpa} MPa；低值设备：${lowAssets
        .map((item) => `${item.code}（${item.pressureMpa?.toFixed(2)} MPa）`)
        .join("、") || "无单点低值"}。`,
      dataUsed: [
        `末端压力有效测点 ${summary.pressureCovered}/${summary.pressureTotal} 台`,
        ...(relatedAlarms.length ? [`关联活动告警：${relatedAlarms.map((alarm) => alarm.title).join("；")}`] : []),
      ],
      rule: "末端压力均值低于演示阈值时，需要排查供水侧、支管与测点本身，不能直接判定设备故障。",
      action: "生成检查工单草稿，建议依次核查供水主管压力、支管阀门开度、过滤器堵塞与压力测点校验。",
      risk: "阈值是演示参数，不是厂家规定值；压力低也可能是测点偏差，需现场确认。",
      needsConfirm: true,
      relatedAssetIds: lowAssets.map((item) => item.assetId),
    });
  }

  if (summary.flowTotalM3h !== null && summary.runningCount > summary.flowCovered) {
    suggestions.push({
      id: "flow-partial",
      level: "info",
      title: "喷射流量数据覆盖不完整",
      finding: `运行 ${summary.runningCount} 台，其中 ${summary.flowCovered} 台有有效流量数据。`,
      dataUsed: [`有效流量合计 ${summary.flowTotalM3h.toFixed(1)} m³/h`, "覆盖不足部分不参与合计"],
      rule: "合计只累加有效测点，缺数设备不按额定流量补齐。",
      action: "在趋势页核对该设备流量测点的采样质量。",
      risk: "合计值低于真实总流量，不能直接作为考核口径。",
      needsConfirm: false,
      relatedAssetIds: snapshots.filter((item) => item.status === "running" && item.flowM3h === null).map((item) => item.assetId),
    });
  }

  return suggestions;
}

/** 用水口径：实测流量 / 额定参数 / 无数据。 */
export type WaterBasis = "measured" | "rated" | "none";

export interface SprayFlowSummary {
  totalM3h: number | null;
  covered: number;
  running: number;
  basis: WaterBasis;
  note: string;
}

/** 当前有效喷射流量合计；只统计运行设备，缺数不补。 */
export function sumRunningFlow(snapshots: SprayAssetSnapshot[]): SprayFlowSummary {
  const running = snapshots.filter((item) => item.status === "running");
  const valid = running
    .map((item) => item.flowM3h)
    .filter((value): value is number => typeof value === "number");
  if (!valid.length) {
    return {
      totalM3h: null,
      covered: 0,
      running: running.length,
      basis: "none",
      note: "无有效流量测点，不展示瞬时流量，也不以额定流量代替。",
    };
  }
  return {
    totalM3h: valid.reduce((sum, value) => sum + value, 0),
    covered: valid.length,
    running: running.length,
    basis: "measured",
    note: `仅累加 ${valid.length}/${running.length} 台运行设备的有效流量测点。`,
  };
}

export interface IntegratedUsage {
  volumeM3: number | null;
  validSamples: number;
  method: "trapezoid";
  note: string;
}

/** 对单台设备的流量序列做梯形积分，缺测区间不插值。 */
export function integrateFlowSamples(samples: TelemetrySample[]): IntegratedUsage {
  const valid = samples
    .filter((sample) => sample.quality === "valid" && typeof sample.value === "number")
    .map((sample) => ({ at: Date.parse(sample.at), value: sample.value as number }))
    .sort((a, b) => a.at - b.at);
  if (valid.length < 2) {
    return {
      volumeM3: null,
      validSamples: valid.length,
      method: "trapezoid",
      note: "有效样本不足 2 个，无法按时间积分。",
    };
  }
  let volume = 0;
  for (let index = 1; index < valid.length; index += 1) {
    const prev = valid[index - 1];
    const current = valid[index];
    const hours = (current.at - prev.at) / 3_600_000;
    if (hours <= 0 || hours > 2) continue;
    volume += ((prev.value + current.value) / 2) * hours;
  }
  return {
    volumeM3: volume,
    validSamples: valid.length,
    method: "trapezoid",
    note: "按有效采样点做梯形积分，采样间隔超过 2 小时的区间不参与计算。",
  };
}

export interface SprayPlan {
  id: "current" | "reduced" | "off";
  label: string;
  hours: number;
  /** 参与喷雾的设备数量（演示计划，不代表真实运行方式）。 */
  deviceCount: number;
  description: string;
}

export const SPRAY_PLANS: SprayPlan[] = [
  { id: "current", label: "现行计划", hours: 8, deviceCount: 3, description: "两个堆场作业期间按 3 台射雾器运行 8 小时" },
  { id: "reduced", label: "调整后计划", hours: 5, deviceCount: 2, description: "作业结束后保留 2 台运行 5 小时，覆盖残余扬尘" },
  { id: "off", label: "全部停运", hours: 0, deviceCount: 0, description: "作业结束后立即停运，仅保留巡检" },
];

export interface PlanWaterResult {
  planId: SprayPlan["id"];
  volumeM3: number | null;
  basis: WaterBasis;
  note: string;
}

/** 计划用水量 = Σ(单台有效流量 × 运行小时)。只能用实测或额定参数，并明确标注口径。 */
export function estimatePlanWater(
  deviceFlows: (number | null)[],
  plan: SprayPlan,
  basis: WaterBasis,
): PlanWaterResult {
  if (plan.hours <= 0 || plan.deviceCount <= 0) {
    return { planId: plan.id, volumeM3: 0, basis, note: `${plan.label}：不安排运行，理论用水量 0 m³。` };
  }
  const usable = deviceFlows
    .filter((value): value is number => typeof value === "number")
    .slice(0, plan.deviceCount);
  if (!usable.length) {
    return { planId: plan.id, volumeM3: null, basis: "none", note: "缺少可用流量数据，不输出理论用水量。" };
  }
  const perHour = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const volume = perHour * plan.deviceCount * plan.hours;
  return {
    planId: plan.id,
    volumeM3: volume,
    basis,
    note: `${basis === "measured" ? "按实测流量" : "按额定参数"}估算：${plan.deviceCount} 台 × ${perHour.toFixed(1)} m³/h × ${plan.hours} h。`,
  };
}

export interface PlanComparison {
  current: PlanWaterResult;
  reduced: PlanWaterResult;
  off: PlanWaterResult;
  diffM3: number | null;
  diffPct: number | null;
  note: string;
}

/** 对比现行与调整后计划的理论用水差异；结果一律标注为理论估算。 */
export function compareSprayPlans(
  deviceFlows: (number | null)[],
  basis: WaterBasis,
): PlanComparison {
  const current = estimatePlanWater(deviceFlows, SPRAY_PLANS[0], basis);
  const reduced = estimatePlanWater(deviceFlows, SPRAY_PLANS[1], basis);
  const off = estimatePlanWater(deviceFlows, SPRAY_PLANS[2], basis);
  const diff =
    current.volumeM3 !== null && reduced.volumeM3 !== null
      ? current.volumeM3 - reduced.volumeM3
      : null;
  return {
    current,
    reduced,
    off,
    diffM3: diff,
    diffPct:
      diff !== null && current.volumeM3 && current.volumeM3 > 0
        ? (diff / current.volumeM3) * 100
        : null,
    note: "理论估算，仅用于运行计划对比，不代表实际节水率；未接入计量表与真实作业计划。",
  };
}

/**
 * 唐港水资源智能调蓄 V1：单个独立假设调蓄单元。
 * 仅模拟均匀降雨、固定处理能力与两条已经明确启用的增量路径。
 * 不模拟真实管网、水质反应和泵特性；所有默认参数是MOCK示例。
 */
import { runRain, type RainRunParams } from "./water";

export interface DispatchInputs extends RainRunParams {
  /** 雨前可用于额外腾库的小时数 */
  leadHours: number;
  /** 可维持的最低运行储量，不限制现有既定基础处理出流 */
  reserveM3: number;
  /** 有审批准排放路径时才允许雨前额外腾库 */
  dischargeAllowed: boolean;
  preReleaseCapacityM3h: number;
  /** 雨前增量排放的成本，元/m³，含电耗/处理/排放假设 */
  preReleaseCostYuanM3: number;
  /** 有合格出水、水质和实际需求时才允许额外回用 */
  reuseAllowed: boolean;
  reuseCapacityM3h: number;
  reuseDemandM3h: number;
  reuseTreatmentCostYuanM3: number;
  avoidedTapPriceYuanM3: number;
}

export type DispatchKind = "baseline" | "pre_release" | "reuse";

export interface DispatchHour {
  hour: number;
  storageM3: number;
  inflowM3: number;
  baselineOutM3: number;
  extraReuseM3: number;
  overflowM3: number;
}

export interface DispatchOption {
  kind: DispatchKind;
  title: string;
  subtitle: string;
  feasible: boolean;
  blockers: string[];
  initialRainStorageM3: number;
  preReleaseM3: number;
  extraReuseM3: number;
  overflowM3: number;
  peakM3: number;
  peakHour: number;
  firstRiskHour: number | null;
  finalStorageM3: number;
  totalInflowM3: number;
  totalBaseOutM3: number;
  /** 相对于保持现状的增量净运行费用，负值表示示例成本节约 */
  incrementalNetCostYuan: number;
  /** 总水量核对: 雨前初储+降雨-全部出流-溢流-雨后末储 */
  balanceGapM3: number;
  curve: DispatchHour[];
}
export interface DispatchAssessment {
  inputs: DispatchInputs;
  options: DispatchOption[];
  recommended: DispatchKind;
  recommendationReason: string;
  warnings: string[];
}

const r = (value: number): number => Math.round(value * 1e6) / 1e6;
const RISK_RATIO = 0.85;

export const DEFAULT_DISPATCH: DispatchInputs = {
  rainMm: 60,
  areaM2: 180000,
  runoffCoefficient: 0.65,
  hours: 12,
  capacityM3: 6000,
  initialStorageM3: 4200,
  outflowM3h: 300,
  leadHours: 4,
  reserveM3: 1800,
  dischargeAllowed: true,
  preReleaseCapacityM3h: 300,
  preReleaseCostYuanM3: 0.45,
  reuseAllowed: true,
  reuseCapacityM3h: 300,
  reuseDemandM3h: 300,
  reuseTreatmentCostYuanM3: 0.65,
  avoidedTapPriceYuanM3: 2.8,
};

function checkInputs(input: DispatchInputs): void {
  // 复用现有水量模型对雨量、汇水、历时、库容、基础出流的完整校验。
  runRain(input);
  const fields: [string, number][] = [
    ["雨前时长", input.leadHours], ["最低运行储量", input.reserveM3],
    ["雨前额外排放能力", input.preReleaseCapacityM3h],
    ["雨前单位排放成本", input.preReleaseCostYuanM3],
    ["回用处理能力", input.reuseCapacityM3h], ["回用需求", input.reuseDemandM3h],
    ["回用单位处理成本", input.reuseTreatmentCostYuanM3],
    ["外部补水单价", input.avoidedTapPriceYuanM3],
  ];
  for (const [name, value] of fields) {
    if (!Number.isFinite(value) || value < 0) throw new Error(name + "必须为非负有限数");
  }
  if (!Number.isInteger(input.leadHours) || input.leadHours > 168) throw new Error("雨前时长须为0至168整数小时");
  if (input.reserveM3 > input.capacityM3) throw new Error("最低运行储量不能超过有效库容");
}

function computeOption(input: DispatchInputs, kind: DispatchKind): DispatchOption {
  const blockers: string[] = [];
  if (kind === "pre_release") {
    if (!input.dischargeAllowed) blockers.push("未确认具备批准的雨前排放去向");
    if (input.leadHours === 0) blockers.push("没有雨前可操作时间");
    if (input.preReleaseCapacityM3h === 0) blockers.push("没有额外雨前腾库能力");
    if (input.initialStorageM3 <= input.reserveM3) blockers.push("现有储量没有超过运行保底水量");
  }
  if (kind === "reuse") {
    if (!input.reuseAllowed) blockers.push("未确认回用水质、管网和合法用水去向");
    if (input.reuseCapacityM3h === 0) blockers.push("未配置额外合格水处理回用能力");
    if (input.reuseDemandM3h === 0) blockers.push("没有可验证的同期用水需求");
  }
  const feasible = blockers.length === 0;
  const prerel = kind === "pre_release" && feasible
    ? Math.min(input.preReleaseCapacityM3h * input.leadHours, Math.max(0, input.initialStorageM3 - input.reserveM3))
    : 0;
  let storage = input.initialStorageM3 - prerel;
  let peak = input.initialStorageM3; // 雨前原始水位计入整个预测周期的峰值
  let peakHour = 0;
  let firstRiskHour: number | null = storage >= input.capacityM3 * RISK_RATIO ? 0 : null;
  let totalBaseOut = 0;
  let totalExtraReuse = 0;
  let totalOverflow = 0;
  const inflowPerHour = input.rainMm / 1000 * input.areaM2 * input.runoffCoefficient / input.hours;
  const curve: DispatchHour[] = [];
  for (let hour = 1; hour <= input.hours; hour++) {
    const available = storage + inflowPerHour;
    // 先满足现有已计划的基础处理/外排，不重复计算为新的回用效益。
    const baselineOut = Math.min(input.outflowM3h, available);
    const afterBase = available - baselineOut;
    const extraReuse = kind === "reuse" && feasible
      ? Math.min(input.reuseCapacityM3h, input.reuseDemandM3h, Math.max(0, afterBase - input.reserveM3))
      : 0;
    const afterReuse = afterBase - extraReuse;
    const overflow = Math.max(0, afterReuse - input.capacityM3);
    storage = Math.max(0, Math.min(input.capacityM3, afterReuse));
    totalBaseOut += baselineOut;
    totalExtraReuse += extraReuse;
    totalOverflow += overflow;
    if (storage > peak) { peak = storage; peakHour = hour; }
    if (firstRiskHour === null && storage >= input.capacityM3 * RISK_RATIO) firstRiskHour = hour;
    curve.push({
      hour, storageM3: r(storage), inflowM3: r(inflowPerHour),
      baselineOutM3: r(baselineOut), extraReuseM3: r(extraReuse), overflowM3: r(overflow),
    });
  }
  const inflow = inflowPerHour * input.hours;
  const netCost = prerel * input.preReleaseCostYuanM3
    + totalExtraReuse * (input.reuseTreatmentCostYuanM3 - input.avoidedTapPriceYuanM3);
  const balance = input.initialStorageM3 + inflow
    - prerel - totalBaseOut - totalExtraReuse - totalOverflow - storage;
  return {
    kind,
    title: kind === "baseline" ? "方案A · 保持现状" : kind === "pre_release" ? "方案B · 雨前腾库" : "方案C · 优先处理回用",
    subtitle: kind === "baseline" ? "维持现有处理能力" : kind === "pre_release" ? "按批准路径提前降低储量" : "处理合格后满足实际回用需求",
    feasible, blockers,
    initialRainStorageM3: r(input.initialStorageM3 - prerel), preReleaseM3: r(prerel),
    extraReuseM3: r(totalExtraReuse),
    overflowM3: r(totalOverflow), peakM3: r(peak),
    peakHour, firstRiskHour, finalStorageM3: r(storage),
    totalInflowM3: r(inflow), totalBaseOutM3: r(totalBaseOut),
    incrementalNetCostYuan: r(netCost), balanceGapM3: r(balance), curve,
  };
}

export function evaluateDispatch(input: DispatchInputs): DispatchAssessment {
  checkInputs(input);
  const options: DispatchOption[] = [
    computeOption(input, "baseline"),
    computeOption(input, "pre_release"),
    computeOption(input, "reuse"),
  ];
  const candidates = options.filter(o => o.feasible);
  candidates.sort((a, b) => {
    // 安全原则：先减溢流和风险，再比较增量成本；已安全时不为低峰值盲目加费。
    if (Math.abs(a.overflowM3 - b.overflowM3) > 0.001) return a.overflowM3 - b.overflowM3;
    const aRisk = a.firstRiskHour === null ? 0 : 1;
    const bRisk = b.firstRiskHour === null ? 0 : 1;
    if (aRisk !== bRisk) return aRisk - bRisk;
    if (Math.abs(a.incrementalNetCostYuan - b.incrementalNetCostYuan) > 0.001) return a.incrementalNetCostYuan - b.incrementalNetCostYuan;
    return a.peakM3 - b.peakM3;
  });
  const choice = candidates[0];
  const warnings: string[] = [
    "本页仅以单个假设调蓄池和均匀降雨模拟；不代表真实港区拓扑、水质、许可或预报。",
    "方案B的外排路径与方案C的回用质量、需求默认仅为演示假设，正式调度前必须核实。",
    "经济性仅计算相对现状的新增运行费与被替代购水费用，不包含固定成本、税费、环保风险与设备折旧。",
  ];
  if (choice.overflowM3 > 0.01) warnings.push("所有可执行方案仍有预测溢流，不能视为已经消除风险，应开展进一步工程核算。");
  if (!input.dischargeAllowed) warnings.push("雨前排放未确认批准去向，方案B不参与推荐。");
  if (!input.reuseAllowed) warnings.push("回用条件未确认，方案C不参与推荐。");
  const recommendationReason = choice.overflowM3 > 0.01
    ? "可执行方案中预计溢流相对较少，但尚不能消除风险，请人工组织应急复核。"
    : choice.firstRiskHour !== null
      ? "该方案在现有假设中可避免溢流，但仍可能达到风险水位，需要人工持续监测。"
      : "该方案在可行方案中兼顾无溢流、较低峰值与示例增量成本。";
  return { inputs: { ...input }, options, recommended: choice.kind, recommendationReason, warnings };
}

import type { Asset, DataSource } from "./types";

export type HealthBand =
  | "健康"
  | "关注"
  | "预警"
  | "危险"
  | "资料不足"
  | "无适配模型";

export type HealthFactorKey = "vibration" | "temperature" | "current" | "aging";

export interface HealthThresholds {
  warning: number;
  critical: number;
  unit: string;
}

export interface HealthProfile {
  profileVersion: string;
  vibration: HealthThresholds;
  temperature: HealthThresholds;
  current: HealthThresholds;
  aging: {
    runtimeHours: number;
    startCount: number;
    runtimeWeight: number;
    startWeight: number;
  };
  weights: Record<HealthFactorKey, number>;
}

/**
 * 演示用主泵评分 Profile。阈值仅为演示参考值，
 * 不是通用工业标准，也不来自真实厂家资料。
 */
export const DEFAULT_HEALTH_PROFILE: HealthProfile = {
  profileVersion: "pump-profile-demo-v1",
  vibration: { warning: 2.0, critical: 4.5, unit: "mm/s" },
  temperature: { warning: 55, critical: 75, unit: "℃" },
  current: { warning: 100, critical: 130, unit: "A" },
  aging: {
    runtimeHours: 15000,
    startCount: 3000,
    runtimeWeight: 0.6,
    startWeight: 0.4,
  },
  weights: { vibration: 30, temperature: 20, current: 15, aging: 22 },
};

export const HEALTH_RULE_VERSION = "health-rule-r1-v1";
export const THRESHOLD_SOURCE = "演示参考阈值";

const FACTOR_TOTAL = 4;
const AGING_WARNING_RATIO = 0.8;

export interface HealthReadings {
  vibration?: number | null;
  temperature?: number | null;
  current?: number | null;
}

export interface HealthScoreInput {
  asset: Asset;
  readings: HealthReadings;
  runtimeHours: number;
  startCount: number;
  profile?: HealthProfile;
  /** 计算时刻，默认取当前时间；演示页面传入固定参考时间。 */
  asOf?: string;
}

export interface HealthFactor {
  key: HealthFactorKey;
  label: string;
  value: number | null;
  unit: string;
  warning: number;
  critical: number;
  risk: number | null;
  deduction: number | null;
  weight: number;
  valid: boolean;
  source: DataSource;
  missingReason?: string;
  detail?: string;
}

export interface HealthScoreResult {
  score: number | null;
  band: HealthBand;
  modelUnavailable: boolean;
  coverage: number;
  factors: HealthFactor[];
  missingReasons: string[];
  calculatedAt: string;
  ruleVersion: string;
  profileVersion: string;
  formulaSummary: string;
  limits: string;
  thresholdSource: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 是否适用主泵模型。种子中的类型为中文（离心泵/潜水泵等），
 * 同时兼容英文 "pump" 类型的设备。
 */
export function isPumpAsset(asset: Asset): boolean {
  const type = asset.type.trim().toLowerCase();
  return type === "pump" || type.includes("pump") || type.includes("泵");
}

function assertThresholds(name: string, range: HealthThresholds): void {
  if (!Number.isFinite(range.warning) || !Number.isFinite(range.critical)) {
    throw new Error(`${name} 阈值必须是有限数值`);
  }
  if (range.critical <= range.warning) {
    throw new Error(`${name} 危险阈值必须大于警戒阈值（critical > warning）`);
  }
}

export function validateHealthProfile(profile: HealthProfile): void {
  assertThresholds("振动", profile.vibration);
  assertThresholds("温度", profile.temperature);
  assertThresholds("电流", profile.current);
  if (
    !(profile.aging.runtimeHours > 0) ||
    !(profile.aging.startCount > 0) ||
    !(profile.aging.runtimeWeight >= 0) ||
    !(profile.aging.startWeight >= 0)
  ) {
    throw new Error("老化参考值必须为正数，权重不能为负");
  }
}

export function bandForScore(score: number): HealthBand {
  if (score >= 80) return "健康";
  if (score >= 60) return "关注";
  if (score >= 40) return "预警";
  return "危险";
}

interface NumericFactorSpec {
  key: Exclude<HealthFactorKey, "aging">;
  label: string;
  thresholds: HealthThresholds;
  weight: number;
}

function numericFactor(
  spec: NumericFactorSpec,
  raw: number | null | undefined,
): HealthFactor {
  const missingReason = `未提供有效读数（缺失或质量无效），未按 0 风险计`;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      key: spec.key,
      label: spec.label,
      value: null,
      unit: spec.thresholds.unit,
      warning: spec.thresholds.warning,
      critical: spec.thresholds.critical,
      risk: null,
      deduction: null,
      weight: spec.weight,
      valid: false,
      source: "MOCK",
      missingReason,
    };
  }
  const risk = clamp(
    (raw - spec.thresholds.warning) /
      (spec.thresholds.critical - spec.thresholds.warning),
    0,
    1,
  );
  return {
    key: spec.key,
    label: spec.label,
    value: raw,
    unit: spec.thresholds.unit,
    warning: spec.thresholds.warning,
    critical: spec.thresholds.critical,
    risk: round(risk, 4),
    deduction: round(spec.weight * risk, 2),
    weight: spec.weight,
    valid: true,
    source: "MOCK",
  };
}

function agingFactor(
  profile: HealthProfile,
  runtimeHours: number,
  startCount: number,
): HealthFactor {
  const runtime = Math.max(0, runtimeHours);
  const starts = Math.max(0, startCount);
  const runtimeRisk = clamp(runtime / profile.aging.runtimeHours, 0, 1);
  const startRisk = clamp(starts / profile.aging.startCount, 0, 1);
  const risk =
    profile.aging.runtimeWeight * runtimeRisk +
    profile.aging.startWeight * startRisk;
  const warning = round(profile.aging.runtimeHours * AGING_WARNING_RATIO, 0);
  return {
    key: "aging",
    label: "老化（运行小时/启停）",
    value: runtime,
    unit: "h",
    warning,
    critical: profile.aging.runtimeHours,
    risk: round(risk, 4),
    deduction: round(profile.weights.aging * risk, 2),
    weight: profile.weights.aging,
    valid: true,
    source: "CALCULATED",
    detail: `累计 ${runtime} h / 启停 ${starts} 次；Ra = ${profile.aging.runtimeWeight}×小时风险 + ${profile.aging.startWeight}×启停风险`,
  };
}

function formulaSummary(profile: HealthProfile): string {
  const w = profile.weights;
  return `Health = clamp(100 − ${w.vibration}·Rv − ${w.temperature}·Rt − ${w.current}·Ri − ${w.aging}·Ra, 5, 100)；Ra = ${profile.aging.runtimeWeight}·Rh + ${profile.aging.startWeight}·Rs；Rv/Rt/Ri = clamp((x − 警戒)/(危险 − 警戒), 0, 1)；故障状态取 min(score, 35)`;
}

const LIMITS =
  "评分仅反映演示阈值下的当前运行风险，用于安排检查；不代表部件寿命或未来故障可能性，不构成停机结论，阈值来源为演示参考阈值。";

function emptyResult(
  input: HealthScoreInput,
  profile: HealthProfile,
  asOf: string,
): HealthScoreResult {
  return {
    score: null,
    band: "无适配模型",
    modelUnavailable: true,
    coverage: 0,
    factors: [],
    missingReasons: [`设备类型「${input.asset.type}」不在主泵评分配置内`],
    calculatedAt: asOf,
    ruleVersion: HEALTH_RULE_VERSION,
    profileVersion: profile.profileVersion,
    formulaSummary: "无适配评分模型：本演示仅对泵类设备套用主泵健康评分。",
    limits: "该设备未套用主泵评分模型，不展示健康分与扣分，避免用不适用的阈值误导判断。",
    thresholdSource: THRESHOLD_SOURCE,
  };
}

/**
 * 规则健康评分。相同读数与工况下结果只由输入决定，
 * 不接受设备 ID/编码作为扰动项；任一必需因子缺测时整体不出分。
 */
export function scorePumpHealth(input: HealthScoreInput): HealthScoreResult {
  const profile = input.profile ?? DEFAULT_HEALTH_PROFILE;
  validateHealthProfile(profile);
  const asOf = input.asOf ?? new Date().toISOString();

  if (!isPumpAsset(input.asset)) {
    return emptyResult(input, profile, asOf);
  }

  const factors: HealthFactor[] = [
    numericFactor(
      {
        key: "vibration",
        label: "振动速度",
        thresholds: profile.vibration,
        weight: profile.weights.vibration,
      },
      input.readings.vibration,
    ),
    numericFactor(
      {
        key: "temperature",
        label: "轴承温度",
        thresholds: profile.temperature,
        weight: profile.weights.temperature,
      },
      input.readings.temperature,
    ),
    numericFactor(
      {
        key: "current",
        label: "电机电流",
        thresholds: profile.current,
        weight: profile.weights.current,
      },
      input.readings.current,
    ),
    agingFactor(profile, input.runtimeHours, input.startCount),
  ];

  const validFactors = factors.filter((factor) => factor.valid);
  const missingReasons = factors
    .filter((factor) => !factor.valid)
    .map(
      (factor) =>
        `${factor.label}缺测：${factor.missingReason ?? "无有效读数"}（测点 key：${factor.key}）`,
    );
  const coverage = round(validFactors.length / FACTOR_TOTAL, 4);

  if (missingReasons.length > 0) {
    return {
      score: null,
      band: "资料不足",
      modelUnavailable: false,
      coverage,
      factors,
      missingReasons,
      calculatedAt: asOf,
      ruleVersion: HEALTH_RULE_VERSION,
      profileVersion: profile.profileVersion,
      formulaSummary: formulaSummary(profile),
      limits: `资料不足，未给出完整健康分：缺少 ${missingReasons
        .map((reason) => reason.split("缺测")[0])
        .join("、")}，未自动重加权成 100 分。${LIMITS}`,
      thresholdSource: THRESHOLD_SOURCE,
    };
  }

  const totalDeduction = validFactors.reduce(
    (sum, factor) => sum + (factor.deduction ?? 0),
    0,
  );
  let score = round(clamp(100 - totalDeduction, 5, 100), 1);
  if (input.asset.status === "fault") score = Math.min(score, 35);
  score = round(score, 1);

  return {
    score,
    band: bandForScore(score),
    modelUnavailable: false,
    coverage,
    factors,
    missingReasons: [],
    calculatedAt: asOf,
    ruleVersion: HEALTH_RULE_VERSION,
    profileVersion: profile.profileVersion,
    formulaSummary: formulaSummary(profile),
    limits: `${LIMITS}${input.asset.status === "fault" ? "设备当前为故障状态，分数取 min(score, 35)。" : ""}`,
    thresholdSource: THRESHOLD_SOURCE,
  };
}

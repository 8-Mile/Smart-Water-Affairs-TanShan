import type { TelemetrySample } from "./types";

export type TrendStatus =
  | "estimated"
  | "already_exceeded"
  | "insufficient"
  | "not_rising"
  | "low_fit"
  | "out_of_horizon";

export interface TrendPoint {
  at: string;
  value: number;
}

export interface ThresholdTrend {
  status: TrendStatus;
  sampleCount: number;
  spanDays: number;
  slopePerDay: number | null;
  rSquared: number | null;
  threshold: number;
  horizonDays: number;
  predictedAt?: string;
  predictedDays?: number;
  reason: string;
  observed: TrendPoint[];
  projected: TrendPoint[];
  latestValue?: number;
  latestAt?: string;
}

export interface TrendOptions {
  horizonDays?: number;
  minSamples?: number;
  minSpanHours?: number;
  minRSquared?: number;
}

export const DEFAULT_TREND_OPTIONS = {
  horizonDays: 14,
  minSamples: 10,
  minSpanHours: 48,
  minRSquared: 0.55,
} as const;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const PROJECTED_POINTS = 9;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numericSamples(samples: TelemetrySample[]): TrendPoint[] {
  const byTime = new Map<number, TrendPoint>();
  for (const sample of samples) {
    if (sample.quality !== "valid") continue;
    if (typeof sample.value !== "number" || !Number.isFinite(sample.value)) continue;
    const at = Date.parse(sample.at);
    if (!Number.isFinite(at)) continue;
    byTime.set(at, { at: new Date(at).toISOString(), value: sample.value });
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, point]) => point);
}

function baseResult(
  threshold: number,
  horizonDays: number,
): Omit<ThresholdTrend, "status" | "reason"> {
  return {
    sampleCount: 0,
    spanDays: 0,
    slopePerDay: null,
    rSquared: null,
    threshold,
    horizonDays,
    observed: [],
    projected: [],
  };
}

/**
 * 估计近 14 日序列触及演示阈值的时间。
 * 仅在样本数、跨度、斜率、R² 与预测窗口均满足门槛时返回 estimated，
 * 其余情况明确给出失败原因，不编造日期。
 */
export function estimateThresholdCrossing(
  samples: TelemetrySample[],
  threshold: number,
  options: TrendOptions = {},
): ThresholdTrend {
  if (!Number.isFinite(threshold)) {
    throw new Error("阈值必须是有限数值");
  }
  const minSamples = options.minSamples ?? DEFAULT_TREND_OPTIONS.minSamples;
  const minSpanHours = options.minSpanHours ?? DEFAULT_TREND_OPTIONS.minSpanHours;
  const minRSquared = options.minRSquared ?? DEFAULT_TREND_OPTIONS.minRSquared;
  const horizonDays = options.horizonDays ?? DEFAULT_TREND_OPTIONS.horizonDays;

  const observed = numericSamples(samples);
  const result = baseResult(threshold, horizonDays);
  result.observed = observed;

  if (observed.length === 0) {
    return {
      ...result,
      status: "insufficient",
      reason: "无有效样本：测点缺失或全部样本质量无效，趋势不可估计。",
    };
  }

  const first = observed[0];
  const last = observed[observed.length - 1];
  const firstMs = Date.parse(first.at);
  const lastMs = Date.parse(last.at);
  const spanDays = round((lastMs - firstMs) / DAY_MS, 4);
  result.sampleCount = observed.length;
  result.spanDays = spanDays;
  result.latestValue = last.value;
  result.latestAt = last.at;

  if (last.value >= threshold) {
    return {
      ...result,
      status: "already_exceeded",
      reason: `最新值 ${last.value} 已不低于演示阈值 ${threshold}，按“已触阈”展示，不外推未来日期。`,
    };
  }

  if (observed.length < minSamples) {
    return {
      ...result,
      status: "insufficient",
      reason: `有效样本 ${observed.length} 个，少于演示门槛 ${minSamples} 个，趋势不可估计。`,
    };
  }
  const spanHours = (lastMs - firstMs) / HOUR_MS;
  if (spanHours < minSpanHours) {
    return {
      ...result,
      status: "insufficient",
      reason: `样本跨度 ${round(spanHours, 1)} 小时，少于演示门槛 ${minSpanHours} 小时，趋势不可估计。`,
    };
  }

  const xs = observed.map((point) => (Date.parse(point.at) - firstMs) / DAY_MS);
  const ys = observed.map((point) => point.value);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let sxx = 0;
  let sxy = 0;
  for (let index = 0; index < xs.length; index += 1) {
    sxx += (xs[index] - meanX) ** 2;
    sxy += (xs[index] - meanX) * (ys[index] - meanY);
  }
  if (sxx === 0) {
    return {
      ...result,
      status: "insufficient",
      reason: "有效样本时间戳重合，无法拟合时间趋势。",
    };
  }
  const slopePerDay = sxy / sxx;
  const intercept = meanY - slopePerDay * meanX;
  let ssRes = 0;
  let ssTot = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const fitted = intercept + slopePerDay * xs[index];
    ssRes += (ys[index] - fitted) ** 2;
    ssTot += (ys[index] - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  result.slopePerDay = round(slopePerDay, 4);
  result.rSquared = round(rSquared, 4);

  if (slopePerDay <= 0) {
    return {
      ...result,
      status: "not_rising",
      reason: `拟合斜率 ${result.slopePerDay} /日不为正，序列未呈上升趋势，不估计触阈时间。`,
    };
  }
  if (rSquared < minRSquared) {
    return {
      ...result,
      status: "low_fit",
      reason: `拟合 R²=${result.rSquared}，低于演示门槛 ${minRSquared}，波动过大，不估计触阈时间。`,
    };
  }

  const predictedDays = (threshold - last.value) / slopePerDay;
  if (!Number.isFinite(predictedDays) || predictedDays <= 0) {
    return {
      ...result,
      status: "already_exceeded",
      reason: "按当前拟合，最新值已不低于阈值，按“已触阈”展示。",
    };
  }
  if (predictedDays > horizonDays) {
    return {
      ...result,
      status: "out_of_horizon",
      predictedDays: round(predictedDays, 2),
      reason: `预计 ${round(predictedDays, 1)} 天后触及阈值，超出 ${horizonDays} 天展示窗口，不给出具体日期。`,
    };
  }

  const predictedAt = new Date(lastMs + predictedDays * DAY_MS).toISOString();
  const projected: TrendPoint[] = [];
  for (let index = 0; index < PROJECTED_POINTS; index += 1) {
    const ratio = index / (PROJECTED_POINTS - 1);
    projected.push({
      at: new Date(lastMs + predictedDays * ratio * DAY_MS).toISOString(),
      value: round(last.value + (threshold - last.value) * ratio, 4),
    });
  }

  return {
    ...result,
    status: "estimated",
    predictedAt,
    predictedDays: round(predictedDays, 2),
    reason: `满足样本、跨度、斜率、R² 与 ${horizonDays} 天窗口门槛，预计触及演示阈值。`,
    projected,
  };
}

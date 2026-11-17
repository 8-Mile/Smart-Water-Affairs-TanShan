import { hashString, timeSteps } from "./random";
import type { MeasurePoint, ScenarioSeed, TelemetrySample } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOW_MS = 14 * DAY;

/** 按单位确定展示精度，保证同一时刻多次查询结果完全一致。 */
function digitsFor(unit: string | undefined): number {
  switch (unit) {
    case "MPa":
      return 2;
    case "mm/s":
      return 2;
    case "℃":
    case "A":
    case "m³/h":
    case "%":
    case "m³/min":
      return 1;
    default:
      return 2;
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function noiseAt(seed: ScenarioSeed, pointId: string, atMs: number): number {
  const hash = hashString(`${seed.scenarioId}:${pointId}:${atMs}`);
  return hash / 0xffffffff;
}

/**
 * 故障场景下 P-002 的振动/温度/电流按 14 天窗口线性抬升。
 * progress 以绝对窗口计算，保证不同查询区间在重叠时刻取值一致。
 */
function faultProgress(seed: ScenarioSeed, atMs: number): number {
  const end = Date.parse(seed.referenceTime);
  const start = end - WINDOW_MS;
  return Math.min(1, Math.max(0, (atMs - start) / WINDOW_MS));
}

function numericValue(
  seed: ScenarioSeed,
  point: MeasurePoint,
  atMs: number,
): number {
  const base = point.baseline ?? 0;
  const volatility = point.volatility ?? 0;
  const jitter = (noiseAt(seed, point.id, atMs) * 2 - 1) * volatility;

  if (seed.scenarioId === "SCN-PUMP-FAULT" && point.assetId === "asset-p002") {
    const progress = faultProgress(seed, atMs);
    switch (point.id) {
      case "asset-p002-vibration":
        return round(2.1 + progress * 2.2 + jitter * 0.2, 2);
      case "asset-p002-temperature":
        return round(62 + progress * 9 + jitter * 0.4, 1);
      case "asset-p002-current":
        return round(105 + progress * 23 + jitter * 0.4, 1);
      case "asset-p002-pressure":
        return round(1.18 - progress * 0.06 + jitter * 0.4, 2);
      case "asset-p002-flow":
        return round(320 - progress * 12 + jitter * 0.4, 1);
      default:
        break;
    }
  }

  return round(base + jitter, digitsFor(point.unit));
}

function enumValue(seed: ScenarioSeed, point: MeasurePoint): string {
  if (point.id === "asset-p002-status") {
    return seed.scenarioId === "SCN-PUMP-FAULT" ? "fault" : "running";
  }
  const asset = seed.assets.find((item) => item.id === point.assetId);
  return asset?.status ?? "unknown";
}

/**
 * 确定性遥测查询。样本锚定固定参考时间，缺失测点返回空数组。
 * 72h 内按 30 分钟采样，更长区间按 2 小时采样，保证梯形积分不丢弃区间。
 */
export function getPointSeries(
  seed: ScenarioSeed,
  pointId: string,
  fromIso: string,
  toIso: string,
): TelemetrySample[] {
  const point = seed.points.find((item) => item.id === pointId);
  if (!point) return [];

  const referenceMs = Date.parse(seed.referenceTime);
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];

  const start = Math.max(fromMs, referenceMs - WINDOW_MS);
  const end = Math.min(toMs, referenceMs);
  if (start > end) return [];

  const spanHours = (end - start) / HOUR;
  const stepMinutes = spanHours > 72 ? 120 : 30;
  const steps = timeSteps(start, end, stepMinutes);

  return steps.map((atMs) => ({
    pointId: point.id,
    at: new Date(atMs).toISOString(),
    value:
      point.kind === "enum" ? enumValue(seed, point) : numericValue(seed, point, atMs),
    quality: point.quality,
    source: point.source,
  }));
}

/** 返回参考时间前最近一次有效采样。 */
export function getLatestSample(
  seed: ScenarioSeed,
  pointId: string,
): TelemetrySample | null {
  const referenceMs = Date.parse(seed.referenceTime);
  const series = getPointSeries(
    seed,
    pointId,
    new Date(referenceMs - 6 * HOUR).toISOString(),
    new Date(referenceMs).toISOString(),
  );
  return series.length > 0 ? series[series.length - 1] : null;
}

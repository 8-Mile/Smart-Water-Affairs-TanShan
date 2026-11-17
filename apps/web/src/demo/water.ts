import type { LedgerEntry } from "./types";

/**
 * 水资源演示计算：全部为纯函数，仅使用固定种子与人工输入参数，
 * 不访问真实监测、气象预报或地下管网拓扑。
 */

export interface RainRunParams {
  /** 场次降雨量 mm */
  rainMm: number;
  /** 汇水面积 m² */
  areaM2: number;
  /** 径流系数 0~1 */
  runoffCoefficient: number;
  /** 降雨与调度时长（小时） */
  hours: number;
  /** 有效容量 m³ */
  capacityM3: number;
  /** 初始储量 m³ */
  initialStorageM3: number;
  /** 基线处理/外排能力 m³/h */
  outflowM3h: number;
}

export interface RainRunPoint {
  hour: number;
  /** 本小时末储量 m³ */
  volume: number;
  /** 本小时入库量 m³ */
  inflow: number;
  /** 本小时实际出库量 m³ */
  outflow: number;
  /** 本小时溢出量 m³ */
  overflow: number;
  /** 储量占有效容量比例 */
  capacityRatio: number;
}

export interface RainRunResult {
  params: RainRunParams;
  points: RainRunPoint[];
  hour: number[];
  volume: number[];
  outflow: number[];
  /** 逐小时溢出序列；累计溢出见 overflow */
  overflowSeries: number[];
  totalInflow: number;
  totalOutflow: number;
  overflow: number;
  peak: number;
  peakHour: number;
  finalVolume: number;
  storageChange: number;
  conservationGap: number;
  /** 首次达到 85% 容量的时刻；0 表示初始即达风险水位，null 表示未达到 */
  firstRiskHour: number | null;
  formula: string;
  assumptions: string[];
  warnings: string[];
}

const RISK_RATIO = 0.85;
const MAX_HOURS = 720;

function fail(message: string): never {
  throw new Error(message);
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) fail(`${name}必须是有限数值`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
}

export const RAIN_FORMULA =
  "Qin=(rainMm/1000×areaM2×runoffCoefficient)/hours；V_next=clamp(V+Qin−Qout,0,C)；overflow=max(0,V+Qin−Qout−C)";

export const RAIN_ASSUMPTIONS = [
  "每次运行对应一个独立的假设调蓄单元，不假设地下管网拓扑或分区连通关系。",
  "降雨在设定时长内均匀分布，径流系数与汇水面积为演示参数。",
  "处理/外排能力在时长内恒定，未模拟泵组启停、人工调度与溢流堰曲线。",
  "未使用真实气象预报、在线液位或流量计数据；结果仅为演示假设下的估算。",
];

export function runRain(params: RainRunParams): RainRunResult {
  const {
    rainMm,
    areaM2,
    runoffCoefficient,
    hours,
    capacityM3,
    initialStorageM3,
    outflowM3h,
  } = params;

  assertFinite("降雨量", rainMm);
  assertFinite("汇水面积", areaM2);
  assertFinite("径流系数", runoffCoefficient);
  assertFinite("时长", hours);
  assertFinite("有效容量", capacityM3);
  assertFinite("初始储量", initialStorageM3);
  assertFinite("处理能力", outflowM3h);

  if (rainMm < 0) fail("降雨量不能为负值");
  if (areaM2 <= 0) fail("汇水面积必须大于 0");
  if (runoffCoefficient < 0 || runoffCoefficient > 1) {
    fail("径流系数必须在 0~1 之间");
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    fail(`时长必须是 1~${MAX_HOURS} 之间的整数小时`);
  }
  if (capacityM3 <= 0) fail("有效容量必须大于 0");
  if (initialStorageM3 < 0 || initialStorageM3 > capacityM3) {
    fail("初始储量必须在 0 与有效容量之间");
  }
  if (outflowM3h < 0) fail("处理/外排能力不能为负值");

  const totalInflowTarget =
    (rainMm / 1000) * areaM2 * runoffCoefficient;
  const inflowPerHour = totalInflowTarget / hours;

  let volume = initialStorageM3;
  let totalInflow = 0;
  let totalOutflow = 0;
  let overflow = 0;
  let peak = initialStorageM3;
  let peakHour = 0;
  let firstRiskHour: number | null =
    initialStorageM3 >= capacityM3 * RISK_RATIO ? 0 : null;

  const points: RainRunPoint[] = [];
  for (let hour = 1; hour <= hours; hour += 1) {
    const inflow = inflowPerHour;
    // 出库受可用水量限制，避免出现负储量；溢出单独记录，保证守恒。
    const outflow = Math.min(outflowM3h, volume + inflow);
    const raw = volume + inflow - outflow;
    const stepOverflow = Math.max(0, raw - capacityM3);
    volume = clamp(raw, 0, capacityM3);

    totalInflow += inflow;
    totalOutflow += outflow;
    overflow += stepOverflow;

    if (volume > peak) {
      peak = volume;
      peakHour = hour;
    }
    if (firstRiskHour === null && volume >= capacityM3 * RISK_RATIO) {
      firstRiskHour = hour;
    }

    points.push({
      hour,
      volume: round(volume),
      inflow: round(inflow),
      outflow: round(outflow),
      overflow: round(stepOverflow),
      capacityRatio: capacityM3 > 0 ? round(volume / capacityM3) : 0,
    });
  }

  const storageChange = volume - initialStorageM3;
  const conservationGap = totalInflow - totalOutflow - overflow - storageChange;

  const warnings: string[] = [];
  if (firstRiskHour !== null) {
    warnings.push(
      firstRiskHour === 0
        ? "初始储量已达到 85% 风险水位，调蓄空间不足。"
        : `预计第 ${firstRiskHour} 小时达到 85% 风险水位。`,
    );
  } else {
    warnings.push("按当前参数未达到 85% 风险水位，仍需关注后续降雨。");
  }
  if (overflow > 0) {
    warnings.push(`累计溢出 ${round(overflow, 1)} m³，需提前安排外排或错峰调蓄。`);
  }
  if (outflowM3h === 0) {
    warnings.push("处理/外排能力为 0，任何入库量都将直接占用库容。");
  }
  if (initialStorageM3 >= capacityM3) {
    warnings.push("初始储量已达到有效容量，无法继续调蓄。");
  }

  return {
    params: { ...params },
    points,
    hour: points.map((point) => point.hour),
    volume: points.map((point) => point.volume),
    outflow: points.map((point) => point.outflow),
    overflowSeries: points.map((point) => point.overflow),
    totalInflow: round(totalInflow),
    totalOutflow: round(totalOutflow),
    overflow: round(overflow),
    peak: round(peak),
    peakHour,
    finalVolume: round(volume),
    storageChange: round(storageChange),
    conservationGap: round(conservationGap),
    firstRiskHour,
    formula: RAIN_FORMULA,
    assumptions: [...RAIN_ASSUMPTIONS],
    warnings,
  };
}

/** 供水保障天数 =（当前储量 − 死库容）/ 日均需水量 */
export function supplyDays(
  storageM3: number,
  reserveM3: number,
  demandM3d: number,
): number {
  assertFinite("当前储量", storageM3);
  assertFinite("死库容", reserveM3);
  assertFinite("日均需水量", demandM3d);
  if (storageM3 < 0) fail("当前储量不能为负值");
  if (reserveM3 < 0) fail("死库容不能为负值");
  if (reserveM3 > storageM3) fail("死库容不能大于当前储量");
  if (demandM3d <= 0) fail("日均需水量必须大于 0");
  return (storageM3 - reserveM3) / demandM3d;
}

export interface LedgerSummaryRow {
  key: string;
  sourceType: string;
  direction: "in" | "out";
  volume: number;
  unit: string;
  entryCount: number;
  /** 是否为雨水回用形成的重复计量项（不重复计入新增取水） */
  reuse: boolean;
  note: string;
}

export interface LedgerSummary {
  rows: LedgerSummaryRow[];
  totalIn: number;
  totalOut: number;
  /** 中水回用外供量，单列展示，不重复计入新增取水 */
  reuseVolume: number;
  /** 自来水等外部补水（进项） */
  externalIn: number;
  /** 非回用外排/外供 */
  externalOut: number;
  /** 账本净差（进−出），不等同于储水单元储量变化 */
  difference: number;
  note: string;
}

function isReuseEntry(entry: LedgerEntry): boolean {
  return (
    entry.direction === "out" &&
    (entry.sourceType.includes("中水") || entry.sourceType.includes("回用"))
  );
}

/**
 * 按来源类型 + 方向汇总账本。中水外供来自雨水回用，只作为回用量单列，
 * 不同时叠加到“新增取水”或“外部补水”，避免雨水转回用被重复统计。
 */
export function summarizeLedger(entries: LedgerEntry[]): LedgerSummary {
  const groups = new Map<string, LedgerSummaryRow>();
  for (const entry of entries) {
    const key = `${entry.sourceType}::${entry.direction}`;
    const existing = groups.get(key);
    if (existing) {
      existing.volume += entry.volume;
      existing.entryCount += 1;
      if (entry.note && !existing.note.includes(entry.note)) {
        existing.note = `${existing.note}；${entry.note}`;
      }
      continue;
    }
    groups.set(key, {
      key,
      sourceType: entry.sourceType,
      direction: entry.direction,
      volume: entry.volume,
      unit: entry.unit,
      entryCount: 1,
      reuse: isReuseEntry(entry),
      note: entry.note,
    });
  }

  const rows = [...groups.values()]
    .map((row) => ({ ...row, volume: round(row.volume, 2) }))
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === "in" ? -1 : 1;
      return b.volume - a.volume;
    });

  const totalIn = rows
    .filter((row) => row.direction === "in")
    .reduce((sum, row) => sum + row.volume, 0);
  const totalOut = rows
    .filter((row) => row.direction === "out")
    .reduce((sum, row) => sum + row.volume, 0);
  const reuseVolume = rows
    .filter((row) => row.reuse)
    .reduce((sum, row) => sum + row.volume, 0);
  const externalIn = rows
    .filter((row) => row.direction === "in" && row.sourceType.includes("自来水"))
    .reduce((sum, row) => sum + row.volume, 0);

  return {
    rows,
    totalIn: round(totalIn, 2),
    totalOut: round(totalOut, 2),
    reuseVolume: round(reuseVolume, 2),
    externalIn: round(externalIn, 2),
    externalOut: round(totalOut - reuseVolume, 2),
    difference: round(totalIn - totalOut, 2),
    note:
      "雨水收集按雨水口径计入进项；中水外供来自雨水回用，仅作为回用量单列，不再叠加为新增取水或外部补水。" +
      "账本净差为账面进−出，不等同于任一储水单元的储量变化；生活污水与含矿污水按各自口径单列，不重复计入中水。",
  };
}

/** 生成 CSV 文本（不含 BOM，下载时由调用方补齐）。 */
export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const escape = (value: string | number | null | undefined): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\n");
}

// RainEvent arrays share hour 1 as their first sample and a one-hour step.
// A missing/invalid region invalidates that step; never pair different hours.
export function rainStorage(event?: { north: readonly (number | null)[]; south: readonly (number | null)[] } | null) {
  const samples: { hour: number; north: number; south: number; total: number }[] = [];
  if (event) {
    for (let i = 0; i < Math.min(event.north.length, event.south.length); i++) {
      const north = event.north[i], south = event.south[i];
      if (typeof north === "number" && typeof south === "number" &&
          Number.isFinite(north) && Number.isFinite(south) && north >= 0 && south >= 0 &&
          Number.isFinite(north + south)) {
        samples.push({ hour: i + 1, north, south, total: round(north + south) });
      }
    }
  }
  const peak = samples.length ? Math.max(...samples.map(s => s.total)) : null;
  return { end: samples.at(-1) ?? null, peak, rise: peak === null ? null : round(peak - samples[0].total) };
}

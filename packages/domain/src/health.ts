import type { Asset, Health, HealthFactor, HealthSample, HealthTrend } from "@water/contracts";

// 演示参数，只适用于 SIM 标准负荷泵；未经现场标定。
const specs = [
  { key: "vibration", label: "振动", unit: "mm/s", start: 2, limit: 4.5, weight: 30 },
  { key: "temperature", label: "温度", unit: "℃", start: 55, limit: 75, weight: 20 },
  { key: "current", label: "电流", unit: "A", start: 100, limit: 130, weight: 15 },
] as const;
const round = (n: number) => Number(n.toFixed(2));
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
function factor(spec: Omit<HealthFactor, "value" | "deduction">, value: number | null): HealthFactor {
  return { ...spec, value: valid(value) ? value : null,
    deduction: valid(value) ? round(Math.max(0, Math.min(1, (value - spec.start) / (spec.limit - spec.start))) * spec.weight) : null };
}
function factors(asset: Asset, sample?: HealthSample): HealthFactor[] {
  return [
    ...specs.map(s => factor(s, sample?.[s.key] ?? null)),
    factor({ key: "runtime", label: "累计运行", unit: "h", start: 0, limit: 15000, weight: 13.2 }, asset.runtime),
    factor({ key: "starts", label: "启停次数", unit: "次", start: 0, limit: 3000, weight: 8.8 }, asset.healthTelemetry?.starts ?? null),
  ];
}
function score(rows: HealthFactor[], operating: boolean, fault: boolean) {
  if (!operating || rows.some(r => r.value === null)) return null;
  return round(Math.min(fault ? 35 : 100, Math.max(5, 100 - rows.reduce((n, r) => n + r.deduction!, 0))));
}
export function health(asset: Asset): Health {
  const telemetry = asset.healthTelemetry;
  const samples = telemetry?.samples ?? [];
  const last = samples.at(-1);
  const fs = factors(asset, last);
  const currentScore = score(fs, last?.operating === true, asset.status === "故障");
  const trends: HealthTrend[] = specs.map(spec => {
    const result: HealthTrend = { key: spec.key, label: spec.label, unit: spec.unit, threshold: spec.limit, slope: null, hoursToThreshold: null, status: "有效连续样本不足", points: [] };
    // 维修事件后重新观察；不跨越停机或缺测窗口拟合。
    const window = samples.slice(-12);
    if (window.length < 8 || window.some((p, i) => !p.operating || !valid(p[spec.key]) || !Number.isFinite(Date.parse(p.at)) || (telemetry?.maintenanceAt && Date.parse(p.at) < Date.parse(telemetry.maintenanceAt)) || (i > 0 && Math.abs(Date.parse(p.at) - Date.parse(window[i - 1]!.at) - 3600000) > 1000))) return result;
    const y = window.map(p => p[spec.key]!);
    const mean = y.reduce((a,b) => a+b,0)/y.length;
    const xMean = (y.length-1)/2;
    const slope = y.reduce((n,v,i) => n+(i-xMean)*(v-mean),0)/y.reduce((n,_,i) => n+(i-xMean)**2,0);
    result.slope = round(slope);
    const latest = y.at(-1)!;
    if (latest >= spec.limit) { result.status = "当前已达预警阈值"; result.hoursToThreshold = 0; return result; }
    const total = y.reduce((n,v) => n+(v-mean)**2,0);
    const residual = y.reduce((n,v,i) => n+(v-(mean+slope*(i-xMean)))**2,0);
    if (slope <= 0.001 || total === 0 || 1-residual/total < 0.8) { result.status = "未识别到持续上升趋势"; return result; }
    const hours = (spec.limit-latest)/slope;
    result.hoursToThreshold = hours <= 48 ? round(hours) : null;
    result.status = hours <= 48 ? "48 h 内预计达预警阈值" : "按当前趋势，48 h 内未达阈值";
    result.points = Array.from({length: 9}, (_,i) => ({hour: i*6, value: round(latest+slope*i*6)}));
    return result;
  });
  const earliest = trends.filter(t => t.hoursToThreshold !== null).sort((a,b) => a.hoursToThreshold!-b.hoursToThreshold!)[0];
  const forecastSummary = earliest ? earliest.hoursToThreshold === 0 ? `${earliest.label}当前已达预警阈值` : `${earliest.label}按当前趋势约 ${earliest.hoursToThreshold} h 后达到 ${earliest.threshold} ${earliest.unit} 预警阈值` : trends.every(t => t.status === "有效连续样本不足") ? "样本不足，暂不提供趋势外推" : "当前未识别到 48 h 内达阈值的持续上升趋势";
  const advice = currentScore === null ? "补齐运行状态和健康测点，核查采样连续性后重新评价。" : earliest ? "优先复核振动、轴承温度与负荷，安排现场检查；依据不足以判定具体故障。" : telemetry?.mode === "recovered" ? "维修后指标已回落，继续观察；累计运行和启停记录保留。" : "保持监测，按计划巡检；未发现趋势预警不代表无故障风险。";
  const energyComplete = valid(asset.energy) && valid(asset.volume) && asset.volume > 0;
  return {
    assetId: asset.id, name: asset.name, score: currentScore,
    grade: currentScore === null ? "待评价" : currentScore >= 80 ? "健康" : currentScore >= 60 ? "关注" : currentScore >= 40 ? "预警" : "危险",
    formulaVersion: "pump-health-2.0 / trend-1.0", dataMode: "SIM", mode: telemetry?.mode ?? null,
    evaluatedAt: last?.at ?? null, factors: fs,
    history: samples.map(p => ({...p, score: score(factors(asset,p),p.operating,false)})),
    trends, forecastSummary, advice, maintenanceAt: telemetry?.maintenanceAt ?? null,
    specificEnergy: energyComplete ? asset.energy! / asset.volume! : null,
    confidence: currentScore === null ? "健康输入不足或设备非运行状态" : "健康输入完整 / SIM 规则评价",
    reasons: [...fs.map(f => `${f.label} ${f.value ?? "缺测"} ${f.unit}，扣 ${f.deduction ?? "不可计算"} 分`), ...(asset.status === "故障" ? ["故障状态健康分封顶 35"] : []), "参数未经现场标定；历史评分采用当前累计使用量重算，仅用于展示监测指标变化；分数不是故障概率"],
    comparable: energyComplete && asset.type === "pump" && asset.condition === "同类泵/同计量边界/标准负荷",
  };
}

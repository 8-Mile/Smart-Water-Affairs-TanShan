import {
  RainInput,
  type RainParams,
  type RainResult,
} from "@water/contracts";
export function runRain(raw: RainParams): RainResult {
  const p = RainInput.parse(raw),
    inflow = ((p.rainMm / 1000) * p.areaM2 * p.coefficient) / p.hours;
  let volume = p.initial,
    totalOverflow = 0,
    totalOutflow = 0;
  const points = [{ hour: 0, volume, overflow: 0, outflow: 0 }];
  let firstRiskHour: number | null = volume >= p.capacity * 0.85 ? 0 : null;
  for (let hour = 1; hour <= p.hours; hour++) {
    const available = volume + inflow;
    const outflow = Math.min(p.outflow, available);
    const overflow = Math.max(0, available - outflow - p.capacity);
    volume = Math.min(p.capacity, Math.max(0, available - outflow));
    totalOverflow += overflow;
    totalOutflow += outflow;
    points.push({ hour, volume, overflow, outflow });
    if (firstRiskHour === null && volume >= p.capacity * 0.85)
      firstRiskHour = hour;
  }
  return {
    points,
    peak: Math.max(...points.map((x) => x.volume)),
    overflow: totalOverflow,
    totalInflow: inflow * p.hours,
    totalOutflow,
    firstRiskHour,
    formula:
      "V_next = clamp(V + Qin - Qout, 0, Capacity)，逐小时步长；超容量部分单独记录",
    assumptions: [
      "SIM 假设：降雨均匀分布",
      "汇水面积和径流系数为演示输入",
      "单汇总储水单元，不代表真实管网水动力",
      "85% 容量为演示风险阈值",
    ],
  };
}
export { health } from "./health";

export function supplyHours(storage: number, reserve: number, demand: number) {
  if (
    !Number.isFinite(storage) ||
    !Number.isFinite(reserve) ||
    !Number.isFinite(demand) ||
    storage < 0 ||
    reserve < 0 ||
    reserve > storage ||
    demand <= 0
  )
    throw new Error("无效供需参数");
  return (storage - reserve) / demand;
}

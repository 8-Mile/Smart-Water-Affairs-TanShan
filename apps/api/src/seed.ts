import { healthSimulation } from "./health-simulation";
import {
  processes,
  asOf,
  type ScenarioId,
  type ScenarioState,
  type Asset,
  type MetricRow,
} from "@water/contracts";
export function seed(id: ScenarioId, epoch = 1): ScenarioState {
  const assets: Asset[] = processes.flatMap((p, index) =>
    ["north", "south"].map((area, i) => ({
      id: `${p.id}-${i + 1}`,
      name: `${p.name}${i + 1}号${p.id === "medium-pressure" ? "泵" : "单元"}`,
      subsystemId: p.id,
      area,
      type:
        p.id === "medium-pressure"
          ? "pump"
          : p.id === "rainwater" || p.id === "pool"
            ? "storage"
            : "unit",
      status: "正常",
      volume: 400 + 20 * i,
      energy: 100 - 16 * i,
      runtime: 1200 + index * 120 + i * 240,
      pressure: p.id === "medium-pressure" ? 0.65 : null,
      faults: 0,
      condition: "同类泵/同计量边界/标准负荷",
      monitoring:
        p.id === "domestic" ? "详细工艺和水质测点待确认" : "SIM 固定种子",
    })),
  );
  assets.splice(3, 0, {
    ...assets[2]!,
    id: "medium-pressure-2n",
    name: "中压供水2号泵",
    area: "north",
    volume: 420,
    energy: 84,
    runtime: 800,
  });
  for (const a of assets.filter(a => a.type === "pump")) {
    a.healthTelemetry = healthSimulation(id === "SCN-PUMP" && a.id === "medium-pressure-2n" ? "degrading" : "normal");
  }
  const pump = assets.find((a) => a.id === "medium-pressure-2n")!;
  if (id === "SCN-PUMP") {
    pump.energy = 138;
    pump.faults = 2;
    pump.pressure = 0.42;
    pump.status = "警告";
  }
  if (id === "SCN-MINE")
    assets
      .filter((a) => a.subsystemId === "mining")
      .forEach((a) => {
        a.status = "警告";
        a.faults = 1;
      });
  if (id === "SCN-RAIN")
    assets
      .filter((a) => a.subsystemId === "rainwater")
      .forEach((a) => (a.status = "警告"));
  // 南区样本保留缺电耗场景，验证不可计算与区域隔离。
  if (id === "SCN-RAIN")
    assets.filter((a) => a.area === "south").forEach((a) => (a.energy = null));
  const alertAsset =
    id === "SCN-MINE"
      ? "mining-1"
      : id === "SCN-RAIN"
        ? "rainwater-1"
        : "medium-pressure-2n";
  return {
    id,
    epoch,
    assets,
    workorders: [],
    alarms:
      id === "SCN-BASE"
        ? []
        : [
            {
              id: `${id}-AL-01`,
              assetId: alertAsset,
              title:
                id === "SCN-PUMP"
                  ? "2号泵单位水电耗升高"
                  : id === "SCN-RAIN"
                    ? "模拟储量接近预警阈值"
                    : "模拟处理负荷升高",
              level: "重要",
              status: "new",
              history: [
                {
                  at: asOf,
                  actor: "模拟引擎",
                  action: "new",
                  note: "固定种子演示事件",
                },
              ],
            },
          ],
  };
}
export function rainRows(id: ScenarioId): MetricRow[] {
  return [1, 2, 3].flatMap((event) =>
    ["north", "south"].map((area, i) => ({
      label: `雨次 ${event}`,
      area,
      value: (300 + event * 110 + i * 80) * (id === "SCN-RAIN" ? 1.7 : 1),
      energy: id === "SCN-RAIN" ? null : 30 + event * 8 + i * 4,
    })),
  );
}

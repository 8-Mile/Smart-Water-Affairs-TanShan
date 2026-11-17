import { runRain, type RainRunParams } from "./water";
import type {
  Alarm,
  Asset,
  AssetStatus,
  DailyWaterRecord,
  DocumentRef,
  InspectionRecord,
  LedgerEntry,
  MaintenanceRecord,
  MeasurePoint,
  ProcessBinding,
  RainEvent,
  ScenarioId,
  ScenarioSeed,
  SubsystemSummary,
  WorkOrder,
} from "./types";

export const REFERENCE_TIME = "2026-11-14T08:00:00+08:00";
export const SEED_VERSION = "seed-r1-v1";

const REFERENCE_MS = Date.parse(REFERENCE_TIME);
const HOUR = 3_600_000;

function isoAt(offsetHours: number): string {
  return new Date(REFERENCE_MS + offsetHours * HOUR).toISOString();
}

export const SUBSYSTEMS: SubsystemSummary[] = [
  {
    id: "spray",
    name: "射雾器除尘",
    description: "港区散货堆场射雾器除尘系统，示意末端压力与运行台数。",
    metric: "末端压力",
    unit: "MPa",
    base: 0.58,
  },
  {
    id: "medium-pressure",
    name: "中压供水",
    description: "中压供水泵组，主泵 P-002 为健康趋势诊断对象。",
    metric: "出口压力",
    unit: "MPa",
    base: 1.2,
  },
  {
    id: "mining",
    name: "含矿污水处理",
    description: "含矿污水处理单元，示意加药与污泥输送。",
    metric: "处理负荷",
    unit: "m³/h",
    base: 120,
  },
  {
    id: "rainwater",
    name: "雨水收集",
    description: "雨水收集池与回用泵，库容数据按雨次模拟。",
    metric: "当前库容",
    unit: "m³",
    base: 8600,
  },
  {
    id: "pool",
    name: "水池供水",
    description: "生产水池供水系统，示意有效可用量与补水状态。",
    metric: "有效可用量",
    unit: "m³",
    base: 3200,
  },
  {
    id: "domestic",
    name: "生活污水收集与外送",
    description: "港区生活污水收集、外送交接及外部处理责任示意，现场建设范围待核实。",
    metric: "处理量",
    unit: "m³/d",
    base: 480,
  },
];

interface AssetInput {
  code: string;
  name: string;
  subsystemId: string;
  type: string;
  area: "north" | "south";
  status: AssetStatus;
  runtimeHours: number;
  startCount: number;
  powerKw: number;
  flowM3h: number;
  headM: number;
  model: string;
  installedAt: string;
  condition?: string;
  processNodeId?: string;
}

function demoAsset(input: AssetInput): Asset {
  return {
    id: `asset-${input.code.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    code: input.code,
    name: input.name,
    subsystemId: input.subsystemId,
    processNodeId: input.processNodeId,
    type: input.type,
    rated: {
      powerKw: input.powerKw,
      flowM3h: input.flowM3h,
      headM: input.headM,
    },
    status: input.status,
    source: "MOCK",
    area: input.area,
    runtimeHours: input.runtimeHours,
    startCount: input.startCount,
    manufacturer: "DEMO 模拟设备厂商",
    model: input.model,
    owner: input.area === "north" ? "北区运维班（模拟）" : "南区运维班（模拟）",
    installedAt: input.installedAt,
    archived: false,
    condition: input.condition,
  };
}

interface PointSpec {
  key: string;
  label: string;
  kind: "number" | "enum";
  unit?: string;
  range?: [number, number];
  baseline?: number;
  volatility?: number;
  enumStates?: string[];
  samplePeriodMinutes?: number;
}

function makePoints(assetId: string, specs: PointSpec[]): MeasurePoint[] {
  return specs.map((spec) => ({
    id: `${assetId}-${spec.key}`,
    assetId,
    label: spec.label,
    kind: spec.kind,
    unit: spec.unit,
    range: spec.range,
    source: "MOCK",
    quality: "valid",
    samplePeriodMinutes: spec.samplePeriodMinutes ?? 30,
    baseline: spec.baseline,
    volatility: spec.volatility,
    enumStates: spec.enumStates,
  }));
}

function statusPoint(assetId: string): MeasurePoint {
  return {
    id: `${assetId}-status`,
    assetId,
    label: "运行状态",
    kind: "enum",
    source: "MOCK",
    quality: "valid",
    samplePeriodMinutes: 30,
    enumStates: ["running", "stopped", "fault"],
    baseline: 1,
  };
}

function buildAssets(scenarioId: ScenarioId): Asset[] {
  const pumpStatus: AssetStatus = scenarioId === "SCN-PUMP-FAULT" ? "fault" : "running";
  return [
    demoAsset({
      code: "SP-001",
      name: "1号射雾器",
      subsystemId: "spray",
      type: "射雾器",
      area: "north",
      status: "running",
      runtimeHours: 5820,
      startCount: 412,
      powerKw: 15,
      flowM3h: 32,
      headM: 60,
      model: "DEMO-SP-15",
      installedAt: "2024-06-12",
      processNodeId: "spray-node-1",
    }),
    demoAsset({
      code: "SP-002",
      name: "2号射雾器",
      subsystemId: "spray",
      type: "射雾器",
      area: "north",
      status: scenarioId === "SCN-YARD-STOP" ? "stopped" : "running",
      runtimeHours: 5610,
      startCount: 398,
      powerKw: 15,
      flowM3h: 32,
      headM: 60,
      model: "DEMO-SP-15",
      installedAt: "2024-06-12",
      condition: scenarioId === "SCN-YARD-STOP" ? "作业结束后按计划停机待核查" : undefined,
      processNodeId: "spray-node-2",
    }),
    demoAsset({
      code: "SP-003",
      name: "3号射雾器",
      subsystemId: "spray",
      type: "射雾器",
      area: "south",
      status: "stopped",
      runtimeHours: 4230,
      startCount: 305,
      powerKw: 15,
      flowM3h: 30,
      headM: 58,
      model: "DEMO-SP-15",
      installedAt: "2024-09-03",
      condition: "计划停机保养",
      processNodeId: "spray-node-3",
    }),
    demoAsset({
      code: "SP-004",
      name: "4号射雾器",
      subsystemId: "spray",
      type: "射雾器",
      area: "south",
      status: "running",
      runtimeHours: 4870,
      startCount: 342,
      powerKw: 18.5,
      flowM3h: 36,
      headM: 62,
      model: "DEMO-SP-18",
      installedAt: "2025-03-18",
      processNodeId: "spray-node-4",
    }),
    demoAsset({
      code: "P-001",
      name: "中压供水1号泵",
      subsystemId: "medium-pressure",
      type: "离心泵",
      area: "north",
      status: "running",
      runtimeHours: 9120,
      startCount: 655,
      powerKw: 75,
      flowM3h: 320,
      headM: 72,
      model: "DEMO-MP-75",
      installedAt: "2023-11-20",
      processNodeId: "mp-node-1",
    }),
    demoAsset({
      code: "P-002",
      name: "中压供水2号泵",
      subsystemId: "medium-pressure",
      type: "离心泵",
      area: "north",
      status: pumpStatus,
      runtimeHours: 10840,
      startCount: 782,
      powerKw: 75,
      flowM3h: 330,
      headM: 74,
      model: "DEMO-MP-75",
      installedAt: "2023-11-20",
      condition:
        scenarioId === "SCN-PUMP-FAULT"
          ? "振动持续上升，待现场核查"
          : "主泵运行，健康趋势观察中",
      processNodeId: "mp-node-2",
    }),
    demoAsset({
      code: "P-004",
      name: "中压供水备用泵",
      subsystemId: "medium-pressure",
      type: "离心泵",
      area: "south",
      status: "stopped",
      runtimeHours: 2140,
      startCount: 96,
      powerKw: 75,
      flowM3h: 315,
      headM: 72,
      model: "DEMO-MP-75",
      installedAt: "2024-04-08",
      condition: "热备",
      processNodeId: "mp-node-3",
    }),
    demoAsset({
      code: "MP-001",
      name: "加药泵",
      subsystemId: "mining",
      type: "计量泵",
      area: "north",
      status: "running",
      runtimeHours: 3560,
      startCount: 240,
      powerKw: 2.2,
      flowM3h: 12,
      headM: 30,
      model: "DEMO-DP-2",
      installedAt: "2024-08-15",
      processNodeId: "mining-node-1",
    }),
    demoAsset({
      code: "MP-002",
      name: "污泥泵",
      subsystemId: "mining",
      type: "螺杆泵",
      area: "south",
      status: "running",
      runtimeHours: 4210,
      startCount: 286,
      powerKw: 11,
      flowM3h: 45,
      headM: 36,
      model: "DEMO-SP-11",
      installedAt: "2024-08-15",
      processNodeId: "mining-node-2",
    }),
    demoAsset({
      code: "RW-001",
      name: "雨水提升泵",
      subsystemId: "rainwater",
      type: "潜水泵",
      area: "north",
      status: "running",
      runtimeHours: 2380,
      startCount: 158,
      powerKw: 22,
      flowM3h: 180,
      headM: 28,
      model: "DEMO-RW-22",
      installedAt: "2024-05-10",
      processNodeId: "rain-node-1",
    }),
    demoAsset({
      code: "RW-002",
      name: "雨水回用泵",
      subsystemId: "rainwater",
      type: "离心泵",
      area: "south",
      status: "stopped",
      runtimeHours: 1960,
      startCount: 121,
      powerKw: 18.5,
      flowM3h: 120,
      headM: 42,
      model: "DEMO-RW-18",
      installedAt: "2024-05-10",
      processNodeId: "rain-node-2",
    }),
    demoAsset({
      code: "PW-001",
      name: "水池供水泵",
      subsystemId: "pool",
      type: "离心泵",
      area: "north",
      status: "running",
      runtimeHours: 6740,
      startCount: 452,
      powerKw: 15,
      flowM3h: 95,
      headM: 45,
      model: "DEMO-PW-15",
      installedAt: "2023-12-02",
      processNodeId: "pool-node-1",
    }),
    demoAsset({
      code: "PW-002",
      name: "水池补水泵",
      subsystemId: "pool",
      type: "离心泵",
      area: "south",
      status: "stopped",
      runtimeHours: 3180,
      startCount: 210,
      powerKw: 11,
      flowM3h: 60,
      headM: 38,
      model: "DEMO-PW-11",
      installedAt: "2024-01-18",
      processNodeId: "pool-node-2",
    }),
    demoAsset({
      code: "DW-001",
      name: "曝气风机",
      subsystemId: "domestic",
      type: "罗茨风机",
      area: "north",
      status: "running",
      runtimeHours: 8120,
      startCount: 188,
      powerKw: 30,
      flowM3h: 1560,
      headM: 0.8,
      model: "DEMO-AB-30",
      installedAt: "2023-10-26",
      processNodeId: "domestic-node-1",
    }),
    demoAsset({
      code: "DW-002",
      name: "污水提升泵",
      subsystemId: "domestic",
      type: "潜水泵",
      area: "south",
      status: "running",
      runtimeHours: 5960,
      startCount: 640,
      powerKw: 7.5,
      flowM3h: 55,
      headM: 22,
      model: "DEMO-DW-7",
      installedAt: "2023-10-26",
      processNodeId: "domestic-node-2",
    }),
  ];
}

const STATUS_STATES = ["running", "stopped", "fault"];

function buildPoints(scenarioId: ScenarioId): MeasurePoint[] {
  const points: MeasurePoint[] = [];

  for (const code of ["SP-001", "SP-002", "SP-003", "SP-004"]) {
    const assetId = `asset-${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const lowPressure = scenarioId === "SCN-PUMP-FAULT" && code === "SP-004";
    const faultScenario = scenarioId === "SCN-PUMP-FAULT";
    const stoppedDevice = code === "SP-003" || (scenarioId === "SCN-YARD-STOP" && code === "SP-002");
    const flowBaseline = stoppedDevice ? 0 : lowPressure ? 16 : faultScenario ? 26 : 32;
    points.push(
      ...makePoints(assetId, [
        { key: "pressure", label: "末端压力", kind: "number", unit: "MPa", range: [0, 1.2], baseline: lowPressure ? 0.28 : faultScenario ? 0.47 : 0.58, volatility: 0.02, samplePeriodMinutes: 30 },
        { key: "flow", label: "喷射流量", kind: "number", unit: "m³/h", range: [0, 50], baseline: flowBaseline, volatility: stoppedDevice ? 0 : 1.2, samplePeriodMinutes: 30 },
        { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 60], baseline: stoppedDevice ? 0 : 18, volatility: 0.6, samplePeriodMinutes: 30 },
      ]),
      statusPoint(assetId),
    );
  }

  points.push(
    ...makePoints("asset-p001", [
      { key: "pressure", label: "出口压力", kind: "number", unit: "MPa", range: [0, 2], baseline: 1.25, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "flow", label: "出口流量", kind: "number", unit: "m³/h", range: [0, 500], baseline: 320, volatility: 4, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 200], baseline: 96, volatility: 1.5, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-p001"),
  );

  points.push(
    ...makePoints("asset-p002", [
      { key: "vibration", label: "振动速度", kind: "number", unit: "mm/s", range: [0, 10], baseline: 2.1, volatility: 0.15, samplePeriodMinutes: 360 },
      { key: "temperature", label: "轴承温度", kind: "number", unit: "℃", range: [0, 100], baseline: 62, volatility: 1.2, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 200], baseline: 105, volatility: 1.6, samplePeriodMinutes: 30 },
      { key: "pressure", label: "出口压力", kind: "number", unit: "MPa", range: [0, 2], baseline: 1.18, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "flow", label: "出口流量", kind: "number", unit: "m³/h", range: [0, 500], baseline: 320, volatility: 5, samplePeriodMinutes: 30 },
    ]),
    {
      id: "asset-p002-status",
      assetId: "asset-p002",
      label: "运行状态",
      kind: "enum",
      source: "MOCK",
      quality: "valid",
      samplePeriodMinutes: 30,
      enumStates: STATUS_STATES,
      baseline: scenarioId === "SCN-PUMP-FAULT" ? 3 : 1,
    },
  );

  points.push(
    ...makePoints("asset-p004", [
      { key: "pressure", label: "出口压力", kind: "number", unit: "MPa", range: [0, 2], baseline: 1.16, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "flow", label: "出口流量", kind: "number", unit: "m³/h", range: [0, 500], baseline: 300, volatility: 4, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 200], baseline: 88, volatility: 1.4, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-p004"),
  );

  points.push(
    ...makePoints("asset-mp001", [
      { key: "flow", label: "加药流量", kind: "number", unit: "m³/h", range: [0, 30], baseline: 12, volatility: 0.5, samplePeriodMinutes: 30 },
      { key: "pressure", label: "出口压力", kind: "number", unit: "MPa", range: [0, 1], baseline: 0.45, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 20], baseline: 9.5, volatility: 0.4, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-mp001"),
  );

  points.push(
    ...makePoints("asset-mp002", [
      { key: "flow", label: "污泥流量", kind: "number", unit: "m³/h", range: [0, 80], baseline: 45, volatility: 1.8, samplePeriodMinutes: 30 },
      { key: "pressure", label: "出口压力", kind: "number", unit: "MPa", range: [0, 1], baseline: 0.38, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 60], baseline: 22, volatility: 0.8, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-mp002"),
  );

  points.push(
    ...makePoints("asset-rw001", [
      { key: "flow", label: "提升流量", kind: "number", unit: "m³/h", range: [0, 260], baseline: 180, volatility: 3.5, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 60], baseline: 30, volatility: 1, samplePeriodMinutes: 30 },
      { key: "level", label: "集水池液位", kind: "number", unit: "%", range: [0, 100], baseline: 62, volatility: 2, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-rw001"),
  );

  points.push(
    ...makePoints("asset-rw002", [
      { key: "flow", label: "回用流量", kind: "number", unit: "m³/h", range: [0, 200], baseline: 120, volatility: 2.6, samplePeriodMinutes: 30 },
      { key: "pressure", label: "回用压力", kind: "number", unit: "MPa", range: [0, 1], baseline: 0.5, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 50], baseline: 24, volatility: 0.8, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-rw002"),
  );

  points.push(
    ...makePoints("asset-pw001", [
      { key: "flow", label: "供水流量", kind: "number", unit: "m³/h", range: [0, 160], baseline: 95, volatility: 2, samplePeriodMinutes: 30 },
      { key: "pressure", label: "供水压力", kind: "number", unit: "MPa", range: [0, 1], baseline: 0.52, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 40], baseline: 19, volatility: 0.6, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-pw001"),
  );

  points.push(
    ...makePoints("asset-pw002", [
      { key: "flow", label: "补水流量", kind: "number", unit: "m³/h", range: [0, 120], baseline: 60, volatility: 1.6, samplePeriodMinutes: 30 },
      { key: "pressure", label: "补水压力", kind: "number", unit: "MPa", range: [0, 1], baseline: 0.48, volatility: 0.02, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 30], baseline: 12, volatility: 0.5, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-pw002"),
  );

  points.push(
    ...makePoints("asset-dw001", [
      { key: "airflow", label: "曝气风量", kind: "number", unit: "m³/min", range: [0, 50], baseline: 26, volatility: 1.2, samplePeriodMinutes: 30 },
      { key: "pressure", label: "出口风压", kind: "number", unit: "MPa", range: [0, 0.3], baseline: 0.06, volatility: 0.003, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 80], baseline: 38, volatility: 1.2, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-dw001"),
  );

  points.push(
    ...makePoints("asset-dw002", [
      { key: "flow", label: "提升流量", kind: "number", unit: "m³/h", range: [0, 100], baseline: 55, volatility: 1.5, samplePeriodMinutes: 30 },
      { key: "current", label: "电机电流", kind: "number", unit: "A", range: [0, 30], baseline: 14, volatility: 0.5, samplePeriodMinutes: 30 },
      { key: "level", label: "集水井液位", kind: "number", unit: "%", range: [0, 100], baseline: 48, volatility: 2, samplePeriodMinutes: 30 },
    ]),
    statusPoint("asset-dw002"),
  );

  return points;
}

const BINDING_POSITIONS: Record<string, [number, number]> = {
  "asset-sp001": [0.16, 0.32],
  "asset-sp002": [0.38, 0.3],
  "asset-sp003": [0.58, 0.36],
  "asset-sp004": [0.78, 0.4],
  "asset-p001": [0.2, 0.46],
  "asset-p002": [0.44, 0.46],
  "asset-p004": [0.64, 0.52],
  "asset-mp001": [0.26, 0.42],
  "asset-mp002": [0.58, 0.42],
  "asset-rw001": [0.3, 0.52],
  "asset-rw002": [0.62, 0.56],
  "asset-pw001": [0.3, 0.46],
  "asset-pw002": [0.6, 0.5],
  "asset-dw001": [0.28, 0.42],
  "asset-dw002": [0.6, 0.46],
};

function buildBindings(assets: Asset[]): ProcessBinding[] {
  return assets.map((asset, index) => {
    const position = BINDING_POSITIONS[asset.id] ?? [0.2 + (index % 4) * 0.18, 0.3 + Math.floor(index / 4) * 0.15];
    return {
      id: `bind-${asset.code.toLowerCase()}`,
      subsystemId: asset.subsystemId,
      assetId: asset.id,
      backgroundId: `bg-${asset.subsystemId}`,
      xPct: position[0],
      yPct: position[1],
      nodeId: asset.processNodeId,
      label: asset.name,
      verifiedPhysicalLink: false,
    };
  });
}

function buildDocuments(): DocumentRef[] {
  const updatedAt = isoAt(-6 * 24);
  return [
    {
      id: "DOC-P002-MANUAL",
      title: "中压供水2号泵使用说明（演示片段）",
      version: "V1.0-demo",
      assetIds: ["asset-p002"],
      kind: "manual",
      reviewed: true,
      source: "demo",
      sourceLabel: "DEMO模拟档案",
      updatedAt,
      summary: "演示用运行检查片段，说明振动、温度与电流的日常观察项。",
      contentExcerpt:
        "本片段为演示档案，不引用任何真实厂家原文。运行前应确认泵体无异响、地脚螺栓无松动；连续运行期间记录振动速度与轴承温度，若振动持续上升或伴随异常噪声，应安排停机检查并核对联轴器对中状态。",
      lineOrSection: "第2章 运行检查 / 2.3 振动与温度",
      fileType: "Markdown",
    },
    {
      id: "DOC-P002-INSPECT",
      title: "中压供水泵巡检清单（演示版）",
      version: "V1.2-demo",
      assetIds: ["asset-p002", "asset-p001"],
      kind: "inspection-standard",
      reviewed: true,
      source: "demo",
      sourceLabel: "DEMO模拟档案",
      updatedAt,
      summary: "泵组日常巡检项目与判定口径，用于演示巡检记录与证据引用。",
      contentExcerpt:
        "演示巡检清单：1）泵体与管路有无异响；2）振动速度是否在观察阈值内；3）轴承温度是否稳定；4）机械密封有无渗漏；5）电流是否与工况匹配。任一项异常时记录数值并转工单核查。",
      lineOrSection: "检查项 3-5",
      fileType: "Markdown",
    },
    {
      id: "DOC-P002-CASE",
      title: "2号泵联轴器对中维修案例（演示）",
      version: "V1.0-demo",
      assetIds: ["asset-p002"],
      kind: "case",
      reviewed: true,
      source: "demo",
      sourceLabel: "DEMO模拟档案",
      updatedAt,
      summary: "历史已验收维修案例，记录振动升高后的处理措施与复测结果。",
      contentExcerpt:
        "演示案例：巡检发现振动速度较基线上升并伴随轻微异响，复查联轴器对中偏差后重新对中，复测振动回落至基线附近。案例仅用于演示证据链，不代表真实设备结论。",
      lineOrSection: "案例编号 CASE-DEMO-2025-07",
      fileType: "Markdown",
    },
    {
      id: "DOC-P002-DRAWING",
      title: "2号泵基础布置示意图（未审核）",
      version: "V0.9-demo",
      assetIds: ["asset-p002"],
      kind: "drawing",
      reviewed: false,
      source: "demo",
      sourceLabel: "DEMO模拟档案",
      updatedAt,
      summary: "演示用布置示意图，未完成技术审核，不建议作为判断依据。",
      contentExcerpt:
        "示意图仅标注泵体、联轴器与基础方位，尺寸与现场可能存在差异，尚未审核，不得作为施工依据。",
      lineOrSection: "图号 DWG-DEMO-P002-01",
      fileType: "SVG",
    },
  ];
}

function buildInspections(): InspectionRecord[] {
  return [
    {
      id: "INS-P002-01",
      assetId: "asset-p002",
      inspectedAt: isoAt(-52),
      inspector: "值班运行员·李工（模拟）",
      items: [
        { label: "泵体异响", value: "运行中有轻微异响", abnormal: true },
        { label: "振动速度", value: "3.6 mm/s，高于基线", abnormal: true },
        { label: "轴承温度", value: "68 ℃，观察中", abnormal: false },
        { label: "机械密封渗漏", value: "无渗漏", abnormal: false },
        { label: "电流", value: "116 A，较基线偏高", abnormal: true },
      ],
      result: "abnormal",
      note: "已建议转工单核查联轴器对中与轴承状态。",
      attachmentRefs: ["DOC-P002-INSPECT"],
    },
    {
      id: "INS-P002-02",
      assetId: "asset-p002",
      inspectedAt: isoAt(-240),
      inspector: "运维人员·王工（模拟）",
      items: [
        { label: "泵体异响", value: "无异响", abnormal: false },
        { label: "振动速度", value: "2.2 mm/s", abnormal: false },
        { label: "轴承温度", value: "61 ℃", abnormal: false },
        { label: "机械密封渗漏", value: "无渗漏", abnormal: false },
        { label: "电流", value: "104 A", abnormal: false },
      ],
      result: "normal",
      note: "例行巡检，各项在观察范围内。",
    },
  ];
}

function buildMaintenance(): MaintenanceRecord[] {
  return [
    {
      id: "MNT-P002-01",
      assetId: "asset-p002",
      kind: "repair",
      at: isoAt(-96),
      summary: "联轴器重新对中并复测振动，振动由 3.4 mm/s 回落至 2.3 mm/s。",
      materials: "对中垫片（模拟）、紧固件（模拟）",
      workOrderId: "wo-2026-011",
    },
    {
      id: "MNT-SP001-01",
      assetId: "asset-sp001",
      kind: "maintenance",
      at: isoAt(-360),
      summary: "射雾器喷嘴清洗与过滤网检查，压力恢复正常。",
      materials: "过滤网（模拟）",
    },
  ];
}

function buildWorkOrders(scenarioId: ScenarioId): WorkOrder[] {
  const archived: WorkOrder = {
    id: "wo-2026-011",
    code: "WO-2026-011",
    title: "2号泵振动趋势上升检查",
    assetId: "asset-p002",
    source: "health_trend",
    triggerSnapshot: {
      rangeFrom: isoAt(-14 * 24),
      rangeTo: isoAt(-24),
      pointId: "asset-p002-vibration",
      threshold: 3.5,
    },
    evidenceIds: ["DOC-P002-MANUAL", "DOC-P002-CASE", "INS-P002-02"],
    symptom: "近14日振动速度由约2.1 mm/s上升至3.4 mm/s，电流同步抬升。",
    suggestion: "核对联轴器对中、地脚螺栓与轴承状态，复测振动与电流。",
    status: "archived",
    priority: "high",
    createdBy: "系统管理员·陈工（模拟）",
    createdAt: isoAt(-240),
    assignee: "运维人员·王工（模拟）",
    result: {
      cause: "联轴器对中偏差，运行中振动逐步升高。",
      measures: "重新对中，检查并紧固地脚螺栓，复测振动与电流。",
      materials: "对中垫片（模拟）、紧固件（模拟）",
      note: "复测振动回落至 2.3 mm/s，电流恢复至 106 A。",
      submittedAt: isoAt(-120),
      submittedBy: "运维人员·王工（模拟）",
    },
    acceptance: {
      accepted: true,
      at: isoAt(-96),
      by: "管理者·赵工（模拟）",
      note: "处理记录完整，复测数据可追溯，同意归档。",
    },
    history: [
      { at: isoAt(-240), action: "create", by: "系统管理员·陈工（模拟）", note: "由健康趋势创建工单草稿。" },
      { at: isoAt(-216), action: "submit", by: "系统管理员·陈工（模拟）", note: "提交待派单。" },
      { at: isoAt(-200), action: "start", by: "运维人员·王工（模拟）", note: "接单开始维修。" },
      { at: isoAt(-120), action: "complete", by: "运维人员·王工（模拟）", note: "提交维修结果，待验收。" },
      { at: isoAt(-96), action: "accept", by: "管理者·赵工（模拟）", note: "验收通过并归档。" },
    ],
  };

  const activeStatus = scenarioId === "SCN-PUMP-FAULT" ? "pending_acceptance" : "in_progress";
  const activeHistory = [
    { at: isoAt(-48), action: "create", by: "值班运行员·李工（模拟）", note: "由异常巡检记录创建。" },
    { at: isoAt(-44), action: "submit", by: "值班运行员·李工（模拟）", note: "提交待派单。" },
    { at: isoAt(-40), action: "start", by: "运维人员·王工（模拟）", note: "接单开始核查。" },
  ];
  if (activeStatus === "pending_acceptance") {
    activeHistory.push({
      at: isoAt(-10),
      action: "complete",
      by: "运维人员·王工（模拟）",
      note: "已完成初步处理，提交验收。",
    });
  }

  const active: WorkOrder = {
    id: "wo-2026-014",
    code: "WO-2026-014",
    title: "2号泵巡检异响与振动偏高处理",
    assetId: "asset-p002",
    source: "inspection",
    alarmId: "ALM-P002-01",
    evidenceIds: ["INS-P002-01", "DOC-P002-MANUAL"],
    symptom: "巡检发现轻微异响，振动速度 3.6 mm/s，电流 116 A，均高于基线。",
    suggestion: "现场复核联轴器与轴承，记录振动、温度、电流复测值。",
    status: activeStatus,
    priority: "high",
    createdBy: "值班运行员·李工（模拟）",
    createdAt: isoAt(-48),
    assignee: "运维人员·王工（模拟）",
    result:
      activeStatus === "pending_acceptance"
        ? {
            cause: "初步判断为轴承润滑不足并伴随轻微对中偏差。",
            measures: "补充润滑脂，复测振动与温度，持续观察。",
            materials: "润滑脂（模拟）",
            note: "振动降至 3.1 mm/s，仍需跟踪。",
            submittedAt: isoAt(-10),
            submittedBy: "运维人员·王工（模拟）",
          }
        : undefined,
    history: activeHistory,
  };

  return [archived, active];
}

function buildAlarms(scenarioId: ScenarioId): Alarm[] {
  const alarms: Alarm[] = [
    {
      id: "ALM-P002-01",
      code: "ALM-P002-01",
      assetId: "asset-p002",
      pointId: "asset-p002-vibration",
      subsystemId: "medium-pressure",
      level: "warning",
      kind: "production",
      title: "中压供水2号泵振动偏高",
      detail:
        "振动速度连续多个采样点高于观察阈值 3.5 mm/s，电流同步偏高，建议按工单核查。",
      occurredAt: isoAt(-52),
      status: "active",
      workOrderId: "wo-2026-014",
    },
    {
      id: "ALM-MINING-01",
      code: "ALM-MINING-01",
      assetId: "asset-mp001",
      subsystemId: "mining",
      level: "info",
      kind: "business",
      title: "含矿污水加药量接近月度预算",
      detail: "按当前加药流量估算，本月药剂消耗将达到预算的 92%，请关注成本口径。",
      occurredAt: isoAt(-8),
      status: "active",
    },
  ];

  if (scenarioId === "SCN-PUMP-FAULT") {
    alarms.push({
      id: "ALM-P002-02",
      code: "ALM-P002-02",
      assetId: "asset-p002",
      pointId: "asset-p002-current",
      subsystemId: "medium-pressure",
      level: "critical",
      kind: "production",
      title: "2号泵电流持续抬升",
      detail: "电流由约105 A上升至128 A，伴随振动升高，已进入故障演示场景。",
      occurredAt: isoAt(-24),
      status: "active",
      workOrderId: "wo-2026-014",
    });
    alarms.push({
      id: "ALM-SP004-01",
      code: "ALM-SP004-01",
      assetId: "asset-sp004",
      pointId: "asset-sp004-pressure",
      subsystemId: "spray",
      level: "warning",
      kind: "production",
      title: "4号射雾器末端压力偏低",
      detail:
        "末端压力连续多个采样点低于演示关注阈值 0.45 MPa，喷射流量同步下降，需核查供水侧或压力测点。",
      occurredAt: isoAt(-35),
      status: "active",
    });
  }

  if (scenarioId === "SCN-RAIN") {
    alarms.push({
      id: "ALM-RW-01",
      code: "ALM-RW-01",
      assetId: "asset-rw001",
      subsystemId: "rainwater",
      level: "warning",
      kind: "production",
      title: "雨水收集池液位接近高限",
      detail: "受近期降雨影响，集水池液位达到 86%，建议关注提升泵运行与库容。",
      occurredAt: isoAt(-12),
      status: "active",
    });
  }

  if (scenarioId === "SCN-MINING") {
    alarms.push({
      id: "ALM-MP-02",
      code: "ALM-MP-02",
      assetId: "asset-mp002",
      pointId: "asset-mp002-pressure",
      subsystemId: "mining",
      level: "warning",
      kind: "production",
      title: "污泥泵出口压力波动",
      detail: "出口压力波动幅度较基线增大，建议检查管路与泵体磨损情况。",
      occurredAt: isoAt(-18),
      status: "active",
    });
  }

  return alarms;
}

const RAIN_FACTOR: Record<ScenarioId, number> = {
  "SCN-NORMAL": 1,
  "SCN-PUMP-FAULT": 1,
  "SCN-RAIN": 1.24,
  "SCN-MINING": 0.92,
  "SCN-YARD-STOP": 1,
};

function buildRainEvents(scenarioId: ScenarioId): RainEvent[] {
  const factor = RAIN_FACTOR[scenarioId];
  const defs = [
    { id: "RAIN-2026-08-01", occurredAt: "2026-08-01T15:00:00+08:00", rainfallMm: 26, seed: "rain-0801" },
    { id: "RAIN-2026-08-18", occurredAt: "2026-08-18T09:30:00+08:00", rainfallMm: 41, seed: "rain-0818" },
    { id: "RAIN-2026-09-02", occurredAt: "2026-09-02T20:00:00+08:00", rainfallMm: 18, seed: "rain-0902" },
  ];
  return defs.map((def) => {
    // Independent hypothetical catchments. None of these values are confirmed engineering data.
    const rainfallMm = Number((def.rainfallMm * factor).toFixed(2));
    const common = { rainMm: rainfallMm, hours: 12 };
    const north: RainRunParams = { ...common, areaM2: 160000, runoffCoefficient: 0.625, capacityM3: 3600, initialStorageM3: 900, outflowM3h: 110 };
    const south: RainRunParams = { ...common, areaM2: 125000, runoffCoefficient: 0.64, capacityM3: 2800, initialStorageM3: 816, outflowM3h: 90 };
    const northRun = runRain(north), southRun = runRain(south);
    return {
      id: def.id,
      name: `${def.occurredAt.slice(0, 10)} 降雨过程`,
      occurredAt: def.occurredAt,
      rainfallMm,
      north: northRun.volume,
      south: southRun.volume,
      simulation: { north, south, northOverflow: northRun.overflow, southOverflow: southRun.overflow },
      unit: "m³",
      source: "MOCK",
    };
  });
}

function buildLedger(scenarioId: ScenarioId): LedgerEntry[] {
  const factor = RAIN_FACTOR[scenarioId];
  return [
    {
      id: "LED-2026-11-01",
      period: "2026-11",
      sourceType: "雨水",
      direction: "in",
      volume: Math.round(12600 * factor),
      unit: "m³",
      note: "口径：雨水收集池进水，按雨次模拟折算，不含外调水。",
      source: "CALCULATED",
    },
    {
      id: "LED-2026-11-02",
      period: "2026-11",
      sourceType: "中水",
      direction: "out",
      volume: Math.round(8400 * factor),
      unit: "m³",
      note: "口径：回用中水外供量，重复利用水量不计入自来水取水。",
      source: "MOCK",
    },
    {
      id: "LED-2026-11-03",
      period: "2026-11",
      sourceType: "自来水",
      direction: "in",
      volume: 3100,
      unit: "m³",
      note: "口径：市政自来水补水，按计量表模拟值。",
      source: "REFERENCE",
    },
    {
      id: "LED-2026-11-04",
      period: "2026-11",
      sourceType: "生活污水",
      direction: "out",
      volume: 5200,
      unit: "m³",
      note: "口径：生活污水处理后达标排放，不含雨水溢流。",
      source: "MOCK",
    },
    {
      id: "LED-2026-11-05",
      period: "2026-11",
      sourceType: "含矿污水",
      direction: "out",
      volume: 6100,
      unit: "m³",
      note: "口径：含矿污水处理后回用，与中水口径不重复计入。",
      source: "MOCK",
    },
  ];
}

export function buildSeed(scenarioId: ScenarioId): ScenarioSeed {
  const assets = buildAssets(scenarioId);
  return {
    seedVersion: SEED_VERSION,
    scenarioId,
    referenceTime: REFERENCE_TIME,
    subsystems: SUBSYSTEMS.map((item) => ({ ...item })),
    assets,
    points: buildPoints(scenarioId),
    bindings: buildBindings(assets),
    documents: buildDocuments(),
    alarms: buildAlarms(scenarioId),
    workorders: buildWorkOrders(scenarioId),
    inspections: buildInspections(),
    maintenance: buildMaintenance(),
    rainEvents: buildRainEvents(scenarioId),
    ledger: buildLedger(scenarioId),
    dailyWater: buildDailyWater(scenarioId),
  };
}

/** 设计稿的日计量样例，只用于 MOCK 演示，不是唐港工程或现场计量数据。
 * supply 为源端供水，consumed/reused 为用水端计量，时段及存量变化使两者不能相互替代。
 */
function buildDailyWater(scenarioId: ScenarioId): DailyWaterRecord[] {
  const totals = [9800, 10600, 9900, 11700, 11300, 13285, 12860];
  const reuseRates = [0.558, 0.582, 0.553, 0.615, 0.596, 0.637, 0.656];
  const factor = scenarioId === "SCN-PUMP-FAULT" ? 0.88 : scenarioId === "SCN-MINING" ? 1.06 : 1;
  return totals.map((total, index) => {
    const consumed = Math.round(total * factor);
    const rainShare = scenarioId === "SCN-RAIN" ? 0.409 : 0.329;
    const rain = Math.round(consumed * rainShare);
    const reclaimed = Math.round(consumed * 0.4);
    return {
      date: `2026-11-${String(8 + index).padStart(2, "0")}`,
      consumed,
      reused: Math.round(consumed * reuseRates[index]),
      supply: { rain, reclaimed, tap: consumed - rain - reclaimed },
      source: "MOCK",
    };
  });
}

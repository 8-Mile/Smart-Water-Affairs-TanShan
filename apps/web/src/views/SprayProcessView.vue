<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { NButton, NSelect, NTabPane, NTabs, useMessage } from "naive-ui";
import Chart from "../Chart.vue";
import SprayProcessScene from "../components/process/SprayProcessScene.vue";
import SprayProcessCanvas from "../components/process/SprayProcessCanvas.vue";
import type { SprayUnitView } from "../components/process/SprayProcessCanvas.vue";
import { cloneDiagram, nextSprayPosition, SYMBOLS, validateDiagram } from "../demo/diagram";
import type { ProcessDiagram, ProcessNode, SymbolId } from "../demo/diagram";
import { can, roleNames } from "../demo/permissions";
import { SCENARIO_NAMES } from "../demo/scenarioLabels";
import {
  SPRAY_DEMO_RULES,
  SPRAY_PLANS,
  analyzeSprayScene,
  buildSprayContext,
  compareSprayPlans,
  integrateFlowSamples,
  sumRunningFlow,
  summarizeSpray,
  toSpraySnapshots,
} from "../demo/spray";
import type {
  SprayFlowSummary,
  SpraySuggestion,
  WaterBasis,
} from "../demo/spray";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import type { AssetStatus, ScenarioId } from "../demo/types";

const store = useDemoStore();
const ui = useUiStore();
const router = useRouter();
const message = useMessage();

const SUBSYSTEM = "spray";
const SPRAY_TYPE_KEYWORD = "射雾";

const STATUS_LABELS: Record<AssetStatus, string> = {
  running: "运行",
  stopped: "停机",
  fault: "异常",
  unknown: "未知",
};
const ALARM_LEVEL_LABELS: Record<string, string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};
const ALARM_STATUS_LABELS: Record<string, string> = {
  active: "活动",
  acknowledged: "已确认",
  closed: "已关闭",
};
const WORKORDER_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_dispatch: "待派单",
  in_progress: "维修中",
  pending_acceptance: "待验收",
  archived: "已归档",
  cancelled: "已取消",
};
const RANGE_HOURS: Record<string, number> = { "24h": 24, "7d": 168, "14d": 336 };
const RANGE_OPTIONS = [
  { value: "24h", label: "近 24 小时" },
  { value: "7d", label: "近 7 天" },
  { value: "14d", label: "近 14 天" },
];
const USAGE_RANGE_HOURS: Record<string, number> = { "24h": 24, "48h": 48, "7d": 168 };
const USAGE_RANGE_OPTIONS = [
  { value: "24h", label: "近 24 小时" },
  { value: "48h", label: "近 48 小时" },
  { value: "7d", label: "近 7 天" },
];
const SCENARIO_OPTIONS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: "SCN-NORMAL", label: "A 正常生产运行", hint: "两个堆场作业中，射雾器按演示计划运行" },
  { id: "SCN-YARD-STOP", label: "B 区域作业结束", hint: "A 区作业结束，仍保留喷雾，触发运行计划核查" },
  { id: "SCN-PUMP-FAULT", label: "C 供水压力异常", hint: "末端压力偏低，关联设备、告警与检查工单" },
];
const TABS = [
  { value: "monitor", label: "设备监测" },
  { value: "trend", label: "运行趋势" },
  { value: "usage", label: "用水分析" },
  { value: "records", label: "告警与工单" },
  { value: "ai", label: "AI 辅助分析" },
];

const tab = ref("monitor");
const sceneOpen = ref(false);
const range = ref("24h");
const usageRange = ref("24h");
const trendAssetId = ref("");
const trendPointId = ref("");
const aiResult = ref<{ title: string; lines: string[] } | null>(null);
const expandedSuggestionId = ref("");
const editing = ref(false);
const diagramView = ref<"scada" | "scene">("scada");
const draft = ref<ProcessDiagram | null>(null);
const selectedNodeId = ref("");
const undoStack = ref<ProcessDiagram[]>([]);
const redoStack = ref<ProcessDiagram[]>([]);
const symbolQuery = ref("");
const connectionTargetId = ref('');
const restoreVersion = ref<number | null>(null);
const symbolItems = computed(() => Object.entries(SYMBOLS).filter(([, spec]) => spec.name.includes(symbolQuery.value)));
const selectedNode = computed(() => draft.value?.nodes.find(node => node.id === selectedNodeId.value));
const shownDiagram = computed(() => editing.value && draft.value ? draft.value : store.sprayDiagram());
function beginEdit(): void { diagramView.value = "scada"; draft.value = store.sprayDraft(); editing.value = true; undoStack.value = []; redoStack.value = []; }
function snapshot(): void { if (draft.value) { undoStack.value.push(cloneDiagram(draft.value)); redoStack.value = []; } }
function undo(): void { const prior = undoStack.value.pop(); if (prior && draft.value) { redoStack.value.push(cloneDiagram(draft.value)); draft.value = prior; } }
function redo(): void { const next = redoStack.value.pop(); if (next && draft.value) { undoStack.value.push(cloneDiagram(draft.value)); draft.value = next; } }
function addNode(symbolId: SymbolId): void {
  if (!draft.value) return;
  snapshot();
  const spec = SYMBOLS[symbolId];
  const position = nextSprayPosition(draft.value.nodes, 'B');
  draft.value.viewBox.width = Math.max(draft.value.viewBox.width, position.x + spec.width + 30);
  const node: ProcessNode = { id: `node-custom-${Date.now()}`, symbolId, position, size: { width: spec.width, height: spec.height }, pointBindings: [], label: spec.name, visible: true };
  draft.value.nodes.push(node); selectedNodeId.value = node.id;
}
function moveNode(payload: { id: string; x: number; y: number }): void {
  const node = draft.value?.nodes.find(item => item.id === payload.id);
  if (node && (node.position.x !== payload.x || node.position.y !== payload.y)) { snapshot(); node.position = { x: payload.x, y: payload.y }; }
}
function bindSelected(assetId: string): void {
  if (!selectedNode.value || !draft.value) return;
  snapshot(); selectedNode.value.assetId = assetId || undefined;
  selectedNode.value.pointBindings = [];
  selectedNode.value.label = store.getAsset(assetId)?.code || SYMBOLS[selectedNode.value.symbolId as SymbolId]?.name || '';
}
function removeSelected(): void { if (!draft.value) return; snapshot(); draft.value.nodes = draft.value.nodes.filter(node => node.id !== selectedNodeId.value); draft.value.connections = draft.value.connections.filter(line => line.sourceNodeId !== selectedNodeId.value && line.targetNodeId !== selectedNodeId.value); selectedNodeId.value = ''; }
function addConnection(): void { if (!draft.value || !selectedNodeId.value || !connectionTargetId.value || selectedNodeId.value === connectionTargetId.value) return; snapshot(); draft.value.connections.push({ id: `line-${Date.now()}`, sourceNodeId: selectedNodeId.value, sourcePortId: 'right', targetNodeId: connectionTargetId.value, targetPortId: 'left', medium: 'water' }); connectionTargetId.value = ''; }
function restoreVersionDraft(): void { if (restoreVersion.value === null) return; try { store.restoreSprayVersion(restoreVersion.value); draft.value = store.sprayDraft(); message.success('历史版本已恢复为草稿，需再次发布'); } catch (error) { message.error((error as Error).message); } }
function saveDraft(): void { if (!draft.value) return; try { store.saveSprayDraft(draft.value); message.success('组态草稿已保存'); } catch (error) { message.error((error as Error).message); } }
function publishDiagram(): void { if (!draft.value) return; try { const errors = validateDiagram(draft.value, store.assets, store.points); if (errors.length) throw new Error(errors.join('；')); store.saveSprayDraft(draft.value); store.publishSprayDiagram(); editing.value = false; message.success('组态已发布'); } catch (error) { message.error((error as Error).message); } }
function cancelEdit(): void { draft.value = null; editing.value = false; selectedNodeId.value = ''; }

const assets = computed(() =>
  store.assets.filter((asset) => asset.subsystemId === SUBSYSTEM && !asset.archived),
);
const sprayAssets = computed(() =>
  assets.value.filter((asset) => asset.type.includes(SPRAY_TYPE_KEYWORD)),
);
const sprayAssetIds = computed(() => new Set(sprayAssets.value.map((asset) => asset.id)));
const extraAssets = computed(() =>
  assets.value.filter((asset) => !sprayAssetIds.value.has(asset.id)),
);
const extraBound = computed(() => {
  const bound = new Set(
    store.bindings
      .filter((binding) => binding.subsystemId === SUBSYSTEM)
      .map((binding) => binding.assetId),
  );
  return extraAssets.value.filter((asset) => bound.has(asset.id));
});

function latestNumber(assetId: string, keyword: string): number | null {
  const point = store
    .getPoints(assetId)
    .find((item) => item.kind === "number" && item.label.includes(keyword));
  if (!point) return null;
  const sample = store.latest(point.id);
  return sample && typeof sample.value === "number" ? sample.value : null;
}

const snapshots = computed(() =>
  toSpraySnapshots(sprayAssets.value, latestNumber),
);
const summary = computed(() => summarizeSpray(snapshots.value));
const context = computed(() => buildSprayContext(store.scenarioId));
const activeAlarms = computed(() =>
  store.alarms.filter(
    (alarm) => alarm.subsystemId === SUBSYSTEM && alarm.status === "active",
  ),
);
const suggestions = computed(() =>
  analyzeSprayScene({
    context: context.value,
    snapshots: snapshots.value,
    summary: summary.value,
    alarms: activeAlarms.value,
  }),
);
const actionableSuggestions = computed(() =>
  suggestions.value.filter((item) => item.level !== "info"),
);
const infoSuggestions = computed(() =>
  suggestions.value.filter((item) => item.level === "info"),
);

const canvasUnits = computed<SprayUnitView[]>(() =>
  snapshots.value.map((item) => ({
    assetId: item.assetId,
    code: item.code,
    name: item.name,
    zone: item.area,
    status: item.status,
    pressureMpa: item.pressureMpa,
    flowM3h: item.flowM3h,
  })),
);

const zoneWorking = computed<Record<"A" | "B", boolean>>(() => ({
  A: context.value.areas.some((area) => area.id === "A" && area.working),
  B: context.value.areas.some((area) => area.id === "B" && area.working),
}));

const dustUg = computed(() => {
  const dust = context.value.environment.dustMgM3;
  return dust === null ? null : Math.round(dust * 1000);
});
const dustStateText = computed(() => {
  if (dustUg.value === null) return "缺数";
  return dustUg.value < SPRAY_DEMO_RULES.dustWatchMgM3 * 1000 ? "达标" : "偏高";
});
const runningRate = computed(() =>
  sprayAssets.value.length
    ? Math.round((summary.value.runningCount / sprayAssets.value.length) * 100)
    : 0,
);
const stoppedCount = computed(
  () => sprayAssets.value.filter((asset) => asset.status === "stopped").length,
);

interface EventItem {
  id: string;
  kind: "alarm" | "suggestion";
  title: string;
  meta: string;
  tag: string;
  assetId?: string;
  suggestion?: SpraySuggestion;
}

const events = computed<EventItem[]>(() => [
  ...activeAlarms.value.map((alarm) => ({
    id: alarm.id,
    kind: "alarm" as const,
    title: alarm.title,
    meta: `${formatAt(alarm.occurredAt)} · ${alarm.code}`,
    tag: ALARM_LEVEL_LABELS[alarm.level] ?? "告警",
    assetId: alarm.assetId,
  })),
  ...actionableSuggestions.value.map((item) => ({
    id: item.id,
    kind: "suggestion" as const,
    title: item.title,
    meta: item.needsConfirm ? "运行优化提醒 · 需人工确认" : "运行优化提醒",
    tag: "待处理",
    assetId: item.relatedAssetIds[0],
    suggestion: item,
  })),
]);

const systemStatus = computed(() => {
  if (sprayAssets.value.some((asset) => asset.status === "fault")) return "设备异常";
  if (
    summary.value.pressureMeanMpa !== null &&
    summary.value.pressureMeanMpa < SPRAY_DEMO_RULES.pressureLowMpa
  ) {
    return "末端压力偏低";
  }
  return events.value.length ? "存在待关注事件" : "系统运行稳定";
});

const statusTone = computed<"ok" | "warn" | "alert">(() => {
  if (systemStatus.value === "设备异常" || systemStatus.value === "末端压力偏低") return "alert";
  return events.value.length ? "warn" : "ok";
});

const flowSummary = computed<SprayFlowSummary>(() => sumRunningFlow(snapshots.value));
const flowBasis = computed<WaterBasis>(() =>
  flowSummary.value.totalM3h === null ? "rated" : "measured",
);
const basisLabel = computed(() =>
  flowBasis.value === "measured" ? "MOCK 模拟遥测流量" : "设备额定流量（额定参数）",
);

function ratedFlow(assetId: string): number | null {
  const asset = store.getAsset(assetId);
  const value = asset?.rated?.flowM3h;
  return typeof value === "number" ? value : null;
}

const planComparison = computed(() =>
  compareSprayPlans(
    snapshots.value
      .filter((item) => item.status === "running")
      .map((item) => item.flowM3h ?? ratedFlow(item.assetId)),
    flowBasis.value,
  ),
);

function usageRowsFor(hours: number) {
  const to = store.seed.referenceTime;
  const from = new Date(Date.parse(to) - hours * 3_600_000).toISOString();
  return snapshots.value.map((item) => {
    const point = store
      .getPoints(item.assetId)
      .find((entry) => entry.kind === "number" && entry.label.includes("流量"));
    const samples = point ? store.series(point.id, from, to) : [];
    const integrated = integrateFlowSamples(samples);
    return {
      assetId: item.assetId,
      code: item.code,
      pointLabel: point?.label ?? "无流量测点",
      ...integrated,
    };
  });
}
function totalOf(rows: { volumeM3: number | null }[]): number | null {
  const volumes = rows
    .map((row) => row.volumeM3)
    .filter((value): value is number => typeof value === "number");
  return volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null;
}
const usageHours = computed(() => USAGE_RANGE_HOURS[usageRange.value] ?? 24);
const usageRows = computed(() => usageRowsFor(usageHours.value));
const usageTotal = computed(() => totalOf(usageRows.value));
const usage24hTotal = computed(() => totalOf(usageRowsFor(24)));

const workorders = computed(() =>
  store.workorders
    .filter((order) => sprayAssetIds.value.has(order.assetId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
);
const sprayAudits = computed(() =>
  store.audits
    .filter(
      (audit) =>
        audit.objectType === "workOrder" ||
        audit.objectType === "alarm" ||
        audit.summary.includes("射雾"),
    )
    .slice(0, 8),
);

const canAsk = computed(() => can(store.role, "ai:ask"));
const canWriteScenario = computed(() => can(store.role, "scenario:write"));
const canCreateOrder = computed(() => can(store.role, "workorder:create"));

const trendAsset = computed(() =>
  assets.value.find((asset) => asset.id === trendAssetId.value),
);
const trendPoints = computed(() =>
  trendAsset.value
    ? store.getPoints(trendAsset.value.id).filter((point) => point.kind === "number")
    : [],
);
const assetOptions = computed(() =>
  assets.value.map((asset) => ({
    value: asset.id,
    label: `${asset.code} · ${asset.name}`,
  })),
);
const pointOptions = computed(() =>
  trendPoints.value.map((point) => ({
    value: point.id,
    label: point.unit ? `${point.label}（${point.unit}）` : point.label,
  })),
);

const trendData = computed(() => {
  const point = trendPoints.value.find((item) => item.id === trendPointId.value);
  if (!point) return null;
  const hours = RANGE_HOURS[range.value] ?? 24;
  const to = store.seed.referenceTime;
  const from = new Date(Date.parse(to) - hours * 3_600_000).toISOString();
  const samples = store.series(point.id, from, to);
  const values = samples.map((sample) =>
    typeof sample.value === "number" ? sample.value : null,
  );
  return {
    point,
    labels: samples.map((sample) => axisLabel(sample.at, hours)),
    values,
    validCount: values.filter((value) => value !== null).length,
    total: values.length,
  };
});
const trendSeries = computed(() => {
  if (!trendData.value) return [];
  return [
    {
      name: trendData.value.point.label,
      values: trendData.value.values,
      unit: trendData.value.point.unit ?? "",
    },
  ];
});
const trendStats = computed(() => {
  const values = (trendData.value?.values ?? []).filter(
    (value): value is number => value !== null,
  );
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  return {
    mean,
    min,
    max,
    spread,
    stable: spread <= 0.05,
    unit: trendData.value?.point.unit ?? "",
  };
});
const trendRangeLabel = computed(
  () => RANGE_OPTIONS.find((option) => option.value === range.value)?.label ?? "近 24 小时",
);

watch(
  trendPoints,
  (points) => {
    if (!points.some((point) => point.id === trendPointId.value)) {
      trendPointId.value = points[0]?.id ?? "";
    }
  },
  { immediate: true },
);
watch(
  assets,
  (list) => {
    if (!list.some((asset) => asset.id === trendAssetId.value)) {
      trendAssetId.value = list[0]?.id ?? "";
    }
  },
  { immediate: true },
);

function formatAt(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}
function axisLabel(at: string, hours: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (hours <= 24) return clock;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}
function fmt(value: number | null, digits = 1): string {
  if (value === null) return "缺数";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
function openAsset(assetId: string): void {
  ui.openAsset(assetId);
}
function openAi(): void {
  ui.openAi({ subsystemId: SUBSYSTEM });
}

function applyScenario(id: ScenarioId): void {
  if (!canWriteScenario.value) {
    message.error(`FORBIDDEN：角色「${roleNames[store.role]}」无 scenario:write 权限`);
    return;
  }
  try {
    store.switchScenario(id);
    sceneOpen.value = false;
    expandedSuggestionId.value = "";
    aiResult.value = null;
    message.success(`已切换到「${SCENARIO_NAMES[id]}」`);
  } catch (error) {
    message.error((error as Error).message);
  }
}

function resetScenario(): void {
  if (!canWriteScenario.value) {
    message.error(`FORBIDDEN：角色「${roleNames[store.role]}」无 scenario:write 权限`);
    return;
  }
  try {
    store.resetScenario();
    sceneOpen.value = false;
    expandedSuggestionId.value = "";
    aiResult.value = null;
    message.success("当前场景已恢复初始状态");
  } catch (error) {
    message.error((error as Error).message);
  }
}

function focusSuggestion(id: string): void {
  expandedSuggestionId.value = id;
  const element = document.getElementById(`spray-suggest-${id}`);
  if (element) element.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function taskTitle(suggestion: SpraySuggestion): string {
  return suggestion.id === "pressure-low"
    ? "射雾器末端压力异常检查（待确认）"
    : `${suggestion.title} · 运行计划核查（待确认）`;
}

function relatedAlarm(suggestion: SpraySuggestion) {
  const assetId = suggestion.relatedAssetIds[0];
  return (
    activeAlarms.value.find((alarm) => alarm.assetId === assetId) ??
    activeAlarms.value[0]
  );
}

function createTaskFromSuggestion(suggestion: SpraySuggestion): void {
  if (!canCreateOrder.value) {
    message.error(
      `FORBIDDEN：角色「${roleNames[store.role]}」无 workorder:create 权限，不能生成任务草稿`,
    );
    return;
  }
  const assetId = suggestion.relatedAssetIds[0] ?? sprayAssets.value[0]?.id;
  if (!assetId) {
    message.warning("缺少关联设备，未生成任务");
    return;
  }
  const title = taskTitle(suggestion);
  const existing = store.workorders.find(
    (order) => order.status !== "cancelled" && order.title === title,
  );
  if (existing) {
    message.info(`已存在任务 ${existing.code}，未重复创建`);
    return;
  }
  const alarm = suggestion.id === "pressure-low" ? relatedAlarm(suggestion) : undefined;
  try {
    const order = store.createWorkOrder({
      title,
      assetId,
      source: alarm ? "alarm" : "manual",
      alarmId: alarm?.id,
      symptom: suggestion.finding,
      suggestion: suggestion.action,
      priority: suggestion.id === "pressure-low" ? "high" : "medium",
      evidenceIds: [
        ...(alarm ? [alarm.id] : []),
        ...suggestion.relatedAssetIds.map((id) => `${id}-pressure`),
      ],
    });
    const label = suggestion.id === "pressure-low" ? "检查工单草稿" : "待确认任务草稿";
    message.success(`已生成${label} ${order.code}（未派单）`);
  } catch (error) {
    message.error((error as Error).message);
  }
}

function pressureStats() {
  const to = store.seed.referenceTime;
  const from = new Date(Date.parse(to) - 24 * 3_600_000).toISOString();
  return snapshots.value.map((item) => {
    const point = store
      .getPoints(item.assetId)
      .find((entry) => entry.kind === "number" && entry.label.includes("压力"));
    const samples = point ? store.series(point.id, from, to) : [];
    const values = samples
      .map((sample) => (typeof sample.value === "number" ? sample.value : null))
      .filter((value): value is number => value !== null);
    return {
      code: item.code,
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      valid: values.length,
      total: samples.length,
    };
  });
}

type SprayAiAction = "runtime" | "pressure" | "area" | "water" | "check" | "trend";

function runAi(action: SprayAiAction): void {
  if (action === "trend") {
    void router.push({
      path: "/data/ai-workspace",
      query: { prompt: "用射雾器末端压力近24小时数据生成趋势图" },
    });
    return;
  }
  if (action === "runtime") {
    aiResult.value = {
      title: "射雾器运行设备与异常",
      lines: [
        `运行 ${summary.value.runningCount} 台：${
          snapshots.value
            .filter((item) => item.status === "running")
            .map(
              (item) =>
                `${item.code}（${item.pressureMpa === null ? "压力缺数" : `${item.pressureMpa.toFixed(2)} MPa`}，${
                  item.flowM3h === null ? "流量缺数" : `${item.flowM3h.toFixed(1)} m³/h`
                }）`,
            )
            .join("；") || "无"
        }`,
        `停机 ${snapshots.value.filter((item) => item.status === "stopped").length} 台，异常 ${
          snapshots.value.filter((item) => item.status === "fault").length
        } 台。`,
        `活动告警 ${activeAlarms.value.length} 条：${
          activeAlarms.value.map((alarm) => alarm.title).join("；") || "无"
        }`,
        `规则建议 ${actionableSuggestions.value.length} 条：${
          actionableSuggestions.value.map((item) => item.title).join("；") || "无"
        }`,
        "数据口径：MOCK 模拟遥测 + 本地规则计算。",
      ],
    };
    return;
  }
  if (action === "pressure") {
    const stats = pressureStats();
    const usable = stats.filter((item) => item.mean !== null);
    aiResult.value = {
      title: "最近 24 小时末端压力趋势",
      lines: usable.length
        ? [
            ...stats.map((item) =>
              item.mean === null
                ? `${item.code}：无有效压力样本（缺数）`
                : `${item.code}：均值 ${item.mean.toFixed(2)} MPa，区间 ${item.min?.toFixed(
                    2,
                  )}~${item.max?.toFixed(2)} MPa，有效 ${item.valid}/${item.total}`,
            ),
            `演示关注阈值 ${SPRAY_DEMO_RULES.pressureLowMpa} MPa（可配置演示参数，非厂家规定值）。`,
            "缺数设备不参与均值，也不以 0 或额定值补齐。",
          ]
        : ["所选设备均无有效末端压力样本，不生成趋势结论。"],
    };
    return;
  }
  if (action === "area") {
    aiResult.value = {
      title: "堆场作业与环境状态",
      lines: [
        ...context.value.areas.map((area) =>
          area.working
            ? `${area.name}：作业中（${area.task}）`
            : `${area.name}：已停止作业 ${area.stoppedMinutesAgo} 分钟（${area.task}），演示计划${
                area.plannedSpray ? "仍保留喷雾" : "不安排喷雾"
              }`,
        ),
        `风速 ${context.value.environment.windSpeedMs} m/s，${context.value.environment.windDirection}；粉尘 ${
          context.value.environment.dustMgM3 === null
            ? "缺数"
            : `${context.value.environment.dustMgM3} mg/m³`
        }`,
        "数据口径：MOCK 演示作业与环境数据，不是现场生产系统或环保监测实测。",
      ],
    };
    return;
  }
  if (action === "water") {
    const comparison = planComparison.value;
    aiResult.value = {
      title: "运行方案理论用水对比",
      lines: [
        `现行计划（${SPRAY_PLANS[0].hours} h × ${SPRAY_PLANS[0].deviceCount} 台）：${fmt(
          comparison.current.volumeM3,
          0,
        )} m³`,
        `调整后计划（${SPRAY_PLANS[1].hours} h × ${SPRAY_PLANS[1].deviceCount} 台）：${fmt(
          comparison.reduced.volumeM3,
          0,
        )} m³`,
        `全部停运：${fmt(comparison.off.volumeM3, 0)} m³`,
        `理论差异：${
          comparison.diffM3 === null
            ? "缺数，无法对比"
            : `${fmt(comparison.diffM3, 0)} m³${
                comparison.diffPct === null ? "" : `（${comparison.diffPct.toFixed(1)}%）`
              }`
        }`,
        `口径：${basisLabel.value}。${comparison.note}`,
      ],
    };
    return;
  }
  if (!canCreateOrder.value) {
    aiResult.value = {
      title: "生成检查任务草稿",
      lines: [
        `FORBIDDEN：角色「${roleNames[store.role]}」无 workorder:create 权限，不能生成任务草稿。`,
        "演示环境仅提供权限提示，不写入任何数据。",
      ],
    };
    return;
  }
  const target = actionableSuggestions.value.find((item) => item.id === "pressure-low");
  const assetId = target?.relatedAssetIds[0] ?? snapshots.value[0]?.assetId;
  if (!target || !assetId) {
    aiResult.value = {
      title: "生成检查任务草稿",
      lines: ["当前没有触发压力异常规则，未生成检查任务。"],
    };
    return;
  }
  createTaskFromSuggestion(target);
  aiResult.value = {
    title: "生成检查任务草稿",
    lines: [
      `已按规则「${target.title}」提交草稿，关联设备 ${snapshots.value[0]?.code ?? ""} 与活动告警。`,
      "草稿不会自动派单，也不会下发任何设备控制指令。",
    ],
  };
}
</script>

<template>
  <section class="spray-view">
    <!-- 顶部信息栏 -->
    <header class="info-bar">
      <div class="info-title">
        <span class="info-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="10" cy="10" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M10 5.4 V14.6 M5.4 10 H14.6" stroke="currentColor" stroke-width="1.4" />
            <path d="M2.6 13.4 q-1.4 2.2 0 4.4 M5.2 12.4 q-2.2 3 0 6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
            <path d="M15.6 16.2 l3.8 3.2 M16.8 21.2 l3.2 -1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
        <div class="info-heading">
          <h1>射雾器除尘</h1>
          <p>堆场抑尘 · 生产协同 · 智能运行</p>
        </div>
      </div>
      <nav class="tab-nav" role="tablist" aria-label="射雾器业务视图">
        <button
          v-for="item in TABS"
          :key="item.value"
          type="button"
          role="tab"
          class="tab-pill"
          :class="{ active: tab === item.value }"
          :aria-selected="tab === item.value"
          @click="tab = item.value"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="info-meta">
        <span class="status-inline" :class="statusTone">
          <i></i>{{ systemStatus }}
        </span>
        <span class="meta-divider"></span>
        <span>数据来源：MOCK 模拟 / 规则计算</span>
        <span class="meta-divider"></span>
        <span>更新时间：{{ formatAt(store.seed.referenceTime) }}</span>
      </div>
      <button
        type="button"
        class="ai-trigger"
        aria-label="AI 助手"
        :disabled="!canAsk"
        title="打开 AI 助手（携带射雾器上下文）"
        @click="openAi"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.4 l1.8 4.6 4.6 1.8 -4.6 1.8 -1.8 4.6 -1.8 -4.6 -4.6 -1.8 4.6 -1.8 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          <path d="M18.2 15.4 l.9 2.3 2.3 .9 -2.3 .9 -.9 2.3 -.9 -2.3 -2.3 -.9 2.3 -.9 Z" fill="currentColor" opacity=".7" />
        </svg>
      </button>
      <button
        type="button"
        class="scene-trigger"
        :class="{ open: sceneOpen }"
        @click="sceneOpen = !sceneOpen"
      >
        演示场景：{{ SCENARIO_NAMES[store.scenarioId] }}
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 4.6 L6 8.2 L9.6 4.6" /></svg>
      </button>
    </header>
    <div class="spray-v3-evidence" aria-label="港口供水系统工程依据">
      <div><strong>工艺关系待核</strong><span>本页面设备与指标仍为MOCK，需核实室内/室外设备、定频风机、末端压力和真实供水路径；不认定中压泵与射雾器已连通。</span></div>
      <nav aria-label="射雾器工程核查快捷入口">
        <router-link to="/engineering/registry?item=CK-021">CK-021 设备布点</router-link>
        <router-link to="/engineering/registry?item=CK-022">CK-022 末端监测</router-link>
        <router-link to="/engineering/registry?item=PT-017">PT-017 仪表</router-link>
        <router-link to="/intelligent/correlation">查看异常协同</router-link>
      </nav>
    </div>

    <section v-if="sceneOpen" class="scene-bar">
      <span class="scene-label">演示场景（可重放，不控制真实设备）</span>
      <NButton
        v-for="option in SCENARIO_OPTIONS"
        :key="option.id"
        size="small"
        secondary
        :type="store.scenarioId === option.id ? 'primary' : 'default'"
        :disabled="!canWriteScenario"
        :title="option.hint"
        @click="applyScenario(option.id)"
      >
        {{ option.label }}
      </NButton>
      <NButton size="small" quaternary :disabled="!canWriteScenario" @click="resetScenario">
        恢复初始场景
      </NButton>
      <span class="scene-current">{{ store.scenarioId }} · seed {{ store.seedVersion }}</span>
    </section>

    <!-- 四张核心指标卡 -->
    <div class="kpi-grid">
      <article class="kpi-card">
        <span class="kpi-icon blue" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="3.5" y="6" width="12" height="12" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path d="M15.5 10 H19 a1.5 1.5 0 0 1 1.5 1.5 v4 a1.5 1.5 0 0 1 -1.5 1.5 H15.5" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path d="M7 10 h4 M7 13 h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
        <div class="kpi-body">
          <span class="kpi-label">运行射雾器</span>
          <div class="kpi-value-row">
            <strong class="kpi-value">{{ summary.runningCount }}<small>/{{ sprayAssets.length }} 台</small></strong>
            <span class="kpi-delta ok">运行率 {{ runningRate }}%</span>
          </div>
          <p class="kpi-hint">停机 {{ stoppedCount }} 台 · 异常 {{ sprayAssets.filter((asset) => asset.status === "fault").length }} 台</p>
          <div class="kpi-bar"><i :style="{ width: `${runningRate}%` }"></i></div>
        </div>
      </article>

      <article class="kpi-card">
        <span class="kpi-icon teal" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path d="M12 12 L8.6 9.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" />
            <path d="M12 4.4 V6 M19.6 12 H18 M12 19.6 V18 M4.4 12 H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </span>
        <div class="kpi-body">
          <span class="kpi-label">末端压力均值</span>
          <div class="kpi-value-row">
            <strong class="kpi-value" :class="{ missing: summary.pressureMeanMpa === null }">
              {{ summary.pressureMeanMpa === null ? "缺数" : summary.pressureMeanMpa.toFixed(2) }}
              <small v-if="summary.pressureMeanMpa !== null">MPa</small>
            </strong>
            <span
              class="kpi-delta"
              :class="summary.pressureMeanMpa === null ? 'warn' : summary.pressureMeanMpa < SPRAY_DEMO_RULES.pressureLowMpa ? 'alert' : 'ok'"
            >
              {{ summary.pressureMeanMpa === null ? "无有效样本" : summary.pressureMeanMpa < SPRAY_DEMO_RULES.pressureLowMpa ? "低于演示阈值" : "压力平稳" }}
            </span>
          </div>
          <p class="kpi-hint">有效测点 {{ summary.pressureCovered }}/{{ summary.pressureTotal }} 台 · 采样 30 分钟</p>
        </div>
      </article>

      <article class="kpi-card">
        <span class="kpi-icon cyan" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3.6 C12 3.6 6.4 10.2 6.4 14.4 a5.6 5.6 0 0 0 11.2 0 C17.6 10.2 12 3.6 12 3.6 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
            <path d="M9.4 14.6 a2.8 2.8 0 0 0 2.6 2.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
        <div class="kpi-body">
          <span class="kpi-label">瞬时喷射流量</span>
          <div class="kpi-value-row">
            <strong class="kpi-value" :class="{ missing: summary.flowTotalM3h === null }">
              {{ summary.flowTotalM3h === null ? "缺数" : summary.flowTotalM3h.toFixed(1) }}
              <small v-if="summary.flowTotalM3h !== null">m³/h</small>
            </strong>
            <span class="kpi-delta" :class="summary.flowTotalM3h === null ? 'warn' : 'ok'">
              {{ summary.flowTotalM3h === null ? "无有效流量" : `覆盖 ${summary.flowCovered}/${summary.runningCount} 台` }}
            </span>
          </div>
          <p class="kpi-hint">仅累加运行设备的有效流量测点，缺数不按额定值补齐</p>
        </div>
      </article>

      <article class="kpi-card" :class="{ alert: events.length > 0 }">
        <span class="kpi-icon" :class="events.length ? 'red' : 'blue'" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 4.2 L20.4 18.4 a1.4 1.4 0 0 1 -1.2 2.1 H4.8 a1.4 1.4 0 0 1 -1.2 -2.1 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
            <path d="M12 9 V14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="12" cy="17" r="1.1" fill="currentColor" />
          </svg>
        </span>
        <div class="kpi-body">
          <span class="kpi-label">待关注事件</span>
          <div class="kpi-value-row">
            <strong class="kpi-value">{{ events.length }}<small>条</small></strong>
            <span class="kpi-delta" :class="events.length ? 'alert' : 'ok'">
              {{ events.length ? "需要关注" : "暂无待办" }}
            </span>
          </div>
          <p class="kpi-hint">
            {{ events.length ? events.slice(0, 2).map((item) => item.title).join("；") : "无活动告警与需确认的运行建议" }}
          </p>
        </div>
      </article>
    </div>

    <!-- 中央工艺图 + 右侧业务卡片 -->
    <div class="spray-main">
      <section class="panel scada-panel">
        <div class="panel-head">
          <div class="panel-title">
            <span class="panel-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 19 V9 M9 19 V5 M14 19 V12 M19 19 V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                <path d="M2.5 19 H21.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </span>
            <div>
              <h2>工艺流程监控</h2>
              <p class="panel-sub">工艺示意图，非真实管线拓扑</p>
            </div>
          </div>
          <div class="diagram-actions">
            <div v-if="!editing" class="diagram-switch" role="group" aria-label="工艺视图">
              <NButton size="small" :type="diagramView === 'scene' ? 'primary' : 'default'" :aria-pressed="diagramView === 'scene'" @click="diagramView = 'scene'">工艺图</NButton>
              <NButton size="small" :type="diagramView === 'scada' ? 'primary' : 'default'" :aria-pressed="diagramView === 'scada'" @click="diagramView = 'scada'">组态图</NButton>
            </div>
            <span class="soft-tag">SCADA · {{ editing ? '编辑草稿' : `已发布 v${shownDiagram.version}` }}</span>
            <NButton v-if="can(store.role, 'binding:write') && !editing" size="small" secondary @click="beginEdit">编辑组态</NButton>
            <template v-if="editing">
              <NButton size="small" secondary :disabled="!undoStack.length" @click="undo">撤销</NButton>
              <NButton size="small" secondary :disabled="!redoStack.length" @click="redo">重做</NButton>
              <NButton size="small" secondary @click="saveDraft">保存草稿</NButton>
              <NButton v-if="can(store.role, 'diagram:publish')" size="small" type="primary" @click="publishDiagram">校验并发布</NButton>
              <select v-if="can(store.role, 'diagram:publish')" v-model.number="restoreVersion" aria-label="选择历史版本"><option :value="null">历史版本</option><option v-for="item in store.diagrams.spray?.history || []" :key="item.version" :value="item.version">v{{ item.version }}</option></select>
              <NButton v-if="can(store.role, 'diagram:publish')" size="small" secondary :disabled="restoreVersion === null" @click="restoreVersionDraft">恢复为草稿</NButton>
              <NButton size="small" quaternary @click="cancelEdit">取消修改</NButton>
            </template>
          </div>
        </div>
        <div class="diagram-workspace" :class="{ editing }">
        <div v-if="editing" class="diagram-editor">
          <aside class="diagram-sidebar">
            <strong>工业图元库</strong>
            <input v-model="symbolQuery" placeholder="搜索图元" aria-label="搜索图元" />
            <button v-for="[id, spec] in symbolItems" :key="id" type="button" @click="addNode(id as SymbolId)">＋ {{ spec.name }}</button>
          </aside>
          <aside class="diagram-sidebar diagram-properties">
            <strong>图元属性</strong>
            <template v-if="selectedNode">
              <label>名称<input v-model="selectedNode.label" @focus="snapshot" /></label>
              <label>绑定设备<select :value="selectedNode.assetId || ''" @change="bindSelected(($event.target as HTMLSelectElement).value)"><option value="">未绑定</option><option v-for="asset in sprayAssets" :key="asset.id" :value="asset.id">{{ asset.code }}</option></select></label>
              <label>X <input :value="selectedNode.position.x" type="number" min="0" @change="snapshot(); selectedNode!.position.x = Number(($event.target as HTMLInputElement).value)" /></label>
              <label>Y <input :value="selectedNode.position.y" type="number" min="0" @change="snapshot(); selectedNode!.position.y = Number(($event.target as HTMLInputElement).value)" /></label>
              <label>宽 <input :value="selectedNode.size.width" type="number" min="1" @change="snapshot(); selectedNode!.size.width = Number(($event.target as HTMLInputElement).value)" /></label>
              <label>高 <input :value="selectedNode.size.height" type="number" min="1" @change="snapshot(); selectedNode!.size.height = Number(($event.target as HTMLInputElement).value)" /></label>
              <label><input v-model="selectedNode.visible" type="checkbox" @change="snapshot" /> 显示</label>
              <strong>测点标签</strong>
              <label v-for="point in store.getPoints(selectedNode.assetId || '')" :key="point.id"><input type="checkbox" :checked="selectedNode.pointBindings.some(binding => binding.pointId === point.id)" @change="snapshot(); selectedNode!.pointBindings = ($event.target as HTMLInputElement).checked ? [...selectedNode!.pointBindings, { pointId: point.id, displayRole: 'label' }] : selectedNode!.pointBindings.filter(binding => binding.pointId !== point.id)" /> {{ point.label }}</label>
              <NButton size="small" type="error" secondary @click="removeSelected">删除图元</NButton>
              <strong>工艺连接（人工确认）</strong>
              <select v-model="connectionTargetId" aria-label="选择连接目标"><option value="">选择目标图元</option><option v-for="node in draft?.nodes.filter(item => item.id !== selectedNodeId)" :key="node.id" :value="node.id">{{ node.label || node.id }}</option></select>
              <NButton size="small" secondary :disabled="!connectionTargetId" @click="addConnection">添加连接</NButton>
              <button v-for="line in draft?.connections.filter(item => item.sourceNodeId === selectedNodeId || item.targetNodeId === selectedNodeId)" :key="line.id" type="button" @click="snapshot(); draft!.connections = draft!.connections.filter(item => item.id !== line.id)">删除连接 {{ line.id }}</button>
            </template>
            <span v-else>点击画布图元后编辑属性</span>
            <small>绑定射雾器后，按画布上的区域显示支管示意线。</small>
          </aside>
        </div>
        <SprayProcessScene
          v-if="diagramView === 'scene' && !editing"
          :nodes="shownDiagram.nodes"
          :units="canvasUnits"
          :status-labels="STATUS_LABELS"
          @select="openAsset"
        />
        <SprayProcessCanvas
          v-else
          :units="canvasUnits"
          :nodes="shownDiagram.nodes"
          :connections="shownDiagram.connections"
          :view-width="shownDiagram.viewBox.width"
          :editable="editing"
          :selected-node-id="selectedNodeId"
          :zone-working="zoneWorking"
          :main-pressure-mpa="summary.pressureMeanMpa"
          :main-flow-m3h="summary.flowTotalM3h"
          :tank-level-m="context.tank.levelM"
          :tank-available-m3="context.tank.availableM3"
          @select="openAsset"
          @select-node="selectedNodeId = $event"
          @move-node="moveNode"
        />
        </div>

        <div v-if="extraBound.length" class="extra-bound">
          <span class="extra-label">其他已绑定设备</span>
          <button
            v-for="asset in extraBound"
            :key="asset.id"
            type="button"
            class="extra-chip"
            :title="`${asset.name} · ${STATUS_LABELS[asset.status]} · 点击打开设备详情`"
            @click="openAsset(asset.id)"
          >
            {{ asset.code }}<span class="mock-flag">模拟</span>
          </button>
        </div>

        <div class="scada-status">
          <span class="status-item"><em>设备总数</em><strong>{{ sprayAssets.length }} 台</strong></span>
          <span class="status-item"><em>运行</em><strong class="ok">{{ summary.runningCount }} 台</strong></span>
          <span class="status-item"><em>停机</em><strong>{{ stoppedCount }} 台</strong></span>
          <span class="status-item wide">
            <em>当前用水估算</em>
            <strong>{{ usage24hTotal === null ? "缺数" : `${fmt(usage24hTotal, 0)} m³` }}</strong>
            <small>（近 24 小时 · {{ basisLabel }}）</small>
          </span>
          <span class="status-source">数据来源 MOCK / 规则计算</span>
        </div>
      </section>

      <aside class="side-stack">
        <section class="panel side-card env-card">
          <div class="side-head">
            <div class="side-title">
              <span class="side-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M3 8.5 h9 a2.6 2.6 0 1 0 -2.6 -2.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                  <path d="M3 12.5 h13 a2.6 2.6 0 1 1 -2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                  <path d="M3 16.5 h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                </svg>
              </span>
              <h3>生产与环境状态</h3>
            </div>
            <span class="soft-tag">MOCK</span>
          </div>
          <div class="env-columns">
            <div class="env-block">
              <div v-for="area in context.areas" :key="area.id" class="env-row">
                <span>{{ area.id }} 区作业状态</span>
                <span class="state-tag" :class="area.working ? 'running' : 'idle'">
                  {{ area.working ? "作业中" : "已结束" }}
                </span>
              </div>
            </div>
            <div class="env-block">
              <div class="env-row">
                <span>风速</span>
                <strong>{{ context.environment.windSpeedMs }} m/s</strong>
              </div>
              <div class="env-row">
                <span>风向</span>
                <strong>{{ context.environment.windDirectionDeg }}°（{{ context.environment.windDirection }}）</strong>
              </div>
              <div class="env-row">
                <span>粉尘监测</span>
                <strong :class="{ missing: dustUg === null }">
                  {{ dustUg === null ? "缺数" : `${dustUg} μg/m³` }}
                  <small v-if="dustUg !== null" class="state-tag" :class="dustStateText === '达标' ? 'running' : 'attention'">
                    {{ dustStateText }}
                  </small>
                </strong>
              </div>
            </div>
          </div>
        </section>

        <section class="panel side-card suggest-card">
          <div class="side-head">
            <div class="side-title">
              <span class="side-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3.4 l1.8 4.6 4.6 1.8 -4.6 1.8 -1.8 4.6 -1.8 -4.6 -4.6 -1.8 4.6 -1.8 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  <path d="M18.2 15.4 l.9 2.3 2.3 .9 -2.3 .9 -.9 2.3 -.9 -2.3 -2.3 -.9 2.3 -.9 Z" fill="currentColor" opacity=".7" />
                </svg>
              </span>
              <h3>智能运行建议</h3>
            </div>
            <span class="soft-tag">规则计算</span>
          </div>

          <p v-if="!actionableSuggestions.length" class="empty">
            当前未触发运行优化建议
            <small v-if="infoSuggestions.length">（另有 {{ infoSuggestions.length }} 条数据提示）</small>
          </p>
          <div class="suggest-list">
            <article
              v-for="item in actionableSuggestions"
              :id="`spray-suggest-${item.id}`"
              :key="item.id"
              class="suggestion"
              :class="item.level"
            >
              <div class="suggest-head">
                <strong>{{ item.title }}</strong>
                <span class="state-tag attention">{{ item.needsConfirm ? "需人工确认" : "提示" }}</span>
              </div>
              <p class="suggest-line"><em>原因：</em>{{ item.finding }}</p>
              <p class="suggest-line"><em>运行建议：</em>{{ item.action }}</p>
              <div v-if="expandedSuggestionId === item.id" class="suggest-evidence">
                <dl>
                  <div>
                    <dt>使用数据</dt>
                    <dd><span v-for="line in item.dataUsed" :key="line">{{ line }}</span></dd>
                  </div>
                  <div>
                    <dt>业务规则</dt>
                    <dd>{{ item.rule }}</dd>
                  </div>
                  <div>
                    <dt>风险与限制</dt>
                    <dd>{{ item.risk }}</dd>
                  </div>
                  <div>
                    <dt>人工确认</dt>
                    <dd>{{ item.needsConfirm ? "需要人工确认后才能形成任务" : "无需确认，仅作提示" }}</dd>
                  </div>
                </dl>
              </div>
              <div class="suggest-actions">
                <NButton
                  size="small"
                  secondary
                  @click="expandedSuggestionId = expandedSuggestionId === item.id ? '' : item.id"
                >
                  查看依据
                </NButton>
                <NButton
                  size="small"
                  type="primary"
                  :disabled="!canCreateOrder"
                  @click="createTaskFromSuggestion(item)"
                >
                  创建检查任务
                </NButton>
              </div>
            </article>
          </div>
        </section>

        <section class="panel side-card event-card">
          <div class="side-head">
            <div class="side-title">
              <span class="side-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M6 9.4 a6 6 0 0 1 12 0 c0 4.2 1.6 5.6 2.2 6.4 H3.8 c.6 -.8 2.2 -2.2 2.2 -6.4 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  <path d="M10 19 a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </span>
              <h3>异常事件与待办</h3>
            </div>
            <span class="event-count" :class="{ active: events.length }">{{ events.length }}</span>
            <RouterLink to="/operations/alarms" class="more-link">查看更多</RouterLink>
          </div>

          <ul v-if="events.length" class="event-list">
            <li v-for="item in events.slice(0, 3)" :key="item.id">
              <span class="event-dot" :class="item.kind"></span>
              <div class="event-main">
                <div class="event-title">
                  <strong>{{ item.title }}</strong>
                  <span class="state-tag" :class="item.kind === 'alarm' ? 'attention' : 'warn'">{{ item.tag }}</span>
                </div>
                <small>{{ item.meta }}</small>
              </div>
              <button
                type="button"
                class="event-chevron"
                :aria-label="`查看 ${item.title}`"
                @click="item.kind === 'suggestion' ? focusSuggestion(item.id) : openAsset(item.assetId ?? '')"
              >
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.6 2.4 L8.2 6 L4.6 9.6" /></svg>
              </button>
            </li>
          </ul>
          <p v-else class="empty">当前无活动告警与需确认的运行建议。</p>

          <div v-if="workorders.length" class="order-block">
            <div v-for="order in workorders.slice(0, 2)" :key="order.id" class="order-line">
              <span class="order-dot"></span>
              <div class="event-main">
                <div class="event-title">
                  <strong>{{ order.title }}</strong>
                  <span class="state-tag idle">{{ WORKORDER_STATUS_LABELS[order.status] ?? order.status }}</span>
                </div>
                <small>{{ order.code }} · {{ formatAt(order.createdAt) }}</small>
              </div>
              <RouterLink to="/operations/workorders" class="event-chevron" aria-label="查看工单">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.6 2.4 L8.2 6 L4.6 9.6" /></svg>
              </RouterLink>
            </div>
          </div>
        </section>
      </aside>
    </div>

    <!-- 底部业务 Tab -->
    <section class="panel tabs-panel">
      <NTabs v-model:value="tab" type="line" animated>
        <NTabPane name="monitor" tab="设备监测">
          <p class="tab-note">
            本系统在用设备 {{ assets.length }} 台；点击任意行打开同一设备详情抽屉，测点与趋势与台账共用一份数据。
          </p>
          <div class="table-wrap">
            <table class="asset-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>区域</th>
                  <th>状态</th>
                  <th>末端压力</th>
                  <th>喷射流量</th>
                  <th>额定流量</th>
                  <th>累计运行</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="asset in assets"
                  :key="asset.id"
                  tabindex="0"
                  @click="openAsset(asset.id)"
                  @keydown.enter="openAsset(asset.id)"
                >
                  <td>{{ asset.code }}</td>
                  <td>{{ asset.name }}</td>
                  <td>{{ asset.area === "north" ? "北区（A）" : "南区（B）" }}</td>
                  <td>
                    <span class="state-tag" :class="asset.status === 'running' ? 'running' : asset.status === 'fault' ? 'attention' : 'idle'">
                      {{ STATUS_LABELS[asset.status] }}
                    </span>
                  </td>
                  <td>
                    {{ latestNumber(asset.id, "压力") === null ? "缺数" : `${latestNumber(asset.id, "压力")?.toFixed(2)} MPa` }}
                  </td>
                  <td>
                    {{ latestNumber(asset.id, "流量") === null ? "缺数" : `${latestNumber(asset.id, "流量")?.toFixed(1)} m³/h` }}
                  </td>
                  <td>{{ asset.rated?.flowM3h ?? "未提供" }}</td>
                  <td>{{ asset.runtimeHours.toLocaleString("zh-CN") }} h</td>
                </tr>
              </tbody>
            </table>
          </div>
        </NTabPane>

        <NTabPane name="trend" tab="运行趋势">
          <div class="trend-controls">
            <NSelect
              v-model:value="trendAssetId"
              size="small"
              style="width: 190px"
              :options="assetOptions"
              placeholder="选择设备"
            />
            <NSelect
              v-model:value="trendPointId"
              size="small"
              style="width: 170px"
              :options="pointOptions"
              :disabled="!pointOptions.length"
              placeholder="选择测点"
            />
            <NSelect v-model:value="range" size="small" style="width: 138px" :options="RANGE_OPTIONS" />
            <span class="soft-tag">MOCK 模拟数据</span>
          </div>

          <template v-if="trendData">
            <div class="trend-layout">
              <div class="trend-chart">
                <div class="trend-head">
                  <strong>
                    {{ trendData.point.label }}
                    <template v-if="trendData.point.unit">（{{ trendData.point.unit }}）</template>
                  </strong>
                  <span class="caption">
                    {{ trendAsset?.name }} · 有效样本 {{ trendData.validCount }}/{{ trendData.total }} · 缺失不插值
                  </span>
                </div>
                <Chart :labels="trendData.labels" :series="trendSeries" :height="240" />
                <p v-if="trendData.validCount === 0" class="empty">
                  该测点在所选区间内无有效样本，按缺数处理，不生成虚构曲线。
                </p>
              </div>
              <aside class="trend-stats">
                <h4>末端压力（{{ trendRangeLabel }}）</h4>
                <template v-if="trendStats">
                  <dl>
                    <div><dt>平均值</dt><dd>{{ trendStats.mean.toFixed(2) }} <small>{{ trendStats.unit }}</small></dd></div>
                    <div><dt>最大值</dt><dd>{{ trendStats.max.toFixed(2) }} <small>{{ trendStats.unit }}</small></dd></div>
                    <div><dt>最小值</dt><dd>{{ trendStats.min.toFixed(2) }} <small>{{ trendStats.unit }}</small></dd></div>
                    <div><dt>波动范围</dt><dd>±{{ (trendStats.spread / 2).toFixed(2) }} <small>{{ trendStats.unit }}</small></dd></div>
                  </dl>
                  <p class="trend-verdict" :class="trendStats.stable ? 'ok' : 'warn'">
                    <span class="check">{{ trendStats.stable ? "✓" : "!" }}</span>
                    {{ trendStats.stable ? "波动范围在演示阈值内，运行平稳" : "波动超过 ±0.05 MPa，建议核查供水与测点" }}
                  </p>
                </template>
                <p v-else class="empty">所选区间无有效样本，无法计算统计值。</p>
                <p class="stats-note">统计基于当前测点时序数据；缺数区间不参与计算。</p>
              </aside>
            </div>
          </template>
          <p v-else class="empty">该设备暂无可用数值测点，无法生成趋势。</p>
        </NTabPane>

        <NTabPane name="usage" tab="用水分析">
          <div class="usage-grid">
            <section class="mini-panel">
              <h4>当前有效喷射流量</h4>
              <p class="usage-value">
                {{ flowSummary.totalM3h === null ? "缺数" : flowSummary.totalM3h.toFixed(1) }}
                <small v-if="flowSummary.totalM3h !== null">m³/h</small>
              </p>
              <p class="tab-note">{{ flowSummary.note }}</p>
              <p class="tab-note">口径：{{ basisLabel }}</p>
            </section>
            <section class="mini-panel">
              <div class="mini-head">
                <h4>最近 {{ usageHours }} 小时积分估算</h4>
                <NSelect
                  v-model:value="usageRange"
                  size="tiny"
                  style="width: 126px"
                  :options="USAGE_RANGE_OPTIONS"
                />
              </div>
              <p class="usage-value">
                {{ usageTotal === null ? "缺数" : usageTotal.toFixed(0) }}
                <small v-if="usageTotal !== null">m³</small>
              </p>
              <ul class="usage-list">
                <li v-for="row in usageRows" :key="row.assetId">
                  <span>{{ row.code }}</span>
                  <span>{{ row.pointLabel }}</span>
                  <strong>{{ row.volumeM3 === null ? "缺数" : `${row.volumeM3.toFixed(0)} m³` }}</strong>
                  <small>有效样本 {{ row.validSamples }} · {{ (row.validSamples * 0.5).toFixed(1) }} h</small>
                </li>
              </ul>
              <p class="tab-note">
                按 30 分钟有效样本梯形积分，采样间隔超过 2 小时不参与计算；数据来源 MOCK 模拟遥测。
              </p>
            </section>
          </div>

          <section class="mini-panel plan-panel">
            <h4>运行计划理论用水对比</h4>
            <div class="table-wrap">
              <table class="plan-table">
                <thead>
                  <tr>
                    <th>计划</th>
                    <th>设备数</th>
                    <th>时长</th>
                    <th>理论用水</th>
                    <th>口径</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{{ SPRAY_PLANS[0].label }}</td>
                    <td>{{ SPRAY_PLANS[0].deviceCount }} 台</td>
                    <td>{{ SPRAY_PLANS[0].hours }} h</td>
                    <td>{{ fmt(planComparison.current.volumeM3, 0) }} m³</td>
                    <td>{{ basisLabel }}</td>
                  </tr>
                  <tr>
                    <td>{{ SPRAY_PLANS[1].label }}</td>
                    <td>{{ SPRAY_PLANS[1].deviceCount }} 台</td>
                    <td>{{ SPRAY_PLANS[1].hours }} h</td>
                    <td>{{ fmt(planComparison.reduced.volumeM3, 0) }} m³</td>
                    <td>{{ basisLabel }}</td>
                  </tr>
                  <tr>
                    <td>{{ SPRAY_PLANS[2].label }}</td>
                    <td>{{ SPRAY_PLANS[2].deviceCount }} 台</td>
                    <td>{{ SPRAY_PLANS[2].hours }} h</td>
                    <td>{{ fmt(planComparison.off.volumeM3, 0) }} m³</td>
                    <td>{{ basisLabel }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="usage-diff">
              调整运行计划后的理论用水差异：
              <strong>
                {{ planComparison.diffM3 === null ? "缺数，无法对比" : `${fmt(planComparison.diffM3, 0)} m³` }}
              </strong>
              <span v-if="planComparison.diffPct !== null">（{{ planComparison.diffPct.toFixed(1) }}%）</span>
            </p>
            <p class="tab-note">{{ planComparison.note }} 计划时长为演示参数。</p>
          </section>
        </NTabPane>

        <NTabPane name="records" tab="告警与工单">
          <div class="records-grid">
            <section class="mini-panel">
              <div class="mini-head">
                <h4>本系统告警</h4>
                <RouterLink to="/operations/alarms">全部告警 →</RouterLink>
              </div>
              <ul v-if="activeAlarms.length" class="record-list">
                <li v-for="alarm in activeAlarms" :key="alarm.id">
                  <div class="record-head">
                    <span class="state-tag" :class="alarm.level === 'critical' ? 'attention' : 'warn'">
                      {{ ALARM_LEVEL_LABELS[alarm.level] }}
                    </span>
                    <strong>{{ alarm.title }}</strong>
                    <small>{{ formatAt(alarm.occurredAt) }}</small>
                  </div>
                  <p>{{ alarm.detail }}</p>
                  <div class="record-foot">
                    <span>{{ ALARM_STATUS_LABELS[alarm.status] }} · {{ alarm.code }}</span>
                    <NButton size="tiny" quaternary @click="openAsset(alarm.assetId)">打开设备</NButton>
                  </div>
                </li>
              </ul>
              <p v-else class="empty">当前没有活动告警；缺数不等于设备正常。</p>
            </section>

            <section class="mini-panel">
              <div class="mini-head">
                <h4>本系统工单</h4>
                <RouterLink to="/operations/workorders">全部工单 →</RouterLink>
              </div>
              <ul v-if="workorders.length" class="record-list">
                <li v-for="order in workorders" :key="order.id">
                  <div class="record-head">
                    <span class="state-tag idle">{{ WORKORDER_STATUS_LABELS[order.status] ?? order.status }}</span>
                    <strong>{{ order.title }}</strong>
                    <small>{{ order.code }}</small>
                  </div>
                  <p>{{ order.symptom }}</p>
                  <div class="record-foot">
                    <span>
                      {{ formatAt(order.createdAt) }} · 告警 {{ order.alarmId ?? "无" }} · 负责人
                      {{ order.assignee ?? "未指派" }}
                    </span>
                    <NButton size="tiny" quaternary @click="openAsset(order.assetId)">打开设备</NButton>
                  </div>
                </li>
              </ul>
              <p v-else class="empty">射雾器暂无工单记录，可从智能建议生成草稿。</p>
            </section>
          </div>

          <section class="mini-panel audit-panel">
            <div class="mini-head">
              <h4>过程记录（本地审计）</h4>
              <span class="caption">仅记录 DEMO 内操作，不含真实控制指令</span>
            </div>
            <ul v-if="sprayAudits.length" class="audit-list">
              <li v-for="audit in sprayAudits" :key="audit.id">
                <span class="audit-at">{{ formatAt(audit.at) }}</span>
                <span class="audit-role">{{ roleNames[audit.actorRole] }}</span>
                <strong>{{ audit.summary }}</strong>
                <small>{{ audit.action }}</small>
              </li>
            </ul>
            <p v-else class="empty">当前场景暂无射雾器相关过程记录。</p>
          </section>
        </NTabPane>

        <NTabPane name="ai" tab="AI 辅助分析">
          <div class="ai-grid">
            <section class="mini-panel">
              <h4>本地规则可执行的射雾器问题</h4>
              <div class="ai-actions">
                <NButton size="small" secondary :disabled="!canAsk" @click="runAi('runtime')">
                  查询运行设备与异常
                </NButton>
                <NButton size="small" secondary :disabled="!canAsk" @click="runAi('pressure')">
                  分析最近 24 小时压力趋势
                </NButton>
                <NButton size="small" secondary :disabled="!canAsk" @click="runAi('area')">
                  查询区域作业状态
                </NButton>
                <NButton size="small" secondary :disabled="!canAsk" @click="runAi('water')">
                  计算方案理论用水量
                </NButton>
                <NButton size="small" secondary :disabled="!canAsk" @click="runAi('check')">
                  根据异常生成检查任务草稿
                </NButton>
                <NButton size="small" secondary :disabled="!canAsk" @click="runAi('trend')">
                  生成趋势图并进入工作台
                </NButton>
              </div>
              <p class="tab-note">
                以上均为本地规则计算，不调用大模型；不在能力范围内的开放式指令会明确提示不支持，不伪造推理结论。
              </p>
              <NButton size="small" type="primary" ghost :disabled="!canAsk" @click="openAi">
                打开 AI 助手（携带射雾器上下文）
              </NButton>
            </section>

            <section class="mini-panel">
              <h4>本次分析结果</h4>
              <template v-if="aiResult">
                <strong class="ai-title">{{ aiResult.title }}</strong>
                <ul class="ai-lines">
                  <li v-for="line in aiResult.lines" :key="line">{{ line }}</li>
                </ul>
              </template>
              <p v-else class="empty">选择左侧任一动作后在此查看结果与数据口径。</p>
            </section>
          </div>
        </NTabPane>
      </NTabs>
    </section>
  </section>
</template>

<style scoped>
.spray-v3-evidence{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:10px 14px;background:linear-gradient(100deg,#fdfaf1,#f0f8fb);border:1px solid #e8deca;border-radius:10px}
.spray-v3-evidence>div{display:grid;gap:5px;flex:1;min-width:220px}
.spray-v3-evidence strong{font-size:11px;color:#9f8156}
.spray-v3-evidence span{font-size:11px;color:#889dae;line-height:1.65}
.spray-v3-evidence nav{display:flex;flex-wrap:wrap;gap:7px}
.spray-v3-evidence a{font-size:11px;color:#2a7ca2;padding:6px 9px;text-decoration:none;border:1px solid #c9e2ee;border-radius:6px;background:#fff}
.spray-v3-evidence a:hover{background:#e5f4fa}

.spray-view {
  --spray-bg: #eaf4ff;
  --spray-card: rgba(255, 255, 255, 0.9);
  --spray-primary: #2586f4;
  --spray-soft: #eff7ff;
  --spray-title: #173553;
  --spray-text: #6b8199;
  --spray-line: #dceaf7;
  --spray-ok: #25aa64;
  --spray-alert: #e45252;
  --spray-warn: #e8a33e;
  --spray-radius: 12px;
  --spray-gap: 12px;
  display: flex;
  flex-direction: column;
  gap: var(--spray-gap);
  min-width: 0;
  padding: 2px 0 8px;
  color: var(--spray-text);
}

/* 顶部信息栏 */
.info-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 56px;
  padding: 5px 16px;
  border-radius: var(--spray-radius);
  border: 1px solid var(--spray-line);
  background: var(--spray-card);
  box-shadow: 0 8px 22px rgba(37, 134, 244, 0.06);
  min-width: 0;
}
.info-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #ffffff;
  background: linear-gradient(140deg, #5ab2ea, #2586f4);
  box-shadow: 0 6px 14px rgba(37, 134, 244, 0.26);
}
.info-icon svg {
  width: 24px;
  height: 24px;
}
.info-heading h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.25;
  color: var(--spray-title);
  letter-spacing: 0.2px;
}
.info-heading p {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--spray-text);
}
.info-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-left: auto;
  min-width: 0;
  font-size: 12px;
}
.tab-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.tab-pill {
  height: 30px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #4f6b85;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.tab-pill:hover {
  background: #eaf4ff;
  color: var(--spray-primary);
}
.tab-pill.active {
  background: var(--spray-primary);
  color: #ffffff;
  box-shadow: 0 6px 14px rgba(37, 134, 244, 0.24);
}
.status-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.status-inline i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--spray-ok);
  box-shadow: 0 0 0 3px rgba(37, 170, 100, 0.14);
}
.status-inline.ok {
  color: var(--spray-ok);
}
.status-inline.warn {
  color: var(--spray-warn);
}
.status-inline.warn i {
  background: var(--spray-warn);
  box-shadow: 0 0 0 3px rgba(232, 163, 62, 0.16);
}
.status-inline.alert {
  color: var(--spray-alert);
}
.status-inline.alert i {
  background: var(--spray-alert);
  box-shadow: 0 0 0 3px rgba(228, 82, 82, 0.16);
}
.meta-divider {
  width: 1px;
  height: 12px;
  background: var(--spray-line);
}
.ai-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 8px;
  border: 1px solid var(--spray-line);
  background: #ffffff;
  color: var(--spray-primary);
  cursor: pointer;
}
.ai-trigger svg {
  width: 17px;
  height: 17px;
}
.ai-trigger:hover:not(:disabled) {
  border-color: #9fcdf5;
  background: #f2f9ff;
}
.ai-trigger:disabled {
  color: #b8c7d3;
  cursor: not-allowed;
}
.scene-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--spray-line);
  background: #ffffff;
  color: var(--spray-title);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.scene-trigger:hover,
.scene-trigger.open {
  border-color: #9fcdf5;
  color: var(--spray-primary);
}
.scene-trigger svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.scene-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px dashed #b7d9ea;
  background: #f4fafd;
}
.scene-label {
  font-size: 12px;
  color: #5b7b91;
  font-weight: 600;
}
.scene-current {
  margin-left: auto;
  font-size: 11px;
  color: #8ba0b2;
}

/* KPI */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--spray-gap);
}
.kpi-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 90px;
  padding: 6px 14px;
  border-radius: var(--spray-radius);
  border: 1px solid var(--spray-line);
  background: var(--spray-card);
  box-shadow: 0 8px 20px rgba(37, 134, 244, 0.05);
  min-width: 0;
}
.kpi-card.alert {
  border-color: #f6d3cf;
  background: linear-gradient(150deg, #fff9f8, #fdf1ef);
}
.kpi-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 10px;
}
.kpi-icon svg {
  width: 24px;
  height: 24px;
}
.kpi-icon.blue {
  color: #2586f4;
  background: #eaf3ff;
}
.kpi-icon.teal {
  color: #1a9f95;
  background: #e6f7f5;
}
.kpi-icon.cyan {
  color: #1f9ad6;
  background: #e8f6fd;
}
.kpi-icon.red {
  color: #e45252;
  background: #fdeceb;
}
.kpi-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.kpi-label {
  font-size: 12px;
  color: var(--spray-text);
}
.kpi-value-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.kpi-value {
  font-size: 27px;
  line-height: 1.15;
  font-weight: 700;
  color: var(--spray-title);
  white-space: nowrap;
}
.kpi-value small {
  margin-left: 3px;
  font-size: 12px;
  font-weight: 500;
  color: var(--spray-text);
}
.kpi-value.missing {
  font-size: 21px;
  color: #9aacbc;
}
.kpi-delta {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.kpi-delta.ok {
  color: var(--spray-ok);
}
.kpi-delta.warn {
  color: var(--spray-warn);
}
.kpi-delta.alert {
  color: var(--spray-alert);
}
.kpi-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: #8ba0b2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kpi-bar {
  height: 4px;
  margin-top: 3px;
  border-radius: 999px;
  background: #e9f2fb;
  overflow: hidden;
}
.kpi-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #75c3f2, #2586f4);
}

/* 主体 */
.spray-main {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--spray-gap);
  align-items: stretch;
}
.panel {
  border-radius: var(--spray-radius);
  border: 1px solid var(--spray-line);
  background: var(--spray-card);
  box-shadow: 0 10px 24px rgba(37, 134, 244, 0.05);
  min-width: 0;
}
.scada-panel {
  display: flex;
  flex-direction: column;
  padding: 12px 14px 10px;
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 9px;
}
.panel-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--spray-primary);
  background: var(--spray-soft);
}
.panel-icon svg {
  width: 19px;
  height: 19px;
}
.panel-title h2 {
  margin: 0;
  font-size: 15px;
  color: var(--spray-title);
  font-weight: 700;
}
.panel-sub {
  margin: 2px 0 0;
  font-size: 11px;
  color: #8ba0b2;
}
.soft-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid #d8e9f7;
  background: #f4faff;
  color: #6690b0;
  font-size: 10.5px;
  white-space: nowrap;
}
.canvas-eyebrow {
  display: none;
}
.extra-bound {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}
.extra-label {
  font-size: 11px;
  color: #7c93a5;
}
.extra-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px 2px 9px;
  border-radius: 999px;
  border: 1px solid #cfe4f0;
  background: #fff;
  color: #2a4660;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.extra-chip:hover,
.extra-chip:focus-visible {
  border-color: #8fbdd4;
  outline: none;
}
.mock-flag {
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 14px;
  font-weight: 400;
  color: #a06a1f;
  background: #fdf1da;
  border: 1px solid #f0d6a4;
}
.scada-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid #e8f2fa;
  font-size: 11px;
}
.status-item {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}
.status-item em {
  font-style: normal;
  color: #8ba0b2;
}
.status-item strong {
  color: var(--spray-title);
  font-size: 12.5px;
}
.status-item strong.ok {
  color: var(--spray-ok);
}
.status-item.wide small {
  color: #a0b2c0;
}
.status-source {
  margin-left: auto;
  color: #a0b2c0;
  font-size: 10.5px;
}

/* 右侧卡片 */
.side-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spray-gap);
  min-width: 0;
  min-height: 0;
}
.side-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  min-height: 0;
}
.env-card {
  flex: 1.15 1 0;
  overflow: hidden;
}
.suggest-card {
  flex: 1.45 1 0;
  min-height: 0;
}
.event-card {
  flex: 1.05 1 0;
  overflow: hidden;
}
.side-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  min-height: 22px;
}
.side-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.side-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--spray-primary);
  background: var(--spray-soft);
  flex-shrink: 0;
}
.side-icon svg {
  width: 17px;
  height: 17px;
}
.side-head h3 {
  margin: 0;
  font-size: 14px;
  color: var(--spray-title);
  font-weight: 700;
}
.env-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  flex: 1;
}
.env-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 6px 10px;
  border-radius: 8px;
  background: #f8fbfe;
  border: 1px solid #e9f2fa;
  min-width: 0;
}
.env-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
  min-height: 24px;
}
.env-row strong {
  color: var(--spray-title);
  font-size: 12.5px;
  text-align: right;
}
.env-row strong.missing {
  color: var(--spray-warn);
}
.env-row .state-tag {
  margin-left: 4px;
}
.state-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 17px;
  white-space: nowrap;
  background: #eef4f8;
  color: #7c93a5;
}
.state-tag.running {
  background: #e4f7ed;
  color: #1a8f5c;
}
.state-tag.idle {
  background: #eef4f8;
  color: #7c93a5;
}
.state-tag.attention {
  background: #fdecea;
  color: #c05045;
}
.state-tag.warn {
  background: #fdf3e2;
  color: #a06a1f;
}

.suggest-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  max-height: 230px;
  padding-right: 2px;
}
.suggestion {
  padding: 9px 10px;
  border-radius: 9px;
  border: 1px solid #d8ecda;
  background: #f6fdf9;
}
.suggestion.action {
  border-color: #f3d9c2;
  background: #fffaf5;
}
.suggest-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.suggest-head strong {
  font-size: 12px;
  line-height: 1.45;
  color: var(--spray-title);
}
.suggest-line {
  margin: 5px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: #5f788d;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.suggest-line em {
  font-style: normal;
  font-weight: 600;
  color: #43607a;
}
.suggest-evidence {
  margin-top: 7px;
  padding: 7px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px dashed #dbe9f4;
}
.suggest-evidence dl {
  margin: 0;
}
.suggest-evidence dl > div {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 6px;
  padding: 2px 0;
  font-size: 10.5px;
  line-height: 1.5;
}
.suggest-evidence dt {
  color: #96a9b9;
}
.suggest-evidence dd {
  margin: 0;
  color: #43607a;
}
.suggest-evidence dd span {
  display: block;
}
.suggest-actions {
  display: flex;
  gap: 8px;
  margin-top: 9px;
}
.empty {
  margin: 4px 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: #96a9b9;
}
.side-card > .empty {
  margin: auto 0;
  text-align: center;
  font-size: 12px;
}
.empty small {
  color: #aebfcd;
}

.event-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #eef4f8;
  color: #7c93a5;
  font-size: 10.5px;
  font-weight: 700;
}
.event-count.active {
  background: #fdecea;
  color: #c05045;
}
.more-link {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--spray-primary);
  white-space: nowrap;
}
.event-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.event-list li,
.order-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px;
  border-radius: 8px;
  background: #f9fcfe;
  border: 1px solid #edf5fa;
}
.event-dot,
.order-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--spray-warn);
}
.event-dot.alarm {
  background: var(--spray-alert);
}
.order-dot {
  background: #8fb7d1;
}
.event-main {
  flex: 1;
  min-width: 0;
}
.event-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.event-title strong {
  font-size: 11.5px;
  color: #24445c;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.event-main small {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: #96a9b9;
}
.event-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8fb1c8;
  cursor: pointer;
  text-decoration: none;
}
.event-chevron:hover {
  background: #eaf4fc;
  color: var(--spray-primary);
}
.event-chevron svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.order-block {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px dashed #e2edf4;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Tabs */
.tabs-panel {
  padding: 10px 16px 14px;
}
.tabs-panel :deep(.n-tabs-nav) {
  display: none;
}
.tabs-panel :deep(.n-tabs-pane-wrapper) {
  margin-top: 0;
}
.tab-note {
  margin: 0 0 8px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #8ba0b2;
}
.table-wrap {
  width: 100%;
  overflow-x: auto;
}
.asset-table,
.plan-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.asset-table th,
.asset-table td,
.plan-table th,
.plan-table td {
  padding: 7px 8px;
  border-bottom: 1px solid #eef4f8;
  text-align: left;
  white-space: nowrap;
}
.asset-table th,
.plan-table th {
  font-size: 11px;
  font-weight: 600;
  color: #7c93a5;
  background: #f7fbfe;
}
.asset-table tbody tr {
  cursor: pointer;
}
.asset-table tbody tr:hover {
  background: #f3fafe;
}
.trend-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.trend-layout {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr);
  gap: 12px;
}
.trend-chart {
  min-width: 0;
}
.trend-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12.5px;
  color: var(--spray-title);
}
.caption {
  font-size: 10.5px;
  color: #96a9b9;
}
.trend-stats {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #e4eff8;
  background: #f9fcff;
  min-width: 0;
}
.trend-stats h4 {
  margin: 0 0 8px;
  font-size: 12.5px;
  color: var(--spray-title);
}
.trend-stats dl {
  margin: 0;
}
.trend-stats dl > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px dashed #e9f2fa;
}
.trend-stats dt {
  font-size: 11.5px;
  color: #8ba0b2;
}
.trend-stats dd {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--spray-title);
}
.trend-stats dd small {
  font-size: 10.5px;
  font-weight: 400;
  color: #8ba0b2;
}
.trend-verdict {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 9px 0 0;
  padding: 8px 9px;
  border-radius: 8px;
  font-size: 10.5px;
  line-height: 1.5;
}
.trend-verdict.ok {
  background: #eaf9f1;
  color: #1a8f5c;
}
.trend-verdict.warn {
  background: #fdf3e2;
  color: #a06a1f;
}
.trend-verdict .check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  background: currentColor;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
}
.stats-note {
  margin: 8px 0 0;
  font-size: 10px;
  line-height: 1.5;
  color: #a0b2c0;
}
.usage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.mini-panel {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #e4eff8;
  background: #fbfdff;
  min-width: 0;
}
.mini-panel h4 {
  margin: 0 0 6px;
  font-size: 12.5px;
  color: var(--spray-title);
}
.mini-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.usage-value {
  margin: 4px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--spray-title);
}
.usage-value small {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: #8ba0b2;
}
.usage-list {
  margin: 6px 0;
  padding: 0;
  list-style: none;
}
.usage-list li {
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
  border-top: 1px solid #eef4f8;
  font-size: 11.5px;
  color: #43607a;
}
.usage-list small {
  font-size: 10px;
  color: #96a9b9;
}
.usage-diff {
  margin: 8px 0 4px;
  font-size: 12.5px;
  color: #24445c;
}
.usage-diff strong {
  color: var(--spray-ok);
}
.plan-panel {
  margin-top: 2px;
}
.records-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.record-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.record-list li {
  padding: 8px 0;
  border-bottom: 1px solid #eef4f8;
}
.record-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--spray-title);
}
.record-head small {
  color: #96a9b9;
  font-size: 10.5px;
}
.record-list p {
  margin: 4px 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: #5d7387;
}
.record-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10.5px;
  color: #96a9b9;
}
.audit-panel {
  margin-top: 12px;
}
.audit-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.audit-list li {
  display: grid;
  grid-template-columns: 110px 88px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: baseline;
  padding: 5px 0;
  border-top: 1px solid #eef4f8;
  font-size: 11.5px;
  color: #43607a;
}
.audit-at,
.audit-role {
  color: #96a9b9;
  font-size: 10.5px;
}
.audit-list small {
  font-size: 10px;
  color: #a0b2c0;
}
.ai-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 12px;
}
.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.ai-title {
  display: block;
  margin: 4px 0 6px;
  font-size: 13px;
  color: var(--spray-title);
}
.ai-lines {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #43607a;
}

@media (max-width: 1500px) {
  .info-meta {
    display: none;
  }
  .env-card,
  .suggest-card,
  .event-card {
    flex: 0 0 auto;
  }
}
@media (max-width: 1180px) {
  .spray-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .side-stack {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    align-items: stretch;
  }
  .suggest-list {
    max-height: none;
  }
}
@media (max-width: 1240px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .info-bar {
    flex-wrap: wrap;
  }
  .info-meta {
    order: 3;
    flex-basis: 100%;
    padding-top: 6px;
    border-top: 1px dashed #e6f1f9;
  }
}
@media (max-width: 900px) {
  .trend-layout,
  .usage-grid,
  .records-grid,
  .ai-grid,
  .env-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .side-stack {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .kpi-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .info-title {
    flex: 1;
  }
  .scene-trigger {
    width: 100%;
    justify-content: space-between;
  }
  .audit-list li,
  .usage-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
@media (max-width: 760px) {
  .diagram-workspace { --diagram-height: max(240px, calc(100dvh - 480px)); }
  .scada-panel .panel-head { flex-wrap: wrap; }
  .diagram-sidebar, .diagram-properties { width: 100%; min-width: 0; }
  .side-stack { grid-template-columns: minmax(0,1fr); }
}
</style>
<style scoped>
.diagram-switch { display:flex; gap:4px; }
.diagram-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.diagram-workspace {
  --diagram-height: max(300px, calc(100dvh - 350px));
  flex: 1 0 var(--diagram-height);
  min-width: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  background: #f6fbff;
  border-radius: 8px;
}
.diagram-workspace.editing { display:grid; grid-template-rows: minmax(var(--diagram-height), 1fr); grid-template-columns:180px minmax(0,1fr) 220px; gap:12px; align-items:start; margin:12px 0; }
.diagram-editor { display:contents; }
.diagram-workspace.editing :deep(.spray-canvas) { grid-column:2; grid-row:1; align-self:stretch; }
.diagram-properties { grid-column:3; grid-row:1; }
.diagram-sidebar:first-child { grid-column:1; grid-row:1; }
.diagram-sidebar { display:flex; flex-direction:column; gap:7px; width:180px; max-height:300px; overflow:auto; padding:12px; border:1px solid #d3e6f6; border-radius:10px; background:#f7fbff; color:#173553; }
.diagram-sidebar button,.diagram-sidebar input,.diagram-sidebar select { padding:5px 7px; border:1px solid #c9dded; border-radius:6px; background:white; color:#173553; }
.diagram-sidebar button { cursor:pointer; text-align:left; }
.diagram-sidebar label { display:flex; flex-direction:column; gap:3px; font-size:12px; }
.diagram-sidebar label:has(input[type=checkbox]) { flex-direction:row; align-items:center; }
.diagram-properties { width:220px; }
@media(max-width:1100px) { .diagram-workspace.editing { grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows: var(--diagram-height) auto; } .diagram-workspace.editing :deep(.spray-canvas) { grid-column:1 / -1; grid-row:1; } .diagram-sidebar:first-child { grid-column:1; grid-row:2; } .diagram-properties { grid-column:2; grid-row:2; } }
</style>

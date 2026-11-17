<script setup lang="ts">
import { applyOfficialMessages } from "../demo/a2ui-v1";
import { rainStorage } from "../demo/water";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NButton, NInput, NSelect, NTag } from "naive-ui";
import A2uiRenderer from "../components/a2ui/A2uiRenderer.vue";
import {
  A2UI_COMPONENT_LABELS,
  DEFAULT_RAIN_PARAMS,
  applyMessages,
  authorizeAction,
  composeEnergySurface,
  composeRainSurface,
  dashboardToMessages,
  isEnergyQuery,
  surfaceToWidgets,
} from "../demo/a2ui";
import type {
  A2uiAction,
  A2uiComponent,
  A2uiComponentName,
  A2uiError,
  A2uiMessage,
  RainSurfaceParams,
  Surface,
} from "../demo/a2ui";
import { isPumpAsset, scorePumpHealth } from "../demo/health";
import { can, roleNames } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import type { Dashboard } from "../demo/types";
import { formatDateTime } from "../demo/workorderMeta";

const route = useRoute();
const router = useRouter();
const store = useDemoStore();
const ui = useUiStore();

const surface = ref<Surface | null>(null);
const errors = ref<A2uiError[]>([]);
const notices = ref<string[]>([]);
const params = ref<RainSurfaceParams>({ ...DEFAULT_RAIN_PARAMS });
const aiPrompt = ref("最近三次降雨南北储量对比，折线图，并显示平均值");
const dashboardId = ref("");
const dashboardName = ref("降雨储量分析看板");
const savedVersion = ref<number | null>(null);

const canEdit = computed(() => can(store.role, "dashboard:edit:self"));
const canAskAi = computed(() => can(store.role, "ai:ask"));
const widgetCount = computed(() =>
  surface.value ? surfaceToWidgets(surface.value).length : 0,
);
const activeDashboard = computed(
  () => store.dashboards.find((item) => item.id === dashboardId.value) ?? null,
);
const surfaceSummary = computed(() =>
  surface.value
    ? `${surface.value.surfaceId} · 根组件 ${surface.value.root} · Catalog ${surface.value.catalogId}`
    : "尚未创建 Surface",
);

const chartTypeOptions = [
  { label: "折线图", value: "line" },
  { label: "柱状图", value: "bar" },
];
const rangeOptions = [
  { label: "最近 1 次", value: 1 },
  { label: "最近 2 次", value: 2 },
  { label: "最近 3 次", value: 3 },
];

const LIBRARY: { name: A2uiComponentName; description: string }[] = [
  { name: "MetricCard", description: "单项指标与口径提示" },
  { name: "TrendChart", description: "单雨次南北储量趋势" },
  { name: "CompareChart", description: "多次雨次南北对比" },
  { name: "DataTable", description: "雨次概览表格" },
  { name: "AssetInfo", description: "设备台账关键字段" },
  { name: "HealthFactorCard", description: "主泵健康因子与缺测" },
  { name: "EvidenceList", description: "已审核档案证据" },
  { name: "WorkOrderReview", description: "工单状态与处理摘要" },
  { name: "ProcessPointPicker", description: "设备测点与单位" },
  { name: "EmptyState", description: "空状态与缺数说明" },
];

let componentSeq = 0;

function nextComponentId(prefix: string): string {
  do { componentSeq += 1; } while (surface.value?.components.some(item => item.id === `${prefix}-${componentSeq}`));
  return `${prefix}-${componentSeq}`;
}

function pushNotice(text: string): void {
  notices.value = [
    `${formatDateTime(store.seed.referenceTime)} · ${text}`,
    ...notices.value,
  ].slice(0, 8);
}

function setError(code: A2uiError["code"], message: string): void {
  errors.value = [{ code, message }];
}

function generateRain(
  next: Partial<RainSurfaceParams> = {},
  successText = "生成南北储量对比",
): void {
  const rainId = typeof route.query.rainEventIds === "string" ? route.query.rainEventIds : undefined;
  const composed = composeRainSurface(store.seed, { ...params.value, ...next }, rainId);
  if (composed.rejected || !composed.params) {
    errors.value = composed.errors;
    return;
  }
  // The local simulator uses the same entry point as a future v1.0 provider.
  const create = composed.messages.find(message => message.type === "createSurface");
  const update = composed.messages.find(message => message.type === "updateComponents");
  if (!create || !update) return;
  const { surfaceId, catalogId, root, dataModel } = create.surface;
  const result = applyOfficialMessages(null, [{
    version: "1.0",
    createSurface: {
      surfaceId, catalogId, dataModel,
      components: [
        ...update.components.map(({ id, component, props }) => ({
          id: id === root ? "root" : id, component, ...props,
        })),
        ...(surface.value?.components ?? []).filter(item => !["root", "rain-compare", "rain-metric"].includes(item.id))
          .map(({ id, component, props, children }) => ({ id, component, ...props, ...(children ? { children } : {}) })),
      ],
    },
  }], store.role);
  if (surface.value && !canEdit.value) {
    setError("FORBIDDEN_ACTION", "当前角色无权修改工作台");
    return;
  }
  if (result.error || !result.current) {
    setError("INVALID_MESSAGE", result.error ?? "未生成界面");
    return;
  }
  errors.value = [];
  surface.value = result.current.surface;
  params.value = composed.params;
  pushNotice(`${successText}（最近 ${params.value.rangeCount} 次 · ${params.value.chartType === "bar" ? "柱状" : "折线"}${params.value.showAverage ? " · 含平均值" : ""}）`);

}

function restoreDashboard(id: string): boolean {
  const dashboard = store.dashboards.find((item) => item.id === id);
  if (!dashboard) {
    setError("INVALID_MESSAGE", `看板 ${id} 不存在或当前角色无权访问`);
    return false;
  }
  const result = applyMessages(null, dashboardToMessages(dashboard), store.role);
  if (result.rejected || !result.surface) {
    errors.value = result.errors;
    return false;
  }
  surface.value = result.surface;
  dashboardId.value = dashboard.id;
  dashboardName.value = dashboard.name;
  savedVersion.value = dashboard.version;
  readParamsFromDashboard(dashboard);
  pushNotice(`恢复看板「${dashboard.name}」v${dashboard.version}`);
  return true;
}

function readParamsFromDashboard(dashboard: Dashboard): void {
  const chartWidget = dashboard.widgets.find(
    (widget) => widget.props.chartType === "line" || widget.props.chartType === "bar",
  );
  if (!chartWidget) return;
  const rangeCount = chartWidget.props.rangeCount;
  params.value = {
    chartType: chartWidget.props.chartType === "bar" ? "bar" : "line",
    rangeCount: rangeCount === 1 || rangeCount === 2 || rangeCount === 3 ? rangeCount : 3,
    showAverage: chartWidget.props.showAverage === true,
  };
}

onMounted(() => {
  const queryId = typeof route.query.dashboard === "string" ? route.query.dashboard : "";
  if (queryId) {
    if (!restoreDashboard(queryId)) generateRain({}, "回退生成南北储量对比");
    return;
  }
  generateRain(typeof route.query.rainEventIds === "string" ? { rangeCount: 1 } : {}, "生成南北储量对比");
  consumePrompt();
});
function consumePrompt(): void {
  if (typeof route.query.prompt !== "string") return;
  aiPrompt.value = route.query.prompt;
  runPrompt();
  const query = { ...route.query };
  delete query.prompt;
  void router.replace({ query });
}
watch(() => route.query.prompt, consumePrompt);

function changeChartType(value: string): void {
  if (value !== "line" && value !== "bar") return;
  generateRain(
    { chartType: value },
    `修改图型为${value === "line" ? "折线" : "柱状"}`,
  );
}

function changeRange(value: string | number): void {
  const count = Number(value);
  if (count !== 1 && count !== 2 && count !== 3) return;
  generateRain({ rangeCount: count }, `修改时间范围为最近 ${count} 次`);
}

function toggleAverage(): void {
  const next = !params.value.showAverage;
  generateRain({ showAverage: next }, next ? "增加平均值辅助线" : "移除平均值辅助线");
}

function runPrompt(): void {
  const text = aiPrompt.value.trim();
  if (!text) {
    setError("INVALID_MESSAGE", "请输入指令后再生成");
    return;
  }
  if (isEnergyQuery(text)) {
    errors.value = composeEnergySurface(store.points).errors;
    return;
  }
  if (!canAskAi.value) {
    setError(
      "FORBIDDEN_ACTION",
      `角色「${roleNames[store.role]}」无权使用 AI 指令生成（需要 ai:ask）`,
    );
    return;
  }
  if (editCanvasFromPrompt(text)) return;
  const chosen = canvasComponents.value.find(item => item.id === selectedComponentId.value);
  if (chosen?.component === "TrendChart" && /折线|柱状/.test(text) && !/降雨|雨次/.test(text)) {
    mutateCanvas(canvasComponents.value.map(item => item.id === chosen.id
      ? { ...item, props: { ...item.props, chartType: /柱状/.test(text) ? "bar" : "line" } }
      : item), "已更新选中趋势图");
    return;
  }
  if (!/降雨|雨次|储量|折线|柱状|平均|保存/.test(text)) {
    setError("INVALID_MESSAGE", "该指令尚未绑定可用的数据或组件");
    return;
  }
  if (/^保存/.test(text)) {
    const name = text.match(/(?:名称叫|命名为|保存为)[「“"]?([^。！；」”"\n]+)/)?.[1]?.trim();
    if (name) dashboardName.value = name;
    saveDashboard();
    return;
  }
  const rangeCount: 1 | 2 | 3 = /三次|3\s*次/.test(text)
    ? 3
    : /两次|2\s*次/.test(text)
      ? 2
      : /一次|1\s*次/.test(text) ? 1 : params.value.rangeCount;
  const chartType: "line" | "bar" = /柱状|条形|bar/i.test(text) ? "bar" : /折线|line/i.test(text) ? "line" : params.value.chartType;
  const showAverage = /平均|均值/.test(text) || params.value.showAverage;
  generateRain({ chartType, rangeCount, showAverage }, "按 AI 指令生成南北储量对比");
  const name = text.match(/保存为[「“"]?([^。！；」”"\n]+)[」”"]?/)?.[1]?.trim();
  if (name && !errors.value.length) {
    dashboardName.value = name;
    saveDashboard();
  }
}

function onAction(payload: { action: A2uiAction; componentId: string }): void {
  const auth = authorizeAction(store.role, payload.action);
  if (auth) {
    errors.value = [auth];
    return;
  }
  errors.value = [];
  const { kind, payload: data } = payload.action;
  if (kind === "openAsset") {
    const assetId = data?.assetId;
    if (!assetId) return;
    ui.openAsset(assetId);
    pushNotice(`从组件 ${payload.componentId} 打开设备 ${assetId}`);
    return;
  }
  if (kind === "openDocument") {
    const documentId = data?.documentId;
    if (!documentId) return;
    void router.push({ name: "archives", query: { docId: documentId } });
    pushNotice(`从组件 ${payload.componentId} 打开档案 ${documentId}`);
    return;
  }
  if (kind === "openWorkOrder") {
    const workOrderId = data?.workOrderId;
    if (!workOrderId) return;
    void router.push({ name: "workorders", query: { workOrderId } });
    pushNotice(`从组件 ${payload.componentId} 打开工单 ${workOrderId}`);
    return;
  }
  if (kind === "askAi") {
    ui.openAi({}, `基于看板「${dashboardName.value}」继续追问`);
    pushNotice("从组件动作打开问 AI 抽屉");
    return;
  }
  saveDashboard();
}

function saveDashboard(): void {
  errors.value = [];
  if (!surface.value) {
    setError("INVALID_MESSAGE", "当前没有可保存的 Surface");
    return;
  }
  const widgets = surfaceToWidgets(surface.value);
  if (!widgets.length) {
    setError("INVALID_MESSAGE", "Surface 中没有可保存的组件");
    return;
  }
  if (!canEdit.value) {
    setError(
      "FORBIDDEN_ACTION",
      `角色「${roleNames[store.role]}」无权保存个人看板（需要 dashboard:edit:self）`,
    );
    return;
  }
  const existing = activeDashboard.value;
  const id = existing?.id ?? (dashboardId.value || `dash-${Date.now().toString(36)}`);
  const now = store.seed.referenceTime;
  const draft: Dashboard = {
    id,
    name: dashboardName.value.trim() || "未命名看板",
    ownerId: "demo-user",
    ownerRole: store.role,
    scope: "personal",
    widgets,
    version: existing?.version ?? 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    history: existing?.history ?? [],
  };
  try {
    const saved = store.saveDashboard(draft);
    dashboardId.value = saved.id;
    dashboardName.value = saved.name;
    savedVersion.value = saved.version;
    void router.replace({ query: { ...route.query, dashboard: saved.id } });
    pushNotice(`保存看板「${saved.name}」v${saved.version}`);
  } catch (error) {
    setError("FORBIDDEN_ACTION", (error as Error).message);
  }
}

function goDashboards(): void {
  void router.push({ name: "my-dashboards" });
}

const selectedComponentId = ref("");
const undoStack = ref<Surface[]>([]);
const canvasComponents = computed(() => surface.value?.components ?? []);
function mutateCanvas(components: A2uiComponent[], notice: string): boolean {
  const previous = surface.value;
  if (!previous || !canEdit.value) {
    setError("FORBIDDEN_ACTION", "当前角色无权编辑工作台");
    return false;
  }
  const root = components.find(item => item.id === previous.root)?.id ?? components[0]?.id;
  if (!root) { setError("INVALID_MESSAGE", "请至少保留一个组件"); return false; }
  const result = applyMessages(null, [
    { type: "createSurface", surface: { ...previous, root } },
    { type: "updateComponents", surfaceId: previous.surfaceId, components },
  ], store.role);
  if (result.rejected || !result.surface) { errors.value = result.errors; return false; }
  undoStack.value = [...undoStack.value.slice(-19), previous];
  errors.value = [];
  surface.value = result.surface;
  pushNotice(notice);
  return true;
}
function undoCanvas(): void {
  if (!canEdit.value) return;
  const previous = undoStack.value.pop();
  if (previous) surface.value = previous;
}
function changeSelected(action: "delete" | "up" | "down" | "resize"): void {
  const components = [...canvasComponents.value];
  const i = components.findIndex(item => item.id === selectedComponentId.value);
  if (i < 0) { setError("INVALID_MESSAGE", "请先选中要修改的组件"); return; }
  if (action === "delete") components.splice(i, 1);
  else if (action === "resize") {
    const item = components[i];
    const layout = item.props?.layout as { x: number; y: number; w: number; h: number } | undefined;
    components[i] = { ...item, props: { ...item.props,
      layout: { ...componentLayout(5), ...layout, x: 0, w: layout?.w === 12 ? 6 : 12 } } };
  } else {
    const j = i + (action === "up" ? -1 : 1);
    if (!components[j]) return;
    [components[i], components[j]] = [components[j], components[i]];
    for (const [index, item] of components.entries()) {
      const layout = item.props?.layout as { w: number; h: number } | undefined;
      components[index] = { ...item, props: { ...item.props, layout: { x: 0, y: index * 6, w: layout?.w ?? 12, h: layout?.h ?? 5 } } };
    }
  }
  mutateCanvas(components, "已更新选中组件");
}
function addCanvasComponent(component: A2uiComponent): void {
  if (mutateCanvas([...canvasComponents.value, component], "已添加组件")) selectedComponentId.value = component.id;
}
function editCanvasFromPrompt(text: string): boolean {
  if (/撤销/.test(text)) { undoCanvas(); return true; }
  if (/删除.*(卡片|组件|图|表)/.test(text)) { changeSelected("delete"); return true; }
  if (/射雾器|喷雾|末端压力/.test(text) && /趋势|曲线|24\s*小时/.test(text)) {
    const sprayAssets = store.assets.filter(asset => asset.subsystemId === "spray" && !asset.archived);
    const to = store.seed.referenceTime;
    const from = new Date(Date.parse(to) - 24 * 3600000).toISOString();
    const source = sprayAssets.flatMap(asset => {
      const point = store.getPoints(asset.id).find(item => /压力/.test(item.label));
      return point ? [{ name: asset.code, samples: store.series(point.id, from, to) }] : [];
    });
    const times = [...new Set(source.flatMap(item => item.samples.map(sample => sample.at)))].sort();
    const hasValue = source.some(item => item.samples.some(sample => typeof sample.value === "number"));
    if (!times.length || !hasValue) {
      setError("MISSING_DATA", "射雾器末端压力没有有效样本，无法生成趋势图");
    } else {
      addCanvasComponent({ id: nextComponentId("spray-pressure"), component: "TrendChart", props: {
        title: "射雾器末端压力近 24 小时 · MOCK 模拟数据",
        labels: times.map(at => formatDateTime(at)),
        unit: "MPa", chartType: "line", layout: componentLayout(5), series: source.map(item => {
          const byTime = new Map(item.samples.map(sample => [sample.at, sample.value]));
          return { name: item.name, unit: "MPa", values: times.map(at => {
            const value = byTime.get(at);
            return typeof value === "number" ? value : null;
          }) };
        }),
      } });
      pushNotice("按射雾器末端压力生成近 24 小时趋势图");
    }
    return true;
  }
  if (/(增加|添加|插入|新增)/.test(text) && !/平均值/.test(text)) {
    if (/健康.*排行/.test(text)) {
      const subsystem = store.subsystems.find(item => text.includes(item.name));
      const rows = store.assets.filter(asset => !asset.archived && isPumpAsset(asset) && (!subsystem || asset.subsystemId === subsystem.id))
        .map(asset => {
          const reading = (metric: string) => {
            const point = store.getPoints(asset.id).find(item => item.id.endsWith(metric));
            const value = point && store.latest(point.id)?.value;
            return typeof value === "number" ? value : null;
          };
          const health = scorePumpHealth({ asset, readings: {
            vibration: reading("vibration"), temperature: reading("temperature"), current: reading("current"),
          }, runtimeHours: asset.runtimeHours, startCount: asset.startCount, asOf: store.seed.referenceTime });
          return { code: asset.code, name: asset.name, score: health.score };
        }).sort((a,b) => (a.score ?? Infinity) - (b.score ?? Infinity));
      if (!rows.length) setError("MISSING_DATA", "没有符合条件的泵类设备");
      else addCanvasComponent({ id: nextComponentId("ranking"), component: "DataTable", props: {
        title: `${subsystem?.name ?? ""}设备健康排行榜 · 模拟规则评分`,
        columns: [{ key: "code", title: "编号" }, { key: "name", title: "设备" }, { key: "score", title: "健康分" }],
        rows, layout: componentLayout(5),
      } });
      return true;
    }
    if (/振动.*趋势/.test(text)) {
      const table = canvasComponents.value.find(item => item.id === selectedComponentId.value && item.component === "DataTable");
      const rows = table?.props?.rows;
      const codes = Array.isArray(rows) ? rows.map(row => row.code) : [];
      const assets = store.assets.filter(asset => !asset.archived && codes.includes(asset.code));
      const to = store.seed.referenceTime;
      const from = new Date(Date.parse(to) - 7 * 86400000).toISOString();
      const source = assets.flatMap(asset => {
        const point = store.getPoints(asset.id).find(item => /振动/.test(item.label));
        return point ? [{ name: asset.code, samples: store.series(point.id, from, to) }] : [];
      });
      const times = [...new Set(source.flatMap(item => item.samples.map(sample => sample.at)))].sort();
      if (!times.length || !source.some(item => item.samples.some(sample => typeof sample.value === "number"))) {
        setError("MISSING_DATA", "请先选择健康排行，且设备需要有效振动测点");
      } else addCanvasComponent({ id: nextComponentId("vibration"), component: "TrendChart", props: {
        title: "所选设备近 7 天振动 · 模拟数据", labels: times.map(at => formatDateTime(at)),
        unit: "mm/s", chartType: "line", layout: componentLayout(5), series: source.map(item => {
          const byTime = new Map(item.samples.map(sample => [sample.at, sample.value]));
          return { name: item.name, unit: "mm/s", values: times.map(at => {
            const value = byTime.get(at);
            return typeof value === "number" ? value : null;
          }) };
        }),
      } });
      return true;
    }
    const name = /指标卡/.test(text) ? "MetricCard" : /储量.*趋势/.test(text) ? "TrendChart"
      : /雨次.*表/.test(text) ? "DataTable" : /健康因子/.test(text) ? "HealthFactorCard" : null;
    if (name) insertComponent(name);
    else setError("MISSING_DATA", "未找到所请求组件对应的已注册数据");
    return true;
  }
  const limit = /前\s*(\d+)\s*(?:台|条)/.exec(text)?.[1];
  const warning = /低于\s*(\d+(?:\.\d+)?)\s*分.*标红/.exec(text)?.[1];
  if (limit || warning) {
    const item = canvasComponents.value.find(entry => entry.id === selectedComponentId.value);
    if (!item || item.component !== "DataTable" || !Array.isArray(item.props?.rows)) {
      setError("INVALID_MESSAGE", "请先选择要筛选的数据表");
    } else mutateCanvas(canvasComponents.value.map(entry => entry.id === item.id
      ? { ...entry, props: { ...entry.props, rows: limit ? (item.props!.rows as unknown[]).slice(0, Number(limit)) : item.props!.rows, ...(warning ? { scoreWarningBelow: Number(warning) } : {}) } }
      : entry), "已更新表格行数");
    return true;
  }
  return false;
}
function insertComponent(name: A2uiComponentName): void {
  const component = buildLibraryComponent(name);
  if (component) addCanvasComponent(component);
}

function componentLayout(height: number): Record<string, number> {
  const index = surface.value ? surface.value.components.length : 0;
  return { x: 0, y: index * 4, w: 12, h: height };
}

function buildLibraryComponent(name: A2uiComponentName): A2uiComponent | null {
  const layout = componentLayout(name === "MetricCard" || name === "EmptyState" ? 3 : 5);
  switch (name) {
    case "MetricCard": {
      const kpi = store.kpis[0];
      return {
        id: nextComponentId("metric"),
        component: name,
        props: {
          label: kpi.label,
          value: kpi.value,
          unit: kpi.unit,
          hint: kpi.formula,
          layout,
        },
      };
    }
    case "TrendChart": {
      const event = store.seed.rainEvents[store.seed.rainEvents.length - 1];
      if (!event) {
        setError("MISSING_DATA", "种子没有雨次数据，无法插入趋势图");
        return null;
      }
      return {
        id: nextComponentId("trend"),
        component: name,
        props: {
          title: `储量趋势 · ${event.name}`,
          labels: event.north.map((_, index) => `${index + 1}h`),
          series: [
            { name: "北区储量", values: event.north, unit: event.unit },
            { name: "南区储量", values: event.south, unit: event.unit },
          ],
          chartType: "line",
          height: 280,
          unit: event.unit,
          layout,
        },
      };
    }
    case "CompareChart": {
      const composed = composeRainSurface(store.seed, params.value);
      const update = composed.messages.find(
        (message): message is Extract<A2uiMessage, { type: "updateComponents" }> =>
          message.type === "updateComponents",
      );
      const chart = update?.components.find(
        (component) => component.component === "CompareChart",
      );
      if (!chart) {
        errors.value = composed.errors;
        return null;
      }
      return {
        id: nextComponentId("compare"),
        component: name,
        props: { ...chart.props, layout },
      };
    }
    case "DataTable": {
      const rows = store.seed.rainEvents.map((event) => ({
        雨次: event.id,
        日期: event.occurredAt.slice(0, 10),
        降雨量: `${event.rainfallMm} mm`,
        北区末段: rainStorage(event).end?.north ?? null,
        南区末段: rainStorage(event).end?.south ?? null,
      }));
      return {
        id: nextComponentId("table"),
        component: name,
        props: {
          title: "雨次概览",
          columns: [
            { key: "雨次", title: "雨次" },
            { key: "日期", title: "日期" },
            { key: "降雨量", title: "降雨量" },
            { key: "北区末段", title: "北区末段 m³" },
            { key: "南区末段", title: "南区末段 m³" },
          ],
          rows,
          layout,
        },
      };
    }
    case "AssetInfo": {
      const asset = store.getAsset("asset-p002") ?? store.assets.find((item) => !item.archived);
      if (!asset) {
        setError("MISSING_DATA", "本地没有可用设备，无法插入设备信息");
        return null;
      }
      return {
        id: nextComponentId("asset"),
        component: name,
        props: {
          title: `设备信息 · ${asset.code}`,
          assetId: asset.id,
          fields: [
            { label: "名称", value: asset.name },
            { label: "类型", value: asset.type },
            { label: "所属工艺", value: asset.subsystemId },
            { label: "分区", value: asset.area === "north" ? "北区" : "南区" },
            { label: "运行状态", value: asset.status },
            { label: "累计运行", value: `${asset.runtimeHours} h` },
          ],
          action: {
            kind: "openAsset",
            label: "打开设备",
            payload: { assetId: asset.id },
          },
          layout,
        },
      };
    }
    case "HealthFactorCard": {
      const asset = store.getAsset("asset-p002") ?? store.assets.find((item) => !item.archived);
      if (!asset) {
        setError("MISSING_DATA", "本地没有可用设备，无法插入健康因子");
        return null;
      }
      const points = store.getPoints(asset.id);
      const reading = (suffix: string): number | null => {
        const point = points.find((item) => item.id.endsWith(suffix));
        if (!point) return null;
        const sample = store.latest(point.id);
        return sample && typeof sample.value === "number" ? sample.value : null;
      };
      const result = scorePumpHealth({
        asset,
        readings: {
          vibration: reading("vibration"),
          temperature: reading("temperature"),
          current: reading("current"),
        },
        runtimeHours: asset.runtimeHours,
        startCount: asset.startCount,
        asOf: store.seed.referenceTime,
      });
      return {
        id: nextComponentId("health"),
        component: name,
        props: {
          title: `健康因子 · ${asset.code}`,
          ...(typeof result.score === "number" ? { score: result.score } : {}),
          band: result.band,
          factors: result.factors.map((factor) => ({
            label: factor.label,
            value: factor.value,
            unit: factor.unit,
            note: factor.valid
              ? `扣分 ${factor.deduction ?? 0}`
              : factor.missingReason ?? "缺测",
          })),
          layout,
        },
      };
    }
    case "EvidenceList": {
      const documents = store.documents
        .filter((document) => document.reviewed && !document.unavailable)
        .slice(0, 3);
      return {
        id: nextComponentId("evidence"),
        component: name,
        props: {
          title: "已审核证据",
          items: documents.map((document) => ({
            kind: "document",
            refId: document.id,
            label: document.title,
            detail: document.sourceLabel,
            source: document.source,
          })),
          ...(documents[0]
            ? {
                action: {
                  kind: "openDocument",
                  label: "查看档案",
                  payload: { documentId: documents[0].id },
                },
              }
            : {}),
          layout,
        },
      };
    }
    case "WorkOrderReview": {
      const order =
        store.workorders.find(
          (item) => item.status !== "archived" && item.status !== "cancelled",
        ) ?? store.workorders[0];
      if (!order) {
        setError("MISSING_DATA", "本地没有工单，无法插入工单复核");
        return null;
      }
      return {
        id: nextComponentId("workorder"),
        component: name,
        props: {
          title: "工单复核",
          workOrderId: order.id,
          status: order.status,
          rows: [
            { label: "工单编号", value: order.code },
            { label: "标题", value: order.title },
            { label: "优先级", value: order.priority },
            { label: "负责人", value: order.assignee ?? "未指派" },
            { label: "症状", value: order.symptom },
          ],
          action: {
            kind: "openWorkOrder",
            label: "查看工单",
            payload: { workOrderId: order.id },
          },
          layout,
        },
      };
    }
    case "ProcessPointPicker": {
      const asset = store.getAsset("asset-p002") ?? store.assets.find((item) => !item.archived);
      if (!asset) {
        setError("MISSING_DATA", "本地没有可用设备，无法插入测点选择");
        return null;
      }
      return {
        id: nextComponentId("point"),
        component: name,
        props: {
          title: `测点选择 · ${asset.code}`,
          assetId: asset.id,
          points: store.getPoints(asset.id).slice(0, 8).map((point) => ({
            id: point.id,
            label: point.label,
            unit: point.unit ?? "",
            selected: point.kind === "number",
          })),
          action: {
            kind: "openAsset",
            label: "在台账中查看",
            payload: { assetId: asset.id },
          },
          layout,
        },
      };
    }
    case "EmptyState":
      return {
        id: nextComponentId("empty"),
        component: name,
        props: {
          title: "空状态占位",
          description: "从左侧组件库插入组件，或在右侧输入指令生成图表。",
          reason: "本地 Mock 数据，不调用模型；缺数指标不会生成替代曲线。",
          layout,
        },
      };
    default:
      return null;
  }
}
</script>

<template>
  <section class="workspace">
    <aside class="panel library">
      <div class="panel-head">
        <h2>组件库</h2>
        <p>点击插入 12 列画布；只有白名单组件可被渲染。</p>
      </div>
      <button
        v-for="item in LIBRARY"
        :key="item.name"
        type="button"
        class="library-item"
        @click="insertComponent(item.name)"
      >
        <strong>{{ A2UI_COMPONENT_LABELS[item.name] }}</strong>
        <small>{{ item.name }}</small>
        <span>{{ item.description }}</span>
      </button>
      <div class="policy">
        <strong>动作白名单</strong>
        <p>openAsset / openDocument / openWorkOrder / askAi / saveDashboard</p>
        <small>动作按角色鉴权，越权整条消息拒绝并保留最近合法 Surface。</small>
      </div>
    </aside>

    <section class="panel canvas">
      <div class="canvas-head">
        <div>
          <h2>{{ dashboardName }}</h2>
          <p>{{ surfaceSummary }}</p>
        </div>
        <div class="canvas-meta">
          <NTag size="small" :bordered="false">{{ widgetCount }} 个组件</NTag>
          <NTag v-if="savedVersion !== null" size="small" :bordered="false" type="info">
            已保存 v{{ savedVersion }}
          </NTag>
          <NTag v-if="activeDashboard" size="small" :bordered="false">
            {{ activeDashboard.id }}
          </NTag>
        </div>
      </div>

      <div class="canvas-body">
        <A2uiRenderer v-if="surface" :surface="surface" @action="onAction" />
        <div v-else class="canvas-empty">
          <strong>尚未生成 Surface</strong>
          <p>请在右侧输入指令或点击「生成图表」，本地生成器不会调用后端或大模型。</p>
        </div>
      </div>

      <p class="canvas-note">
        12 列栅格按组件 layout 排序；非法消息不产生部分更新，主数据保持最近一次合法状态。
      </p>
    </section>

    <aside class="panel inspector">
      <section class="inspector-block">
        <h3>AI 指令</h3>
        <NInput
          v-model:value="aiPrompt"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 5 }"
          placeholder="例如：最近三次降雨南北储量对比，折线图，并显示平均值"
        />
        <div class="row">
          <NButton type="primary" size="small" @click="runPrompt">生成图表</NButton>
          <NButton size="small" secondary @click="generateRain({}, '重新生成南北储量对比')">
            复位生成
          </NButton>
        </div>
        <p class="hint">
          本地规则解析，不调用大模型；请求用电量 / 电耗 / 能耗会因缺少 kW 测点被拒绝。
        </p>
      </section>

      <section class="inspector-block">
        <h3>属性</h3>

        <label class="field-label">图型</label>
        <NSelect
          size="small"
          :value="params.chartType"
          :options="chartTypeOptions"
          @update:value="changeChartType"
        />
        <label class="field-label">时间范围</label>
        <NSelect
          size="small"
          :value="params.rangeCount"
          :options="rangeOptions"
          @update:value="changeRange"
        />
        <NButton
          size="small"
          :type="params.showAverage ? 'primary' : 'default'"
          :secondary="!params.showAverage"
          @click="toggleAverage"
        >
          {{ params.showAverage ? "移除平均值" : "增加平均值" }}
        </NButton>
        <p class="hint">
          当前：{{ params.chartType === "bar" ? "柱状" : "折线" }} · 最近
          {{ params.rangeCount }} 次 · {{ params.showAverage ? "含平均值" : "不含平均值" }}
        </p>
              <NSelect v-model:value="selectedComponentId" placeholder="选择组件"
          :options="canvasComponents.map(item => ({ value: item.id, label: String(item.props?.title ?? item.props?.label ?? item.component) }))" class="component-select" />
        <div class="canvas-actions">
          <NButton size="tiny" :disabled="!canEdit" @click="changeSelected('up')">上移</NButton>
          <NButton size="tiny" :disabled="!canEdit" @click="changeSelected('down')">下移</NButton>
          <NButton size="tiny" :disabled="!canEdit" @click="changeSelected('resize')">调整宽度</NButton>
          <NButton size="tiny" :disabled="!canEdit" @click="changeSelected('delete')">删除组件</NButton>
          <NButton size="tiny" :disabled="!canEdit || !undoStack.length" @click="undoCanvas">撤销</NButton>
        </div>
      </section>

      <section class="inspector-block">
        <h3>保存看板</h3>
        <NInput v-model:value="dashboardName" size="small" placeholder="看板名称" />
        <div class="row">
          <NButton type="primary" size="small" :disabled="!canEdit" @click="saveDashboard">
            保存看板
          </NButton>
          <NButton size="small" secondary @click="goDashboards">我的看板</NButton>
        </div>
        <p class="hint">
          {{
            canEdit
              ? "保存写入本地 store 并递增版本，刷新后可用 dashboard 参数恢复。"
              : `角色「${roleNames[store.role]}」无 dashboard:edit:self 权限，保存会被拒绝。`
          }}
        </p>
      </section>

      <div v-if="errors.length" class="error-bar">
        <strong>消息被拒绝</strong>
        <p v-for="(error, index) in errors" :key="`${error.code}-${index}`">
          <code>{{ error.code }}</code>
          {{ error.message }}
        </p>
        <small v-if="errors.some((item) => item.code === 'MISSING_DATA')">
          缺数提示：不生成替代曲线，主画布保持上一次合法结果。
        </small>
      </div>

      <section class="inspector-block">
        <h3>修改记录</h3>
        <ul v-if="notices.length" class="notice-list">
          <li v-for="(notice, index) in notices" :key="index">{{ notice }}</li>
        </ul>
        <p v-else class="hint">暂无修改记录。</p>
      </section>
    </aside>
  </section>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 320px;
  gap: 14px;
  align-items: start;
  min-width: 0;
}

.panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}

.panel-head h2,
.canvas-head h2 {
  margin: 0;
  font-size: 16px;
  color: #1c3e57;
}

.panel-head p,
.canvas-head p {
  margin: 5px 0 10px;
  font-size: 11.5px;
  color: #748a9d;
  line-height: 1.65;
}

.library {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.library-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 11px;
  border: 1px solid #dcebf4;
  border-radius: 9px;
  background: #f8fcff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s;
}

.library-item:hover {
  border-color: #247ba8;
  background: #eef7fc;
}

.library-item strong {
  font-size: 12.5px;
  color: #1c3e57;
}

.library-item small {
  font-size: 10px;
  color: #9aacbb;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.library-item span {
  font-size: 10.5px;
  color: #7c91a4;
  line-height: 1.5;
}

.policy {
  margin-top: 6px;
  padding: 10px;
  border-radius: 8px;
  background: #f2f7fb;
}

.policy strong {
  font-size: 11px;
  color: #3d566c;
}

.policy p {
  margin: 4px 0;
  font-size: 10px;
  color: #5c87a1;
  line-height: 1.6;
  word-break: break-all;
}

.policy small {
  font-size: 10px;
  color: #8296a8;
  line-height: 1.6;
}

.canvas {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.canvas-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.canvas-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.canvas-body {
  min-height: 260px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #e1eef6;
  background:
    repeating-linear-gradient(90deg, transparent 0 79px, rgba(36, 123, 168, 0.04) 79px 80px),
    linear-gradient(180deg, rgba(248, 252, 255, 0.9), rgba(255, 255, 255, 0.95));
}

.canvas-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.canvas-empty strong {
  font-size: 14px;
  color: #1c3e57;
}

.canvas-empty p {
  margin: 0;
  font-size: 11.5px;
  color: #7c91a4;
  line-height: 1.7;
}

.canvas-note {
  margin: 0;
  font-size: 10.5px;
  color: #8296a8;
  line-height: 1.6;
}

.inspector {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.inspector-block {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef4f8;
}

.inspector-block:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.inspector-block h3 {
  margin: 0;
  font-size: 13px;
  color: #1c3e57;
}

.field-label {
  font-size: 10.5px;
  color: #71869a;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hint {
  margin: 0;
  font-size: 10.5px;
  color: #8296a8;
  line-height: 1.65;
}

.error-bar {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid #f0c2be;
  background: #fff5f4;
}

.error-bar strong {
  font-size: 12px;
  color: #b0443c;
}

.error-bar p {
  margin: 0;
  font-size: 10.5px;
  color: #8a5550;
  line-height: 1.6;
}

.error-bar code {
  display: inline-block;
  margin-right: 4px;
  padding: 1px 4px;
  border-radius: 4px;
  background: #f7d9d6;
  color: #a13a33;
  font-size: 9.5px;
}

.error-bar small {
  font-size: 10px;
  color: #9a6b66;
  line-height: 1.6;
}

.notice-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.notice-list li {
  padding: 6px 8px;
  border-radius: 7px;
  background: #f5fafd;
  font-size: 10.5px;
  color: #5f7a8f;
  line-height: 1.55;
}

@media (max-width: 1440px) {
  .workspace {
    grid-template-columns: 210px minmax(0, 1fr) 290px;
  }
}

@media (max-width: 1240px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { NButton, NTag } from "naive-ui";
import Chart from "../../Chart.vue";
import {
  A2UI_COMPONENT_LABELS,
  isA2uiActionName,
  isA2uiComponentName,
} from "../../demo/a2ui";
import type {
  A2uiAction,
  A2uiActionName,
  A2uiComponent,
  Surface,
} from "../../demo/a2ui";
import { workOrderStatusLabels } from "../../demo/workorderMeta";

const props = defineProps<{ surface: Surface }>();
const emit = defineEmits<{
  (event: "action", payload: { action: A2uiAction; componentId: string }): void;
}>();

const EVENT_KIND_LABELS: Record<string, string> = {
  telemetry: "遥测",
  alarm: "告警",
  workorder: "工单",
  document: "档案",
  inspection: "巡检",
  asset: "设备",
};

const ACTION_LABELS: Record<A2uiActionName, string> = {
  openAsset: "打开设备",
  openDocument: "查看档案",
  openWorkOrder: "查看工单",
  askAi: "问 AI",
  saveDashboard: "保存看板",
};

const numberFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function layoutPosition(component: A2uiComponent): { x: number; y: number } {
  const raw = isRecord(component.props?.layout) ? component.props.layout : {};
  return {
    x: typeof raw.x === "number" ? raw.x : 0,
    y: typeof raw.y === "number" ? raw.y : 0,
  };
}

const visibleComponents = computed<A2uiComponent[]>(() => {
  const childIds = new Set<string>();
  for (const component of props.surface.components) {
    for (const child of component.children ?? []) childIds.add(child);
  }
  return props.surface.components
    .filter((component) => !childIds.has(component.id))
    .slice()
    .sort((a, b) => {
      const left = layoutPosition(a);
      const right = layoutPosition(b);
      return left.y - right.y || left.x - right.x;
    });
});

function componentLabel(name: string): string {
  return isA2uiComponentName(name) ? A2UI_COMPONENT_LABELS[name] : name;
}

function cardStyle(component: A2uiComponent): Record<string, string> {
  const raw = isRecord(component.props?.layout) ? component.props.layout : {};
  const span = typeof raw.w === "number" ? Math.min(12, Math.max(1, Math.round(raw.w))) : 12;
  return { gridColumn: `span ${span}` };
}

function formatValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return numberFormat.format(value);
  if (typeof value === "string" && value.trim()) return value;
  return "缺数";
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

interface ChartData {
  labels: string[];
  series: { name: string; values: (number | null)[]; unit: string }[];
  chartType: "line" | "bar";
  height: number;
}

function chartData(component: A2uiComponent): ChartData {
  const raw = component.props ?? {};
  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  const series = rawSeries.filter(isRecord).map((item) => ({
    name: optionalString(item.name) || "未命名系列",
    values: Array.isArray(item.values)
      ? item.values.map((value) =>
          typeof value === "number" && Number.isFinite(value) ? value : null,
        )
      : [],
    unit: optionalString(item.unit),
  }));
  return {
    labels: stringArray(raw.labels),
    series,
    chartType: raw.chartType === "bar" ? "bar" : "line",
    height: typeof raw.height === "number" && Number.isFinite(raw.height) ? raw.height : 280,
  };
}

interface MetricData {
  label: string;
  value: string;
  unit: string;
  hint: string;
}

function metricData(component: A2uiComponent): MetricData {
  const raw = component.props ?? {};
  return {
    label: optionalString(raw.label) || "未命名指标",
    value: formatValue(raw.value),
    unit: optionalString(raw.unit),
    hint: optionalString(raw.hint),
  };
}

interface TableData {
  columns: { key: string; title: string }[];
  rows: Record<string, string | number | null>[];
}

function tableData(component: A2uiComponent): TableData {
  const raw = component.props ?? {};
  const columns = (Array.isArray(raw.columns) ? raw.columns : [])
    .filter(isRecord)
    .map((column) => ({
      key: optionalString(column.key),
      title: optionalString(column.title),
    }))
    .filter((column) => column.key.length > 0);
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .filter(isRecord)
    .map((row) => {
      const normalized: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[key] =
          typeof value === "string" || typeof value === "number" ? value : null;
      }
      return normalized;
    });
  return { columns, rows };
}

function fieldsOf(value: unknown): { label: string; value: string | number | null }[] {
  return (Array.isArray(value) ? value : []).filter(isRecord).map((item) => ({
    label: optionalString(item.label),
    value:
      typeof item.value === "string" || typeof item.value === "number"
        ? item.value
        : null,
  }));
}

function assetData(component: A2uiComponent): {
  title: string;
  assetId: string;
  fields: { label: string; value: string | number | null }[];
} {
  const raw = component.props ?? {};
  return {
    title: optionalString(raw.title) || "设备信息",
    assetId: optionalString(raw.assetId),
    fields: fieldsOf(raw.fields),
  };
}

interface HealthFactorView {
  label: string;
  value: number | null;
  unit: string;
  note: string;
}

function healthData(component: A2uiComponent): {
  title: string;
  score: number | null;
  band: string;
  factors: HealthFactorView[];
} {
  const raw = component.props ?? {};
  const factors = (Array.isArray(raw.factors) ? raw.factors : [])
    .filter(isRecord)
    .map((item) => ({
      label: optionalString(item.label),
      value: typeof item.value === "number" ? item.value : null,
      unit: optionalString(item.unit),
      note: optionalString(item.note),
    }));
  return {
    title: optionalString(raw.title) || "健康因子",
    score: typeof raw.score === "number" ? raw.score : null,
    band: optionalString(raw.band),
    factors,
  };
}

interface EvidenceView {
  kind: string;
  refId: string;
  label: string;
  detail: string;
  source: string;
}

function evidenceData(component: A2uiComponent): {
  title: string;
  items: EvidenceView[];
} {
  const raw = component.props ?? {};
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter(isRecord)
    .map((item) => ({
      kind: optionalString(item.kind),
      refId: optionalString(item.refId),
      label: optionalString(item.label),
      detail: optionalString(item.detail),
      source: optionalString(item.source),
    }));
  return { title: optionalString(raw.title) || "证据清单", items };
}

function workOrderData(component: A2uiComponent): {
  title: string;
  workOrderId: string;
  status: string;
  rows: { label: string; value: string | number | null }[];
} {
  const raw = component.props ?? {};
  const status = optionalString(raw.status);
  return {
    title: optionalString(raw.title) || "工单复核",
    workOrderId: optionalString(raw.workOrderId),
    status:
      status in workOrderStatusLabels
        ? workOrderStatusLabels[status as keyof typeof workOrderStatusLabels]
        : status,
    rows: fieldsOf(raw.rows),
  };
}

interface PointView {
  id: string;
  label: string;
  unit: string;
  selected: boolean;
}

function pointData(component: A2uiComponent): {
  title: string;
  assetId: string;
  points: PointView[];
} {
  const raw = component.props ?? {};
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .filter(isRecord)
    .map((item) => ({
      id: optionalString(item.id),
      label: optionalString(item.label),
      unit: optionalString(item.unit),
      selected: item.selected === true,
    }));
  return {
    title: optionalString(raw.title) || "测点选择",
    assetId: optionalString(raw.assetId),
    points,
  };
}

function emptyData(component: A2uiComponent): {
  title: string;
  description: string;
  reason: string;
} {
  const raw = component.props ?? {};
  return {
    title: optionalString(raw.title) || "空状态",
    description: optionalString(raw.description),
    reason: optionalString(raw.reason),
  };
}

function actionOf(component: A2uiComponent): A2uiAction | null {
  const raw = component.props?.action;
  if (!isRecord(raw) || !isA2uiActionName(raw.kind)) return null;
  const payload: Record<string, string> = {};
  if (isRecord(raw.payload)) {
    for (const [key, value] of Object.entries(raw.payload)) {
      if (typeof value === "string") payload[key] = value;
    }
  }
  return {
    kind: raw.kind,
    label: typeof raw.label === "string" ? raw.label : undefined,
    payload,
  };
}

function actionLabel(component: A2uiComponent): string {
  const action = actionOf(component);
  if (!action) return "";
  return action.label?.trim() || ACTION_LABELS[action.kind];
}

function emitAction(component: A2uiComponent): void {
  const action = actionOf(component);
  if (!action) return;
  emit("action", { action, componentId: component.id });
}
</script>

<template>
  <div class="a2ui-surface">
    <article
      v-for="component in visibleComponents"
      :key="component.id"
      class="a2ui-card"
      :style="cardStyle(component)"
    >
      <header class="card-head">
        <span class="card-type">{{ componentLabel(component.component) }}</span>
        <span class="card-id">{{ component.id }}</span>
      </header>

      <div v-if="!isA2uiComponentName(component.component)" class="rejected">
        <strong>被拒绝的组件：{{ component.component }}</strong>
        <p>仅允许白名单组件渲染，未执行任何模板、脚本或 HTML。</p>
      </div>

      <div v-else-if="component.component === 'MetricCard'" class="metric">
        <span class="metric-label">{{ metricData(component).label }}</span>
        <div class="metric-value">
          {{ metricData(component).value }}
          <small v-if="metricData(component).unit">{{ metricData(component).unit }}</small>
        </div>
        <p v-if="metricData(component).hint" class="muted">
          {{ metricData(component).hint }}
        </p>
      </div>

      <div
        v-else-if="component.component === 'TrendChart' || component.component === 'CompareChart'"
        class="chart-wrap"
      >
        <h4 v-if="component.props?.title" class="card-title">
          {{ component.props.title }}
        </h4>
        <Chart
          v-if="chartData(component).series.length"
          :labels="chartData(component).labels"
          :series="chartData(component).series"
          :type="chartData(component).chartType"
          :height="chartData(component).height"
        />
        <p v-else class="empty">缺少系列数据，不绘制空曲线。</p>
        <p v-if="component.component === 'CompareChart'" class="muted">
          平均值辅助线仅作为对比参考，不改变原始南北储量。
        </p>
      </div>

      <div v-else-if="component.component === 'DataTable'" class="table-wrap">
        <h4 v-if="component.props?.title" class="card-title">
          {{ component.props.title }}
        </h4>
        <table v-if="tableData(component).rows.length" class="data-table">
          <thead>
            <tr>
              <th v-for="column in tableData(component).columns" :key="column.key">
                {{ column.title }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in tableData(component).rows" :key="index">
              <td v-for="column in tableData(component).columns" :key="column.key"
                :class="{ 'low-score': column.key === 'score' && typeof row.score === 'number' &&
                  typeof component.props?.scoreWarningBelow === 'number' && row.score < component.props.scoreWarningBelow }">
                {{ row[column.key] ?? "缺数" }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">表格暂无数据。</p>
      </div>

      <div v-else-if="component.component === 'AssetInfo'" class="info-block">
        <h4 class="card-title">{{ assetData(component).title }}</h4>
        <p class="muted">assetId：{{ assetData(component).assetId }}</p>
        <dl class="field-list">
          <div v-for="field in assetData(component).fields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd>{{ formatValue(field.value) }}</dd>
          </div>
        </dl>
      </div>

      <div v-else-if="component.component === 'HealthFactorCard'" class="info-block">
        <h4 class="card-title">{{ healthData(component).title }}</h4>
        <div class="health-score">
          <strong>{{ healthData(component).score ?? "缺数" }}</strong>
          <NTag v-if="healthData(component).band" size="tiny" :bordered="false">
            {{ healthData(component).band }}
          </NTag>
        </div>
        <dl class="field-list">
          <div v-for="factor in healthData(component).factors" :key="factor.label">
            <dt>{{ factor.label }}</dt>
            <dd>
              {{ factor.value ?? "缺数" }}{{ factor.unit }}
              <span v-if="factor.note" class="muted"> · {{ factor.note }}</span>
            </dd>
          </div>
        </dl>
      </div>

      <div v-else-if="component.component === 'EvidenceList'" class="info-block">
        <h4 class="card-title">{{ evidenceData(component).title }}</h4>
        <ul v-if="evidenceData(component).items.length" class="evidence-list">
          <li v-for="item in evidenceData(component).items" :key="item.refId">
            <strong>{{ item.label }}</strong>
            <span>
              {{ EVENT_KIND_LABELS[item.kind] ?? item.kind }} · {{ item.refId }} ·
              {{ item.source }}
            </span>
            <small v-if="item.detail">{{ item.detail }}</small>
          </li>
        </ul>
        <p v-else class="empty">暂无可引用证据。</p>
      </div>

      <div v-else-if="component.component === 'WorkOrderReview'" class="info-block">
        <h4 class="card-title">{{ workOrderData(component).title }}</h4>
        <p class="muted">
          工单 {{ workOrderData(component).workOrderId || "缺数" }}
          <template v-if="workOrderData(component).status">
            · 状态 {{ workOrderData(component).status }}
          </template>
        </p>
        <dl class="field-list">
          <div v-for="row in workOrderData(component).rows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ formatValue(row.value) }}</dd>
          </div>
        </dl>
      </div>

      <div v-else-if="component.component === 'ProcessPointPicker'" class="info-block">
        <h4 class="card-title">{{ pointData(component).title }}</h4>
        <p class="muted">assetId：{{ pointData(component).assetId }}</p>
        <ul v-if="pointData(component).points.length" class="point-list">
          <li
            v-for="point in pointData(component).points"
            :key="point.id"
            :class="{ selected: point.selected }"
          >
            <span>{{ point.label }}</span>
            <small>{{ point.unit || "无量纲" }} · {{ point.id }}</small>
          </li>
        </ul>
        <p v-else class="empty">该设备暂无测点。</p>
      </div>

      <div v-else class="empty-state">
        <strong>{{ emptyData(component).title }}</strong>
        <p v-if="emptyData(component).description">
          {{ emptyData(component).description }}
        </p>
        <small v-if="emptyData(component).reason">{{ emptyData(component).reason }}</small>
      </div>

      <footer v-if="actionOf(component)" class="card-actions">
        <NButton size="tiny" secondary @click="emitAction(component)">
          {{ actionLabel(component) }}
        </NButton>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.low-score { color: #a52424; font-weight: 700; }
.a2ui-surface {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;
}

.a2ui-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 18px rgba(36, 123, 168, 0.05);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-type {
  font-size: 11px;
  font-weight: 600;
  color: #1c6a99;
  letter-spacing: 0.02em;
}

.card-id {
  font-size: 10px;
  color: #9aacbb;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.card-title {
  margin: 0;
  font-size: 14px;
  color: #1c3e57;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label {
  font-size: 11.5px;
  color: #6a8298;
}

.metric-value {
  font-size: 26px;
  font-weight: 600;
  color: #1c3e57;
  white-space: nowrap;
}

.metric-value small {
  margin-left: 4px;
  font-size: 11px;
  font-weight: 400;
  color: #6a8298;
}

.chart-wrap {
  min-width: 0;
}

.info-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-list {
  margin: 0;
  border-top: 1px solid #e8f0f6;
}

.field-list > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #eef4f8;
}

.field-list dt {
  font-size: 11px;
  color: #8296a8;
}

.field-list dd {
  margin: 0;
  font-size: 11.5px;
  color: #2a4660;
  line-height: 1.6;
}

.health-score {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.health-score strong {
  font-size: 24px;
  color: #1c3e57;
}

.evidence-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.evidence-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f5fafd;
  border: 1px solid #e3eff6;
}

.evidence-list strong {
  font-size: 12px;
  color: #1c3e57;
}

.evidence-list span,
.evidence-list small {
  font-size: 10.5px;
  color: #7c91a4;
}

.point-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.point-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #e3eff6;
  background: #f8fcff;
}

.point-list li.selected {
  border-color: #247ba8;
  background: #e8f4fb;
}

.point-list span {
  font-size: 12px;
  color: #2a4660;
}

.point-list small {
  font-size: 10px;
  color: #8296a8;
}

.table-wrap {
  min-width: 0;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}

.data-table th {
  text-align: left;
  padding: 7px 8px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
  white-space: nowrap;
}

.data-table td {
  padding: 7px 8px;
  border-bottom: 1px solid #e6eef4;
  color: #2a4660;
  white-space: nowrap;
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  border-radius: 8px;
  border: 1px dashed #cfe1ec;
  background: #f8fcff;
}

.empty-state strong {
  font-size: 13px;
  color: #1c3e57;
}

.empty-state p,
.empty-state small {
  margin: 0;
  font-size: 11px;
  color: #7c91a4;
  line-height: 1.6;
}

.rejected {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #f0c2be;
  background: #fff5f4;
}

.rejected strong {
  font-size: 12.5px;
  color: #b0443c;
}

.rejected p {
  margin: 4px 0 0;
  font-size: 11px;
  color: #9a6b66;
  line-height: 1.6;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
}

.muted {
  margin: 0;
  font-size: 10.5px;
  color: #8296a8;
  line-height: 1.6;
}

.empty {
  margin: 8px 0 0;
  font-size: 11px;
  color: #8296a8;
}

@media (max-width: 1400px) {
  .a2ui-card {
    grid-column: span 12 !important;
  }
}
</style>

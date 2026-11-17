<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { NButton, NSelect, NTabPane, NTabs, NTag, useMessage } from "naive-ui";
import Chart from "../Chart.vue";
import ProcessCanvas from "../components/ProcessCanvas.vue";
import { can } from "../demo/permissions";
import { getProcessLayout } from "../demo/processLayouts";
import type { MetricContext, MetricValue } from "../demo/processLayouts";
import { useDemoStore } from "../demo/store";
import { engineeringEntry } from "../demo/engineering";
import { useUiStore } from "../demo/ui";
import type { AssetStatus, DataSource } from "../demo/types";

const route = useRoute();
const message = useMessage();
const store = useDemoStore();
const ui = useUiStore();

const SOURCE_LABELS: Record<DataSource, string> = {
  MOCK: "模拟数据",
  REFERENCE: "资料引用",
  USER_ENTRY: "人工录入",
  CALCULATED: "规则计算",
};
const STATUS_LABELS: Record<AssetStatus, string> = {
  running: "运行",
  stopped: "停机",
  fault: "故障",
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

const tab = ref("overview");
const range = ref("24h");
const trendAssetId = ref("");
const trendPointId = ref("");
const pickMode = ref(false);
const pickedPoint = ref<{ xPct: number; yPct: number } | null>(null);

const subsystemId = computed(() => String(route.params.subsystemId ?? ""));
const subsystem = computed(() =>
  store.subsystems.find((item) => item.id === subsystemId.value),
);
const layout = computed(() => getProcessLayout(subsystemId.value));
const valid = computed(() => Boolean(subsystem.value && layout.value));

const assets = computed(() =>
  store.assets.filter(
    (asset) => asset.subsystemId === subsystemId.value && !asset.archived,
  ),
);
const alarms = computed(() =>
  store.alarms.filter((alarm) => alarm.subsystemId === subsystemId.value),
);
const activeAlarms = computed(() =>
  alarms.value.filter((alarm) => alarm.status === "active"),
);
// A focus cue tied to existing records, only in the pump-fault MOCK scene.
const focusedFaultAsset = computed(() =>
 subsystemId.value==="medium-pressure"&&store.scenarioId==="SCN-PUMP-FAULT"
  ?assets.value.find(a=>a.id==="asset-p002"):undefined);
const focusedFaultAlarm = computed(() => alarms.value.find(a=>a.id==="ALM-P002-01"));
const focusedFaultOrder = computed(() => store.workorders.find(o=>o.id==="wo-2026-014"));
const sortedAlarms = computed(() =>
  [...alarms.value].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  ),
);
const workorders = computed(() => {
  const ids = new Set(assets.value.map((asset) => asset.id));
  return store.workorders
    .filter((order) => ids.has(order.assetId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
});
const pointTotal = computed(() =>
  assets.value.reduce(
    (sum, asset) => sum + store.getPoints(asset.id).length,
    0,
  ),
);
const noMeasurementCount = computed(
  () =>
    assets.value.filter(
      (asset) =>
        !store.getPoints(asset.id).some((point) => point.kind === "number"),
    ).length,
);
const counts = computed(() => ({
  running: assets.value.filter((asset) => asset.status === "running").length,
  stopped: assets.value.filter((asset) => asset.status === "stopped").length,
  fault: assets.value.filter((asset) => asset.status === "fault").length,
  unknown: assets.value.filter((asset) => asset.status === "unknown").length,
}));

const metricContext = computed<MetricContext>(() => ({
  assets: assets.value,
  alarms: activeAlarms.value,
  rainEvents: store.seed.rainEvents,
  latest: (pointId: string) => store.latest(pointId),
  pointsOf: (assetId: string) => store.getPoints(assetId),
}));
const metrics = computed(() =>
  (layout.value?.metrics ?? []).map((metric) => ({
    id: metric.id,
    label: metric.label,
    unit: metric.unit,
    formula: metric.formula,
    source: metric.source,
    value: metric.value(metricContext.value),
    hint: metric.hint?.(metricContext.value) ?? "",
  })),
);

function metricText(value: MetricValue, unit: string): string {
  if (value === null) return "缺数";
  if (typeof value === "string") return value;
  const digits =
    unit === "MPa"
      ? 2
      : unit === "%"
        ? 1
        : Math.abs(value) >= 1000
          ? 0
          : Number.isInteger(value)
            ? 0
            : 1;
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

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

const assetOptions = computed(() =>
  assets.value.map((asset) => ({
    value: asset.id,
    label: `${asset.code} · ${asset.name}`,
  })),
);
const trendAsset = computed(() =>
  assets.value.find((asset) => asset.id === trendAssetId.value),
);
const trendPoints = computed(() =>
  trendAsset.value
    ? store.getPoints(trendAsset.value.id).filter((point) => point.kind === "number")
    : [],
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
    from,
    to,
    stepMinutes: hours > 72 ? 360 : 30,
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

const engineeringIds:Record<string,string[]>={
  rainwater:["CK-004","CK-007","CK-008","PT-002"],
  mining:["CK-011","CK-012","CK-013","CK-015"],
  pool:["CK-014","CK-015","CK-016","PT-032"],
  "medium-pressure":["CK-019","CK-020","PT-025"],
  domestic:["CK-018","PT-028","REQ-029"],
};
const engineeringRefs=computed(()=>(engineeringIds[subsystemId.value]??[]).map(engineeringEntry).filter(x=>x!==undefined));
const operationalBoundary=computed(()=>{
 if(subsystemId.value==="domestic")return "外部既有处理站不等于本项目自建污水站；只有收集与外送责任可在正式资料核查后放行。";
 if(subsystemId.value==="mining")return "含矿污水处理能力、合格水质与码头面冲洗消纳必须分别核验，不得直接使用名义处理量作为回用量。";
 if(subsystemId.value==="rainwater")return "逐池V-H曲线、清污分流、合法排口与池间连通待核；动画不代表现场水路。";
 if(subsystemId.value==="pool")return "实际管网、可达终端和雨/中/自来水分源计量未核；三水源优化仅为独立MOCK情景。";
 return "供水泵站末端与射雾系统的真实连接仍待核，低压事件不等于已确认影响终端。";
});
const canAsk = computed(() => can(store.role, "ai:ask"));
const canPick = computed(() => can(store.role, "binding:write"));

watch(
  subsystemId,
  () => {
    tab.value = "overview";
    pickMode.value = false;
    pickedPoint.value = null;
    trendAssetId.value = assets.value[0]?.id ?? "";
    trendPointId.value = "";
  },
  { immediate: true },
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

watch(() => route.query, query => {
  if (["overview", "assets", "trend", "records", "ai"].includes(String(query.tab))) tab.value = String(query.tab);
  if (assets.value.some(asset => asset.id === query.assetId)) trendAssetId.value = String(query.assetId);
  if (store.getPoints(trendAssetId.value).some(point => point.id === query.pointId)) trendPointId.value = String(query.pointId);
  if (query.mode === "bind" && canPick.value && trendAssetId.value === query.assetId) pickMode.value = true;
  if (RANGE_OPTIONS.some(option => option.value === query.range)) range.value = String(query.range);
}, { immediate: true });

function openAsset(assetId: string): void {
  ui.openAsset(assetId);
}

function openAi(question = ""): void {
  ui.openAi({ subsystemId: subsystemId.value }, question);
}

function askAssetAi(question = ""): void {
  ui.openAi(
    { subsystemId: subsystemId.value, assetId: trendAsset.value?.id },
    question,
  );
}

function togglePickMode(): void {
  pickMode.value = !pickMode.value;
  if (!pickMode.value) pickedPoint.value = null;
}

function onPick(point: { xPct: number; yPct: number }): void {
  pickedPoint.value = point;
}

function savePickedBinding(): void {
  if (!canPick.value || !pickedPoint.value || !trendAsset.value || trendAsset.value.id !== route.query.assetId) return;
  try {
    store.bindAsset(trendAsset.value.id, pickedPoint.value);
    pickMode.value = false;
    pickedPoint.value = null;
    message.success("工艺图点位已保存");
  } catch (error) { message.error((error as Error).message); }
}
function alarmType(level: string): "error" | "warning" | "info" {
  if (level === "critical") return "error";
  if (level === "warning") return "warning";
  return "info";
}
</script>

<template>
  <section class="process-view">
    <section v-if="!valid" class="invalid-panel">
      <h2>未找到该工艺子系统</h2>
      <p>
        路由参数「{{ subsystemId || "空" }}」不在六个工艺范围内，请从左侧「工艺监控」重新选择。
      </p>
      <RouterLink to="/overview">返回综合总览</RouterLink>
    </section>

    <template v-else>
      <header class="status-bar">
        <div class="status-main">
          <div class="status-title">
            <h2>{{ layout!.title }}</h2>
            <NTag size="tiny" :bordered="false" type="info">
              {{ subsystem!.id }}
            </NTag>
            <NTag size="tiny" :bordered="false" type="warning">
              MOCK 模拟数据
            </NTag>
          </div>
          <p class="status-desc">
            {{ subsystem!.description }}{{ layout!.tagline }}。
          </p>
          <div class="status-facts">
            <span>
              运行设备
              <strong>{{ counts.running }}</strong>
              / {{ assets.length }} 台
            </span>
            <span>
              活动告警
              <strong :class="{ alert: activeAlarms.length > 0 }">
                {{ activeAlarms.length }}
              </strong>
              条
            </span>
            <span>数据时间 {{ formatAt(store.seed.referenceTime) }}</span>
            <span>seed {{ store.seedVersion }}</span>
          </div>
        </div>
        <div class="status-actions">
          <NButton
            type="primary"
            secondary
            :disabled="!canAsk"
            :title="canAsk ? '携带本系统上下文打开 AI 抽屉' : '当前角色无 AI 询问权限'"
            @click="openAi()"
          >
            问 AI
          </NButton>
        </div>
      </header>

      <section v-if="focusedFaultAsset" class="pump-fault-spotlight"
        aria-label="当前模拟故障工艺聚焦">
        <div class="fault-spotlight-marker">MOCK 模拟故障聚焦</div>
        <div class="fault-spotlight-body">
          <strong>{{ focusedFaultAsset.code }} · {{ focusedFaultAsset.name }}</strong>
          <span>设备状态：{{ STATUS_LABELS[focusedFaultAsset.status] }} ·
            原告警：{{ focusedFaultAlarm?ALARM_STATUS_LABELS[focusedFaultAlarm.status]:'无记录' }} ·
            原工单：{{ focusedFaultOrder?WORKORDER_STATUS_LABELS[focusedFaultOrder.status]:'无记录' }}</span>
        </div>
        <div class="fault-spotlight-links">
          <RouterLink to="/operations/asset-workspace?assetId=asset-p002&tab=events">定位设备与告警</RouterLink>
          <RouterLink to="/operations/workorders?workOrderId=wo-2026-014">查看原维修工单</RouterLink>
        </div>
      </section>

      <section class="process-engineering-link" aria-label="工程依据与现场条件">
        <div class="engineering-summary">
          <strong>工程证据 · 待核查</strong>
          <span>{{ operationalBoundary }}</span>
        </div>
        <div class="engineering-shortcuts">
          <router-link v-for="entry in engineeringRefs" :key="entry.id"
            :to="'/engineering/registry?item='+entry.id" :title="entry.title">{{ entry.id }}</router-link>
          <router-link v-if="['rainwater','mining','pool'].includes(subsystemId)" class="chain-entry"
            to="/engineering/registry?focus=basins">逐池V-H台账 ›</router-link>
          <router-link v-if="['rainwater','mining','pool'].includes(subsystemId)" class="chain-entry"
            :to="'/water/port-chain?scenario='+(subsystemId==='rainwater'?'storm':'normal')">港口业务链 ›</router-link>
          <router-link v-else-if="subsystemId==='medium-pressure'" class="chain-entry"
            to="/intelligent/correlation">异常协同 ›</router-link>
        </div>
      </section>

      <div class="metric-grid">
        <div
          v-for="metric in metrics"
          :key="metric.id"
          class="metric-card"
          :title="metric.formula"
        >
          <div class="metric-head">
            <span class="metric-label">{{ metric.label }}</span>
            <NTag
              size="tiny"
              :bordered="false"
              :type="metric.source === 'CALCULATED' ? 'info' : 'default'"
            >
              {{ SOURCE_LABELS[metric.source] }}
            </NTag>
          </div>
          <p class="metric-value" :class="{ missing: metric.value === null }">
            {{ metricText(metric.value, metric.unit) }}
            <small v-if="metric.value !== null && metric.unit">
              {{ metric.unit }}
            </small>
          </p>
          <p class="metric-hint" :class="{ missing: metric.value === null }">
            {{ metric.hint }}
          </p>
          <p class="metric-formula">{{ metric.formula }}</p>
        </div>
      </div>

      <div class="process-main">
        <section class="panel canvas-panel">
          <div class="panel-head">
            <div>
              <h3>工艺示意与设备布点</h3>
              <p>{{ layout!.flowCaption }}</p>
            </div>
            <div class="canvas-actions">
              <NTag size="small" :bordered="false">非真实管网拓扑</NTag>
              <NButton
                v-if="canPick"
                size="small"
                secondary
                :type="pickMode ? 'primary' : 'default'"
                @click="togglePickMode"
              >
                {{ pickMode ? "退出点位选择" : "点位选择" }}
              </NButton>
            </div>
          </div>

          <ProcessCanvas
            :subsystem-id="subsystemId"
            :interactive="pickMode"
            :selected="pickedPoint"
            :height="420"
            @select="openAsset"
            @pick="onPick"
          />

          <div v-if="pickMode" class="pick-panel">
            <strong>点位选择模式</strong>
            <span v-if="pickedPoint">
              已选坐标：x {{ (pickedPoint.xPct * 100).toFixed(1) }}% · y
              {{ (pickedPoint.yPct * 100).toFixed(1) }}%
            </span>
            <span v-else>请在底图上点击选择点位</span>
            <NButton v-if="route.query.mode === 'bind' && trendAsset" :disabled="!pickedPoint || !canPick" size="small" @click="savePickedBinding">确认绑定 {{ trendAsset.code }}</NButton>
            <small>
              点位用于工艺图展示。
            </small>
          </div>
        </section>

        <aside class="side-panel">
          <section class="panel side-block">
            <div class="panel-head compact">
              <h3>系统摘要</h3>
              <span class="caption">CALCULATED / MOCK</span>
            </div>
            <p class="side-desc">{{ layout!.tagline }}。</p>
            <dl class="fact-list">
              <div>
                <dt>在用设备</dt>
                <dd>{{ assets.length }} 台（运行 {{ counts.running }}）</dd>
              </div>
              <div>
                <dt>测点总数</dt>
                <dd>{{ pointTotal }} 个</dd>
              </div>
              <div>
                <dt>无数值测点设备</dt>
                <dd :class="{ warn: noMeasurementCount > 0 }">
                  {{ noMeasurementCount }} 台
                </dd>
              </div>
              <div>
                <dt>设备状态</dt>
                <dd>
                  停机 {{ counts.stopped }} · 故障 {{ counts.fault }} · 未知
                  {{ counts.unknown }}
                </dd>
              </div>
            </dl>
            <div class="chips">
              <span v-for="item in layout!.keyCategories" :key="item" class="chip">
                {{ item }}
              </span>
            </div>
          </section>

          <section class="panel side-block">
            <div class="panel-head compact">
              <h3>设备状态列表</h3>
              <span class="caption">{{ assets.length }} 台</span>
            </div>
            <ul v-if="assets.length" class="asset-status-list">
              <li v-for="asset in assets" :key="asset.id">
                <button type="button" class="asset-status-item" :class="{'fault-row':asset.status==='fault'}" @click="openAsset(asset.id)">
                  <span class="status-dot" :class="asset.status"></span>
                  <span class="asset-status-main">
                    <strong>{{ asset.name }}</strong>
                    <small>{{ asset.code }} · {{ asset.type }}</small>
                  </span>
                  <span class="asset-status-label">{{ STATUS_LABELS[asset.status] }}</span>
                </button>
              </li>
            </ul>
            <p v-else class="empty">本系统暂无在用设备，设备台账可能尚未录入。</p>
          </section>

          <section class="panel side-block">
            <div class="panel-head compact">
              <h3>异常事件</h3>
              <RouterLink to="/operations/alarms" class="caption-link">
                告警页 →
              </RouterLink>
            </div>
            <ul v-if="activeAlarms.length" class="event-list">
              <li v-for="alarm in activeAlarms.slice(0, 4)" :key="alarm.id">
                <span class="event-dot" :class="alarm.level"></span>
                <div class="event-main">
                  <strong>{{ alarm.title }}</strong>
                  <small>{{ formatAt(alarm.occurredAt) }} · {{ ALARM_LEVEL_LABELS[alarm.level] }}</small>
                </div>
              </li>
            </ul>
            <p v-else class="empty">暂无活动告警；缺数不等于设备正常。</p>
            <div v-if="workorders.length" class="event-orders">
              <RouterLink
                v-for="order in workorders.slice(0, 3)"
                :key="order.id"
                :to="`/operations/workorders`"
                class="order-line"
              >
                <span>{{ order.code }}</span>
                <span class="order-title">{{ order.title }}</span>
                <small>{{ WORKORDER_STATUS_LABELS[order.status] ?? order.status }}</small>
              </RouterLink>
            </div>
            <p v-else class="empty">本系统暂无工单记录。</p>
          </section>
        </aside>
      </div>

      <section class="panel tabs-panel">
        <NTabs v-model:value="tab" type="line" animated>
          <NTabPane name="overview" tab="概览">
            <div class="overview-grid">
              <div class="mini-panel">
                <h4>工艺说明</h4>
                <p>{{ layout!.flowCaption }}</p>
                <p class="hint">
                  底图热点坐标为 0~1 归一化值，来自本系统工艺绑定；全部数值为本地 Mock，
                  不请求后端，刷新不改变历史。
                </p>
              </div>
              <div class="mini-panel">
                <h4>指标口径</h4>
                <ul class="formula-list">
                  <li v-for="metric in metrics" :key="metric.id">
                    <strong>{{ metric.label }}</strong>
                    <span>{{ metric.formula }}</span>
                  </li>
                </ul>
              </div>
              <div class="mini-panel">
                <h4>布点覆盖</h4>
                <ul class="formula-list">
                  <li>
                    <strong>已布置热点</strong>
                    <span>{{ store.bindings.filter((item) => item.subsystemId === subsystemId).length }} 个</span>
                  </li>
                  <li>
                    <strong>未布置设备</strong>
                    <span>{{ assets.length - store.bindings.filter((item) => assets.some((asset) => asset.id === item.assetId)).length }} 台</span>
                  </li>
                  <li>
                    <strong>无监测设备</strong>
                    <span>{{ noMeasurementCount }} 台</span>
                  </li>
                </ul>
                <p class="hint">未布置设备仍可在设备台账与搜索中命中，工艺图不显示热点。</p>
              </div>
              <div class="mini-panel">
                <h4>最近事件</h4>
                <ul v-if="sortedAlarms.length" class="event-list">
                  <li v-for="alarm in sortedAlarms.slice(0, 3)" :key="alarm.id">
                    <span class="event-dot" :class="alarm.level"></span>
                    <div class="event-main">
                      <strong>{{ alarm.title }}</strong>
                      <small>{{ formatAt(alarm.occurredAt) }} · {{ ALARM_STATUS_LABELS[alarm.status] }}</small>
                    </div>
                  </li>
                </ul>
                <p v-else class="empty">本系统暂无告警记录。</p>
                <div v-if="workorders.length" class="event-orders">
                  <RouterLink
                    v-for="order in workorders.slice(0, 2)"
                    :key="order.id"
                    to="/operations/workorders"
                    class="order-line"
                  >
                    <span>{{ order.code }}</span>
                    <span class="order-title">{{ order.title }}</span>
                    <small>{{ WORKORDER_STATUS_LABELS[order.status] ?? order.status }}</small>
                  </RouterLink>
                </div>
              </div>
            </div>
          </NTabPane>

          <NTabPane name="assets" tab="设备">
            <p class="hint">
              本系统在用设备 {{ assets.length }} 台；点击任意行打开同一设备详情抽屉。
            </p>
            <div v-if="assets.length" class="table-wrap">
              <table class="asset-table">
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>名称</th>
                    <th>状态</th>
                    <th>类型</th>
                    <th>负责人</th>
                    <th>测点数</th>
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
                    <td>
                      <span class="status-pill" :class="asset.status">
                        {{ STATUS_LABELS[asset.status] }}
                      </span>
                    </td>
                    <td>{{ asset.type }}</td>
                    <td>{{ asset.owner ?? "未提供" }}</td>
                    <td>{{ store.getPoints(asset.id).length }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="empty">本系统暂无在用设备。</p>
          </NTabPane>

          <NTabPane name="trend" tab="趋势">
            <div class="trend-controls">
              <NSelect
                v-model:value="trendAssetId"
                size="small"
                style="width: 210px"
                :options="assetOptions"
                placeholder="选择设备"
              />
              <NSelect
                v-model:value="trendPointId"
                size="small"
                style="width: 190px"
                :options="pointOptions"
                :disabled="!pointOptions.length"
                placeholder="选择测点"
              />
              <NSelect
                v-model:value="range"
                size="small"
                style="width: 150px"
                :options="RANGE_OPTIONS"
              />
            </div>

            <template v-if="trendData">
              <div class="trend-head">
                <strong>
                  {{ trendAsset?.name }} · {{ trendData.point.label }}
                  <template v-if="trendData.point.unit">
                    （{{ trendData.point.unit }}）
                  </template>
                </strong>
                <NTag size="tiny" :bordered="false" type="warning">MOCK 模拟数据</NTag>
              </div>
              <Chart
                :labels="trendData.labels"
                :series="trendSeries"
                :type="route.query.chartType === 'bar' ? 'bar' : 'line'"
                :height="280"
              />
              <p class="hint">
                来源：{{ SOURCE_LABELS[trendData.point.source] }} · 采样间隔
                {{ trendData.stepMinutes }} 分钟 · 参考时刻
                {{ formatAt(store.seed.referenceTime) }} · 有效样本
                {{ trendData.validCount }}/{{ trendData.total }} · 缺失样本不插值
              </p>
              <p v-if="trendData.validCount === 0" class="empty">
                该测点在所选区间内无有效样本，按缺数处理，不生成虚构曲线。
              </p>
            </template>
            <p v-else class="empty">
              该设备暂无可用数值测点，无法生成趋势；缺数不等于设备正常。
            </p>
          </NTabPane>

          <NTabPane name="records" tab="告警/记录">
            <div class="records-grid">
              <div class="mini-panel">
                <div class="mini-head">
                  <h4>本系统告警</h4>
                  <RouterLink to="/operations/alarms">全部告警 →</RouterLink>
                </div>
                <div v-if="sortedAlarms.length" class="record-list">
                  <article v-for="alarm in sortedAlarms" :key="alarm.id" class="record">
                    <div class="record-head">
                      <NTag
                        size="tiny"
                        :bordered="false"
                        :type="alarmType(alarm.level)"
                      >
                        {{ ALARM_LEVEL_LABELS[alarm.level] }}
                      </NTag>
                      <strong>{{ alarm.title }}</strong>
                      <small>{{ formatAt(alarm.occurredAt) }}</small>
                    </div>
                    <p>{{ alarm.detail }}</p>
                    <div class="record-foot">
                      <span>
                        {{ alarm.kind === "production" ? "生产告警" : "业务提醒" }} ·
                        状态 {{ ALARM_STATUS_LABELS[alarm.status] }}
                      </span>
                      <NButton
                        size="tiny"
                        quaternary
                        @click="openAsset(alarm.assetId)"
                      >
                        打开设备
                      </NButton>
                    </div>
                  </article>
                </div>
                <p v-else class="empty">本系统当前没有告警记录。</p>
              </div>

              <div class="mini-panel">
                <div class="mini-head">
                  <h4>本系统工单</h4>
                  <RouterLink to="/operations/workorders">全部工单 →</RouterLink>
                </div>
                <div v-if="workorders.length" class="record-list">
                  <article v-for="order in workorders" :key="order.id" class="record">
                    <div class="record-head">
                      <NTag size="tiny" :bordered="false" type="info">
                        {{ WORKORDER_STATUS_LABELS[order.status] ?? order.status }}
                      </NTag>
                      <strong>{{ order.title }}</strong>
                      <small>{{ order.code }}</small>
                    </div>
                    <p>{{ order.symptom }}</p>
                    <div class="record-foot">
                      <span>
                        创建 {{ formatAt(order.createdAt) }} · 负责人
                        {{ order.assignee ?? "未指派" }}
                      </span>
                      <NButton
                        size="tiny"
                        quaternary
                        @click="openAsset(order.assetId)"
                      >
                        打开设备
                      </NButton>
                    </div>
                  </article>
                </div>
                <p v-else class="empty">本系统当前没有工单记录。</p>
              </div>
            </div>
          </NTabPane>

          <NTabPane name="ai" tab="AI 分析">
            <div class="ai-grid">
              <div class="mini-panel">
                <h4>当前上下文</h4>
                <dl class="fact-list">
                  <div>
                    <dt>子系统</dt>
                    <dd>{{ subsystem!.name }}（{{ subsystem!.id }}）</dd>
                  </div>
                  <div>
                    <dt>当前设备</dt>
                    <dd>
                      {{ trendAsset ? `${trendAsset.name} · ${trendAsset.code}` : "未选择设备" }}
                    </dd>
                  </div>
                  <div>
                    <dt>数据标签</dt>
                    <dd>MOCK · 参考时刻 {{ formatAt(store.seed.referenceTime) }}</dd>
                  </div>
                </dl>
                <p class="hint">
                  本地演示未接入真实大模型：本页只负责携带上下文与预设问题，
                  不预置或伪造分析结论。
                </p>
              </div>

              <div class="mini-panel">
                <h4>支持指令示例</h4>
                <div class="ai-questions">
                  <button
                    v-for="question in layout!.aiQuestions"
                    :key="question"
                    type="button"
                    class="ai-question"
                    :disabled="!canAsk"
                    @click="askAssetAi(question)"
                  >
                    {{ question }}
                  </button>
                </div>
                <ul class="ai-capability">
                  <li>查询本系统设备状态与活动告警（只读统计）</li>
                  <li>生成最近 24 小时 / 7 天关键测点趋势</li>
                  <li>新增设备并在工艺图选择点位（后续任务接入）</li>
                </ul>
                <NButton
                  type="primary"
                  secondary
                  :disabled="!canAsk"
                  @click="askAssetAi()"
                >
                  带当前设备问 AI
                </NButton>
              </div>
            </div>
          </NTabPane>
        </NTabs>
      </section>
    </template>
  </section>
</template>

<style scoped>
.pump-fault-spotlight{display:flex;gap:13px;align-items:center;flex-wrap:wrap;
 padding:10px 13px;border:1px solid #ecd0a8;border-left:3px solid #d99649;
 background:linear-gradient(100deg,#fff6ea,#fcfdff 65%);border-radius:9px}
.fault-spotlight-marker{flex:none;font-size:10px;font-weight:800;
 color:#966128;background:#fff0d8;border:1px solid #f1d4a9;
 border-radius:5px;padding:6px 8px}
.fault-spotlight-body{flex:1;min-width:170px;display:grid;gap:4px}
.fault-spotlight-body strong{font-size:13px;color:#6a543f}
.fault-spotlight-body span{font-size:11px;color:#927961;line-height:1.5}
.fault-spotlight-links{display:flex;gap:7px;flex-wrap:wrap}
.fault-spotlight-links a{border:1px solid #e6c799;border-radius:6px;background:#fff;
 color:#8d6136;font-size:11px;padding:7px 9px;text-decoration:none}
.fault-spotlight-links a:hover{background:#fff1dc}
.asset-status-item.fault-row{border-left:3px solid #d59c56;background:#fff9f1}
@media(max-width:720px){.pump-fault-spotlight{gap:8px}
 .fault-spotlight-links{width:100%}.fault-spotlight-links a{flex:1;text-align:center}}

.process-engineering-link{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #e4d8be;background:linear-gradient(100deg,#fffcf5,#f7fbfd);padding:10px 13px;border-radius:9px}
.engineering-summary{display:grid;gap:5px;min-width:230px;flex:1}.engineering-summary strong{font-size:11px;color:#9c7748}.engineering-summary span{font-size:11px;color:#8b9ba8;line-height:1.7}
.engineering-shortcuts{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
.engineering-shortcuts a{font-size:11px;color:#3180a4;background:#fff;border:1px solid #d4e7f0;border-radius:5px;padding:6px 8px;text-decoration:none}
.engineering-shortcuts a.chain-entry{color:#167ca0;background:#e7f7fb;border-color:#a7d8e9}

.process-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.invalid-panel {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 28px;
}
.invalid-panel h2 {
  margin: 0 0 10px;
  font-size: 19px;
  color: #1c3e57;
}
.invalid-panel p {
  margin: 0 0 12px;
  font-size: 13px;
  color: #5d7387;
}
.status-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid rgba(160, 198, 220, 0.6);
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.95), rgba(235, 246, 252, 0.9));
  box-shadow: 0 8px 20px rgba(36, 123, 168, 0.06);
  min-width: 0;
}
.status-main {
  min-width: 0;
}
.status-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.status-title h2 {
  margin: 0;
  font-size: 20px;
  color: #17364d;
}
.status-desc {
  margin: 8px 0 10px;
  font-size: 12px;
  color: #5d7387;
  line-height: 1.7;
}
.status-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: #6c8296;
}
.status-facts strong {
  color: #1c3e57;
  font-size: 14px;
}
.status-facts strong.alert {
  color: #c0503f;
}
.status-actions {
  flex-shrink: 0;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.metric-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 11px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.96), rgba(240, 248, 252, 0.9));
  box-shadow: 0 8px 18px rgba(36, 123, 168, 0.05);
  min-width: 0;
}
.metric-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.metric-label {
  font-size: 12px;
  color: #6a8298;
}
.metric-value {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  color: #1c3e57;
  letter-spacing: 0.4px;
  white-space: nowrap;
}
.metric-value.missing {
  color: #9aacbc;
  font-size: 20px;
}
.metric-value small {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: #7c93a5;
}
.metric-hint {
  margin: 0;
  font-size: 11px;
  color: #6c8296;
  line-height: 1.6;
}
.metric-hint.missing {
  color: #a06a1f;
}
.metric-formula {
  margin: 0;
  padding-top: 6px;
  border-top: 1px dashed #e2edf4;
  font-size: 10px;
  line-height: 1.5;
  color: #98aab9;
}
.process-main {
  display: grid;
  grid-template-columns: minmax(0, 68fr) minmax(0, 32fr);
  gap: 16px;
  align-items: start;
}
.panel {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 18px;
  min-width: 0;
  box-shadow: 0 10px 22px rgba(36, 123, 168, 0.05);
}
.canvas-panel {
  min-width: 0;
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel-head.compact {
  align-items: center;
  margin-bottom: 8px;
}
.panel-head h3 {
  margin: 0;
  font-size: 15px;
  color: #1c3e57;
}
.panel-head p {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: #748a9d;
  line-height: 1.6;
}
.canvas-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.caption {
  font-size: 11px;
  color: #8ba0b2;
  white-space: nowrap;
}
.caption-link {
  font-size: 11px;
  color: #247ba8;
  white-space: nowrap;
}
.pick-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px dashed #9cc6c0;
  background: #f1faf7;
  font-size: 12px;
  color: #3d6f66;
}
.pick-panel small {
  flex-basis: 100%;
  font-size: 11px;
  color: #6f918a;
}
.side-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.side-block {
  padding: 14px 16px;
}
.side-desc {
  margin: 0 0 8px;
  font-size: 11.5px;
  color: #5d7387;
  line-height: 1.7;
}
.fact-list {
  margin: 0;
  border-top: 1px solid #eaf2f8;
}
.fact-list > div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid #eaf2f8;
}
.fact-list dt {
  font-size: 11px;
  color: #7c93a5;
}
.fact-list dd {
  margin: 0;
  font-size: 12px;
  color: #2a4660;
  word-break: break-word;
}
.fact-list dd.warn {
  color: #a06a1f;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  color: #3d6f8a;
  background: #eef7fc;
  border: 1px solid #dbeaf3;
}
.asset-status-list {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  max-height: 236px;
  overflow-y: auto;
}
.asset-status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 4px;
  border: 0;
  border-bottom: 1px solid #f0f6fa;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.asset-status-item:hover {
  background: #f2f9fd;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #9aa8b4;
}
.status-dot.running {
  background: #3f9d7c;
}
.status-dot.stopped {
  background: #9aa8b4;
}
.status-dot.fault {
  background: #d0574f;
}
.status-dot.unknown {
  background: #e1a249;
}
.asset-status-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.asset-status-main strong {
  font-size: 12px;
  color: #2a4660;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-status-main small {
  font-size: 10px;
  color: #93a7b7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-status-label {
  font-size: 10.5px;
  color: #7c93a5;
  flex-shrink: 0;
}
.event-list {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.event-list li {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f6fa;
}
.event-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
  background: #e1a249;
}
.event-dot.critical {
  background: #d0574f;
}
.event-dot.warning {
  background: #e1a249;
}
.event-dot.info {
  background: #247ba8;
}
.event-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.event-main strong {
  font-size: 11.5px;
  font-weight: 500;
  color: #2a4660;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.event-main small {
  font-size: 10px;
  color: #93a7b7;
}
.event-orders {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e2edf4;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.order-line {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: #4a6a83;
}
.order-line:hover .order-title {
  color: #247ba8;
}
.order-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-line small {
  color: #93a7b7;
  font-size: 10px;
  flex-shrink: 0;
}
.tabs-panel {
  padding: 14px 18px 18px;
}
.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.mini-panel {
  border: 1px solid #e2edf4;
  border-radius: 9px;
  padding: 14px;
  background: #fbfdff;
  min-width: 0;
}
.mini-panel h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #1c3e57;
}
.mini-panel p {
  margin: 0;
  font-size: 11.5px;
  color: #5d7387;
  line-height: 1.8;
}
.mini-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.mini-head h4 {
  margin: 0;
}
.mini-head a {
  font-size: 11px;
}
.formula-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.formula-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
  border-bottom: 1px solid #eef5fa;
  font-size: 11px;
}
.formula-list li:last-child {
  border-bottom: 0;
}
.formula-list strong {
  color: #2a4660;
  font-weight: 600;
}
.formula-list span {
  color: #7c93a5;
  line-height: 1.6;
}
.hint {
  margin: 10px 0 0;
  font-size: 11px;
  color: #8296a8;
  line-height: 1.7;
}
.empty {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: #8296a8;
  padding: 4px 0;
}
.table-wrap {
  overflow-x: auto;
}
.asset-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 560px;
}
.asset-table th {
  text-align: left;
  padding: 8px 10px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
  white-space: nowrap;
}
.asset-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #eef5fa;
  color: #2a4660;
}
.asset-table tbody tr {
  cursor: pointer;
}
.asset-table tbody tr:hover,
.asset-table tbody tr:focus-visible {
  background: #eaf5fc;
  outline: none;
}
.status-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  background: #edf2f6;
  color: #6d7f8f;
}
.status-pill.running {
  background: #e3f4ed;
  color: #2f7a63;
}
.status-pill.fault {
  background: #fbe8e6;
  color: #b0453d;
}
.status-pill.unknown {
  background: #fdf0d8;
  color: #96651f;
}
.trend-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  color: #1c3e57;
  margin-bottom: 6px;
}
.records-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}
.record-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.record {
  border: 1px solid #e6eff6;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
}
.record-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  font-size: 12px;
  color: #2a4660;
}
.record-head small {
  margin-left: auto;
  font-size: 10px;
  color: #93a7b7;
  white-space: nowrap;
}
.record p {
  margin: 6px 0;
  font-size: 11px;
  color: #5d7387;
  line-height: 1.7;
}
.record-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10.5px;
  color: #8296a8;
}
.ai-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}
.ai-questions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-question {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d8e8f2;
  border-radius: 8px;
  background: #f6fbfe;
  color: #2a4660;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.ai-question:hover:not(:disabled) {
  border-color: #7fb4cd;
  background: #eef7fc;
}
.ai-question:disabled {
  cursor: not-allowed;
  color: #9aacbc;
}
.ai-capability {
  margin: 10px 0;
  padding-left: 18px;
  font-size: 11px;
  color: #7c93a5;
  line-height: 1.9;
}
@media (max-width: 1500px) {
  .process-main {
    grid-template-columns: minmax(0, 62fr) minmax(0, 38fr);
  }
}
@media (max-width: 1180px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .process-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .overview-grid,
  .records-grid,
  .ai-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 860px) {
  .metric-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .status-bar {
    flex-direction: column;
  }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NTabPane,
  NTabs,
  NTag,
} from "naive-ui";
import Chart from "../Chart.vue";
import { can } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import type { DataSource, Quality } from "../demo/types";

const store = useDemoStore();
const ui = useUiStore();

const tab = ref("overview");
const selectedPointId = ref<string | null>(null);
const expandedDocId = ref<string | null>(null);

const asset = computed(() =>
  ui.drawerAssetId ? store.getAsset(ui.drawerAssetId) : undefined,
);
const subsystemName = computed(
  () =>
    store.subsystems.find((item) => item.id === asset.value?.subsystemId)?.name ??
    "未提供",
);
const binding = computed(() =>
  asset.value
    ? store.bindings.find((item) => item.assetId === asset.value?.id)
    : undefined,
);
const points = computed(() =>
  asset.value ? store.getPoints(asset.value.id) : [],
);
const assetAlarms = computed(() =>
  asset.value
    ? store.alarms.filter((item) => item.assetId === asset.value?.id)
    : [],
);
const inspections = computed(() =>
  asset.value
    ? store.inspections
        .filter((item) => item.assetId === asset.value?.id)
        .sort((a, b) => Date.parse(b.inspectedAt) - Date.parse(a.inspectedAt))
    : [],
);
const maintenance = computed(() =>
  asset.value
    ? store.maintenance
        .filter((item) => item.assetId === asset.value?.id)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [],
);
const timeline = computed(() =>
  asset.value ? store.timeline(asset.value.id) : [],
);
const documents = computed(() =>
  asset.value
    ? store.documents.filter((doc) => doc.assetIds.includes(asset.value!.id))
    : [],
);

const sourceLabels: Record<DataSource, string> = {
  MOCK: "模拟数据",
  REFERENCE: "资料引用",
  USER_ENTRY: "人工录入",
  CALCULATED: "规则计算",
};
const qualityLabels: Record<Quality, string> = {
  valid: "有效",
  missing: "缺失",
  estimated: "估算",
  invalid: "无效",
};
const statusLabels: Record<string, string> = {
  running: "运行",
  stopped: "停机",
  fault: "故障",
  unknown: "未知",
};
const docKindLabels: Record<string, string> = {
  manual: "使用说明",
  procedure: "操作规程",
  "inspection-standard": "巡检标准",
  drawing: "图纸",
  certificate: "证书",
  case: "案例",
  other: "其他资料",
};
const timelineLabels: Record<string, string> = {
  operation: "运行",
  alarm: "告警",
  workorder: "工单",
  inspection: "巡检",
  maintenance: "维保",
  document: "档案",
  config: "配置",
};

function text(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "未提供";
  return String(value);
}

function formatAt(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

function pointValue(pointId: string): string {
  const sample = store.latest(pointId);
  if (!sample) return "未提供";
  return typeof sample.value === "number" ? String(sample.value) : String(sample.value ?? "未提供");
}

function pointAt(pointId: string): string {
  const sample = store.latest(pointId);
  return sample ? formatAt(sample.at) : "未提供";
}

function pointQuality(pointId: string): string {
  const sample = store.latest(pointId);
  return sample ? qualityLabels[sample.quality] : "未提供";
}

function pointSource(pointId: string): string {
  const sample = store.latest(pointId);
  return sample ? sourceLabels[sample.source] : "未提供";
}

const selectedPoint = computed(
  () => points.value.find((item) => item.id === selectedPointId.value) ?? null,
);
const trend = computed(() => {
  const point = selectedPoint.value;
  if (!point || point.kind !== "number") return { labels: [] as string[], values: [] as (number | null)[] };
  const to = store.seed.referenceTime;
  const from = new Date(Date.parse(to) - 24 * 3_600_000).toISOString();
  const samples = store.series(point.id, from, to);
  return {
    labels: samples.map((sample) =>
      new Date(sample.at).toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }),
    ),
    values: samples.map((sample) =>
      typeof sample.value === "number" ? sample.value : null,
    ),
  };
});
const trendSeries = computed(() =>
  selectedPoint.value
    ? [
        {
          name: selectedPoint.value.label,
          values: trend.value.values,
          unit: selectedPoint.value.unit ?? "",
        },
      ]
    : [],
);

watch(
  () => ui.drawerAssetId,
  (id) => {
    tab.value = "overview";
    expandedDocId.value = null;
    const first = id
      ? store.getPoints(id).find((point) => point.kind === "number")
      : undefined;
    selectedPointId.value = first?.id ?? null;
  },
  { immediate: true },
);

function toggleDoc(id: string): void {
  expandedDocId.value = expandedDocId.value === id ? null : id;
}
</script>

<template>
  <NDrawer
    :show="Boolean(ui.drawerAssetId)"
    :width="520"
    placement="right"
    @update:show="(value: boolean) => !value && ui.closeAsset()"
  >
    <NDrawerContent
      :title="asset ? `${asset.name} · ${asset.code}` : '设备详情'"
      closable
    >
      <div v-if="asset" class="drawer-body">
        <RouterLink class="asset-workspace-entry" :to="{path:'/operations/asset-workspace',query:{assetId:asset.id}}" @click="ui.closeAsset()">
          进入设备统一工作台 · 监测 / 告警 / 工单 / 巡检 / 资料
        </RouterLink>
        <div class="tag-row">
          <NTag size="small" :bordered="false" type="info">
            {{ subsystemName }}
          </NTag>
          <NTag
            size="small"
            :bordered="false"
            :type="asset.status === 'fault' ? 'error' : asset.status === 'running' ? 'success' : 'default'"
          >
            {{ statusLabels[asset.status] ?? asset.status }}
          </NTag>
          <NTag size="small" :bordered="false">
            {{ sourceLabels[asset.source] }}
          </NTag>
        </div>

        <NTabs v-model:value="tab" type="line" size="small" animated>
          <NTabPane name="overview" tab="概况">
            <dl class="detail-list">
              <div><dt>设备名称</dt><dd>{{ text(asset.name) }}</dd></div>
              <div><dt>设备编号</dt><dd>{{ text(asset.code) }}</dd></div>
              <div><dt>所属工艺</dt><dd>{{ subsystemName }}</dd></div>
              <div><dt>状态</dt><dd>{{ statusLabels[asset.status] ?? asset.status }}</dd></div>
              <div><dt>数据来源</dt><dd>{{ sourceLabels[asset.source] }}</dd></div>
              <div><dt>设备类型</dt><dd>{{ text(asset.type) }}</dd></div>
              <div><dt>型号 / 厂家</dt><dd>{{ text(asset.model) }} / {{ text(asset.manufacturer) }}</dd></div>
              <div>
                <dt>额定参数</dt>
                <dd>
                  功率 {{ text(asset.rated?.powerKw) }} kW · 流量
                  {{ text(asset.rated?.flowM3h) }} m³/h · 扬程
                  {{ text(asset.rated?.headM) }} m
                </dd>
              </div>
              <div><dt>负责人</dt><dd>{{ text(asset.owner) }}</dd></div>
              <div>
                <dt>安装位置</dt>
                <dd>
                  {{ asset.area === "north" ? "北区" : "南区" }} ·
                  {{
                    binding
                      ? `工艺点位 ${(binding.xPct * 100).toFixed(0)}% / ${(binding.yPct * 100).toFixed(0)}%`
                      : "未布置"
                  }}
                </dd>
              </div>
              <div><dt>工艺节点</dt><dd>{{ text(asset.processNodeId) }}</dd></div>
              <div><dt>备注</dt><dd>{{ text(asset.condition) }}</dd></div>
            </dl>
          </NTabPane>

          <NTabPane name="monitoring" tab="监测">
            <p class="hint">以下数值为 Mock 模拟数据，按固定种子生成；刷新页面不改变历史。</p>
            <table v-if="points.length" class="point-table">
              <thead>
                <tr>
                  <th>测点</th>
                  <th>最新值</th>
                  <th>单位</th>
                  <th>时间</th>
                  <th>质量</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="point in points"
                  :key="point.id"
                  :class="{ selected: point.id === selectedPointId }"
                  @click="selectedPointId = point.id"
                >
                  <td>{{ point.label }}</td>
                  <td>{{ pointValue(point.id) }}</td>
                  <td>{{ point.unit ?? "—" }}</td>
                  <td>{{ pointAt(point.id) }}</td>
                  <td>{{ pointQuality(point.id) }}</td>
                  <td>{{ pointSource(point.id) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="empty">该设备暂无测点，可在设备配置或 AI 建档中补充。</p>

            <div v-if="selectedPoint" class="trend-panel">
              <div class="trend-head">
                <strong>{{ selectedPoint.label }} · 近 24h 趋势</strong>
                <NTag size="tiny" :bordered="false" type="warning">Mock 模拟数据</NTag>
              </div>
              <Chart
                v-if="selectedPoint.kind === 'number'"
                :labels="trend.labels"
                :series="trendSeries"
                :height="220"
              />
              <p v-else class="hint">该测点为枚举量，不生成趋势曲线。</p>
            </div>
          </NTabPane>

          <NTabPane name="alarms" tab="告警与分析">
            <template v-if="assetAlarms.length">
              <div v-for="alarm in assetAlarms" :key="alarm.id" class="list-card">
                <div class="list-head">
                  <strong>{{ alarm.title }}</strong>
                  <NTag
                    size="tiny"
                    :bordered="false"
                    :type="alarm.level === 'critical' ? 'error' : alarm.level === 'warning' ? 'warning' : 'info'"
                  >
                    {{ alarm.level }}
                  </NTag>
                </div>
                <p>{{ alarm.detail }}</p>
                <small>{{ formatAt(alarm.occurredAt) }} · 状态 {{ alarm.status }}</small>
              </div>
            </template>
            <p v-else class="empty">该设备当前没有关联告警。</p>
            <div class="analysis-link">
              <RouterLink :to="`/decision/health?assetId=${asset.id}`">
                查看基础健康信息 →
              </RouterLink>
              <p class="hint">仅展示规则评分与趋势观察，不构成故障概率或剩余寿命结论。</p>
            </div>
          </NTabPane>

          <NTabPane name="inspection" tab="巡检与维保">
            <h3 class="sub-title">最近巡检</h3>
            <template v-if="inspections.length">
              <div
                v-for="record in inspections.slice(0, 3)"
                :key="record.id"
                class="list-card"
              >
                <div class="list-head">
                  <strong>{{ formatAt(record.inspectedAt) }} · {{ record.inspector }}</strong>
                  <NTag size="tiny" :bordered="false" :type="record.result === 'normal' ? 'success' : 'warning'">
                    {{ record.result === "normal" ? "正常" : "异常" }}
                  </NTag>
                </div>
                <p v-if="record.note">{{ record.note }}</p>
                <small>
                  {{ record.items.map((item) => `${item.label}：${item.value}`).join("；") }}
                </small>
              </div>
            </template>
            <p v-else class="empty">暂无巡检记录，缺失不等于设备正常。</p>

            <h3 class="sub-title">维保记录</h3>
            <div v-for="record in maintenance.slice(0, 3)" :key="record.id" class="list-card">
              <div class="list-head">
                <strong>{{ formatAt(record.at) }}</strong>
                <NTag size="tiny" :bordered="false">{{ record.kind === "repair" ? "维修" : "保养" }}</NTag>
              </div>
              <p>{{ record.summary }}</p>
              <small v-if="record.materials">材料：{{ record.materials }}</small>
            </div>
            <p v-if="!maintenance.length" class="empty">暂无维保记录，无法据此判断维护状态。</p>
          </NTabPane>

          <NTabPane name="timeline" tab="设备履历">
            <div v-if="timeline.length" class="timeline-list">
              <div v-for="event in timeline" :key="event.id" class="timeline-item">
                <div class="timeline-head">
                  <NTag size="tiny" :bordered="false">{{ timelineLabels[event.type] ?? event.type }}</NTag>
                  <small>{{ formatAt(event.at) }}</small>
                </div>
                <p>{{ event.summary }}</p>
                <small>
                  责任人：{{ event.actor ?? "未提供" }} · 来源：{{ event.dataLabel }}
                </small>
              </div>
            </div>
            <p v-else class="empty">暂无履历事件。</p>
          </NTabPane>

          <NTabPane name="documents" tab="技术档案">
            <div v-if="documents.length" class="doc-list">
              <button
                v-for="doc in documents"
                :key="doc.id"
                type="button"
                class="doc-card"
                @click="toggleDoc(doc.id)"
              >
                <div class="doc-head">
                  <strong>{{ doc.title }}</strong>
                  <span class="doc-tags">
                    <NTag size="tiny" :bordered="false">{{ doc.version }}</NTag>
                    <NTag size="tiny" :bordered="false" :type="doc.reviewed ? 'success' : 'warning'">
                      {{ doc.reviewed ? "已审核" : "未审核" }}
                    </NTag>
                  </span>
                </div>
                <small>{{ docKindLabels[doc.kind] ?? doc.kind }} · {{ doc.sourceLabel }}</small>
                <p v-if="doc.summary">{{ doc.summary }}</p>
                <div v-if="expandedDocId === doc.id" class="doc-detail">
                  <p>{{ doc.contentExcerpt ?? "该档案暂无摘录内容。" }}</p>
                  <small>章节：{{ doc.lineOrSection ?? "未提供" }} · 更新：{{ formatAt(doc.updatedAt) }}</small>
                </div>
              </button>
            </div>
            <p v-else class="empty">该设备暂无关联技术档案，建议补充说明书或巡检标准。</p>
          </NTabPane>
        </NTabs>
      </div>
      <p v-else class="empty">未选择设备。</p>

      <template #footer>
        <div v-if="asset && can(store.role, 'admin:write')" class="drawer-actions">
          <span title="请在设备配置中处理">
            <NButton disabled>编辑</NButton>
          </span>
          <span title="请在设备配置中处理">
            <NButton disabled>退役</NButton>
          </span>
          <small>设备不提供物理删除，仅在配置中退役或解除热点绑定。</small>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.asset-workspace-entry{display:block;text-decoration:none;font-size:12px;font-weight:700;color:#26779b;background:#e9f7fb;border:1px solid #a8d6e7;border-radius:7px;padding:11px 13px;margin-bottom:12px}
.asset-workspace-entry:hover{background:#daf1f9}
.drawer-body {
  min-height: 320px;
}
.tag-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.detail-list {
  margin: 0;
  border-top: 1px solid #e4eef5;
}
.detail-list > div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #e4eef5;
}
.detail-list dt {
  color: #71869a;
  font-size: 12px;
}
.detail-list dd {
  margin: 0;
  font-size: 13px;
  color: #20384e;
  word-break: break-word;
}
.hint {
  margin: 10px 0;
  font-size: 12px;
  color: #70869a;
  line-height: 1.7;
}
.point-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.point-table th {
  text-align: left;
  padding: 8px 6px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
}
.point-table td {
  padding: 8px 6px;
  border-bottom: 1px solid #e6eef4;
  color: #2a4660;
}
.point-table tbody tr {
  cursor: pointer;
}
.point-table tbody tr:hover,
.point-table tbody tr.selected {
  background: #e9f4fb;
}
.trend-panel {
  margin-top: 16px;
  border: 1px solid #e0ecf4;
  border-radius: 8px;
  padding: 12px;
  background: #fbfdff;
}
.trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}
.list-card {
  border: 1px solid #e2edf4;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fbfdff;
}
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.list-card p {
  margin: 8px 0 4px;
  font-size: 12px;
  color: #5d7387;
}
.list-card small {
  font-size: 11px;
  color: #8296a8;
  line-height: 1.7;
}
.analysis-link {
  border-top: 1px dashed #dbe8f1;
  padding-top: 12px;
}
.sub-title {
  font-size: 13px;
  margin: 14px 0 8px;
}
.timeline-list {
  border-left: 2px solid #cfe3f0;
  padding-left: 14px;
}
.timeline-item {
  position: relative;
  margin-bottom: 14px;
}
.timeline-item::before {
  content: "";
  position: absolute;
  left: -20px;
  top: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #54a892;
}
.timeline-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.timeline-item p {
  margin: 6px 0 2px;
  font-size: 12px;
  color: #3d566c;
}
.timeline-item small {
  font-size: 11px;
  color: #8296a8;
}
.doc-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.doc-card {
  width: 100%;
  text-align: left;
  border: 1px solid #e0ecf4;
  border-radius: 8px;
  background: #fbfdff;
  padding: 12px;
  cursor: pointer;
  color: inherit;
}
.doc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.doc-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.doc-card small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #8296a8;
}
.doc-card p {
  margin: 8px 0 0;
  font-size: 12px;
  color: #5d7387;
}
.doc-detail {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #dbe8f1;
}
.empty {
  font-size: 12px;
  color: #8296a8;
  padding: 14px 0;
}
.drawer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.drawer-actions small {
  color: #8296a8;
  font-size: 11px;
}
</style>

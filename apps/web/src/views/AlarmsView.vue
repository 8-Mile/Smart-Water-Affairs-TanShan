<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NInput,
  NSelect,
  NTag,
  useMessage,
} from "naive-ui";
import { can, roleNames } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import type { Alarm, WorkOrderPriority } from "../demo/types";
import {
  alarmKindLabels,
  alarmLevelLabels,
  alarmLevelTagType,
  alarmStatusLabels,
  formatDateTime,
  workOrderPriorityLabels,
  workOrderStatusLabels,
  workOrderStatusTagType,
} from "../demo/workorderMeta";
import type { TagType } from "../demo/workorderMeta";

const store = useDemoStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();
const message = useMessage();

const kindFilter = ref("all");
const levelFilter = ref("all");
const statusFilter = ref("all");
watch(() => route.query.status, status => {
  statusFilter.value = status === "active" ? status : "all";
}, { immediate: true });
const keyword = ref("");

const kindOptions = computed(() => [
  { label: `全部类型（${store.alarms.length}）`, value: "all" },
  {
    label: `生产告警（${store.alarms.filter((item) => item.kind === "production").length}）`,
    value: "production",
  },
  {
    label: `业务提醒（${store.alarms.filter((item) => item.kind === "business").length}）`,
    value: "business",
  },
]);
const levelOptions = [
  { label: "全部级别", value: "all" },
  ...Object.entries(alarmLevelLabels).map(([value, label]) => ({ value, label })),
];
const statusOptions = [
  { label: "全部状态", value: "all" },
  ...Object.entries(alarmStatusLabels).map(([value, label]) => ({ value, label })),
];
const priorityOptions = (Object.keys(workOrderPriorityLabels) as WorkOrderPriority[]).map(
  (value) => ({ value, label: workOrderPriorityLabels[value] }),
);

const activeProduction = computed(
  () =>
    store.alarms.filter((alarm) => alarm.kind === "production" && alarm.status === "active")
      .length,
);
const activeBusiness = computed(
  () =>
    store.alarms.filter((alarm) => alarm.kind === "business" && alarm.status === "active")
      .length,
);
const criticalActive = computed(
  () =>
    store.alarms.filter(
      (alarm) =>
        alarm.kind === "production" && alarm.level === "critical" && alarm.status === "active",
    ).length,
);
const linkedCount = computed(
  () => store.alarms.filter((alarm) => Boolean(alarm.workOrderId)).length,
);

function assetLabel(assetId: string): string {
  const asset = store.getAsset(assetId);
  return asset ? `${asset.code} · ${asset.name}` : `设备不可用（${assetId}）`;
}

function orderCode(id?: string): string {
  if (!id) return "";
  return store.workorders.find((order) => order.id === id)?.code ?? id;
}

const filteredAlarms = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  return store.alarms
    .filter((alarm) => kindFilter.value === "all" || alarm.kind === kindFilter.value)
    .filter((alarm) => levelFilter.value === "all" || alarm.level === levelFilter.value)
    .filter((alarm) => statusFilter.value === "all" || alarm.status === statusFilter.value)
    .filter((alarm) => {
      if (!text) return true;
      const asset = store.getAsset(alarm.assetId);
      return [alarm.title, alarm.code, alarm.detail, asset?.code ?? "", asset?.name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(text);
    })
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
});

function alarmStatusTagType(status: Alarm["status"]): TagType {
  if (status === "active") return "error";
  if (status === "acknowledged") return "info";
  return "default";
}

const selectedAlarmId = ref<string | null>(null);

watch(
  () => route.query.alarmId,
  (value) => {
    selectedAlarmId.value = typeof value === "string" && value.length > 0 ? value : null;
  },
  { immediate: true },
);

const selectedAlarm = computed(() =>
  selectedAlarmId.value
    ? store.alarms.find((alarm) => alarm.id === selectedAlarmId.value)
    : undefined,
);
const selectedAsset = computed(() =>
  selectedAlarm.value ? store.getAsset(selectedAlarm.value.assetId) : undefined,
);
const selectedPointLabel = computed(() => {
  const pointId = selectedAlarm.value?.pointId;
  if (!pointId) return "未绑定测点";
  return store.points.find((point) => point.id === pointId)?.label ?? pointId;
});
const subsystemName = computed(() => {
  const id = selectedAlarm.value?.subsystemId;
  return store.subsystems.find((item) => item.id === id)?.name ?? "未提供";
});
const linkedWorkOrder = computed(() =>
  selectedAlarm.value?.workOrderId
    ? store.workorders.find((order) => order.id === selectedAlarm.value?.workOrderId)
    : undefined,
);

const alarmTimeline = computed(() => {
  if (!selectedAlarm.value) return [];
  return store.timeline(selectedAlarm.value.assetId).slice(0, 6);
});

const timelineTypeLabels: Record<string, string> = {
  operation: "运行",
  alarm: "告警",
  workorder: "工单",
  inspection: "巡检",
  maintenance: "维保",
  document: "档案",
  config: "配置",
};

const canAck = computed(() => can(store.role, "alarm:ack"));
const canCreateOrder = computed(() => can(store.role, "workorder:create"));
const ackDeny = computed(
  () => `角色「${roleNames[store.role]}」无权确认告警（需要 alarm:ack 权限）。`,
);
const createDeny = computed(
  () => `角色「${roleNames[store.role]}」无权创建工单（需要 workorder:create 权限）。`,
);

const workOrderForm = reactive({
  title: "",
  symptom: "",
  suggestion: "",
  priority: "medium" as WorkOrderPriority,
});
const workOrderFormError = ref("");

function resetWorkOrderForm(): void {
  const alarm = selectedAlarm.value;
  workOrderFormError.value = "";
  if (!alarm) {
    workOrderForm.title = "";
    workOrderForm.symptom = "";
    workOrderForm.suggestion = "";
    workOrderForm.priority = "medium";
    return;
  }
  const asset = store.getAsset(alarm.assetId);
  const point = alarm.pointId
    ? store.points.find((item) => item.id === alarm.pointId)
    : undefined;
  workOrderForm.title = `处理告警：${alarm.title}`;
  workOrderForm.symptom = alarm.detail;
  workOrderForm.suggestion = asset
    ? `建议核查 ${asset.code} 的${point ? point.label : "相关测点"}，记录复测值并确认是否需要停机检查。`
    : "建议现场核查告警原因，记录复测值后再决定处理方式。";
  workOrderForm.priority =
    alarm.level === "critical" ? "urgent" : alarm.level === "warning" ? "high" : "medium";
}

watch(selectedAlarmId, resetWorkOrderForm, { immediate: true });

const kindNotice = computed(() => {
  const alarm = selectedAlarm.value;
  if (!alarm) return "";
  if (alarm.kind === "business") {
    return "业务提醒：用于成本、保养或计划类提示，不计入生产告警分级，也不代表设备故障。";
  }
  if (alarm.level === "critical") {
    return "生产告警（严重）：请按值班流程确认并处置，必要时创建工单。";
  }
  if (alarm.level === "warning") {
    return "生产告警（警告）：请确认告警后按需创建工单核查。";
  }
  return "生产告警（提示）：建议持续观察，暂不构成紧急处置条件。";
});

function openAlarm(id: string): void {
  selectedAlarmId.value = id;
  void router.replace({ query: { ...route.query, alarmId: id } });
}

function closeAlarm(): void {
  selectedAlarmId.value = null;
  const query = { ...route.query };
  delete query.alarmId;
  void router.replace({ query });
}

function onShowUpdate(value: boolean): void {
  if (!value) closeAlarm();
}

function acknowledge(): void {
  const alarm = selectedAlarm.value;
  if (!alarm) return;
  if (!canAck.value) {
    message.error(ackDeny.value);
    return;
  }
  try {
    store.ackAlarm(alarm.id);
    message.success("告警已确认，操作记录已写入审计。");
  } catch (error) {
    message.error((error as Error).message);
  }
}

function openAsset(): void {
  const alarm = selectedAlarm.value;
  if (!alarm) return;
  if (!store.getAsset(alarm.assetId)) {
    message.warning("关联设备不存在或已退役，无法打开设备详情。");
    return;
  }
  ui.openAsset(alarm.assetId);
  message.info("已打开设备详情抽屉。");
}

function submitWorkOrder(): void {
  const alarm = selectedAlarm.value;
  if (!alarm) return;
  if (!canCreateOrder.value) {
    message.error(createDeny.value);
    return;
  }
  if (alarm.workOrderId) {
    message.info("该告警已关联工单。");
    return;
  }
  if (!workOrderForm.title.trim() || !workOrderForm.symptom.trim()) {
    workOrderFormError.value = "工单标题与症状描述不能为空。";
    return;
  }
  try {
    const draft = store.createWorkOrder({
      title: workOrderForm.title.trim(),
      assetId: alarm.assetId,
      source: "alarm",
      alarmId: alarm.id,
      symptom: workOrderForm.symptom.trim(),
      suggestion: workOrderForm.suggestion.trim(),
      priority: workOrderForm.priority,
      evidenceIds: [alarm.id],
      createdBy: `${roleNames[store.role]}（模拟）`,
    });
    workOrderFormError.value = "";
    message.success(`已生成工单草稿 ${draft.code}，未自动派单`);
  } catch (error) {
    workOrderFormError.value = (error as Error).message;
    message.error(workOrderFormError.value);
  }
}

function goWorkOrder(id: string): void {
  void router.push({ name: "workorders", query: { workOrderId: id } });
}

function onKindFilter(value: string): void {
  kindFilter.value = value;
}
function onLevelFilter(value: string): void {
  levelFilter.value = value;
}
function onStatusFilter(value: string): void {
  statusFilter.value = value;
}
function onPriorityChange(value: string): void {
  workOrderForm.priority = value as WorkOrderPriority;
}
</script>

<template>
  <section class="alarms-page">
    <div class="stat-grid">
      <div class="stat-card production">
        <span>活动生产告警</span>
        <strong>{{ activeProduction }}<small>条</small></strong>
        <small class="stat-hint">需值班确认或转工单</small>
      </div>
      <div class="stat-card business">
        <span>活动业务提醒</span>
        <strong>{{ activeBusiness }}<small>条</small></strong>
        <small class="stat-hint">成本 / 保养类提醒，非设备故障</small>
      </div>
      <div class="stat-card critical">
        <span>严重级生产告警</span>
        <strong>{{ criticalActive }}<small>条</small></strong>
        <small class="stat-hint">critical 级别且未关闭</small>
      </div>
      <div class="stat-card linked">
        <span>已关联工单</span>
        <strong>{{ linkedCount }}<small>条</small></strong>
        <small class="stat-hint">告警与工单双向关联</small>
      </div>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>告警事件</h2>
          <p>生产告警与业务提醒分区展示；业务提醒统一按蓝色提示呈现，不当作红色生产故障。</p>
        </div>
        <NTag size="small" :bordered="false">MOCK 模拟数据</NTag>
      </div>

      <div class="filter-bar">
        <NSelect
          size="small"
          style="width: 160px"
          :value="kindFilter"
          :options="kindOptions"
          @update:value="onKindFilter"
        />
        <NSelect
          size="small"
          style="width: 120px"
          :value="levelFilter"
          :options="levelOptions"
          @update:value="onLevelFilter"
        />
        <NSelect
          size="small"
          style="width: 120px"
          :value="statusFilter"
          :options="statusOptions"
          @update:value="onStatusFilter"
        />
        <NInput
          v-model:value="keyword"
          size="small"
          clearable
          placeholder="搜索标题 / 编号 / 设备"
          style="width: 220px"
        />
        <span class="result-count">共 {{ filteredAlarms.length }} 条</span>
      </div>

      <div v-if="filteredAlarms.length" class="table-wrap">
        <table class="data-table alarms-table">
          <thead>
            <tr>
              <th>级别</th>
              <th>类型</th>
              <th>告警标题</th>
              <th>设备</th>
              <th>发生时间</th>
              <th>状态</th>
              <th>关联工单</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="alarm in filteredAlarms"
              :key="alarm.id"
              class="clickable"
              :class="{ business: alarm.kind === 'business' }"
              @click="openAlarm(alarm.id)"
            >
              <td>
                <NTag
                  v-if="alarm.kind === 'production'"
                  size="tiny"
                  :bordered="false"
                  :type="alarmLevelTagType(alarm.level)"
                >
                  {{ alarmLevelLabels[alarm.level] }}
                </NTag>
                <NTag v-else size="tiny" :bordered="false" type="info">提醒</NTag>
              </td>
              <td>
                <NTag
                  size="tiny"
                  :bordered="false"
                  :type="alarm.kind === 'production' ? 'warning' : 'success'"
                >
                  {{ alarmKindLabels[alarm.kind] }}
                </NTag>
              </td>
              <td class="title-cell">{{ alarm.title }}</td>
              <td>{{ assetLabel(alarm.assetId) }}</td>
              <td>{{ formatDateTime(alarm.occurredAt) }}</td>
              <td>
                <NTag size="tiny" :bordered="false" :type="alarmStatusTagType(alarm.status)">
                  {{ alarmStatusLabels[alarm.status] }}
                </NTag>
              </td>
              <td>
                <RouterLink
                  v-if="alarm.workOrderId"
                  :to="{ name: 'workorders', query: { workOrderId: alarm.workOrderId } }"
                  @click.stop
                >
                  {{ orderCode(alarm.workOrderId) }} →
                </RouterLink>
                <span v-else class="muted">未关联</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">
        当前筛选条件下没有告警。可调整类型 / 级别 / 状态筛选，或切换演示场景后再查看。
      </p>
    </section>

    <NDrawer
      :show="selectedAlarmId !== null"
      :width="580"
      placement="right"
      @update:show="onShowUpdate"
    >
      <NDrawerContent
        :title="selectedAlarm ? `${selectedAlarm.code} · ${selectedAlarm.title}` : '告警详情'"
        closable
      >
        <div v-if="selectedAlarm" class="drawer-body">
          <div class="tag-row">
            <NTag size="small" :bordered="false" :type="selectedAlarm.kind === 'production' ? 'warning' : 'success'">
              {{ alarmKindLabels[selectedAlarm.kind] }}
            </NTag>
            <NTag
              v-if="selectedAlarm.kind === 'production'"
              size="small"
              :bordered="false"
              :type="alarmLevelTagType(selectedAlarm.level)"
            >
              {{ alarmLevelLabels[selectedAlarm.level] }}
            </NTag>
            <NTag size="small" :bordered="false" :type="alarmStatusTagType(selectedAlarm.status)">
              {{ alarmStatusLabels[selectedAlarm.status] }}
            </NTag>
            <NTag size="small" :bordered="false">MOCK 模拟告警</NTag>
          </div>

          <RouterLink
            v-if="selectedAsset?.subsystemId === 'medium-pressure'"
            :to="{ path: '/decision/health', query: { assetId: selectedAlarm.assetId, alarmId: selectedAlarm.id } }"
          >查看该设备的健康分析 →</RouterLink>
          <div class="kind-notice" :class="selectedAlarm.kind">
            {{ kindNotice }}
          </div>

          <h3 class="section-title">告警详情</h3>
          <dl class="detail-list">
            <div><dt>告警编号</dt><dd>{{ selectedAlarm.code }}</dd></div>
            <div><dt>标题</dt><dd>{{ selectedAlarm.title }}</dd></div>
            <div><dt>类型</dt><dd>{{ alarmKindLabels[selectedAlarm.kind] }}</dd></div>
            <div>
              <dt>级别</dt>
              <dd>
                {{
                  selectedAlarm.kind === "production"
                    ? alarmLevelLabels[selectedAlarm.level]
                    : "提醒（不参与生产告警分级）"
                }}
              </dd>
            </div>
            <div><dt>状态</dt><dd>{{ alarmStatusLabels[selectedAlarm.status] }}</dd></div>
            <div><dt>发生时间</dt><dd>{{ formatDateTime(selectedAlarm.occurredAt) }}</dd></div>
            <div><dt>所属工艺</dt><dd>{{ subsystemName }}</dd></div>
            <div><dt>关联测点</dt><dd>{{ selectedPointLabel }}</dd></div>
            <div><dt>详情</dt><dd>{{ selectedAlarm.detail }}</dd></div>
          </dl>

          <h3 class="section-title">设备信息</h3>
          <div v-if="selectedAsset" class="asset-card">
            <div class="asset-head">
              <strong>{{ selectedAsset.name }}</strong>
              <span>{{ selectedAsset.code }}</span>
            </div>
            <p class="asset-meta">
              {{ selectedAsset.type }} · {{ selectedAsset.area === "north" ? "北区" : "南区" }} ·
              负责人 {{ selectedAsset.owner ?? "未提供" }}
            </p>
            <div class="asset-actions">
              <NButton size="small" secondary @click="openAsset">打开设备详情</NButton>
              <span class="muted">同一 assetId 的监测、告警、巡检维保、履历与技术档案</span>
            </div>
          </div>
          <p v-else class="empty">关联设备不可用（{{ selectedAlarm.assetId }}），无法打开设备抽屉。</p>

          <h3 class="section-title">数据标签</h3>
          <div class="label-row">
            <NTag size="tiny" :bordered="false">MOCK · 模拟数据</NTag>
            <span>asOf：{{ formatDateTime(selectedAlarm.occurredAt) }}</span>
            <span>质量：不适用（模拟事件）</span>
          </div>
          <p class="hint">
            口径：由固定种子生成的演示告警事件，不代表真实监测结果、设备故障概率或剩余寿命结论。
          </p>

          <h3 class="section-title">关联工单</h3>
          <div v-if="linkedWorkOrder" class="linked-order">
            <div class="linked-head">
              <strong>{{ linkedWorkOrder.code }}</strong>
              <NTag size="tiny" :bordered="false" :type="workOrderStatusTagType(linkedWorkOrder.status)">
                {{ workOrderStatusLabels[linkedWorkOrder.status] }}
              </NTag>
            </div>
            <p>{{ linkedWorkOrder.title }}</p>
            <NButton size="small" type="primary" secondary @click="goWorkOrder(linkedWorkOrder.id)">
              查看关联工单 →
            </NButton>
          </div>
          <p v-else class="empty">
            尚未关联工单。创建工单只会生成草稿，需人工派单，不会自动流转。
          </p>

          <template v-if="!selectedAlarm.workOrderId">
            <h3 class="section-title">创建工单（草稿）</h3>
            <div class="create-form">
              <label class="field">
                <span>工单标题</span>
                <NInput v-model:value="workOrderForm.title" placeholder="工单标题" />
              </label>
              <label class="field">
                <span>症状描述</span>
                <NInput
                  v-model:value="workOrderForm.symptom"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 4 }"
                  placeholder="症状描述"
                />
              </label>
              <label class="field">
                <span>建议措施</span>
                <NInput
                  v-model:value="workOrderForm.suggestion"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 4 }"
                  placeholder="建议措施"
                />
              </label>
              <label class="field">
                <span>优先级</span>
                <NSelect
                  :value="workOrderForm.priority"
                  :options="priorityOptions"
                  @update:value="onPriorityChange"
                />
              </label>
              <p class="hint">
                自动带入设备、告警、发生时间、症状与建议；提交后为草稿状态，需要人工派单。
              </p>
              <NButton
                type="primary"
                size="small"
                :disabled="!canCreateOrder"
                :title="canCreateOrder ? '生成工单草稿' : createDeny"
                @click="submitWorkOrder"
              >
                生成工单草稿
              </NButton>
              <p v-if="!canCreateOrder" class="deny-hint">{{ createDeny }}</p>
              <p v-if="workOrderFormError" class="error-text">{{ workOrderFormError }}</p>
            </div>
          </template>

          <h3 class="section-title">时间线（设备履历派生）</h3>
          <div v-if="alarmTimeline.length" class="timeline-list">
            <div v-for="event in alarmTimeline" :key="event.id" class="timeline-item">
              <div class="timeline-head">
                <NTag size="tiny" :bordered="false">
                  {{ timelineTypeLabels[event.type] ?? event.type }}
                </NTag>
                <small>{{ formatDateTime(event.at) }}</small>
              </div>
              <p>{{ event.summary }}</p>
              <small>责任人：{{ event.actor ?? "未提供" }} · 来源：{{ event.dataLabel }}</small>
            </div>
          </div>
          <p v-else class="empty">暂无履历事件。</p>

          <p class="notice">
            告警确认与工单创建均会写入审计；时间线由设备履历派生，不支持直接编辑。
          </p>
        </div>
        <p v-else class="empty">
          未找到该告警，可能已被场景复位或链接参数无效。
        </p>

        <template #footer>
          <div v-if="selectedAlarm" class="drawer-footer">
            <span v-if="!canAck" class="deny-hint footer-deny">{{ ackDeny }}</span>
            <NButton
              type="primary"
              :disabled="!canAck || selectedAlarm.status !== 'active'"
              :title="
                !canAck
                  ? ackDeny
                  : selectedAlarm.status === 'active'
                    ? '确认告警'
                    : `当前状态为${alarmStatusLabels[selectedAlarm.status]}，无需再次确认`
              "
              @click="acknowledge"
            >
              确认告警
            </NButton>
            <NButton @click="closeAlarm">关闭</NButton>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </section>
</template>

<style scoped>
.alarms-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  border-radius: 10px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(236, 246, 252, 0.9));
  box-shadow: 0 8px 20px rgba(36, 123, 168, 0.06);
  min-width: 0;
  border-left: 3px solid #b3c3cf;
}
.stat-card.production {
  border-left-color: #d0574f;
}
.stat-card.business {
  border-left-color: #247ba8;
}
.stat-card.critical {
  border-left-color: #a83f39;
}
.stat-card.linked {
  border-left-color: #54a892;
}
.stat-card > span {
  font-size: 12px;
  color: #6a8298;
}
.stat-card strong {
  font-size: 24px;
  color: #1c3e57;
  white-space: nowrap;
}
.stat-card strong small {
  margin-left: 3px;
  font-size: 11px;
  color: #6a8298;
}
.stat-hint {
  font-size: 10.5px;
  color: #8ba0b2;
}
.panel {
  min-width: 0;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel-head h2 {
  margin: 0;
  font-size: 17px;
  color: #1c3e57;
}
.panel-head p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #748a9d;
  line-height: 1.7;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 12px;
}
.result-count {
  margin-left: auto;
  font-size: 11px;
  color: #8296a8;
  white-space: nowrap;
}
.table-wrap {
  width: 100%;
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.alarms-table {
  min-width: 900px;
}
.data-table th {
  text-align: left;
  padding: 8px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
  white-space: nowrap;
}
.data-table td {
  padding: 9px 8px;
  border-bottom: 1px solid #e6eef4;
  color: #2a4660;
  vertical-align: middle;
}
.data-table tbody tr.clickable {
  cursor: pointer;
}
.data-table tbody tr.clickable:hover {
  background: #eef7fc;
}
.data-table tbody tr.business {
  background: #f7fbfd;
}
.data-table tbody tr.business:hover {
  background: #ecf6fb;
}
.title-cell {
  min-width: 220px;
}
.muted {
  color: #8ba0b2;
  font-size: 11px;
}
.drawer-body {
  min-height: 320px;
}
.tag-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.kind-notice {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
}
.kind-notice.production {
  background: #fdf3f1;
  border: 1px solid #f0d1cc;
  color: #9c4a43;
}
.kind-notice.business {
  background: #eef7fc;
  border: 1px solid #cbe4f2;
  color: #2b6d90;
}
.section-title {
  margin: 18px 0 8px;
  font-size: 13px;
  color: #1c3e57;
}
.detail-list {
  margin: 0;
  border-top: 1px solid #e4eef5;
}
.detail-list > div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 12px;
  padding: 9px 0;
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
.asset-card {
  border: 1px solid #e2edf4;
  border-radius: 8px;
  background: #fbfdff;
  padding: 12px;
}
.asset-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.asset-head strong {
  font-size: 14px;
  color: #1c3e57;
}
.asset-head span {
  font-size: 11px;
  color: #8296a8;
}
.asset-meta {
  margin: 6px 0 10px;
  font-size: 12px;
  color: #5d7387;
}
.asset-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.label-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #6b8194;
}
.hint {
  margin: 8px 0;
  font-size: 11px;
  color: #71869a;
  line-height: 1.7;
}
.linked-order {
  border: 1px solid #e2edf4;
  border-radius: 8px;
  background: #fbfdff;
  padding: 12px;
}
.linked-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.linked-order p {
  margin: 6px 0 10px;
  font-size: 12px;
  color: #5d7387;
}
.create-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e0ecf4;
  border-radius: 8px;
  background: #f8fcff;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #6c8296;
}
.create-form .hint {
  margin: 0;
}
.deny-hint {
  margin: 0;
  font-size: 11px;
  color: #a06a1f;
  line-height: 1.7;
}
.footer-deny {
  flex: 1;
}
.error-text {
  margin: 0;
  font-size: 12px;
  color: #c0473f;
}
.timeline-list {
  border-left: 2px solid #cfe3f0;
  padding-left: 14px;
}
.timeline-item {
  position: relative;
  margin-bottom: 12px;
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
  margin: 5px 0 2px;
  font-size: 12px;
  color: #3d566c;
}
.timeline-item small {
  font-size: 11px;
  color: #8296a8;
}
.notice {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f2f7fb;
  font-size: 11px;
  color: #6b8194;
  line-height: 1.7;
}
.empty {
  font-size: 12px;
  color: #8296a8;
  padding: 12px 0;
  margin: 0;
}
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 1280px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

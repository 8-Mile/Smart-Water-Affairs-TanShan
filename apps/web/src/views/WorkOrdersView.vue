<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NButton,
  NCheckbox,
  NDatePicker,
  NInput,
  NSelect,
  NTabPane,
  NTabs,
  NTag,
  useMessage,
} from "naive-ui";
import WorkOrderDrawer from "../components/WorkOrderDrawer.vue";
import { can, roleNames } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import type { InspectionRecord } from "../demo/types";
import {
  formatDateTime,
  workOrderPriorityLabels,
  workOrderPriorityTagType,
  workOrderSourceLabels,
  workOrderStatusLabels,
  workOrderStatusTagType,
  workOrderUpdatedAt,
} from "../demo/workorderMeta";

const store = useDemoStore();
const route = useRoute();
const returnTo=computed(()=>{
 const value=route.query.returnTo;
 if(typeof value!=="string")return null;
 // Local known paths only; no external redirects or unsafe user-provided URL.
 if(value.startsWith("/engineering/registry?focus=balance")||
    value==="/intelligent/unattended"||
    value==="/intelligent/correlation")return value;
 return null;
});

const router = useRouter();
const message = useMessage();

const kpiStatuses: { status: keyof typeof workOrderStatusLabels; label: string; hint: string }[] = [
  { status: "draft", label: "草稿", hint: "未提交" },
  { status: "pending_dispatch", label: "待派单", hint: "等待接单" },
  { status: "in_progress", label: "维修中", hint: "处理中" },
  { status: "pending_acceptance", label: "待验收", hint: "等待验收" },
  { status: "archived", label: "已归档", hint: "流程结束" },
];

function countStatus(status: keyof typeof workOrderStatusLabels): number {
  return store.workorders.filter((order) => order.status === status).length;
}

const cancelledCount = computed(
  () => store.workorders.filter((order) => order.status === "cancelled").length,
);

const statusFilter = ref("all");
watch(() => route.query.status, value => {
  statusFilter.value = value === "pending_acceptance" ? value : "all";
}, { immediate: true });
const sourceFilter = ref("all");
const assetFilter = ref("all");
watch(() => route.query.assetId, value => {
  assetFilter.value = typeof value === "string" && store.getAsset(value) ? value : "all";
}, { immediate: true });

const statusOptions = [
  { label: "全部状态", value: "all" },
  ...Object.entries(workOrderStatusLabels).map(([value, label]) => ({ value, label })),
];
const sourceOptions = [
  { label: "全部来源", value: "all" },
  ...Object.entries(workOrderSourceLabels).map(([value, label]) => ({ value, label })),
];
const assetOptions = computed(() => [
  { label: "全部设备", value: "all" },
  ...store.assets.map((asset) => ({
    value: asset.id,
    label: `${asset.code} · ${asset.name}`,
  })),
]);

function toggleStatus(status: keyof typeof workOrderStatusLabels): void {
  statusFilter.value = statusFilter.value === status ? "all" : status;
}

function resetFilters(): void {
  statusFilter.value = "all";
  sourceFilter.value = "all";
  assetFilter.value = "all";
}

const filteredOrders = computed(() =>
  store.workorders
    .filter((order) => statusFilter.value === "all" || order.status === statusFilter.value)
    .filter((order) => sourceFilter.value === "all" || order.source === sourceFilter.value)
    .filter((order) => assetFilter.value === "all" || order.assetId === assetFilter.value)
    .slice()
    .sort((a, b) => Date.parse(workOrderUpdatedAt(b)) - Date.parse(workOrderUpdatedAt(a))),
);

function assetLabel(assetId: string): string {
  const asset = store.getAsset(assetId);
  return asset ? `${asset.code} · ${asset.name}` : `设备不可用（${assetId}）`;
}

const selectedWorkOrderId = ref<string | null>(null);

watch(
  () => route.query.workOrderId,
  (value) => {
    selectedWorkOrderId.value =
      typeof value === "string" && value.length > 0 ? value : null;
  },
  { immediate: true },
);

function openOrder(id: string): void {
  selectedWorkOrderId.value = id;
  void router.replace({ query: { ...route.query, workOrderId: id } });
}

function closeOrder(): void {
  selectedWorkOrderId.value = null;
  const query = { ...route.query };
  delete query.workOrderId;
  void router.replace({ query });
}

const tab = ref("workorders");

watch(
  () => route.query.tab,
  (value) => {
    if (value === "inspections") tab.value = "inspections";
  },
  { immediate: true },
);

function changeTab(value: string): void {
  tab.value = value;
  const query = { ...route.query };
  if (value === "inspections") query.tab = "inspections";
  else delete query.tab;
  void router.replace({ query });
}

const canHandle = computed(() => can(store.role, "workorder:handle"));
const canCreateWorkOrder = computed(() => can(store.role, "workorder:create"));
const handleDeny = computed(
  () => `角色「${roleNames[store.role]}」无权新增巡检记录（需要 workorder:handle 权限）。`,
);
const createDeny = computed(
  () => `角色「${roleNames[store.role]}」无权创建工单（需要 workorder:create 权限）。`,
);

const inspectionRows = computed(() =>
  store.inspections
    .slice()
    .sort((a, b) => Date.parse(b.inspectedAt) - Date.parse(a.inspectedAt)),
);
const expandedInspectionId = ref<string | null>(null);

function toggleInspection(id: string): void {
  expandedInspectionId.value = expandedInspectionId.value === id ? null : id;
}

function abnormalItems(record: InspectionRecord): InspectionRecord["items"] {
  return record.items.filter((item) => item.abnormal);
}

const showInspectionForm = ref(false);
const inspectionFormError = ref("");
const inspectionAssetId = ref(store.assets[0]?.id ?? "");
const inspectionAt = ref<number | null>(Date.parse(store.seed.referenceTime));
const inspectionResult = ref<"normal" | "abnormal">("normal");
const inspectionNote = ref("");

interface InspectionItemDraft {
  label: string;
  value: string;
  abnormal: boolean;
}

function defaultInspectionItems(): InspectionItemDraft[] {
  return [
    { label: "外观与异响", value: "正常", abnormal: false },
    { label: "振动 / 温度", value: "正常", abnormal: false },
    { label: "密封渗漏", value: "无渗漏", abnormal: false },
  ];
}

const inspectionItems = ref<InspectionItemDraft[]>(defaultInspectionItems());
const inspectionResultOptions = [
  { label: "正常", value: "normal" },
  { label: "异常", value: "abnormal" },
];

function addInspectionItem(): void {
  inspectionItems.value.push({ label: "", value: "", abnormal: false });
}

function removeInspectionItem(index: number): void {
  if (inspectionItems.value.length <= 1) return;
  inspectionItems.value.splice(index, 1);
}

function syncInspectionResult(): void {
  if (inspectionItems.value.some((item) => item.abnormal)) {
    inspectionResult.value = "abnormal";
  }
}

function toggleInspectionForm(): void {
  if (!canHandle.value) {
    message.warning(handleDeny.value);
    return;
  }
  showInspectionForm.value = !showInspectionForm.value;
  inspectionFormError.value = "";
}

function nextInspectionId(): string {
  let max = 0;
  for (const record of store.inspections) {
    const match = /^INS-USER-(\d+)$/.exec(record.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `INS-USER-${String(max + 1).padStart(3, "0")}`;
}

function submitInspection(): void {
  inspectionFormError.value = "";
  if (!canHandle.value) {
    inspectionFormError.value = handleDeny.value;
    message.error(inspectionFormError.value);
    return;
  }
  const asset = store.getAsset(inspectionAssetId.value);
  if (!asset) {
    inspectionFormError.value = "请选择有效的关联设备。";
    return;
  }
  if (!inspectionAt.value) {
    inspectionFormError.value = "请选择巡检时间。";
    return;
  }
  const items = inspectionItems.value
    .map((item) => ({
      label: item.label.trim(),
      value: item.value.trim(),
      abnormal: item.abnormal,
    }))
    .filter((item) => item.label || item.value);
  if (!items.length) {
    inspectionFormError.value = "请至少填写 1 个检查项。";
    return;
  }
  if (items.some((item) => !item.label || !item.value)) {
    inspectionFormError.value = "检查项名称与检查结果均不能为空。";
    return;
  }

  const hasAbnormal = items.some((item) => item.abnormal);
  const result = hasAbnormal ? "abnormal" : inspectionResult.value;
  try {
    store.addInspection({
      id: nextInspectionId(),
      assetId: asset.id,
      inspectedAt: new Date(inspectionAt.value).toISOString(),
      inspector: `${roleNames[store.role]}（模拟）`,
      items,
      result,
      note: inspectionNote.value.trim() || undefined,
    });
    message.success("已新增巡检记录，可在设备履历中查看。");
    showInspectionForm.value = false;
    inspectionFormError.value = "";
    inspectionItems.value = defaultInspectionItems();
    inspectionResult.value = "normal";
    inspectionNote.value = "";
    inspectionAt.value = Date.parse(store.seed.referenceTime);
  } catch (error) {
    inspectionFormError.value = (error as Error).message;
    message.error(inspectionFormError.value);
  }
}

function convertInspection(
  record: InspectionRecord,
  item: { label: string; value: string },
): void {
  if (!canCreateWorkOrder.value) {
    message.error(createDeny.value);
    return;
  }
  try {
    const draft = store.createWorkOrder({
      title: `巡检异常：${item.label}`,
      assetId: record.assetId,
      source: "inspection",
      symptom: `巡检记录 ${record.id}（${formatDateTime(record.inspectedAt)}）发现「${item.label}」异常：${
        item.value
      }${record.note ? `；备注：${record.note}` : ""}`,
      suggestion: `现场复核${item.label}，记录复测值并核对相关测点趋势后再决定处理方式。`,
      priority: "medium",
      evidenceIds: [record.id],
      createdBy: `${roleNames[store.role]}（模拟）`,
    });
    message.success(`已生成工单草稿 ${draft.code}，未自动派单`);
    tab.value = "workorders";
    void router.push({
      name: "workorders",
      query: { workOrderId: draft.id, tab: "workorders" },
    });
  } catch (error) {
    message.error((error as Error).message);
  }
}

function onStatusFilter(value: string): void {
  statusFilter.value = value;
}

function onSourceFilter(value: string): void {
  sourceFilter.value = value;
}

function onAssetFilter(value: string): void {
  assetFilter.value = value;
}

function onInspectionAssetChange(value: string): void {
  inspectionAssetId.value = value;
}

function onInspectionAtChange(value: number | null): void {
  inspectionAt.value = value;
}

function onInspectionResultChange(value: string): void {
  inspectionResult.value = value === "abnormal" ? "abnormal" : "normal";
}
</script>

<template>
  <section class="workorders-page">
    <div v-if="returnTo" class="order-return">
      <router-link :to="returnTo">返回上一个业务核查页面</router-link>
      <span>可在工单证据区查看原始核查数据并回到对应池体</span>
    </div>
    <div class="kpi-grid">
      <button
        v-for="item in kpiStatuses"
        :key="item.status"
        type="button"
        class="kpi-card"
        :class="{ active: statusFilter === item.status }"
        @click="toggleStatus(item.status)"
      >
        <span class="kpi-label">{{ item.label }}</span>
        <strong>{{ countStatus(item.status) }}<small>单</small></strong>
        <span class="kpi-hint">{{ item.hint }} · 点击筛选</span>
      </button>
    </div>

    <p class="caption">
      状态流转：草稿 → 待派单 → 维修中 → 待验收 → 已归档；验收不通过退回维修中，未终结工单可取消。
      <template v-if="cancelledCount > 0">另有已取消 {{ cancelledCount }} 单。</template>
      验收归档只结束工单流程，不自动恢复健康分或改写历史监测数据。
    </p>

    <section class="panel">
      <NTabs :value="tab" type="line" size="small" animated @update:value="changeTab">
        <NTabPane name="workorders" :tab="`工单（${store.workorders.length}）`">
          <div class="filter-bar">
            <span class="filter-label">筛选</span>
            <NSelect
              size="small"
              style="width: 132px"
              :value="statusFilter"
              :options="statusOptions"
              @update:value="onStatusFilter"
            />
            <NSelect
              size="small"
              style="width: 132px"
              :value="sourceFilter"
              :options="sourceOptions"
              @update:value="onSourceFilter"
            />
            <NSelect
              size="small"
              style="width: 200px"
              :value="assetFilter"
              :options="assetOptions"
              @update:value="onAssetFilter"
            />
            <NButton size="small" quaternary @click="resetFilters">重置</NButton>
            <span class="result-count">共 {{ filteredOrders.length }} 单</span>
          </div>

          <div v-if="filteredOrders.length" class="table-wrap">
            <table class="data-table orders-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>标题</th>
                  <th>设备</th>
                  <th>来源</th>
                  <th>优先级</th>
                  <th>状态</th>
                  <th>负责人</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="order in filteredOrders"
                  :key="order.id"
                  class="clickable"
                  @click="openOrder(order.id)"
                >
                  <td class="mono">{{ order.code }}</td>
                  <td class="title-cell">{{ order.title }}</td>
                  <td>{{ assetLabel(order.assetId) }}</td>
                  <td>{{ workOrderSourceLabels[order.source] }}</td>
                  <td>
                    <NTag size="tiny" :bordered="false" :type="workOrderPriorityTagType(order.priority)">
                      {{ workOrderPriorityLabels[order.priority] }}
                    </NTag>
                  </td>
                  <td>
                    <NTag size="tiny" :bordered="false" :type="workOrderStatusTagType(order.status)">
                      {{ workOrderStatusLabels[order.status] }}
                    </NTag>
                  </td>
                  <td>{{ order.assignee || "未指派" }}</td>
                  <td>{{ formatDateTime(workOrderUpdatedAt(order)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty">当前筛选条件下没有工单。可调整状态 / 来源 / 设备筛选或重置条件。</p>
        </NTabPane>

        <NTabPane name="inspections" :tab="`巡检记录（${store.inspections.length}）`">
          <div class="tab-head">
            <div>
              <h3>巡检记录</h3>
              <p class="hint">点击记录展开检查项；异常项可一键生成工单草稿，不会自动派单。</p>
            </div>
            <NButton
              type="primary"
              size="small"
              :disabled="!canHandle"
              :title="canHandle ? '新增巡检记录' : handleDeny"
              @click="toggleInspectionForm"
            >
              {{ showInspectionForm ? "收起表单" : "新增巡检记录" }}
            </NButton>
          </div>
          <p v-if="!canHandle" class="deny-hint">{{ handleDeny }}</p>

          <div v-if="showInspectionForm" class="inspection-form">
            <div class="form-grid">
              <label class="field">
                <span>设备</span>
                <NSelect
                  :value="inspectionAssetId"
                  :options="assetOptions.slice(1)"
                  placeholder="请选择设备"
                  @update:value="onInspectionAssetChange"
                />
              </label>
              <label class="field">
                <span>巡检时间</span>
                <NDatePicker
                  type="datetime"
                  :value="inspectionAt"
                  style="width: 100%"
                  @update:value="onInspectionAtChange"
                />
              </label>
              <label class="field">
                <span>巡检结果</span>
                <NSelect
                  :value="inspectionResult"
                  :options="inspectionResultOptions"
                  @update:value="onInspectionResultChange"
                />
              </label>
              <label class="field">
                <span>检查人</span>
                <span class="readonly-value">{{ roleNames[store.role] }}（模拟）</span>
              </label>
            </div>

            <div class="items-editor">
              <div class="items-head">
                <span>检查项</span>
                <NButton size="tiny" secondary @click="addInspectionItem">+ 添加检查项</NButton>
              </div>
              <div
                v-for="(item, index) in inspectionItems"
                :key="index"
                class="item-row"
              >
                <NInput v-model:value="item.label" placeholder="检查项名称" />
                <NInput v-model:value="item.value" placeholder="检查结果" />
                <NCheckbox
                  v-model:checked="item.abnormal"
                  @update:checked="syncInspectionResult"
                >
                  异常
                </NCheckbox>
                <NButton
                  size="tiny"
                  quaternary
                  :disabled="inspectionItems.length <= 1"
                  @click="removeInspectionItem(index)"
                >
                  删除
                </NButton>
              </div>
            </div>

            <NInput
              v-model:value="inspectionNote"
              type="textarea"
              placeholder="巡检备注（可选）"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
            <p v-if="inspectionFormError" class="error-text">{{ inspectionFormError }}</p>
            <div class="form-actions">
              <NButton type="primary" size="small" @click="submitInspection">保存巡检记录</NButton>
              <NButton size="small" @click="showInspectionForm = false">取消</NButton>
            </div>
          </div>

          <div v-if="inspectionRows.length" class="table-wrap">
            <table class="data-table inspections-table">
              <thead>
                <tr>
                  <th>巡检时间</th>
                  <th>设备</th>
                  <th>结果</th>
                  <th>检查人</th>
                  <th>异常项</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="record in inspectionRows" :key="record.id">
                  <tr class="clickable" @click="toggleInspection(record.id)">
                    <td>{{ formatDateTime(record.inspectedAt) }}</td>
                    <td>{{ assetLabel(record.assetId) }}</td>
                    <td>
                      <NTag
                        size="tiny"
                        :bordered="false"
                        :type="record.result === 'normal' ? 'success' : 'warning'"
                      >
                        {{ record.result === "normal" ? "正常" : "异常" }}
                      </NTag>
                    </td>
                    <td>{{ record.inspector }}</td>
                    <td class="abnormal-cell">
                      {{
                        abnormalItems(record).length
                          ? abnormalItems(record)
                              .map((item) => `${item.label}：${item.value}`)
                              .join("；")
                          : "无异常项"
                      }}
                      <span class="expand-hint">{{ expandedInspectionId === record.id ? "收起" : "展开" }}</span>
                    </td>
                  </tr>
                  <tr v-if="expandedInspectionId === record.id" class="detail-row">
                    <td colspan="5">
                      <div class="inspection-detail">
                        <ul class="item-list">
                          <li v-for="(item, index) in record.items" :key="index">
                            <span class="item-label">{{ item.label }}</span>
                            <span class="item-value">{{ item.value }}</span>
                            <NTag v-if="item.abnormal" size="tiny" :bordered="false" type="warning">
                              异常
                            </NTag>
                            <NButton
                              v-if="item.abnormal"
                              size="tiny"
                              type="warning"
                              secondary
                              :disabled="!canCreateWorkOrder"
                              :title="canCreateWorkOrder ? '将该异常项转为工单草稿' : createDeny"
                              @click.stop="convertInspection(record, item)"
                            >
                              转工单
                            </NButton>
                          </li>
                        </ul>
                        <p v-if="record.note" class="detail-note">备注：{{ record.note }}</p>
                        <p v-if="!record.items.length" class="empty">该记录未填写检查项。</p>
                        <small class="record-meta">
                          记录号：{{ record.id }} · 来源：MOCK 模拟巡检 ·
                          转工单仅生成草稿，不会自动派单
                        </small>
                        <p
                          v-if="abnormalItems(record).length && !canCreateWorkOrder"
                          class="deny-hint"
                        >
                          {{ createDeny }}
                        </p>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p v-else class="empty">暂无巡检记录。缺失巡检记录不等于设备正常。</p>
        </NTabPane>
      </NTabs>
    </section>

    <WorkOrderDrawer :work-order-id="selectedWorkOrderId" @close="closeOrder" />
  </section>
</template>

<style scoped>
.workorders-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.kpi-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(236, 246, 252, 0.9));
  box-shadow: 0 8px 20px rgba(36, 123, 168, 0.06);
  cursor: pointer;
  text-align: left;
  color: inherit;
  transition: border-color 0.2s, transform 0.2s;
  min-width: 0;
}
.kpi-card:hover {
  border-color: #9dc9dc;
  transform: translateY(-1px);
}
.kpi-card.active {
  border-color: #247ba8;
  box-shadow: inset 0 0 0 1px rgba(36, 123, 168, 0.4);
}
.kpi-label {
  font-size: 12px;
  color: #6a8298;
}
.kpi-card strong {
  font-size: 24px;
  color: #1c3e57;
  white-space: nowrap;
}
.kpi-card strong small {
  margin-left: 3px;
  font-size: 11px;
  color: #6a8298;
}
.kpi-hint {
  font-size: 10.5px;
  color: #8ba0b2;
}
.caption {
  margin: 0;
  font-size: 11px;
  color: #71869a;
  line-height: 1.7;
}
.panel {
  min-width: 0;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 8px 18px 18px;
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 0 12px;
}
.filter-label {
  font-size: 11px;
  color: #8296a8;
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
.orders-table {
  min-width: 940px;
}
.inspections-table {
  min-width: 820px;
}
.data-table th {
  text-align: left;
  padding: 8px 8px;
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
.mono {
  font-family: "SFMono-Regular", Consolas, monospace;
  white-space: nowrap;
}
.title-cell {
  min-width: 200px;
}
.abnormal-cell {
  max-width: 380px;
}
.expand-hint {
  margin-left: 6px;
  font-size: 11px;
  color: #247ba8;
  white-space: nowrap;
}
.detail-row td {
  background: #f7fbfe;
  padding: 12px 14px;
}
.inspection-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.item-label {
  min-width: 120px;
  color: #71869a;
}
.item-value {
  color: #2a4660;
}
.detail-note {
  margin: 0;
  font-size: 12px;
  color: #5d7387;
}
.record-meta {
  font-size: 11px;
  color: #8296a8;
}
.tab-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0 10px;
}
.tab-head h3 {
  margin: 0;
  font-size: 15px;
  color: #1c3e57;
}
.hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: #71869a;
  line-height: 1.7;
}
.deny-hint {
  margin: 6px 0;
  font-size: 11px;
  color: #a06a1f;
  line-height: 1.7;
}
.inspection-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  margin-bottom: 14px;
  border: 1px solid #e0ecf4;
  border-radius: 10px;
  background: #f8fcff;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #6c8296;
  min-width: 0;
}
.readonly-value {
  padding: 7px 0;
  font-size: 13px;
  color: #2a4660;
}
.items-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #3d566c;
}
.item-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}
.form-actions {
  display: flex;
  gap: 8px;
}
.error-text {
  margin: 0;
  font-size: 12px;
  color: #c0473f;
}
.empty {
  font-size: 12px;
  color: #8296a8;
  padding: 14px 0;
  margin: 0;
}
@media (max-width: 1280px) {
  .kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .item-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.order-return{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #d7e7f0;background:#f3f9fc;border-radius:8px;padding:10px 13px;font-size:11px}
.order-return a{font-weight:700;color:#2381a8;text-decoration:none}.order-return span{color:#7c9db0}
</style>

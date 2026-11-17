<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NInput,
  NTag,
  useMessage,
} from "naive-ui";
import type { WorkOrderAction, WorkOrderTransitionPayload } from "../demo/commands";
import { can, roleNames } from "../demo/permissions";
import type { Action as PermissionAction } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import {readBasinBalanceCases} from "../demo/basinBalance";
import { useUiStore } from "../demo/ui";
import {
  alarmLevelLabels,
  alarmStatusLabels,
  formatDateTime,
  formatTimeRange,
  workOrderActionLabels,
  workOrderHistoryLabels,
  workOrderPriorityLabels,
  workOrderPriorityTagType,
  workOrderSourceLabels,
  workOrderStatusHints,
  workOrderStatusLabels,
  workOrderStatusTagType,
} from "../demo/workorderMeta";
import type { TagType } from "../demo/workorderMeta";

const props = defineProps<{ workOrderId: string | null }>();
const emit = defineEmits<{ (event: "close"): void }>();

const store = useDemoStore();
const ui = useUiStore();
const message = useMessage();
const router = useRouter();

const order = computed(() =>
  props.workOrderId
    ? store.workorders.find((item) => item.id === props.workOrderId)
    : undefined,
);
const asset = computed(() =>
  order.value ? store.getAsset(order.value.assetId) : undefined,
);
const linkedAlarm = computed(() =>
  order.value?.alarmId
    ? store.alarms.find((item) => item.id === order.value?.alarmId)
    : undefined,
);
const actor = computed(() => `${roleNames[store.role]}（模拟）`);

interface ActionDef {
  action: WorkOrderAction;
  label: string;
  permission: PermissionAction;
  tone: "default" | "primary" | "error" | "warning";
}

const statusActions = computed<ActionDef[]>(() => {
  if (!order.value) return [];
  switch (order.value.status) {
    case "draft":
      return [
        { action: "submit", label: "提交待派单", permission: "workorder:create", tone: "primary" },
        { action: "cancel", label: "取消工单", permission: "workorder:create", tone: "error" },
      ];
    case "pending_dispatch":
      return [
        { action: "start", label: "接单开始维修", permission: "workorder:handle", tone: "primary" },
        { action: "cancel", label: "取消工单", permission: "workorder:create", tone: "error" },
      ];
    case "in_progress":
      return [
        { action: "complete", label: "提交处理结果", permission: "workorder:handle", tone: "primary" },
        { action: "cancel", label: "取消工单", permission: "workorder:create", tone: "error" },
      ];
    case "pending_acceptance":
      return [
        { action: "accept", label: "验收通过并归档", permission: "workorder:accept", tone: "primary" },
        { action: "reject", label: "验收不通过", permission: "workorder:accept", tone: "error" },
        { action: "cancel", label: "取消工单", permission: "workorder:create", tone: "error" },
      ];
    default:
      return [];
  }
});

const deniedActions = computed(() =>
  statusActions.value.filter((item) => !can(store.role, item.permission)),
);

function denialText(action: ActionDef): string {
  return `角色「${roleNames[store.role]}」无权执行「${action.label}」，请切换为具备 ${action.permission} 权限的角色。`;
}

type PendingAction = WorkOrderAction;

const pendingAction = ref<PendingAction | null>(null);
const errorText = ref("");
const justAccepted = ref(false);
const expandedEvidenceId = ref<string | null>(null);

const form = reactive({
  assignee: "",
  cause: "",
  measures: "",
  materials: "",
  note: "",
});

const actionFormTitle: Record<string, string> = {
  start: "接单并填写负责人",
  complete: "填写维修处理结果",
  accept: "验收归档",
  reject: "验收退回",
  cancel: "取消工单",
};

const notePlaceholder = computed(() => {
  switch (pendingAction.value) {
    case "accept":
      return "验收备注（可选）";
    case "reject":
      return "请填写退回原因（必填）";
    case "cancel":
      return "请填写取消原因（必填）";
    default:
      return "";
  }
});

const actionHint = computed(() => {
  switch (pendingAction.value) {
    case "start":
      return "接单后工单进入维修中，负责人会记录在处理历史中。";
    case "complete":
      return "原因与处理措施为必填项；提交后进入待验收。";
    case "accept":
      return "验收归档仅表示流程确认，不代表设备物理状态已恢复。";
    case "reject":
      return "退回后工单回到维修中，可补充处理后再次提交验收。";
    case "cancel":
      return "取消只结束未归档工单，历史记录仍保留。";
    default:
      return "";
  }
});

function resetForm(): void {
  form.assignee = "";
  form.cause = "";
  form.measures = "";
  form.materials = "";
  form.note = "";
}

const successText: Record<WorkOrderAction, string> = {
  submit: "已提交，等待派单",
  start: "已接单，工单进入维修中",
  complete: "已提交处理结果，等待验收",
  accept: "验收通过：已归档并写入设备履历",
  reject: "验收不通过，已退回维修中",
  cancel: "工单已取消",
};

function runAction(action: WorkOrderAction, payload: WorkOrderTransitionPayload): void {
  if (!order.value) return;
  try {
    store.workOrderAction(order.value.id, action, payload);
    errorText.value = "";
    pendingAction.value = null;
    if (action === "accept") justAccepted.value = true;
    message.success(successText[action]);
  } catch (error) {
    const text = (error as Error).message;
    errorText.value = text;
    message.error(text);
  }
}

function begin(action: WorkOrderAction, definition: ActionDef): void {
  if (!order.value) return;
  if (!can(store.role, definition.permission)) {
    message.error(denialText(definition));
    return;
  }
  if (action === "submit") {
    runAction("submit", { by: actor.value, note: "提交待派单。" });
    return;
  }
  errorText.value = "";
  resetForm();
  pendingAction.value = action;
  if (action === "start") form.assignee = order.value.assignee ?? "";
  if (action === "complete") {
    form.cause = order.value.result?.cause ?? "";
    form.measures = order.value.result?.measures ?? "";
    form.materials = order.value.result?.materials ?? "";
    form.note = order.value.result?.note ?? "";
  }
}

function submitPending(): void {
  if (!order.value || !pendingAction.value) return;
  const action = pendingAction.value;
  errorText.value = "";

  if (action === "start" && !form.assignee.trim()) {
    errorText.value = "请填写负责人后再接单。";
    return;
  }
  if (action === "complete") {
    if (!form.cause.trim() || !form.measures.trim()) {
      errorText.value = "请填写故障/异常原因与处理措施。";
      return;
    }
  }
  if ((action === "reject" || action === "cancel") && !form.note.trim()) {
    errorText.value = action === "cancel" ? "请填写取消原因。" : "请填写退回原因。";
    return;
  }

  const payload: WorkOrderTransitionPayload = { by: actor.value };
  if (action === "start") payload.assignee = form.assignee.trim();
  if (action === "complete") {
    payload.result = {
      cause: form.cause.trim(),
      measures: form.measures.trim(),
      materials: form.materials.trim() || undefined,
      note: form.note.trim() || undefined,
    };
  }
  if (action === "accept" || action === "reject") {
    payload.note = form.note.trim() || undefined;
    payload.acceptance = { note: form.note.trim() || undefined, by: actor.value };
  }
  if (action === "cancel") payload.note = form.note.trim();

  runAction(action, payload);
}

interface EvidenceItem {
  id: string;
  kind: "document" | "inspection" | "alarm" | "workorder" | "asset" | "balance" | "missing";
  label: string;
  detail: string;
  missing: boolean;
  excerpt?: string;
  lines?: string[];
  note?: string;
}

function missingEvidence(id: string): EvidenceItem {
  return {
    id,
    kind: "missing",
    label: `原文不可用（${id}）`,
    detail: "关联资料已删除或不存在，系统不会补造原文。",
    missing: true,
  };
}

function resolveEvidence(id: string): EvidenceItem {
  if (id.startsWith("BB-")) {
    const balance = readBasinBalanceCases(localStorage).find((item) => item.id === id);
    if (!balance) return missingEvidence(id);
    return {
      id,
      kind: "balance",
      label: "单池水量核查 " + balance.poolCode + " / V" + balance.poolRevision,
      detail: "核查 " + balance.id + " · 残差 " + balance.result.residualM3 +
        "m³ · " + (balance.input.basis === "MOCK" ? "纯MOCK" : "人工待核") +
        " · 非实时生产告警",
      lines: [
        "核算周期：" + balance.input.startAt + " 至 " + balance.input.endAt,
        "起止液位：" + balance.input.startLevelM + "m → " + balance.input.endLevelM + "m",
        "累计进水：" + balance.input.inflowM3 + "m³；累计出水：" + balance.input.outflowM3 + "m³",
        "依据：" + balance.input.evidenceRef,
        "处置：" + balance.history.map(h => h.action).join(" → "),
      ],
      note: "仅DEMO浏览器本地快照。点击证据展开后，可返回原池体核算记录。",
      missing: false,
    };
  }
  if (store.userState.removedDocumentIds.includes(id)) {
    return missingEvidence(id);
  }
  const document = store.documents.find((item) => item.id === id);
  if (document) {
    return {
      id,
      kind: "document",
      label: document.title,
      detail: `${document.version} · ${document.reviewed ? "已审核" : "未审核"} · ${
        document.lineOrSection ?? "未标注章节"
      }`,
      missing: false,
      excerpt: document.contentExcerpt,
      note: document.summary,
    };
  }
  const inspection = store.inspections.find((item) => item.id === id);
  if (inspection) {
    return {
      id,
      kind: "inspection",
      label: `巡检记录 ${inspection.id}`,
      detail: `${formatDateTime(inspection.inspectedAt)} · ${inspection.inspector} · ${
        inspection.result === "normal" ? "正常" : "发现异常"
      }`,
      missing: false,
      lines: inspection.items.map(
        (item) => `${item.label}：${item.value}${item.abnormal ? "（异常）" : ""}`,
      ),
      note: inspection.note,
    };
  }
  const alarm = store.alarms.find((item) => item.id === id);
  if (alarm) {
    return {
      id,
      kind: "alarm",
      label: `告警 ${alarm.code}`,
      detail: `${alarm.title} · ${alarmLevelLabels[alarm.level]} · ${formatDateTime(
        alarm.occurredAt,
      )}`,
      missing: false,
    };
  }
  const workorder = store.workorders.find((item) => item.id === id);
  if (workorder) {
    return {
      id,
      kind: "workorder",
      label: `工单 ${workorder.code}`,
      detail: `${workorder.title} · ${workOrderStatusLabels[workorder.status]}`,
      missing: false,
    };
  }
  const relatedAsset = store.getAsset(id);
  if (relatedAsset) {
    return {
      id,
      kind: "asset",
      label: `设备 ${relatedAsset.code}`,
      detail: `${relatedAsset.name} · ${relatedAsset.type}`,
      missing: false,
    };
  }
  return missingEvidence(id);
}

function balancePoolId(id: string):string|undefined {
 return readBasinBalanceCases(localStorage).find(item=>item.id===id)?.poolId;
}

const evidenceItems = computed<EvidenceItem[]>(() =>
  order.value ? order.value.evidenceIds.map(resolveEvidence) : [],
);

function evidenceKindLabel(kind: EvidenceItem["kind"]): string {
  switch (kind) {
    case "document":
      return "档案";
    case "inspection":
      return "巡检";
    case "alarm":
      return "告警";
    case "workorder":
      return "工单";
    case "balance":
      return "水量核查";
    case "asset":
      return "设备";
    case "missing":
      return "缺失";
  }
}

function evidenceTagType(kind: EvidenceItem["kind"]): TagType {
  switch (kind) {
    case "document":
      return "info";
    case "inspection":
      return "success";
    case "alarm":
      return "warning";
    case "workorder":
      return "info";
    case "balance":
      return "warning";
    case "asset":
      return "default";
    case "missing":
      return "error";
  }
}

function onEvidence(item: EvidenceItem): void {
  if (item.missing) {
    message.warning("原文不可用：关联资料已被删除或不存在。");
    return;
  }
  if (item.kind === "document" || item.kind === "inspection" || item.kind === "balance") {
    expandedEvidenceId.value = expandedEvidenceId.value === item.id ? null : item.id;
    return;
  }
  if (item.kind === "alarm") {
    void router.push({ name: "alarms", query: { alarmId: item.id } });
    emit("close");
    return;
  }
  if (item.kind === "workorder") {
    if (item.id !== order.value?.id) {
      void router.push({ name: "workorders", query: { workOrderId: item.id } });
    }
    return;
  }
  ui.openAsset(item.id);
  message.info("已打开设备详情抽屉。");
}

const triggerSnapshot = computed(() => order.value?.triggerSnapshot);
const triggerPoint = computed(() =>
  triggerSnapshot.value
    ? store.points.find((item) => item.id === triggerSnapshot.value?.pointId)
    : undefined,
);

const acceptance = computed(() => order.value?.acceptance);
const processingResult = computed(() => order.value?.result);

const pendingActionLabel = computed(() =>
  pendingAction.value ? workOrderActionLabels[pendingAction.value] : "",
);

function historyNote(action: string, note?: string): string {
  return note || workOrderHistoryLabels[action] || action;
}

const history = computed(() =>
  order.value
    ? [...order.value.history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [],
);

function openAssetDetail(): void {
  if (!order.value) return;
  if (!store.getAsset(order.value.assetId)) {
    message.warning("关联设备不存在或已退役，无法打开设备详情。");
    return;
  }
  if (router.currentRoute.value.path === "/operations/asset-workspace") {
    const id = order.value.assetId;
    close();
    void router.replace({path:"/operations/asset-workspace",query:{assetId:id,tab:"monitor"}});
    return;
  }
  ui.openAsset(order.value.assetId);
}

function openAssetTimeline(): void {
  if (order.value && router.currentRoute.value.path === "/operations/asset-workspace") {
    const id=order.value.assetId;
    close();
    void router.replace({path:"/operations/asset-workspace",query:{assetId:id,tab:"inspection"}});
    message.info("已返回当前设备工作台的「巡检与履历」，不离开原业务页面。");
    return;
  }
  openAssetDetail();
  message.info("已打开设备详情，请切换到「设备履历」Tab 查看归档记录。");
}

function goBackToSourceAlarm():void{
 if(!linkedAlarm.value)return;
 const alarmId=linkedAlarm.value.id;
 close();
 void router.push({path:"/operations/events",query:{
  tab:"alarms",alarmId,eventRef:"alarm:"+alarmId,
 }});
}
function close(): void {
  emit("close");
}

watch(
  () => props.workOrderId,
  () => {
    pendingAction.value = null;
    errorText.value = "";
    expandedEvidenceId.value = null;
    justAccepted.value = false;
    resetForm();
  },
);

function onShowUpdate(value: boolean): void {
  if (!value) close();
}
</script>

<template>
  <NDrawer
    :show="Boolean(props.workOrderId)"
    :width="580"
    placement="right"
    @update:show="onShowUpdate"
  >
    <NDrawerContent
      :title="order ? `${order.code} · ${order.title}` : '工单详情'"
      closable
    >
      <div v-if="order" class="drawer-body">
        <div class="tag-row">
          <NTag size="small" :bordered="false" :type="workOrderStatusTagType(order.status)">
            {{ workOrderStatusLabels[order.status] }}
          </NTag>
          <NTag size="small" :bordered="false" :type="workOrderPriorityTagType(order.priority)">
            优先级 {{ workOrderPriorityLabels[order.priority] }}
          </NTag>
          <NTag size="small" :bordered="false">{{ workOrderSourceLabels[order.source] }}</NTag>
          <NTag size="small" :bordered="false">MOCK 模拟工单</NTag>
        </div>

        <p class="hint">{{ workOrderStatusHints[order.status] }}</p>

        <h3 class="section-title">基本信息</h3>
        <dl class="detail-list">
          <div><dt>工单编号</dt><dd>{{ order.code }}</dd></div>
          <div><dt>标题</dt><dd>{{ order.title }}</dd></div>
          <div>
            <dt>关联设备</dt>
            <dd>
              <button v-if="asset" type="button" class="link-btn" @click="openAssetDetail">
                {{ asset.code }} · {{ asset.name }}
              </button>
              <span v-else>设备不可用（{{ order.assetId }}）</span>
            </dd>
          </div>
          <div><dt>负责人</dt><dd>{{ order.assignee || "未指派" }}</dd></div>
          <div><dt>创建人 / 时间</dt><dd>{{ order.createdBy }} · {{ formatDateTime(order.createdAt) }}</dd></div>
          <div><dt>更新时间</dt><dd>{{ formatDateTime(order.history[order.history.length - 1]?.at ?? order.createdAt) }}</dd></div>
          <div><dt>症状描述</dt><dd>{{ order.symptom }}</dd></div>
          <div><dt>建议措施</dt><dd>{{ order.suggestion || "未提供" }}</dd></div>
        </dl>

        <h3 class="section-title">关联告警</h3>
        <div v-if="linkedAlarm" class="list-card">
          <div class="list-head">
            <strong>{{ linkedAlarm.title }}</strong>
            <NTag size="tiny" :bordered="false" :type="linkedAlarm.kind === 'production' ? 'warning' : 'success'">
              {{ alarmLevelLabels[linkedAlarm.level] }} · {{ alarmStatusLabels[linkedAlarm.status] }}
            </NTag>
          </div>
          <p>{{ linkedAlarm.detail }}</p>
          <small>{{ linkedAlarm.code }} · {{ formatDateTime(linkedAlarm.occurredAt) }}</small>
          <div class="inline-actions">
            <NButton
              size="tiny"
              secondary
              @click="router.push({ name: 'alarms', query: { alarmId: linkedAlarm.id } })"
            >
              查看告警
            </NButton>
          </div>
        </div>
        <p v-else class="empty">本工单未关联告警；缺失关联不会被自动补造。</p>

        <h3 class="section-title">证据列表（{{ evidenceItems.length }}）</h3>
        <div v-if="evidenceItems.length" class="evidence-list">
          <div v-for="item in evidenceItems" :key="item.id" class="evidence-block">
          <button
            type="button"
            class="evidence-item"
            :class="{ missing: item.missing }"
            @click="onEvidence(item)"
          >
            <span class="evidence-head">
              <NTag size="tiny" :bordered="false" :type="evidenceTagType(item.kind)">
                {{ evidenceKindLabel(item.kind) }}
              </NTag>
              <strong>{{ item.label }}</strong>
            </span>
            <small>{{ item.detail }}</small>
            <div v-if="expandedEvidenceId === item.id" class="evidence-detail">
              <p v-if="item.excerpt">{{ item.excerpt }}</p>
              <ul v-if="item.lines && item.lines.length">
                <li v-for="line in item.lines" :key="line">{{ line }}</li>
              </ul>
              <p v-if="item.note">摘要：{{ item.note }}</p>
              <p v-if="!item.excerpt && !(item.lines && item.lines.length)" class="empty">
                该证据暂无更多原文摘录。
              </p>
            </div>
          </button>
          <router-link v-if="item.kind==='balance' && !item.missing && expandedEvidenceId===item.id"
            class="balance-evidence-link" :to="{path:'/engineering/registry',query:{
              focus:'balance',pool:balancePoolId(item.id),caseId:item.id
            }}">查看原始单池核算与人工处置记录 →</router-link>
          </div>
        </div>
        <p v-else class="empty">无证据引用；系统不会为缺失证据补造原文。</p>

        <h3 class="section-title">触发快照</h3>
        <dl v-if="triggerSnapshot" class="detail-list">
          <div>
            <dt>时间范围</dt>
            <dd>{{ formatTimeRange(triggerSnapshot.rangeFrom, triggerSnapshot.rangeTo) }}</dd>
          </div>
          <div><dt>监测测点</dt><dd>{{ triggerPoint ? triggerPoint.label : triggerSnapshot.pointId }}</dd></div>
          <div>
            <dt>触发阈值</dt>
            <dd>
              {{ triggerSnapshot.threshold }} {{ triggerPoint?.unit ?? "" }}
              <span class="muted">（演示阈值，仅用于触发说明）</span>
            </dd>
          </div>
        </dl>
        <p v-else class="empty">本工单由手工或巡检创建，无趋势触发快照。</p>

        <template v-if="processingResult">
          <h3 class="section-title">处理结果</h3>
          <dl class="detail-list">
            <div><dt>原因</dt><dd>{{ processingResult.cause }}</dd></div>
            <div><dt>措施</dt><dd>{{ processingResult.measures }}</dd></div>
            <div><dt>材料</dt><dd>{{ processingResult.materials || "未填写" }}</dd></div>
            <div><dt>备注</dt><dd>{{ processingResult.note || "未填写" }}</dd></div>
            <div>
              <dt>提交</dt>
              <dd>{{ processingResult.submittedBy }} · {{ formatDateTime(processingResult.submittedAt) }}</dd>
            </div>
          </dl>
        </template>

        <template v-if="acceptance">
          <h3 class="section-title">验收记录</h3>
          <div class="list-card">
            <div class="list-head">
              <strong>{{ acceptance.accepted ? "验收通过" : "验收不通过" }}</strong>
              <NTag size="tiny" :bordered="false" :type="acceptance.accepted ? 'success' : 'error'">
                {{ formatDateTime(acceptance.at) }}
              </NTag>
            </div>
            <p>{{ acceptance.note || "未填写验收备注" }}</p>
            <small>验收人：{{ acceptance.by }}</small>
          </div>
        </template>

        <h3 class="section-title">处理历史（最新在前）</h3>
        <div v-if="history.length" class="timeline-list">
          <div v-for="(entry, index) in history" :key="`${entry.at}-${entry.action}-${index}`" class="timeline-item">
            <div class="timeline-head">
              <NTag size="tiny" :bordered="false">{{ workOrderHistoryLabels[entry.action] ?? entry.action }}</NTag>
              <small>{{ formatDateTime(entry.at) }}</small>
            </div>
            <p>{{ historyNote(entry.action, entry.note) }}</p>
            <small>操作人：{{ entry.by }}</small>
          </div>
        </div>
        <p v-else class="empty">暂无处理历史。</p>

        <div v-if="statusActions.length" class="action-panel">
          <h3 class="section-title">状态动作</h3>
          <div class="action-buttons">
            <NButton
              v-for="definition in statusActions"
              :key="definition.action"
              size="small"
              :type="definition.tone"
              :secondary="definition.tone === 'default'"
              :disabled="!can(store.role, definition.permission)"
              :title="can(store.role, definition.permission) ? definition.label : denialText(definition)"
              @click="begin(definition.action, definition)"
            >
              {{ definition.label }}
            </NButton>
          </div>
          <ul v-if="deniedActions.length" class="deny-list">
            <li v-for="definition in deniedActions" :key="`deny-${definition.action}`">
              {{ denialText(definition) }}
            </li>
          </ul>

          <div v-if="pendingAction" class="action-form">
            <strong>{{ actionFormTitle[pendingAction] ?? "执行状态动作" }}</strong>
            <NInput
              v-if="pendingAction === 'start'"
              v-model:value="form.assignee"
              placeholder="请输入负责人（如：运维人员·王工）"
            />
            <template v-if="pendingAction === 'complete'">
              <NInput
                v-model:value="form.cause"
                type="textarea"
                placeholder="故障 / 异常原因（必填）"
                :autosize="{ minRows: 2, maxRows: 4 }"
              />
              <NInput
                v-model:value="form.measures"
                type="textarea"
                placeholder="处理措施（必填）"
                :autosize="{ minRows: 2, maxRows: 4 }"
              />
              <NInput
                v-model:value="form.materials"
                placeholder="使用材料（可选，如：润滑脂、垫片）"
              />
              <NInput
                v-model:value="form.note"
                type="textarea"
                placeholder="补充备注（可选）"
                :autosize="{ minRows: 2, maxRows: 3 }"
              />
            </template>
            <NInput
              v-if="pendingAction === 'accept' || pendingAction === 'reject' || pendingAction === 'cancel'"
              v-model:value="form.note"
              type="textarea"
              :placeholder="notePlaceholder"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
            <p class="hint">{{ actionHint }}</p>
            <div class="form-actions">
              <NButton size="small" type="primary" @click="submitPending">
                确认{{ pendingActionLabel }}
              </NButton>
              <NButton size="small" @click="pendingAction = null">取消操作</NButton>
            </div>
            <p v-if="errorText" class="error-text">{{ errorText }}</p>
          </div>
        </div>

        <div v-if="justAccepted" class="accept-notice">
          已归档并写入设备履历。验收仅代表流程确认，不代表设备物理状态已恢复；关联告警不会自动关闭，须在原告警流程独立核查。系统不会自动修改健康分或历史监测数据。
        </div>

        <p class="notice">
          验收不等于物理状态恢复：本演示不会自动修改设备健康分、测点质量或历史监测数据。
        </p>
      </div>
      <p v-else class="empty">未找到该工单，可能已被场景复位或链接参数无效。</p>

      <template #footer>
        <div v-if="order" class="drawer-footer">
          <NButton v-if="order.status === 'archived' && linkedAlarm" type="primary"
            @click="goBackToSourceAlarm">到原事件复核恢复</NButton>
          <NButton v-if="order.status === 'archived'" secondary @click="openAssetTimeline">
            查看设备履历
          </NButton>
          <NButton v-else secondary @click="openAssetDetail">打开设备详情</NButton>
          <NButton @click="close">关闭</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.drawer-body {
  min-height: 320px;
}
.tag-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.hint {
  margin: 6px 0 10px;
  font-size: 12px;
  color: #70869a;
  line-height: 1.7;
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
  grid-template-columns: 96px minmax(0, 1fr);
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
.link-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: #247ba8;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.link-btn:hover {
  text-decoration: underline;
}
.list-card {
  border: 1px solid #e2edf4;
  border-radius: 8px;
  padding: 12px;
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
}
.inline-actions {
  margin-top: 8px;
}
.evidence-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.evidence-item {
  width: 100%;
  text-align: left;
  border: 1px solid #e0ecf4;
  border-radius: 8px;
  background: #fbfdff;
  padding: 10px 12px;
  cursor: pointer;
  color: inherit;
}
.evidence-item:hover {
  border-color: #9dc9dc;
}
.evidence-item.missing {
  border-style: dashed;
  border-color: #e6c2be;
  background: #fdf6f5;
}
.evidence-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.evidence-item small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #8296a8;
  line-height: 1.6;
}
.evidence-detail {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #dbe8f1;
}
.evidence-detail p {
  margin: 0 0 4px;
  font-size: 12px;
  color: #4e6578;
  line-height: 1.7;
}
.evidence-detail ul {
  margin: 0 0 4px;
  padding-left: 16px;
  font-size: 12px;
  color: #4e6578;
  line-height: 1.8;
}
.muted {
  color: #8ba0b2;
  font-size: 11px;
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
.action-panel {
  margin-top: 18px;
  padding-top: 4px;
  border-top: 1px dashed #dbe8f1;
}
.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.deny-list {
  margin: 8px 0 0;
  padding-left: 16px;
  font-size: 11px;
  color: #a06a1f;
  line-height: 1.8;
}
.action-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #e0ecf4;
  border-radius: 8px;
  background: #f8fcff;
}
.action-form strong {
  font-size: 13px;
  color: #1c3e57;
}
.action-form .hint {
  margin: 0;
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
.accept-notice {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid #bfe5d5;
  border-radius: 8px;
  background: #eefaf4;
  font-size: 12px;
  color: #2f7a63;
  line-height: 1.7;
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
  padding: 10px 0;
  margin: 0;
}
.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.evidence-block{display:grid;gap:6px;min-width:0}.evidence-block>.evidence-item{width:100%}
.balance-evidence-link{display:block;color:#207da3;font-size:12px;font-weight:650;text-decoration:none;padding:6px 11px 9px}
.balance-evidence-link:hover{text-decoration:underline}
</style>

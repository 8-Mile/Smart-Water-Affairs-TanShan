<script setup lang="ts">
import WorkspaceNav from "../components/WorkspaceNav.vue";
import AssetJourney from "../components/AssetJourney.vue";
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  NButton,
  NInput,
  NSelect,
  NTabPane,
  NTabs,
  NTag,
  useMessage,
} from "naive-ui";
import DocumentDetail from "../components/DocumentDetail.vue";
import {
  buildImportedDocument,
  formatFileSize,
  IMPORT_ACCEPT,
  IMPORT_NOTICE,
  isAcceptedImportFile,
  MAX_IMPORT_BYTES,
} from "../demo/documentImport";
import { can, roleNames } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import type {
  Asset,
  DataSource,
  DocumentRef,
  InspectionRecord,
  WorkOrder,
} from "../demo/types";

const route = useRoute();
const router = useRouter();
const store = useDemoStore();
const ui = useUiStore();
const message = useMessage();

const statusLabels: Record<string, string> = {
  running: "运行",
  stopped: "停机",
  fault: "故障",
  unknown: "未知",
};

const sourceLabels: Record<DataSource, string> = {
  MOCK: "模拟数据",
  REFERENCE: "资料引用",
  USER_ENTRY: "人工录入",
  CALCULATED: "规则计算",
};

const docKindLabels: Record<DocumentRef["kind"], string> = {
  manual: "说明书",
  procedure: "操作规程",
  "inspection-standard": "巡检标准",
  drawing: "图纸",
  certificate: "证书",
  case: "维修案例",
  other: "其他资料",
};

const workOrderStatusLabels: Record<WorkOrder["status"], string> = {
  draft: "草稿",
  pending_dispatch: "待派单",
  in_progress: "维修中",
  pending_acceptance: "待验收",
  archived: "已归档",
  cancelled: "已取消",
};

const DOC_CATEGORIES: { kind: DocumentRef["kind"]; label: string }[] = [
  { kind: "manual", label: "说明书" },
  { kind: "procedure", label: "规程" },
  { kind: "inspection-standard", label: "巡检标准" },
  { kind: "drawing", label: "图纸" },
  { kind: "case", label: "维修案例" },
  { kind: "other", label: "其他" },
];

function categoryOf(kind: DocumentRef["kind"]): DocumentRef["kind"] {
  return kind === "certificate" ? "other" : kind;
}

function queryString(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

const initialAssetId = (() => {
  const id = queryString("assetId");
  return id && store.getAsset(id) ? id : "";
})();

const archiveMode = computed(() => route.name === "archives");
const tab = ref("ledger");
watch(
  () => [route.name, route.query.tab],
  () => {
    tab.value = archiveMode.value
      ? queryString("tab") === "cases" ? "cases" : "documents"
      : queryString("tab") === "records" ? "records" : queryString("docId") || queryString("tab") === "documents" ? "documents" : "ledger";
    docReviewFilter.value = archiveMode.value && queryString("tab") === "review" ? "pending" : "all";
  },
);
const selectedAssetId = ref(initialAssetId);
const lockedAssetId = ref(initialAssetId);
const selectedDocId = ref<string | null>(queryString("docId") || null);

const expandedSubsystems = ref<string[]>(store.subsystems.map((item) => item.id));
const expandedAssets = ref<string[]>(initialAssetId ? [initialAssetId] : []);

const assetSearch = ref("");
const subsystemFilter = ref("all");
const statusFilter = ref("all");

const docSearch = ref("");
const docKindFilter = ref("all");
const docReviewFilter = ref(archiveMode.value && queryString("tab") === "review" ? "pending" : "all");
if (archiveMode.value) tab.value = queryString("tab") === "cases" ? "cases" : "documents";
else if (queryString("tab") === "records") tab.value = "records";
else if (queryString("docId") || queryString("tab") === "documents") tab.value = "documents";

const recordAssetFilter = ref(initialAssetId || "all");
const highlightedRecordId = ref<string | null>(null);

const fileInput = ref<HTMLInputElement | null>(null);

const statusOptions = [
  { label: "全部状态", value: "all" },
  { label: "运行", value: "running" },
  { label: "停机", value: "stopped" },
  { label: "故障", value: "fault" },
  { label: "未知", value: "unknown" },
];

const subsystemOptions = computed(() => [
  { label: "全部子系统", value: "all" },
  ...store.subsystems.map((item) => ({ label: item.name, value: item.id })),
]);

const docKindOptions = [
  { label: "全部类型", value: "all" },
  ...DOC_CATEGORIES.map((item) => ({ label: item.label, value: item.kind })),
];

const docReviewOptions = [
  { label: "全部审核状态", value: "all" },
  { label: "已审核", value: "reviewed" },
  { label: "未审核", value: "pending" },
];

const assetOptions = computed(() => [
  { label: "全部设备", value: "all" },
  ...store.assets.map((asset) => ({
    value: asset.id,
    label: `${asset.code} · ${asset.name}`,
  })),
]);

const selectedAsset = computed(() =>
  selectedAssetId.value ? store.getAsset(selectedAssetId.value) : undefined,
);

const treeNodes = computed(() =>
  store.subsystems.map((subsystem) => ({
    id: subsystem.id,
    name: subsystem.name,
    assets: store.assets
      .filter((asset) => asset.subsystemId === subsystem.id)
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code)),
  })),
);

const pointCountMap = computed(() => {
  const map = new Map<string, number>();
  for (const point of store.points) {
    map.set(point.assetId, (map.get(point.assetId) ?? 0) + 1);
  }
  return map;
});

const bindingSet = computed(
  () => new Set(store.bindings.map((binding) => binding.assetId)),
);

function hasBinding(assetId: string): boolean {
  return bindingSet.value.has(assetId);
}

function subsystemName(id: string): string {
  return store.subsystems.find((item) => item.id === id)?.name ?? `未知子系统（${id}）`;
}

function assetLabel(assetId: string): string {
  const asset = store.getAsset(assetId);
  return asset ? `${asset.code} · ${asset.name}` : `设备不可用（${assetId}）`;
}

function text(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "未提供";
  return String(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatAt(value?: string): string {
  if (!value) return "未提供";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function syncQuery(patch: Record<string, string | null>): void {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.query)) {
    if (typeof value === "string") query[key] = value;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!value) delete query[key];
    else query[key] = value;
  }
  void router.replace({ query });
}

function isLockedOther(assetId: string): boolean {
  return Boolean(lockedAssetId.value) && lockedAssetId.value !== assetId;
}

function setSelectedAsset(assetId: string): void {
  selectedAssetId.value = assetId;
  recordAssetFilter.value = assetId || "all";
  if (assetId) {
    const asset = store.getAsset(assetId);
    if (asset && !expandedSubsystems.value.includes(asset.subsystemId)) {
      expandedSubsystems.value = [...expandedSubsystems.value, asset.subsystemId];
    }
    if (!expandedAssets.value.includes(assetId)) {
      expandedAssets.value = [...expandedAssets.value, assetId];
    }
  }
  syncQuery({ assetId: assetId || null });
}

function unlockAsset(): void {
  if (!lockedAssetId.value) return;
  lockedAssetId.value = "";
  message.info("已解除链接设备锁定，可切换其他设备；当前 assetId 仍保留为筛选上下文。");
}

function toggleSubsystem(id: string): void {
  expandedSubsystems.value = expandedSubsystems.value.includes(id)
    ? expandedSubsystems.value.filter((item) => item !== id)
    : [...expandedSubsystems.value, id];
}

function toggleAsset(id: string): void {
  expandedAssets.value = expandedAssets.value.includes(id)
    ? expandedAssets.value.filter((item) => item !== id)
    : [...expandedAssets.value, id];
}

function onTreeAsset(asset: Asset): void {
  if (isLockedOther(asset.id)) {
    message.info(`页面由链接锁定设备 ${lockedAssetId.value}，请先解除锁定再切换。`);
    return;
  }
  setSelectedAsset(asset.id);
  if (!expandedAssets.value.includes(asset.id)) {
    expandedAssets.value = [...expandedAssets.value, asset.id];
  }
}

function docCountFor(assetId: string, kind: DocumentRef["kind"]): number {
  return store.documents.filter(
    (doc) => doc.assetIds.includes(assetId) && categoryOf(doc.kind) === kind,
  ).length;
}

function docTotalFor(assetId: string): number {
  return store.documents.filter((doc) => doc.assetIds.includes(assetId)).length;
}

function selectCategory(assetId: string, kind: DocumentRef["kind"]): void {
  if (isLockedOther(assetId)) {
    message.info(`页面由链接锁定设备 ${lockedAssetId.value}，请先解除锁定再切换。`);
    return;
  }
  setSelectedAsset(assetId);
  docKindFilter.value = kind;
  tab.value = "documents";
  highlightedRecordId.value = null;
}

function showAllAssets(): void {
  if (lockedAssetId.value) {
    message.info(`页面由链接锁定设备 ${lockedAssetId.value}，请先解除锁定再查看全部设备。`);
    return;
  }
  selectedAssetId.value = "";
  selectedDocId.value = null;
  docKindFilter.value = "all";
  docSearch.value = "";
  subsystemFilter.value = "all";
  statusFilter.value = "all";
  assetSearch.value = "";
  recordAssetFilter.value = "all";
  tab.value = archiveMode.value ? "documents" : "ledger";
  syncQuery({ assetId: null, docId: null });
}

function onSubsystemFilter(value: string | number | null): void {
  subsystemFilter.value = typeof value === "string" ? value : "all";
}

function onStatusFilter(value: string | number | null): void {
  statusFilter.value = typeof value === "string" ? value : "all";
}

function onDocKindFilter(value: string | number | null): void {
  docKindFilter.value = typeof value === "string" ? value : "all";
}

function onDocReviewFilter(value: string | number | null): void {
  docReviewFilter.value = typeof value === "string" ? value : "all";
}

function onRecordAssetFilter(value: string | number | null): void {
  recordAssetFilter.value = typeof value === "string" ? value : "all";
}

function assetSearchScore(asset: Asset, keyword: string): number {
  if (!keyword) return 0;
  const code = asset.code.toLowerCase();
  const name = asset.name.toLowerCase();
  if (code === keyword) return 0;
  if (code.startsWith(keyword)) return 1;
  if (code.includes(keyword)) return 2;
  if (name.includes(keyword)) return 3;
  return 99;
}

const filteredAssets = computed(() => {
  const keyword = assetSearch.value.trim().toLowerCase();
  return store.assets
    .filter((asset) => subsystemFilter.value === "all" || asset.subsystemId === subsystemFilter.value)
    .filter((asset) => statusFilter.value === "all" || asset.status === statusFilter.value)
    .map((asset) => ({ asset, score: assetSearchScore(asset, keyword) }))
    .filter((item) => item.score < 99)
    .slice()
    .sort(
      (a, b) =>
        a.score - b.score || a.asset.code.localeCompare(b.asset.code),
    )
    .map((item) => item.asset);
});

const canCreateAsset = computed(() => can(store.role, "asset:create"));
const createDeny = computed(
  () => `角色「${roleNames[store.role]}」无权新增设备（需要 asset:create 权限，仅系统管理员）。`,
);

function openAssetRow(asset: Asset): void {
  ui.openAsset(asset.id);
  if (!isLockedOther(asset.id)) setSelectedAsset(asset.id);
}

function createAssetWithAi(): void {
  if (!canCreateAsset.value) {
    message.warning(createDeny.value);
    return;
  }
  const subsystemId =
    subsystemFilter.value !== "all"
      ? subsystemFilter.value
      : selectedAsset.value?.subsystemId ?? store.subsystems[0]?.id;
  if (!subsystemId) {
    message.warning("缺少可用的工艺子系统，无法发起 AI 建档。");
    return;
  }
  ui.openAi({ subsystemId }, `在「${subsystemName(subsystemId)}」中新增设备`);
}

function assetDocNames(assetIds: string[]): string {
  return assetIds
    .map((id) => {
      const asset = store.getAsset(id);
      return asset ? `${asset.code} ${asset.name}` : id;
    })
    .join(" ");
}

const filteredDocuments = computed(() => {
  const keyword = docSearch.value.trim().toLowerCase();
  return store.documents
    .filter((doc) => !selectedAssetId.value || doc.assetIds.includes(selectedAssetId.value))
    .filter((doc) => docKindFilter.value === "all" || categoryOf(doc.kind) === docKindFilter.value)
    .filter((doc) =>
      docReviewFilter.value === "all"
        ? true
        : docReviewFilter.value === "reviewed"
          ? doc.reviewed
          : !doc.reviewed,
    )
    .filter((doc) => {
      if (!keyword) return true;
      return [doc.id, doc.title, doc.summary ?? "", doc.contentExcerpt ?? "", assetDocNames(doc.assetIds)]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    })
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.title.localeCompare(b.title),
    );
});

interface DocUsage {
  workorders: WorkOrder[];
  inspections: InspectionRecord[];
  count: number;
}

function usageOf(docId: string): DocUsage {
  const workorders = store.workorders.filter((order) => order.evidenceIds.includes(docId));
  const inspections = store.inspections.filter((record) =>
    record.attachmentRefs?.includes(docId),
  );
  return { workorders, inspections, count: workorders.length + inspections.length };
}

const usageMap = computed(() => {
  const map = new Map<string, DocUsage>();
  for (const doc of store.documents) map.set(doc.id, usageOf(doc.id));
  return map;
});

function usageCount(docId: string): number {
  return usageMap.value.get(docId)?.count ?? 0;
}

function usageBreakdown(docId: string): string {
  const usage = usageMap.value.get(docId);
  return usage ? `工单 ${usage.workorders.length} · 巡检 ${usage.inspections.length}` : "工单 0 · 巡检 0";
}

const removedWithRefs = computed(() =>
  store.userState.removedDocumentIds
    .map((id) => ({ id, usage: usageOf(id) }))
    .filter((item) => item.usage.count > 0),
);

function openDocument(id: string): void {
  selectedDocId.value = id;
  tab.value = "documents";
  syncQuery({ docId: id });
}

function closeDocument(): void {
  selectedDocId.value = null;
  syncQuery({ docId: null });
}

function onDocumentDeleted(): void {
  // 保留 docId，让右侧详情继续展示“原文不可用”而不是静默消失。
}

const canAttach = computed(() => can(store.role, "document:attach"));
const attachDeny = computed(
  () => `角色「${roleNames[store.role]}」无权导入或删除档案（需要 document:attach 权限）。`,
);

function triggerImport(): void {
  if (!canAttach.value) {
    message.warning(attachDeny.value);
    return;
  }
  fileInput.value?.click();
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (!isAcceptedImportFile(file.name)) {
      message.warning("仅支持 .json / .txt / .md / .csv 文本文件，PDF/DOCX 暂不支持全文索引。");
      return;
    }
    const imported = await buildImportedDocument(file, {
      assetId: selectedAssetId.value || undefined,
      updatedAt: store.seed.referenceTime,
      existingIds: store.documents.map((doc) => doc.id),
    });
    store.importDocument(imported.document);
    selectedDocId.value = imported.document.id;
    tab.value = "documents";
    syncQuery({ docId: imported.document.id });
    if (imported.oversized) {
      message.warning(
        `文件 ${formatFileSize(file.size)} 超过 ${MAX_IMPORT_BYTES / 1024}KB，已仅记录元信息，未读取全文。`,
      );
    } else {
      message.success(`已导入「${file.name}」，正文按前 2000 字截取并保存到本地。`);
    }
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    input.value = "";
  }
}

const inspectionRows = computed(() =>
  store.inspections
    .filter((record) => recordAssetFilter.value === "all" || record.assetId === recordAssetFilter.value)
    .slice()
    .sort((a, b) => Date.parse(b.inspectedAt) - Date.parse(a.inspectedAt)),
);

const maintenanceRows = computed(() =>
  store.maintenance
    .filter((record) => recordAssetFilter.value === "all" || record.assetId === recordAssetFilter.value)
    .slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
);

function abnormalSummary(record: InspectionRecord): string {
  const abnormal = record.items.filter((item) => item.abnormal);
  if (!abnormal.length) return "检查项均无异常";
  return abnormal.map((item) => `${item.label}：${item.value}`).join("；");
}

function locateAsset(assetId: string): void {
  if (!store.getAsset(assetId)) {
    message.warning(`设备 ${assetId} 不存在或已退役，无法定位。`);
    return;
  }
  ui.openAsset(assetId);
  if (!isLockedOther(assetId)) setSelectedAsset(assetId);
}

function documentExists(docId: string): boolean {
  return store.documents.some((doc) => doc.id === docId);
}

const acceptedOrders = computed(() =>
  store.workorders
    .filter((order) => order.status === "archived" || order.acceptance?.accepted === true)
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.acceptance?.at ?? b.createdAt) - Date.parse(a.acceptance?.at ?? a.createdAt),
    ),
);

interface EvidenceInfo {
  id: string;
  kind: "document" | "inspection" | "alarm" | "workorder" | "unknown";
  label: string;
  unavailable: boolean;
}

function evidenceInfo(evidenceId: string): EvidenceInfo {
  const doc = store.documents.find((item) => item.id === evidenceId);
  if (doc) {
    return { id: evidenceId, kind: "document", label: `档案 · ${doc.title}`, unavailable: false };
  }
  if (store.userState.removedDocumentIds.includes(evidenceId)) {
    return { id: evidenceId, kind: "document", label: "档案 · 原文不可用", unavailable: true };
  }
  const inspection = store.inspections.find((item) => item.id === evidenceId);
  if (inspection) {
    return { id: evidenceId, kind: "inspection", label: `巡检 · ${evidenceId}`, unavailable: false };
  }
  const alarm = store.alarms.find((item) => item.id === evidenceId);
  if (alarm) {
    return { id: evidenceId, kind: "alarm", label: `告警 · ${alarm.title}`, unavailable: false };
  }
  const order = store.workorders.find(
    (item) => item.id === evidenceId || item.code === evidenceId,
  );
  if (order) {
    return { id: evidenceId, kind: "workorder", label: `工单 · ${order.code}`, unavailable: false };
  }
  return { id: evidenceId, kind: "unknown", label: `未注册证据 · ${evidenceId}`, unavailable: true };
}

const caseRows = computed(() =>
  acceptedOrders.value.map((order) => ({
    order,
    assetLabel: assetLabel(order.assetId),
    evidence: order.evidenceIds.map((id) => evidenceInfo(id)),
  })),
);

function focusEvidence(info: EvidenceInfo): void {
  if (info.kind === "document" && !info.unavailable) {
    openDocument(info.id);
    return;
  }
  if (info.kind === "document") {
    tab.value = "documents";
    selectedDocId.value = info.id;
    syncQuery({ docId: info.id });
    message.warning("该档案原文不可用（已删除引用），历史工单证据 ID 仍保留。");
    return;
  }
  if (info.kind === "inspection") {
    const record = store.inspections.find((item) => item.id === info.id);
    tab.value = "records";
    if (record) {
      recordAssetFilter.value = record.assetId;
      highlightedRecordId.value = record.id;
    }
    message.info(`已定位巡检记录 ${info.id}。`);
    return;
  }
  if (info.kind === "alarm") {
    const alarm = store.alarms.find((item) => item.id === info.id);
    if (alarm) locateAsset(alarm.assetId);
    else message.warning("该告警未注册，无法定位设备。");
    return;
  }
  if (info.kind === "workorder") {
    const order = store.workorders.find(
      (item) => item.id === info.id || item.code === info.id,
    );
    if (order) locateAsset(order.assetId);
    else message.warning("该工单未注册，无法定位设备。");
    return;
  }
  message.warning("该证据未注册原文，无法精确定位。");
}

const selectedAssetDocCount = computed(() =>
  selectedAssetId.value
    ? store.documents.filter((doc) => doc.assetIds.includes(selectedAssetId.value)).length
    : 0,
);

watch(
  () => route.query.docId,
  (value) => {
    const id = typeof value === "string" ? value : null;
    if (id !== selectedDocId.value) selectedDocId.value = id;
    if (id) tab.value = "documents";
  },
);

watch(
  () => route.query.assetId,
  (value) => {
    const id = typeof value === "string" ? value : "";
    if (id === selectedAssetId.value) return;
    if (id && store.getAsset(id)) {
      selectedAssetId.value = id;
      lockedAssetId.value = id;
      recordAssetFilter.value = id;
      if (!expandedAssets.value.includes(id)) expandedAssets.value = [...expandedAssets.value, id];
      return;
    }
    if (!id) {
      selectedAssetId.value = "";
      lockedAssetId.value = "";
      recordAssetFilter.value = "all";
    }
  },
);
</script>

<template>
  <div class="assets-page">
    <AssetJourney v-if="selectedAssetId" :asset-id="selectedAssetId" />
    <WorkspaceNav label="设备与档案" :items="[{name:'设备台账与履历',to:'/operations/assets'},{name:'档案与案例',to:'/archives'}]" />
    <aside class="panel tree-panel">
      <div class="panel-head compact">
        <div>
          <h2>{{ archiveMode ? "资料范围" : "设备目录" }}</h2>
          <p>{{ store.assets.length }} 台设备 · {{ store.documents.length }} 份档案</p>
        </div>
      </div>

      <button
        type="button"
        class="tree-root"
        :class="{ active: !selectedAssetId }"
        @click="showAllAssets"
      >
        <span>{{ archiveMode ? "全部资料" : "设备台账" }}</span>
        <small>清除设备筛选</small>
      </button>

      <div class="tree">
        <div v-for="node in treeNodes" :key="node.id" class="tree-node">
          <button type="button" class="tree-toggle" @click="toggleSubsystem(node.id)">
            <span class="caret">{{ expandedSubsystems.includes(node.id) ? "▾" : "▸" }}</span>
            <strong>{{ node.name }}</strong>
            <small>{{ node.assets.length }}</small>
          </button>

          <div v-if="expandedSubsystems.includes(node.id)" class="tree-children">
            <div v-for="asset in node.assets" :key="asset.id" class="tree-asset">
              <div class="tree-asset-row" :class="{ active: selectedAssetId === asset.id }">
                <button
                  type="button"
                  class="asset-toggle"
                  :aria-label="`展开 ${asset.code} 的资料类别`"
                  @click="toggleAsset(asset.id)"
                >
                  {{ expandedAssets.includes(asset.id) ? "▾" : "▸" }}
                </button>
                <button type="button" class="asset-select" @click="onTreeAsset(asset)">
                  <span class="asset-code">{{ asset.code }}</span>
                  <span class="asset-name">{{ asset.name }}</span>
                  <span v-if="!hasBinding(asset.id)" class="unplaced">未布置</span>
                </button>
              </div>

              <div v-if="expandedAssets.includes(asset.id)" class="tree-doc-cats">
                <button
                  v-for="category in DOC_CATEGORIES"
                  :key="category.kind"
                  type="button"
                  class="doc-cat"
                  :class="{
                    active:
                      selectedAssetId === asset.id && docKindFilter === category.kind,
                  }"
                  @click="selectCategory(asset.id, category.kind)"
                >
                  <span>{{ category.label }}</span>
                  <small>{{ docCountFor(asset.id, category.kind) }}</small>
                </button>
                <p class="cat-total">档案合计 {{ docTotalFor(asset.id) }} 份</p>
              </div>
            </div>
            <p v-if="!node.assets.length" class="tree-empty">该子系统暂无设备。</p>
          </div>
        </div>
      </div>

      <p class="tree-hint">
        资料类别含说明书 / 规程 / 巡检标准 / 图纸 / 维修案例 / 其他；计数来自当前场景档案。
      </p>
    </aside>

    <section class="panel main-panel">
      <nav v-if="archiveMode" class="filter-bar" aria-label="档案入口">
        <RouterLink :to="{ name: 'archives' }">全部资料</RouterLink>
        <RouterLink :to="{ name: 'archives', query: { tab: 'review' } }">待审核</RouterLink>
      </nav>
      <NTabs v-model:value="tab" type="line" size="small" animated>
        <NTabPane v-if="!archiveMode" name="ledger" tab="设备台账">
          <div class="filter-bar">
            <NInput
              v-model:value="assetSearch"
              placeholder="搜索设备编号或名称"
              clearable
              style="width: 200px"
            />
            <NSelect
              :value="subsystemFilter"
              :options="subsystemOptions"
              style="width: 140px"
              @update:value="onSubsystemFilter"
            />
            <NSelect
              :value="statusFilter"
              :options="statusOptions"
              style="width: 118px"
              @update:value="onStatusFilter"
            />
            <span class="result-count">共 {{ filteredAssets.length }} 台</span>
            <NButton
              type="primary"
              size="small"
              :disabled="!canCreateAsset"
              :title="canCreateAsset ? '通过 AI 配置向导新增设备' : createDeny"
              @click="createAssetWithAi"
            >
              新增设备
            </NButton>
          </div>
          <p class="hint">
            新增设备由 AI 配置向导完成（仅管理员），本页只提供入口，不直接写入设备主数据。
          </p>
          <p v-if="!canCreateAsset" class="deny-hint">{{ createDeny }}</p>

          <div v-if="filteredAssets.length" class="table-wrap">
            <table class="data-table asset-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>子系统</th>
                  <th>状态</th>
                  <th>测点数</th>
                  <th>负责人</th>
                  <th>已布置</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="asset in filteredAssets"
                  :key="asset.id"
                  class="clickable"
                  :class="{ selected: selectedAssetId === asset.id }"
                  tabindex="0"
                  @click="openAssetRow(asset)"
                  @keydown.enter="openAssetRow(asset)"
                >
                  <td class="mono">{{ asset.code }}</td>
                  <td class="title-cell">
                    {{ asset.name }}
                    <NTag v-if="asset.archived" size="tiny" :bordered="false">已退役</NTag>
                  </td>
                  <td>{{ text(asset.type) }}</td>
                  <td>{{ subsystemName(asset.subsystemId) }}</td>
                  <td>
                    <NTag
                      size="tiny"
                      :bordered="false"
                      :type="asset.status === 'fault' ? 'error' : asset.status === 'running' ? 'success' : 'default'"
                    >
                      {{ statusLabels[asset.status] ?? asset.status }}
                    </NTag>
                  </td>
                  <td>{{ pointCountMap.get(asset.id) ?? 0 }}</td>
                  <td>{{ text(asset.owner) }}</td>
                  <td>
                    <NTag
                      size="tiny"
                      :bordered="false"
                      :type="hasBinding(asset.id) ? 'success' : 'warning'"
                    >
                      {{ hasBinding(asset.id) ? "已布置" : "未布置" }}
                    </NTag>
                  </td>
                  <td>{{ sourceLabels[asset.source] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty">
            没有匹配的设备。请调整搜索关键词、子系统或状态筛选；未布置设备也会出现在台账中。
          </p>
        </NTabPane>

        <NTabPane name="documents" tab="资料库">
          <div class="filter-bar">
            <NInput
              v-model:value="docSearch"
              placeholder="搜索档案标题或摘录"
              clearable
              style="width: 190px"
            />
            <NSelect
              :value="docKindFilter"
              :options="docKindOptions"
              style="width: 132px"
              @update:value="onDocKindFilter"
            />
            <NSelect
              :value="docReviewFilter"
              :options="docReviewOptions"
              style="width: 132px"
              @update:value="onDocReviewFilter"
            />
            <span class="result-count">共 {{ filteredDocuments.length }} 份</span>
            <NButton
              size="small"
              :disabled="!canAttach"
              :title="canAttach ? '导入本地文本档案' : attachDeny"
              @click="triggerImport"
            >
              导入档案
            </NButton>
            <input
              ref="fileInput"
              class="file-input"
              type="file"
              :accept="IMPORT_ACCEPT"
              data-testid="document-import-input"
              @change="onFilePicked"
            />
          </div>
          <p class="hint">{{ IMPORT_NOTICE }}</p>
          <p v-if="!canAttach" class="deny-hint">{{ attachDeny }}</p>
          <p v-if="selectedAssetId" class="scope-hint">
            当前按设备 {{ assetLabel(selectedAssetId) }} 过滤档案，可点击左侧「设备台账」查看全部。
          </p>

          <div v-if="filteredDocuments.length" class="table-wrap">
            <table class="data-table doc-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>类型</th>
                  <th>归属设备</th>
                  <th>版本</th>
                  <th>审核状态</th>
                  <th>来源</th>
                  <th>更新时间</th>
                  <th>被引用</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="doc in filteredDocuments"
                  :key="doc.id"
                  class="clickable"
                  :class="{ selected: selectedDocId === doc.id }"
                  @click="openDocument(doc.id)"
                >
                  <td class="title-cell">
                    <strong>{{ doc.title }}</strong>
                    <small class="mono block">{{ doc.id }}</small>
                  </td>
                  <td>{{ docKindLabels[doc.kind] ?? doc.kind }}</td>
                  <td>
                    <template v-if="doc.assetIds.length">
                      {{ doc.assetIds.map((id) => assetLabel(id)).join("；") }}
                    </template>
                    <span v-else class="muted">未关联设备</span>
                  </td>
                  <td>{{ doc.version }}</td>
                  <td>
                    <NTag size="tiny" :bordered="false" :type="doc.reviewed ? 'success' : 'warning'">
                      {{ doc.reviewed ? "已审核" : "未审核" }}
                    </NTag>
                  </td>
                  <td>
                    <NTag size="tiny" :bordered="false" type="info">
                      {{ doc.sourceLabel || (doc.source === "demo" ? "DEMO模拟档案" : "用户导入") }}
                    </NTag>
                  </td>
                  <td>{{ formatAt(doc.updatedAt) }}</td>
                  <td :title="usageBreakdown(doc.id)">
                    {{ usageCount(doc.id) }}
                    <small class="block muted">{{ usageBreakdown(doc.id) }}</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty">
            当前筛选下没有档案。可清除搜索 / 类型 / 审核筛选，或导入本地文本文件。
          </p>

          <div v-if="removedWithRefs.length" class="removed-block">
            <h3>已删除但仍被引用的档案</h3>
            <p class="hint">
              历史工单 evidenceIds 保留这些 ID；原文不可用，也不会自动补造内容。
            </p>
            <button
              v-for="row in removedWithRefs"
              :key="row.id"
              type="button"
              class="removed-row"
              @click="openDocument(row.id)"
            >
              <NTag size="tiny" type="error" :bordered="false">原文不可用</NTag>
              <span class="mono">{{ row.id }}</span>
              <small>
                工单引用 {{ row.usage.workorders.length }} 次 · 巡检引用
                {{ row.usage.inspections.length }} 次
              </small>
            </button>
          </div>
        </NTabPane>

        <NTabPane v-if="!archiveMode" name="records" tab="巡检与维修">
          <div class="filter-bar">
            <NSelect
              :value="recordAssetFilter"
              :options="assetOptions"
              style="width: 240px"
              @update:value="onRecordAssetFilter"
            />
            <span class="result-count">
              巡检 {{ inspectionRows.length }} 条 · 维护 {{ maintenanceRows.length }} 条
            </span>
          </div>
          <p class="hint">点击记录定位到对应设备抽屉；缺失记录不等于设备正常。</p>

          <h3 class="section-title">巡检记录</h3>
          <div v-if="inspectionRows.length" class="table-wrap">
            <table class="data-table record-table">
              <thead>
                <tr>
                  <th>巡检时间</th>
                  <th>设备</th>
                  <th>巡检人</th>
                  <th>结果</th>
                  <th>异常项</th>
                  <th>备注</th>
                  <th>附件引用</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="record in inspectionRows"
                  :key="record.id"
                  class="clickable"
                  :class="{ selected: highlightedRecordId === record.id }"
                  @click="locateAsset(record.assetId)"
                >
                  <td>{{ formatAt(record.inspectedAt) }}</td>
                  <td>{{ assetLabel(record.assetId) }}</td>
                  <td>{{ record.inspector }}</td>
                  <td>
                    <NTag size="tiny" :bordered="false" :type="record.result === 'normal' ? 'success' : 'warning'">
                      {{ record.result === "normal" ? "正常" : "异常" }}
                    </NTag>
                  </td>
                  <td>{{ abnormalSummary(record) }}</td>
                  <td>{{ record.note || "未提供" }}</td>
                  <td>
                    <template v-if="record.attachmentRefs?.length">
                      <template v-for="refId in record.attachmentRefs" :key="refId">
                        <button
                          v-if="documentExists(refId)"
                          type="button"
                          class="link-chip"
                          @click.stop="openDocument(refId)"
                        >
                          {{ refId }}
                        </button>
                        <NTag v-else size="tiny" type="error" :bordered="false" @click.stop>
                          原文不可用
                        </NTag>
                      </template>
                    </template>
                    <span v-else class="muted">无附件引用</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty">当前设备筛选下没有巡检记录。</p>

          <h3 class="section-title">维护记录</h3>
          <div v-if="maintenanceRows.length" class="table-wrap">
            <table class="data-table maintenance-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>设备</th>
                  <th>类别</th>
                  <th>处理摘要</th>
                  <th>材料</th>
                  <th>关联工单</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="record in maintenanceRows"
                  :key="record.id"
                  class="clickable"
                  @click="locateAsset(record.assetId)"
                >
                  <td>{{ formatAt(record.at) }}</td>
                  <td>{{ assetLabel(record.assetId) }}</td>
                  <td>{{ record.kind === "repair" ? "维修" : "保养" }}</td>
                  <td>{{ record.summary }}</td>
                  <td>{{ record.materials || "未提供" }}</td>
                  <td>{{ record.workOrderId || "无" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty">当前设备筛选下没有维护记录，缺失不等于无需维护。</p>
        </NTabPane>

        <NTabPane name="cases" v-if="archiveMode" tab="运维案例">
          <p class="case-notice">
            案例可被建议检索，不等于故障概率。此处仅汇总已验收工单及其证据 ID，不预测寿命或故障可能性。
          </p>
          <div v-if="caseRows.length" class="case-list">
            <article v-for="row in caseRows" :key="row.order.id" class="case-card">
              <div class="case-head">
                <div class="case-title">
                  <strong>{{ row.order.code }} · {{ row.order.title }}</strong>
                  <small>
                    {{ row.assetLabel }} · 验收 {{ formatAt(row.order.acceptance?.at) }} ·
                    {{ row.order.acceptance?.by || "未提供验收人" }}
                  </small>
                </div>
                <NTag size="tiny" type="success" :bordered="false">已验收归档</NTag>
              </div>
              <p v-if="row.order.result" class="case-result">
                <strong>原因：</strong>{{ row.order.result.cause }}
                <br />
                <strong>措施：</strong>{{ row.order.result.measures }}
              </p>
              <p v-else class="muted">该工单缺少验收处理结果，无法生成案例摘要。</p>

              <div class="evidence-row">
                <span class="evidence-label">证据 ID：</span>
                <template v-if="row.evidence.length">
                  <button
                    v-for="item in row.evidence"
                    :key="item.id"
                    type="button"
                    class="evidence-chip"
                    :class="{ unavailable: item.unavailable }"
                    @click="focusEvidence(item)"
                  >
                    <span>{{ item.label }}</span>
                    <small v-if="item.unavailable">原文不可用</small>
                    <small v-else>{{ item.id }}</small>
                  </button>
                </template>
                <span v-else class="muted">无证据引用</span>
              </div>

              <div class="case-actions">
                <NButton size="tiny" secondary @click="locateAsset(row.order.assetId)">
                  定位设备
                </NButton>
                <span class="muted">
                  工单状态：{{ workOrderStatusLabels[row.order.status] }} · 证据
                  {{ row.order.evidenceIds.length }} 项
                </span>
              </div>
            </article>
          </div>
          <p v-else class="empty">
            当前没有已验收工单。工单验收归档后才会进入案例库，未验收或已取消工单不在此展示。
          </p>
        </NTabPane>
      </NTabs>
    </section>

    <aside class="panel right-panel">
      <div class="panel-head compact">
        <div>
          <h2>详情预览</h2>
          <p>{{ selectedDocId ? "档案详情与引用" : "当前设备上下文" }}</p>
        </div>
        <NButton v-if="selectedDocId" size="tiny" quaternary @click="closeDocument">
          关闭
        </NButton>
      </div>

      <DocumentDetail
        v-if="selectedDocId"
        :doc-id="selectedDocId"
        @deleted="onDocumentDeleted"
      />

      <div v-else-if="selectedAsset" class="asset-preview">
        <h3>{{ selectedAsset.code }} · {{ selectedAsset.name }}</h3>
        <div class="tag-row">
          <NTag size="tiny" :bordered="false" type="info">
            {{ subsystemName(selectedAsset.subsystemId) }}
          </NTag>
          <NTag
            size="tiny"
            :bordered="false"
            :type="selectedAsset.status === 'fault' ? 'error' : selectedAsset.status === 'running' ? 'success' : 'default'"
          >
            {{ statusLabels[selectedAsset.status] ?? selectedAsset.status }}
          </NTag>
          <NTag
            size="tiny"
            :bordered="false"
            :type="hasBinding(selectedAsset.id) ? 'success' : 'warning'"
          >
            {{ hasBinding(selectedAsset.id) ? "已布置" : "未布置" }}
          </NTag>
        </div>
        <dl class="mini-list">
          <div><dt>设备类型</dt><dd>{{ text(selectedAsset.type) }}</dd></div>
          <div><dt>测点数</dt><dd>{{ pointCountMap.get(selectedAsset.id) ?? 0 }}</dd></div>
          <div><dt>负责人</dt><dd>{{ text(selectedAsset.owner) }}</dd></div>
          <div><dt>关联档案</dt><dd>{{ selectedAssetDocCount }} 份</dd></div>
        </dl>
        <p class="muted">
          点击左侧资料类别或中间档案列表，可在此查看版本、审核、来源、摘录与引用位置。
        </p>
        <div class="preview-actions">
          <NButton size="small" @click="ui.openAsset(selectedAsset.id)">打开设备详情</NButton>
          <NButton v-if="lockedAssetId" size="small" secondary @click="unlockAsset">
            解除锁定
          </NButton>
        </div>
        <p v-if="lockedAssetId" class="lock-hint">
          当前设备由 URL 参数 assetId 锁定，切换其他设备前请先解除锁定。
        </p>
      </div>

      <div v-else class="empty-preview">
        <h3>详情预览</h3>
        <p>从左侧导航选择设备与资料类别，或在「档案资料」中点击一条档案。</p>
        <p class="muted">
          档案详情会展示 documentId、版本、审核状态、来源、关联设备，以及被哪些工单 / 巡检引用。
        </p>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.assets-page > .asset-journey,
.assets-page > .workspace-nav {
  grid-column: 1 / -1;
  margin-bottom: 0;
}
.assets-page {
  display: grid;
  grid-template-columns: minmax(198px, 22fr) minmax(0, 50fr) minmax(258px, 28fr);
  gap: 14px;
  align-items: start;
  min-width: 0;
}
.panel {
  min-width: 0;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  color: #1c3e57;
}
.panel-head p {
  margin: 4px 0 0;
  font-size: 11px;
  color: #748a9d;
}
.panel-head.compact {
  margin-bottom: 8px;
}
.tree-panel,
.right-panel {
  position: sticky;
  top: 88px;
  max-height: calc(100vh - 112px);
  overflow: auto;
}
.tree-root {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 8px;
  border: 1px solid #d9e9f3;
  border-radius: 8px;
  background: linear-gradient(135deg, #f4fbff, #eef8f5);
  text-align: left;
  cursor: pointer;
  color: #1c5678;
}
.tree-root small {
  font-size: 10px;
  color: #8296a8;
}
.tree-root.active {
  border-color: #9ccfe8;
  box-shadow: inset 2px 0 0 #247ba8;
}
.tree-node {
  margin-bottom: 2px;
}
.tree-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #2d4d66;
}
.tree-toggle:hover {
  background: #edf6fb;
}
.tree-toggle strong {
  font-size: 12px;
  font-weight: 600;
}
.tree-toggle small {
  margin-left: auto;
  font-size: 10px;
  color: #8ba0b2;
}
.caret {
  width: 12px;
  font-size: 10px;
  color: #8ba0b2;
}
.tree-children {
  margin-left: 10px;
  padding-left: 6px;
  border-left: 1px dashed #d4e5ef;
}
.tree-asset-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 6px;
}
.tree-asset-row:hover,
.tree-asset-row.active {
  background: #eaf5fc;
}
.asset-toggle {
  flex-shrink: 0;
  width: 16px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  font-size: 9px;
  color: #8ba0b2;
  cursor: pointer;
}
.asset-select {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  padding: 5px 4px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #33526b;
}
.asset-code {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #247ba8;
}
.asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
}
.unplaced {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 999px;
  background: #fdf1da;
  border: 1px solid #f0d6a4;
  color: #a06a1f;
  font-size: 9px;
}
.tree-doc-cats {
  margin: 2px 0 6px 22px;
  padding-left: 6px;
  border-left: 1px solid #e0edf5;
}
.doc-cat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  font-size: 11px;
  color: #5d7387;
  text-align: left;
  cursor: pointer;
}
.doc-cat:hover {
  background: #f1f8fc;
}
.doc-cat.active {
  background: #e2f1fb;
  color: #17628f;
  font-weight: 600;
}
.doc-cat small {
  font-size: 10px;
  color: #8ba0b2;
}
.cat-total {
  margin: 3px 0 0;
  padding-left: 6px;
  font-size: 10px;
  color: #9aacbc;
}
.tree-empty {
  margin: 4px 6px;
  font-size: 11px;
  color: #9aacbc;
}
.tree-hint {
  margin: 10px 2px 0;
  padding-top: 8px;
  border-top: 1px dashed #dbe8f1;
  font-size: 10px;
  line-height: 1.7;
  color: #8ba0b2;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
}
.result-count {
  margin-left: auto;
  font-size: 11px;
  color: #8296a8;
  white-space: nowrap;
}
.hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: #70869a;
  line-height: 1.7;
}
.deny-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: #a06a1f;
  line-height: 1.7;
}
.scope-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: #247ba8;
  line-height: 1.7;
}
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.table-wrap {
  width: 100%;
  max-height: 52vh;
  overflow: auto;
  border: 1px solid #e6eff5;
  border-radius: 8px;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.asset-table {
  min-width: 880px;
}
.doc-table {
  min-width: 840px;
}
.record-table {
  min-width: 820px;
}
.maintenance-table {
  min-width: 700px;
}
.data-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 8px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
  white-space: nowrap;
}
.data-table td {
  padding: 8px;
  border-bottom: 1px solid #e6eef4;
  color: #2a4660;
  vertical-align: middle;
}
.data-table tbody tr.clickable {
  cursor: pointer;
}
.data-table tbody tr:hover {
  background: #eef7fc;
}
.data-table tbody tr.selected {
  background: #e2f1fb;
  box-shadow: inset 2px 0 0 #247ba8;
}
.title-cell {
  min-width: 170px;
  word-break: break-word;
}
.title-cell strong {
  font-weight: 600;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
}
.block {
  display: block;
}
.muted {
  color: #8ba0b2;
  font-size: 10.5px;
}
.link-chip {
  margin: 0 4px 3px 0;
  padding: 1px 6px;
  border: 1px solid #cbe4f2;
  border-radius: 999px;
  background: #f1f9fe;
  color: #247ba8;
  font-size: 10px;
  cursor: pointer;
}
.link-chip:hover {
  background: #e2f1fb;
}
.removed-block {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #dbe8f1;
}
.removed-block h3 {
  margin: 0 0 4px;
  font-size: 12px;
  color: #9c4a43;
}
.removed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
  padding: 7px 8px;
  border: 1px solid #f0d1cc;
  border-radius: 7px;
  background: #fdf7f5;
  text-align: left;
  cursor: pointer;
  color: #5d7387;
}
.removed-row:hover {
  background: #fbece8;
}
.removed-row small {
  margin-left: auto;
  font-size: 10px;
  color: #a26b64;
}
.section-title {
  margin: 14px 0 8px;
  font-size: 12px;
  color: #1c3e57;
}
.case-notice {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #f0d6a4;
  background: #fdf7ea;
  font-size: 11px;
  color: #8a6320;
  line-height: 1.7;
}
.case-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.case-card {
  border: 1px solid #e2edf4;
  border-radius: 8px;
  padding: 10px;
  background: #fbfdff;
}
.case-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.case-title strong {
  display: block;
  font-size: 12.5px;
  color: #17364d;
}
.case-title small {
  display: block;
  margin-top: 3px;
  font-size: 10.5px;
  color: #8296a8;
}
.case-result {
  margin: 8px 0 6px;
  font-size: 11.5px;
  line-height: 1.8;
  color: #4d6579;
}
.evidence-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed #dbe8f1;
}
.evidence-label {
  flex-shrink: 0;
  font-size: 10.5px;
  color: #71869a;
  line-height: 1.8;
}
.evidence-chip {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid #cbe4f2;
  border-radius: 6px;
  background: #f1f9fe;
  color: #1c6a99;
  font-size: 10.5px;
  text-align: left;
  cursor: pointer;
}
.evidence-chip:hover {
  background: #e2f1fb;
}
.evidence-chip.unavailable {
  border-color: #f0d1cc;
  background: #fdf3f1;
  color: #9c4a43;
}
.evidence-chip small {
  font-size: 9.5px;
  color: #8296a8;
  word-break: break-all;
}
.evidence-chip.unavailable small {
  color: #b25b52;
}
.case-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.asset-preview h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #17364d;
  word-break: break-word;
}
.tag-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.mini-list {
  margin: 0 0 8px;
  border-top: 1px solid #e4eef5;
}
.mini-list > div {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #e4eef5;
}
.mini-list dt {
  font-size: 10.5px;
  color: #71869a;
}
.mini-list dd {
  margin: 0;
  font-size: 11.5px;
  color: #20384e;
  word-break: break-word;
}
.preview-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.lock-hint {
  margin: 8px 0 0;
  font-size: 10.5px;
  color: #a06a1f;
  line-height: 1.7;
}
.empty-preview h3 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #1c3e57;
}
.empty-preview p {
  margin: 0 0 8px;
  font-size: 11.5px;
  color: #5d7387;
  line-height: 1.8;
}
.empty {
  margin: 10px 0;
  padding: 12px;
  border: 1px dashed #dbe8f1;
  border-radius: 8px;
  font-size: 11.5px;
  color: #8296a8;
  line-height: 1.8;
}
@media (max-width: 1200px) {
  .assets-page {
    grid-template-columns: minmax(180px, 30fr) minmax(0, 70fr);
  }
  .tree-panel,
  .right-panel {
    position: static;
    max-height: none;
  }
  .right-panel {
    grid-column: 2;
  }
}
@media (max-width: 860px) {
  .assets-page {
    display: block;
  }
  .panel + .panel {
    margin-top: 12px;
  }
  .tree-panel,
  .right-panel {
    max-height: none;
  }
}
@media (max-width: 640px) {
  .assets-page .tree-panel {
    max-height: 190px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { NButton, NTag, useDialog, useMessage } from "naive-ui";
import { can, roleNames } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import type { DocumentRef, WorkOrder } from "../demo/types";

const props = defineProps<{ docId: string | null }>();
const emit = defineEmits<{ deleted: [id: string] }>();

const store = useDemoStore();
const ui = useUiStore();
const dialog = useDialog();
const message = useMessage();

const kindLabels: Record<DocumentRef["kind"], string> = {
  manual: "说明书",
  procedure: "操作规程",
  "inspection-standard": "巡检标准",
  drawing: "图纸",
  certificate: "证书",
  case: "维修案例",
  other: "其他资料",
};

const statusLabels: Record<WorkOrder["status"], string> = {
  draft: "草稿",
  pending_dispatch: "待派单",
  in_progress: "维修中",
  pending_acceptance: "待验收",
  archived: "已归档",
  cancelled: "已取消",
};

const doc = computed(() =>
  props.docId ? store.documents.find((item) => item.id === props.docId) : undefined,
);
const removed = computed(
  () => Boolean(props.docId) && store.userState.removedDocumentIds.includes(props.docId as string),
);
const workorderRefs = computed(() => {
  const id = props.docId;
  if (!id) return [];
  return store.workorders.filter((order) => order.evidenceIds.includes(id));
});
const inspectionRefs = computed(() => {
  const id = props.docId;
  if (!id) return [];
  return store.inspections.filter((record) => record.attachmentRefs?.includes(id));
});
const linkedAssets = computed(() => {
  if (!doc.value) return [];
  return doc.value.assetIds.map((assetId) => ({
    assetId,
    asset: store.getAsset(assetId),
  }));
});
const firstAssetId = computed(
  () => linkedAssets.value.find((item) => item.asset)?.assetId ?? null,
);
const sourceLabel = computed(() => {
  if (!doc.value) return "";
  return (
    doc.value.sourceLabel ||
    (doc.value.source === "demo" ? "DEMO模拟档案" : "用户导入")
  );
});
const updatedBy = computed(() =>
  doc.value?.source === "user-upload" ? "当前用户（模拟）" : "DEMO 档案维护人（模拟）",
);
const canAttach = computed(() => can(store.role, "document:attach"));
const denyHint = computed(
  () => `角色「${roleNames[store.role]}」无权删除档案引用（需要 document:attach 权限）。`,
);

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

function openAsset(assetId: string): void {
  if (!store.getAsset(assetId)) {
    message.warning(`设备 ${assetId} 不存在或已退役，无法打开抽屉。`);
    return;
  }
  ui.openAsset(assetId);
}

function openFirstAsset(): void {
  if (firstAssetId.value) openAsset(firstAssetId.value);
}

function confirmDelete(): void {
  const target = doc.value;
  if (!target) return;
  if (!canAttach.value) {
    message.error(denyHint.value);
    return;
  }
  dialog.warning({
    title: "删除档案引用",
    content: `将删除档案「${target.title}」（${target.id}）的引用。历史工单 evidenceIds 保留该 ID，并在引用处标记“原文不可用”，不会删除工单或巡检记录。`,
    positiveText: "确认删除",
    negativeText: "取消",
    onPositiveClick: () => {
      try {
        store.deleteDocument(target.id);
        emit("deleted", target.id);
        message.success("档案引用已删除，相关引用已标记“原文不可用”。");
      } catch (error) {
        message.error((error as Error).message);
      }
    },
  });
}
</script>

<template>
  <div class="doc-detail">
    <template v-if="docId">
      <template v-if="doc">
        <div class="doc-head">
          <h3>{{ doc.title }}</h3>
          <div class="tag-row">
            <NTag size="tiny" :bordered="false">{{ doc.version }}</NTag>
            <NTag size="tiny" :bordered="false" :type="doc.reviewed ? 'success' : 'warning'">
              {{ doc.reviewed ? "已审核" : "未审核" }}
            </NTag>
            <NTag size="tiny" :bordered="false" type="info">{{ sourceLabel }}</NTag>
          </div>
        </div>

        <dl class="detail-list">
          <div>
            <dt>档案编号</dt>
            <dd class="mono">{{ doc.id }}</dd>
          </div>
          <div>
            <dt>资料类型</dt>
            <dd>{{ kindLabels[doc.kind] ?? doc.kind }}</dd>
          </div>
          <div>
            <dt>归属设备</dt>
            <dd>
              <template v-if="linkedAssets.length">
                <button
                  v-for="item in linkedAssets"
                  :key="item.assetId"
                  type="button"
                  class="asset-chip"
                  :title="item.asset ? '打开设备详情抽屉' : '设备不存在或已退役'"
                  @click="openAsset(item.assetId)"
                >
                  {{ item.asset ? `${item.asset.code} · ${item.asset.name}` : `${item.assetId}（不可用）` }}
                </button>
              </template>
              <span v-else class="muted">未关联设备</span>
            </dd>
          </div>
          <div>
            <dt>更新人 / 时间</dt>
            <dd>{{ updatedBy }} · {{ formatAt(doc.updatedAt) }}</dd>
          </div>
          <div>
            <dt>章节 / 页码</dt>
            <dd>{{ doc.lineOrSection || "未提供" }}</dd>
          </div>
          <div v-if="doc.reviewedAt">
            <dt>摘录演示审核</dt>
            <dd>{{ doc.reviewedBy }} · {{ formatAt(doc.reviewedAt) }} · 仅本地DEMO审核，不等于正式技术批准</dd>
          </div>
          <div v-if="doc.reviewNote">
            <dt>审核意见</dt><dd>{{ doc.reviewNote }}</dd>
          </div>
        </dl>

        <section class="excerpt">
          <h4>摘要 / 摘录</h4>
          <p>{{ doc.summary || "该档案未提供摘要。" }}</p>
          <blockquote v-if="doc.contentExcerpt">{{ doc.contentExcerpt }}</blockquote>
          <p v-else class="muted">
            {{
              doc.source === "user-upload"
                ? "该导入文件未读取全文（可能超过 256KB），仅保留元信息。"
                : "该档案暂无摘录内容。"
            }}
          </p>
        </section>
      </template>

      <section v-else class="unavailable">
        <div class="unavailable-head">
          <NTag size="small" type="error" :bordered="false">原文不可用</NTag>
          <span class="mono">{{ docId }}</span>
        </div>
        <p v-if="removed">
          档案已被删除引用：历史工单 evidenceIds 仍保留该 ID，原文不可再查看，也不会补造内容。
        </p>
        <p v-else>该档案 ID 未在当前场景注册，无法展示原文。</p>
      </section>

      <section v-if="workorderRefs.length || inspectionRefs.length" class="refs">
        <h4>被引用位置</h4>
        <p class="refs-hint">按工单 evidenceIds 与巡检附件引用统计；删除档案不会删除这些历史引用。</p>
        <div v-for="order in workorderRefs" :key="order.id" class="ref-item">
          <div class="ref-head">
            <strong>{{ order.code }} · {{ order.title }}</strong>
            <NTag size="tiny" :bordered="false">{{ statusLabels[order.status] }}</NTag>
          </div>
          <small>工单证据 ID：{{ docId }} · 创建 {{ formatAt(order.createdAt) }}</small>
        </div>
        <div v-for="record in inspectionRefs" :key="record.id" class="ref-item">
          <div class="ref-head">
            <strong>巡检 {{ record.id }}</strong>
            <NTag size="tiny" :bordered="false" :type="record.result === 'normal' ? 'success' : 'warning'">
              {{ record.result === "normal" ? "正常" : "异常" }}
            </NTag>
          </div>
          <small>{{ record.inspector }} · {{ formatAt(record.inspectedAt) }} · 附件引用保留</small>
        </div>
      </section>
      <p v-else class="refs-empty">当前没有工单或巡检引用该档案。</p>

      <div v-if="doc" class="actions">
        <NButton size="small" :disabled="!firstAssetId" @click="openFirstAsset">
          查看关联设备
        </NButton>
        <NButton
          size="small"
          type="error"
          secondary
          :disabled="!canAttach"
          :title="canAttach ? '删除档案引用，历史工单证据 ID 保留' : denyHint"
          @click="confirmDelete"
        >
          删除引用
        </NButton>
      </div>
      <p v-if="doc && !canAttach" class="deny-hint">{{ denyHint }}</p>
    </template>

    <div v-else class="empty-preview">
      <h3>详情预览</h3>
      <p>在「档案资料」中点击一条档案，这里会展示版本、审核状态、来源、摘录、关联设备与引用位置。</p>
      <p class="muted">也可从「AI 证据案例」点击证据 ID 精确定位；从设备进入时会锁定当前 assetId。</p>
    </div>
  </div>
</template>

<style scoped>
.doc-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.doc-head h3 {
  margin: 0 0 8px;
  font-size: 15px;
  line-height: 1.5;
  color: #17364d;
  word-break: break-word;
}
.tag-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.detail-list {
  margin: 0;
  border-top: 1px solid #e4eef5;
}
.detail-list > div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #e4eef5;
}
.detail-list dt {
  font-size: 11px;
  color: #71869a;
}
.detail-list dd {
  margin: 0;
  font-size: 12px;
  color: #20384e;
  word-break: break-word;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.asset-chip {
  display: inline-block;
  margin: 0 6px 4px 0;
  padding: 2px 8px;
  border: 1px solid #cbe4f2;
  border-radius: 999px;
  background: #f1f9fe;
  color: #247ba8;
  font-size: 11px;
  cursor: pointer;
}
.asset-chip:hover {
  background: #e2f1fb;
}
.excerpt h4,
.refs h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #1c3e57;
}
.excerpt p {
  margin: 0 0 8px;
  font-size: 12px;
  color: #5d7387;
  line-height: 1.75;
}
.excerpt blockquote {
  margin: 0;
  padding: 8px 10px;
  max-height: 180px;
  overflow: auto;
  border-left: 2px solid #9ccfe8;
  background: #f7fbfe;
  font-size: 11px;
  line-height: 1.8;
  color: #3d566c;
  white-space: pre-wrap;
  word-break: break-word;
}
.unavailable {
  padding: 12px;
  border: 1px solid #f0d1cc;
  border-radius: 8px;
  background: #fdf3f1;
}
.unavailable-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.unavailable p {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: #9c4a43;
}
.refs {
  border-top: 1px dashed #dbe8f1;
  padding-top: 10px;
}
.refs-hint,
.refs-empty {
  margin: 0 0 8px;
  font-size: 11px;
  color: #8296a8;
  line-height: 1.7;
}
.refs-empty {
  padding-top: 8px;
  border-top: 1px dashed #dbe8f1;
}
.ref-item {
  padding: 8px;
  margin-bottom: 6px;
  border: 1px solid #e2edf4;
  border-radius: 6px;
  background: #fbfdff;
}
.ref-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.ref-head strong {
  font-weight: 600;
  color: #2a4660;
  word-break: break-word;
}
.ref-item small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #8296a8;
  line-height: 1.6;
  word-break: break-word;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.deny-hint {
  margin: 0;
  font-size: 11px;
  color: #a06a1f;
  line-height: 1.7;
}
.muted {
  color: #8296a8;
  font-size: 11px;
}
.empty-preview h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #1c3e57;
}
.empty-preview p {
  margin: 0 0 8px;
  font-size: 12px;
  color: #5d7387;
  line-height: 1.8;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  NButton,
  NInput,
  NSelect,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { roleNames } from "../../demo/permissions";
import { useDemoStore } from "../../demo/store";
import {
  createTemplateVersion,
  deleteTemplate,
  listTemplates,
  readTemplates,
  rollbackTemplate,
  TEMPLATE_STORAGE_KEY,
  writeTemplates,
} from "../../demo/templates";
import type { TemplateRecord, TemplateScope } from "../../demo/templates";

const store = useDemoStore();
const route = useRoute();
const message = useMessage();
const dialog = useDialog();

const records = ref<TemplateRecord[]>(readTemplates());
const summaries = computed(() => listTemplates(records.value));
const selectedId = ref("");
const selected = computed(() =>
  summaries.value.find((item) => item.id === selectedId.value),
);

const targetId = ref("");
const form = ref({ name: "", scope: "page", note: "" });
const snapshot = ref("");
const formError = ref("");

interface LocalLog {
  at: string;
  text: string;
}

const logs = ref<LocalLog[]>([]);

const scopeLabels: Record<TemplateScope, string> = {
  page: "页面",
  position: "岗位",
};

const targetOptions = computed(() => [
  { label: "新建模板", value: "" },
  ...summaries.value.map((item) => ({
    label: `${item.name}（${item.id} · v${item.latestVersion}）`,
    value: item.id,
  })),
]);

const scopeOptions = [
  { label: "页面模板", value: "page" },
  { label: "岗位模板", value: "position" },
];

function currentSnapshot(): string {
  return JSON.stringify(
    {
      page: (route.meta.title as string | undefined) ?? String(route.name ?? "未知页面"),
      position: roleNames[store.role],
      scenario: store.scenarioId,
      capturedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

snapshot.value = currentSnapshot();

watch(
  summaries,
  (list) => {
    if (list.length === 0) {
      selectedId.value = "";
      return;
    }
    if (!list.some((item) => item.id === selectedId.value)) {
      selectedId.value = list[0].id;
    }
  },
  { immediate: true },
);

watch(targetId, (value) => {
  const summary = summaries.value.find((item) => item.id === value);
  if (summary) {
    form.value.name = summary.name;
    form.value.scope = summary.scope;
  } else {
    form.value.name = "";
    form.value.scope = "page";
  }
});

function scopeOf(value: string): TemplateScope {
  return value === "position" ? "position" : "page";
}

function formatAt(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function addLog(text: string): void {
  logs.value = [{ at: new Date().toISOString(), text }, ...logs.value].slice(0, 30);
}

function compactSnapshot(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 90 ? `${compact.slice(0, 90)}…` : compact;
}

function refreshSnapshot(): void {
  snapshot.value = currentSnapshot();
  message.info("已按当前页面与岗位刷新快照内容");
}

function persist(next: TemplateRecord[]): void {
  records.value = next;
  writeTemplates(next);
}

function submitVersion(): void {
  formError.value = "";
  try {
    const next = createTemplateVersion(records.value, {
      id: targetId.value || undefined,
      name: form.value.name,
      scope: scopeOf(form.value.scope),
      note: form.value.note,
      snapshot: snapshot.value,
    });
    persist(next);
    const created = next[next.length - 1];
    selectedId.value = created.id;
    addLog(`创建模板版本「${created.name}」v${created.version}`);
    message.success(`已保存「${created.name}」v${created.version}（仅本地）`);
    form.value.note = "";
    targetId.value = "";
  } catch (error) {
    formError.value = (error as Error).message;
    message.error(formError.value);
  }
}

function rollback(version: number): void {
  const summary = selected.value;
  if (!summary) return;
  dialog.warning({
    title: "回滚模板版本",
    content: `将基于「${summary.name}」v${version} 的快照生成 v${summary.latestVersion + 1}，历史版本全部保留。`,
    positiveText: "确认回滚",
    negativeText: "取消",
    onPositiveClick: () => {
      try {
        const next = rollbackTemplate(records.value, summary.id, version);
        persist(next);
        const created = next[next.length - 1];
        addLog(`回滚模板「${summary.name}」至 v${version}，生成 v${created.version}`);
        message.success(`已生成 v${created.version}，快照来自 v${version}`);
      } catch (error) {
        message.error((error as Error).message);
      }
    },
  });
}

function removeTemplate(): void {
  const summary = selected.value;
  if (!summary) return;
  dialog.warning({
    title: "删除本地模板",
    content: `将删除「${summary.name}」的全部 ${summary.versions.length} 个本地版本记录，且不可恢复。`,
    positiveText: "确认删除",
    negativeText: "取消",
    onPositiveClick: () => {
      try {
        const next = deleteTemplate(records.value, summary.id);
        persist(next);
        selectedId.value = "";
        addLog(`删除模板「${summary.name}」（${summary.versions.length} 个版本）`);
        message.success(`已删除模板「${summary.name}」`);
      } catch (error) {
        message.error((error as Error).message);
      }
    },
  });
}
</script>

<template>
  <div class="admin-page">
    <section class="admin-panel">
      <div class="panel-head">
        <div>
          <h2>页面 / 岗位模板</h2>
          <p>
            一期仅保留本地版本记录与回滚，不发布到服务端。存储键：
            <code>{{ TEMPLATE_STORAGE_KEY }}</code>
          </p>
        </div>
        <NTag size="small" :bordered="false" type="warning">仅本地版本记录</NTag>
      </div>

      <p class="notice">
        模板快照与版本历史保存在当前浏览器 localStorage，刷新后保留；不会调用后端，也不会影响其他角色或设备。
      </p>

      <div class="template-layout">
        <aside class="template-list">
          <div class="list-head">
            <strong>模板 {{ summaries.length }} 个</strong>
            <small>{{ records.length }} 条版本记录</small>
          </div>
          <button
            v-for="summary in summaries"
            :key="summary.id"
            type="button"
            class="template-item"
            :class="{ active: selectedId === summary.id }"
            @click="selectedId = summary.id"
          >
            <span class="item-top">
              <strong>{{ summary.name }}</strong>
              <NTag size="tiny" :bordered="false">
                {{ scopeLabels[summary.scope] }}
              </NTag>
            </span>
            <small>
              {{ summary.id }} · v{{ summary.latestVersion }} · {{ summary.versions.length }} 个版本
            </small>
          </button>
          <p v-if="!summaries.length" class="empty-inline">
            暂无本地模板。请在右侧填写名称与快照，创建第一个模板版本。
          </p>
        </aside>

        <div class="template-main">
          <section class="block">
            <div class="block-head">
              <h3>创建新版本</h3>
              <span>可选择已有模板追加版本，或新建模板</span>
            </div>
            <div class="form-grid">
              <label>
                <span>目标模板</span>
                <NSelect
                  v-model:value="targetId"
                  :options="targetOptions"
                  placeholder="新建模板"
                />
              </label>
              <label>
                <span>模板名称</span>
                <NInput v-model:value="form.name" placeholder="如 值班岗位看板模板" />
              </label>
              <label>
                <span>模板范围</span>
                <NSelect v-model:value="form.scope" :options="scopeOptions" />
              </label>
            </div>
            <label class="wide-label">
              <span>版本备注</span>
              <NInput
                v-model:value="form.note"
                placeholder="如 调整告警卡片顺序与默认时间范围"
              />
            </label>
            <label class="wide-label">
              <span>
                快照内容
                <NButton size="tiny" quaternary @click="refreshSnapshot">
                  使用当前页面 / 岗位
                </NButton>
              </span>
              <NInput
                v-model:value="snapshot"
                type="textarea"
                :autosize="{ minRows: 4, maxRows: 8 }"
              />
            </label>
            <p v-if="formError" class="field-error">{{ formError }}</p>
            <div class="form-actions">
              <NButton type="primary" size="small" @click="submitVersion">
                保存为新版本
              </NButton>
              <span class="hint">
                回滚不会覆盖历史版本，而是基于旧快照生成一个更高版本。
              </span>
            </div>
          </section>

          <section class="block">
            <div class="block-head">
              <h3>
                版本历史
                <template v-if="selected">· {{ selected.name }}（{{ selected.id }}）</template>
              </h3>
              <NButton
                v-if="selected"
                size="tiny"
                type="error"
                secondary
                @click="removeTemplate"
              >
                删除模板
              </NButton>
            </div>

            <template v-if="selected">
              <div class="version-table-wrap">
                <table class="version-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>范围</th>
                      <th>创建时间</th>
                      <th>备注</th>
                      <th>快照</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="record in selected.versions"
                      :key="`${record.id}-${record.version}`"
                      :class="{ current: record.version === selected.latestVersion }"
                    >
                      <td class="version-cell">
                        v{{ record.version }}
                        <NTag
                          v-if="record.version === selected.latestVersion"
                          size="tiny"
                          :bordered="false"
                          type="success"
                        >
                          当前
                        </NTag>
                      </td>
                      <td>{{ scopeLabels[record.scope] }}</td>
                      <td>{{ formatAt(record.createdAt) }}</td>
                      <td>{{ record.note || "未填写" }}</td>
                      <td class="snapshot-cell">
                        <details>
                          <summary :title="record.snapshot">
                            {{ compactSnapshot(record.snapshot) }}
                          </summary>
                          <pre>{{ record.snapshot }}</pre>
                        </details>
                      </td>
                      <td>
                        <NButton
                          size="tiny"
                          secondary
                          :disabled="record.version === selected.latestVersion"
                          @click="rollback(record.version)"
                        >
                          回滚到此版本
                        </NButton>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <p v-else class="empty">请在左侧选择一个模板，或先创建新模板。</p>
          </section>
        </div>
      </div>

      <section class="block log-block">
        <div class="block-head">
          <h3>本次会话操作记录</h3>
          <span>仅页面内展示，不写入全局审计</span>
        </div>
        <ul v-if="logs.length" class="log-list">
          <li v-for="(item, index) in logs" :key="index">
            <time>{{ formatAt(item.at) }}</time>
            <span>{{ item.text }}</span>
          </li>
        </ul>
        <p v-else class="empty-inline">本次会话尚未创建、回滚或删除模板。</p>
      </section>
    </section>
  </div>
</template>

<style scoped>
.admin-page {
  min-width: 0;
}
.admin-panel {
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
  margin-bottom: 8px;
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
  line-height: 1.7;
}
.panel-head code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #247ba8;
}
.notice {
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px dashed #e8c98f;
  border-radius: 7px;
  background: #fdf7ec;
  font-size: 11px;
  color: #8a5c15;
  line-height: 1.7;
}
.template-layout {
  display: grid;
  grid-template-columns: minmax(200px, 26fr) minmax(0, 74fr);
  gap: 12px;
  align-items: start;
}
.template-list {
  padding: 9px;
  border: 1px solid #e2edf4;
  border-radius: 9px;
  background: #fbfdff;
}
.list-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 7px;
}
.list-head strong {
  font-size: 11.5px;
  color: #1c3e57;
}
.list-head small {
  font-size: 9.5px;
  color: #93a7b7;
}
.template-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  margin-bottom: 5px;
  padding: 7px 8px;
  border: 1px solid #e2edf4;
  border-radius: 7px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  color: #33526b;
}
.template-item:hover {
  border-color: #9ccfe8;
  background: #f1f9fe;
}
.template-item.active {
  border-color: #247ba8;
  background: #eaf5fc;
  box-shadow: inset 2px 0 0 #247ba8;
}
.item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.item-top strong {
  font-size: 11.5px;
  word-break: break-word;
}
.template-item small {
  font-size: 9.5px;
  color: #8ba0b2;
}
.template-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.block {
  padding: 11px;
  border: 1px solid #e2edf4;
  border-radius: 9px;
  background: #fbfdff;
}
.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.block-head h3 {
  margin: 0;
  font-size: 12.5px;
  color: #1c3e57;
}
.block-head span {
  font-size: 10px;
  color: #93a7b7;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}
.form-grid label,
.wide-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  color: #6c8296;
}
.wide-label {
  margin-top: 9px;
}
.wide-label > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.field-error {
  margin: 7px 0 0;
  font-size: 10.5px;
  color: #b0453d;
}
.form-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px dashed #e0edf5;
}
.hint {
  margin: 0;
  font-size: 10.5px;
  color: #8296a8;
  line-height: 1.7;
}
.version-table-wrap {
  overflow: auto;
  border: 1px solid #e6eff5;
  border-radius: 8px;
}
.version-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 11px;
}
.version-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 7px;
  background: #f1f7fb;
  color: #6c8296;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.version-table td {
  padding: 6px 7px;
  border-bottom: 1px solid #eef5fa;
  color: #2a4660;
  vertical-align: top;
}
.version-table tr.current {
  background: #f1f9fe;
}
.version-cell {
  white-space: nowrap;
}
.version-cell :deep(.n-tag) {
  margin-left: 4px;
}
.snapshot-cell {
  max-width: 280px;
}
.snapshot-cell summary {
  cursor: pointer;
  font-size: 10px;
  color: #247ba8;
  word-break: break-all;
}
.snapshot-cell pre {
  max-height: 180px;
  margin: 6px 0 0;
  padding: 7px;
  overflow: auto;
  border-radius: 6px;
  background: #f6fafd;
  border: 1px solid #eef5fa;
  font-size: 10px;
  color: #4d6579;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-block {
  margin-top: 12px;
}
.log-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.log-list li {
  display: flex;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px dashed #eef5fa;
  font-size: 10.5px;
  color: #4d6579;
}
.log-list time {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #93a7b7;
}
.empty-inline {
  margin: 5px 0;
  font-size: 11px;
  color: #93a7b7;
  line-height: 1.7;
}
.empty {
  margin: 8px 0;
  padding: 12px;
  border: 1px dashed #dbe8f1;
  border-radius: 8px;
  font-size: 11.5px;
  color: #8296a8;
}
@media (max-width: 1100px) {
  .template-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 860px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { NButton, NSelect, NTag, useDialog, useMessage } from "naive-ui";
import { can, roleNames } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import type { Dashboard } from "../demo/types";
import { formatDateTime } from "../demo/workorderMeta";

const router = useRouter();
const store = useDemoStore();
const dialog = useDialog();
const message = useMessage();

const operationError = ref("");
const versionChoice = ref<Record<string, number>>({});
let copySeq = 0;

const dashboards = computed(() =>
  [...store.dashboards].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "personal" ? -1 : 1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }),
);
const canEdit = computed(() => can(store.role, "dashboard:edit:self"));

function setError(messageText: string): void {
  operationError.value = messageText;
}

function clearError(): void {
  operationError.value = "";
}

function isOwn(dashboard: Dashboard): boolean {
  return dashboard.ownerRole === store.role || store.role === "admin";
}

function scopeLabel(dashboard: Dashboard): string {
  return dashboard.scope === "personal" ? "个人看板" : "岗位看板";
}

function historyVersions(dashboard: Dashboard): { version: number; savedAt: string }[] {
  return [...(dashboard.history ?? [])].sort((a, b) => a.version - b.version);
}

function historyOptions(dashboard: Dashboard) {
  return historyVersions(dashboard).map((item) => ({
    label: `v${item.version} · ${formatDateTime(item.savedAt)}`,
    value: item.version,
  }));
}

function selectedVersion(dashboard: Dashboard): number | null {
  const choice = versionChoice.value[dashboard.id];
  if (typeof choice === "number") return choice;
  const history = historyVersions(dashboard);
  return history.length ? history[history.length - 1].version : null;
}

function chooseVersion(id: string, value: number): void {
  versionChoice.value = { ...versionChoice.value, [id]: value };
}

function openDashboard(dashboard: Dashboard): void {
  clearError();
  void router.push({
    name: "ai-workspace",
    query: { dashboard: dashboard.id },
  });
}

function goWorkspace(): void {
  clearError();
  void router.push({ name: "ai-workspace" });
}

function requireEdit(action: string): boolean {
  if (!canEdit.value) {
    setError(
      `FORBIDDEN · 角色「${roleNames[store.role]}」无权${action}（需要 dashboard:edit:self）`,
    );
    return false;
  }
  return true;
}

function copyDashboard(dashboard: Dashboard): void {
  clearError();
  if (!requireEdit("复制看板")) return;
  copySeq += 1;
  const now = store.seed.referenceTime;
  try {
    const copy: Dashboard = {
      ...dashboard,
      id: `dash-copy-${Date.now().toString(36)}-${copySeq}`,
      name: `${dashboard.name} 副本`,
      ownerId: "demo-user",
      ownerRole: store.role,
      scope: "personal",
      version: 1,
      createdAt: now,
      updatedAt: now,
      history: [],
      widgets: dashboard.widgets.map((widget) => ({ ...widget })),
    };
    const saved = store.saveDashboard(copy);
    message.success(`已复制为「${saved.name}」，仅本人可编辑`);
  } catch (error) {
    setError(`复制失败：${(error as Error).message}`);
  }
}

function deleteDashboard(dashboard: Dashboard): void {
  clearError();
  if (!requireEdit("删除看板")) return;
  if (!isOwn(dashboard)) {
    setError("FORBIDDEN · 只能删除本人保存的看板");
    return;
  }
  dialog.warning({
    title: "删除看板",
    content: `确认删除「${dashboard.name}」v${dashboard.version}？该操作会写入本地审计记录，且不可撤销。`,
    positiveText: "确认删除",
    negativeText: "取消",
    onPositiveClick: () => {
      try {
        store.deleteDashboard(dashboard.id);
        clearError();
        message.success(`已删除「${dashboard.name}」`);
      } catch (error) {
        setError(`删除失败：${(error as Error).message}`);
      }
    },
  });
}

function restoreVersion(dashboard: Dashboard): void {
  clearError();
  if (!requireEdit("回滚看板版本")) return;
  if (!isOwn(dashboard)) {
    setError("FORBIDDEN · 只能恢复本人保存的看板");
    return;
  }
  const version = selectedVersion(dashboard);
  if (version === null) {
    setError("该看板暂无历史版本，无法回滚");
    return;
  }
  try {
    const restored = store.restoreDashboard(dashboard.id, version);
    versionChoice.value = { ...versionChoice.value, [dashboard.id]: restored.version };
    message.success(`已恢复「${dashboard.name}」至 v${version}，当前 v${restored.version}`);
  } catch (error) {
    setError(`回滚失败：${(error as Error).message}`);
  }
}
</script>

<template>
  <section class="dashboards-page">
    <div class="list-head">
      <div>
        <strong>我的看板</strong>
        <span>共 {{ dashboards.length }} 个可见看板 · 个人看板仅本人可编辑，岗位看板按角色共享</span>
      </div>
      <div class="head-actions">
        <NTag size="small" :bordered="false">{{ roleNames[store.role] }}</NTag>
        <NButton size="small" type="primary" secondary @click="goWorkspace">
          去工作台创建
        </NButton>
      </div>
    </div>

    <div v-if="operationError" class="error-bar">
      <strong>操作被拒绝</strong>
      <p>{{ operationError }}</p>
    </div>

    <div v-if="dashboards.length" class="dashboard-grid">
      <article v-for="dashboard in dashboards" :key="dashboard.id" class="dashboard-card">
        <header class="card-head">
          <div>
            <h2>{{ dashboard.name }}</h2>
            <p>{{ dashboard.id }}</p>
          </div>
          <div class="tags">
            <NTag size="tiny" :bordered="false" type="info">{{ scopeLabel(dashboard) }}</NTag>
            <NTag size="tiny" :bordered="false">v{{ dashboard.version }}</NTag>
          </div>
        </header>

        <dl class="meta">
          <div>
            <dt>所有者角色</dt>
            <dd>{{ roleNames[dashboard.ownerRole] }}</dd>
          </div>
          <div>
            <dt>组件数</dt>
            <dd>{{ dashboard.widgets.length }} 个</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{{ formatDateTime(dashboard.updatedAt) }}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{{ formatDateTime(dashboard.createdAt) }}</dd>
          </div>
        </dl>

        <p class="owner-line">
          {{ isOwn(dashboard) ? "本人可编辑" : "非本人看板，仅可查看或复制" }}
          · 历史版本 {{ historyVersions(dashboard).length }} 个
        </p>

        <div class="actions">
          <NButton size="small" type="primary" secondary @click="openDashboard(dashboard)">
            打开
          </NButton>
          <NButton size="small" secondary @click="copyDashboard(dashboard)">复制</NButton>
          <NButton size="small" secondary @click="deleteDashboard(dashboard)">删除</NButton>
        </div>

        <div class="rollback-row">
          <NSelect
            size="small"
            class="version-select"
            :value="selectedVersion(dashboard)"
            :options="historyOptions(dashboard)"
            :disabled="!historyVersions(dashboard).length"
            placeholder="选择历史版本"
            @update:value="(value: number) => chooseVersion(dashboard.id, value)"
          />
          <NButton
            size="small"
            secondary
            :disabled="!historyVersions(dashboard).length"
            @click="restoreVersion(dashboard)"
          >
            回滚
          </NButton>
        </div>

        <details v-if="historyVersions(dashboard).length" class="history">
          <summary>版本历史（{{ historyVersions(dashboard).length }}）</summary>
          <ul>
            <li v-for="item in [...historyVersions(dashboard)].reverse()" :key="item.version">
              v{{ item.version }} · {{ formatDateTime(item.savedAt) }}
            </li>
          </ul>
        </details>
      </article>
    </div>

    <section v-else class="empty-panel">
      <strong>暂无可见看板</strong>
      <p>
        当前角色「{{ roleNames[store.role] }}」还没有可访问的个人或岗位看板。可在工作台生成图表后保存，
        保存后可在此打开、复制、删除与版本回滚。
      </p>
      <NButton type="primary" secondary @click="goWorkspace">去工作台创建</NButton>
    </section>

    <p class="footer-note">
      权限说明：个人看板仅本人可编辑，管理员可管理全部看板；岗位看板按角色共享。
      所有写操作由本地 store 校验并写入审计记录，不请求后端。
    </p>
  </section>
</template>

<style scoped>
.dashboards-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(236, 246, 252, 0.9));
}

.list-head strong {
  font-size: 14px;
  color: #1c3e57;
}

.list-head span {
  margin-left: 10px;
  font-size: 11px;
  color: #7c91a4;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.error-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
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
  font-size: 11px;
  color: #8a5550;
  line-height: 1.6;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

.dashboard-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 16px 18px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 20px rgba(36, 123, 168, 0.05);
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.card-head h2 {
  margin: 0;
  font-size: 15px;
  color: #1c3e57;
}

.card-head p {
  margin: 4px 0 0;
  font-size: 10px;
  color: #9aacbb;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.tags {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.meta {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 14px;
  padding-top: 8px;
  border-top: 1px solid #eef4f8;
}

.meta > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta dt {
  font-size: 10.5px;
  color: #8296a8;
}

.meta dd {
  margin: 0;
  font-size: 11.5px;
  color: #3d566c;
}

.owner-line {
  margin: 0;
  padding: 6px 9px;
  border-radius: 7px;
  background: #f5fafd;
  font-size: 10.5px;
  color: #6b8194;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.rollback-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-select {
  flex: 1;
  min-width: 150px;
}

.history summary {
  cursor: pointer;
  font-size: 11px;
  color: #5c87a1;
}

.history ul {
  margin: 6px 0 0;
  padding: 0 0 0 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.history li {
  font-size: 10.5px;
  color: #8296a8;
}

.empty-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 40px 24px;
  border: 1px dashed #cfe1ec;
  border-radius: 12px;
  background: #f8fcff;
}

.empty-panel strong {
  font-size: 15px;
  color: #1c3e57;
}

.empty-panel p {
  margin: 0;
  max-width: 720px;
  font-size: 12px;
  color: #748a9d;
  line-height: 1.8;
}

.footer-note {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f2f7fb;
  font-size: 11px;
  color: #6b8194;
  line-height: 1.7;
}

@media (max-width: 1180px) {
  .dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

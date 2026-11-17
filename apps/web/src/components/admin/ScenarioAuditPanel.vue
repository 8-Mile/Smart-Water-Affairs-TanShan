<script setup lang="ts">
import { computed, ref } from "vue";
import {
  NButton,
  NInput,
  NSelect,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { can, roleNames } from "../../demo/permissions";
import { useDemoStore } from "../../demo/store";
import type { Role, ScenarioId } from "../../demo/types";

const store = useDemoStore();
const message = useMessage();
const dialog = useDialog();

interface ScenarioMeta {
  id: ScenarioId;
  name: string;
  summary: string;
  impact: string;
}

const SCENARIOS: ScenarioMeta[] = [
  {
    id: "SCN-NORMAL",
    name: "常态运行",
    summary: "常规生产负载，设备状态与告警处于日常水平。",
    impact: "P-002 运行平稳，无活动告警，适合作为默认演示入口。",
  },
  {
    id: "SCN-PUMP-FAULT",
    name: "泵组故障",
    summary: "中压供水主泵 P-002 故障，振动趋势上升。",
    impact: "出现故障告警与待验收工单，适合演示健康诊断、工单流转与证据引用。",
  },
  {
    id: "SCN-RAIN",
    name: "降雨过程",
    summary: "降雨过程抬高雨水收集池储量与回用泵负荷。",
    impact: "雨次储量与库容偏高，适合演示雨次分析、水量账本与雨水提升设备。",
  },
  {
    id: "SCN-MINING",
    name: "含矿污水波动",
    summary: "含矿污水处理负荷与加药量出现波动。",
    impact: "处理负荷升高，适合演示含矿污水处理单元的工艺与告警联动。",
  },
];

const ROLES: Role[] = ["manager", "duty", "engineer", "water", "admin", "viewer"];

const actionFilter = ref("all");
const roleFilter = ref("all");
const expandedAuditId = ref("");
const importText = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const canScenario = computed(() => can(store.role, "scenario:write"));
const canAdmin = computed(() => can(store.role, "admin:write"));

const currentScenario = computed(
  () => SCENARIOS.find((item) => item.id === store.scenarioId) ?? SCENARIOS[0],
);

const actionOptions = computed(() => {
  const actions = [...new Set(store.audits.map((item) => item.action))].sort();
  return [
    { label: "全部动作", value: "all" },
    ...actions.map((action) => ({ label: action, value: action })),
  ];
});

const roleOptions = computed(() => [
  { label: "全部角色", value: "all" },
  ...ROLES.map((role) => ({ label: roleNames[role], value: role })),
]);

const filteredAudits = computed(() =>
  store.audits
    .filter((item) => actionFilter.value === "all" || item.action === actionFilter.value)
    .filter((item) => roleFilter.value === "all" || item.actorRole === roleFilter.value),
);

const OBJECT_TYPE_LABELS: Record<string, string> = {
  asset: "设备",
  measurePoint: "测点",
  processBinding: "工艺点位",
  alarm: "告警",
  workOrder: "工单",
  document: "档案",
  dashboard: "看板",
  agentRun: "Agent 任务",
  inspection: "巡检记录",
  userState: "用户配置",
};

function objectTypeLabel(type: string): string {
  return OBJECT_TYPE_LABELS[type] ?? type;
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

function pretty(value?: string): string {
  if (!value) return "未记录";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function toggleAudit(id: string): void {
  expandedAuditId.value = expandedAuditId.value === id ? "" : id;
}

function switchScenario(meta: ScenarioMeta): void {
  if (meta.id === store.scenarioId) {
    message.info(`当前已处于「${meta.name}」场景`);
    return;
  }
  if (!canScenario.value) {
    message.warning(`角色「${roleNames[store.role]}」无权切换场景`);
    return;
  }
  dialog.warning({
    title: "切换演示场景",
    content: `将切换为「${meta.name}（${meta.id}）」。${meta.impact} 当前场景的本地变更会保留在本场景分组中，已导入档案和个人看板保留。`,
    positiveText: "确认切换",
    negativeText: "取消",
    onPositiveClick: () => {
      try {
        store.setScenario(meta.id);
        message.success(`已切换到「${meta.name}」`);
      } catch (error) {
        message.error((error as Error).message);
      }
    },
  });
}

function resetScenario(): void {
  if (!canScenario.value) {
    message.warning(`角色「${roleNames[store.role]}」无权恢复场景`);
    return;
  }
  dialog.warning({
    title: "恢复场景初始数据",
    content:
      "将清除当前场景下本地新增的设备、测点、绑定、工单、告警确认与审计记录，已导入档案和个人看板保留。请先确认无需导出这些变更。",
    positiveText: "恢复场景",
    negativeText: "取消",
    onPositiveClick: () => {
      try {
        store.resetScenario();
        message.success("当前场景已恢复初始状态");
      } catch (error) {
        message.error((error as Error).message);
      }
    },
  });
}

function exportState(): void {
  try {
    const json = store.exportUserState();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tanggang-demo-state-${store.scenarioId}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    message.success("已导出当前场景的个人配置 JSON");
  } catch (error) {
    message.error(`导出失败：${(error as Error).message}`);
  }
}

function importState(): void {
  if (!canAdmin.value) {
    message.warning(`角色「${roleNames[store.role]}」无 admin:write 权限，不能导入配置`);
    return;
  }
  if (!importText.value.trim()) {
    message.warning("请先粘贴 JSON 配置或选择文件");
    return;
  }
  try {
    store.importUserState(importText.value);
    importText.value = "";
    message.success("已导入配置并写入本地存储");
  } catch (error) {
    message.error(`导入失败：${(error as Error).message}`);
  }
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!canAdmin.value) {
    message.warning(`角色「${roleNames[store.role]}」无 admin:write 权限，不能导入配置`);
    input.value = "";
    return;
  }
  try {
    const text = await file.text();
    importText.value = text;
    store.importUserState(text);
    importText.value = "";
    message.success(`已从「${file.name}」导入配置`);
  } catch (error) {
    message.error(`导入失败：${(error as Error).message}`);
  } finally {
    input.value = "";
  }
}
</script>

<template>
  <div class="admin-page">
    <section class="admin-panel">
      <div class="panel-head">
        <div>
          <h2>演示场景</h2>
          <p>
            当前场景：{{ currentScenario.name }}（{{ store.scenarioId }}） · seed
            {{ store.seedVersion }}
          </p>
        </div>
        <NButton
          size="small"
          secondary
          :disabled="!canScenario"
          :title="canScenario ? '清除当前场景本地新增数据' : '需要 scenario:write 权限'"
          @click="resetScenario"
        >
          恢复场景
        </NButton>
      </div>

      <div class="scenario-grid">
        <article
          v-for="meta in SCENARIOS"
          :key="meta.id"
          class="scenario-card"
          :class="{ active: meta.id === store.scenarioId }"
        >
          <div class="scenario-head">
            <strong>{{ meta.name }}</strong>
            <NTag
              size="tiny"
              :bordered="false"
              :type="meta.id === store.scenarioId ? 'success' : 'default'"
            >
              {{ meta.id === store.scenarioId ? "当前场景" : "可切换" }}
            </NTag>
          </div>
          <code class="scenario-id">{{ meta.id }}</code>
          <p class="scenario-summary">{{ meta.summary }}</p>
          <p class="scenario-impact">影响：{{ meta.impact }}</p>
          <NButton
            size="tiny"
            :type="meta.id === store.scenarioId ? 'default' : 'primary'"
            :disabled="!canScenario || meta.id === store.scenarioId"
            @click="switchScenario(meta)"
          >
            {{ meta.id === store.scenarioId ? "已启用" : "切换到此场景" }}
          </NButton>
        </article>
      </div>

      <p class="hint">
        切换与复位会写入本地存储；复位只清除当前场景的本地新增数据，已导入档案和个人看板保留。
      </p>
    </section>

    <section class="admin-panel">
      <div class="panel-head">
        <div>
          <h2>本地配置导入 / 导出</h2>
          <p>导出当前场景的 UserState JSON；导入会覆盖本地用户态并写入一条审计。</p>
        </div>
      </div>
      <div class="io-grid">
        <article class="io-card">
          <h3>导出个人配置</h3>
          <p class="hint">
            导出内容包含设备、测点、绑定、工单、看板、审计等本地变更，不含模拟种子本身。
          </p>
          <NButton size="small" type="primary" @click="exportState">下载 JSON</NButton>
        </article>
        <article class="io-card">
          <h3>导入个人配置</h3>
          <NInput
            v-model:value="importText"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 8 }"
            placeholder="粘贴 exportUserState 生成的 JSON"
          />
          <p v-if="!canAdmin" class="deny-hint">
            角色「{{ roleNames[store.role] }}」无 admin:write 权限，导入按钮已禁用。
          </p>
          <div class="io-actions">
            <NButton
              size="small"
              type="primary"
              :disabled="!canAdmin"
              @click="importState"
            >
              导入配置
            </NButton>
            <NButton size="small" secondary :disabled="!canAdmin" @click="fileInput?.click()">
              选择 JSON 文件
            </NButton>
            <input
              ref="fileInput"
              class="file-input"
              type="file"
              accept=".json,application/json"
              @change="onFilePicked"
            />
          </div>
        </article>
      </div>
    </section>

    <section class="admin-panel">
      <div class="panel-head">
        <div>
          <h2>审计日志</h2>
          <p>
            共 {{ store.audits.length }} 条，当前筛选 {{ filteredAudits.length }} 条；
            默认按时间倒序，包含角色、动作、对象、摘要与 requestId。
          </p>
        </div>
      </div>

      <div class="filter-bar">
        <NSelect
          v-model:value="actionFilter"
          :options="actionOptions"
          style="width: 220px"
        />
        <NSelect
          v-model:value="roleFilter"
          :options="roleOptions"
          style="width: 150px"
        />
        <span class="result-count">显示 {{ filteredAudits.length }} 条</span>
      </div>

      <div v-if="filteredAudits.length" class="table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>角色</th>
              <th>动作</th>
              <th>对象类型</th>
              <th>对象 ID</th>
              <th>摘要</th>
              <th>requestId</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="audit in filteredAudits" :key="audit.id">
              <tr class="clickable" @click="toggleAudit(audit.id)">
                <td class="time-cell">{{ formatAt(audit.at) }}</td>
                <td>{{ roleNames[audit.actorRole] }}</td>
                <td><code>{{ audit.action }}</code></td>
                <td>{{ objectTypeLabel(audit.objectType) }}</td>
                <td class="mono">{{ audit.objectId }}</td>
                <td class="summary-cell">{{ audit.summary }}</td>
                <td class="mono">{{ audit.requestId }}</td>
                <td>
                  <NButton size="tiny" quaternary @click.stop="toggleAudit(audit.id)">
                    {{ expandedAuditId === audit.id ? "收起" : "展开" }}
                  </NButton>
                </td>
              </tr>
              <tr v-if="expandedAuditId === audit.id" class="detail-row">
                <td colspan="8">
                  <div class="audit-detail">
                    <div class="detail-meta">
                      <span>事件 ID：{{ audit.id }}</span>
                      <span>动作：{{ audit.action }}</span>
                      <span>对象：{{ audit.objectType }} / {{ audit.objectId }}</span>
                      <span>requestId：{{ audit.requestId }}</span>
                    </div>
                    <div class="diff-columns">
                      <div class="diff-box">
                        <strong>before</strong>
                        <pre>{{ pretty(audit.before) }}</pre>
                      </div>
                      <div class="diff-box">
                        <strong>after</strong>
                        <pre>{{ pretty(audit.after) }}</pre>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">
        当前筛选下没有审计事件。可切换动作或角色筛选，或在设备配置页执行一次写操作后再查看。
      </p>
    </section>
  </div>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  line-height: 1.7;
}
.scenario-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}
.scenario-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px;
  border: 1px solid #e2edf4;
  border-radius: 9px;
  background: #fbfdff;
}
.scenario-card.active {
  border-color: #7fb4cd;
  background: #eef8fe;
  box-shadow: inset 2px 0 0 #247ba8;
}
.scenario-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.scenario-head strong {
  font-size: 12.5px;
  color: #1c3e57;
}
.scenario-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #247ba8;
}
.scenario-summary {
  margin: 0;
  font-size: 10.5px;
  color: #4d6579;
  line-height: 1.7;
}
.scenario-impact {
  margin: 0;
  font-size: 10px;
  color: #8a6320;
  line-height: 1.7;
}
.scenario-card :deep(.n-button) {
  margin-top: auto;
  align-self: flex-start;
}
.hint {
  margin: 9px 0 0;
  font-size: 10.5px;
  color: #8296a8;
  line-height: 1.7;
}
.deny-hint {
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #a06a1f;
  line-height: 1.7;
}
.io-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: 10px;
}
.io-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border: 1px solid #e2edf4;
  border-radius: 9px;
  background: #fbfdff;
}
.io-card h3 {
  margin: 0;
  font-size: 12px;
  color: #1c3e57;
}
.io-card .hint {
  margin: 0;
}
.io-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
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
.table-wrap {
  width: 100%;
  max-height: 52vh;
  overflow: auto;
  border: 1px solid #e6eff5;
  border-radius: 8px;
}
.audit-table {
  width: 100%;
  min-width: 1040px;
  border-collapse: collapse;
  font-size: 11px;
}
.audit-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 7px 8px;
  background: #f1f7fb;
  color: #6c8296;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.audit-table td {
  padding: 7px 8px;
  border-bottom: 1px solid #eef5fa;
  color: #2a4660;
  vertical-align: top;
}
.audit-table tbody tr.clickable {
  cursor: pointer;
}
.audit-table tbody tr:hover {
  background: #eef7fc;
}
.time-cell {
  white-space: nowrap;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}
.audit-table code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #247ba8;
}
.summary-cell {
  min-width: 180px;
  word-break: break-word;
}
.detail-row td {
  background: #f8fbfe;
}
.audit-detail {
  padding: 8px 10px;
  border: 1px solid #e2edf4;
  border-radius: 8px;
  background: #fff;
}
.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-bottom: 7px;
  font-size: 10px;
  color: #7c93a5;
}
.diff-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.diff-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.diff-box strong {
  font-size: 10.5px;
  color: #5d7387;
}
.diff-box pre {
  max-height: 200px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid #eef5fa;
  border-radius: 6px;
  background: #f6fafd;
  font-size: 10px;
  color: #4d6579;
  white-space: pre-wrap;
  word-break: break-all;
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
  .scenario-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 860px) {
  .scenario-grid,
  .io-grid,
  .diff-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { NTag, useMessage } from "naive-ui";
import { can, roleNames } from "../../demo/permissions";
import type { Action, PermissionScope } from "../../demo/permissions";
import { useDemoStore } from "../../demo/store";
import type { Role } from "../../demo/types";

const store = useDemoStore();
const message = useMessage();

const ROLES: Role[] = ["manager", "duty", "engineer", "water", "admin", "viewer"];

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  manager: "验收工单、发布岗位看板与模板",
  duty: "建单、确认告警、查看运行数据",
  engineer: "处理工单、追加测点、挂接档案",
  water: "查看水资源数据并创建工单",
  admin: "全部权限，含系统配置与演示场景",
  viewer: "仅可查看工艺数据，所有写入入口隐藏",
};

const SCOPE_LABELS: Record<PermissionScope, string> = {
  self: "本人",
  subsystem: "子系统",
  position: "岗位",
  global: "全局",
};

interface ActionMeta {
  action: Action;
  resource: string;
  label: string;
  scope: PermissionScope;
  layer: string;
}

const ACTIONS: ActionMeta[] = [
  {
    action: "process:read",
    resource: "工艺监控",
    label: "查看工艺图与设备抽屉",
    scope: "subsystem",
    layer: "菜单 + 按钮 + 命令",
  },
  {
    action: "asset:create",
    resource: "设备台账",
    label: "新增设备主数据",
    scope: "subsystem",
    layer: "按钮 + 命令",
  },
  {
    action: "point:add",
    resource: "测点",
    label: "为设备追加测点",
    scope: "subsystem",
    layer: "按钮 + 命令",
  },
  {
    action: "binding:write",
    resource: "工艺点位",
    label: "调整可视化绑定坐标",
    scope: "subsystem",
    layer: "按钮 + 命令",
  },
  {
    action: "document:attach",
    resource: "档案",
    label: "导入或删除档案引用",
    scope: "subsystem",
    layer: "按钮 + 命令",
  },
  {
    action: "workorder:create",
    resource: "工单",
    label: "创建与提交工单",
    scope: "self",
    layer: "菜单 + 按钮 + 命令",
  },
  {
    action: "workorder:handle",
    resource: "工单",
    label: "接单、填写处理结果",
    scope: "self",
    layer: "按钮 + 命令",
  },
  {
    action: "workorder:accept",
    resource: "工单",
    label: "验收或退回工单",
    scope: "position",
    layer: "按钮 + 命令",
  },
  {
    action: "alarm:ack",
    resource: "告警",
    label: "确认告警",
    scope: "subsystem",
    layer: "按钮 + 命令",
  },
  {
    action: "dashboard:edit:self",
    resource: "看板",
    label: "编辑本人保存的看板",
    scope: "self",
    layer: "菜单 + 按钮 + 命令",
  },
  {
    action: "template:publish",
    resource: "页面模板",
    label: "创建岗位/页面模板版本",
    scope: "position",
    layer: "菜单 + 按钮 + 命令",
  },
  {
    action: "scenario:write",
    resource: "演示场景",
    label: "切换与复位场景",
    scope: "global",
    layer: "菜单 + 按钮 + 命令",
  },
  {
    action: "audit:read",
    resource: "操作日志",
    label: "查看审计事件",
    scope: "global",
    layer: "菜单 + 按钮 + 命令",
  },
  {
    action: "admin:write",
    resource: "系统管理",
    label: "进入管理后台并导入配置",
    scope: "global",
    layer: "菜单 + 按钮 + 命令",
  },
  {
    action: "ai:ask",
    resource: "AI 工作台",
    label: "发起本地意图解析与问答",
    scope: "self",
    layer: "按钮 + 命令",
  },
  {
    action: "ai:write",
    resource: "AI 工作台",
    label: "记录 Agent 任务结果",
    scope: "self",
    layer: "按钮 + 命令",
  },
];

const currentRole = computed(() => store.role);
const isAdmin = computed(() => store.role === "admin");

function setRole(role: Role): void {
  if (role === store.role) return;
  store.setRole(role);
  if (role === "admin") {
    message.success(`已切换为「${roleNames[role]}」，全部管理权限即时生效`);
  } else {
    message.warning(
      `已切换为「${roleNames[role]}」。权限即时生效，但管理路由仅管理员可达，跳转或刷新会进入无权限页。`,
    );
  }
}

function allowed(role: Role, action: Action): boolean {
  return can(role, action);
}
</script>

<template>
  <div class="admin-page">
    <section class="admin-panel">
      <div class="panel-head">
        <div>
          <h2>角色权限矩阵</h2>
          <p>
            6 类演示角色 × 16 个动作。菜单、按钮、命令三层共用同一份角色矩阵，勾选表示允许。
          </p>
        </div>
        <NTag size="small" :bordered="false" type="info">
          当前角色：{{ roleNames[currentRole] }}
        </NTag>
      </div>

      <div class="layer-grid">
        <article class="layer-card">
          <span class="layer-index">1</span>
          <div>
            <strong>菜单层</strong>
            <p>路由 meta.permission 与侧边栏过滤，无权限不展示入口，直接访问跳转无权限页。</p>
          </div>
        </article>
        <article class="layer-card">
          <span class="layer-index">2</span>
          <div>
            <strong>按钮层</strong>
            <p>页面用 can(role, action) 禁用写操作按钮，并提示缺少的具体动作。</p>
          </div>
        </article>
        <article class="layer-card">
          <span class="layer-index">3</span>
          <div>
            <strong>命令层</strong>
            <p>store 写命令调用 assertCan，越权直接抛出 FORBIDDEN，不产生任何数据变更。</p>
          </div>
        </article>
      </div>

      <div class="role-switch">
        <span class="switch-label">切换演示角色</span>
        <div class="role-buttons">
          <button
            v-for="role in ROLES"
            :key="role"
            type="button"
            class="role-button"
            :class="{ active: currentRole === role }"
            @click="setRole(role)"
          >
            <strong>{{ roleNames[role] }}</strong>
            <small>{{ ROLE_DESCRIPTIONS[role] }}</small>
          </button>
        </div>
      </div>

      <p v-if="!isAdmin" class="warning-note">
        当前不是管理员：本页仍可查看矩阵，便于对比权限差异；返回顶栏切换为「系统管理员」后可继续使用其他管理页。
      </p>
      <p class="scope-note">
        scope 一期仅按角色矩阵判断（can 在 global / position 上额外收紧），用于后续数据范围过滤；本演示不按 scope
        裁剪列表数据。
      </p>

      <div class="matrix-wrap">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="action-col">动作</th>
              <th>资源</th>
              <th>说明</th>
              <th>scope</th>
              <th>校验层级</th>
              <th v-for="role in ROLES" :key="role" class="role-col">
                <span>{{ roleNames[role] }}</span>
                <small v-if="role === 'viewer'">只读</small>
                <small v-else-if="role === 'admin'">管理员</small>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="meta in ACTIONS" :key="meta.action">
              <td class="action-col">
                <code>{{ meta.action }}</code>
              </td>
              <td>{{ meta.resource }}</td>
              <td>{{ meta.label }}</td>
              <td>{{ SCOPE_LABELS[meta.scope] }}</td>
              <td class="layer-cell">{{ meta.layer }}</td>
              <td
                v-for="role in ROLES"
                :key="role"
                class="mark-cell"
                :class="{ granted: allowed(role, meta.action) }"
              >
                {{ allowed(role, meta.action) ? "✓" : "✗" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="legend">
        <span><span class="legend-mark granted">✓</span> 允许</span>
        <span><span class="legend-mark">✗</span> 拒绝</span>
        <span>只读访客仅保留 process:read；系统管理员拥有全部 16 个动作。</span>
      </div>
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
.layer-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.layer-card {
  display: flex;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid #e2edf4;
  border-radius: 8px;
  background: #fbfdff;
}
.layer-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e2f1fb;
  color: #1c6a99;
  font-size: 10px;
  font-weight: 600;
}
.layer-card strong {
  display: block;
  font-size: 11.5px;
  color: #1c3e57;
}
.layer-card p {
  margin: 3px 0 0;
  font-size: 10.5px;
  color: #7c93a5;
  line-height: 1.7;
}
.role-switch {
  padding: 10px;
  border: 1px solid #e2edf4;
  border-radius: 9px;
  background: #fbfdff;
}
.switch-label {
  display: block;
  margin-bottom: 7px;
  font-size: 11px;
  color: #6c8296;
}
.role-buttons {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}
.role-button {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 8px;
  border: 1px solid #dbe8f1;
  border-radius: 7px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  color: #33526b;
}
.role-button:hover {
  border-color: #9ccfe8;
  background: #f1f9fe;
}
.role-button.active {
  border-color: #247ba8;
  background: #eaf5fc;
  box-shadow: inset 2px 0 0 #247ba8;
}
.role-button strong {
  font-size: 11.5px;
  font-weight: 600;
}
.role-button small {
  font-size: 9.5px;
  color: #8ba0b2;
  line-height: 1.5;
}
.warning-note {
  margin: 10px 0 0;
  padding: 8px 10px;
  border: 1px dashed #e8c98f;
  border-radius: 7px;
  background: #fdf7ec;
  font-size: 11px;
  color: #8a5c15;
  line-height: 1.7;
}
.scope-note {
  margin: 8px 0 10px;
  font-size: 10.5px;
  color: #8296a8;
  line-height: 1.7;
}
.matrix-wrap {
  width: 100%;
  max-height: 56vh;
  overflow: auto;
  border: 1px solid #e6eff5;
  border-radius: 8px;
}
.matrix-table {
  width: 100%;
  min-width: 1060px;
  border-collapse: collapse;
  font-size: 11.5px;
}
.matrix-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 7px 8px;
  background: #f1f7fb;
  border-bottom: 1px solid #e6eef4;
  color: #6c8296;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.matrix-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #eef5fa;
  color: #2a4660;
  vertical-align: middle;
}
.matrix-table tbody tr:hover {
  background: #f4fafd;
}
.action-col {
  min-width: 154px;
}
.action-col code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: #247ba8;
}
.layer-cell {
  white-space: nowrap;
  color: #5d7387;
}
.role-col {
  text-align: center !important;
  min-width: 76px;
}
.role-col small {
  display: block;
  margin-top: 1px;
  font-size: 9px;
  color: #93a7b7;
}
.mark-cell {
  text-align: center;
  color: #b9c7d3;
  font-size: 13px;
}
.mark-cell.granted {
  color: #2f7a63;
  font-weight: 600;
}
.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 9px;
  font-size: 10.5px;
  color: #8296a8;
}
.legend-mark {
  display: inline-block;
  min-width: 14px;
  text-align: center;
  color: #b9c7d3;
  font-weight: 600;
}
.legend-mark.granted {
  color: #2f7a63;
}
@media (max-width: 1100px) {
  .role-buttons {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 860px) {
  .layer-grid,
  .role-buttons {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

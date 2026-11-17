import type { Role } from "./types";

export type Action =
  | "process:read"
  | "engineering:submit"
  | "engineering:review"
  | "asset:create"
  | "point:add"
  | "binding:write"
  | "diagram:publish"
  | "scene:write"
  | "document:attach"
  | "document:review"
  | "workorder:create"
  | "workorder:handle"
  | "workorder:accept"
  | "alarm:ack"
  | "alarm:close"
  | "dashboard:edit:self"
  | "template:publish"
  | "knowledge:save"
  | "knowledge:review"
  | "correlation:link"
  | "correlation:review"
  | "correlation:handle"
  | "handover:save"
  | "handover:review"
  | "energy:proposal"
  | "water:proposal"
  | "unattended:execute"
  | "unattended:confirm"
  | "scenario:write"
  | "audit:read"
  | "admin:write"
  | "ai:ask"
  | "ai:write";

export type PermissionScope = "self" | "subsystem" | "position" | "global";

const READ_ONLY: Action[] = ["process:read"];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  admin: new Set<Action>([
    "process:read",
    "engineering:submit",
    "engineering:review",
    "document:review",
    "knowledge:save",
    "knowledge:review",
    "correlation:handle",
    "correlation:link",
    "correlation:review",
    "energy:proposal",
    "handover:save",
    "handover:review",
    "water:proposal",
    "unattended:execute",
    "unattended:confirm",
    "asset:create",
    "point:add",
    "binding:write",
    "diagram:publish",
    "scene:write",
    "document:attach",
    "workorder:create",
    "workorder:handle",
    "workorder:accept",
    "alarm:ack",
    "alarm:close",
    "dashboard:edit:self",
    "template:publish",
    "scenario:write",
    "audit:read",
    "admin:write",
    "ai:ask",
    "ai:write",
  ]),
  manager: new Set<Action>([
    "process:read",
    "engineering:submit",
    "engineering:review",
    "document:review",
    "knowledge:save",
    "knowledge:review",
    "correlation:handle",
    "correlation:link",
    "correlation:review",
    "energy:proposal",
    "handover:save",
    "handover:review",
    "water:proposal",
    "unattended:execute",
    "unattended:confirm",
    "workorder:accept",
    "alarm:close",
    "dashboard:edit:self",
    "template:publish",
    "ai:ask",
  ]),
  duty: new Set<Action>([
    "process:read",
    "engineering:submit",
    "knowledge:save",
    "correlation:handle",
    "correlation:link",
    "energy:proposal",
    "handover:save",
    "water:proposal",
    "unattended:execute",
    "unattended:confirm",
    "workorder:create",
    "alarm:ack",
    "dashboard:edit:self",
    "ai:ask",
  ]),
  engineer: new Set<Action>([
    "process:read",
    "engineering:submit",
    "knowledge:save",
    "energy:proposal",
    "point:add",
    "workorder:handle",
    "document:attach",
    "dashboard:edit:self",
    "ai:ask",
  ]),
  water: new Set<Action>([
    "process:read",
    "engineering:submit",
    "water:proposal",
    "workorder:create",
    "dashboard:edit:self",
    "ai:ask",
  ]),
  viewer: new Set<Action>(READ_ONLY),
};

export const roleNames: Record<Role, string> = {
  manager: "管理者",
  duty: "值班运行员",
  engineer: "运维人员",
  water: "水资源/环保人员",
  admin: "系统管理员",
  viewer: "只读访客",
};

export interface ForbiddenError extends Error {
  code: "FORBIDDEN";
  role: Role;
  action: Action;
}

function forbidden(role: Role, action: Action): ForbiddenError {
  const error = new Error(
    `角色「${roleNames[role]}」无权执行 ${action}`,
  ) as ForbiddenError;
  error.name = "ForbiddenError";
  error.code = "FORBIDDEN";
  error.role = role;
  error.action = action;
  return error;
}

/**
 * 角色动作校验。scope 用于表达个人/岗位/子系统范围，
 * 一期在命令层只按角色矩阵判断，scope 保留给后续数据范围过滤。
 */
export function can(role: Role, action: Action, scope?: PermissionScope): boolean {
  if (!ROLE_PERMISSIONS[role].has(action)) return false;
  if (scope === "global") return role === "admin";
  if (scope === "position") return role === "admin" || role === "manager";
  return true;
}

export function assertCan(role: Role, action: Action, scope?: PermissionScope): void {
  if (!can(role, action, scope)) throw forbidden(role, action);
}

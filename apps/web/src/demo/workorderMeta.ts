import type { WorkOrderAction } from "./commands";
import type { Alarm, WorkOrder, WorkOrderPriority, WorkOrderStatus } from "./types";

export type TagType = "default" | "error" | "info" | "success" | "warning";

export const workOrderStatusLabels: Record<WorkOrderStatus, string> = {
  draft: "草稿",
  pending_dispatch: "待派单",
  in_progress: "维修中",
  pending_acceptance: "待验收",
  archived: "已归档",
  cancelled: "已取消",
};

export const workOrderStatusHints: Record<WorkOrderStatus, string> = {
  draft: "草稿尚未提交，可补充信息后提交待派单，也可取消。",
  pending_dispatch: "已提交待派单，具备处理权限的角色可接单并填写负责人。",
  in_progress: "维修处理中，完成后需填写原因、措施与材料并提交验收。",
  pending_acceptance: "等待验收：可通过归档，也可退回维修中。",
  archived: "已归档，流程结束，处理记录已派生到设备履历。",
  cancelled: "已取消，历史处理记录保留，不可再流转。",
};

export const workOrderSourceLabels: Record<WorkOrder["source"], string> = {
  alarm: "告警转单",
  inspection: "巡检异常",
  manual: "手工创建",
  health_trend: "健康趋势",
};

export const workOrderPriorityLabels: Record<WorkOrderPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

export const alarmLevelLabels: Record<Alarm["level"], string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

export const alarmKindLabels: Record<Alarm["kind"], string> = {
  production: "生产告警",
  business: "业务提醒",
};

export const alarmStatusLabels: Record<Alarm["status"], string> = {
  active: "活动",
  acknowledged: "已确认",
  closed: "已关闭",
};

export const workOrderActionLabels: Record<WorkOrderAction, string> = {
  submit: "提交待派单",
  start: "接单开始维修",
  complete: "提交处理结果",
  accept: "验收通过",
  reject: "验收不通过",
  cancel: "取消工单",
};

export const workOrderHistoryLabels: Record<string, string> = {
  create: "创建草稿",
  submit: "提交待派单",
  start: "接单",
  complete: "提交处理结果",
  accept: "验收归档",
  reject: "验收退回",
  cancel: "取消工单",
};

export function workOrderStatusTagType(status: WorkOrderStatus): TagType {
  switch (status) {
    case "draft":
      return "default";
    case "pending_dispatch":
      return "info";
    case "in_progress":
      return "warning";
    case "pending_acceptance":
      return "warning";
    case "archived":
      return "success";
    case "cancelled":
      return "default";
  }
}

export function workOrderPriorityTagType(priority: WorkOrderPriority): TagType {
  switch (priority) {
    case "urgent":
      return "error";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
      return "default";
  }
}

export function alarmLevelTagType(level: Alarm["level"]): TagType {
  switch (level) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
  }
}

export function workOrderUpdatedAt(order: WorkOrder): string {
  return order.history.length
    ? order.history[order.history.length - 1].at
    : order.createdAt;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地可读时间：YYYY-MM-DD HH:mm，不使用第三方库。 */
export function formatDateTime(value?: string | null): string {
  if (!value) return "未提供";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatTimeRange(from?: string | null, to?: string | null): string {
  if (!from && !to) return "未提供";
  return `${formatDateTime(from)} ~ ${formatDateTime(to)}`;
}

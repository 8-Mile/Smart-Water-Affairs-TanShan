/**
 * 全站语义色板：状态色唯一来源，各页面 KPI/标签统一引用，禁止散点硬编码
 */
export const STATUS_COLORS = {
  danger: '#f56c6c',
  warning: '#e6a23c',
  success: '#67c23a',
  info: '#909399',
  primary: 'var(--el-color-primary)',
  purple: '#7c6ef0',
} as const

/** 告警等级 → el-tag type */
export const ALARM_LEVEL_TAG: Record<number, 'danger' | 'warning' | 'info'> = {
  1: 'danger',
  2: 'warning',
  3: 'info',
}

/** 巡检 task_status → el-tag type */
export const INSPECTION_STATUS_TAG: Record<string, 'danger' | 'warning' | 'success' | 'info'> = {
  overdue: 'danger',
  pending: 'warning',
  completed: 'success',
}

/** 告警状态 → 中文标签 */
export const ALARM_STATUS_LABEL: Record<string, string> = {
  pending: '未处理',
  processing: '处理中',
  pending_accept: '待验收',
  closed: '已关闭',
  rejected: '已驳回',
  reopened: '重新处理中',
}

/** 告警状态 → el-tag type */
export const ALARM_STATUS_TAG: Record<string, 'danger' | 'warning' | 'primary' | 'success' | 'info'> = {
  pending: 'danger',
  processing: 'warning',
  pending_accept: 'primary',
  closed: 'success',
  rejected: 'info',
  reopened: 'warning',
}

/** 告警状态 → 胶囊样式类名（详情面板 dd-pill） */
export const ALARM_STATUS_PILL: Record<string, string> = {
  pending: 'is-red',
  processing: 'is-blue',
  pending_accept: 'is-purple',
  closed: 'is-green',
  rejected: 'is-purple',
  reopened: 'is-blue',
}

/** 告警等级(1/2/3) → 胶囊样式类名 */
export const ALARM_LEVEL_PILL: Record<number, string> = {
  1: 'is-red',
  2: 'is-orange',
  3: 'is-blue',
}

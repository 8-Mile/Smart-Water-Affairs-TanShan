import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface AlarmType {
  id: number
  name: string
  code: string
  description?: string
  status: number
}

export interface AlarmRule {
  id: number
  name: string
  equipment_id: number
  equipment_name?: string
  point_refs: string
  alarm_type_code: string
  alarm_level: number
  trigger_logic: string
  compare_op: string
  threshold: string
  delay_sec: number
  debounce_sec: number
  suppress_push_sec: number
  enabled: number
  status: number
  remark?: string
}

export interface AlarmItem {
  id: number
  rule_id: number
  rule_name: string
  equipment_id: number
  equipment_name: string
  equipment_code?: string
  location_name?: string
  alarm_type_code: string
  alarm_type_name?: string
  alarm_level: number
  alarm_status: string
  point_refs?: string
  trigger_value?: string
  trigger_detail?: string
  alarm_time: string
  end_time?: string
  handler_name?: string
  assignee_id?: number
  assignee_name?: string
  reject_reason?: string
  repair_id?: number
  accept_comment?: string
  handle_content?: string
  duration_sec?: number
  logs?: { action: string; operator_name?: string; detail?: string; created_at?: string }[]
  repair_order_no?: string
}

interface AlarmStatusTrend {
  key: string
  /** 近 24h 每小时新增（按当前状态归属） */
  series: number[]
  /** 环比上一 24h 周期百分比，上一周期为 0 时为 null */
  mom_pct: number | null
}

export interface AlarmStats {
  pending: number
  processing: number
  pending_accept: number
  closed: number
  rejected: number
  by_type: { name: string; count: number }[]
  by_level: { level: number; count: number }[]
  top_equipment: { name: string; count: number }[]
  status_trend?: AlarmStatusTrend[]
  /** 待指派：未闭环且未生成关联工单的告警数（实时页「待指派」卡） */
  unassigned?: number
  /** 互斥划分：未处理=pending且已派工、处理中=processing且已派工（无工单部分归入待指派） */
  pending_assigned?: number
  processing_assigned?: number
  /** 各等级近 14 天每日新增告警序列（历史告警 KPI 卡迷你柱状图） */
  level_trend?: { level: number; series: number[] }[]
}

export interface AlarmTrend24h {
  labels: string[]
  series: { name: string; level: number; color: string; data: number[] }[]
  total: number
}

interface HistorySummaryLevel {
  level: number
  key: string
  total: number
  last30: number
  prev30: number
  mom_pct: number | null
}

export interface AlarmHistorySummary {
  levels: HistorySummaryLevel[]
  processed: number
  rejected: number
  total: number
  process_rate: number
}

export function listAlarmTypes(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<AlarmType>>>('/alarms/types', { params })
}

export function createAlarmType(data: unknown) {
  return http.post<ApiResponse<AlarmType>>('/alarms/types', data)
}

export function updateAlarmType(id: number, data: unknown) {
  return http.put<ApiResponse<AlarmType>>(`/alarms/types/${id}`, data)
}

export function deleteAlarmType(id: number) {
  return http.delete<ApiResponse<boolean>>(`/alarms/types/${id}`)
}

export function alarmTypeOptions() {
  return http.get<ApiResponse<{ id: number; name: string; code: string }[]>>('/alarms/types/options')
}

export function listAlarmRules(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<AlarmRule>>>('/alarms/rules', { params })
}

export function createAlarmRule(data: unknown) {
  return http.post<ApiResponse<AlarmRule>>('/alarms/rules', data)
}

export function updateAlarmRule(id: number, data: unknown) {
  return http.put<ApiResponse<AlarmRule>>(`/alarms/rules/${id}`, data)
}

export function deleteAlarmRule(id: number) {
  return http.delete<ApiResponse<boolean>>(`/alarms/rules/${id}`)
}

export function copyAlarmRule(id: number) {
  return http.post<ApiResponse<AlarmRule>>(`/alarms/rules/${id}/copy`)
}

export function listAlarms(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<AlarmItem>>>('/alarms', { params })
}

export function getAlarm(id: number) {
  return http.get<ApiResponse<AlarmItem>>(`/alarms/${id}`)
}

export function fetchAlarmStats(params?: Record<string, unknown>) {
  return http.get<ApiResponse<AlarmStats>>('/alarms/stats', { params })
}

export function fetchAlarmTrend24h() {
  return http.get<ApiResponse<AlarmTrend24h>>('/alarms/trend-24h')
}

export function fetchAlarmHistorySummary() {
  return http.get<ApiResponse<AlarmHistorySummary>>('/alarms/history-summary')
}

/** 按日期范围的告警历史统计 */
export interface AlarmHistoryStats {
  total: number
  by_level: { level: number; name: string; count: number }[]
  processed: number
  process_rate: number
  top_types: { name: string; count: number }[]
}
export function fetchAlarmHistoryStats(params: { start_date: string; end_date: string }) {
  return http.get<ApiResponse<AlarmHistoryStats>>('/alarms/history-stats', { params })
}

/** 维修处理：管理员将告警一键转为维修工单（自动建单并绑定） */
export function repairHandle(id: number) {
  // silent：一次重开限制等 400 拦截由调用方弹窗展示，不走全局飘消息
  return http.post<ApiResponse<AlarmItem>>(`/alarms/${id}/repair-handle`, null, { silent: true })
}

/** 批量查询设备未闭环告警计数 + 最高等级：{ counts: { id: count }, highest_levels: { id: level } } */
export interface AlarmCountsResult {
  counts: Record<string, number>
  highest_levels: Record<string, number>
}
export function fetchAlarmCounts(equipmentIds?: number[]) {
  const params: Record<string, unknown> = {}
  if (equipmentIds?.length) {
    params.equipment_ids = equipmentIds.join(',')
  }
  return http.get<ApiResponse<AlarmCountsResult>>('/alarms/counts', { params })
}

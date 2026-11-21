import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface MaintPlan {
  id: number
  name: string
  plan_type: string
  start_date: string
  cycle_days: number
  advance_days: number
  equipment_ids: number[]
  equipment_names: string[]
  enabled: number
  /** 完成后是否需要验收：0/1 */
  need_accept?: number
  /** 默认执行人（新建必选）：手动派发预填、自动派发自动指派 */
  default_assignee_id?: number
  default_assignee_name?: string
  last_dispatch_date?: string
  /** 该计划下待执行任务数（record_status=pending） */
  pending_count?: number
  /** 该计划下待验收任务数（record_status=pending_accept） */
  accept_count?: number
  /** 该计划下逾期未执行任务数（pending 且到期日已过） */
  overdue_count?: number
  remark?: string
}

export interface MaintRecord {
  id: number
  plan_id?: number
  plan_name?: string
  equipment_id: number
  equipment_name?: string
  equipment_code?: string
  maintain_type: string
  record_status: string
  due_date?: string
  content?: string
  operator_name?: string
  operate_time?: string
  remark?: string
  acceptor_name?: string
  accept_time?: string
  accept_comment?: string
  source: string
  // 维保发现异常自动转出的维修工单号；有值时记录页显示「关联工单」跳转按钮
  repair_order_no?: string | null
}

export interface LedgerItem {
  id: number
  equipment_code?: string
  equipment_name?: string
  operate_type: string
  operator_name?: string
  operate_time?: string
  content?: string
  remark?: string
  source: string
}

export function listMaintPlans(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<MaintPlan>>>('/maintenance/plans', { params })
}
export function createMaintPlan(data: unknown) {
  return http.post<ApiResponse<MaintPlan>>('/maintenance/plans', data)
}
export function updateMaintPlan(id: number, data: unknown) {
  return http.put<ApiResponse<MaintPlan>>(`/maintenance/plans/${id}`, data)
}
export function deleteMaintPlan(id: number) {
  return http.delete<ApiResponse<boolean>>(`/maintenance/plans/${id}`)
}
export function dispatchMaintPlan(id: number, data?: { assignee_id?: number; remark?: string }) {
  return http.post<ApiResponse<{ count: number; items: MaintRecord[] }>>(
    `/maintenance/plans/${id}/dispatch`,
    data || {},
  )
}
export function listMaintRecords(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<MaintRecord>>>('/maintenance/records', { params })
}
export function createMaintRecord(data: unknown) {
  return http.post<ApiResponse<MaintRecord>>('/maintenance/records', data)
}
export function completeMaintRecord(
  id: number,
  data: { content?: string; remark?: string; issue_found?: string },
) {
  return http.post<ApiResponse<MaintRecord & { repair_order_no?: string | null }>>(
    `/maintenance/records/${id}/complete`,
    data,
  )
}
export function acceptMaintRecord(id: number, data: { passed: boolean; comment?: string }) {
  return http.post<ApiResponse<MaintRecord>>(`/maintenance/records/${id}/accept`, data)
}
export function listLedger(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<LedgerItem>>>('/maintenance/ledger', { params })
}

export function typeLabel(t: string) {
  return (
    {
      overhaul: '检修',
      lubrication: '润滑',
      repair: '维修',
      daily: '日常',
      weekly: '周保',
      monthly: '月保',
      quarter: '季保',
      half_year: '半年保',
      yearly: '年检',
      inspection: '巡检',
      calibration: '校准',
    } as Record<string, string>
  )[t] || t
}
export function recordStatusLabel(s: string) {
  return (
    ({ pending: '未开始', pending_accept: '待验收', done: '已完成', cancelled: '已取消' } as Record<
      string,
      string
    >)[s] || s
  )
}

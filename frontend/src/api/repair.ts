import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface RepairOrder {
  id: number
  order_no: string
  name: string
  equipment_id?: number
  equipment_name?: string
  equipment_code?: string
  /** 同设备已有未归档工单时返回其单号：设备级互斥，禁止并行派单 */
  equipment_blocker?: string
  alarm_id?: number
  /** 关联告警级别（仅告警来源工单返回）：一/二类紧急告警不允许驳回 */
  alarm_level?: number
  process_status: string
  description?: string
  source: string
  repair_type: string
  fault_category?: string
  fault_time?: string
  applicant_name?: string
  /** 申请人账号名：详情申请人字段展示账号名 */
  applicant_username?: string
  apply_time?: string
  approver_name?: string
  approve_time?: string
  approve_comment?: string
  worker_id?: number
  worker_name?: string
  /** 指派人员账号名：列表/详情维修人列展示账号名 */
  worker_username?: string
  process_start_time?: string
  process_end_time?: string
  process_feedback?: string
  process_images?: string
  acceptor_name?: string
  accept_time?: string
  accept_comment?: string
  logs?: {
    action: string
    operator_name?: string
    detail?: string
    created_at?: string
  }[]
}

export interface RepairStats {
  pending_dispatch: number
  processing: number
  pending_accept: number
  archived: number
  rejected: number
  total: number
}

export function listRepairs(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<RepairOrder>>>('/repairs', { params })
}

export function getRepair(id: number) {
  return http.get<ApiResponse<RepairOrder>>(`/repairs/${id}`)
}

/** 根据工单号查询工单详情（含流转日志）；用于档案详情的业务流程记录 */
export async function getRepairByOrderNo(orderNo: string) {
  const { data } = await listRepairs({ order_no: orderNo, page: 1, page_size: 1 })
  const items = data.data?.items
  if (!items || items.length === 0) return null
  const { data: detail } = await getRepair(items[0].id)
  return detail.data
}

export function createRepair(data: unknown) {
  return http.post<ApiResponse<RepairOrder>>('/repairs', data)
}

export function dispatchRepair(id: number, data: { worker_id: number; comment?: string }) {
  return http.post<ApiResponse<RepairOrder>>(`/repairs/${id}/dispatch`, data)
}

export function rejectRepair(id: number, comment?: string) {
  return http.post<ApiResponse<RepairOrder>>(`/repairs/${id}/reject`, { comment })
}

export function completeRepair(id: number, data: { feedback: string; images?: string }) {
  return http.post<ApiResponse<RepairOrder>>(`/repairs/${id}/complete`, data)
}

export function acceptRepair(id: number, pass_accept: boolean, comment?: string) {
  return http.post<ApiResponse<RepairOrder>>(`/repairs/${id}/accept`, {
    pass_accept,
    comment,
  })
}

export function fetchRepairStats() {
  return http.get<ApiResponse<RepairStats>>('/repairs/stats')
}

/** 按日期范围的工单历史统计 */
export interface RepairHistoryStats {
  total: number
  completed: number
  completion_rate: number
  avg_duration_hours: number
  by_type: { type: string; count: number }[]
}
export function fetchRepairHistoryStats(params: { start_date: string; end_date: string }) {
  return http.get<ApiResponse<RepairHistoryStats>>('/repairs/history-stats', { params })
}

/** 工单来源 → 中文标签 */
export function sourceLabel(s: string) {
  return (
    {
      alarm: '告警关联',
      inspection: '巡检关联',
      manual: '人工创建',
      maintenance: '维保转维修',
    } as Record<string, string>
  )[s] || s
}

export function statusLabel(s: string) {
  return (
    {
      pending_dispatch: '待派单',
      processing: '已派发',
      pending_accept: '待验收',
      archived: '已归档',
      rejected: '已驳回',
    } as Record<string, string>
  )[s] || s
}

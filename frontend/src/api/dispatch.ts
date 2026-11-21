import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface DispatchItem {
  id: number
  instruction_code: string
  instruction_type: string
  content: string
  priority: string
  publisher_id?: number
  publisher_name?: string
  publish_time?: string
  executor_id: number
  executor_name?: string
  expected_finish_time: string
  audit_status: string
  execute_status: string
  auditor_name?: string
  audit_time?: string
  audit_comment?: string
  execute_time?: string
  execute_feedback?: string
  logs?: {
    action: string
    operator_name?: string
    detail?: string
    created_at?: string
  }[]
}

export interface DispatchStats {
  today_count: number
  today_vs_yesterday: number
  pending_execute: number
  pending_audit: number
  completion_rate: number
  total: number
  approved: number
  rejected: number
  done: number
}

export function listDispatches(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<DispatchItem>>>('/dispatches', { params })
}
export function getDispatch(id: number) {
  return http.get<ApiResponse<DispatchItem>>(`/dispatches/${id}`)
}
export function createDispatch(data: unknown) {
  return http.post<ApiResponse<DispatchItem>>('/dispatches', data)
}
export function updateDispatch(id: number, data: unknown) {
  return http.put<ApiResponse<DispatchItem>>(`/dispatches/${id}`, data)
}
export function deleteDispatch(id: number) {
  return http.delete<ApiResponse<boolean>>(`/dispatches/${id}`)
}
export function auditDispatch(id: number, data: { passed: boolean; comment: string }) {
  return http.post<ApiResponse<DispatchItem>>(`/dispatches/${id}/audit`, data)
}
export function completeDispatch(id: number, feedback?: string) {
  return http.post<ApiResponse<DispatchItem>>(`/dispatches/${id}/complete`, { feedback })
}
export function fetchDispatchStats() {
  return http.get<ApiResponse<DispatchStats>>('/dispatches/stats')
}

export function typeLabel(t: string) {
  return ({ superior: '上级指令', internal: '内部指令' } as Record<string, string>)[t] || t
}
export function priorityLabel(p: string) {
  return ({ normal: '一般', important: '重要', urgent: '紧急' } as Record<string, string>)[p] || p
}
export function priorityType(p: string) {
  return ({ normal: 'info', important: 'warning', urgent: 'danger' } as Record<string, string>)[p] || 'info'
}
export function auditLabel(s: string) {
  return (
    { pending: '待审批', approved: '已通过', rejected: '已驳回' } as Record<string, string>
  )[s] || s
}
export function execLabel(s: string) {
  return (
    { pending: '待执行', done: '已完成', none: '—' } as Record<string, string>
  )[s] || s
}

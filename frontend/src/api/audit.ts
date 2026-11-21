import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface OperationLogItem {
  id: number
  user_id: number | null
  username: string | null
  module: string | null
  method: string
  path: string
  status_code: number
  ip: string | null
  user_agent: string | null
  duration_ms: number
  detail: string | null
  created_at: string
}

export type BizType = 'alarm' | 'repair' | 'inspection' | 'maintenance'

export interface BusinessLogItem {
  id: number
  biz_type: BizType
  biz_id: number
  biz_no: string
  biz_title: string | null
  action: string
  operator_name: string | null
  detail: string | null
  created_at: string
}

export interface AuditOptions {
  modules: string[]
  methods: string[]
}

/** 系统操作日志（写操作审计） */
export function listOperationLogs(params: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<OperationLogItem>>>('/audit/operation-logs', { params })
}

/** 业务流转日志（告警 / 维修工单动作聚合） */
export function listBusinessLogs(params: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<BusinessLogItem>>>('/audit/business-logs', { params })
}

/** 筛选下拉选项 */
export function fetchAuditOptions() {
  return http.get<ApiResponse<AuditOptions>>('/audit/options')
}

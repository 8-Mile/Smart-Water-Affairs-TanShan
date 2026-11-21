import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface WaterPlan {
  id: number
  plan_type: string
  plan_date: string
  plan_value: number
  remark?: string
}

export function listWaterPlans(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<WaterPlan>>>('/water-supply/plans', { params })
}
export function createWaterPlan(data: unknown) {
  return http.post<ApiResponse<WaterPlan>>('/water-supply/plans', data)
}
export function updateWaterPlan(id: number, data: unknown) {
  return http.put<ApiResponse<WaterPlan>>(`/water-supply/plans/${id}`, data)
}
export function deleteWaterPlan(id: number) {
  return http.delete<ApiResponse<boolean>>(`/water-supply/plans/${id}`)
}
export function fetchWaterStats(params?: Record<string, unknown>) {
  return http.get<ApiResponse<Record<string, unknown>>>('/water-supply/stats', { params })
}
export function fetchWaterCompare(params?: Record<string, unknown>) {
  return http.get<ApiResponse<Record<string, unknown>>>('/water-supply/compare', { params })
}

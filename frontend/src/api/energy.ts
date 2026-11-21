import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface ElecPrice {
  id: number
  name: string
  peak_price: number
  valley_price: number
  normal_price: number
  peak_hours: string
  valley_hours: string
  effective_from: string
  effective_to?: string
  remark?: string
  status: number
}

export function fetchEnergyStats(params?: Record<string, unknown>) {
  return http.get<ApiResponse<Record<string, unknown>>>('/energy/stats', { params })
}
export function fetchEnergyFee(params?: Record<string, unknown>) {
  return http.get<ApiResponse<Record<string, unknown>>>('/energy/fee', { params })
}
export function fetchWaterRatio(params?: Record<string, unknown>) {
  return http.get<ApiResponse<Record<string, unknown>>>('/energy/water-ratio', { params })
}

export interface EnergyEfficiencyItem {
  id: number
  stat_date: string
  unit_id: number
  unit_name: string
  electricity_kwh: number
  run_hours: number
  water_m3: number
  unit_consumption: number
  avg_power_kw: number
  load_rate: number
  efficiency: number
  sample_count: number
  remark?: string
}

/** 机组日能效指标（由时序数据自动计算） */
export function fetchEnergyEfficiency(params?: Record<string, unknown>) {
  return http.get<ApiResponse<EnergyEfficiencyItem[]>>('/energy/efficiency', { params })
}
export function listPrices(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<ElecPrice>>>('/energy/prices', { params })
}
export function createPrice(data: unknown) {
  return http.post<ApiResponse<ElecPrice>>('/energy/prices', data)
}
export function updatePrice(id: number, data: unknown) {
  return http.put<ApiResponse<ElecPrice>>(`/energy/prices/${id}`, data)
}
export function deletePrice(id: number) {
  return http.delete<ApiResponse<boolean>>(`/energy/prices/${id}`)
}

import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface ScadaPoint {
  id: number
  tag_name: string
  node_id: string
  value_type: string
  unit?: string
  description?: string
  sim_base: number
  sim_amplitude: number
  sim_period_sec: number
  enabled: number
  status: number
  latest_value?: unknown
  latest_ts_ms?: number
  status_name?: string
}

export interface ScadaLatest {
  point_id: number
  tag_name: string
  node_id: string
  value_type: string
  display_value?: unknown
  value_num?: number
  value_bool?: boolean
  value_str?: string
  status_name: string
  ts_ms: number
  unit?: string
  description?: string
  updated_at?: string
}

export interface ScadaRuntimeStatus {
  mode: string
  running: boolean
  endpoint: string
  interval_sec: number
  tick_count: number
  last_error?: string | null
  last_tick_at?: number | null
  last_sample_count: number
  started_at?: number | null
  opcua_endpoint_config: string
  auto_start: boolean
}

export interface ScadaConfig {
  mode: 'mock' | 'gateway' | 'opcua'
  gateway_url: string
  gateway_api_prefix: string
  gateway_token: string
  gateway_token_set: boolean
  ingest_token: string
  ingest_token_set: boolean
  data_source: 'mirror' | 'gateway'
  opcua_endpoint: string
  opcua_security_policy: string
  opcua_auth_mode: 'anonymous' | 'username'
  opcua_username: string
  opcua_password: string
  opcua_password_set: boolean
  sim_interval_sec: number
  auto_start: boolean
  source: 'saved' | 'env'
  updated_by?: string | null
  updated_at?: string | null
}

export interface ScadaConfigCheck {
  key: string
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface ScadaConfigTestResult {
  ok: boolean
  mode: string
  latency_ms: number
  checks: ScadaConfigCheck[]
}

export function fetchScadaConfig() {
  return http.get<ApiResponse<ScadaConfig>>('/scada/config')
}

export function saveScadaConfig(data: Record<string, unknown>) {
  return http.put<ApiResponse<ScadaConfig>>('/scada/config', data)
}

export function testScadaConfig(data: Record<string, unknown>) {
  return http.post<ApiResponse<ScadaConfigTestResult>>('/scada/config/test', data)
}

export function fetchScadaPoints(params: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<ScadaPoint>>>('/scada/points', { params })
}

export function createScadaPoint(data: unknown) {
  return http.post<ApiResponse<ScadaPoint>>('/scada/points', data)
}

export function updateScadaPoint(id: number, data: unknown) {
  return http.put<ApiResponse<ScadaPoint>>(`/scada/points/${id}`, data)
}

export function deleteScadaPoint(id: number) {
  return http.delete<ApiResponse<boolean>>(`/scada/points/${id}`)
}

export function fetchScadaLatest(params?: Record<string, unknown>) {
  return http.get<ApiResponse<ScadaLatest[]>>('/scada/latest', { params })
}

export function fetchScadaHistory(params: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<Record<string, unknown>>>>('/scada/history', {
    params,
  })
}

export function fetchRuntimeStatus() {
  return http.get<ApiResponse<ScadaRuntimeStatus>>('/scada/runtime/status')
}

export function startRuntime(data: { mode?: string; interval_sec?: number }) {
  return http.post<ApiResponse<ScadaRuntimeStatus>>('/scada/runtime/start', data)
}

export function stopRuntime() {
  return http.post<ApiResponse<ScadaRuntimeStatus>>('/scada/runtime/stop')
}

export function injectValue(data: {
  point_id?: number
  tag_name?: string
  value: unknown
  value_type?: string
}) {
  return http.post<ApiResponse<Record<string, unknown>>>('/scada/inject', data)
}

export function fetchUnitReportExport(params: {
  unit: string
  start?: string
  end?: string
}) {
  return http.get('/scada/history/export/unit-report', {
    params,
    responseType: 'blob',
  })
}

export function fetchEquipmentScadaValues(equipmentId: number) {
  return http.get<ApiResponse<Record<string, unknown>[]>>(
    `/scada/equipment/${equipmentId}/values`,
  )
}

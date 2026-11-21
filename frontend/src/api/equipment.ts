import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface EquipmentItem {
  id: number
  name: string
  code: string
  type_id: number
  type_name?: string
  scada_point_ids?: string
  manufacturer_id?: number
  manufacturer_name?: string
  department_id?: number
  department_name?: string
  location_id?: number
  location_name?: string
  production_date?: string
  purchase_date?: string
  first_run_date?: string
  maintainer_id?: number
  maintainer_name?: string
  maintain_term_days?: number
  running_status: string
  maintain_status: string
  /** 派生检修状态：pending=待检修（有待派单工单）/ overhaul=检修中（工单处置中）/ null=无 */
  repair_state?: 'pending' | 'overhaul' | null
  continuous_run_hours: number
  continuous_stop_hours: number
  remark?: string
  status: number
  /** 现场机组参数 */
  unit_no?: number | null
  pump_type?: string | null
  rated_power_kw?: number | null
  rated_current_a?: number | null
  rated_voltage_kv?: number | null
  rated_head_m?: number | null
  rated_flow_m3s?: number | null
  blade_angle_min?: number | null
  blade_angle_max?: number | null
  /** 是否接入实时/历史数据；false 表示台账登记但未接入，运行状态不可信 */
  has_data?: boolean | null
  /** 运行状态来源：scada=按 SCADA 运行点位派生（不可手工修改）；manual=台账手工维护 */
  run_status_source?: 'scada' | 'manual'
  /** 父设备 ID（顶级设备为 null） */
  parent_id?: number | null
  rated_params?: string | null
  /** 父设备名称 */
  parent_name?: string | null
  /** 子设备列表（tree=true 或详情接口返回） */
  children?: EquipmentItem[]
  /** 树节点是否为叶子（懒加载接口返回，false 表示还有下一层可展开） */
  is_leaf?: boolean
  /** 懒加载树节点：子树未闭环告警总数 / 最高等级（1紧急 2重要 3一般，0=无） / 未闭环工单总数 */
  alarm_total?: number
  alarm_level?: number
  repair_total?: number
}

export interface TimeoutWarning {
  equipment_id: number
  equipment_code: string
  equipment_name: string
  continuous_run_hours: number
  threshold_hours: number
  message: string
}

export interface EquipmentStats {
  total: number
  running: number
  /** 离线 = SCADA 运行状态非运行中（实时计算） */
  offline: number
  /** 派生检修状态计数：待检修（有待派单工单） */
  pending: number
  /** 派生检修状态计数：检修中（工单处置中） */
  overhaul: number
  fault: number
  running_ratio: number
  offline_ratio: number
  pending_ratio: number
  overhaul_ratio: number
  fault_ratio: number
  timeout_warnings: TimeoutWarning[]
}

export function fetchEquipmentStats() {
  return http.get<ApiResponse<EquipmentStats>>('/equipment/stats')
}

export function fetchEquipmentDetail(id: number) {
  return http.get<ApiResponse<EquipmentItem>>(`/equipment/${id}`)
}

export interface EquipmentSnapshot {
  scope: { equipment_id: number; equipment_name: string; children_count: number }
  points: {
    total: number
    online: number
    offline: number
    over_limit: number
    by_category: Record<string, number>
  }
  over_limit_points: Array<{
    tag_name: string
    description: string
    equipment_name: string | null
    value: number
    unit: string | null
    level: 'hihi' | 'hi' | 'lolo' | 'lo'
    threshold: number | null
  }>
  grouped_values: Record<string, Array<{
    tag_name: string
    display_name: string
    description: string
    equipment_name: string | null
    equipment_id: number
    point_category: string
    value: number | null
    is_bool: boolean
    is_online: boolean
    unit: string | null
    hi: number | null
    hihi: number | null
    lo: number | null
    lolo: number | null
    over_level: string | null
    freshness_sec: number | null
    updated_at: string | null
  }>>
  /** 关键指标：后端按 point_mapping 规则从点位中映射（在线优先） */
  metrics: Record<'current' | 'power' | 'bearing_temp', {
    label: string
    unit: string
    value: number | null
    tag_name: string | null
    is_online: boolean
  }>
  ops: {
    open_repairs: number
    open_alarms: number
    next_maintenance_date: string | null
    last_maintenance_at: string | null
  }
  freshness: { latest_update_at: string | null }
  /** 连续运行/停止态：连续时长只由 eq_run_event 推导；无事件时 since 为 null，累计值退回台账基线 */
  run_state: {
    running: boolean
    since: string | null            // ISO8601 起始时间
    continuous_seconds: number      // 当前连续秒数
    total_run_hours: number         // 累计运行小时（事件聚合，含未闭合段；无事件取台账）
    total_stop_hours: number        // 累计停机小时（事件聚合，含未闭合段；无事件取台账）
  }
}

export function fetchEquipmentSnapshot(id: number) {
  return http.get<ApiResponse<EquipmentSnapshot>>(`/equipment/${id}/snapshot`)
}

export function listEquipment(params: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<EquipmentItem>>>('/equipment', { params })
}

export function createEquipment(data: unknown) {
  return http.post<ApiResponse<EquipmentItem>>('/equipment', data)
}

export function updateEquipment(id: number, data: unknown) {
  return http.put<ApiResponse<EquipmentItem>>(`/equipment/${id}`, data)
}

export function deleteEquipment(id: number) {
  return http.delete<ApiResponse<boolean>>(`/equipment/${id}`)
}

/* ---- 设备运行记录 ---- */
export interface RunStat {
  equipment_id: number
  equipment_name?: string
  start_count: number
  stop_count: number
  /** 累计运行小时（含未闭合段） */
  run_hours: number
  /** 累计停机小时（含未闭合段） */
  stop_hours: number
  last_event_type?: string
  last_event_time?: string
  /** 当前连续段性质；无启停事件时为 null */
  current_state?: 'running' | 'stopped' | null
  current_since?: string | null
  current_hours: number
  current_seconds?: number
}
export function fetchRunStats(params: Record<string, unknown>) {
  return http.get<ApiResponse<RunStat[]>>('/equipment/run-stats', { params })
}

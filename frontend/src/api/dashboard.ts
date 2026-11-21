import http from './http'
import type { ApiResponse } from './types'

export interface PumpStatus {
  label: string
  name: string
  /** 台账设备 id：泵组卡片三段式信息面板按此精确关联，不再按名称猜测 */
  equipment_id: number
  running: boolean
}

interface FlowTrend {
  labels: string[]
  series: { name: string; data: (number | null)[] }[]
  unit: string
  title: string
}

export interface EnergyTrend {
  labels: string[]
  data: (number | null)[]
  unit: string
  title: string
  granularity: 'day' | 'week' | 'month'
  tag_count: number
}

interface InspectionRate {
  done: number
  doing: number
  todo: number
  rate: number
}

export interface DashboardOverview {
  /** 数据视角：mine=操作员「我的任务」收窄 / all=领导·超管全局总览（同一视图） */
  scope: 'all' | 'mine'
  pumps: PumpStatus[]
  flow_now: { inflow: number; outflow: number; unit: string }
  today_alarm_count: number
  flow_trend_24h: FlowTrend
  energy_trend: EnergyTrend
  inspection_rate: InspectionRate
  todos: {
    repairs: {
      id: number
      order_no: string
      name: string
      equipment_name?: string
      process_status: string
      worker_name?: string
      apply_time?: string
      repair_type?: string
    }[]
    alarms: {
      id: number
      rule_name: string
      equipment_name: string
      alarm_level: number
      alarm_status: string
      alarm_time: string
      trigger_value?: string
    }[]
    inspections: {
      id: number
      plan_name: string
      team_name?: string
      task_date: string
      task_status: string
    }[]
    /** 待验收维保（领导/超管视角，操作员为空数组） */
    maintenances: {
      id: number
      plan_name?: string
      equipment_name?: string
      maintain_type?: string
      due_date?: string
      operator_name?: string
    }[]
  }
  counts: {
    pending_repairs: number
    /** 待检修设备台数（未闭环维修工单的去重设备） */
    pending_repair_equipments: number
    pending_inspections: number
    /** 我的待办维保（操作员视角，其余角色为 0） */
    pending_maintenances: number
    active_alarms: number
  }
  system: {
    scada: { running: boolean; tick_count?: number; mode?: string }
    scheduler: { running: boolean; last_run_at?: number | null }
  }
}

export function fetchDashboardOverview() {
  return http.get<ApiResponse<DashboardOverview>>('/dashboard/overview')
}

export function fetchEnergyTrend(range: 'day' | 'week' | 'month') {
  return http.get<ApiResponse<EnergyTrend>>('/dashboard/energy-trend', {
    params: { range },
  })
}

/** 设备运维画像（工作台机组信息卡③段）：未闭环工单/告警 + 维保日程 */
export interface EquipmentOps {
  open_repairs: number
  open_alarms: number
  next_maintenance_date: string | null
  last_maintenance_at: string | null
}

export function fetchEquipmentOps(equipmentId: number) {
  return http.get<ApiResponse<EquipmentOps>>('/dashboard/equipment-ops', {
    params: { equipment_id: equipmentId },
  })
}

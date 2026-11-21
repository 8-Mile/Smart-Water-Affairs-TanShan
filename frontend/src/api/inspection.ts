import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface InspectionItem {
  equipment_id?: number | null
  equipment_name?: string | null
  check_item: string
}

interface InspectionResult extends InspectionItem {
  result: string
  remark?: string
  photo?: string
  /** 完成时刻归档的 SCADA 测点实时值快照，历史记录可追溯 */
  scada_snapshot?: ScadaSnapshotPoint[]
}

export interface ScadaSnapshotPoint {
  point_id?: number | null
  point_name?: string | null
  value?: number | boolean | string | null
  unit?: string | null
  /** ISO 格式时间戳（秒精度） */
  ts?: string | null
  /** 测点是否离线 */
  offline?: boolean
}

interface TaskScadaSnapshotItem extends InspectionItem {
  scada_points: ScadaSnapshotPoint[]
}

export interface TaskScadaSnapshot {
  task_id: number
  /** 快照生成时刻 ISO 字符串 */
  snapshot_ts: string
  items: TaskScadaSnapshotItem[]
}

export interface InspectionPlan {
  id: number
  name: string
  team_id: number
  team_name?: string
  start_date: string
  end_date: string
  frequency: string
  items: InspectionItem[]
  enabled: number
  last_dispatch_date?: string
  remark?: string
}

export interface InspectionTask {
  id: number
  plan_id: number
  plan_name: string
  team_id: number
  team_name?: string
  task_date: string
  task_status: string
  items: InspectionItem[]
  results?: InspectionResult[]
  assignee_id?: number | null
  assignee_name?: string | null
  executor_name?: string
  execute_time?: string
  source: string
}

export interface InspectionRecord {
  id: number
  task_id?: number | null
  plan_id?: number | null
  plan_name?: string
  team_id?: number | null
  team_name?: string
  record_date: string
  items_summary?: string
  has_abnormal: number
  executor_name?: string
  remark?: string
  results?: InspectionResult[]
  /** 对应巡检计划选择的设备 id 集合（发起工单的设备下拉范围） */
  equipment_ids?: number[]
  /** 已关联的维修工单号：有值时操作列显示「关联工单」跳转，不再显示「发起工单」 */
  repair_order_no?: string | null
  /** 最近一次被驳回的工单号/驳回理由：重新发起工单时弹窗内提示 */
  rejected_order_no?: string | null
  rejected_comment?: string | null
}

/** 巡检项展示：设备名·检查项（无设备名时仅显示检查项）；兼容历史字符串数组 */
export function formatInspItems(items?: Array<InspectionItem | string> | null): string {
  if (!items?.length) return ''
  return items
    .map((it) => {
      if (typeof it === 'string') return it
      return it.equipment_name ? `${it.equipment_name}·${it.check_item}` : it.check_item
    })
    .filter(Boolean)
    .join('、')
}

/** 按设备分组巡检项/结果：无设备名归入「通用」组 */
export function groupByEquipment<T extends { equipment_name?: string | null }>(
  rows?: T[] | null,
): { equipment_name: string; rows: T[] }[] {
  const groups: { equipment_name: string; rows: T[] }[] = []
  const map = new Map<string, T[]>()
  for (const r of rows || []) {
    const key = r.equipment_name || '__none__'
    if (!map.has(key)) {
      const list: T[] = []
      map.set(key, list)
      groups.push({ equipment_name: r.equipment_name || '通用', rows: list })
    }
    map.get(key)!.push(r)
  }
  return groups
}

export function listInspPlans(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<InspectionPlan>>>('/inspections/plans', { params })
}
export function createInspPlan(data: unknown) {
  return http.post<ApiResponse<InspectionPlan>>('/inspections/plans', data)
}
export function updateInspPlan(id: number, data: unknown) {
  return http.put<ApiResponse<InspectionPlan>>(`/inspections/plans/${id}`, data)
}
export function deleteInspPlan(id: number) {
  return http.delete<ApiResponse<boolean>>(`/inspections/plans/${id}`)
}
export function dispatchInspPlan(id: number, data?: { assignee_id?: number }) {
  return http.post<ApiResponse<InspectionTask>>(`/inspections/plans/${id}/dispatch`, data)
}
export function listInspTasks(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<InspectionTask>>>('/inspections/tasks', { params })
}
/** 认领班组任务（抢单）；并发落败时后端返回 400 */
export function claimInspTask(id: number) {
  return http.post<ApiResponse<InspectionTask>>(`/inspections/tasks/${id}/claim`)
}
export function getTaskScadaSnapshot(id: number) {
  return http.get<ApiResponse<TaskScadaSnapshot>>(`/inspections/tasks/${id}/scada-snapshot`)
}
export function completeInspTask(id: number, data: unknown) {
  return http.post<ApiResponse<InspectionRecord>>(`/inspections/tasks/${id}/complete`, data)
}
export function listInspRecords(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<InspectionRecord>>>('/inspections/records', { params })
}
export function createInspRecord(data: unknown) {
  return http.post<ApiResponse<InspectionRecord>>('/inspections/records', data)
}

export function taskStatusLabel(s: string) {
  return ({ pending: '待巡检', done: '已完成', overdue: '已超时' } as Record<string, string>)[s] || s
}

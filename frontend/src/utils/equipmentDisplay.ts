/**
 * 设备展示层通用映射：运行状态、分类图标/配色、告警等级、名称精简。
 * 台账页、下属设备卡、树节点共用，避免各页面各写一套。
 */
import type { EquipmentItem } from '@/api/equipment'

/** 设备分类 → 图标 */
const TYPE_ICON: Record<number, string> = {
  1: 'ri:settings-3-line',
  2: 'ri:door-open-line',
  3: 'ri:flashlight-line',
  4: 'ri:settings-2-line',
  5: 'ri:water-line',
}

/** 设备分类 → 主色 */
const TYPE_COLOR: Record<number, string> = {
  1: '#0e7ff0',
  2: '#10c99a',
  3: '#f08a24',
  4: '#8b67dd',
  5: '#26b6f5',
}

export function typeIcon(t?: number | null): string {
  return TYPE_ICON[t ?? 0] || 'ri:server-line'
}

export function typeColor(t?: number | null): string {
  return TYPE_COLOR[t ?? 0] || '#64748b'
}

/** 运行状态 → 文案 */
const RUN_LABEL: Record<string, string> = {
  running: '运行中',
  stopped: '已停机',
  overhaul: '已停机',
  fault: '故障',
  standby: '备用',
}

/** 运行状态 → el-tag 类型 */
const RUN_TAG: Record<string, string> = {
  running: 'success',
  stopped: 'danger',
  overhaul: 'danger',
  fault: 'danger',
  standby: 'warning',
}

export function runLabel(v: string): string {
  return RUN_LABEL[v] || v
}

export function runTag(v: string): string {
  return RUN_TAG[v] || 'info'
}

/** 告警等级颜色：1 紧急 / 2 重要 / 3 一般，0 无告警返回空串 */
const LEVEL_COLOR: Record<number, string> = { 1: '#ff3b5c', 2: '#f08a24', 3: '#0e7ff0' }

/** 告警等级文案 */
export const LEVEL_TEXT: Record<number, string> = { 1: '紧急', 2: '重要', 3: '一般' }

export function levelColor(level: number): string {
  return LEVEL_COLOR[level] ?? ''
}

/** 去掉「1号机组-」这类机组前缀，只保留设备名 */
export function shortName(name: string): string {
  const idx = name.indexOf('-')
  return idx >= 0 ? name.slice(idx + 1) : name
}

/** 树节点/缩略图图标：水位、监测类用专属水位图标，其余按分类 */
export function treeNodeIcon(d: { name: string; type_id?: number | null }): string {
  return /水位|监测站/.test(d.name) ? 'ri:water-percent-line' : typeIcon(d.type_id)
}

/** 设备自身告警数：优先本地计数表，懒加载节点用服务端子树汇总兜底 */
export function alarmCountOf(eq: EquipmentItem, counts: Record<string, number>): number {
  return counts[String(eq.id)] ?? eq.alarm_total ?? 0
}

/** 设备自身最高告警等级：同上，无本地计数时用服务端汇总值 */
export function alarmLevelOf(eq: EquipmentItem, levels: Record<string, number>): number {
  return levels[String(eq.id)] ?? eq.alarm_level ?? 0
}

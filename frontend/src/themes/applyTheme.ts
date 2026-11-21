import type { ThemeId } from './types'
import { getTheme } from './registry'

import './tokens/harbor.css'

/** 固定主题为 harbor（深蓝政务 / 浅色） */
const THEME_ID: ThemeId = 'harbor'

export function getAppTitle(): string {
  const t = (import.meta.env.VITE_APP_TITLE as string | undefined)?.trim()
  return t || '生产运维管理系统'
}

/** 将主题应用到 document：设置主色与色阶、圆角、标题 */
export function applyTheme(id?: ThemeId): ThemeId {
  const themeId = id ?? THEME_ID
  const theme = getTheme(themeId)
  const root = document.documentElement

  root.setAttribute('data-theme', theme.id)
  root.classList.remove('dark')

  // EP 主色与色阶（与 art-design-pro setElementThemeColor 的 mix 规则一致，1..9 全量）
  root.style.setProperty('--el-color-primary', theme.primary)
  for (let i = 1; i <= 9; i++) {
    root.style.setProperty(`--el-color-primary-light-${i}`, mixHex(theme.primary, '#ffffff', i / 10))
  }
  root.style.setProperty('--el-color-primary-dark-2', mixHex(theme.primary, '#000000', 0.2))

  // 统一圆角（对齐 art-design-pro 默认 customRadius = 0.75rem）
  root.style.setProperty('--custom-radius', '0.75rem')

  document.title = getAppTitle()
  return theme.id
}

function mixHex(a: string, b: string, weightB: number): string {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  if (!pa || !pb) return a
  const w = Math.min(1, Math.max(0, weightB))
  const r = Math.round(pa.r * (1 - w) + pb.r * w)
  const g = Math.round(pa.g * (1 - w) + pb.g * w)
  const bl = Math.round(pa.b * (1 - w) + pb.b * w)
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

import type { Component } from 'vue'

/** 主题标识：系统固定使用 harbor 主题 */
export type ThemeId = 'harbor'

export interface ThemeDefinition {
  id: ThemeId
  label: string
  primary: string
  layout: Component
  login: Component
}

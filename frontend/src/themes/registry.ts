import type { ThemeDefinition, ThemeId } from './types'
import EmberLayout from './layouts/EmberLayout.vue'
import EmberLogin from './login/EmberLogin.vue'

/**
 * 系统固定主题：harbor（深蓝政务 / 浅色）
 * 原四套主题（harbor/slate/orchid/ember）共用同一套布局与登录组件，
 * 仅主色不同；现已收敛为单一 harbor 主题，移除主题切换能力。
 */
const themes: Record<ThemeId, ThemeDefinition> = {
  harbor: {
    id: 'harbor',
    label: '深蓝政务',
    primary: '#1677ff',
    layout: EmberLayout,
    login: EmberLogin,
  },
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return themes[id] ?? themes.harbor
}

export { themes }

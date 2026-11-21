import { computed } from 'vue'
import { useUserStore } from '@/stores/user'

/** 角色代码（保持与后端 sys_role.code 一致；admin 即"领导"） */
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  LEADER: 'admin',
  OPERATOR: 'operator',
} as const

/** 全站按钮权限唯一入口：渲染显隐 / 点击拦截共用同一规则 */
export function usePermissions() {
  const userStore = useUserStore()
  const roleCode = computed(() => userStore.profile?.role_code || '')
  const myId = computed(() => userStore.profile?.id)

  const isSuper = computed(() => roleCode.value === ROLES.SUPER_ADMIN)
  /** 超管或领导 */
  const isManager = computed(
    () => roleCode.value === ROLES.SUPER_ADMIN || roleCode.value === ROLES.LEADER
  )

  /** 数据范围（后端 /auth/me 下发的角色 data_scope）：mine=仅本人数据 */
  const dataScope = computed(() => userStore.profile?.data_scope || 'all')
  /** 是否「仅本人」数据范围：各页 mine 筛选默认值统一由此派生，不再自判 roleCode */
  const isMineScope = computed(() => dataScope.value === 'mine')

  /**
   * 按钮权限码校验：
   * - 按后端 /auth/login、/auth/me 下发的实际授权码判断（超管不再通配，
   *   仅持有系统管理域权限码，与后端 require_perm 同口径）
   * - 其余一律不通过（perms 登录即刷新）
   */
  const hasPerm = (code: string) => {
    return userStore.perms.includes(code)
  }

  /** 批量校验：任一命中即通过 */
  const hasAnyPerm = (codes: string[]) => codes.some((c) => hasPerm(c))

  /** 全部校验：所有 code 都命中才通过 */
  const hasAllPerms = (codes: string[]) => codes.every((c) => hasPerm(c))

  return { roleCode, myId, isSuper, isManager, dataScope, isMineScope, hasPerm, hasAnyPerm, hasAllPerms }
}

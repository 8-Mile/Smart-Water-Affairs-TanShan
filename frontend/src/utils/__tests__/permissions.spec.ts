import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ROLES, usePermissions } from '@/utils/permissions'
import { useUserStore } from '@/stores/user'

/** 构造指定角色/权限码的登录态（与后端 /auth/login、/auth/me 下发结构一致） */
function setup(perms: string[], roleCode: string) {
  const store = useUserStore()
  store.profile = {
    id: 1,
    username: 'tester',
    display_name: '测试用户',
    role_code: roleCode,
    perms,
  } as never
  store.perms = perms
  return usePermissions()
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('usePermissions.hasPerm', () => {
  it('super_admin 不再直通：perms 为空一律拒绝（仅持有种子下发的系统管理域码）', () => {
    const { hasPerm } = setup([], ROLES.SUPER_ADMIN)
    expect(hasPerm('archive:upload')).toBe(false)
    expect(hasPerm('sys:user:delete')).toBe(false)
  })

  it('super_admin 按实际授权码放行：持有系统管理码即通过', () => {
    const { hasPerm } = setup(['sys:user:delete', 'sys:role:assign'], ROLES.SUPER_ADMIN)
    expect(hasPerm('sys:user:delete')).toBe(true)
    expect(hasPerm('archive:upload')).toBe(false)
  })

  it('持有权限码时放行，未持有时拒绝', () => {
    const { hasPerm } = setup(['archive:upload', 'eq:create'], ROLES.OPERATOR)
    expect(hasPerm('archive:upload')).toBe(true)
    expect(hasPerm('eq:create')).toBe(true)
    expect(hasPerm('archive:delete')).toBe(false)
    expect(hasPerm('sys:user:update')).toBe(false)
  })

  it("通配符 '*' 已失效：不再放行任何权限码", () => {
    const { hasPerm } = setup(['*'], ROLES.LEADER)
    expect(hasPerm('archive:upload')).toBe(false)
    expect(hasPerm('anything:at:all')).toBe(false)
  })

  it('取消权限码后（perms 列表更新）立即拒绝——按钮显隐跟随配置', () => {
    // 模拟管理员取消 archive:upload 后用户重新登录，perms 已不含该码
    const { hasPerm } = setup(['archive:list'], ROLES.OPERATOR)
    expect(hasPerm('archive:upload')).toBe(false)
  })

  it('role_code 为空（未登录态）不误放行', () => {
    const { hasPerm } = setup([], '')
    expect(hasPerm('dashboard:view')).toBe(false)
  })
})

describe('usePermissions.hasAnyPerm / hasAllPerms', () => {
  const p = ['a:b', 'c:d']

  it('hasAnyPerm：任一命中即通过', () => {
    const { hasAnyPerm } = setup(p, ROLES.OPERATOR)
    expect(hasAnyPerm(['x:y', 'a:b'])).toBe(true)
    expect(hasAnyPerm(['x:y', 'z:w'])).toBe(false)
  })

  it('hasAllPerms：全部命中才通过', () => {
    const { hasAllPerms } = setup(p, ROLES.OPERATOR)
    expect(hasAllPerms(['a:b', 'c:d'])).toBe(true)
    expect(hasAllPerms(['a:b', 'x:y'])).toBe(false)
  })
})

describe('ROLES 常量', () => {
  it('与后端 sys_role.code 保持一致', () => {
    expect(ROLES).toEqual({
      SUPER_ADMIN: 'super_admin',
      LEADER: 'admin',
      OPERATOR: 'operator',
    })
  })
})

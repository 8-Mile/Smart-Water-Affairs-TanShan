/**
 * v-perm —— 按钮级权限指令（无权限则移除元素）
 * 用法：<el-button v-perm="'repair:create'">新增</el-button>
 * 与 usePermissions().hasPerm 等效，但免除每个页面手动 import
 */
import type { Directive } from 'vue'
import { useUserStore } from '@/stores/user'

function check(el: HTMLElement, binding: { value: string | string[] }) {
  const store = useUserStore()
  const required = Array.isArray(binding.value) ? binding.value : [binding.value]
  const userPerms: string[] = store.perms || []
  const ok = required.some((p) => userPerms.includes(p))
  if (!ok) el.parentNode?.removeChild(el)
}

export const vPerm: Directive<HTMLElement, string | string[]> = {
  mounted(el, binding) {
    check(el, binding)
  },
}

export default vPerm

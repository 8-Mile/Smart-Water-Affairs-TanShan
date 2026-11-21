import { watch, type UnwrapRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 筛选状态与 URL query 双向同步：
 * - setup 时从 query 回填（进详情返回 / 来源页带参跳转后状态不丢）
 * - 状态变化时 replace 到 query（不产生历史记录）
 * 注意：需在调用 load() 之前执行，保证首次查询带筛选
 * @param opts.live 是否把状态变化实时写回 URL。
 *   传 false 时只做回填、不写回——页面按 fullPath 重挂载时，实时写回会导致
 *   每输入一个字符就重新挂载并重新查询（即"实时查询"），需配合「点击查询」生效
 */
export function useQueryState<T extends Record<string, any>>(
  state: T,
  opts: { live?: boolean } = {},
) {
  const route = useRoute()
  const router = useRouter()
  const live = opts.live !== false

  // 回填：按 state 当前值类型做数字转换
  for (const k of Object.keys(state)) {
    const v = route.query[k]
    if (v === undefined || v === '') continue
    const cur = state[k]
    ;(state as Record<string, any>)[k] = typeof cur === 'number' ? Number(v) : (v as string)
  }

  if (live) {
    watch(
      () => ({ ...state }) as Record<string, any>,
      (val) => {
        const query: Record<string, any> = { ...route.query }
        for (const k of Object.keys(val)) {
          if (val[k] === undefined || val[k] === '' || val[k] === null) delete query[k]
          else query[k] = String(val[k])
        }
        router.replace({ query })
      }
    )
  }

  return state as UnwrapRef<T>
}

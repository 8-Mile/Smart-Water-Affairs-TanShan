import { nextTick, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 跨页跳转定位：来源页带 ?focus=xxx 跳转，本页命中行高亮淡出 + 滚动到视口 + 顶部提示
 * @param field 用于匹配的行字段名（如 order_no / id / alarm_id）
 * @param opts.autoLocate query.focus 变化时是否自动滚动定位。
 *   默认 true（数据已在列表，直接定位）；页面自带 focus watch 重载逻辑（如巡检任务清筛选）传 false，由页面 load 后自行 locate
 */
export function useFocusRow(field: string, opts: { autoLocate?: boolean } = {}) {
  const autoLocate = opts.autoLocate !== false
  const route = useRoute()
  const router = useRouter()
  const focus = ref((route.query.focus as string) || '')
  const banner = ref(!!focus.value)
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  /** 应用新焦点：更新高亮与提示条，并按需滚动定位（重复点击同一条也会重新滚动/计时） */
  function applyFocus(val: string) {
    if (!val) return
    focus.value = val
    banner.value = true
    if (autoLocate) void locate()
  }

  // 同页点击通知（query.focus 变化）时同步焦点值；重新加载由页面自行触发
  watch(
    () => route.query.focus,
    (v) => {
      const val = (v as string) || ''
      if (val) applyFocus(val)
    },
  )

  // 同页且 focus 值不变（重复点击同一条消息，router.push 重复导航不触发 watch）时由事件兜底
  function onFocusEvent(e: Event) {
    const val = (e as CustomEvent<{ value?: string }>).detail?.value || ''
    if (!val) return
    focus.value = val
    banner.value = true
    void locate()
  }
  window.addEventListener('app:focus-row', onFocusEvent)
  onScopeDispose(() => window.removeEventListener('app:focus-row', onFocusEvent))

  function rowClassName({ row }: { row: Record<string, unknown> }) {
    return focus.value && String(row[field]) === focus.value ? 'row-focus' : ''
  }

  /** 列表加载完成后调用：滚动定位，6s 后移除高亮（配合 CSS 过渡淡出，给用户足够浏览时间） */
  async function locate() {
    if (!focus.value) return
    await nextTick()
    // 未渲染（数据未加载/被筛掉）时不滚动，仅走淡出清理，避免高亮常驻
    document.querySelector('.row-focus')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      focus.value = ''
    }, 6000)
  }

  /** 关闭定位提示并清理 URL 参数 */
  function dismiss() {
    banner.value = false
    focus.value = ''
    if (hideTimer) clearTimeout(hideTimer)
    const query = { ...route.query }
    delete query.focus
    router.replace({ query })
  }

  return { focus, banner, rowClassName, locate, dismiss }
}

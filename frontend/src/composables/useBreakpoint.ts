/**
 * useBreakpoint —— JS 侧断点判定（档位与 assets/styles/core/breakpoints.scss 一致）
 * 纯 CSS 能解决的布局问题不要用本 composable；仅在需要切换组件形态时使用
 * （如 ProTable 卡片模式、ProSearchBar 折叠模式）。
 * @example
 * const { isMobile, isTablet } = useBreakpoint()
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

export const BP = { mobile: 768, tablet: 1024, laptop: 1280, wide: 1600 } as const

export function useBreakpoint() {
  /** ≤768：手机（卡片列表、抽屉、折叠筛选） */
  const isMobile = ref(false)
  /** ≤1024：平板（侧栏收起、双栏堆叠） */
  const isTablet = ref(false)
  /** ≤1280：小桌面 */
  const isLaptop = ref(false)
  /** ≤1600：大屏以内 */
  const isWide = ref(false)

  const mqs: Array<[MediaQueryList, (e: MediaQueryListEvent | MediaQueryList) => void]> = []

  function bind(mq: MediaQueryList, target: typeof isMobile) {
    const sync = (e: MediaQueryListEvent | MediaQueryList) => {
      target.value = e.matches
    }
    sync(mq)
    mq.addEventListener('change', sync)
    mqs.push([mq, sync])
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    bind(window.matchMedia(`(max-width: ${BP.mobile}px)`), isMobile)
    bind(window.matchMedia(`(max-width: ${BP.tablet}px)`), isTablet)
    bind(window.matchMedia(`(max-width: ${BP.laptop}px)`), isLaptop)
    bind(window.matchMedia(`(max-width: ${BP.wide}px)`), isWide)
  })

  onBeforeUnmount(() => {
    mqs.forEach(([mq, sync]) => mq.removeEventListener('change', sync))
    mqs.length = 0
  })

  return { isMobile, isTablet, isLaptop, isWide }
}

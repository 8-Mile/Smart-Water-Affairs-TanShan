/**
 * v-count-up —— 数字滚动入场指令（Hydro Command）
 * 用法：<span v-count-up="value">；v-count-up:2 指定 2 位小数
 * 仅对数字生效；非数字（如“运行正常”“—”）原样渲染。
 * prefers-reduced-motion 下直接显示终值。
 */
import type { Directive } from 'vue'

interface CountUpState {
  raf?: number
  from?: number
  to?: number
  decimals?: number
  startTs?: number
  lastText?: string
}

const DURATION = 900

function parse(el: HTMLElement, binding: { value: unknown; arg?: string }) {
  const to = typeof binding.value === 'string' ? Number(binding.value) : binding.value
  if (typeof to !== 'number' || !Number.isFinite(to)) return null
  const decimals = binding.arg ? Number(binding.arg) || 0 : Number.isInteger(to) ? 0 : 1
  return { to, decimals }
}

function format(v: number, decimals: number) {
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export const countUp: Directive<HTMLElement, unknown> = {
  mounted(el, binding) {
    const parsed = parse(el, binding)
    const state: CountUpState = {}
    ;(el as HTMLElement & { __countUp?: CountUpState }).__countUp = state
    if (!parsed) return

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = format(parsed.to, parsed.decimals)
      return
    }
    state.from = 0
    state.to = parsed.to
    state.decimals = parsed.decimals
    state.startTs = performance.now()
    el.textContent = format(0, parsed.decimals)
    const tick = (now: number) => {
      const s = (el as HTMLElement & { __countUp?: CountUpState }).__countUp
      if (!s || s.to == null) return
      const p = Math.min(1, (now - (s.startTs as number)) / DURATION)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3)
      el.textContent = format((s.from as number) + (s.to - (s.from as number)) * eased, s.decimals as number)
      if (p < 1) s.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)
  },
  updated(el, binding) {
    const state = (el as HTMLElement & { __countUp?: CountUpState }).__countUp
    const parsed = parse(el, binding)
    if (!parsed || !state) {
      if (!parsed) el.textContent = String(binding.value ?? '')
      return
    }
    if (state.raf) cancelAnimationFrame(state.raf)
    // 从当前显示值平滑过渡到新值
    const current = Number(String(el.textContent).replace(/[^\d.-]/g, ''))
    state.from = Number.isFinite(current) ? current : 0
    state.to = parsed.to
    state.decimals = parsed.decimals
    state.startTs = performance.now()
    const tick = (now: number) => {
      const s = (el as HTMLElement & { __countUp?: CountUpState }).__countUp
      if (!s || s.to == null) return
      const p = Math.min(1, (now - (s.startTs as number)) / DURATION)
      const eased = 1 - Math.pow(1 - p, 3)
      el.textContent = format((s.from as number) + (s.to - (s.from as number)) * eased, s.decimals as number)
      if (p < 1) s.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)
  },
  unmounted(el) {
    const state = (el as HTMLElement & { __countUp?: CountUpState }).__countUp
    if (state?.raf) cancelAnimationFrame(state.raf)
  },
}

export default countUp

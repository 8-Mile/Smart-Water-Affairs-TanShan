<template>
  <span class="nr">
    <span v-if="prefix" class="nr-affix nr-prefix">{{ prefix }}</span>
    <span ref="numRef" class="nr-num">{{ display }}</span>
    <span v-if="suffix" class="nr-affix nr-suffix">{{ suffix }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue'

type EasingName =
  | 'linear'
  | 'easeOutQuad'
  | 'easeOutCubic'
  | 'easeOutQuart'
  | 'easeOutQuint'
  | 'easeOutExpo'
  | 'easeInOutCubic'

type AnimState = 'idle' | 'running' | 'paused' | 'finished'

const props = withDefaults(defineProps<{
  /** 目标值 */
  to: number
  /** 起始值（animateOnMount 时生效） */
  from?: number
  /** 动画时长 ms */
  duration?: number
  /** 小数位数 */
  decimals?: number
  /** 千分位分隔符，如 "," */
  separator?: string
  /** 前缀，如 "¥" */
  prefix?: string
  /** 后缀，如 "条" */
  suffix?: string
  /** 缓动函数名或自定义函数 */
  easing?: EasingName | ((t: number) => number)
  /** 首次挂载是否播放动画（从 from 滚到 to） */
  animateOnMount?: boolean
  /** 是否自动播放；false 时需手动调用 start() */
  autoplay?: boolean
  /** 自动播放延迟 ms */
  delay?: number
  /** 是否遵循系统「减少动态效果」偏好 */
  respectReducedMotion?: boolean
  /** 重播标识：值变化时即使数值没变也从头重播一次（用于日期切换等场景） */
  replayKey?: string | number
}>(), {
  from: 0,
  duration: 1400,
  decimals: 0,
  separator: '',
  prefix: '',
  suffix: '',
  easing: 'easeOutQuart',
  animateOnMount: true,
  autoplay: true,
  delay: 0,
  respectReducedMotion: true,
  replayKey: undefined,
})

const emit = defineEmits<{
  (e: 'start', p: { from: number; to: number }): void
  (e: 'progress', p: { value: number; progress: number; text: string }): void
  (e: 'end', p: { value: number }): void
  (e: 'pause', p: { value: number }): void
  (e: 'resume', p: { value: number }): void
}>()

const attrs = useAttrs()
const instance = getCurrentInstance()

const numRef = ref<HTMLElement | null>(null)
/** 当前画面上的数值（用于打断后从当前位置继续滚） */
const currentVal = ref(props.to)
const state = ref<AnimState>('idle')

/** 初始文本：一个 0（有小数位则为 0.xx） */
const display = ref(props.decimals > 0 ? (0).toFixed(props.decimals) : '0')

const isAnimating = computed(() => state.value === 'running')

/* ---------------- 缓动 ---------------- */
const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeOutQuint: (t) => 1 - Math.pow(1 - t, 5),
  easeOutExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
}

function getEasing(): (t: number) => number {
  return typeof props.easing === 'function' ? props.easing : (EASINGS[props.easing] ?? EASINGS.easeOutQuart)
}

/* ---------------- 文本格式化（带缓存，避免无谓的 DOM 写入） ---------------- */
let lastText = ''
function formatValue(v: number): string {
  const fixed = props.decimals > 0 ? v.toFixed(props.decimals) : String(Math.round(v))
  let out = fixed
  if (props.separator) {
    const dot = fixed.indexOf('.')
    const intPart = dot === -1 ? fixed : fixed.slice(0, dot)
    const decPart = dot === -1 ? '' : fixed.slice(dot)
    const sign = intPart.startsWith('-') ? '-' : ''
    const digits = sign ? intPart.slice(1) : intPart
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, props.separator)
    out = sign + grouped + decPart
  }
  return out
}

function paint(v: number) {
  const t = formatValue(v)
  if (t !== lastText) {
    lastText = t
    display.value = t
  }
}

/* ---------------- 动画核心 ---------------- */
let rafId = 0
let startTs = 0
let elapsed = 0
let fromVal = 0
let toVal = 0
let timerId: number | null = null
let destroyed = false

const wantsProgress = () =>
  !!attrs.onProgress || !!instance?.vnode.props?.onProgress

function tick(now: number) {
  if (destroyed) return
  elapsed = now - startTs
  const dur = props.duration
  const t = dur <= 0 ? 1 : Math.min(elapsed / dur, 1)
  const eased = getEasing()(t)
  const v = fromVal + (toVal - fromVal) * eased
  currentVal.value = v
  paint(v)

  if (wantsProgress()) {
    // 按小数位取整后再上报，避免高频浮点噪音
    const rounded = props.decimals > 0
      ? Number(v.toFixed(props.decimals))
      : Math.round(v)
    emit('progress', { value: rounded, progress: t, text: display.value })
  }

  if (t < 1) {
    rafId = requestAnimationFrame(tick)
  } else {
    finishAnim()
  }
}

function finishAnim() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  currentVal.value = toVal
  paint(toVal)
  state.value = 'finished'
  emit('end', { value: props.decimals > 0 ? Number(toVal.toFixed(props.decimals)) : Math.round(toVal) })
}

/** 开始动画：可指定起点/终点，不传则用 from / to */
function start(fromArg?: number, toArg?: number) {
  if (destroyed) return
  const f = fromArg ?? props.from
  const t = toArg ?? props.to

  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  if (timerId !== null) { window.clearTimeout(timerId); timerId = null }

  fromVal = f
  toVal = t

  const reduced = props.respectReducedMotion
    && typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // 无差值 / 时长为 0 / 用户要求减少动效 → 直接落位
  if (Math.abs(t - f) < Math.pow(10, -props.decimals) / 2 || props.duration <= 0 || reduced) {
    currentVal.value = t
    paint(t)
    state.value = 'finished'
    emit('start', { from: f, to: t })
    emit('end', { value: props.decimals > 0 ? Number(t.toFixed(props.decimals)) : Math.round(t) })
    return
  }

  state.value = 'running'
  emit('start', { from: f, to: t })
  elapsed = 0
  startTs = performance.now()
  rafId = requestAnimationFrame(tick)
}

function pause() {
  if (state.value !== 'running' || !rafId) return
  cancelAnimationFrame(rafId)
  rafId = 0
  state.value = 'paused'
  emit('pause', { value: props.decimals > 0 ? Number(currentVal.value.toFixed(props.decimals)) : Math.round(currentVal.value) })
}

function resume() {
  if (state.value !== 'paused') return
  state.value = 'running'
  emit('resume', { value: props.decimals > 0 ? Number(currentVal.value.toFixed(props.decimals)) : Math.round(currentVal.value) })
  // 用已消耗时间续跑，保证总时长不变
  startTs = performance.now() - elapsed
  rafId = requestAnimationFrame(tick)
}

function reset(value?: number) {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  if (timerId !== null) { window.clearTimeout(timerId); timerId = null }
  const v = value ?? props.from
  fromVal = v
  toVal = props.to
  currentVal.value = v
  paint(v)
  state.value = 'idle'
}

function finish() {
  if (state.value === 'running' || state.value === 'paused') finishAnim()
}

/* ---------------- 生命周期 ---------------- */
onMounted(() => {
  const init = () => {
    if (props.autoplay && props.animateOnMount) {
      start(props.from, props.to)
    } else {
      currentVal.value = props.to
      paint(props.to)
      state.value = 'finished'
    }
  }
  if (props.autoplay && props.animateOnMount && props.delay > 0) {
    timerId = window.setTimeout(() => { timerId = null; init() }, props.delay)
  } else {
    init()
  }
})

/** 目标值变化：从当前画面值无缝续滚（而不是从上一次的目标值） */
watch(() => props.to, (newTo) => {
  if (destroyed) return
  if (state.value === 'idle') {
    // reset() 之后等外部显式 start()
    toVal = newTo
    return
  }
  if (!props.autoplay) {
    currentVal.value = newTo
    paint(newTo)
    state.value = 'finished'
    return
  }
  start(currentVal.value, newTo)
})

/** replayKey 变化：即使数值未变，也从头重播一次（日期切换的视觉反馈） */
watch(() => props.replayKey, () => {
  if (destroyed || !props.autoplay) return
  start(props.from, props.to)
})

/** 格式相关 props 变化时，空闲状态下重绘文本 */
watch(
  () => [props.decimals, props.separator, props.prefix, props.suffix],
  () => {
    if (state.value === 'running' || state.value === 'paused') return
    currentVal.value = props.to
    paint(props.to)
  },
)

onBeforeUnmount(() => {
  destroyed = true
  if (rafId) cancelAnimationFrame(rafId)
  if (timerId !== null) window.clearTimeout(timerId)
})

defineExpose({
  /** 开始动画，可指定端点；不传则用 from/to */
  start,
  /** 暂停（保留进度） */
  pause,
  /** 继续 */
  resume,
  /** 重置到指定值（默认 from），不会自动播放 */
  reset,
  /** 立即结束并落位到目标值 */
  finish,
  /** 当前状态：idle | running | paused | finished */
  state,
  /** 当前显示数值 */
  value: currentVal,
  /** 当前文本 */
  text: display,
  /** 是否正在动画 */
  isAnimating,
})
</script>

<style scoped>
.nr {
  display: inline-flex;
  align-items: baseline;
  white-space: nowrap;
  line-height: inherit;
}
.nr-num {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  line-height: inherit;
  white-space: nowrap;
  /* 等宽数字，滚动时不会左右抖动 */
}
.nr-affix {
  font-size: 0.62em;
  font-weight: 500;
  opacity: 0.72;
  margin: 0 2px;
}
</style>

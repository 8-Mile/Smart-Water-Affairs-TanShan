/**
 * Hydro Command —— echarts 统一图表主题
 * 全站图表共用：青蓝色板、虚线横向网格、无轴线刻度、深色玻璃 tooltip、面积渐变
 */
import echarts from '@/utils/echarts'

/** 品牌序列色（控制蓝 → 数据青 → 语义色） */
export const HYDRO_COLORS = {
  blue: '#0e7ff0',
  cyan: '#06b6d4',
  cyanBright: '#22d3ee',
  ink: '#0b1e33',
  red: '#ef4444',
  orange: '#f59e0b',
  green: '#10b981',
  purple: '#8b5cf6',
  gray: '#94a3b8',
}

/** 深色玻璃 tooltip（指挥舱质感） */
export const hydroTooltip = {
  backgroundColor: 'rgba(8, 26, 46, 0.92)',
  borderColor: 'rgba(34, 211, 238, 0.35)',
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: '#e8f4ff', fontSize: 12 },
  extraCssText:
    'border-radius:10px;box-shadow:0 10px 28px -8px rgba(6,30,58,.55);backdrop-filter:blur(6px);',
}

export const hydroGrid = { left: 8, right: 12, top: 30, bottom: 4, containLabel: true }

/**
 * 图表动效统一预设：数据加载完成后渐进式入场，按图表类型分化——
 * 折线沿路径逐段绘制（1s）/ 柱图从 0 轴逐根生长（错峰 45ms）/ 环形从起始角旋转填充。
 * 数据变更走 450ms 更新过渡；reduced-motion 下关闭动画直出终态。
 * 动画为 canvas 层 transform 过渡，不阻塞 hover/tooltip 等交互。
 */
function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** 折线：沿路径从起点逐段绘制（ECharts clip 揭示动画），数据点随线条同步出现 */
export function lineMotion() {
  const off = reducedMotion()
  return {
    animation: !off,
    animationDuration: 1000,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: 450,
    animationEasingUpdate: 'cubicOut' as const,
  }
}

/** 柱状：从底部 0 轴向上生长，每根按序列 45ms 错峰展开（>12 根封顶，避免拖尾掉帧） */
export function barMotion() {
  const off = reducedMotion()
  return {
    animation: !off,
    animationDuration: 800,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: 450,
    animationEasingUpdate: 'cubicOut' as const,
    animationDelay: (idx: number) => Math.min(idx, 12) * 45,
    animationDelayUpdate: (idx: number) => Math.min(idx, 12) * 20,
  }
}

/** 环形/饼图：从起始角旋转填充至最终占比，扇区平滑展开 */
export function pieMotion() {
  const off = reducedMotion()
  return {
    animation: !off,
    animationDuration: 900,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: 450,
    animationEasingUpdate: 'cubicOut' as const,
  }
}

/**
 * 初始化图表并包装 setOption：延迟到浏览器空闲帧再执行。
 * 挂载阶段主线程繁忙会把入场动画压缩掉（首帧即终态），
 * 双 rAF 保证 setOption 落在空闲帧，折线/柱/环形的入场动画完整播放。
 */
export function initMotionChart(el: HTMLElement) {
  const chart = echarts.init(el)
  const raw = chart.setOption.bind(chart) as (o: unknown, n?: boolean | object) => void
  ;(chart as unknown as { setOption: (o: unknown, n?: boolean | object) => void }).setOption = (
    option,
    notMerge,
  ) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!chart.isDisposed()) raw(option, notMerge)
      })
    })
  }
  return chart
}

const axisLabelBase = { color: '#8a97a8', fontSize: 10 }
const splitLineStyle = { color: '#e6edf5', type: 'dashed' as const }

export const hydroCategoryAxis = (data: string[], extra: Record<string, unknown> = {}) => ({
  type: 'category' as const,
  data,
  boundaryGap: false,
  axisTick: { show: false },
  axisLine: { lineStyle: { color: '#dce5f0' } },
  axisLabel: { ...axisLabelBase, interval: 3 },
  ...extra,
})

export const hydroValueAxis = (extra: Record<string, unknown> = {}) => ({
  type: 'value' as const,
  axisTick: { show: false },
  axisLine: { show: false },
  axisLabel: axisLabelBase,
  splitLine: { lineStyle: splitLineStyle },
  ...extra,
})

/** 面积渐变（主色纵向淡出） */
function hydroAreaGradient(color: string, from = 0.2, to = 0.02) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: hexToRgba(color, from) },
    { offset: 1, color: hexToRgba(color, to) },
  ])
}

/** 平滑折线序列（圆触点 + 面积渐变） */
export function hydroLineSeries(name: string, data: (number | null)[], color: string) {
  return {
    name,
    type: 'line' as const,
    smooth: true,
    symbol: 'circle',
    symbolSize: 5,
    showSymbol: false,
    lineStyle: { width: 2.5, color },
    itemStyle: { color, borderColor: '#fff', borderWidth: 1.5 },
    emphasis: { focus: 'series' as const, scale: 1.4 },
    areaStyle: { color: hydroAreaGradient(color) },
    ...lineMotion(),
    data,
  }
}

/** 柱状序列（纵向渐变、圆角、柱宽 40%） */
export function hydroBarSeries(
  name: string,
  data: (number | null)[],
  color = HYDRO_COLORS.blue,
  extra: Record<string, unknown> = {},
) {
  return {
    name,
    type: 'bar' as const,
    barWidth: '42%',
    itemStyle: {
      borderRadius: [4, 4, 0, 0],
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: color },
        { offset: 1, color: hexToRgba(color, 0.45) },
      ]),
    },
    ...barMotion(),
    ...extra,
    data,
  }
}

/** 环形图序列（双层：底色环 + 数据段，参考设计图风格） */
export function hydroDonutSeries(
  data: { value: number; name: string; itemStyle?: { color: string } }[],
  emptyColor = '#e3ebf5',
): Record<string, unknown>[] {
  const total = data.reduce((s, d) => s + (d.value || 0), 0) || 1

  // 底层：整圈底色环（浅色，silent 不响应交互，整圈完整无缝）
  const bg = {
    type: 'pie' as const,
    radius: ['60%', '88%'],
    center: ['50%', '50%'],
    startAngle: 120,
    silent: true,
    ...pieMotion(),
    label: { show: false },
    labelLine: { show: false },
    itemStyle: { borderWidth: 0, borderRadius: 0 },
    data: [
      {
        value: total,
        name: '__bg__',
        itemStyle: { color: emptyColor },
        tooltip: { show: false },
      },
    ],
  }

  // 上层：数据段（叠加在底色环上，窄环 + 端帽圆角 + 无白色间隙）
  const fg = {
    type: 'pie' as const,
    radius: ['60%', '88%'],
    center: ['50%', '50%'],
    startAngle: 120,
    ...pieMotion(),
    label: { show: false },
    labelLine: { show: false },
    itemStyle: { borderWidth: 0, borderRadius: 5 },
    data: data.length
      ? data
      : [{ value: 1, name: '暂无', itemStyle: { color: emptyColor }, tooltip: { show: false } }],
  }

  return [bg, fg]
}

/** #rrggbb → rgba() 字符串（图表渐变不支持 color-mix） */
function hexToRgba(hex: string, alpha: number) {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/* ==========================================================================
 * art-design-pro 风格 token
 * 供「供水对比 / 水电耗对比 / 电耗统计」等页面复用，视觉对齐参考工程
 * art-design-pro（hooks/core/useChart.ts）：浅色系、细轴线 + 虚线分割、
 * 标签 #999/13px、浅色 tooltip、圆角小方块图例、顶部圆角柱。
 * 注意：与上方 Hydro Command 主题并列存在，互不影响，按页面选用。
 * ========================================================================== */

/** 读取一个 CSS 变量值，取不到时回退 */
function artCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** art 主题配色组（首色跟随业务主题主色） */
export function chartColors(): string[] {
  return [
    artCssVar('--el-color-primary-light-1', artCssVar('--el-color-primary', '#2f7cf6')),
    '#4ABEFF',
    '#EDF2FF',
    '#14DEBA',
    '#FFAF20',
    '#FA8A6C',
  ]
}

const ART_AXIS_LINE = '#EDEDED'
const ART_SPLIT_LINE = '#EDEDED'
const ART_LABEL_COLOR = '#999'
const ART_LABEL_SIZE = 13

/** 坐标轴线样式 */
export function getAxisLineStyle(show = true) {
  return { show, lineStyle: { color: ART_AXIS_LINE, width: 1 } }
}

/** 分割线样式（虚线） */
export function getSplitLineStyle(show = true) {
  return { show, lineStyle: { color: ART_SPLIT_LINE, width: 1, type: 'dashed' as const } }
}

/** 坐标轴标签样式 */
export function getAxisLabelStyle(show = true) {
  return { show, color: ART_LABEL_COLOR, fontSize: ART_LABEL_SIZE }
}

/** 坐标轴刻度样式（隐藏刻度） */
export function getAxisTickStyle() {
  return { show: false }
}

/** 提示框样式（浅色、去除指示线） */
export function getTooltipStyle(trigger: 'axis' | 'item' = 'axis') {
  return {
    trigger,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderColor: '#ddd',
    borderWidth: 1,
    textStyle: { color: '#333' },
    axisPointer: { type: 'none' as const },
  }
}

/** 图例样式（顶部居中的圆角小方块） */
export function getLegendStyle() {
  return {
    top: 0,
    left: 'center',
    textStyle: { color: '#333' },
    itemWidth: 12,
    itemHeight: 12,
    itemGap: 20,
    icon: 'roundRect' as const,
  }
}

/** 网格配置，含标签自适应；有图例时预留顶部空间 */
export function getGridStyle(hasLegend = false) {
  return {
    top: hasLegend ? 44 : 15,
    right: 16,
    bottom: 8,
    left: 0,
    containLabel: true,
  }
}

/** 柱状系列基础样式（顶部圆角） */
export function getBarBase(barMaxWidth = 28) {
  return {
    barMaxWidth,
    itemStyle: { borderRadius: [6, 6, 0, 0] },
    ...barMotion(),
  }
}

/** 折线系列基础样式（平滑 + 圆点） */
export function getLineBase() {
  return {
    smooth: true,
    symbol: 'circle' as const,
    symbolSize: 6,
    ...lineMotion(),
  }
}

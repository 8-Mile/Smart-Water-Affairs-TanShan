<!--
  KpiCard —— Hydro Command KPI 卡体系（多种信息角色，杜绝全站一个样）
  - metric   白卡：语义色轨 + 图标徽章 + 大数字 + 同比（业务列表页）
  - command  深色玻璃卡：指挥态势（首页核心指标，可带 sparkline）
  - compact  紧凑卡：无图标大数字（密集面板）
  - poster   磨砂卡：渐变图标块 + 迷你柱状图/右侧装饰图（维修工单设计稿）
  - tile     台账卡：全幅波纹背景 + 左图标图 + 双指标副行 + 进度条 + 右 3D 插画（设备台账设计稿）
  - alarm    告警皮肤卡：skin 选背景皮肤图 + 左图标素材 + 装饰图表 + 占比进度条 + 右 3D 插画
             （告警中心实时/历史页设计稿；窄屏紧凑布局，≥1600px 且卡宽 ≥340px 切横向宽卡）
  - realtime 实色渐变卡：实时态势（默认；可 pulse 呼吸辉光）
  @example
  <KpiCard variant="metric" color="#0e7ff0" icon="ri:server-line" label="设备总数" :value="128" />
  <KpiCard variant="command" icon="ri:water-flash-line" label="今日供水量" :value="3260" unit="m³" :trend="series" />
  <KpiCard variant="alarm" skin="pending" color="#f59e0b" label="待处理" :value="12" unit="条" :percent="38"
           :left-icon="pendingIcon" :right-icon="pending3d" chart-type="line" clickable />
-->
<template>
  <div
    class="kpi-card"
    :class="[
      `is-${variant}`,
      skin ? `skin-${skin}` : '',
      {
        'is-active': active,
        'is-clickable': clickable,
        'is-breathing': breathing,
        'has-cover': bgCover && bgImage,
        'has-bg': variant === 'alarm' && !!skin,
      },
    ]"
    :style="{ '--c': color }"
    @click="clickable && emit('click')"
  >
    <!-- metric：左色轨 + 图标徽章 -->
    <template v-if="variant === 'metric'">
      <div class="badge">
        <ArtSvgIcon v-if="isIconify" :icon="iconName" />
        <el-icon v-else :size="20"><component :is="icon" /></el-icon>
      </div>
      <div class="meta">
        <div class="label">{{ label }}</div>
        <div class="value">
          <span v-count-up:[decimals]="value">{{ displayValue }}</span><span v-if="unit" class="unit">{{ unit }}</span>
        </div>
        <div v-if="desc || $slots.footer" class="desc">
          <slot name="footer">{{ desc }}</slot>
        </div>
      </div>
      <svg v-if="trend?.length" class="spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
        <path :d="areaPath" class="spark-area" :class="`spark-area--${variant}`" />
        <path :d="linePath" class="spark-line" :class="`spark-line--${variant}`" />
      </svg>
    </template>

    <!-- command：深色玻璃指挥卡 -->
    <template v-else-if="variant === 'command'">
      <div class="cmd-grid" aria-hidden />
      <div class="cmd-head">
        <div class="badge">
          <ArtSvgIcon v-if="isIconify" :icon="iconName" />
          <el-icon v-else :size="20"><component :is="icon" /></el-icon>
        </div>
        <div class="label">{{ label }}</div>
        <i v-if="pulse" class="pulse-dot cmd-pulse" />
      </div>
      <div class="value">
        <span v-count-up:[decimals]="value">{{ displayValue }}</span><span v-if="unit" class="unit">{{ unit }}</span>
      </div>
      <div v-if="desc || trendLabel" class="desc">
        <slot name="footer">
          <span v-if="trendLabel" class="cmd-trend">{{ trendLabel }}</span>
          <span v-if="desc">{{ desc }}</span>
        </slot>
      </div>
      <svg v-if="trend?.length" class="spark cmd-spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
        <path :d="areaPath" class="spark-area spark-area--command" />
        <path :d="linePath" class="spark-line spark-line--command" />
      </svg>
    </template>

    <!-- poster：渐变图标块 + 迷你柱状图（维修工单设计稿 1:1） -->
    <template v-else-if="variant === 'poster'">
      <img v-if="bgImage" class="pt-bg" :class="{ 'pt-bg-cover': bgCover }" :src="bgImage" alt="" aria-hidden />
      <!-- 右侧 3D 装饰图标：默认隐藏，仅大尺寸视口显示（空间不足时自动让位） -->
      <img v-if="sideImage" class="pt-side" :src="sideImage" alt="" aria-hidden />
      <img v-if="iconImage" class="pt-badge-img" :src="iconImage" alt="" />
      <div v-else class="badge pt-badge">
        <ArtSvgIcon v-if="isIconify" :icon="iconName" />
        <el-icon v-else :size="22"><component :is="icon" /></el-icon>
      </div>
      <div class="meta">
        <div class="label">{{ label }}</div>
        <div class="value">
          <span v-count-up:[decimals]="value">{{ displayValue }}</span><span v-if="unit" class="unit">{{ unit }}</span>
        </div>
        <!-- 辅助信息（占比/环比等），维修页无此字段时不渲染 -->
        <div v-if="desc || $slots.footer" class="desc">
          <slot name="footer">{{ desc }}</slot>
        </div>
      </div>
      <div v-if="!bgImage" class="pt-bars" aria-hidden>
        <i v-for="(h, i) in barHeights" :key="i" :style="{ height: h + '%' }" />
      </div>
    </template>

    <!-- tile：台账卡（设计稿：全幅波纹背景 + 左图标 + 双指标副行 + 进度条 + 右 3D 插画） -->
    <template v-else-if="variant === 'tile'">
      <img v-if="bgImage" class="tl-bg" :src="bgImage" alt="" aria-hidden />
      <img v-if="iconImage" class="tl-icon" :src="iconImage" alt="" aria-hidden />
      <div class="tl-body">
        <div class="label">{{ label }}</div>
        <div class="value">
          <span v-count-up:[decimals]="value">{{ displayValue }}</span><span v-if="unit" class="unit">{{ unit }}</span>
        </div>
        <div v-if="metrics.length" class="tl-metrics">
          <span
            v-for="(m, i) in metrics"
            :key="i"
            class="tl-metric"
            :class="{ 'is-next': i > 0 }"
          >
            <span class="tl-metric-label">{{ m.label }}</span>
            <b class="tl-metric-value">{{ m.value }}</b>
          </span>
        </div>
        <div v-if="percent != null" class="tl-progress">
          <span class="tl-bar"><i :style="{ width: barWidth }" /></span>
          <span class="tl-pct">{{ percentText }}</span>
        </div>
      </div>
      <img v-if="sideImage" class="tl-side" :src="sideImage" alt="" aria-hidden />
    </template>

    <!-- alarm：告警皮肤卡（kapian 设计稿 1:1；skin 决定背景皮肤图，装饰图表为固定形态） -->
    <template v-else-if="variant === 'alarm'">
      <div class="pac">
        <div class="pac-id">
          <img
            v-if="leftIcon"
            class="pac-icon"
            :src="leftIcon"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <div class="pac-metric">
            <h3 class="pac-title">{{ label }}</h3>
            <div class="pac-value-row">
              <strong class="pac-value">{{ displayValue }}</strong>
              <span v-if="unit" class="pac-unit">{{ unit }}</span>
            </div>
          </div>
        </div>

        <div class="pac-trend">
          <!-- 中部装饰图表：固定形态，仅还原设计图观感，不展示真实数据。
               实时告警（chartType='line'）为折线波峰，历史告警（默认 'bar'）为柱状起伏 -->
          <div class="pac-spark">
            <MiniTrend v-if="chartType === 'line'" :values="decoValues" :color="color" />
            <MiniBars v-else :values="decoValues" :color="color" />
          </div>
        </div>

        <div class="pac-ratio">
          <div class="pac-ratio-label">
            <span>占比</span>
            <strong>{{ percentLabel }}%</strong>
          </div>
          <div class="pac-bar"><i :style="{ width: barWidth }" /></div>
        </div>

        <img
          v-if="rightIcon"
          class="pac-right"
          :src="rightIcon"
          alt=""
          aria-hidden="true"
          draggable="false"
        />
      </div>
    </template>

    <!-- compact：紧凑无图标 -->
    <template v-else-if="variant === 'compact'">
      <div class="meta">
        <div class="label">{{ label }}</div>
        <div class="value">
          <span v-count-up:[decimals]="value">{{ displayValue }}</span><span v-if="unit" class="unit">{{ unit }}</span>
        </div>
      </div>
      <div v-if="desc" class="desc">
        <slot name="footer">{{ desc }}</slot>
      </div>
    </template>

    <!-- realtime（默认）：实色渐变 -->
    <template v-else>
      <div class="badge rt-badge">
        <ArtSvgIcon v-if="isIconify" :icon="iconName" />
        <el-icon v-else :size="24"><component :is="icon" /></el-icon>
      </div>
      <div class="meta">
        <div class="label">{{ label }}</div>
        <div class="value">
          <span v-count-up:[decimals]="value">{{ displayValue }}</span><span v-if="unit" class="unit">{{ unit }}</span>
        </div>
        <div v-if="desc" class="desc">
          <slot name="footer">{{ desc }}</slot>
        </div>
      </div>
      <i v-if="pulse" class="pulse-dot rt-pulse" />
      <span class="rt-ring" aria-hidden />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import MiniBars from '@/components/MiniBars.vue'
import MiniTrend from '@/components/MiniTrend.vue'

const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    color?: string
    icon?: string | object
    unit?: string
    desc?: string
    variant?: 'metric' | 'command' | 'compact' | 'realtime' | 'poster' | 'tile' | 'alarm'
    /** alarm 变体：背景皮肤键，决定样式表引用哪张背景图
     *  实时告警 pending/processing/acceptance/unassigned/all；历史告警 level1/level2/level3/rejected
     *  （unassigned 复用 acceptance 背景，仅左侧图标换成「待指派」素材） */
    skin?: string
    /** alarm 变体：左侧徽章素材图（自带渐变圆角图标） */
    leftIcon?: string
    /** alarm 变体：右侧 3D 插画 */
    rightIcon?: string
    /** alarm 变体：中部装饰图表类型（实时告警 'line' 折线 / 历史告警缺省 'bar' 柱状） */
    chartType?: 'line' | 'bar'
    /** 卡片右侧装饰背景图（poster 变体专用，提供时替代 pt-bars 柱状图）；
     *  tile 变体下为整卡背景皮肤（全幅铺满，图内自带波纹与光晕） */
    bgImage?: string
    /** 背景图铺满模式：整卡横幅皮肤（图自带底色/边框），替代贴右 contain 模式 */
    bgCover?: boolean
    /** 右侧 3D 装饰图标（poster 变体专用）：默认隐藏，仅 ≥1600px 大视口显示 */
    sideImage?: string
    /** 卡片图标图（poster / tile 变体专用，提供时替代 ri:* 图标徽章） */
    iconImage?: string
    /** tile 变体：副行指标（label + 值，最多两项；第二项自动加竖线分隔） */
    metrics?: { label: string; value: string }[]
    /** tile 变体：进度条占比 0-100（缺省 null 不渲染进度条） */
    percent?: number | null
    /** tile 变体：进度条右侧百分比后缀（如「运行中」） */
    percentSuffix?: string
    /** sparkline 数据（≥2 个点） */
    trend?: number[]
    trendLabel?: string
    /** 实时脉冲点 */
    pulse?: boolean
    /** 选中态（点击筛选场景） */
    active?: boolean
    clickable?: boolean
    /** 呼吸灯：选中卡片的主色渐变起伏动画（默认关闭，选中态按需启用） */
    breathing?: boolean
    /** 小数位（count-up 等场景由外部控制显示时忽略） */
    decimals?: number
  }>(),
  {
    color: '#0e7ff0',
    variant: 'realtime',
    pulse: false,
    active: false,
    clickable: false,
    breathing: false,
    decimals: 0,
    metrics: () => [],
    percent: null,
  },
)

const emit = defineEmits<{ click: [] }>()

const isIconify = computed(() => typeof props.icon === 'string' && props.icon.startsWith('ri:'))
const iconName = computed(() => (typeof props.icon === 'string' ? props.icon : ''))

const displayValue = computed(() =>
  typeof props.value === 'number' ? props.value.toLocaleString('zh-CN') : props.value,
)

/* poster 变体：迷你柱状图相对高度（左低右高，还原设计稿装饰） */
const barHeights = [22, 38, 55, 46, 66, 84, 100]

/* tile 变体：进度条宽度与右侧百分比文字（保留 1 位小数，整数不补零） */
const barWidth = computed(() => {
  const n = Number(props.percent)
  const v = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
  return `${v}%`
})
const percentText = computed(() => {
  const n = Number(props.percent)
  if (!Number.isFinite(n)) return ''
  const v = Math.round(n * 10) / 10
  return `${v}%${props.percentSuffix ? ` ${props.percentSuffix}` : ''}`
})
/* alarm 变体：占比数值（与进度条同源 clamp，保留 1 位小数） */
const percentLabel = computed(() => {
  const n = Number(props.percent)
  const v = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
  return (Math.round(v * 10) / 10).toLocaleString('zh-CN')
})

/* alarm 变体：中部图表为纯装饰图形（还原设计图观感，不参与真实数据展示）：
   实时告警折线波峰 / 历史告警柱状起伏，两页各用一组固定形态 */
const DECO_LINE = [4, 9, 5, 12, 7, 14, 8, 16]
const DECO_BAR = [6, 11, 7, 14, 9, 16, 8, 13]
const decoValues = computed(() => (props.chartType === 'line' ? DECO_LINE : DECO_BAR))

/* ---- sparkline 路径（100×36 坐标系） ---- */
let uid = 0
const sparkId = `sp-${++uid}-${Date.now().toString(36)}`
const linePath = computed(() => buildPath(props.trend, false))
const areaPath = computed(() => buildPath(props.trend, true))

function buildPath(data: number[] | undefined, area: boolean) {
  if (!data || data.length < 2) return ''
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = 100 / (data.length - 1)
  const pts = data.map((v, i) => {
    const x = i * step
    const y = 32 - ((v - min) / span) * 28 - 2
    return [Number(x.toFixed(2)), Number(y.toFixed(2))]
  })
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
  if (!area) return line
  return `${line} L100,36 L0,36 Z`
}
// 暴露 id 备用（同一卡内渐变已在 CSS 用 currentColor，无需 defs）
void sparkId
</script>

<style lang="scss" scoped>
@use '@styles/core/breakpoints.scss' as bp;
.kpi-card {
  position: relative;
  height: 100%;
  border-radius: calc(var(--custom-radius) + 0px);
  overflow: hidden;
  box-sizing: border-box;
  transition:
    transform 0.22s ease,
    box-shadow 0.22s ease,
    border-color 0.22s ease;
}
.is-clickable {
  cursor: pointer;
}

.badge {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}
.label {
  font-size: 13px;
  line-height: 1.3;
}
.value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  font-family:
    'DIN Alternate', 'Bahnschrift', 'Helvetica Neue', 'PingFang SC', sans-serif;
}
.unit {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  opacity: 0.75;
}
.desc {
  font-size: 12px;
  line-height: 1.4;
}

/* ===== metric：白卡 + 左色轨（形制对齐 art-card-sm） ===== */
.is-metric {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px 16px 20px;
  background: var(--default-box-color, #fff);
  border: 1px solid var(--art-card-border);
  box-shadow: none;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 14%;
    bottom: 14%;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: linear-gradient(180deg, var(--c), color-mix(in srgb, var(--c) 55%, #fff));
  }
  .badge {
    width: 44px;
    height: 44px;
    border-radius: 11px;
    color: var(--c);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--c) 16%, #fff), color-mix(in srgb, var(--c) 7%, #fff));
    border: 1px solid color-mix(in srgb, var(--c) 22%, #fff);
    font-size: 21px;
  }
  .label {
    color: #000;
  }
  .value {
    margin-top: 3px;
    color: #000;
  }
  .desc {
    margin-top: 3px;
    color: #000;
  }
  &:hover {
    transform: translateY(-2px) !important;
    box-shadow:
      0 1px 3px 0 rgba(0, 0, 0, 0.03),
      0 1px 2px -1px rgba(0, 0, 0, 0.08);
    border-color: color-mix(in srgb, var(--c) 35%, #fff);
  }
  &.is-active {
    border-color: var(--c);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 28%, #fff);
  }
  .spark {
    position: absolute;
    right: 12px;
    bottom: 10px;
    width: 72px;
    height: 30px;
    opacity: 0.9;
  }
}

/* ===== poster：磨砂玻璃卡 + 左侧色条 + 渐变图标块 + 迷你柱状图（维修工单设计稿） ===== */
.is-poster {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px 16px 22px;
  /* 小屏最小高度保底：避免卡片过矮导致图标/背景图比例失调 */
  min-height: 92px;
  background: rgba(255, 255, 255, 0.72);
  -webkit-backdrop-filter: blur(14px) saturate(1.6);
  backdrop-filter: blur(14px) saturate(1.6);
  /* 设计稿卡片有底色、无边框，仅选中态（合计卡）显示主色描边 */
  border: 1px solid transparent;
  box-shadow: 0 4px 14px -4px rgba(30, 80, 180, 0.07);

  /* 左侧 4px 色条（卡片主色，上浅下深渐变） */
  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 4px;
    border-radius: calc(var(--custom-radius, 0.75rem) + 2px) 0 0 calc(var(--custom-radius, 0.75rem) + 2px);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--c) 55%, #ffffff) 0%,
      var(--c) 100%
    );
  }

  .pt-badge {
    /* 图标随视口流式缩放：宽屏 46px → 窄屏 34px，无断点突变 */
    width: clamp(34px, 4.2vw, 46px);
    height: clamp(34px, 4.2vw, 46px);
    border-radius: 12px;
    font-size: clamp(16px, 2vw, 22px);
    color: #fff;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--c) 58%, #ffffff) 0%,
      color-mix(in srgb, var(--c) 96%, #0b2a5b) 100%
    );
    box-shadow: 0 6px 12px -6px color-mix(in srgb, var(--c) 65%, transparent);
  }
  /* 装饰背景图：贴右侧铺底，宽度按卡片百分比流式缩放（响应式）；占比克制，视觉重心留给文字 */
  .pt-bg {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 44%;
    height: 100%;
    object-fit: contain;
    object-position: right center;
    pointer-events: none;
    user-select: none;
  }
  /* 全铺模式：cover 平铺填满整个卡片（比例锁定不变形），定位右侧——优先裁左侧纯渐变区，保右侧 3D 图标 */
  .pt-bg-cover {
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: right center;
  }
  &.has-cover {
    /* cover 铺满后不可见，仅作图片加载失败时的兜底 */
    background: linear-gradient(
      100deg,
      color-mix(in srgb, var(--c) 9%, #ffffff) 0%,
      #ffffff 100%
    );
    border-color: color-mix(in srgb, var(--c) 22%, transparent);
    /* 图自带卡片边框皮肤，左侧色条让位 */
    &::before {
      display: none;
    }
    /* 选中态描边加粗 */
    &.is-active {
      border-color: var(--c);
      box-shadow: 0 0 0 1px var(--c), 0 8px 18px -8px color-mix(in srgb, var(--c) 40%, transparent);
    }
  }
  /* 右侧 3D 装饰图标：浮于背景图之上；默认隐藏，仅 ≥1600px 大视口显示（响应式让位） */
  .pt-side {
    position: absolute;
    z-index: 1;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: none;
    height: 60%;
    max-height: 64px;
    width: auto;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
    filter: drop-shadow(0 6px 10px rgba(15, 23, 42, 0.16));
  }
  /* 图标图：替代渐变徽章，本身即带立体光影的图标按钮；随视口流式缩放（50→32px） */
  .pt-badge-img {
    flex-shrink: 0;
    width: clamp(32px, 4.2vw, 50px);
    height: clamp(32px, 4.2vw, 50px);
    object-fit: contain;
    filter: drop-shadow(0 8px 12px -8px color-mix(in srgb, var(--c) 60%, transparent));
  }
  .pt-badge,
  .pt-badge-img,
  .meta {
    position: relative;
    z-index: 1;
  }
  .label {
    color: #000;
    font-size: 13px;
  }
  .value {
    margin-top: 4px;
    color: #000;
    font-size: 26px;
    letter-spacing: 0.01em;
  }

  /* 窄屏整体缩放：间距/字号/背景图占比同步收紧（图标尺寸由 clamp 流式接管） */
  /* 大视口：显示右侧 3D 装饰图标，文字区预留右部空间防重叠 */
  @media (min-width: 1600px) {
    .pt-side {
      display: block;
    }
    .meta {
      padding-right: 72px;
    }
  }

  @include bp.respond(laptop) {
    gap: 10px;
    padding: 14px 14px 14px 18px;

    .pt-bg:not(.pt-bg-cover) {
      width: 38%;
    }
    .label {
      font-size: 12px;
    }
    .value {
      font-size: 22px;
    }
  }
  @include bp.respond(mobile) {
    .pt-bg:not(.pt-bg-cover) {
      width: 32%;
    }
    .value {
      font-size: 20px;
    }
  }
  .pt-bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 44px;
    margin-left: auto;
    padding-bottom: 2px;

    i {
      display: block;
      width: 4px;
      border-radius: 2px;
      background: color-mix(in srgb, var(--c) 34%, #ffffff);

      &:last-child {
        background: color-mix(in srgb, var(--c) 62%, #ffffff);
      }
    }
  }
  &:hover {
    transform: translateY(-2px) !important;
    box-shadow: 0 10px 22px -8px rgba(30, 80, 180, 0.14);
    border-color: color-mix(in srgb, var(--c) 32%, #fff);
  }
  /* 选中态：对齐告警中心——1px 主色边框 + 1px 外环 + 柔和外辉光 */
  &.is-active {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 9%, rgba(255, 255, 255, 0.82));
    box-shadow:
      0 0 0 1px var(--c),
      0 8px 20px -8px color-mix(in srgb, var(--c) 35%, transparent);
  }
}

/* ===== tile：设备台账卡（设计稿：全幅波纹背景 + 左图标 + 双指标副行 + 进度条 + 右 3D 插画） ===== */
.is-tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 98px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e6effb;
  box-shadow: 0 6px 18px -10px rgba(30, 80, 180, 0.18);

  /* 背景皮肤：设计稿波纹 SVG 全幅铺满（图内已带主题色渐变与光晕，无叠加遮罩） */
  .tl-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    pointer-events: none;
    user-select: none;
  }

  /* 左图标：立体渐变圆角图标素材，随视口流式缩放 */
  .tl-icon {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    width: clamp(38px, 4vw, 52px);
    height: clamp(38px, 4vw, 52px);
    object-fit: contain;
    filter: drop-shadow(0 8px 12px -8px color-mix(in srgb, var(--c) 60%, transparent));
  }

  /* 正文区：右侧预留 3D 插画悬浮位，避免文字被插画压住 */
  .tl-body {
    position: relative;
    z-index: 1;
    flex: 1 1 auto;
    min-width: 0;
    padding-right: 27%;
  }
  .label {
    color: #23395b;
    font-size: 13px;
    font-weight: 600;
  }
  .value {
    margin-top: 1px;
    color: var(--c);
    font-size: 26px;
    letter-spacing: 0.01em;
  }
  .unit {
    color: #23395b;
    font-weight: 600;
    opacity: 1;
  }

  /* 副行指标：如「正常运行 1,096 台 ｜ 离线 86 台」，两项之间竖线分隔 */
  .tl-metrics {
    display: flex;
    align-items: center;
    margin-top: 4px;
    overflow: hidden;
    color: #7b8aa3;
    font-size: 11.5px;
    white-space: nowrap;
  }
  .tl-metric {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .tl-metric.is-next {
    margin-left: 10px;
    padding-left: 10px;
    border-left: 1px solid #dbe6f2;
  }
  .tl-metric-value {
    color: #23395b;
    font-weight: 700;
  }

  /* 底部进度条 + 右侧百分比 */
  .tl-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 7px;
  }
  .tl-bar {
    flex: 1 1 auto;
    min-width: 0;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: rgba(148, 163, 184, 0.22);

    i {
      display: block;
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, color-mix(in srgb, var(--c) 45%, #fff) 0%, var(--c) 100%);
      transition: width 0.4s ease;
    }
  }
  .tl-pct {
    flex: 0 0 auto;
    color: #23395b;
    font-size: 11.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* 右侧 3D 插画：垂直居中贴右，高度随卡片缩放 */
  .tl-side {
    position: absolute;
    z-index: 0;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
    height: 84%;
    width: auto;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
    filter: drop-shadow(0 8px 14px rgba(15, 23, 42, 0.14));
  }

  &:hover {
    transform: translateY(-2px) !important;
    border-color: color-mix(in srgb, var(--c) 32%, #fff);
    box-shadow: 0 12px 26px -10px rgba(30, 80, 180, 0.22);
  }
  &.is-active {
    border-color: var(--c);
    transform: translateY(-2px) !important;
    box-shadow:
      0 0 0 1px var(--c),
      0 8px 20px -8px color-mix(in srgb, var(--c) 35%, transparent);
  }

  /* 低于 1600px：隐藏 3D 插画、隐藏副行指标，放开正文宽度 */
  @include bp.respond(wide) {
    .tl-body {
      padding-right: 0;
    }
    .tl-side,
    .tl-metrics {
      display: none;
    }
  }
  /* 更窄屏（≤1280px）：进一步收紧内边距与字号 */
  @include bp.respond(laptop) {
    padding: 12px;
    .value {
      font-size: 22px;
    }
  }
  /* 中小屏（≤1024px）：卡高 98→72px 紧凑化，图标/字号同步收档。
     避免 6 卡 2 列 3 行在小视口挤占表格区（设备资产页 pane 溢出根因） */
  @include bp.respond(tablet) {
    min-height: 72px;
    padding: 8px 12px;
    .tl-icon {
      width: 36px;
      height: 36px;
    }
    .value {
      font-size: 20px;
    }
    .tl-progress {
      margin-top: 4px;
    }
  }
  @include bp.respond(mobile) {
    .label {
      font-size: 12px;
    }
    .value {
      font-size: 20px;
    }
  }
}

/* ===== alarm：告警皮肤卡（kapian 设计稿 1:1，自告警中心 AlarmKpiCard 收敛并入） ===== */
.is-alarm {
  /* 尺寸容器：宽卡横向形制按卡片实际宽度切换（而非仅视口），避免侧栏展开/收窄时挤压溢出 */
  container: kpi-alarm / inline-size;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid #e4eefb;
  border-radius: 14px;
  &:hover {
    transform: translateY(-2px) !important;
    border-color: color-mix(in srgb, var(--c) 30%, #ffffff);
    box-shadow: 0 8px 18px -10px rgba(30, 80, 180, 0.18);
  }

  /* 有皮肤背景的卡片：仅铺一层设计背景图，100% 拉伸铺满卡片。
     图内已带主题色波浪与光晕，无需任何叠加层 */
  &.has-bg {
    border-color: rgba(255, 255, 255, 0.94);
    border-radius: 16px;
    background-size: 100% 100%;
    background-position: center;
    background-repeat: no-repeat;
    box-shadow: 0 12px 36px rgba(102, 137, 194, 0.08);
  }

  /* 实时告警四张 KPI 卡的皮肤背景（样式内按 skin 类引用，交由 Vite 打包解析） */
  &.skin-pending.has-bg {
    background-image: url('../assets/img/alarm/alerting/backgrounds_svg/01_pending_background.svg');
  }
  &.skin-processing.has-bg {
    background-image: url('../assets/img/alarm/alerting/backgrounds_svg/02_processing_background.svg');
  }
  &.skin-acceptance.has-bg,
  &.skin-unassigned.has-bg {
    background-image: url('../assets/img/alarm/alerting/backgrounds_svg/03_acceptance_background.svg');
  }
  &.skin-all.has-bg {
    background-image: url('../assets/img/alarm/alerting/backgrounds_svg/04_all_background.svg');
  }

  /* 历史告警四张 KPI 卡的皮肤背景（与实时告警同形制，素材取自 history 目录） */
  &.skin-level1.has-bg {
    background-image: url('../assets/img/alarm/history/01.webp');
  }
  &.skin-level2.has-bg {
    background-image: url('../assets/img/alarm/history/02.webp');
  }
  &.skin-level3.has-bg {
    background-image: url('../assets/img/alarm/history/03.webp');
  }
  &.skin-rejected.has-bg {
    background-image: url('../assets/img/alarm/history/04.webp');
  }

  /* 选中态：作为筛选条件生效时，主题色边框 + 弱光晕 + 左上角选中标记 */
  &.is-active {
    border-color: var(--c);
    box-shadow:
      0 0 0 1px var(--c),
      0 8px 20px -8px color-mix(in srgb, var(--c) 35%, transparent);
    transform: translateY(-2px) !important;
  }
  &.is-active::after {
    content: '';
    position: absolute;
    z-index: 3;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 10px 10px 0 0;
    border-color: var(--c) transparent transparent transparent;
  }

  /* ---------- 紧凑形制（小屏，默认）：左图标 + 标题数字 | 装饰图表 | 占比条 | 3D 插画 ---------- */
  .pac {
    position: relative;
    box-sizing: border-box;
    min-height: 98px;
    height: 100%;
    padding: 10px 12px;
    overflow: hidden;
  }

  /* 左上：图标 + 标题 + 数字（图标 40 / 标题 13 / 数字 23） */
  .pac-id {
    position: absolute;
    z-index: 2;
    top: 12px;
    left: 12px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: 50%;
    min-width: 0;
  }
  .pac-icon {
    display: block;
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 11px;
    object-fit: contain;
    filter: drop-shadow(0 4px 5px color-mix(in srgb, var(--c) 16%, transparent));
    pointer-events: none;
    user-select: none;
  }
  /* 历史告警左侧为圆形图标：彩色主盘仅占素材约 55–66%（外侧是近不透明的浅色环，
     白底/粉紫底上视觉融入），实时告警方形图标内容占 93%——
     实测半饱和轮廓对齐：0.66 × 1.38 ≈ 0.91 ≈ 实时 0.93，故放大 1.38 倍令两者视觉等大。
     仅 transform 缩放，布局盒仍为 40×40，不挤占标题位 */
  &.skin-level1 .pac-icon,
  &.skin-level2 .pac-icon,
  &.skin-level3 .pac-icon,
  &.skin-rejected .pac-icon {
    transform: scale(1.38);
  }
  .pac-metric {
    flex: 1;
    min-width: 0;
  }
  .pac-title {
    margin: 0;
    overflow: hidden;
    color: #1f2a44;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pac-value-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
    margin-top: 2px;
    color: var(--c);
  }
  .pac-value {
    font-family: Arial, 'PingFang SC', sans-serif;
    font-size: 23px;
    font-weight: 700;
    line-height: 1.15;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .pac-unit {
    flex-shrink: 0;
    color: var(--c);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
  }

  /* 中部：装饰图表（紧凑卡 66×36 挂右上） */
  .pac-trend {
    position: absolute;
    z-index: 2;
    top: 27px;
    right: 27%;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }
  .pac-spark {
    width: 66px;
    height: 36px;
  }

  /* 底部：占比 + 进度条（bar 高 6px） */
  .pac-ratio {
    position: absolute;
    z-index: 2;
    right: 27%;
    bottom: 10px;
    left: 12px;
    min-width: 0;
  }
  .pac-ratio-label {
    display: flex;
    align-items: baseline;
    gap: 5px;
    margin-bottom: 3px;
    color: #8a94a6;
    font-size: 11px;
    line-height: 1.25;
    white-space: nowrap;
  }
  .pac-ratio-label strong {
    color: #1f2a44;
    font-size: 12px;
    font-family: Arial, 'PingFang SC', sans-serif;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .pac-bar {
    height: 6px;
    border-radius: 3px;
    background: rgba(148, 163, 184, 0.2);
    overflow: hidden;
  }
  .pac-bar i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--c) 45%, #ffffff) 0%, var(--c) 100%);
    transition: width 0.4s ease;
  }

  /* 右侧 3D 插画：垂直居中贴右（76% 高） */
  .pac-right {
    position: absolute;
    z-index: 1;
    top: 50%;
    right: -4px;
    height: 76%;
    transform: translateY(-50%);
    pointer-events: none;
    user-select: none;
  }

  /* 窄屏：隐藏装饰图表 */
  @include bp.respond(mobile) {
    .pac-spark {
      display: none;
    }
  }

  /* ---------- 宽卡横向形制（长屏）：≥1600px 视口且卡宽 ≥340px 切横向布局 ----------
     图标 + 标题（主题色竖条）+ 数字 | 占比 + 进度条（拉长） | 装饰图表（贴右） | 3D 插画
     字体/图表/间距用 cqi（卡宽 1%）等比缩放，clamp 保证最小生效宽度处不比紧凑卡挤 */
  @media (min-width: 1600px) {
    @container kpi-alarm (min-width: 340px) {
      .pac {
        display: flex;
        align-items: center;
        gap: 2cqi;
        /* 右侧留出 3D 插画悬浮区（收窄一点，让图表更贴右） */
        padding: 10px clamp(62px, 18cqi, 78px) 10px 12px;
      }
      .pac-id {
        position: static;
        flex: 0 0 auto;
        max-width: none;
        gap: 2cqi;
      }
      /* 标题前主题色竖条 */
      .pac-title {
        font-size: clamp(13.5px, 4.2cqi, 18px);
      }
      .pac-title::before {
        height: clamp(12px, 3.2cqi, 14px);
      }
      .pac-value {
        font-size: clamp(24px, 7.2cqi, 34px);
      }
      .pac-unit {
        font-size: clamp(13px, 3.3cqi, 15px);
      }
      .pac-ratio {
        position: static;
        order: 1;
        /* 占比区吸收剩余宽度：进度条随卡宽拉长（42cqi 封顶） */
        flex: 1 1 auto;
        min-width: 0;
        max-width: 42cqi;
      }
      .pac-ratio-label {
        font-size: clamp(11px, 3cqi, 13px);
      }
      .pac-ratio-label strong {
        font-size: clamp(12px, 3.4cqi, 15px);
      }
      .pac-trend {
        position: static;
        order: 2;
        flex: 0 0 auto;
        /* 图表贴右侧排布；随屏宽加大的是两侧留白，而非图表本身 */
        margin-right: clamp(8px, 2.4cqi, 22px);
        width: clamp(100px, 20cqi, 140px);
      }
      .pac-spark {
        width: 100%;
        /* 图表高度固定（不随屏宽改变） */
        height: 42px;
      }
      .pac-right {
        height: 84%;
      }
    }
  }
}

/* ===== command：深色玻璃指挥卡 ===== */
.is-command {
  padding: 16px 18px 14px;
  color: #fff;
  background:
    linear-gradient(150deg, rgba(34, 211, 238, 0.1), transparent 42%),
    linear-gradient(160deg, var(--hydro-ink-700, #12365a) 0%, var(--hydro-ink-900, #081a2e) 100%);
  border: 1px solid rgba(34, 211, 238, 0.18);
  box-shadow: 0 10px 28px -10px rgba(11, 30, 51, 0.16);

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 14%;
    right: 14%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.8), transparent);
  }
  .cmd-grid {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(rgba(14, 160, 220, 0.16) 1px, transparent 1px);
    background-size: 14px 14px;
    mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.7), transparent 75%);
    pointer-events: none;
  }
  .cmd-head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    color: var(--hydro-cyan-bright, #22d3ee);
    background: rgba(34, 211, 238, 0.14);
    border: 1px solid rgba(34, 211, 238, 0.28);
    font-size: 15px;
  }
  .label {
    color: rgba(255, 255, 255, 0.68);
    font-size: 13px;
    letter-spacing: 0.04em;
  }
  .cmd-pulse {
    margin-left: auto;
  }
  .value {
    position: relative;
    margin-top: 10px;
    font-size: 30px;
    letter-spacing: 0.01em;
  }
  .desc {
    position: relative;
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.55);
  }
  .cmd-trend {
    margin-right: 8px;
    color: var(--hydro-cyan-bright, #22d3ee);
    font-weight: 600;
  }
  .cmd-spark {
    position: relative;
    display: block;
    width: 100%;
    height: 34px;
    margin-top: 8px;
  }
  &:hover {
    transform: translateY(-2px) !important;
    box-shadow: 0 18px 40px -14px rgba(6, 30, 58, 0.65), 0 0 22px -6px rgba(34, 211, 238, 0.4);
  }
}

/* ===== compact ===== */
.is-compact {
  padding: 12px 14px;
  background: var(--default-box-color, #fff);
  border: 1px solid var(--art-card-border);
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  .label {
    color: var(--art-gray-500, #949eb7);
    font-size: 12px;
  }
  .value {
    font-size: 22px;
    color: var(--art-gray-900, #323251);
  }
  .desc {
    color: var(--art-gray-600, #7987a1);
    text-align: right;
  }
}

/* ===== realtime：实色渐变（默认） ===== */
.is-realtime {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 96px;
  padding: 16px 20px;
  color: #fff;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--c) 88%, #0d2742) 0%,
    color-mix(in srgb, var(--c) 58%, #081a2e) 100%
  );
  box-shadow: 0 8px 20px -10px color-mix(in srgb, var(--c) 80%, transparent);

  .rt-badge {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    font-size: 23px;
    color: #fff;
    background: rgba(255, 255, 255, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.28);
    backdrop-filter: blur(2px);
  }
  .label {
    opacity: 0.88;
  }
  .value {
    margin-top: 3px;
    font-size: 27px;
  }
  .desc {
    margin-top: 2px;
    opacity: 0.82;
  }
  .rt-ring {
    position: absolute;
    top: -30px;
    right: -30px;
    width: 92px;
    height: 92px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.16), transparent 68%);
    pointer-events: none;
  }
  .rt-pulse {
    position: absolute;
    top: 14px;
    right: 14px;
  }
  &:hover {
    transform: translateY(-2px) !important;
    box-shadow: 0 14px 28px -10px color-mix(in srgb, var(--c) 85%, transparent);
  }
  &.is-active {
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.65), 0 12px 26px -10px color-mix(in srgb, var(--c) 85%, transparent);
  }
}

/* ===== sparkline ===== */
.spark-line {
  fill: none;
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.spark-line--metric {
  stroke: var(--c);
}
.spark-line--command {
  stroke: var(--hydro-cyan-bright, #22d3ee);
}
.spark-area--metric {
  fill: color-mix(in srgb, var(--c) 14%, transparent);
  stroke: none;
}
.spark-area--command {
  fill: rgba(34, 211, 238, 0.16);
  stroke: none;
}

/* ===== 呼吸灯：与告警中心 .akpi.breathing 同参数——细 1px 边框主色 35%→55% 起伏，
   弱帧无环、强帧仅 14px/2px/22% 轻辉光（克制、不厚重） ===== */
.is-breathing.is-poster,
.is-breathing.is-metric,
.is-breathing.is-realtime,
.is-breathing.is-tile,
.is-breathing.is-alarm {
  animation: kpi-breathing 2s ease-in-out infinite;
}
@keyframes kpi-breathing {
  0%, 100% {
    border-color: color-mix(in srgb, var(--c) 35%, #ffffff);
    box-shadow: 0 0 0 0 transparent;
  }
  50% {
    border-color: color-mix(in srgb, var(--c) 55%, #ffffff);
    box-shadow: 0 0 14px 2px color-mix(in srgb, var(--c) 22%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-breathing.is-poster,
  .is-breathing.is-metric,
  .is-breathing.is-realtime,
  .is-breathing.is-tile,
  .is-breathing.is-alarm {
    animation: none;
  }
}
</style>

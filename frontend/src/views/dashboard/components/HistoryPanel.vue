<template>
  <!-- 历史数据看板：磨砂玻璃风，日历仅联动本组件数据 -->
  <aside class="dg-rail">
    <div class="rl-head">
      <span class="rl-title">{{ dayLabel }}数据总览</span>
      <div class="rl-head-right">
        <span v-if="!isHistory" class="rl-updated">数据更新于 {{ updatedText }}</span>
        <span class="rl-live" :class="{ stale: refreshStale, hist: isHistory }">
          <i></i>{{ isHistory ? '当日' : refreshStale ? '连接异常' : '实时' }}
        </span>
      </div>
    </div>

    <div class="rl-scroll">
    <!-- 核心指标 4 卡：一行一个 -->
    <div class="rl-core">
      <div class="core-card">
        <span class="core-ic" style="--c:#3B9BFF"><ArtSvgIcon icon="ri:water-flash-line" /></span>
        <div class="core-main">
          <span class="core-label">{{ dayLabel }}供水</span>
          <b class="core-val">
            <template v-if="waterSummary.actual_total != null">
              <NumberRoll :replay-key="replayKey" :to="Math.round(waterSummary.actual_total)" separator="," /><em>m³</em>
            </template>
            <template v-else>—</template>
          </b>
        </div>
      </div>
      <div class="core-card">
        <span class="core-ic" style="--c:#2FD6A3"><ArtSvgIcon icon="ri:flashlight-line" /></span>
        <div class="core-main">
          <span class="core-label">{{ dayLabel }}用电</span>
          <b class="core-val">
            <template v-if="todayEnergyVal != null">
              <NumberRoll :replay-key="replayKey" :to="todayEnergyVal" separator="," /><em>kWh</em>
            </template>
            <template v-else>—</template>
          </b>
        </div>
      </div>
      <div class="core-card">
        <span class="core-ic" style="--c:#FF6B7A"><ArtSvgIcon icon="ri:alarm-warning-line" /></span>
        <div class="core-main">
          <span class="core-label">{{ dayLabel }}告警</span>
          <b class="core-val"><NumberRoll :replay-key="replayKey" :to="alarmStats.total" /><em>条</em></b>
        </div>
      </div>
      <div class="core-card">
        <span class="core-ic" style="--c:#E8A33D"><ArtSvgIcon icon="ri:tools-line" /></span>
        <div class="core-main">
          <span class="core-label">{{ dayLabel }}工单</span>
          <b class="core-val"><NumberRoll :replay-key="replayKey" :to="repairStats.total" /><em>单</em></b>
        </div>
      </div>
    </div>

    <!-- 能耗概览 -->
    <div class="rl-glass rl-block">
      <div class="rl-block-head">
        <span class="rl-block-title"><ArtSvgIcon icon="ri:flashlight-line" />能耗概览</span>
      </div>

      <!-- 能源数据（供不供水都有意义） -->
      <div class="rl-row">
        <span>{{ dayLabel }}电费</span>
        <b>
          <template v-if="todayFeeVal != null"><NumberRoll :replay-key="replayKey" :to="todayFeeVal" separator="," /> 元</template>
          <template v-else>—</template>
        </b>
      </div>
      <div v-if="energyCompare" class="rl-row is-sub">
        <span>较昨日用电</span>
        <b :class="{ up: energyCompare.pct > 0, down: energyCompare.pct < 0 }">
          {{ energyCompare.pct > 0 ? '↑' : energyCompare.pct < 0 ? '↓' : '—' }}
          {{ Math.abs(energyCompare.pct) }}%
        </b>
      </div>

      <!-- 峰谷平电量环图 -->
      <div v-if="feePieData.length" class="rl-fee">
        <div class="rl-fee-pie">
          <div ref="feePieRef" class="rl-fee-chart" />
        </div>
        <div class="rl-fee-legend">
          <div v-for="d in feePieData" :key="d.name" class="rl-fee-item">
            <span class="rl-fee-dot" :style="{ background: d.color }"></span>
            <span class="rl-fee-n">{{ d.name }}期</span>
            <b class="rl-fee-v">{{ d.value.toFixed(0) }} kWh</b>
            <em class="rl-fee-f">¥{{ d.fee.toFixed(0) }}</em>
          </div>
        </div>
      </div>

      <!-- 电价参考 -->
      <div v-if="feeDetail?.price" class="rl-price-ref">
        <span class="rl-price-k">电价参考</span>
        <span class="rl-price-item"><i style="background:#FF6B7A"></i>峰 ¥{{ feeDetail.price.peak_price }}</span>
        <span class="rl-price-item"><i style="background:#3B9BFF"></i>平 ¥{{ feeDetail.price.normal_price }}</span>
        <span class="rl-price-item"><i style="background:#21CE99"></i>谷 ¥{{ feeDetail.price.valley_price }}</span>
      </div>

      <!-- 供水相关（仅供水日展示） -->
      <template v-if="isWaterDay">
        <div class="rl-spacer"></div>
        <div class="rl-row is-sub">
          <span>吨水电耗</span>
          <b>
            <template v-if="todayRatioVal != null"><NumberRoll :replay-key="replayKey" :to="todayRatioVal" :decimals="3" /> kWh/m³</template>
            <template v-else>—</template>
          </b>
        </div>
        <div class="rl-row is-sub">
          <span>供水计划完成率</span>
          <b>
            <template v-if="waterSummary.achievement_rate != null"><NumberRoll :replay-key="replayKey" :to="waterSummary.achievement_rate" :decimals="1" />%</template>
            <template v-else>—</template>
          </b>
        </div>
        <div class="rl-progress">
          <i :style="{ width: Math.max(0, Math.min(100, waterSummary.achievement_rate ?? 0)) + '%' }" />
        </div>
        <div class="rl-row is-sub">
          <span>供水缺口</span>
          <b :class="{ neg: waterGapVal < 0 }">{{ waterGapText }}<template v-if="waterSummary.actual_plan_gap != null"> m³</template></b>
        </div>
      </template>

      <!-- 不供水日空态提示 -->
      <div v-else class="rl-nosupply">
        <ArtSvgIcon icon="ri:water-off-line" />
        <span>{{ dayLabel }}无供水 · 供水相关指标暂不展示</span>
      </div>
    </div>

    <!-- 机组运行时长排行 -->
    <div class="rl-glass rl-block">
      <div class="rl-block-head">
        <span class="rl-block-title"><ArtSvgIcon icon="ri:bar-chart-grouped-line" />机组运行时长排行</span>
        <span class="rl-link" @click="$router.push('/equipment/list')">
          详情 <el-icon><ArrowRight /></el-icon>
        </span>
      </div>
      <div class="rl-chart-box">
        <div ref="rankChartRef" class="rl-chart" />
        <div v-if="!runRanking.length" class="rl-rank-empty">暂无运行数据</div>
      </div>
    </div>

    <!-- 机组能效排行（单耗 kWh/m³，越低越好） -->
    <div v-if="efficiencyRanking.length" class="rl-glass rl-block">
      <div class="rl-block-head">
        <span class="rl-block-title"><ArtSvgIcon icon="ri:equalizer-line" />机组能效排行</span>
        <span class="rl-block-sub">单耗 kWh/m³ · 越低越好</span>
      </div>
      <div class="rl-chart-box" style="height: 160px;">
        <div ref="effChartRef" class="rl-chart" />
      </div>
    </div>

    <!-- 告警概览 -->
    <div class="rl-glass rl-block">
      <div class="rl-block-head">
        <span class="rl-block-title"><ArtSvgIcon icon="ri:alarm-warning-line" />{{ dayLabel }}告警</span>
        <span class="rl-link" @click="$router.push('/alarm/realtime')">
          详情 <el-icon><ArrowRight /></el-icon>
        </span>
      </div>
      <div class="ov-pair">
        <div class="ov-mini ok">
          <span class="ov-mini-ic"><ArtSvgIcon icon="ri:checkbox-circle-fill" /></span>
          <div class="ov-mini-main">
            <span class="ov-mini-k">已处理</span>
            <b class="ov-mini-v"><NumberRoll :replay-key="replayKey" :to="alarmStats.processed" /><em>条</em></b>
          </div>
        </div>
        <div class="ov-mini bad">
          <span class="ov-mini-ic"><ArtSvgIcon icon="ri:close-circle-fill" /></span>
          <div class="ov-mini-main">
            <span class="ov-mini-k">未处理</span>
            <b class="ov-mini-v"><NumberRoll :replay-key="replayKey" :to="alarmStats.total - alarmStats.processed" /><em>条</em></b>
          </div>
        </div>
      </div>
    </div>

    <!-- 工单概览 -->
    <div class="rl-glass rl-block">
      <div class="rl-block-head">
        <span class="rl-block-title"><ArtSvgIcon icon="ri:building-line" />{{ dayLabel }}工单</span>
        <span class="rl-link" @click="$router.push('/repair/list')">
          详情 <el-icon><ArrowRight /></el-icon>
        </span>
      </div>
      <div class="ov-pair">
        <div class="ov-mini ok">
          <span class="ov-mini-ic"><ArtSvgIcon icon="ri:checkbox-circle-fill" /></span>
          <div class="ov-mini-main">
            <span class="ov-mini-k">已完成</span>
            <b class="ov-mini-v"><NumberRoll :replay-key="replayKey" :to="repairStats.completed" /><em>单</em></b>
          </div>
        </div>
        <div class="ov-mini bad">
          <span class="ov-mini-ic"><ArtSvgIcon icon="ri:close-circle-fill" /></span>
          <div class="ov-mini-main">
            <span class="ov-mini-k">未处理</span>
            <b class="ov-mini-v"><NumberRoll :replay-key="replayKey" :to="Math.max(repairStats.total - repairStats.completed, 0)" /><em>单</em></b>
          </div>
        </div>
      </div>
    </div>
    </div>

    <!-- 日历 -->
    <div class="rl-glass rl-cal">
      <div class="rl-cal-head">
        <span class="rl-cal-title">选择日期</span>
        <span class="rl-cal-tip">{{ isHistory ? `历史 · ${selDate}` : '实时 · 今日' }}</span>
      </div>
      <div class="cal">
        <div class="cal-bar">
          <button type="button" class="cal-nav" aria-label="上个月" @click="shiftMonth(-1)">
            <el-icon><ArrowLeft /></el-icon>
          </button>
          <span class="cal-month">{{ calLabel }}</span>
          <button
            type="button"
            class="cal-nav"
            aria-label="下个月"
            :disabled="!canNextMonth"
            @click="shiftMonth(1)"
          >
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
        <div class="cal-week">
          <span v-for="w in WEEK" :key="w">{{ w }}</span>
        </div>
        <div class="cal-grid">
          <button
            v-for="c in calCells"
            :key="c.key"
            type="button"
            class="cal-cell"
            :class="{
              'is-today': c.isToday,
              'is-active': c.date === selDate,
              'is-other': !c.inMonth,
              'is-disabled': c.disabled,
            }"
            :disabled="!c.inMonth || c.disabled"
            @click="pickDate(c.date)"
          >
            {{ c.day }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import echarts from '@/utils/echarts'
import { barMotion, initMotionChart } from '@/utils/chartTheme'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import NumberRoll from '@/components/NumberRoll.vue'
import { fetchEnergyFee, fetchEnergyStats, fetchEnergyEfficiency, type EnergyEfficiencyItem } from '@/api/energy'
import { fetchWaterStats } from '@/api/water'
import { fetchAlarmHistoryStats, type AlarmHistoryStats } from '@/api/alarm'
import { fetchRepairHistoryStats, type RepairHistoryStats } from '@/api/repair'
import { fetchRunStats, type RunStat } from '@/api/equipment'

/* ===== 数据类型 ===== */
interface EnergyDayStats {
  labels: string[]
  electricity_kwh: (number | null)[]
  water_m3: (number | null)[]
  ratio: (number | null)[]
}
interface WaterSummary {
  actual_total: number | null
  plan_total: number | null
  achievement_rate: number | null
  actual_plan_gap: number | null
}
interface FeeDetail {
  has_price: boolean
  total_fee: number
  peak_fee: number
  valley_fee: number
  normal_fee: number
  peak_kwh: number
  valley_kwh: number
  normal_kwh: number
  total_kwh: number
  price?: { peak_price: number; valley_price: number; normal_price: number }
}

/* ===== 响应式数据 ===== */
const energyDayStats = ref<EnergyDayStats | null>(null)
const feeDetail = ref<FeeDetail | null>(null)
const waterSummary = ref<WaterSummary>({ actual_total: null, plan_total: null, achievement_rate: null, actual_plan_gap: null })
const runStats = ref<RunStat[]>([])
const efficiencyRows = ref<EnergyEfficiencyItem[]>([])
const alarmStats = ref<AlarmHistoryStats>({ total: 0, by_level: [], processed: 0, process_rate: 0, top_types: [] })
const repairStats = ref<RepairHistoryStats>({ total: 0, completed: 0, completion_rate: 0, avg_duration_hours: 0, by_type: [] })

const lastUpdated = ref<Date | null>(null)
const refreshStale = ref(false)

const updatedText = computed(() => {
  if (!lastUpdated.value) return '—'
  const d = lastUpdated.value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

/* ===== 日历选择：历史日期 ↔ 实时模式 ===== */
const selDate = ref('')
const isHistory = computed(() => !!selDate.value && selDate.value !== todayStr())
const dayLabel = computed(() => (isHistory.value ? '当日' : '今日'))
/** 日期切换标识：驱动数字从头重播，保证每次切日期都有可见动效 */
const replayKey = computed(() => selDate.value || 'today')

function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
function shiftDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ===== 历史数据加载：仅联动本组件，不影响主区 ===== */
async function loadExtras(dateStr?: string) {
  const end = dateStr || todayStr()
  const start = dateStr ? shiftDays(dateStr, -6) : undefined
  const dateRange = start ? { start_date: start, end_date: end } : { start_date: end, end_date: end }
  const paramsSingle = { start_date: end, end_date: end }
  const [s, f, w, r, a, rp, ee] = await Promise.allSettled([
    fetchEnergyStats(start ? { start_date: start, end_date: end } : undefined),
    fetchEnergyFee(paramsSingle),
    fetchWaterStats(dateRange),
    fetchRunStats({ start: (start || end) + ' 00:00:00', end: end + ' 23:59:59' }),
    fetchAlarmHistoryStats(paramsSingle),
    fetchRepairHistoryStats(paramsSingle),
    fetchEnergyEfficiency(paramsSingle),
  ])
  let ok = true
  if (s.status === 'fulfilled') energyDayStats.value = s.value.data.data as unknown as EnergyDayStats
  else ok = false
  if (f.status === 'fulfilled') {
    feeDetail.value = (f.value.data.data as unknown as FeeDetail) ?? null
  } else ok = false
  if (w.status === 'fulfilled') {
    const d = (w.value.data.data as Record<string, unknown>)?.summary as WaterSummary | undefined
    waterSummary.value = d ?? { actual_total: null, plan_total: null, achievement_rate: null, actual_plan_gap: null }
  } else ok = false
  if (r.status === 'fulfilled') runStats.value = r.value.data.data as RunStat[]
  if (a.status === 'fulfilled') alarmStats.value = a.value.data.data as AlarmHistoryStats
  if (rp.status === 'fulfilled') repairStats.value = rp.value.data.data as RepairHistoryStats
  if (ee.status === 'fulfilled') {
    efficiencyRows.value = (ee.value.data.data as EnergyEfficiencyItem[]) ?? []
  }
  refreshStale.value = !ok
  if (ok) lastUpdated.value = new Date()
}

/** 选今日（或清空）→ 实时模式；选历史日期 → 该日统计。仅刷新本组件数据。 */
async function onDateChange(v: string | null) {
  if (!v || v === todayStr()) {
    selDate.value = ''
    await loadExtras()
    return
  }
  selDate.value = v
  await loadExtras(v)
}

/* ===== 计算属性 ===== */
function fmtNum(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/* 是否供水日：今日实际供水量 > 0 */
const isWaterDay = computed(() => (waterSummary.value.actual_total ?? 0) > 0)

/** 今日用电（数值版，供 NumberRoll 使用） */
const todayEnergyVal = computed<number | null>(() => {
  const arr = energyDayStats.value?.electricity_kwh ?? []
  const v = arr.length ? arr[arr.length - 1] : null
  return v == null ? null : Math.round(v)
})

/* 今日用电 vs 昨日对比 */
const energyCompare = computed(() => {
  const arr = energyDayStats.value?.electricity_kwh ?? []
  if (arr.length < 2) return null
  const today = arr[arr.length - 1] ?? 0
  const yesterday = arr[arr.length - 2] ?? 0
  if (yesterday <= 0) return null
  const pct = ((today - yesterday) / yesterday) * 100
  return { today: Math.round(today), yesterday: Math.round(yesterday), pct: Math.round(pct * 10) / 10 }
})

const todayRatioVal = computed(() => {
  // 直接取数组最后一个位置的值（当天），不跳过 null
  // 后端在不供水（water_m3=0）时返回 null，应如实展示为「—」
  const arr = energyDayStats.value?.ratio ?? []
  return arr.length ? arr[arr.length - 1] : null
})
/** 供 NumberRoll 使用的数值版 */
const todayFeeVal = computed<number | null>(() => {
  const f = feeDetail.value
  return f?.has_price ? Math.round(f.total_fee) : null
})

const waterGapVal = computed(() => waterSummary.value.actual_plan_gap ?? 0)
const waterGapText = computed(() => {
  const g = waterSummary.value.actual_plan_gap
  if (g == null) return '—'
  const sign = g > 0 ? '+' : ''
  return `${sign}${fmtNum(Math.round(g))}`
})

/* ===== 峰谷平电量（电费接口返回） ===== */
const feePieData = computed(() => {
  const f = feeDetail.value
  if (!f?.has_price || f.total_kwh <= 0) return []
  return [
    { name: '峰', value: f.peak_kwh, fee: f.peak_fee, color: '#FF6B7A' },
    { name: '谷', value: f.valley_kwh, fee: f.valley_fee, color: '#21CE99' },
    { name: '平', value: f.normal_kwh, fee: f.normal_fee, color: '#3B9BFF' },
  ].filter((x) => x.value > 0)
})

/* ===== 机组能效排行：单耗 kWh/m³（越低越好） ===== */
const efficiencyRanking = computed(() => {
  return [...efficiencyRows.value]
    .filter((r) => r.water_m3 > 0 && r.unit_consumption > 0)
    .sort((a, b) => a.unit_consumption - b.unit_consumption) // 升序，最低（最好）的排前
    .slice(0, 5)
})

/* ===== 机组运行时长排行：横向柱状图 ===== */
const runRanking = computed(() =>
  [...runStats.value].sort((a, b) => b.run_hours - a.run_hours).slice(0, 5),
)

const rankChartRef = ref<HTMLElement | null>(null)
let rankChart: echarts.ECharts | null = null

function renderRankChart() {
  if (!rankChartRef.value) return
  if (!rankChart) {
    rankChart = initMotionChart(rankChartRef.value)
  }
  const list = runRanking.value
  const names = list.map((it) => it.equipment_name || `#${it.equipment_id}`).reverse()
  const values = list.map((it) => Number(it.run_hours?.toFixed(1) ?? 0)).reverse()
  rankChart.setOption(
    {
      grid: { left: 8, right: 44, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(26, 59, 92, 0.92)',
        borderColor: 'transparent',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: any) => `${p[0].name}<br/>运行时长：${p[0].value} h`,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#9cbcd6', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(59, 155, 255, 0.1)' } },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#1a3b5c', fontSize: 12, fontWeight: 500, width: 80, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          data: values,
          barWidth: 8,
          ...barMotion(),
          itemStyle: {
            borderRadius: [0, 7, 7, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: '#3b9bff' },
              { offset: 1, color: '#21ce99' },
            ]),
          },
          label: {
            show: true,
            position: 'right',
            color: '#1a3b5c',
            fontSize: 11,
            fontWeight: 600,
            formatter: '{c} h',
          },
        },
      ],
    },
    true,
  )
  rankChart.resize()
}

function resizeRankChart() {
  rankChart?.resize()
}

/* ===== 峰谷平电量环图 ===== */
const feePieRef = ref<HTMLElement | null>(null)
let feePieChart: echarts.ECharts | null = null

function renderFeePie() {
  if (!feePieRef.value) return
  if (!feePieChart) feePieChart = initMotionChart(feePieRef.value)
  const data = feePieData.value
  if (!data.length) {
    feePieChart.setOption({ series: [{ data: [] }] }, true)
    return
  }
  const total = data.reduce((a, b) => a + b.value, 0)
  feePieChart.setOption(
    {
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `${p.name}期<br/>电量：${p.value.toFixed(1)} kWh<br/>占比：${p.percent}%`,
      },
      series: [
        {
          type: 'pie',
          radius: ['45%', '75%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          label: { show: true, position: 'outside', color: '#111', fontSize: 12, formatter: '{b}\n{d}%' },
          labelLine: { length: 6, length2: 6 },
          data: data.map((d) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: d.color, borderRadius: 4 },
          })),
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' } },
        },
      ],
      graphic: [
        { type: 'text', left: 'center', top: '38%', style: { text: total.toFixed(0) + ' kWh', fill: '#111', fontSize: 15, fontWeight: 700, textAlign: 'center' } },
        { type: 'text', left: 'center', top: '55%', style: { text: '当日总电量', fill: '#111', fontSize: 11, textAlign: 'center' } },
      ],
    },
    true,
  )
  feePieChart.resize()
}

function resizeFeePie() { feePieChart?.resize() }

/* ===== 机组能效排行：单耗横向柱状图 ===== */
const effChartRef = ref<HTMLElement | null>(null)
let effChart: echarts.ECharts | null = null

function renderEffChart() {
  if (!effChartRef.value) return
  if (!effChart) effChart = initMotionChart(effChartRef.value)
  const list = efficiencyRanking.value
  const names = list.map((it) => it.unit_name || `#${it.unit_id}`).reverse()
  // 单耗通常在 0.003~0.01 kWh/m³ 范围，乘以 1000 方便展示
  const values = list.map((it) => +(it.unit_consumption * 1000).toFixed(2)).reverse()
  // 颜色：越低越好，用绿色渐变；最高的用橙色
  const maxV = Math.max(...values, 0.01)
  const colors = values.map((v) =>
    v >= maxV * 0.85 ? '#FF8C42' : new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#21ce99' }, { offset: 1, color: '#3b9bff' }]),
  )
  effChart.setOption(
    {
      grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(26, 59, 92, 0.92)',
        borderColor: 'transparent',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: any) => `${p[0].name}<br/>单耗：${(p[0].value / 1000).toFixed(4)} kWh/m³`,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#1a3b5c', fontSize: 12, fontWeight: 500, width: 70, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          data: values.map((v, i) => ({ value: v, itemStyle: { borderRadius: [0, 7, 7, 0], color: colors[i] } })),
          barWidth: 8,
          ...barMotion(),
          label: {
            show: true,
            position: 'right',
            color: '#1a3b5c',
            fontSize: 10,
            fontWeight: 600,
            formatter: (p: any) => (p.value / 1000).toFixed(4),
          },
        },
      ],
    },
    true,
  )
  effChart.resize()
}

function resizeEffChart() { effChart?.resize() }

/* ===== 自绘月历 ===== */
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const calCursor = ref(todayStr().slice(0, 7))
const calLabel = computed(() => {
  const [y, m] = calCursor.value.split('-')
  return `${y} 年 ${Number(m)} 月`
})
const canNextMonth = computed(() => calCursor.value < todayStr().slice(0, 7))

function shiftMonth(delta: number) {
  const [y, m] = calCursor.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  if (next > todayStr().slice(0, 7)) return
  calCursor.value = next
}

const calCells = computed(() => {
  const [y, m] = calCursor.value.split('-').map(Number)
  const offset = new Date(y, m - 1, 1).getDay()
  const days = new Date(y, m, 0).getDate()
  const rows = Math.ceil((offset + days) / 7)
  const today = todayStr()
  const cells: Array<{ key: string; day: number; date: string; inMonth: boolean; isToday: boolean; disabled: boolean }> = []
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(y, m - 1, 1 - offset + i)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    cells.push({ key: date, day: d.getDate(), date, inMonth: d.getMonth() === m - 1, isToday: date === today, disabled: date > today })
  }
  return cells
})

function pickDate(date: string) {
  if (date > todayStr()) return
  onDateChange(date)
}

/* ===== 生命周期：自管刷新，不依赖父组件 ===== */
let timer: number | undefined
onMounted(async () => {
  await loadExtras()
  await nextTick()
  renderRankChart()
  renderFeePie()
  renderEffChart()
  window.addEventListener('resize', () => {
    resizeRankChart()
    resizeFeePie()
    resizeEffChart()
  })
  timer = window.setInterval(() => {
    if (!isHistory.value) loadExtras()
  }, 60000)
})

watch(runRanking, () => { nextTick(renderRankChart) })
watch(feePieData, () => { nextTick(renderFeePie) })
watch(efficiencyRanking, () => { nextTick(renderEffChart) })

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
  rankChart?.dispose(); rankChart = null
  feePieChart?.dispose(); feePieChart = null
  effChart?.dispose(); effChart = null
})
</script>

<style scoped>
/* ===== 容器：磨砂玻璃 ===== */
.dg-rail {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  color: #1a3b5c;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(31, 38, 135, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
/* 玻璃卡片通用 */
.rl-glass {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(31, 60, 120, 0.06);
}

/* ===== 头部 ===== */
.rl-head { display: flex; align-items: center; justify-content: space-between; }
.rl-title { font-size: 16px; font-weight: 700; color: #1a3b5c; }
.rl-head-right { display: flex; align-items: center; gap: 10px; }
.rl-updated { color: #7a9bbb; font-size: 11px; font-weight: 400; }
.rl-live { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; color: #1e8e5a; font-size: 11px; font-weight: 600; background: rgba(46, 234, 139, 0.18); border: 1px solid rgba(46, 234, 139, 0.45); border-radius: 999px; }
.rl-live i { width: 6px; height: 6px; background: #2eea8b; border-radius: 50%; box-shadow: 0 0 6px rgba(46, 234, 139, 0.8); }
.rl-live.stale { color: #c46b1f; background: rgba(255, 159, 67, 0.18); border-color: rgba(255, 159, 67, 0.45); }
.rl-live.stale i { background: #ff9f43; box-shadow: 0 0 6px rgba(255, 159, 67, 0.8); }
.rl-live.hist { color: #a37420; background: rgba(255, 196, 87, 0.2); border-color: rgba(255, 196, 87, 0.55); }
.rl-live.hist i { display: none; }

/* ===== 滚动区 ===== */
.rl-scroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
.rl-scroll::-webkit-scrollbar { width: 4px; }
.rl-scroll::-webkit-scrollbar-thumb { background: rgba(59, 155, 255, 0.3); border-radius: 999px; }
.rl-scroll::-webkit-scrollbar-track { background: transparent; }
@media only screen and (max-height: 940px) {
  .rl-scroll {
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent 100%);
  }
}

/* ===== 核心 4 卡：2×2 网格 ===== */
.rl-core { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.core-card {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 66px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 14px;
  box-shadow: 0 2px 8px rgba(31, 60, 120, 0.05);
  transition: transform 0.2s, box-shadow 0.2s;
}
.core-card:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(31, 60, 120, 0.08); }
.core-ic {
  display: flex; flex: none; align-items: center; justify-content: center;
  width: 38px; height: 38px; color: #fff; font-size: 17px;
  background: var(--c); border-radius: 10px;
  box-shadow: 0 4px 10px color-mix(in oklab, var(--c) 45%, transparent);
}
.core-main { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.core-label { color: #5a7d9c; font-size: 11px; }
.core-val { color: #1a3b5c; font-size: 20px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.core-val em { margin-left: 3px; color: #7a9bbb; font-size: 11px; font-style: normal; font-weight: 500; }

/* ===== 区块标题 + 链接 ===== */
.rl-block { display: flex; flex-direction: column; gap: 8px; }
.rl-block-head { display: flex; align-items: center; justify-content: space-between; }
.rl-block-title { display: inline-flex; align-items: center; gap: 5px; color: #111; font-size: 14px; font-weight: 600; }
.rl-block-title svg, .rl-block-title .el-icon { font-size: 14px; color: #3b9bff; }
.rl-link { display: inline-flex; align-items: center; gap: 2px; color: #3b9bff; font-size: 11px; cursor: pointer; transition: color 0.15s; }
.rl-link:hover { color: #1e6fe0; }
.rl-link .el-icon { font-size: 10px; }

/* ===== 通用行 ===== */
.rl-row { display: flex; align-items: center; font-size: 14px; color: #111; }
.rl-row > b { margin-left: auto; color: #111; font-weight: 600; font-variant-numeric: tabular-nums; }
.rl-row.is-sub { font-size: 13px; color: #111; }
.rl-row.is-sub > b { color: #111; font-weight: 500; }
.rl-row.is-sub > b.neg { color: #e74c3c; }

/* ===== 进度条 ===== */
.rl-progress { height: 6px; overflow: hidden; background: rgba(59, 155, 255, 0.12); border-radius: 999px; }
.rl-progress > i { display: block; height: 100%; background: linear-gradient(90deg, #3b9bff, #7cc4ff); border-radius: 999px; transition: width 0.4s ease; }

/* ===== 机组排行图表 ===== */
.rl-chart-box { position: relative; width: 100%; height: 200px; }
.rl-chart { width: 100%; height: 100%; }
.rl-rank-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #9cbcd6; font-size: 12px; }

/* ===== 峰谷平电量环图 ===== */
.rl-fee { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.rl-fee-pie { flex: none; width: 110px; height: 110px; }
.rl-fee-chart { width: 100%; height: 100%; }
.rl-fee-legend { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.rl-fee-item { display: flex; align-items: center; gap: 5px; font-size: 13px; color: #111; }
.rl-fee-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; }
.rl-fee-n { flex: none; width: 18px; color: #111; }
.rl-fee-v { flex: 1; color: #111; font-weight: 600; font-variant-numeric: tabular-nums; }
.rl-fee-f { flex: none; color: #111; font-style: normal; font-size: 12px; }

/* ===== 电价参考 ===== */
.rl-price-ref { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin-top: 2px; padding-top: 4px; border-top: 1px dashed rgba(59, 155, 255, 0.15); font-size: 12.5px; }
.rl-price-k { color: #111; font-size: 12.5px; }
.rl-price-item { display: inline-flex; align-items: center; gap: 3px; color: #111; }
.rl-price-item i { width: 7px; height: 7px; border-radius: 50%; }

/* ===== 区块副标题 ===== */
.rl-block-sub { color: #111; font-size: 12.5px; font-weight: 400; }

/* ===== 分隔线 ===== */
.rl-spacer { height: 1px; margin: 4px 0; background: linear-gradient(90deg, transparent, rgba(59, 155, 255, 0.2), transparent); }

/* ===== 用电对比颜色 ===== */
.rl-row > b.up { color: #FF6B7A; }
.rl-row > b.down { color: #21CE99; }

/* ===== 不供水空态 ===== */
.rl-nosupply {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; margin-top: 4px;
  color: #111; font-size: 13px;
  background: rgba(122, 155, 187, 0.08);
  border: 1px dashed rgba(122, 155, 187, 0.35);
  border-radius: 10px;
}
.rl-nosupply svg { width: 14px; height: 14px; color: #9cbcd6; flex: none; }

/* ===== 告警/工单共用双卡布局 ===== */
.ov-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ov-mini {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(59, 155, 255, 0.12);
  border-radius: 12px;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.ov-mini:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(31, 60, 120, 0.08); }
.ov-mini-ic {
  flex: none; display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; color: #fff;
  background: linear-gradient(135deg, #21ce99, #17b37d);
  border-radius: 10px;
}
.ov-mini-ic svg { width: 18px; height: 18px; }
.ov-mini.ok .ov-mini-ic { background: linear-gradient(135deg, #21ce99, #17b37d); box-shadow: 0 2px 8px rgba(33, 206, 153, 0.3); }
.ov-mini.bad .ov-mini-ic { background: linear-gradient(135deg, #ff6b7a, #e04858); box-shadow: 0 2px 8px rgba(255, 107, 122, 0.3); }
.ov-mini-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ov-mini-k { color: #7a9bbb; font-size: 11px; font-weight: 500; }
.ov-mini-v {
  color: #1a3b5c; font-size: 20px; font-weight: 700;
  line-height: 1; font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
}
.ov-mini-v em { margin-left: 2px; color: #7a9bbb; font-size: 11px; font-style: normal; font-weight: 500; }

/* ===== 日历 ===== */
.rl-cal { gap: 6px; }
.rl-cal-head { display: flex; align-items: center; justify-content: space-between; }
.rl-cal-title { color: #1a3b5c; font-size: 13px; font-weight: 600; }
.rl-cal-tip { color: #7a9bbb; font-size: 11px; }
.cal { padding: 8px 6px; }
.cal-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.cal-nav { display: flex; width: 26px; height: 26px; align-items: center; justify-content: center; color: #3b9bff; background: rgba(59, 155, 255, 0.08); border: none; border-radius: 7px; cursor: pointer; transition: background 0.15s; }
.cal-nav:hover:not(:disabled) { background: rgba(59, 155, 255, 0.2); }
.cal-nav:disabled { opacity: 0.3; cursor: not-allowed; }
.cal-month { color: #1a3b5c; font-size: 13px; font-weight: 600; }
.cal-week { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.cal-week span { color: #9cbcd6; font-size: 11px; text-align: center; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal-cell {
  height: 28px; color: #1a3b5c; font-size: 12px;
  background: transparent; border: none; border-radius: 7px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.cal-cell:hover:not(:disabled) { background: rgba(59, 155, 255, 0.1); }
.cal-cell.is-today { color: #2eea8b; font-weight: 700; box-shadow: inset 0 0 0 1.5px rgba(46, 234, 139, 0.6); }
.cal-cell.is-active { color: #fff; background: linear-gradient(135deg, #3b9bff, #1e6fe0); font-weight: 700; box-shadow: 0 2px 8px rgba(59, 155, 255, 0.4); }
.cal-cell.is-other { color: #c5d8e8; }
.cal-cell.is-disabled { color: #dde8f2; cursor: not-allowed; }

/* ===== 堆叠模式 ===== */
@media only screen and (max-width: 1280px) {
  .rl-scroll { flex: none; overflow: visible; -webkit-mask-image: none; mask-image: none; }
}
</style>

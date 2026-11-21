<template>
  <div class="page" v-loading="loading">
    <ProSearchBar v-model="query" :items="searchItems" :span="8" @search="load" @reset="onReset" />
    <el-card shadow="never" class="art-table-card ratio-card">
      <el-row :gutter="12" v-if="summary" class="sum">
        <el-col :span="8"><el-statistic title="用水量(m³)" :value="summary.water_m3 || 0" /></el-col>
        <el-col :span="8"><el-statistic title="用电量(kWh)" :value="summary.energy_kwh || 0" /></el-col>
        <el-col :span="8"><el-statistic title="水电耗(kWh/m³)" :value="summary.ratio || 0" :precision="4" /></el-col>
      </el-row>
      <div ref="trendRef" class="chart"></div>
    </el-card>
    <el-card shadow="never" class="art-table-card ratio-card">
      <div ref="unitRef" class="chart"></div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import echarts from '@/utils/echarts'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import {
  chartColors,
  getAxisLabelStyle,
  getAxisLineStyle,
  getAxisTickStyle,
  getBarBase,
  getGridStyle,
  getLegendStyle,
  getLineBase,
  getSplitLineStyle,
  getTooltipStyle,
} from '@/utils/chartTheme'
import { fetchWaterRatio } from '@/api/energy'

const query = ref<Record<string, any>>({ time_range: null })
const searchItems: SearchFormItem[] = [
  {
    key: 'time_range',
    label: '时间',
    type: 'daterange',
    props: { type: 'daterange', valueFormat: 'YYYY-MM-DD', startPlaceholder: '开始', endPlaceholder: '结束', style: 'width: 100%' },
  },
]
function onReset() {
  query.value.time_range = null
  load()
}
const summary = ref<Record<string, number> | null>(null)
const loading = ref(false)
const trendRef = ref<HTMLDivElement | null>(null)
const unitRef = ref<HTMLDivElement | null>(null)
let trendChart: echarts.ECharts | null = null
let unitChart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

/** 图内标题（本卡片无 card-head，标题随图渲染） */
function chartTitle(text: string) {
  return { text, left: 0, top: 0, textStyle: { fontSize: 14, color: '#333', fontWeight: 500 as const } }
}

async function load() {
  loading.value = true
  try {
  const params: Record<string, unknown> = {}
  const [start, end] = query.value.time_range || []
  if (start) {
    params.start_date = start
    params.end_date = end
  }
  const { data } = await fetchWaterRatio(params)
  const d = data.data as {
    labels: string[]
    water_m3: number[]
    energy_kwh: number[]
    ratio: (number | null)[]
    summary: Record<string, number>
    unit_compare: { unit_name: string; electricity_kwh: number }[]
  }
  summary.value = d.summary
  await nextTick()
  if (trendRef.value) {
    if (!trendChart) trendChart = echarts.init(trendRef.value)
    trendChart.setOption({
      color: chartColors(),
      title: chartTitle('水电耗趋势'),
      tooltip: getTooltipStyle('axis'),
      legend: getLegendStyle(),
      grid: { ...getGridStyle(true), top: 52, right: 48 },
      xAxis: {
        type: 'category',
        data: d.labels?.map((x) => x.slice(5)),
        boundaryGap: true,
        axisTick: getAxisTickStyle(),
        axisLine: getAxisLineStyle(true),
        axisLabel: getAxisLabelStyle(true),
      },
      yAxis: [
        { type: 'value', name: '量', nameTextStyle: { color: '#999', fontSize: 12 }, axisLabel: getAxisLabelStyle(true), axisLine: getAxisLineStyle(false), splitLine: getSplitLineStyle(true) },
        { type: 'value', name: 'kWh/m³', nameTextStyle: { color: '#999', fontSize: 12 }, axisLabel: getAxisLabelStyle(true), axisLine: getAxisLineStyle(false), splitLine: getSplitLineStyle(false) },
      ],
      series: [
        { name: '用水', type: 'bar', data: d.water_m3, ...getBarBase(24) },
        { name: '用电', type: 'line', data: d.energy_kwh, ...getLineBase() },
        {
          name: '水电耗',
          type: 'line',
          yAxisIndex: 1,
          data: d.ratio,
          ...getLineBase(),
          // 显式指定颜色：避免取到调色板中的近白色 #EDF2FF 导致折线不可见
          lineStyle: { color: '#8B5CF6', width: 2 },
          itemStyle: { color: '#8B5CF6' },
        },
      ],
    }, true)
  }
  if (unitRef.value) {
    if (!unitChart) unitChart = echarts.init(unitRef.value)
    const units = d.unit_compare || []
    unitChart.setOption({
      color: chartColors(),
      title: chartTitle('泵组耗能对比'),
      tooltip: getTooltipStyle('axis'),
      grid: { ...getGridStyle(false), top: 40 },
      xAxis: {
        type: 'category',
        data: units.map((u) => u.unit_name),
        boundaryGap: true,
        axisTick: getAxisTickStyle(),
        axisLine: getAxisLineStyle(true),
        axisLabel: getAxisLabelStyle(true),
      },
      yAxis: {
        type: 'value',
        name: 'kWh',
        nameTextStyle: { color: '#999', fontSize: 12 },
        axisLabel: getAxisLabelStyle(true),
        axisLine: getAxisLineStyle(false),
        splitLine: getSplitLineStyle(true),
      },
      series: [{ type: 'bar', data: units.map((u) => u.electricity_kwh), ...getBarBase(40) }],
    }, true)
  }
  } finally {
    loading.value = false
  }
}

function onResize() {
  trendChart?.resize()
  unitChart?.resize()
}

onMounted(() => {
  load()
  if (unitRef.value) {
    ro = new ResizeObserver(onResize)
    ro.observe(unitRef.value)
  }
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', onResize)
  trendChart?.dispose()
  unitChart?.dispose()
})
</script>

<style scoped>
/* 打通 flex 链：页面 → 卡片 → 图表，占满可用高度且响应式 */
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.ratio-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.sum { margin-bottom: 12px; }
.ratio-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.chart {
  flex: 1;
  min-height: 280px;
  width: 100%;
}
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
</style>

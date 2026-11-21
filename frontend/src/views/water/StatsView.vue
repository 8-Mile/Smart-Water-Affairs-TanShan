<template>
  <div class="page mod-water">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="供水报表" name="stats">
    <ProSearchBar v-model="query" :items="searchItems" :span="6" @search="load" @reset="onReset" />
    <el-card shadow="never" class="art-table-card" v-loading="loading">
      <!-- 卡片标题栏：图标徽章 + 标题 + 科技线条（全站统一形制） -->
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:line-chart-line" />
        </span>
        <span class="head-title">供水报表</span>
        <span class="head-deco" aria-hidden />
      </div>
      <div v-if="summary" class="kpi-panel">
        <el-row :gutter="12" class="sum">
          <el-col :span="6"><el-statistic title="实际供水合计(m³)" :value="summary.actual_total || 0" /></el-col>
          <el-col :span="6"><el-statistic title="日均供水量(m³)" :value="summary.daily_avg || 0" :precision="0" /></el-col>
          <el-col :span="6">
            <el-statistic title="峰值日供水量(m³)" :value="summary.peak_day_value || 0" :precision="0" />
            <div v-if="summary.peak_day_date" class="kpi-sub">{{ summary.peak_day_date }}</div>
          </el-col>
          <el-col :span="6">
            <el-statistic
              v-if="summary.achievement_rate != null"
              title="计划完成率(%)"
              :value="summary.achievement_rate"
              :precision="1"
            />
            <div v-else class="kpi-na">
              <div class="kpi-na-title">计划完成率(%)</div>
              <div class="kpi-na-val">—</div>
            </div>
          </el-col>
        </el-row>
      </div>
      <div ref="chartRef" class="chart"></div>
    </el-card>
      </el-tab-pane>
      <el-tab-pane label="供水计划" name="plans" lazy>
        <PlansView />
      </el-tab-pane>
      <el-tab-pane label="供水对比" name="compare" lazy>
        <CompareView />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import echarts from '@/utils/echarts'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
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
import { fetchWaterStats } from '@/api/water'
import PlansView from './PlansView.vue'
import CompareView from './CompareView.vue'

const activeTab = ref('stats')

const query = ref<Record<string, any>>({ time_range: null, dimension: 'time' })
const searchItems: SearchFormItem[] = [
  {
    key: 'time_range',
    label: '时间',
    type: 'daterange',
    span: 8,
    props: { type: 'daterange', valueFormat: 'YYYY-MM-DD', startPlaceholder: '开始', endPlaceholder: '结束', style: 'width: 100%' },
  },
  {
    key: 'dimension',
    label: '维度',
    type: 'radiogroup',
    props: {
      options: [
        { label: '按时间', value: 'time' },
        { label: '按测点', value: 'unit' },
      ],
    },
  },
]
function onReset() {
  query.value.time_range = null
  query.value.dimension = 'time'
  load()
}
const chartRef = ref<HTMLDivElement | null>(null)
const summary = ref<Record<string, number> | null>(null)
const loading = ref(false)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

async function load() {
  loading.value = true
  try {
  const params: Record<string, unknown> = { dimension: query.value.dimension }
  const [start, end] = query.value.time_range || []
  if (start) {
    params.start_date = start
    params.end_date = end
  }
  const { data } = await fetchWaterStats(params)
  const d = data.data as {
    labels: string[]
    actual?: number[]
    plan?: (number | null)[]
    values?: number[]
    summary?: Record<string, number>
    title?: string
  }
  summary.value = d.summary || null
  await nextTick()
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  if (query.value.dimension === 'unit') {
    chart.setOption({
      color: chartColors(),
      tooltip: getTooltipStyle('axis'),
      grid: getGridStyle(false),
      xAxis: {
        type: 'category',
        data: d.labels,
        boundaryGap: true,
        axisTick: getAxisTickStyle(),
        axisLine: getAxisLineStyle(true),
        axisLabel: getAxisLabelStyle(true),
      },
      yAxis: {
        type: 'value',
        name: 'm³',
        nameTextStyle: { color: '#999', fontSize: 12 },
        axisLabel: getAxisLabelStyle(true),
        axisLine: getAxisLineStyle(false),
        splitLine: getSplitLineStyle(true),
      },
      series: [{ type: 'bar', data: d.values, ...getBarBase(40) }],
    }, true)
  } else {
    chart.setOption({
      color: chartColors(),
      tooltip: getTooltipStyle('axis'),
      legend: getLegendStyle(),
      grid: getGridStyle(true),
      xAxis: {
        type: 'category',
        data: d.labels?.map((x) => x.slice(5)),
        boundaryGap: true,
        axisTick: getAxisTickStyle(),
        axisLine: getAxisLineStyle(true),
        axisLabel: getAxisLabelStyle(true),
      },
      yAxis: {
        type: 'value',
        name: 'm³',
        nameTextStyle: { color: '#999', fontSize: 12 },
        axisLabel: getAxisLabelStyle(true),
        axisLine: getAxisLineStyle(false),
        splitLine: getSplitLineStyle(true),
      },
      series: [
        { name: '实际', type: 'line', data: d.actual, ...getLineBase() },
        { name: '计划', type: 'bar', data: d.plan, ...getBarBase(24) },
      ],
    }, true)
  }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  if (chartRef.value) {
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartRef.value)
  }
  window.addEventListener('resize', () => chart?.resize())
})
onBeforeUnmount(() => {
  ro?.disconnect()
  chart?.dispose()
})
</script>

<style scoped>
/* 打通 flex 链：页面 → tabs → 内容 → 面板，使图表随页面撑满且响应式 */
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.page :deep(.el-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.page :deep(.el-tabs__content) {
  display: flex;
  flex: 1;
  min-height: 0;
}
.page :deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.page :deep(.el-tab-pane) > .art-table-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar { margin-bottom: 12px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.sum { margin-bottom: 12px; }
.kpi-sub { margin-top: 2px; font-size: 12px; color: var(--art-gray-600, #9ca3af); text-align: center; }
.kpi-na { text-align: center; }
.kpi-na-title { font-size: 12px; color: var(--art-gray-600, #9ca3af); }
.kpi-na-val { font-size: 24px; font-weight: 600; color: var(--art-gray-500, #6b7280); }
.chart { flex: 1; min-height: 0; width: 100%; }
</style>

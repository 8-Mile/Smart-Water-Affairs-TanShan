<template>
  <div class="page">
    <ProSearchBar v-model="query" :items="searchItems" :span="6" @search="load" @reset="onReset" />
    <el-card shadow="never" class="art-table-card" v-loading="loading">
      <!-- 卡片标题栏：图标徽章 + 标题 + 科技线条（全站统一形制） -->
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:bar-chart-box-line" />
        </span>
        <span class="head-title">供水对比</span>
        <span class="head-deco" aria-hidden />
      </div>
      <div ref="chartRef" class="chart"></div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
  getLineBase,
  getSplitLineStyle,
  getTooltipStyle,
} from '@/utils/chartTheme'
import { fetchWaterCompare } from '@/api/water'

const query = ref<Record<string, any>>({ mode: 'unit', compare_date: '', time_range: null })
const searchItems = computed<SearchFormItem[]>(() => [
  {
    key: 'mode',
    label: '对比方式',
    type: 'radiogroup',
    props: {
      options: [
        { label: '按测点横向对比', value: 'unit' },
        { label: '按时段纵向对比', value: 'period' },
      ],
    },
  },
  query.value.mode === 'unit'
    ? { key: 'compare_date', label: '对比日期', type: 'date', props: { type: 'date', valueFormat: 'YYYY-MM-DD', placeholder: '对比日期' } }
    : {
        key: 'time_range',
        label: '时间',
        type: 'daterange',
        span: 8,
        props: { type: 'daterange', valueFormat: 'YYYY-MM-DD', startPlaceholder: '开始', endPlaceholder: '结束', style: 'width: 100%' },
      },
])
function onReset() {
  query.value.mode = 'unit'
  query.value.compare_date = ''
  query.value.time_range = null
  load()
}
const chartRef = ref<HTMLDivElement | null>(null)
const loading = ref(false)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

async function load() {
  loading.value = true
  try {
  const params: Record<string, unknown> = { mode: query.value.mode }
  if (query.value.mode === 'unit') {
    if (query.value.compare_date) params.compare_date = query.value.compare_date
  } else {
    const [start, end] = query.value.time_range || []
    if (start) {
      params.start_date = start
      params.end_date = end
    }
  }
  const { data } = await fetchWaterCompare(params)
  const d = data.data as { labels: string[]; values: number[]; title?: string }
  await nextTick()
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  const isUnit = query.value.mode === 'unit'
  chart.setOption(
    {
      // 标题由卡片头承载，图内不再重复
      color: chartColors(),
      tooltip: getTooltipStyle('axis'),
      grid: { ...getGridStyle(false), left: 12 },
      xAxis: {
        type: 'category',
        data: d.labels?.map((x) => (x.length > 10 ? x.slice(5) : x)),
        boundaryGap: isUnit,
        axisTick: getAxisTickStyle(),
        axisLine: getAxisLineStyle(true),
        axisLabel: getAxisLabelStyle(true),
      },
      yAxis: {
        type: 'value',
        name: 'm³',
        nameGap: 10,
        nameTextStyle: { color: '#999', fontSize: 12, padding: [0, 0, 0, 8] },
        axisLabel: getAxisLabelStyle(true),
        axisLine: getAxisLineStyle(false),
        splitLine: getSplitLineStyle(true),
      },
      series: [
        isUnit
          ? { type: 'bar', data: d.values, ...getBarBase(40) }
          : { type: 'line', data: d.values, areaStyle: { opacity: 0.08 }, ...getLineBase() },
      ],
    },
    true,
  )
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
/* 打通 flex 链：页面 → 卡片 → 图表，占满可用高度且响应式 */
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.page > .art-table-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
.chart {
  flex: 1;
  min-height: 0;
  width: 100%;
}
</style>

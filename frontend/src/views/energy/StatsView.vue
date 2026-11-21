<template>
  <div class="page mod-energy">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="电耗统计" name="stats">
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="load"
      @reset="onReset"
    >
      <template #range="{ modelValue }">
        <el-date-picker
          v-model="modelValue.range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始"
          end-placeholder="结束"
        />
      </template>
      <template #dimension="{ modelValue }">
        <el-radio-group v-model="modelValue.dimension">
          <el-radio-button value="day">按日</el-radio-button>
          <el-radio-button value="unit">按机组</el-radio-button>
        </el-radio-group>
      </template>
    </ProSearchBar>

    <el-card shadow="never" class="art-table-card" v-loading="loading">
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:lightning-line" />
        </span>
        <span class="head-title">电耗统计</span>
        <span class="head-deco" aria-hidden />
      </div>
      <div class="chart-wrap">
        <div ref="chartRef" class="chart"></div>
      </div>
      <div class="table-wrap">
        <ProTableHeader
          v-model:columns="tableColumns"
          :export-columns="exportColumns"
          :export-data="table"
          export-filename="电耗统计"
          @refresh="load"
        />
        <ProTable :data="table" :columns="tableColumns" />
      </div>
    </el-card>
      </el-tab-pane>
      <el-tab-pane label="电费统计" name="fee" lazy>
        <FeeView />
      </el-tab-pane>
      <el-tab-pane label="水电耗对比" name="ratio" lazy>
        <RatioView />
      </el-tab-pane>
      <!-- 耗能录入已隐藏：能耗由 SCADA 功率积分每小时自动重算（energy_stats_service），
           手动录入会被覆盖；RecordsView 保留作历史补录/故障兜底，可经路由直达 -->
      <el-tab-pane label="电价设置" name="prices" lazy>
        <PricesView />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import echarts from '@/utils/echarts'
import { fetchEnergyStats } from '@/api/energy'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
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
import FeeView from './FeeView.vue'
import RatioView from './RatioView.vue'
import PricesView from './PricesView.vue'

const activeTab = ref('stats')

const query = reactive<{ range: string[] | null; dimension: string }>({
  range: null,
  dimension: 'day',
})

const searchItems: SearchFormItem[] = [
  { key: 'range', label: '时间范围', type: 'daterange', span: 10 },
  { key: 'dimension', label: '统计维度', type: 'radiogroup', span: 8 },
]

const tableColumns = ref<ProColumn[]>([
  { prop: 'time', label: '时间', width: 140 },
  { prop: 'electricity_kwh', label: '用电量(kWh)', width: 130 },
  { prop: 'water_m3', label: '用水量(m³)', width: 130 },
  { prop: 'ratio', label: '水电耗(kWh/m³)', minWidth: 140 },
])

const exportColumns = [
  { prop: 'time', label: '时间' },
  { prop: 'electricity_kwh', label: '用电量(kWh)' },
  { prop: 'water_m3', label: '用水量(m³)' },
  { prop: 'ratio', label: '水电耗(kWh/m³)' },
]

const chartRef = ref<HTMLDivElement | null>(null)
const table = ref<Record<string, unknown>[]>([])
const loading = ref(false)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

function onReset() {
  query.range = null
  query.dimension = 'day'
  load()
}

async function load() {
  loading.value = true
  try {
  const params: Record<string, unknown> = { dimension: query.dimension }
  if (query.range) {
    params.start_date = query.range[0]
    params.end_date = query.range[1]
  }
  const { data } = await fetchEnergyStats(params)
  const d = data.data as {
    labels: string[]
    electricity_kwh?: number[]
    values?: number[]
    table?: Record<string, unknown>[]
    title?: string
  }
  table.value = d.table || []
  await nextTick()
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  const labels = d.labels?.map((x) => (x.length > 10 ? x.slice(5) : x))
  const values = d.electricity_kwh || d.values || []
  const isUnit = query.dimension === 'unit'
  chart.setOption(
    {
      color: chartColors(),
      tooltip: getTooltipStyle('axis'),
      // top 预留 28px：容纳 y 轴 name 'kWh'（containLabel 不含 name，top 15 会被容器上边裁切）
      grid: { ...getGridStyle(false), top: 28 },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: isUnit,
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
      series: [
        isUnit
          ? { type: 'bar', data: values, ...getBarBase(40) }
          : { type: 'line', data: values, areaStyle: { opacity: 0.08 }, ...getLineBase() },
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

<style lang="scss" scoped>
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
/* 卡片 body 作为 flex 容器，让图表区和表格区各占 50%（参考水电耗对比的卡片结构） */
.page :deep(.el-tab-pane) > .art-table-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 12px;
}
.card-head { flex: 0 0 auto; }
.chart-wrap {
  flex: 1 1 50%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chart {
  flex: 1;
  min-height: 0;
  width: 100%;
}
.table-wrap {
  flex: 1 1 50%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.table-wrap :deep(.pro-table) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>

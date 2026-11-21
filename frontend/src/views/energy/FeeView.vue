<template>
  <div class="page mod-energy" v-loading="loading">
    <ProSearchBar v-model="query" :items="searchItems" :span="8" @search="load" @reset="onReset" />
    <el-alert v-if="data && !data.has_price" type="warning" title="尚未配置有效电价，请先到电价设置维护" show-icon :closable="false" />
    <div v-if="data" class="fee-groups">
      <el-card shadow="never" class="art-table-card fee-group-card">
        <div class="group-head">
          <span class="group-title">电费统计</span>
          <span class="group-unit">元</span>
        </div>
        <div class="kpi-row">
          <KpiCard
            v-for="c in feeCards"
            :key="c.label"
            variant="metric"
            :label="c.label"
            :value="c.value"
            :color="c.color"
            :icon="c.icon"
          />
        </div>
      </el-card>
      <el-card shadow="never" class="art-table-card fee-group-card">
        <div class="group-head">
          <span class="group-title">用电量统计</span>
          <span class="group-unit">kWh</span>
        </div>
        <div class="kpi-row">
          <KpiCard
            v-for="c in kwhCards"
            :key="c.label"
            variant="metric"
            :label="c.label"
            :value="c.value"
            :color="c.color"
            :icon="c.icon"
          />
        </div>
      </el-card>
    </div>
    <el-card shadow="never" class="art-table-card fee-card chart-card">
      <div ref="chartRef" class="chart"></div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import echarts from '@/utils/echarts'
import { fetchEnergyFee } from '@/api/energy'
import KpiCard from '@/components/KpiCard.vue'
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
const data = ref<Record<string, unknown> | null>(null)
const chartRef = ref<HTMLDivElement | null>(null)
const loading = ref(false)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

const feeCards = computed(() => {
  const d = (data.value || {}) as Record<string, number>
  return [
    { label: '总电费', value: d.total_fee ?? 0, color: '#2563eb', icon: 'ri:money-cny-circle-line' },
    { label: '峰时电费', value: d.peak_fee ?? 0, color: '#f59e0b', icon: 'ri:sun-line' },
    { label: '平时电费', value: d.normal_fee ?? 0, color: '#8b5cf6', icon: 'ri:cloud-line' },
    { label: '谷时电费', value: d.valley_fee ?? 0, color: '#10b981', icon: 'ri:moon-line' },
  ]
})

const kwhCards = computed(() => {
  const d = (data.value || {}) as Record<string, number>
  return [
    { label: '总电量', value: d.total_kwh ?? 0, color: '#2563eb', icon: 'ri:battery-charge-line' },
    { label: '峰时电量', value: d.peak_kwh ?? 0, color: '#f59e0b', icon: 'ri:flashlight-line' },
    { label: '平时电量', value: d.normal_kwh ?? 0, color: '#8b5cf6', icon: 'ri:flashlight-line' },
    { label: '谷时电量', value: d.valley_kwh ?? 0, color: '#10b981', icon: 'ri:flashlight-line' },
  ]
})

async function load() {
  loading.value = true
  try {
  const params: Record<string, unknown> = {}
  const [start, end] = query.value.time_range || []
  if (start) {
    params.start_date = start
    params.end_date = end
  }
  const { data: resp } = await fetchEnergyFee(params)
  data.value = resp.data
  const daily = (resp.data.daily || []) as { date: string; total_kwh: number; total_fee: number }[]
  await nextTick()
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  chart.setOption({
    color: chartColors(),
    tooltip: getTooltipStyle('axis'),
    legend: getLegendStyle(),
    grid: { ...getGridStyle(true), right: 48 },
    xAxis: {
      type: 'category',
      data: daily.map((x) => x.date.slice(5)),
      boundaryGap: true,
      axisTick: getAxisTickStyle(),
      axisLine: getAxisLineStyle(true),
      axisLabel: getAxisLabelStyle(true),
    },
    yAxis: [
      {
        type: 'value',
        name: 'kWh',
        nameTextStyle: { color: '#999', fontSize: 12 },
        axisLabel: getAxisLabelStyle(true),
        axisLine: getAxisLineStyle(false),
        splitLine: getSplitLineStyle(true),
      },
      {
        type: 'value',
        name: '元',
        nameTextStyle: { color: '#999', fontSize: 12 },
        axisLabel: getAxisLabelStyle(true),
        axisLine: getAxisLineStyle(false),
        splitLine: getSplitLineStyle(false),
      },
    ],
    series: [
      { name: '日用电量', type: 'line', data: daily.map((x) => x.total_kwh), ...getLineBase() },
      { name: '日电费', type: 'bar', yAxisIndex: 1, data: daily.map((x) => x.total_fee), ...getBarBase(28) },
    ],
  }, true)
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
/* 两组 KPI 卡片并排：电费统计 / 用电量统计，各占一半宽度；窄屏自动换行 */
.fee-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  flex-shrink: 0;
}
.fee-group-card {
  flex: 1 1 calc(50% - 6px);
  min-width: 320px;
}
.fee-group-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.group-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.group-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2a44;
}
.group-unit {
  font-size: 12px;
  color: #8a94a6;
}
/* 每组 KPI 卡自适应列数：宽屏 4 列，窄屏自动换行，保证数字不被挤压 */
.fee-group-card .kpi-row {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
/* 趋势图卡片吃掉剩余高度 */
.chart-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.chart-card :deep(.el-card__body) {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chart {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}
</style>

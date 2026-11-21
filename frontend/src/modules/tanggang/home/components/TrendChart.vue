<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { slots } from '../data/demo'

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, SVGRenderer])

const props = defineProps<{ kind: 'spark' | 'bars'; first: number[]; second?: number[] }>()
const host = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null

const option = computed(() => {
  const mini = props.kind === 'spark'
  return {
    animation: false,
    color: ['#709DE0', '#81CBDB'],
    aria: { enabled: false },
    textStyle: { fontFamily: 'Arial, sans-serif' },
    grid: mini
      ? { left: 0, right: 0, top: 7, bottom: 2 }
      : { left: 3, right: 3, top: 4, bottom: 21 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: '#f9fcff',
      borderColor: '#d8e4ef',
      textStyle: { color: '#354d63', fontSize: 12 },
    },
    xAxis: {
      type: 'category',
      data: slots,
      boundaryGap: !mini,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: !mini, interval: 0, color: '#8091a4', fontSize: 10, margin: 6 },
    },
    yAxis: { type: 'value', show: false, scale: mini },
    series: mini
      ? [
          {
            name: '作业量（件次）',
            type: 'line',
            data: props.first,
            showSymbol: false,
            lineStyle: { width: 2.3, color: '#789bc7' },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: '#a5c2ee88' },
                  { offset: 1, color: '#e7eff822' },
                ],
              },
            },
          },
        ]
      : [props.first, props.second ?? []].map((data, i) => ({
          type: 'bar',
          name: i ? '出库（件）' : '入库（件）',
          data,
          barMaxWidth: 15,
          barGap: '20%',
          itemStyle: { borderRadius: [2, 2, 0, 0] },
        })),
  }
})

function render() {
  chart?.setOption(option.value, true)
}

onMounted(() => {
  if (!host.value) return
  chart = echarts.init(host.value, undefined, { renderer: 'svg' })
  render()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(host.value)
})
watch(option, render)
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>
<template>
  <div
    ref="host"
    class="trend-chart"
    role="img"
    :aria-label="kind === 'spark' ? '分时作业量折线图' : '分时出入库双柱图'"
  />
</template>

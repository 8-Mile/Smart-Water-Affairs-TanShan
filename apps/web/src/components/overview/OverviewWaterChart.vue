<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { DailyWaterRecord } from "../../demo/types";

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
const props = defineProps<{ records: DailyWaterRecord[]; period: "day" | "week" | "month" }>();
const root = ref<HTMLDivElement>();
let chart: echarts.ECharts | undefined;
let observer: ResizeObserver | undefined;
function render() {
  if (!root.value) return;
  chart ??= echarts.init(root.value);
  const groups = new Map<string, { consumed: number; reused: number }>();
  for (const row of props.records) {
    const date = new Date(row.date + "T00:00:00Z");
    if (props.period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const key = props.period === "month" ? row.date.slice(0, 7) : props.period === "week" ? date.toISOString().slice(5, 10) + "周" : row.date.slice(5);
    const group = groups.get(key) ?? { consumed: 0, reused: 0 };
    group.consumed += row.consumed;
    group.reused += row.reused;
    groups.set(key, group);
  }
  const values = [...groups.values()];
  const compact = root.value.clientWidth < 420;
  const short = root.value.clientHeight < 180;
  chart.resize();
  const gradient = (top: string, bottom: string) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: top }, { offset: 1, color: bottom }]);
  chart.setOption({
    animation: false,
    textStyle: { fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif', color: "#070e46", fontSize: 12 },
    grid: { left: compact ? 50 : 58, right: compact ? 41 : 49, top: short ? 28 : 34, bottom: short ? 40 : 48 },
    tooltip: { trigger: "axis", renderMode: "richText", valueFormatter: (v: unknown) => typeof v === "number" ? v.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) : String(v) },
    legend: { bottom: 3, itemWidth: 14, itemHeight: 13, itemGap: compact ? 15 : 25, textStyle: { color: "#080c40", fontSize: 12 } },
    xAxis: { type: "category", data: [...groups.keys()], axisLine: { lineStyle: { color: "#9ad2fa" } }, axisTick: { show: false }, axisLabel: { color: "#060b3d", fontSize: 11, interval: compact ? 1 : 0, hideOverlap: true } },
    yAxis: [
      { type: "value", name: "用水量（m³）", nameTextStyle: { align: "right", padding: [0, -33, 0, 0], color: "#080e43", fontWeight: "bold", fontSize: 12 }, max: props.period === "day" ? 15000 : undefined, interval: props.period === "day" ? short ? 5000 : 3000 : undefined, splitNumber: short ? 3 : 5, axisLabel: { color: "#080e43", fontSize: 12 }, splitLine: { lineStyle: { color: "#cae4fa" } } },
      { type: "value", name: "回用占比", nameTextStyle: { color: "#080e43", fontWeight: "bold", fontSize: 12, padding: [0, -8, 0, 0] }, min: 20, max: 80, interval: short ? 20 : 10, axisLabel: { formatter: "{value}%", color: "#080e43", fontSize: 12 }, splitLine: { show: false } },
    ],
    series: [
      { name: "回用水", type: "bar", stack: "consumption", data: values.map(v => v.reused), barMaxWidth: 26, barWidth: "55%", itemStyle: { color: gradient("#91de69", "#1dc433") } },
      { name: "其他用水", type: "bar", stack: "consumption", data: values.map(v => v.consumed - v.reused), barMaxWidth: 26, barWidth: "55%", itemStyle: { color: gradient("#00abf3", "#82e1fa") } },
      { name: "回用占比", type: "line", yAxisIndex: 1, data: values.map(v => v.consumed ? +(v.reused / v.consumed * 100).toFixed(1) : null), symbol: "circle", symbolSize: 7, itemStyle: { color: "#efffff", borderColor: "#0829ff", borderWidth: 2 }, lineStyle: { color: "#0829ff", width: 2.3 } },
    ],
  }, true);
}
onMounted(() => { render(); observer = new ResizeObserver(render); if (root.value) observer.observe(root.value); });
watch(() => [props.records, props.period], render, { deep: true });
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); });
</script>

<template>
  <div ref="root" class="overview-water-chart" role="img" aria-label="最近7日用水量、回用水量及回用占比模拟计量趋势" :title="period === 'day' ? 'MOCK 日用水计量；其他用水 = 总用水 − 回用水' : '当前7天模拟样本按周期聚合，非完整周/月统计'" />
</template>

<style scoped>
.overview-water-chart { width:100%; height:210px; min-width:0; overflow:hidden; }
@media(min-width:1241px) {
  .overview-water-chart { flex:1; height:auto; min-height:0; }
}
</style>

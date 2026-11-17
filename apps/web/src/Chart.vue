<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref, nextTick } from "vue";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
const props = withDefaults(
  defineProps<{
    labels: string[];
    series: { name: string; values: (number | null)[]; unit: string }[];
    type?: "bar" | "line";
    height?: number;
    dual?: boolean;
  }>(),
  { type: "line", height: 280, dual: false },
);
const root = ref<HTMLElement>();
let chart: echarts.ECharts | undefined, observer: ResizeObserver | undefined;
function render() {
  if (!root.value) return;
  chart ??= echarts.init(root.value);
  chart.setOption(
    {
      animation: false,
      color: ["#247ba8", "#54a892", "#e1a249"],
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        valueFormatter: (value: unknown) =>
          typeof value === "number"
            ? value.toFixed(3)
            : String(value ?? "未提供"),
      },
      legend: { bottom: 0 },
      grid: { left: 65, right: props.dual ? 65 : 24, top: 32, bottom: 70 },
      xAxis: {
        type: "category",
        data: props.labels,
        axisLabel: { hideOverlap: true },
      },
      yAxis: props.dual
        ? props.series.map((s) => ({ type: "value", name: s.unit }))
        : { type: "value", name: props.series[0]?.unit ?? "" },
      series: props.series.map((s, i) => ({
        name: s.name,
        data: s.values,
        type: props.dual && i === 1 ? "line" : props.type,
        yAxisIndex: props.dual ? i : 0,
        smooth: false,
        barMaxWidth: 40,
        connectNulls: false,
        areaStyle: props.type === "line" ? { opacity: 0.05 } : undefined,
      })),
    },
    true,
  );
}
onMounted(() => {
  render();
  observer = new ResizeObserver(() => chart?.resize());
  if (root.value) observer.observe(root.value);
});
watch(
  () => [props.labels, props.series, props.type, props.dual],
  async () => {
    await nextTick();
    render();
  },
  { deep: true },
);
onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>
<template>
  <div
    ref="root"
    class="chart"
    :style="{ height: height + 'px' }"
    role="img"
    :aria-label="series.map((s) => s.name + '（' + s.unit + '）').join('，')"
  ></div>
</template>

<template>
  <svg
    class="mini-trend"
    viewBox="0 0 140 48"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <!-- 折线下方浅色区域 -->
    <path
      :d="areaPath"
      :fill="color"
      fill-opacity="0.07"
    />

    <!-- 主折线 -->
    <polyline
      :points="linePoints"
      :stroke="color"
      fill="none"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- 数据节点 -->
    <template v-if="!isZero">
      <circle
        v-for="(point, index) in coords"
        :key="index"
        :cx="point.x"
        :cy="point.y"
        r="2.6"
        fill="#FFFFFF"
        :stroke="color"
        stroke-width="1.7"
      />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  values: number[]
  color?: string
}>(), {
  color: '#438CF5'
})

const isZero = computed(() =>
  props.values.every(v => v === 0)
)

const coords = computed(() => {
  const data = props.values.length
    ? props.values
    : [0]

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min

  return data.map((value, index) => ({
    x: 5 + index * 130 / Math.max(data.length - 1, 1),
    y: isZero.value
      ? 39
      : range === 0
        ? 24
        : 39 - (value - min) / range * 30
  }))
})

const linePoints = computed(() =>
  coords.value
    .map(p => `${p.x},${p.y}`)
    .join(' ')
)

const areaPath = computed(() => {
  const points = coords.value

  const line = points
    .map(p => `${p.x},${p.y}`)
    .join(' L ')

  return `M ${line} L ${points[points.length - 1]?.x},43 L 5,43 Z`
})
</script>

<style scoped>
.mini-trend {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
</style>

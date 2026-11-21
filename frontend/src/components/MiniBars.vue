<template>
  <svg viewBox="0 0 160 60" class="mini-bars" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.65" />
        <stop offset="100%" :stop-color="color" stop-opacity="0.05" />
      </linearGradient>
    </defs>
    <rect
      v-for="(bar, index) in bars"
      :key="index"
      :x="bar.x"
      :y="60 - bar.h"
      :width="bar.w"
      :height="bar.h"
      rx="3"
      :fill="`url(#${gradientId})`"
    />
  </svg>
</template>
<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(defineProps<{ values: number[]; color?: string }>(), { color: '#268B9B' })
const gradientId = `bar-${useId()}`

const VIEW_W = 160
const VIEW_H = 60

/* 按序列最大值自适应归一化（真实数据量级不一，不能用固定系数）：
   柱高映射到 4–58px，柱宽随数量自适应铺满；全零/空序列渲染压底 2px 基线 */
const bars = computed(() => {
  const data = props.values
  const n = data.length
  if (!n) return []
  const max = Math.max(...data, 0)
  const slot = VIEW_W / n
  const w = Math.max(2, slot * 0.62)
  return data.map((v, i) => {
    const h = !max || v <= 0 ? 2 : Math.round((v / max) * (VIEW_H - 6)) + 4
    return { x: i * slot + (slot - w) / 2, w, h }
  })
})
</script>
<style scoped>
/* 宽高由使用方容器控制，SVG 通过 preserveAspectRatio 等比缩放 */
.mini-bars {
  display: block;
  width: 100%;
  height: 100%;
}
</style>

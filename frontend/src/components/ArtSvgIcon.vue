<!-- 图标组件（对齐 art-design-pro 的 ArtSvgIcon，基于 Iconify） -->
<template>
  <Icon v-if="icon" :icon="icon" v-bind="allAttrs" />
</template>

<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { Icon } from '@iconify/vue'

defineOptions({ name: 'ArtSvgIcon', inheritAttrs: false })

interface Props {
  /** Iconify icon name */
  icon?: string
}

defineProps<Props>()

const attrs = useAttrs()

/** 合并 class 和 style，其余原样透传（含 click 等事件） */
const allAttrs = computed(() => {
  const { class: cls, style, ...rest } = attrs as Record<string, any>
  return {
    ...rest,
    class: ['art-svg-icon', 'inline', cls].filter(Boolean).join(' '),
    style,
  }
})
</script>

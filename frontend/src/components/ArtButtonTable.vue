<!-- 表格操作按钮（1:1 对齐参考项目 art-button-table，内置悬浮标签提示） -->
<template>
  <el-tooltip :content="title" placement="top" :show-after="300" :disabled="!title">
    <div
      :class="[
        'ab-trigger inline-flex items-center justify-center min-w-8 h-8 px-2.5 mr-2.5 text-sm cursor-pointer rounded-md align-middle',
        buttonClass,
      ]"
      :style="{ backgroundColor: buttonBgColor, color: iconColor }"
      @click="emit('click')"
    >
      <ArtSvgIcon :icon="iconContent" />
      <!-- 文字标签：仅在卡片 ⋮ 下拉菜单里显示（表格内图标态隐藏） -->
      <span v-if="props.label" class="ab-label">{{ props.label }}</span>
    </div>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'

defineOptions({ name: 'ArtButtonTable' })

interface Props {
  /** 按钮类型 */
  type?: 'add' | 'edit' | 'delete' | 'more' | 'view'
  /** 按钮图标 */
  icon?: string
  /** 按钮样式类 */
  iconClass?: string
  /** icon 颜色 */
  iconColor?: string
  /** 按钮背景色 */
  buttonBgColor?: string
  /** 悬浮标签提示文案（说明按钮用途） */
  title?: string
  /** 下拉菜单里的文字标签（小屏 ⋮ 聚合时显示） */
  label?: string
}

const props = withDefaults(defineProps<Props>(), {})

const emit = defineEmits<{
  (e: 'click'): void
}>()

// 默认按钮配置（与参考项目一致；view 用主色蓝增强辨识度）
const defaultButtons = {
  add: { icon: 'ri:add-fill', class: 'bg-theme/12 text-theme' },
  edit: { icon: 'ri:pencil-line', class: 'bg-secondary/12 text-secondary' },
  delete: { icon: 'ri:delete-bin-5-line', class: 'bg-error/12 text-error' },
  view: { icon: 'ri:eye-line', class: 'bg-theme/12 text-theme' },
  more: { icon: 'ri:more-2-fill', class: '' },
} as const

// 获取图标内容
const iconContent = computed(() => {
  return props.icon || (props.type ? defaultButtons[props.type]?.icon : '') || ''
})

// 获取按钮样式类
const buttonClass = computed(() => {
  return props.iconClass || (props.type ? defaultButtons[props.type]?.class : '') || ''
})
</script>

<style scoped>
/* 交互态：hover 抬起 1px、active 回落，过渡统一走全站动效 token */
.ab-trigger {
  transition:
    transform var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}
.ab-trigger:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px -5px rgba(35, 78, 130, 0.35);
}
.ab-trigger:active {
  transform: translateY(0);
  box-shadow: none;
}
@media (prefers-reduced-motion: reduce) {
  .ab-trigger {
    transition: none;
  }
  .ab-trigger:hover,
  .ab-trigger:active {
    transform: none;
  }
}
</style>

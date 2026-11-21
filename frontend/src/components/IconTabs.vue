<!--
  IconTabs —— 带线性图标的 el-tabs 封装（全站 tab 统一形制）
  - 选中项：主题蓝文字 + 底部指示条（el-tabs 原生）
  - 标签内容：图标 + 文字，样式在组件内统一维护
  - pane 内容通过同名具名插槽下发，lazy 默认开启
  @example
  <IconTabs v-model="activeTab" :tabs="tabs">
    <template #list><DeviceList /></template>
    <template #types><TypesView /></template>
  </IconTabs>
-->
<template>
  <el-tabs
    :class="{ 'is-single-tab': tabs.length <= 1 }"
    :model-value="modelValue"
    @update:model-value="(v: TabPaneName) => emit('update:modelValue', String(v))"
    @tab-change="(n: TabPaneName) => emit('tab-change', String(n))"
  >
    <el-tab-pane v-for="tab in tabs" :key="tab.name" :name="tab.name" :lazy="lazy">
      <template #label>
        <span class="icon-tab-label">
          <ArtSvgIcon :icon="tab.icon" />{{ tab.label }}
        </span>
      </template>
      <slot :name="tab.name" />
    </el-tab-pane>
  </el-tabs>
</template>

<script setup lang="ts">
import type { TabPaneName } from 'element-plus'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'

export interface IconTabItem {
  name: string
  label: string
  icon: string
}

withDefaults(
  defineProps<{
    modelValue: string
    tabs: IconTabItem[]
    /** pane 懒渲染（对齐 el-tab-pane lazy 语义），默认开启 */
    lazy?: boolean
  }>(),
  { lazy: true },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'tab-change', name: string): void
}>()
</script>

<style lang="scss" scoped>
/* tab 标签：线性图标 + 文字（还原设计稿形制，激活色由 el-tabs 主题接管） */
.icon-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;

  :deep(svg) {
    font-size: 17px;
  }
}

/* 高度链内置：页面根接入 .page-fill（或自身 flex 链接视口高度）后，
   el-tabs → content → pane 自动传递剩余高度，pane 内容容器 flex:1 即可撑满，
   各 Tab 页面无需再写页面级高度补丁；父级无高度约束时退化为自然高度，无回归 */
:deep(.el-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/* 仅一个标签时隐藏标签栏（无需切换，避免多余空白条） */
.is-single-tab :deep(.el-tabs__header) {
  display: none;
}
:deep(.el-tabs__content) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
:deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
</style>

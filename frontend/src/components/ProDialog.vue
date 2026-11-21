<!--
  ProDialog —— 全站统一弹窗封装（顶部波纹标题栏形制，对齐设备分类设计稿）
  - 统一三要素：el-button circle 关闭钮 + 顶部波纹背景标题栏 + 底部取消/保存按钮
  - 视觉由全局 .el-dialog 样式（styles/index.css）统一提供：波纹标题栏 + 标题蓝条
  - 本组件封装行为：v-model + title + 默认 footer（取消/保存渐变按钮 + loading）
  - el-dialog 的其余属性（top/fullscreen/close-on-click-modal/before-close/class 等）经 $attrs 原样透传
  - 复杂底部操作区用 #footer 插槽完全自定义；open/close 等未声明事件同样透传
  @example
  <ProDialog v-model="visible" title="新增" :confirm-loading="saving" @confirm="onSave">
    <el-form>...</el-form>
  </ProDialog>
  <ProDialog v-model="visible" title="详情" hide-footer>...</ProDialog>
-->
<template>
  <el-dialog
    v-bind="$attrs"
    :model-value="modelValue"
    :width="width"
    :destroy-on-close="destroyOnClose"
    :show-close="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @closed="emit('closed')"
  >
    <!-- 自定义标题栏：标题（蓝条由全局 .el-dialog__title::after 提供）+ el-button circle 关闭钮（全站统一） -->
    <template #header="{ close }">
      <span class="el-dialog__title">{{ title }}</span>
      <el-button class="pro-dialog-close" circle :icon="Close" aria-label="关闭" @click="close" />
    </template>
    <slot />
    <template v-if="$slots.footer || !hideFooter" #footer>
      <slot name="footer">
        <el-button @click="emit('update:modelValue', false)">{{ cancelText }}</el-button>
        <el-button type="primary" :loading="confirmLoading" @click="emit('confirm')">
          {{ confirmText }}
        </el-button>
      </slot>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'

defineOptions({ name: 'ProDialog', inheritAttrs: false })

withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    width?: string | number
    /** 隐藏底部按钮区（纯展示/自定义交互弹窗） */
    hideFooter?: boolean
    cancelText?: string
    confirmText?: string
    confirmLoading?: boolean
    destroyOnClose?: boolean
  }>(),
  {
    width: '540px',
    hideFooter: false,
    cancelText: '取消',
    confirmText: '保存',
    confirmLoading: false,
    destroyOnClose: true,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm'): void
  (e: 'closed'): void
}>()
</script>

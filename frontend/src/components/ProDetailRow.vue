<!--
  ProDetailRow —— 详情抽屉单行：图标 + 标签 + 值
  用法（单行：图标 + 标签 + 值）：
    纯文本值传 icon/label/value；自定义内容（如 dd-pill 胶囊）用默认插槽覆盖 value
    top 为顶部对齐（多行值场景），mono 为等宽数字字体
-->
<template>
  <div class="pd-row" :class="{ 'pd-row--top': top }">
    <div class="pd-label">
      <ArtSvgIcon v-if="icon" class="lab-icon" :icon="icon" />
      <span>{{ label }}</span>
    </div>
    <div class="pd-value" :class="{ 'pd-mono': mono }">
      <slot>{{ value ?? '—' }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import ArtSvgIcon from './ArtSvgIcon.vue'

interface Props {
  icon?: string
  label: string
  value?: string | number | null
  top?: boolean
  mono?: boolean
}

defineProps<Props>()
</script>

<style scoped>
.pd-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed rgba(148, 173, 205, 0.28);
  font-size: 13px;
  line-height: 1.6;
}
.pd-row:last-child {
  border-bottom: none;
}
/* 多行值行：标签与值统一垂直居中（标签短、值多行时两者仍以中线对齐） */
.pd-row--top .pd-value {
  display: flex;
  align-items: center;
}
.pd-label {
  display: flex;
  flex: 0 0 84px;
  align-items: center;
  gap: 6px;
  padding-right: 10px;
  color: #5a6b83;
  /* 表格式竖线：框住左侧标签列，贯穿整行高度 */
  border-right: 1px solid rgba(148, 173, 205, 0.32);
}
.pd-label .lab-icon {
  font-size: 13px;
  color: #5f8dc9;
}
.pd-value {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  color: #33415a;
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
}
.pd-mono {
  font-family: 'DIN Alternate', 'Bahnschrift', 'Rajdhani', 'Helvetica Neue', 'PingFang SC', sans-serif;
  font-variant-numeric: tabular-nums;
}
</style>

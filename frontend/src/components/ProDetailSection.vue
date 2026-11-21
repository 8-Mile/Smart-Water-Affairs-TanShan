<!--
  ProDetailSection —— 详情抽屉内的分块卡片
  无 title 时仅渲染白卡容器（纯信息行列表）；
  有 title 时渲染头部（徽章 + 标题 + 可选计数）
  用法（配对标签，默认插槽放内容）：
    纯信息卡：ProDetailSection 包裹若干 ProDetailRow
    分块卡：  ProDetailSection 传 icon/title/count，插槽放 FlowTimeline 等内容
-->
<template>
  <section class="pd-section">
    <div v-if="title" class="pd-sec-head">
      <span class="pd-sec-badge">
        <ArtSvgIcon :icon="icon" />
      </span>
      <h3 class="pd-sec-title">{{ title }}</h3>
      <span v-if="count !== undefined" class="pd-sec-count">{{ count }}</span>
    </div>
    <div class="pd-sec-body" :class="{ 'pd-sec-body--flush': flush }">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import ArtSvgIcon from './ArtSvgIcon.vue'

interface Props {
  icon?: string
  title?: string
  count?: string | number
  /** 紧凑模式：body 不加内边距（内容自带 padding，如纯 ProDetailRow 列表） */
  flush?: boolean
}

withDefaults(defineProps<Props>(), {
  icon: 'ri:file-list-line',
})
</script>

<style scoped>
.pd-section {
  overflow: hidden;
  background: #fff;
  border: 1px solid #e6effb;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
}
.pd-sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #edf2fa;
}
.pd-sec-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  font-size: 14px;
  color: #176bff;
  background: #e8f1ff;
  flex: 0 0 auto;
}
.pd-sec-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #1b2a3d;
}
.pd-sec-count {
  margin-left: auto;
  font-size: 12px;
  color: #8a97a8;
}
.pd-sec-body {
  padding: 10px 16px 14px;
  min-height: 0;
}
.pd-sec-body--flush {
  padding: 0 16px;
}
</style>

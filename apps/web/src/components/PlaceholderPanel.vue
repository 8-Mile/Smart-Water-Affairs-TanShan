<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  items?: string[];
}>();
</script>

<template>
  <section class="placeholder-panel">
    <span class="eyebrow">DEMO · 占位页</span>
    <h2>{{ title }}</h2>
    <p class="desc">{{ description }}</p>
    <ul v-if="items?.length" class="items">
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>
    <p class="note">
      本页将在后续任务实现。当前仅保证路由可访问、页面标题与权限守卫正确，数据均来自本地 Mock。
    </p>
    <slot />
  </section>
</template>

<style scoped>
.placeholder-panel {
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 28px;
  min-height: 240px;
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
  backdrop-filter: blur(6px);
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  color: #8ba0b2;
}
h2 {
  margin: 10px 0 12px;
  font-size: 20px;
  color: #1c3e57;
}
.desc {
  margin: 0;
  font-size: 13px;
  color: #5d7387;
  line-height: 1.8;
  max-width: 760px;
}
.items {
  margin: 16px 0 0;
  padding-left: 20px;
  color: #6a8298;
  font-size: 12px;
  line-height: 2;
}
.note {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed #dbe8f1;
  font-size: 12px;
  color: #8ba0b2;
  line-height: 1.8;
}
</style>

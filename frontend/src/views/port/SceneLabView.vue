<script setup lang="ts">
/**
 * 三维场景隔离验证页（/port/scene-lab）
 * 用途：在不引入唐港首页布局的前提下，原样承载 5188 迁移场景，用于与源页面逐项对比。
 */
import L1WaterScene from '@/modules/tanggang/scene/L1WaterScene.vue'
</script>

<template>
  <div class="scene-lab">
    <div class="scene-lab-bar">
      <strong>唐港三维场景 · 隔离验证</strong>
      <span>CAD 源图元 / GLB / 管网 / 标签 / 六系统聚焦 · 与 5188 源页对比用</span>
      <router-link to="/port/overview">进入唐港首页</router-link>
    </div>
    <div class="tanggang-scene scene-lab-canvas">
      <L1WaterScene image="" show-markers />
    </div>
  </div>
</template>

<style scoped>
.scene-lab {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #e9f1f8;
}
.scene-lab-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 44px;
  padding: 0 16px;
  background: #ffffff;
  border-bottom: 1px solid #dbe7f1;
  font-size: 12px;
  color: #5b7a90;
}
.scene-lab-bar strong {
  color: #1f5170;
  font-size: 13px;
}
.scene-lab-bar a {
  margin-left: auto;
  color: #1677ff;
}
.scene-lab-canvas {
  flex: 1;
  min-height: 0;
}
</style>

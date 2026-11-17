<script setup lang="ts">
import { RouterLink } from "vue-router";
import PlaceholderPanel from "../components/PlaceholderPanel.vue";
</script>

<template>
  <PlaceholderPanel
    title="页面不存在"
    description="当前地址未匹配到任何演示路由，可能是链接已失效或输入有误。"
    :items="[
      '请从左侧导航选择页面',
      '或返回综合总览重新开始演示',
    ]"
  >
    <RouterLink class="back-link" to="/overview">返回综合总览 →</RouterLink>
  </PlaceholderPanel>
</template>

<style scoped>
.back-link {
  display: inline-block;
  margin-top: 16px;
  font-size: 13px;
  color: #247ba8;
}
</style>

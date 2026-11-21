<!-- 404 页面不存在：访问了未定义的路由地址 -->
<template>
  <ExceptionShell
    :img-url="imgUrl"
    title="您访问的页面不存在"
    desc="页面地址可能已变更或输入有误，请检查链接是否正确。"
    :show-refresh="false"
  />
</template>

<script setup lang="ts">
import ExceptionShell from '@/views/exception/components/ExceptionShell.vue'
import imgUrl from '@/assets/img/exception/404.webp'
defineOptions({ name: 'Exception404' })
</script>

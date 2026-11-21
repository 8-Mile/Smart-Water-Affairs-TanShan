<!-- 500 服务异常页面：后端服务错误（HTTP 5xx）或页面运行时异常 -->
<template>
  <ExceptionShell
    :img-url="imgUrl"
    title="服务暂时不可用"
    desc="服务器开小差了，请稍后重试；若持续出现请联系管理员处理。"
    :show-home="false"
    refresh-probe
  />
</template>

<script setup lang="ts">
  import ExceptionShell from '@/views/exception/components/ExceptionShell.vue'
  import imgUrl from '@/assets/img/exception/500.webp'
  defineOptions({ name: 'Exception500' })
</script>

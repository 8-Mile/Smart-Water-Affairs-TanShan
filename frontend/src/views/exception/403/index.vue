<!-- 403 无权限页面：用户已登录但无权访问（路由权限校验不通过 / 后端返回 403） -->
<template>
  <ExceptionShell
    :img-url="imgUrl"
    title="暂无访问权限"
    desc="您还没有访问该页面的权限，请联系管理员开通后再试。"
    :show-refresh="false"
  />
</template>

<script setup lang="ts">
  import ExceptionShell from '@/views/exception/components/ExceptionShell.vue'
  import imgUrl from '@/assets/img/exception/403.webp'
  defineOptions({ name: 'Exception403' })
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view />
    <ScenarioConsole v-if="user.isLoggedIn && !route.meta.public" />
  </el-config-provider>
</template>

<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import {watch} from 'vue'
import {useRoute} from 'vue-router'
import {useUserStore} from '@/stores/user'
import ScenarioConsole from '@/modules/tanggang/simulation/ScenarioConsole.vue'
import {useScenarioStore} from '@/modules/tanggang/simulation/store'
const user=useUserStore()
const route=useRoute()
const scenario=useScenarioStore()
// 一位用户退出登录，立即撤销本次内存情景；新用户登录后不可看到前一人的SIM状态。
watch(()=>user.isLoggedIn,(logged)=>{if(!logged&&scenario.running)scenario.stop()})

</script>

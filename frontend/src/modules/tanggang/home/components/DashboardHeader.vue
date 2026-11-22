<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElDropdown,ElDropdownItem,ElDropdownMenu} from 'element-plus'
import {House,Monitor,DataAnalysis,Warning,Tools,TrendCharts,Setting,Bell,ArrowDown} from '@element-plus/icons-vue'
import {useAppMenus} from '@/composables/useAppMenus'
import {useAppChrome} from '@/composables/useAppChrome'
import {usePermissions} from '@/utils/permissions'
import {fetchUnreadCount} from '@/api/notification'
import logoImg from '@/assets/img/DALOGO.webp'
import {tanggangGroupForPath} from '../../business/menu'
import ProjectDataStage from '../../business/ProjectDataStage.vue'

/** 首页使用与运管平台相同的用户身份和菜单权限，替换旧5188的演示身份、天气和空消息面板。 */
const router=useRouter()
const route=useRoute()
const {user,onLogout}=useAppChrome()
const {hasPerm}=usePermissions()
const {tanggangVisibleItems:visibleMenus}=useAppMenus()
const activeMenu=computed(()=>tanggangGroupForPath(route.path))
const menuIcons={overview:House,monitor:Monitor,water:DataAnalysis,operations:Warning,assets:Tools,analysis:TrendCharts,system:Setting}
const avatarText=computed(()=>(user.displayName||user.profile?.username||'U').slice(0,1))
const userName=computed(()=>user.displayName||user.profile?.username||'当前用户')
function navigateTo(path:string){if(path&&route.path!==path)void router.push(path)}
function onUserCommand(command:string){
  if(command==='logout'){onLogout();return}
  if(command==='profile')navigateTo('/system/profile')
}
const now=ref(new Date())
let clockTimer:number|undefined
let noticeTimer:number|undefined
const unreadCount=ref(0)
const displayClock=computed(()=>new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
}).format(now.value))
const displayDate=computed(()=>new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',weekday:'short'
}).format(now.value))
async function refreshUnread(){
  if(!hasPerm('alarm:realtime')){unreadCount.value=0;return}
  try{const {data}=await fetchUnreadCount();unreadCount.value=Math.max(0,Number(data?.data?.unread??0))}
  catch{unreadCount.value=0}
}
onMounted(()=>{
  clockTimer=window.setInterval(()=>{now.value=new Date()},1000)
  if(hasPerm('alarm:realtime')){
    void refreshUnread()
    noticeTimer=window.setInterval(()=>{void refreshUnread()},60_000)
  }
})
onBeforeUnmount(()=>{
  if(clockTimer!==undefined)window.clearInterval(clockTimer)
  if(noticeTimer!==undefined)window.clearInterval(noticeTimer)
})
</script>

<template>
  <header class="topbar port-header tg-system-header" aria-label="唐港智慧水务系统导航">
    <button class="tg-system-brand" type="button" aria-label="返回唐港三维综合总览" @click="navigateTo('/dashboard')">
      <img :src="logoImg" alt="" class="tg-system-logo" />
      <span>唐港51·52号泊位智慧水务</span>
    </button>

    <nav class="port-nav tg-top-nav" aria-label="业务导航">
      <ElDropdown v-for="item in visibleMenus" :key="item.id" trigger="hover"
        placement="bottom-start" :show-timeout="80" :hide-timeout="130"
        popper-class="tg-top-menu" @command="navigateTo">
        <button class="tg-top-trigger" type="button"
          :class="{'is-active':activeMenu===item.id}"
          :aria-current="activeMenu===item.id?'page':undefined"
          @click="navigateTo(item.children?.[0]?.path||item.path)">
          <component :is="menuIcons[item.id as keyof typeof menuIcons]" class="tg-top-icon"/>
          <span>{{item.title}}</span>
        </button>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-for="child in item.children||[{id:item.id,title:item.title,path:item.path}]"
              :key="child.id" :command="child.path" :disabled="child.path===route.path">
              {{child.title}}
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </nav>

    <div class="tg-system-tools">
      <ProjectDataStage/>
      <time class="tg-system-clock" aria-label="北京时间">
        <strong>{{displayClock}}</strong>
        <small>{{displayDate}}</small>
      </time>
      <button v-if="hasPerm('alarm:realtime')" type="button" class="tg-system-alert"
        aria-label="打开告警中心" title="告警中心" @click="navigateTo('/alarm/realtime')">
        <Bell />
        <span v-if="unreadCount>0" class="tg-system-count">{{unreadCount>99?'99+':unreadCount}}</span>
      </button>
      <ElDropdown trigger="click" placement="bottom-end" popper-class="tg-system-user-dropdown" @command="onUserCommand">
        <button type="button" class="tg-system-user" :aria-label="'用户：'+userName">
          <span class="tg-system-avatar">{{avatarText}}</span>
          <span class="tg-system-username">{{userName}}</span>
          <ArrowDown class="tg-user-chevron"/>
        </button>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem command="logout">退出登录</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </div>
  </header>
</template>

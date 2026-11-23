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
import PortIcon from './PortIcon.vue'
import {fetchPortWeather,weatherAccessMode} from '../data/portWeather'
import type {PortWeather} from '../data/portWeather'

/** 首页使用与运管平台相同的用户身份和菜单权限；顶部保留天气、时间与消息通知。 */
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
// 顶部天气：仅作港区近似坐标预览，不表示 51/52 泊位现场气象站实测。
const weather=ref<PortWeather|null>(null)
const weatherError=ref('')
const weatherOpen=ref(false)
const weatherLoading=ref(false)
const weatherModeLabel=weatherAccessMode==='configured'?'已授权气象接口':'开发预览数据'
let weatherTimer:number|undefined
let weatherAbort:AbortController|undefined
async function loadWeather(){
  weatherAbort?.abort()
  weatherAbort=new AbortController()
  weatherLoading.value=true
  try{
    weather.value=await fetchPortWeather(weatherAbort.signal)
    weatherError.value=''
  }catch(err){
    if((err as Error).name!=='AbortError')weatherError.value=(err as Error).message||'气象服务暂不可用'
  }finally{weatherLoading.value=false}
}
const weatherObserved=computed(()=>{
  const raw=weather.value?.observedAt||''
  return raw.length>=16?raw.slice(11,16):'--:--'
})
onMounted(()=>{
  clockTimer=window.setInterval(()=>{now.value=new Date()},1000)
  if(hasPerm('alarm:realtime')){
    void refreshUnread()
    noticeTimer=window.setInterval(()=>{void refreshUnread()},60_000)
  }
  void loadWeather()
  weatherTimer=window.setInterval(()=>{void loadWeather()},600_000)
})
onBeforeUnmount(()=>{
  if(clockTimer!==undefined)window.clearInterval(clockTimer)
  if(noticeTimer!==undefined)window.clearInterval(noticeTimer)
  if(weatherTimer!==undefined)window.clearInterval(weatherTimer)
  weatherAbort?.abort()
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
      <div class="tg-system-weather" :class="{open:weatherOpen}">
        <button type="button" class="tg-weather-trigger" :aria-expanded="weatherOpen"
          :title="weather?`${weather.description} ${Math.round(weather.temperature)}°C`:'港区天气'"
          @click="weatherOpen=!weatherOpen">
          <PortIcon v-if="weather" :name="weather.icon" :size="20"/>
          <span class="tg-weather-main">
            <template v-if="weather">{{weather.description}} <b>{{Math.round(weather.temperature)}}°</b></template>
            <template v-else>{{weatherLoading?'天气获取中':'天气'}}</template>
          </span>
        </button>
        <div v-if="weatherOpen" class="tg-weather-pop" role="dialog" aria-label="港区天气详情">
          <div class="tg-weather-pop-head">
            <PortIcon v-if="weather" :name="weather.icon" :size="26"/>
            <div>
              <strong>{{weather?weather.description:'天气暂不可用'}}</strong>
              <span v-if="weather">{{weatherObserved}} 观测</span>
              <span v-else>{{weatherError||'等待气象数据'}}</span>
            </div>
            <b v-if="weather">{{Math.round(weather.temperature)}}°C</b>
          </div>
          <dl v-if="weather" class="tg-weather-rows">
            <div><dt>相对湿度</dt><dd>{{weather.humidity}}%</dd></div>
            <div><dt>风速</dt><dd>{{weather.windSpeed}} km/h</dd></div>
            <div><dt>昼夜</dt><dd>{{weather.isDay?'白天':'夜间'}}</dd></div>
            <div><dt>数据来源</dt><dd>{{weatherModeLabel}}</dd></div>
          </dl>
          <p class="tg-weather-note">近似港区坐标 39.21°N / 119.02°E，非 51/52 泊位气象站实测。</p>
        </div>
      </div>
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

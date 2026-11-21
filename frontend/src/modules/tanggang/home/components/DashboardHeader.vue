<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElDropdown,ElDropdownMenu,ElDropdownItem} from 'element-plus'
import { House, Monitor, DataAnalysis, Warning, Tools, TrendCharts, Setting } from '@element-plus/icons-vue'
import { usePermissions } from '@/utils/permissions'
import { tanggangGroupForPath,tanggangMenus } from '../../business/menu'

import PortIcon from './PortIcon.vue'
import type { PortIconName } from './PortIcon.vue'
import { fetchPortWeather, weatherAccessMode, type PortWeather } from '../data/portWeather'

const router=useRouter()
const route=useRoute()
const {hasPerm}=usePermissions()
const activeMenu=computed(()=>tanggangGroupForPath(route.path))
const menuIcons={overview:House,monitor:Monitor,water:DataAnalysis,operations:Warning,assets:Tools,analysis:TrendCharts,system:Setting}
const visibleMenus=computed(()=>tanggangMenus.map(menu=>({
  ...menu,children:menu.children?.filter(child=>!child.permission||hasPerm(child.permission)),
})).filter(menu=>menu.id!=='system'||Boolean(menu.children?.length)))
function navigateTo(path:string){ if(route.path!==path)void router.push(path) }

type RoleId = 'manager' | 'operator' | 'engineer'
type HeaderPopup = 'role' | 'message' | 'weather' | null
const roles: {id:RoleId;name:string;description:string;icon:PortIconName}[]=[
  {id:'manager',name:'领导视角',description:'总览、指标与决策视角预览',icon:'manager'},
  {id:'operator',name:'运行值守',description:'设备运行与处置视角预览',icon:'operator'},
  {id:'engineer',name:'工程师',description:'CAD及配置核查视角预览',icon:'engineer'},
]
const selectedRole=ref<RoleId>('manager')
const activeRole=computed(()=>roles.find(role=>role.id===selectedRole.value)??roles[0]!)
const popup=ref<HeaderPopup>(null)
const now=ref(new Date())
const weather=ref<PortWeather|null>(null)
const weatherLoading=ref(false)
const weatherError=ref('')
const weatherLastRefresh=ref('')
let clockTimer:number|undefined
let weatherTimer:number|undefined
let weatherRequest:AbortController|null=null
let weatherTimeout:number|undefined
let alive=true

const dayFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',
  month:'2-digit',day:'2-digit',weekday:'short'})
const clockFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',
  minute:'2-digit',second:'2-digit',hourCycle:'h23'})
const portDate=computed(()=>dayFormatter.format(now.value))
const portClock=computed(()=>clockFormatter.format(now.value))
const temperatureText=computed(()=>
  weather.value?Math.round(weather.value.temperature)+'°C':
  weatherLoading.value?'获取中':'--°C')
const weatherIcon=computed<PortIconName>(()=>weather.value?.icon || 'cloudy')
const isPreviewWeather=weatherAccessMode==='development-preview'

function togglePopup(next:Exclude<HeaderPopup,null>){
  popup.value=popup.value===next?null:next
}
function selectRole(id:RoleId){
  selectedRole.value=id
  popup.value=null
  try{sessionStorage.setItem('tanggang.header.preview-role',id)}catch{}
}
function closeOnOutside(event:PointerEvent){
  if(!popup.value)return
  const item=document.querySelector('[data-port-popup="'+popup.value+'"]')
  if(item&&!item.contains(event.target as Node))popup.value=null
}
function closeOnEscape(event:KeyboardEvent){if(event.key==='Escape')popup.value=null}

async function refreshWeather(){
  weatherRequest?.abort()
  if(weatherTimeout!==undefined)window.clearTimeout(weatherTimeout)
  const req=new AbortController()
  weatherRequest=req
  weatherLoading.value=true
  weatherError.value=''
  weatherTimeout=window.setTimeout(()=>req.abort(),8500)
  try{
    const data=await fetchPortWeather(req.signal)
    if(!alive||weatherRequest!==req)return
    weather.value=data
    weatherLastRefresh.value=portClock.value
  }catch(error){
    if(!alive||weatherRequest!==req)return
    weather.value=null
    weatherError.value=error instanceof Error&&error.name==='AbortError'
      ?'天气请求超时，可点击重试'
      :error instanceof Error?error.message:'天气接口暂不可用'
  }finally{
    if(weatherTimeout!==undefined)window.clearTimeout(weatherTimeout)
    if(weatherRequest===req)weatherLoading.value=false
  }
}

onMounted(()=>{
  try{
    const remembered=sessionStorage.getItem('tanggang.header.preview-role')
    if(roles.some(r=>r.id===remembered))selectedRole.value=remembered as RoleId
  }catch{}
  now.value=new Date()
  clockTimer=window.setInterval(()=>{now.value=new Date()},1000)
  void refreshWeather()
  weatherTimer=window.setInterval(()=>{void refreshWeather()},15*60*1000)
  document.addEventListener('pointerdown',closeOnOutside)
  document.addEventListener('keydown',closeOnEscape)
})
onBeforeUnmount(()=>{
  alive=false
  if(clockTimer!==undefined)window.clearInterval(clockTimer)
  if(weatherTimer!==undefined)window.clearInterval(weatherTimer)
  if(weatherTimeout!==undefined)window.clearTimeout(weatherTimeout)
  weatherRequest?.abort()
  document.removeEventListener('pointerdown',closeOnOutside)
  document.removeEventListener('keydown',closeOnEscape)
})
</script>

<template>
  <header class="topbar port-header" aria-label="唐港智慧水务系统导航">
    <a class="port-brand" href="#overview" aria-label="唐港51.52号泊位智慧水务 · 综合总览">
      <span class="port-brand-symbol"><PortIcon name="water" size="1.7em" /></span>
      <span class="port-brand-name">唐港51.52号泊位智慧水务</span>
    </a>

    <nav class="port-nav tg-top-nav" aria-label="唐港智慧水务七大业务模块">
      <ElDropdown v-for="item in visibleMenus" :key="item.id" trigger="hover" placement="bottom-start"
        :show-timeout="80" :hide-timeout="130" popper-class="tg-top-menu" @command="navigateTo">
        <button class="tg-top-trigger" type="button"
          :class="{ 'is-active': activeMenu===item.id }"
          :aria-current="activeMenu===item.id ? 'page' : undefined"
          @click="navigateTo(item.path)">
          <component :is="menuIcons[item.id as keyof typeof menuIcons]" class="tg-top-icon" />
          <span>{{item.title}}</span>
        </button>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-for="child in item.children || [{id:item.id,title:item.title,path:item.path}]" :key="child.id"
              :command="child.path" :disabled="child.path===route.path">
              {{child.title}}
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </nav>

    <div class="port-right">
      <div class="port-status" aria-label="港区时间与天气">
        <div class="port-control-group port-weather-group" data-port-popup="weather">
          <button class="port-weather-trigger" type="button" aria-haspopup="dialog"
            :aria-expanded="popup==='weather'" aria-controls="port-weather-dialog"
            title="查看京唐港区周边天气详情" @click="togglePopup('weather')">
            <PortIcon class="port-weather-symbol" :name="weatherIcon" />
            <span class="port-weather-text">
              <strong>{{ temperatureText }}</strong>
              <small>京唐港 · {{ weather?.description || (weatherLoading?'加载中':'天气不可用') }}</small>
            </span>
          </button>
          <section v-if="popup==='weather'" id="port-weather-dialog" class="port-popup port-weather-popup"
            role="dialog" aria-label="当前天气详情">
            <div class="port-popup-header">
              <strong><PortIcon name="map-pin" /> 京唐港区周边天气</strong>
              <button type="button" class="port-popup-close" aria-label="关闭天气" @click="popup=null">
                <PortIcon name="close" /></button>
            </div>
            <div v-if="weather" class="port-weather-reading">
              <PortIcon :name="weather.icon" class="port-weather-reading-icon" />
              <div class="port-weather-current"><b>{{ Math.round(weather.temperature) }}°C</b>
                <span>{{ weather.description }}</span></div>
            </div>
            <div v-else class="port-weather-unavailable"><PortIcon name="cloudy" />
              <span>{{ weatherError || '正在获取港区周边气象模型数据…' }}</span>
            </div>
            <div v-if="weather" class="port-weather-metrics">
              <span><PortIcon name="humidity" /> 相对湿度 {{ weather.humidity }}%</span>
              <span><PortIcon name="windy" /> 风速 {{ weather.windSpeed.toFixed(1) }} km/h</span>
              <span><PortIcon name="clock" /> 模型时次 {{ weather.observedAt.slice(11,16) }}</span>
            </div>
            <div class="port-weather-footer">
              <small>{{ isPreviewWeather ? '本地开发预览 · Open-Meteo 模型数据' :
                weatherAccessMode==='not-configured'?'正式环境待配置授权天气接口':'授权气象接口' }}</small>
              <button type="button" :disabled="weatherLoading" @click="refreshWeather">
                <PortIcon name="refresh" :class="{spinning:weatherLoading}" /> 刷新</button>
            </div>
            <p class="port-popup-note">位置为京唐港区近似坐标，不是51/52泊位气象站实测。正式商用需使用获授权的数据服务。</p>
          </section>
        </div>

        <div class="port-time" aria-label="北京时间">
          <PortIcon name="clock" class="port-time-icon" />
          <span class="port-time-values"><strong>{{ portClock }}</strong>
            <small>北京时间 · {{ portDate }}</small></span>
        </div>
      </div>

      <div class="port-actions">
        <div class="port-control-group" data-port-popup="message">
          <button class="port-icon-action port-bell" type="button" aria-label="打开消息中心"
            aria-haspopup="dialog" :aria-expanded="popup==='message'" aria-controls="port-message-dialog"
            title="消息中心" @click="togglePopup('message')">
            <PortIcon name="bell" size="1.35em" />
          </button>
          <section v-if="popup==='message'" id="port-message-dialog" class="port-popup port-message-popup"
            role="dialog" aria-label="消息中心">
            <div class="port-popup-header"><strong>消息中心</strong>
              <button class="port-popup-close" type="button" aria-label="关闭消息"
                @click="popup=null"><PortIcon name="close" /></button></div>
            <div class="port-message-empty">
              <span class="port-empty-icon"><PortIcon name="inbox" /></span>
              <strong>暂无已接入的系统消息</strong>
              <p>待告警、工单、运行提醒接入后，可在此查看真实消息。</p>
            </div>
            <div class="port-message-foot"><PortIcon name="info" /> 当前未接入实时消息服务，不显示虚构未读数量</div>
          </section>
        </div>

        <div class="port-control-group port-role-group" data-port-popup="role">
          <button class="port-role-trigger" type="button" aria-haspopup="dialog"
            :aria-expanded="popup==='role'" aria-controls="port-role-dialog"
            title="切换演示角色视角" @click="togglePopup('role')">
            <span class="port-avatar"><PortIcon :name="activeRole.icon" /></span>
            <span class="port-role-name"><strong>{{activeRole.name}}</strong><small>角色预览</small></span>
            <PortIcon class="port-role-chevron" name="down" />
          </button>
          <section v-if="popup==='role'" id="port-role-dialog" class="port-popup port-role-popup"
            role="dialog" aria-label="角色视角预览">
            <div class="port-popup-header"><strong>切换角色视角</strong>
              <button class="port-popup-close" type="button" aria-label="关闭角色菜单"
                @click="popup=null"><PortIcon name="close" /></button></div>
            <button v-for="item in roles" :key="item.id" type="button" class="port-role-option"
              :class="{selected:selectedRole===item.id}" @click="selectRole(item.id)">
              <span class="port-role-option-icon"><PortIcon :name="item.icon" size="1.25em" /></span>
              <span><strong>{{item.name}}</strong><small>{{item.description}}</small></span>
              <PortIcon v-if="selectedRole===item.id" class="port-role-check" name="check" />
            </button>
            <p class="port-popup-note">当前仅切换演示身份标签，不代表登录认证或数据访问权限已经实现。</p>
          </section>
        </div>
      </div>
    </div>
  </header>
</template>


<style>
/* 首页顶部导航与Three.js场景解耦：此文件归业务/UI开发，首页引擎不得覆写。 */
.tanggang-home .screen-stage>.topbar.port-header nav.port-nav.tg-top-nav{
  flex:1 1 auto!important;min-width:0!important;max-width:none;gap:1px!important;
  margin-left:clamp(3px,.6vw,17px)!important;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:none;align-items:stretch;justify-content:flex-start;
}
.tanggang-home .screen-stage>.topbar.port-header nav.port-nav.tg-top-nav::-webkit-scrollbar{display:none}
.tanggang-home .port-header .tg-top-nav .el-dropdown{display:flex;align-items:stretch;flex:0 0 auto;outline:none}
.tanggang-home .port-header .tg-top-nav .tg-top-trigger{
  display:flex;align-items:center;justify-content:center;gap:5px;
  border:0;outline-offset:-3px;white-space:nowrap;
  padding:0 clamp(7px,.47vw,17px);font:650 clamp(12px,.66vw,16px)/1.2 inherit;
  font-size:clamp(12px,.66vw,16px);font-family:inherit;
  background:transparent;color:#347b96;cursor:pointer;position:relative;
  transition:color .18s,background .18s;
}
.tanggang-home .port-header .tg-top-nav .tg-top-trigger:hover,
.tanggang-home .port-header .tg-top-nav .tg-top-trigger.is-active{
  color:#086b90;background:rgba(199,232,243,.38);
}
.tanggang-home .port-header .tg-top-nav .tg-top-trigger.is-active:after{
  position:absolute;content:'';bottom:0;left:10%;right:10%;height:3px;
  background:linear-gradient(90deg,#80d5e3,#1981a9);border-radius:4px;
}
.tanggang-home .port-header .tg-top-nav .tg-top-icon{width:16px;height:16px;flex:none}
.tanggang-home .port-header .port-right{flex:0 0 auto;margin-left:0}
.tg-top-menu.el-popper{border-color:#d6e9f2;box-shadow:0 10px 30px #173c5329}
.tg-top-menu .el-dropdown-menu__item{font-size:13px;min-width:158px}
@media(max-width:1650px){
  .tanggang-home .port-header .tg-top-nav .tg-top-icon{display:none}
  .tanggang-home .port-header .tg-top-nav .tg-top-trigger{font-size:12px;padding:0 7px}
}
@media(max-width:1160px){
  .tanggang-home .screen-stage>.topbar.port-header nav.port-nav.tg-top-nav{margin-left:2px!important}
  .tanggang-home .port-header .tg-top-nav .tg-top-trigger{padding:0 7px}
}
@media(max-width:650px){
  .tanggang-home .screen-stage>.topbar.port-header nav.port-nav.tg-top-nav{
    grid-area:nav;min-width:0!important;max-width:100%;margin-left:0!important;
    border-top:1px solid #e0edf3;overflow-x:auto;overflow-y:hidden;
  }
  .tanggang-home .port-header .tg-top-nav .tg-top-trigger{font-size:12px;padding:0 9px}
}
</style>

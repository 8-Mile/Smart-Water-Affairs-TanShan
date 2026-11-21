<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElButton} from 'element-plus'
import {loadTanggangCatalog,summarizeSystem,type TanggangCatalog} from '../mapping/tanggangCatalog'
import './business.css'
import {useScenarioStore} from '../simulation/store'
const sim=useScenarioStore()
const simMessage=computed(()=>{
  const r=sim.result
  if(!r)return ''
  if(sysId.value==='middle')return '假设用水 '+r.demandedM3h+' m³/h；可分配 '+r.deliveredM3h+' m³/h；缺口 '+r.shortageM3h+' m³/h。'
  if(sysId.value==='pool')return '按统一情景预计 '+r.input.horizonHours+'小时后模拟储量 '+r.forecastPoolM3+' m³。'
  if(sysId.value==='rain')return '假设降雨 '+r.input.rainMm+'mm，单池演示条件溢流 '+r.rainOverflowM3+'m³。'
  return '本情景没有已确认的本系统空间管线关联，请在专业页核对工程资料。'
})

const route=useRoute(),router=useRouter()
const catalog=ref<TanggangCatalog|null>(null)
const error=ref('')
onMounted(async()=>{try{catalog.value=await loadTanggangCatalog()}catch(e){error.value=e instanceof Error?e.message:String(e)}})
const sysId=computed(()=>String(route.params.systemId||''))
const system=computed(()=>catalog.value?.systemMap.get(sysId.value))
const facilities=computed(()=>system.value?.areaEquipment.flatMap(e=>e.equipmentIds.map(id=>({device:catalog.value?.deviceMap.get(id),region:e.regionId}))).filter(r=>r.device)??[])
const unique=computed(()=>Array.from(new Map(facilities.value.map(o=>[o.device!.id,o.device!])).values()))
</script>
<template>
  <main class="tg-biz page-fill">
    <div class="tg-biz-head">
      <div><h1>{{system?.name || '专业工艺监测'}}</h1><p class="tg-biz-sub">工程设施清单 · 设计参数 · 数据采集准备 · 跨系统关联</p></div>
      <div class="tg-biz-actions"><ElButton type="primary" plain @click="router.push('/dashboard')">返回三维首页</ElButton></div>
    </div>
    <div v-if="error" class="tg-biz-empty">{{error}}</div>
    <div v-else-if="!catalog" class="tg-biz-empty">正在读取工程数据…</div>
    <div v-else-if="!system" class="tg-biz-empty">没有找到该专业系统，请返回专业系统总览选择。</div>
    <template v-else>
      <div class="tg-biz-note"><strong>工艺边界：</strong>{{system.intro}} <span v-if="system.disclaimer">{{system.disclaimer}}</span> 本页为工程资料与数据准备视图，不是已连接PLC的实时SCADA。实际控制操作须完成授权、联锁及厂家确认。</div>
      <section v-if="sim.running" class="tg-biz-note" style="border-color:#f1d7ac;background:rgba(255,245,222,.75)">
        <strong>SIM · 全系统统一推演：</strong>{{sim.activeScenario?.title}}。
        {{simMessage}}
        <el-button v-if="sysId==='middle'||sysId==='pool'" link type="primary" @click="router.push('/port/water/supply')">查看供水保障</el-button>
        <el-button v-if="sysId==='rain'" link type="primary" @click="router.push('/port/water/rain-risk')">查看雨水风险</el-button>
        <el-button link type="warning" @click="sim.openConsole()">打开统一推演控制台</el-button>
        <span class="tg-biz-label">模拟视图，不改变真实测点与业务事件</span>
      </section>
      <div class="tg-biz-grid">
        <section class="tg-biz-card art-card"><h2>设计关联设备项</h2><p class="tg-biz-kpi">{{summarizeSystem(system,catalog).designCategories}}</p><p>依据设计设备清单归类，不等于实际安装台数。</p></section>
        <section class="tg-biz-card art-card"><h2>数据接入状态</h2><p class="tg-biz-kpi">待映射</p><p>资产ID、SCADA测点ID与现场点表尚未完成一一核对。</p></section>
        <section class="tg-biz-card art-card"><h2>系统关联区域</h2><p class="tg-biz-kpi">{{system.areaEquipment.length}}</p><p>由CAD系统清单定义，非实际控制站数量。</p></section>
      </div>
      <div class="tg-biz-grid two">
        <section class="tg-biz-card art-card">
          <h2>设计设施与数据采集项</h2>
          <div v-if="!unique.length" class="tg-biz-empty">该专业系统尚未映射设计设备</div>
          <div v-for="device in unique" :key="device.id" class="tg-biz-list-row">
            <div style="min-width:0"><strong>{{device.name}}</strong><p>{{device.regionName}} · {{device.id}}</p><p v-if="device.dataFields?.length">建议采集：{{device.dataFields.join('、')}}</p></div>
            <span class="tg-biz-chip" :class="{warn:device.currentStatus==='未接入'}">{{device.currentStatus||'需核验'}}</span>
          </div>
        </section>
        <section class="tg-biz-card art-card">
          <h2>数据与业务关联要求</h2>
          <div class="tg-biz-list">
            <div class="tg-biz-list-row"><span>工程来源</span><span class="tg-biz-chip">CAD / 第四分册</span></div>
            <div class="tg-biz-list-row"><span>运行参数</span><span class="tg-biz-chip warn">待厂家测点表</span></div>
            <div class="tg-biz-list-row"><span>设备台账关联</span><span class="tg-biz-chip warn">待统一资产ID</span></div>
            <div class="tg-biz-list-row"><span>告警规则与阈值</span><span class="tg-biz-chip warn">待业主确认</span></div>
            <div class="tg-biz-list-row"><span>场景关联</span><span class="tg-biz-chip">沿用5188关联图层</span></div>
          </div>
          <p style="margin-top:17px">本页和首页共用同一系统ID：<strong>{{system.id}}</strong>。一个设施可属于多个系统，但在设备台账中只能有一条主记录。</p>
          <div class="tg-biz-actions" style="margin-top:15px">
            <ElButton @click="router.push('/alarm/realtime')">运行处置</ElButton>
            <ElButton @click="router.push('/water/stats')">水资源关联</ElButton>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>

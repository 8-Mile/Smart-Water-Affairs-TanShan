<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {useScenarioStore} from '../simulation/store'
import {
  fetchPublishedBoards,type BoardTarget,type BoardWidget,type MetricId,
  type TanggangBoard,
} from '@/api/tanggangBoards'

const props=defineProps<{target:BoardTarget;preview?:TanggangBoard|null}>()
const route=useRoute()
const store=useScenarioStore()
const items=ref<TanggangBoard[]>([])
const failed=ref(false)
let seq=0
async function load(){
  if(props.preview)return
  const n=++seq
  failed.value=false
  try{
    const {data}=await fetchPublishedBoards(props.target)
    if(n!==seq)return
    items.value=data.data
  }catch{
    if(n===seq){items.value=[];failed.value=true}
  }
}
watch(()=>[props.target,route.fullPath],()=>{void load()},{immediate:true})
const boards=computed(()=>props.preview?[props.preview]:items.value)
const impact=computed(()=>store.impactAnalysis)
const metrics:Record<MetricId,{label:string;unit:string}>={
  'supply-demand':{label:'演示用水需求',unit:'m³/h'},
  'supply-capacity':{label:'假设可分配能力',unit:'m³/h'},
  'supply-shortage':{label:'模拟供水缺口',unit:'m³/h'},
  'pool-forecast':{label:'假设期末储量',unit:'m³'},
  'monitor-risk':{label:'监护状态',unit:''},
  'monitor-rule-count':{label:'模拟规则命中',unit:'项'},
  'supply-coverage':{label:'需求覆盖率',unit:'%'},
}
function metricValue(id:MetricId):string {
  if(!store.running||!store.result)return '—'
  const result=store.result,monitor=store.monitorEvidence
  const values:Record<MetricId,number|string>={
    'supply-demand':result.demandedM3h,
    'supply-capacity':result.usableCapacityM3h,
    'supply-shortage':result.shortageM3h,
    'pool-forecast':result.forecastPoolM3,
    'monitor-risk':monitor?({normal:'未触发',attention:'模拟关注',critical:'模拟异常',insufficient:'依据不足'}[monitor.risk]):'—',
    'monitor-rule-count':monitor?.rules.filter(r=>r.outcome==='TRIGGERED').length||0,
    'supply-coverage':result.coveragePercent,
  }
  return typeof values[id]==='number'?(values[id] as number).toLocaleString('zh-CN',{maximumFractionDigits:1}):String(values[id])
}
function titleFor(w:BoardWidget){
  return w.kind==='metric'?metrics[w.metric!].label:
    w.kind==='terminal-table'?'演示终端分配':
    w.kind==='monitor-rules'?'监护规则命中':'供水方案对比'
}
function rowsFor(w:BoardWidget){
  if(!store.running)return []
  if(w.kind==='terminal-table')return impact.value?.affectedTerminals||[]
  if(w.kind==='monitor-rules')return store.monitorEvidence?.rules||[]
  if(w.kind==='plan-comparison')return store.supplyPlans||[]
  return []
}
</script>

<template>
  <div v-if="boards.length||failed" class="tg-published-boards">
    <section v-for="board in boards" :key="board.id" class="tg-biz-card art-card">
      <div class="tg-biz-card-head">
        <h2>{{board.title}}</h2>
        <span class="tg-biz-label">SIM · v{{board.version}}</span>
      </div>
      <p v-if="!store.running" class="tg-biz-sub">选择情景推演后显示本轮演示数据。</p>
      <div v-else class="tg-board-widgets">
        <template v-for="widget in board.widgets" :key="widget.id">
          <div v-if="widget.kind==='metric'&&widget.metric" class="tg-board-metric">
            <span>{{titleFor(widget)}}</span>
            <strong>{{metricValue(widget.metric)}} <small>{{metrics[widget.metric].unit}}</small></strong>
          </div>
          <div v-else class="tg-board-table">
            <h3>{{titleFor(widget)}}</h3>
            <el-table :data="rowsFor(widget)" size="small" stripe>
              <template v-if="widget.kind==='terminal-table'">
                <el-table-column prop="label" label="演示用水点" min-width="150"/>
                <el-table-column prop="demandM3h" label="需求" min-width="70"/>
                <el-table-column prop="allocatedM3h" label="分配" min-width="70"/>
                <el-table-column prop="shortageM3h" label="缺口" min-width="70"/>
              </template>
              <template v-else-if="widget.kind==='monitor-rules'">
                <el-table-column prop="label" label="演示规则" min-width="140"/>
                <el-table-column prop="threshold" label="判据" min-width="130"/>
                <el-table-column prop="outcome" label="结果" min-width="100"/>
              </template>
              <template v-else>
                <el-table-column prop="title" label="演示方案" min-width="140"/>
                <el-table-column label="缺口" min-width="90">
                  <template #default="{row}">{{row.result.shortageM3h}}</template>
                </el-table-column>
                <el-table-column prop="constraint" label="储量判断" min-width="110"/>
              </template>
              <template #empty>当前情景无符合条件的数据</template>
            </el-table>
          </div>
        </template>
      </div>
    </section>
    <p v-if="failed&&!preview" class="tg-biz-label">已发布看板暂时无法加载。</p>
  </div>
</template>

<style scoped>
.tg-published-boards{display:grid;gap:14px;margin:15px 0;min-width:0}
.tg-board-widgets{display:flex;gap:14px;flex-wrap:wrap;align-items:stretch}
.tg-board-metric{flex:1 1 155px;min-width:135px;padding:7px 0;display:flex;flex-direction:column;gap:9px}
.tg-board-metric>span{font-size:12px;color:var(--art-gray-600,#718999)}
.tg-board-metric strong{font-size:22px;color:var(--art-gray-800,#253f55);font-variant-numeric:tabular-nums;font-weight:700}
.tg-board-metric small{font-size:11px;color:var(--art-gray-500,#8297a6);font-weight:400}
.tg-board-table{flex:1 1 100%;min-width:0}
.tg-board-table h3{font-size:13px!important;font-weight:650;margin:8px 0!important}
.tg-board-table :deep(.el-table){width:100%;background:transparent}
</style>

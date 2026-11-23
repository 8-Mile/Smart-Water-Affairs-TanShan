<script setup lang="ts">
import {computed,reactive,ref} from 'vue'
import {ElMessage} from 'element-plus'
import {useScenarioStore} from '../simulation/store'
import {
  SCENARIOS,SCENARIO_IDS,type ScenarioId,type ScenarioInputs,
} from '../simulation/engine'

type Context='supply'|'pump'|'rain'
const props=withDefaults(defineProps<{context?:Context}>(),{context:'supply'})
const store=useScenarioStore()
const open=ref(false)
const busy=ref(false)
const currentPreset=ref<ScenarioId>('baseline')
const input=reactive<ScenarioInputs>(structuredClone(SCENARIOS.baseline.inputs))
const selectedSection=ref<Context>(props.context)
const model=computed(()=>store.result)
const currentMode=computed(()=>store.autoEnabled?'自动更新':store.running?'人工参数':'未启动')
const format=(v:number)=>v.toLocaleString('zh-CN',{maximumFractionDigits:1})
const canApply=computed(()=>input.terminals.length>0)

function load(id:ScenarioId,fromStore=false){
  currentPreset.value=id
  const source=fromStore&&store.activeInputs?store.activeInputs:SCENARIOS[id].inputs
  const copy=JSON.parse(JSON.stringify(source)) as ScenarioInputs
  Object.assign(input,copy)
  input.terminals=copy.terminals
}
function show(){
  const id=store.activeId||'baseline'
  selectedSection.value=props.context
  load(id,true)
  open.value=true
}
function changePreset(id:ScenarioId){load(id)}
function apply(){
  if(busy.value)return
  busy.value=true
  try{
    store.applyOperatorInputs(JSON.parse(JSON.stringify(input)) as ScenarioInputs,currentPreset.value)
    open.value=false
    ElMessage.success('运行参数已应用，供水、监护、雨水页面同步更新')
  }catch(e){
    ElMessage.error(e instanceof Error?e.message:'参数校验不通过')
  }finally{busy.value=false}
}
function resume(){
  store.resumeAuto()
  load('baseline',true)
  open.value=false
  ElMessage.success('已恢复自动数据更新')
}
function showArea(id:Context){selectedSection.value=id}
</script>

<template>
  <div class="tg-input-launcher">
    <el-button plain size="default" data-testid="operations-input-open"
      @click="show">运行参数</el-button>
    <el-drawer v-model="open" append-to-body direction="rtl"
      size="min(520px, 96vw)" title="运行参数"
      class="tg-input-drawer" data-testid="operations-input-drawer">
      <div class="tg-input-panel">
        <div class="tg-input-toolbar">
          <span class="tg-input-state">
            <i :class="{manual:!store.autoEnabled}"/>{{currentMode}}
          </span>
          <span class="tg-input-source">SIM</span>
          <el-button plain size="small" data-testid="operations-resume-auto"
            @click="resume">恢复自动更新</el-button>
        </div>
        <div class="tg-input-current" v-if="model">
          <div><span>总需求</span><strong>{{format(model.demandedM3h)}}<small>m³/h</small></strong></div>
          <div><span>可分配</span><strong>{{format(model.usableCapacityM3h)}}<small>m³/h</small></strong></div>
          <div><span>缺口</span><strong :class="{warn:model.shortageM3h>0}">{{format(model.shortageM3h)}}<small>m³/h</small></strong></div>
        </div>
        <div class="tg-input-section">
          <div class="tg-input-heading">数据状态</div>
          <div class="tg-input-presets" data-testid="operations-input-presets">
            <button v-for="id in SCENARIO_IDS" :key="id" type="button"
              :class="{selected:currentPreset===id}" :data-preset-id="id"
              @click="changePreset(id)">{{SCENARIOS[id].title}}</button>
          </div>
        </div>
        <div class="tg-input-tabs" role="group" aria-label="参数分类">
          <button :class="{active:selectedSection==='supply'}" @click="showArea('supply')">供水负荷</button>
          <button :class="{active:selectedSection==='pump'}" @click="showArea('pump')">泵组状态</button>
          <button :class="{active:selectedSection==='rain'}" @click="showArea('rain')">降雨调蓄</button>
        </div>
        <div class="tg-input-fields" data-testid="operations-input-fields">
          <template v-if="selectedSection==='supply'">
            <label><span>供水总能力 <small>m³/h</small></span>
              <el-input-number v-model="input.capacityM3h" :min="0" :max="100000"
                :precision="1" controls-position="right" data-testid="input-supply-capacity"/>
            </label>
            <label><span>预留能力 <small>m³/h</small></span>
              <el-input-number v-model="input.reservedM3h" :min="0" :max="100000" :precision="1"
                controls-position="right"/>
            </label>
            <label><span>初始可用储量 <small>m³</small></span>
              <el-input-number v-model="input.poolInitialM3" :min="0" :max="100000000"
                controls-position="right"/>
            </label>
            <label><span>持续补水流量 <small>m³/h</small></span>
              <el-input-number v-model="input.poolInflowM3h" :min="0" :max="100000"
                controls-position="right"/>
            </label>
            <div class="tg-input-heading">用水点需求</div>
            <label v-for="(terminal,index) in input.terminals" :key="terminal.id">
              <span>{{terminal.label}} <small>优先级 {{terminal.priority}}</small></span>
              <el-input-number v-model="input.terminals[index]!.demandM3h"
                :min="0" :max="100000" :precision="1" controls-position="right"
                :data-testid="'input-terminal-'+terminal.id"/>
            </label>
          </template>
          <template v-else-if="selectedSection==='pump'">
            <label><span>中压泵组状态</span>
              <el-select v-model="input.pumpState" data-testid="input-pump-state">
                <el-option label="运行" value="running"/>
                <el-option label="异常" value="fault"/>
              </el-select>
            </label>
            <label><span>出口压力 <small>MPa</small></span>
              <el-input-number v-model="input.pressureMpa" :min="0" :max="30"
                :precision="2" :step=".05" controls-position="right"/>
            </label>
            <label><span>电流 <small>A</small></span>
              <el-input-number v-model="input.currentA" :min="0" :max="100000"
                :precision="1" controls-position="right"/>
            </label>
            <label><span>流量 <small>m³/h</small></span>
              <el-input-number v-model="input.flowM3h" :min="0" :max="100000"
                :precision="1" controls-position="right"/>
            </label>
          </template>
          <template v-else>
            <label><span>累计降雨 <small>mm</small></span>
              <el-input-number v-model="input.rainMm" :min="0" :max="100000"
                :precision="1" controls-position="right" data-testid="input-rainfall"/>
            </label>
            <label><span>降雨历时 <small>小时</small></span>
              <el-input-number v-model="input.rainDurationH" :min=".1" :max="72"
                :step=".5" :precision="1" controls-position="right"/>
            </label>
            <label><span>初始集水储量 <small>m³</small></span>
              <el-input-number v-model="input.rainStorageInitialM3" :min="0"
                :max="100000000" controls-position="right"/>
            </label>
            <label><span>假设集水容量 <small>m³</small></span>
              <el-input-number v-model="input.rainStorageCapacityM3" :min="0"
                :max="100000000" controls-position="right"/>
            </label>
            <label><span>排水能力 <small>m³/h</small></span>
              <el-input-number v-model="input.rainDrainM3h" :min="0" :max="100000"
                controls-position="right"/>
            </label>
            <label><span>汇水面积 <small>m²</small></span>
              <el-input-number v-model="input.rainCatchmentM2" :min="0" :max="100000000"
                controls-position="right"/>
            </label>
            <label><span>径流系数</span>
              <el-input-number v-model="input.runoffCoefficient" :min="0" :max="1"
                :step=".05" :precision="2" controls-position="right"/>
            </label>
          </template>
        </div>
        <div class="tg-input-actions">
          <span>修改仅影响当前浏览器的模型数据</span>
          <el-button type="primary" :loading="busy" :disabled="!canApply"
            data-testid="operations-apply-inputs" @click="apply">应用参数</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.tg-input-launcher{display:inline-flex}
.tg-input-panel{display:flex;flex-direction:column;gap:17px;padding:18px;
  min-height:100%;background:var(--default-box-color,#fff);color:#355a72}
.tg-input-toolbar{display:flex;align-items:center;gap:8px}
.tg-input-toolbar .el-button{margin-left:auto}
.tg-input-state{display:flex;align-items:center;gap:6px;font-size:12px;color:#4b8098}
.tg-input-state i{width:7px;height:7px;border-radius:50%;background:#5ca48a}
.tg-input-state i.manual{background:#d8a56c}
.tg-input-source{font-size:10px;color:#b18446;border:1px solid #e8c996;
  padding:3px 6px;border-radius:5px}
.tg-input-current{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tg-input-current>div{background:#f4f9fb;border:1px solid #e0edf3;padding:11px;border-radius:7px;min-width:0}
.tg-input-current span{display:block;font-size:10px;color:#879fad}
.tg-input-current strong{font-size:20px;color:#337e9d;display:block;margin-top:5px}
.tg-input-current strong.warn{color:#bc7e4a}
.tg-input-current small{font-size:10px;font-weight:400;margin-left:4px}
.tg-input-heading{font-size:12px;font-weight:650;color:#476f85;margin-bottom:9px}
.tg-input-presets{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}
.tg-input-presets button{font:inherit;font-size:12px;padding:10px 7px;
  border:1px solid #d9e8f0;border-radius:7px;background:#f9fcfd;color:#618296;cursor:pointer}
.tg-input-presets button.selected{border-color:#67a4be;background:#eaf5fa;color:#337b9b}
.tg-input-tabs{display:flex;gap:5px;border-bottom:1px solid #dceaf0}
.tg-input-tabs button{flex:1;border:0;background:transparent;color:#7d97a6;font:inherit;
  padding:9px 4px;cursor:pointer;font-size:12px}
.tg-input-tabs button.active{color:#2d839f;border-bottom:2px solid #4b9bbb;font-weight:650}
.tg-input-fields{display:flex;flex-direction:column;gap:12px}
.tg-input-fields label{display:flex;gap:10px;align-items:center;
  justify-content:space-between;font-size:12px;color:#547588}
.tg-input-fields label>span{flex:1;min-width:0}
.tg-input-fields small{font-size:10px;color:#91a7b3}
.tg-input-fields :deep(.el-input-number){width:154px;max-width:53%}
.tg-input-fields :deep(.el-select){width:154px;max-width:53%}
.tg-input-actions{margin-top:auto;padding:14px 0;display:flex;gap:10px;
  align-items:center;justify-content:space-between;border-top:1px solid #dfeaf0}
.tg-input-actions span{font-size:10px;color:#90a3b0}
@media(max-width:480px){.tg-input-panel{padding:12px}
  .tg-input-fields :deep(.el-input-number){width:125px}
}
</style>

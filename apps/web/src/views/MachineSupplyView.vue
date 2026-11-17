<script setup lang="ts">
import {computed,reactive,ref} from "vue";
import {RouterLink} from "vue-router";
import {NButton,NInputNumber,NTag} from "naive-ui";
import {createMachineSupplyScenario,evaluateMachineSupply,type MachineScenarioId} from "../demo/machineSupply";

const scenario=ref<MachineScenarioId>("single");
const model=reactive(createMachineSupplyScenario());
const assessment=computed(()=>{try{return evaluateMachineSupply(model);}catch{return null;}});
const fmt=(value:number|undefined)=>value===undefined?"缺数":value.toLocaleString("zh-CN",{maximumFractionDigits:1});
function setScenario(id:MachineScenarioId){
 scenario.value=id;
 Object.assign(model,createMachineSupplyScenario(id));
}
const scenarios:{id:MachineScenarioId;label:string}[]=[
 {id:"single",label:"单机作业"},{id:"parallel",label:"多机同时作业"},{id:"limited",label:"供水能力不足"},
];
</script>

<template>
 <section class="machine-page">
  <header class="machine-header">
   <div>
    <p class="eyebrow">港口生产保障 / 大机用水</p>
    <h2>各大机供水保障</h2>
    <p>把大机作业需求与供水泵组的模拟能力放在一起比较。这里只评估水量能力，不将大机本体等同于用水终端。</p>
   </div>
   <NTag type="warning">MOCK · 终端和管网待工程确认</NTag>
  </header>
  <section class="machine-presets" aria-label="供水场景">
   <NButton v-for="item in scenarios" :key="item.id" :type="scenario===item.id?'primary':'default'"
     :secondary="scenario!==item.id" @click="setScenario(item.id)">{{item.label}}</NButton>
  </section>
  <section class="machine-kpis">
   <div><span>作业供水需求</span><strong>{{ fmt(assessment?.demandedM3h) }} <small>m³/h</small></strong></div>
   <div><span>扣除安全预留后可用</span><strong>{{ fmt(assessment?.availableM3h) }} <small>m³/h</small></strong></div>
   <div :class="{danger:(assessment?.shortageM3h??0)>0}"><span>供水缺口</span><strong>{{ fmt(assessment?.shortageM3h) }} <small>m³/h</small></strong></div>
   <div><span>管网末端压力</span><strong>缺数</strong><small>尚无经核实的水力模型/末端压力测点</small></div>
  </section>
  <div class="machine-layout">
   <section class="machine-panel">
    <h3>作业设备与用水需求</h3>
    <p class="sub">此处的大机编号、作业状态和需水定额均为演示样例，可切换验证并行作业造成的供水压力。</p>
    <div class="machine-record" v-for="t in model.terminals" :key="t.id">
     <div class="machine-name">
      <label><input type="checkbox" v-model="t.active" /> <strong>{{t.name}}</strong></label>
      <small>{{t.waterPurpose}} · 供水线路未核实</small>
     </div>
     <label class="rate">需水量（m³/h）
      <NInputNumber :value="t.demandM3h" :min="0" :max="100000" size="small" style="width:128px"
        @update:value="value=>t.demandM3h=value??0" />
     </label>
     <div class="allocated">
      <strong>{{fmt(assessment?.terminals.find(x=>x.id===t.id)?.allocatedM3h)}}</strong>
      <small>模拟可分配 m³/h</small>
     </div>
    </div>
   </section>
   <aside class="machine-panel machine-setting">
    <h3>供水能力条件（模拟）</h3>
    <div class="setting-row"><span>泵组模拟总供水能力（m³/h）</span>
      <NInputNumber :value="model.capacityM3h" :min="0" size="small"
        @update:value="value=>model.capacityM3h=value??0" /></div>
    <div class="setting-row"><span>必要的保障预留（m³/h）</span>
      <NInputNumber :value="model.reservedM3h" :min="0" size="small"
        @update:value="value=>model.reservedM3h=value??0" /></div>
    <p class="sub">分配顺序依据业务优先级模拟，并非 PLC 启停或调阀方案。管网实际连通、最不利点压力和泵组曲线还需专项核实。</p>
    <div class="machine-result" v-if="assessment">
     <NTag :type="assessment.fullySatisfied?'success':'warning'">{{assessment.fullySatisfied?'模拟流量满足':'模拟供水存在缺口'}}</NTag>
     <p v-if="!assessment.fullySatisfied">建议首先核查大机作业计划、允许调整的用水点、泵组状态及末端压力；不自动关闭环保设施。</p>
     <p v-else>仅表示设置的流量能力足够；未经压力和水质校核，不代表工程供水已经保障。</p>
    </div>
    <p v-else class="error">参数无效：安全预留不得超过供水能力，请调整输入。</p>
   </aside>
  </div>
  <section class="machine-panel machine-bottom">
   <h3>关联的业务流程</h3>
   <nav class="machine-links">
    <RouterLink to="/process/medium-pressure">查看中压供水泵组 →</RouterLink>
    <RouterLink to="/process/spray">查看射雾除尘末端 →</RouterLink>
    <RouterLink :to="{path:'/water/balance',query:{machineDemand:String(assessment?.demandedM3h??0),machineCapacity:String(assessment?.availableM3h??0)}}">带入动态平衡分析 →</RouterLink>
    <RouterLink to="/operations/events">进入异常处置 →</RouterLink>
   </nav>
   <p class="sub">本项目尚未确认各大机真实供水点、供水站归属、阀门、管径和末端计量。当前模型只用于分析需求与能力，不计算管网压力、不发控制命令。</p>
  </section>
 </section>
</template>

<style scoped>
.machine-page{display:grid;gap:13px;padding:2px 2px 24px;color:#234b65}
.machine-header,.machine-panel,.machine-kpis>div{background:#f9fcff;border:1px solid #d0e3ee;border-radius:11px;box-shadow:0 3px 10px #265c7a0b}
.machine-header{padding:17px 20px;display:flex;justify-content:space-between;align-items:start;gap:14px}
.machine-header h2{margin:4px 0 7px;font-size:22px}.machine-header p{margin:0;font-size:13px;color:#64879c;max-width:760px}
.eyebrow{font-size:11px!important;color:#5a91a8!important}.machine-presets{display:flex;gap:8px;flex-wrap:wrap}
.machine-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}
.machine-kpis>div{padding:16px;display:grid;gap:6px}.machine-kpis span,.machine-kpis small{color:#6b8d9c;font-size:12px}
.machine-kpis strong{font-size:24px;color:#23759f;white-space:nowrap}.machine-kpis strong small{font-size:12px}.machine-kpis .danger strong{color:#b55a42}
.machine-layout{display:grid;grid-template-columns:1.65fr 1fr;gap:13px}.machine-panel{padding:15px 18px}
.machine-panel h3{font-size:15px;margin:0 0 8px}.sub{font-size:12px;color:#718d9c;line-height:1.7;margin:6px 0 12px}
.machine-record{display:flex;align-items:center;gap:15px;padding:12px 0;border-top:1px solid #e4eff5}.machine-name{min-width:0;flex:1;display:grid;gap:6px}
.machine-name label{display:flex;gap:7px;align-items:center}.machine-name strong{font-size:13px}.machine-name small{font-size:11px;color:#7394a2}
.rate{font-size:11px;color:#6c899e;display:grid;gap:5px}.allocated{text-align:right;min-width:82px;display:grid;gap:4px}.allocated strong{font-size:20px;color:#2a799b}.allocated small{font-size:10px;color:#7c98a8}
.machine-setting{display:grid;align-content:start;gap:12px}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px}
.machine-result{padding:11px;background:#eff8fb;border-radius:7px}.machine-result p{font-size:12px;line-height:1.7;margin:7px 0 0}.error{color:#b54635;font-size:12px}
.machine-links{display:flex;flex-wrap:wrap;gap:12px}.machine-links a{padding:8px 10px;border-radius:6px;background:#e9f5fc;text-decoration:none;color:#137aa7;font-size:12px}
@media(max-width:1100px){.machine-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.machine-layout{grid-template-columns:1fr}}
@media(max-width:600px){.machine-header{display:grid}.machine-kpis{grid-template-columns:1fr 1fr}.machine-kpis strong{font-size:19px}.machine-record{flex-wrap:wrap}.machine-name{flex-basis:100%}}
</style>

<script setup lang="ts">
import {computed,reactive,ref,watch} from "vue";
import {RouterLink,useRoute} from "vue-router";
import {NButton,NInputNumber,NTag,NCheckbox} from "naive-ui";
import {assessIntegratedBalance,DEFAULT_INTEGRATED_BALANCE,type IntegratedBalanceInput} from "../demo/integratedBalance";
type NumericKey={ [K in keyof IntegratedBalanceInput]:IntegratedBalanceInput[K] extends number?K:never }[keyof IntegratedBalanceInput];
const route=useRoute();
const model=reactive<IntegratedBalanceInput>({...DEFAULT_INTEGRATED_BALANCE});
const preset=ref("normal");
const fields:{key:NumericKey;label:string;unit:string}[]=[
 {key:"periodHours",label:"核算时段",unit:"h"},
 {key:"rainMm",label:"本时段降雨量",unit:"mm"},
 {key:"catchmentAreaM2",label:"参与计算的汇水面积",unit:"m²"},
 {key:"contaminatedRunoffRatio",label:"污染径流折算系数",unit:"0～1"},
 {key:"pollutedInitialM3",label:"污染水池初始储量",unit:"m³"},
 {key:"pollutedCapacityM3",label:"污染水池容量",unit:"m³"},
 {key:"treatmentM3h",label:"处理站有效能力",unit:"m³/h"},
 {key:"cleanInitialM3",label:"清水池初始储量",unit:"m³"},
 {key:"cleanCapacityM3",label:"清水池容量",unit:"m³"},
 {key:"approvedReuseDemandM3",label:"终端可接收回用水量",unit:"m³/时段"},
 {key:"reusePumpM3h",label:"回用泵输送上限",unit:"m³/h"},
 {key:"machineDemandM3h",label:"大机作业需水（独立分支）",unit:"m³/h"},
 {key:"machineAvailableM3h",label:"大机可用供水能力",unit:"m³/h"},
];
function loadQuery(){
 const machine=Number(route.query.machineDemand);
 const capacity=Number(route.query.machineCapacity);
 if(route.query.machineDemand!==undefined&&Number.isFinite(machine)&&machine>=0)model.machineDemandM3h=machine;
 if(route.query.machineCapacity!==undefined&&Number.isFinite(capacity)&&capacity>=0)model.machineAvailableM3h=capacity;
}
loadQuery();
watch(()=>route.fullPath,loadQuery);
const output=computed(()=>{try{return assessIntegratedBalance(model);}catch{return null;}});
const format=(n:number|undefined)=>n===undefined?"缺数":n.toLocaleString("zh-CN",{maximumFractionDigits:1});
function setNumber(key:NumericKey,value:number|null){model[key]=value??0;}
function scenario(id:"normal"|"rain"|"shortage"){
 preset.value=id;Object.assign(model,{...DEFAULT_INTEGRATED_BALANCE});
 loadQuery();
 if(id==="rain"){model.rainMm=100;model.treatmentM3h=40;model.approvedReuseDemandM3=800;}
 if(id==="shortage"){model.machineDemandM3h=105;model.machineAvailableM3h=60;model.reusePathAssumed=false;}
}
</script>

<template>
 <section class="balance-page">
  <header class="balance-header">
   <div><p class="eyebrow">水资源管理 / 供需动态平衡</p><h2>水资源动态平衡分析</h2>
    <p>同一时间窗口内核算雨污水收集、处理、清水储存与终端消纳，并对照大机供水需求。保留各水路的工程边界，不假设存在未确认管线。</p></div>
   <NTag type="warning">MOCK · 辅助决策，不可下发控制</NTag>
  </header>
  <div class="preset-row">
   <NButton :type="preset==='normal'?'primary':'default'" secondary @click="scenario('normal')">正常作业</NButton>
   <NButton :type="preset==='rain'?'primary':'default'" secondary @click="scenario('rain')">强降雨 · 消纳不足</NButton>
   <NButton :type="preset==='shortage'?'primary':'default'" secondary @click="scenario('shortage')">大机供水不足</NButton>
  </div>
  <div v-if="output" class="balance-stats">
   <div><span>污染雨水入池（估算）</span><strong>{{format(output.pollutedRainInM3)}}<small>m³</small></strong></div>
   <div><span>处理量（受容量约束）</span><strong>{{format(output.processedM3)}}<small>m³</small></strong></div>
   <div><span>实际可回用量（模拟）</span><strong>{{format(output.actualReuseM3)}}<small>m³</small></strong></div>
   <div :class="{danger:output.pollutionOverflowM3>0||output.machineShortageM3>0}"><span>暂存超限 / 大机供水缺口</span>
    <strong>{{format(output.pollutionOverflowM3)}} / {{format(output.machineShortageM3)}}<small>m³</small></strong></div>
  </div>
  <div class="balance-layout">
   <section class="balance-panel">
    <h3>同周期水量流向</h3>
    <div v-if="output" class="balance-steps">
     <div><span>污染水来源</span><strong>{{format(output.pollutedRainInM3)}}</strong><small>雨水估算入池 m³</small></div>
     <div><span>含矿污水处理</span><strong>{{format(output.processedM3)}}</strong><small>受处理能力及清水池限制</small></div>
     <div><span>合格回用消纳</span><strong>{{format(output.actualReuseM3)}}</strong><small>受水质、管路、需求约束</small></div>
     <div><span>剩余池容</span><strong>{{format(Math.max(0,model.pollutedCapacityM3-output.pollutedEndM3))}}</strong><small>污染水池可用空间 m³</small></div>
    </div>
    <div v-if="output" class="balance-details">
      <p>污染水池期末 <b>{{format(output.pollutedEndM3)}} m³</b> · 清水池期末 <b>{{format(output.cleanEndM3)}} m³</b></p>
      <p>水量守恒偏差 <b>{{format(output.physicalBalanceGapM3)}} m³</b>（模拟计算内部校验）</p>
      <p>大机需求 <b>{{format(output.machineDemandM3)}}</b> / 模拟供应 <b>{{format(output.machineDeliveredM3)}} m³</b>（独立供水分支，未证实与清水池连通）</p>
    </div>
    <h3>风险判断与下一步</h3>
    <div v-if="output" class="risks"><p v-for="risk in output.risks" :key="risk">{{risk}}</p></div>
    <p v-else class="error">输入参数不满足物理约束，请检查容积、初始储量和时段。</p>
    <p class="muted">待确认：各池 V-H 曲线、处理站有效能力、水质、实际可达回用终端、大机供水拓扑及末端压力。数值全为演示假设。</p>
   </section>
   <section class="balance-panel">
    <h3>模型条件（MOCK，可修改）</h3>
    <div class="field-grid">
     <label v-for="field in fields" :key="field.key" class="field">
      <span>{{field.label}} <small>{{field.unit}}</small></span>
      <NInputNumber :value="model[field.key]" :min="0" :max="field.key==='contaminatedRunoffRatio'?1:undefined" size="small" @update:value="value=>setNumber(field.key,value)" />
     </label>
    </div>
    <div class="checks">
     <NCheckbox :checked="model.qualityAccepted" @update:checked="value=>model.qualityAccepted=!!value">假设本时段处理出水符合用途水质</NCheckbox>
     <NCheckbox :checked="model.reusePathAssumed" @update:checked="value=>model.reusePathAssumed=!!value">假设本时段回用管线可达终端</NCheckbox>
    </div>
    <p class="muted">以上“假设”只用于敏感性试算，并非已核实工程关系。流量及需水量统一折算到 {{model.periodHours}} 小时时段。</p>
   </section>
  </div>
  <section class="balance-panel">
   <h3>专业分析与原系统联动</h3>
   <div class="links">
    <RouterLink :to="{path:'/water/dispatch',query:{rainMm:String(model.rainMm),source:'balance'}}">继续雨前调蓄方案比选 →</RouterLink>
    <RouterLink :to="{path:'/water/multi-source',query:{machineDemandM3:String(Math.round(model.machineDemandM3h*model.periodHours)),source:'balance'}}">把同周期大机需水带入多水源匹配 →</RouterLink>
    <RouterLink to="/water/port-chain">核查污染水业务链 →</RouterLink>
    <RouterLink to="/water/machine-supply">核查各大机供水对象 →</RouterLink>
   </div>
   <p class="muted">专项页面只传递明确的降雨量或需求量参数，不冒充同一座池、同一条管路或已经验证的动态联动控制。真实运行仍需独立水力分析与现场验收。</p>
  </section>
 </section>
</template>

<style scoped>
.balance-page{display:grid;gap:13px;padding-bottom:24px;color:#234c64}
.balance-header,.balance-panel,.balance-stats>div{background:#f9fcff;border:1px solid #d0e3ee;border-radius:11px;box-shadow:0 3px 10px #265c7a0b}
.balance-header{display:flex;justify-content:space-between;align-items:start;padding:16px 20px;gap:12px}
.balance-header h2{font-size:22px;margin:4px 0 7px}.balance-header p{font-size:13px;line-height:1.6;color:#69899b;margin:0;max-width:830px}
.eyebrow{font-size:11px!important;color:#5a93a8!important}.preset-row{display:flex;gap:8px;flex-wrap:wrap}
.balance-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}.balance-stats>div{padding:13px;display:grid;gap:6px}
.balance-stats span{font-size:12px;color:#7894a1}.balance-stats strong{font-size:22px;color:#27799c;white-space:nowrap}.balance-stats small{font-size:11px}.balance-stats .danger strong{color:#ba593f}
.balance-layout{display:grid;grid-template-columns:1.25fr 1fr;gap:13px}.balance-panel{padding:16px 18px}.balance-panel h3{font-size:15px;margin:0 0 12px}
.balance-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.balance-steps>div{display:grid;gap:5px;padding:12px;background:#eaf6fc;border:1px solid #d4e9f4;border-radius:9px}
.balance-steps span{font-size:12px;color:#547f94}.balance-steps strong{font-size:21px;color:#1f799d}.balance-steps small{font-size:11px;color:#7795a5}
.balance-details{padding:12px 0;border-bottom:1px solid #dfeef5}.balance-details p{font-size:12px;line-height:1.6;margin:5px 0}
.risks p{background:#fff6e9;border-left:3px solid #dcaa6b;padding:8px 10px;font-size:12px;line-height:1.65}
.muted{font-size:12px;color:#7894a4;line-height:1.75}.error{color:#c54c37;font-size:12px}
.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.field{display:grid;gap:4px;font-size:12px}.field span{color:#4b768a}.field small{color:#839eab}
.checks{display:grid;gap:8px;margin-top:13px}.links{display:flex;flex-wrap:wrap;gap:9px}.links a{padding:8px 10px;border-radius:6px;background:#eaf5fc;color:#197fa4;font-size:12px;text-decoration:none}
@media(max-width:1250px){.balance-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.balance-layout{grid-template-columns:1fr}}
@media(max-width:600px){.balance-header{display:grid}.balance-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.field-grid{grid-template-columns:1fr}.balance-stats strong{font-size:18px}}
</style>

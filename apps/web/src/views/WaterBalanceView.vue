<script setup lang="ts">
import {computed,reactive,ref,watch} from "vue";
import {RouterLink,useRoute} from "vue-router";
import {NButton,NInputNumber,NTag,NCheckbox,NInput,NSelect,useMessage} from "naive-ui";
import {assessIntegratedBalance,DEFAULT_INTEGRATED_BALANCE,type IntegratedBalanceInput} from "../demo/integratedBalance";
import {useDemoStore} from "../demo/store";
import {can,roleNames} from "../demo/permissions";
import {createBalanceCase,readBalanceCases,advanceBalanceCase,type BalanceAction,type BalanceCase} from "../demo/balanceWorkflow";
import {readFlowDraft,saveFlowDraft} from "../demo/userJourney";
type NumericKey={ [K in keyof IntegratedBalanceInput]:IntegratedBalanceInput[K] extends number?K:never }[keyof IntegratedBalanceInput];
const route=useRoute();
const store=useDemoStore();
const message=useMessage();
const cases=ref<BalanceCase[]>(readBalanceCases(localStorage,store.scenarioId));
const selectedCaseId=ref(cases.value.at(-1)?.id??"");
const selectedCase=computed(()=>cases.value.find(c=>c.id===selectedCaseId.value));
const canPropose=computed(()=>can(store.role,"water:proposal"));
const canReview=computed(()=>store.role==="manager"||store.role==="admin");
const workflowForm=reactive({
 purpose:"评估降雨下污染水池暂存、处理和回用约束",
 basis:"当前仅采用本地MOCK模型参数，现场实测待核",
 note:"",owner:"",approvalRef:"",followUpRef:"",
 outcome:"improved" as "improved"|"unresolved"|"unchanged",
});
const conservative=computed(()=>{
 try{return assessIntegratedBalance({...model,qualityAccepted:false,reusePathAssumed:false});}
 catch{return null;}
});
function refreshCases(){
 cases.value=readBalanceCases(localStorage,store.scenarioId);
 if(!cases.value.some(c=>c.id===selectedCaseId.value))selectedCaseId.value=cases.value.at(-1)?.id??"";
}
function createCase(){
 try{
  const created=createBalanceCase(localStorage,{
   scenarioId:store.scenarioId,actor:store.role,candidate:{...model},
   purpose:workflowForm.purpose,basis:workflowForm.basis,now:new Date().toISOString(),
  });
  refreshCases();selectedCaseId.value=created.id;
  message.success("已保存独立模拟方案草稿；输入和结果均随编号保留");
 }catch(error){message.error((error as Error).message);}
}
function advanceCase(action:BalanceAction){
 const item=selectedCase.value;if(!item)return;
 try{
  advanceBalanceCase(localStorage,item.id,action,store.role,{
   note:workflowForm.note,owner:workflowForm.owner,approvalRef:workflowForm.approvalRef,
   followUpRef:workflowForm.followUpRef,observed:{...model},outcome:workflowForm.outcome,
  },new Date().toISOString());
  refreshCases();workflowForm.note="";
  message.success("已记录人工业务操作；未下发工控或真实调度命令");
 }catch(error){message.error((error as Error).message);}
}
const caseStatus:Record<string,string>={
 draft:"模拟草稿",submitted:"待管理复核",adopted:"内部拟采纳·待跟踪",tracking:"已补录跟踪",closed:"复盘归档",rejected:"不采纳",
};
watch(()=>store.scenarioId,refreshCases);
const flowKey=()=>"water-balance:"+store.scenarioId;
function validState(value:unknown):value is IntegratedBalanceInput{
 if(!value||typeof value!=="object")return false;
 const given=value as Record<string,unknown>;
 return Object.entries(DEFAULT_INTEGRATED_BALANCE).every(([key,v])=>typeof given[key]===typeof v);
}
const remembered=readFlowDraft(sessionStorage,flowKey(),validState);
const model=reactive<IntegratedBalanceInput>({...DEFAULT_INTEGRATED_BALANCE,...remembered});
const recovered=ref(Boolean(remembered));
watch(model,()=>saveFlowDraft(sessionStorage,flowKey(),model),{deep:true});
watch(()=>store.scenarioId,()=>{
 const next=readFlowDraft(sessionStorage,flowKey(),validState);
 Object.assign(model,{...DEFAULT_INTEGRATED_BALANCE,...next});
 recovered.value=Boolean(next);
});
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
function setNumber(key:NumericKey,value:number|null){model[key]=value??0;recovered.value=false;}
function resetAnalysis(){Object.assign(model,{...DEFAULT_INTEGRATED_BALANCE});loadQuery();preset.value="normal";recovered.value=false;}
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
   <NButton size="small" secondary @click="resetAnalysis">重置试算条件</NButton>
   <span class="flow-saved">模拟输入仅在本标签页保留{{recovered?' · 已恢复上次编辑':''}}，不会自动执行调度</span>
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
  <section class="balance-panel balance-workflow" aria-label="水务方案比选与人工跟踪">
   <h3>降雨调蓄分析 · 方案比选与人工闭环</h3>
   <p class="muted">按同一模型输入比较情景，不冒充真实处理能力、管线连通或水质放行。修改上方输入后再保存独立版本；只有管理岗位可人工拟采纳。</p>
   <div class="compare-grid">
    <div><span>默认情景（MOCK）</span><strong>{{format(assessIntegratedBalance(DEFAULT_INTEGRATED_BALANCE).pollutionOverflowM3)}} m³</strong><small>默认假设暂存超限量</small></div>
    <div><span>当前试算（MOCK）</span><strong>{{format(output?.pollutionOverflowM3)}} m³</strong><small>处理 {{format(output?.processedM3)}} / 回用 {{format(output?.actualReuseM3)}} m³</small></div>
    <div><span>保守情景（不计合格回用）</span><strong>{{format(conservative?.pollutionOverflowM3)}} m³</strong><small>水质/路径未确认时不得计算合格回用</small></div>
   </div>
   <div class="workflow-grid">
    <section class="workflow-form">
     <h4>1. 保存分析快照</h4>
     <label>分析目的<NInput v-model:value="workflowForm.purpose" size="small" /></label>
     <label>输入参数来源 / 待核依据<NInput v-model:value="workflowForm.basis" size="small" /></label>
     <NButton type="primary" size="small" :disabled="!canPropose||!output" @click="createCase">保存当前试算为独立草稿</NButton>
     <p class="muted">不同编号各自保留输入、结果、操作时间线；后续修改上方表单不改写已存快照。</p>
    </section>
    <section class="workflow-form">
     <h4>2. 审核与跟踪</h4>
     <label>已保存方案
      <NSelect :value="selectedCaseId" :options="cases.map(c=>({label:c.id+' · '+caseStatus[c.status],value:c.id}))"
       size="small" placeholder="先保存分析快照" @update:value="v=>selectedCaseId=v"/>
     </label>
     <template v-if="selectedCase">
      <NTag size="small" type="info">{{caseStatus[selectedCase.status]}}</NTag>
      <p class="muted">原始草稿：{{selectedCase.createdBy}} · 暂存超限 {{format(selectedCase.candidateResult.pollutionOverflowM3)}} m³ · 大机缺口 {{format(selectedCase.candidateResult.machineShortageM3)}} m³</p>
      <label v-if="selectedCase.status==='submitted'">内部研判依据编号<NInput v-model:value="workflowForm.approvalRef" placeholder="编号必填，不代表正式调度许可" size="small" /></label>
      <label v-if="selectedCase.status==='submitted'">跟踪责任人<NInput v-model:value="workflowForm.owner" placeholder="填写实际负责角色/人员" size="small" /></label>
      <label v-if="selectedCase.status==='adopted'||selectedCase.status==='tracking'">跟踪/复盘证据编号<NInput v-model:value="workflowForm.followUpRef" size="small" placeholder="现场记录引用，人工录入" /></label>
      <label v-if="selectedCase.status==='tracking'">复盘结果<NSelect v-model:value="workflowForm.outcome" size="small"
       :options="[{label:'较原方案改善（需证据）',value:'improved'},{label:'风险未解决',value:'unresolved'},{label:'无明显变化',value:'unchanged'}]"/></label>
      <label v-if="selectedCase.status!=='closed'&&selectedCase.status!=='rejected'">当前操作说明<NInput v-model:value="workflowForm.note" type="textarea" :rows="2" placeholder="依据、限制、后续安排，不能仅填已处理" /></label>
      <div class="case-actions">
       <NButton v-if="selectedCase.status==='draft'" size="small" type="primary" :disabled="!canPropose" @click="advanceCase('submit')">提交人工研判</NButton>
       <NButton v-if="selectedCase.status==='submitted'" size="small" type="primary" :disabled="!canReview" @click="advanceCase('adopt')">拟采纳并指定跟踪</NButton>
       <NButton v-if="selectedCase.status==='submitted'" size="small" :disabled="!canReview" @click="advanceCase('reject')">不采纳</NButton>
       <NButton v-if="selectedCase.status==='adopted'" size="small" type="primary" :disabled="!canPropose||!output" @click="advanceCase('track')">按当前参数补录复核结果</NButton>
       <NButton v-if="selectedCase.status==='tracking'" size="small" type="primary" :disabled="!canReview" @click="advanceCase('close')">提交人工复盘归档</NButton>
      </div>
     </template>
     <p v-else class="muted">尚无独立方案，先保存左侧的模拟试算。</p>
    </section>
   </div>
   <details v-if="selectedCase" class="workflow-history" open>
    <summary>方案操作记录（{{selectedCase.history.length}}）</summary>
    <p v-if="selectedCase.tracking">复测模型：暂存超限 {{format(selectedCase.tracking.result.pollutionOverflowM3)}} m³；依据 {{selectedCase.tracking.evidenceRef}}。人工输入，不代表自动实测。</p>
    <ol><li v-for="(item,i) in selectedCase.history" :key="i">{{item.at}} · {{roleNames[item.by]}} · {{item.action}}：{{item.detail}}</li></ol>
   </details>
  </section>
  <section class="balance-panel">
   <h3>专业分析与原系统联动</h3>
   <div class="links">
    <RouterLink :to="{path:'/water/dispatch',query:{rainMm:String(model.rainMm),source:'balance',returnTo:route.fullPath}}">继续雨前调蓄方案比选 →</RouterLink>
    <RouterLink :to="{path:'/water/multi-source',query:{machineDemandM3:String(Math.round(model.machineDemandM3h*model.periodHours)),source:'balance',returnTo:route.fullPath}}">把同周期大机需水带入多水源匹配 →</RouterLink>
    <RouterLink :to="{path:'/water/port-chain',query:{returnTo:route.fullPath}}">核查污染水业务链 →</RouterLink>
    <RouterLink :to="{path:'/water/machine-supply',query:{returnTo:route.fullPath}}">核查各大机供水对象 →</RouterLink>
   </div>
   <p class="muted">专项页面只传递明确的降雨量或需求量参数，不冒充同一座池、同一条管路或已经验证的动态联动控制。真实运行仍需独立水力分析与现场验收。</p>
  </section>
 </section>
</template>

<style scoped>
.balance-page{display:grid;gap:11px;padding-bottom:20px;color:#234c64}
.balance-workflow{display:grid;gap:12px}
.compare-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.compare-grid>div{padding:11px;border:1px solid #d7e9f0;background:#eef8fc;border-radius:7px;display:grid;gap:5px}
.compare-grid span,.compare-grid small{color:#64879d;font-size:11px}
.compare-grid strong{font-size:19px;color:#227a9b}
.workflow-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.workflow-form{border:1px solid #e0edf3;border-radius:8px;padding:12px;display:grid;align-content:start;gap:9px}
.workflow-form h4{margin:0;font-size:13px}
.workflow-form label{display:grid;gap:5px;font-size:12px;color:#486b81}
.case-actions{display:flex;gap:7px;flex-wrap:wrap}
.workflow-history{font-size:12px;color:#456e85}
.workflow-history ol{padding-left:24px;line-height:1.8;overflow-wrap:anywhere}
@media(max-width:750px){.workflow-grid{grid-template-columns:1fr}.compare-grid{grid-template-columns:1fr}}

.flow-saved{font-size:11px;color:#527b91;align-self:center}
.balance-header,.balance-panel,.balance-stats>div{background:#f9fcff;border:1px solid #d0e3ee;border-radius:11px;box-shadow:0 3px 10px #265c7a0b}
.balance-header{display:flex;justify-content:space-between;align-items:start;padding:12px 17px;gap:12px}
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

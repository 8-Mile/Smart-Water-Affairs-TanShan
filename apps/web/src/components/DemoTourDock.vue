<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import {NButton,useDialog,useMessage} from "naive-ui";
import {can,roleNames} from "../demo/permissions";
import {readDrafts,MULTI_SOURCE_DRAFT_KEY,type SupplyDraft} from "../demo/proposalDrafts";
import {readGreenDrafts,type GreenBenefitDraft} from "../demo/greenBenefit";
import {useDemoStore} from "../demo/store";
import {
 TOUR_DEFINITIONS,tourTarget,useDemoTour,DEMO_EVIDENCE_UPDATED,type TourId,type TourStepKind,
} from "../demo/demoTour";
import type {Role} from "../demo/types";

const tour=useDemoTour();
const store=useDemoStore();
const router=useRouter();
const route=useRoute();
const dialog=useDialog(),message=useMessage();
// localStorage writes in existing pages do not themselves invalidate Vue computeds.
// Refresh on navigation and every guide interaction, without polling or changing source data.
const refreshTick=ref(0);
function refresh(){refreshTick.value++;}
watch(()=>route.fullPath,refresh);
onMounted(()=>window.addEventListener(DEMO_EVIDENCE_UPDATED,refresh));
onUnmounted(()=>window.removeEventListener(DEMO_EVIDENCE_UPDATED,refresh));
const record=computed(()=>tour.record);
const definition=computed(()=>tour.definition);
const step=computed(()=>tour.step);
const stepNumber=computed(()=>((record.value?.step??0)+1));
const currentFlow=computed(()=>record.value?.id??null);
const currentSupplyDraft=computed(()=>{
 void refreshTick.value;
 const initial=record.value;
 if(!initial||initial.id!=="cost")return null;
 // Explicitly require a draft saved since the presenter started this run.
 return readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY,localStorage)
  .find(x=>x.source==="MOCK"&&x.state==="draft"&&!initial.baselineSupplyIds.includes(x.id))??null;
});
const costDraft=computed(()=>{
 void refreshTick.value;
 if(!record.value||!currentSupplyDraft.value)return null;
 return readGreenDrafts(localStorage).find((x:GreenBenefitDraft)=>
  x.status==="draft"&&x.result.sourceDraftId===currentSupplyDraft.value?.id&&
  !record.value?.baselineBenefitIds.includes(x.id))??null;
});
const savedStormSnapshot=computed(()=>{
 void refreshTick.value;
 if(record.value?.id!=="storm")return null;
 try{
  const parsed:unknown=JSON.parse(localStorage.getItem("tanggang-port-chain-demo-run-v3")??"null");
  if(!parsed||typeof parsed!=="object")return null;
  const snapshot=parsed as {id?:string;scenario?:string;computed?:unknown};
  return snapshot.id&&snapshot.id!==record.value.baselineSnapshotId&&snapshot.scenario==="storm"?
   snapshot:null;
 }catch{return null;}
});
const p002Alarm=computed(()=>store.alarms.find(a=>a.id==="ALM-P002-01"));
const p002Order=computed(()=>store.workorders.find(o=>o.id==="wo-2026-014"));
const scenarioReady=computed(()=>store.scenarioId==="SCN-PUMP-FAULT");
const status=computed(()=>{
 if(!step.value)return {label:"未启动",complete:false,warning:""};
 const id:TourStepKind=step.value.id;
 switch(id){
  case "fault-start":return {label:scenarioReady.value?"泵组故障情景已启用":"尚未启用泵组故障情景",complete:scenarioReady.value,
   warning:scenarioReady.value?"":"本步须明确准备模拟场景后继续。"};
  case "fault-detect":return {label:!scenarioReady.value?"请先准备故障场景":
   p002Alarm.value?.status==="active"?"P-002 活动告警已存在":
   p002Alarm.value?.status==="acknowledged"?"告警已被确认":
   p002Alarm.value?.status==="closed"?"告警已关闭，保留历史可查":"当前场景未发现指定告警",
   complete:scenarioReady.value&&!!p002Alarm.value,warning:"事件数不等于本岗位动作数。"};
  case "fault-asset":return {label:p002Alarm.value?.status==="acknowledged"||p002Alarm.value?.status==="closed"?
   "值班确认已记录":"尚未记录值班确认",complete:!!p002Alarm.value&&p002Alarm.value.status!=="active",
   warning:"确认不代表设备恢复。"};
  case "fault-repair":return {label:p002Order.value?.status==="pending_acceptance"?"维修结果已提交待验收":
   p002Order.value?.status==="archived"?"工单已归档":
   p002Order.value?"工单仍待处理":"场景内未找到 WO-2026-014",
   complete:p002Order.value?.status==="pending_acceptance"||p002Order.value?.status==="archived",
   warning:"原因与措施由演示人员填写，保留原工单证据。"};
  case "fault-accept":return {label:p002Order.value?.status==="archived"?"工单已验收归档":"尚未验收归档",
   complete:p002Order.value?.status==="archived",warning:"归档不自动关闭告警。"};
  case "fault-close":return {label:p002Alarm.value?.status==="closed"?"已留下独立告警关闭记录":"告警尚未独立关闭",
   complete:p002Alarm.value?.status==="closed",warning:"需要核查依据及管理者权限；并非 SCADA 复归。"};
  case "storm-model":return {label:"60mm 情景可直接查看模型结果",complete:false,
   warning:"输入均为演示假设，不能据此确定真实污染水量。"};
  case "storm-basis":return {label:"现场核实尚未完成",complete:false,
   warning:"请向业主说明池容、分区及真实水路的工程资料要求。"};
  case "storm-evidence":return {label:savedStormSnapshot.value?
   "本轮已保存模拟分析快照":"本轮尚未保存分析快照",
   complete:!!savedStormSnapshot.value,warning:"只保存演示数据，不代替外排许可。"};
  case "cost-source":return {label:currentSupplyDraft.value?
   "已保存本轮方案 "+currentSupplyDraft.value.id:"本轮尚未保存 WS 供水草稿",
   complete:!!currentSupplyDraft.value,warning:"供水草稿必须满足完整供水约束。"};
  case "cost-compare":return {label:costDraft.value?
   "已保存匹配的成本草稿 "+costDraft.value.id:"尚未保存基于本轮 WS 编号的效益草稿",
   complete:!!costDraft.value,warning:"费用必须重算，不能直接复制上一步节约金额。"};
 }
 return {label:"尚未开始",complete:false,warning:""};
});
const target=computed(()=>step.value?
 tourTarget(step.value.id,currentSupplyDraft.value?.id):null);
const correctLocation=computed(()=>{
 if(!target.value)return false;
 if(route.path!==target.value.path)return false;
 return Object.entries(target.value.query??{}).every(([key,val])=>route.query[key]===val);
});
function start(id:TourId){
 refresh();
 let snapshotId="";
 try{const raw=JSON.parse(localStorage.getItem("tanggang-port-chain-demo-run-v3")??"null");
  if(raw&&typeof raw.id==="string")snapshotId=raw.id;
 }catch{/* The previous snapshot is not reliable. */}
 tour.start(id,store.role,store.scenarioId,
  readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY,localStorage).map(x=>x.id),
  readGreenDrafts(localStorage).map(x=>x.id),snapshotId);
 message.info("已开启演示导览。仅引导页面与角色，不自动修改业务记录。");
}
function stop(){
 dialog.info({
  title:"结束本轮业务演示？",
  content:"将只关闭演示导览，不删除已保存的工单、核查记录、方案或场景数据，也不会自动恢复原角色。",
  positiveText:"结束导览",negativeText:"继续演示",onPositiveClick:()=>tour.stop(),
 });
}
function prepareScenario(){
 if(!record.value||record.value.id!=="fault")return;
 dialog.warning({
  title:"准备泵组故障模拟情景",
  content:"将当前演示角色切为“系统管理员”，切换到现有“泵组故障”模拟场景。不重置或清理已操作记录。P-002 故障与工单取自该场景原始数据。",
  positiveText:"确认准备",negativeText:"取消",
  onPositiveClick:()=>{
   try{
    if(!can(store.role,"scenario:write"))store.setRole("admin");
    store.setScenario("SCN-PUMP-FAULT");
    message.success("已启用泵组故障模拟场景；操作记录仍由原系统管理。");
   }catch(error){message.error((error as Error).message);}
  },
 });
}
function switchRole(role:Role){
 if(role===store.role)return;
 dialog.info({
  title:"切换演示角色",
  content:"即将从“"+roleNames[store.role]+"”切换为“"+roleNames[role]+"”。仅改变本地演示权限视角，不替用户执行工单或告警操作。",
  positiveText:"切换到 "+roleNames[role],negativeText:"取消",
  onPositiveClick:()=>{store.setRole(role);},
 });
}
function gotoCurrent(){
 refresh();
 if(!target.value){
  message.warning("请先在水源匹配页保存本轮 WS 草稿，才能打开精确编号的核算页面。");
  return;
 }
 void router.push(target.value);
 tour.minimized=true;
}
function next(){
 refresh();
 if(!record.value||!step.value)return;
 if(step.value.id==="fault-start"&&!scenarioReady.value){
  message.warning("请先明确启用泵组故障模拟情景。");
  return;
 }
 if(step.value.id==="cost-source"&&!currentSupplyDraft.value){
  message.warning("请先在原页面计算并保存一份本轮 WS 供水草稿。");
  return;
 }
 if(record.value.step>=tourDefinitionLength()-1){
  message.info("已到最后一步。可核对结果或结束演示，原业务数据会保留。");
  return;
 }
 tour.move(record.value.step+1);
 const nextStep=tour.step;
 const link=nextStep?tourTarget(nextStep.id,currentSupplyDraft.value?.id):null;
 if(link)void router.push(link);
 tour.minimized=true;
}
function previous(){
 refresh();
 if(!record.value||record.value.step<1)return;
 tour.move(record.value.step-1);
 const link=tour.step?tourTarget(tour.step.id,currentSupplyDraft.value?.id):null;
 if(link)void router.push(link);
 tour.minimized=true;
}
function tourDefinitionLength(){return definition.value?.steps.length??0;}
watch(()=>tour.launcherOpen,value=>{
 // Opening the picker should never close an in-progress tour or change role.
 if(value)tour.minimized=true;
});
</script>

<template>
 <Teleport to="body">
  <div v-if="tour.launcherOpen" class="tour-picker-scrim" role="presentation" @click.self="tour.launcherOpen=false">
   <section class="tour-picker" role="dialog" aria-modal="true" aria-label="选择业务演示路线">
    <header class="tour-picker-head">
     <div><small>DEMO 演示导览 · 不新建业务模块</small><h2>选择一条港口业务演示路线</h2>
      <p>沿现有页面连续操作，突出港口实际业务价值。演示数据、工程边界与已办理状态始终按原系统展示。</p></div>
     <button type="button" aria-label="关闭演示路线选择" class="tour-x" @click="tour.launcherOpen=false">×</button>
    </header>
    <div class="tour-options">
     <button v-for="flow in TOUR_DEFINITIONS" :key="flow.id" class="tour-option" @click="start(flow.id)">
      <span class="tour-option-top"><b>{{ {storm:'01',fault:'02',cost:'03'}[flow.id] }} / 业务演示</b>
       <small>{{ flow.steps.length }} 个步骤</small></span>
      <strong>{{ flow.label }}</strong>
      <span>{{ flow.objective }}</span>
      <em>{{ flow.boundary }}</em>
      <b class="tour-option-entry">开始这条演示路线 ›</b>
     </button>
    </div>
    <footer>操作只在本地 DEMO 中进行；场景切换需要明确确认，结束导览不清理原记录。</footer>
   </section>
  </div>
  <aside v-if="record&&definition&&step" class="tour-dock" :class="{minimized:tour.minimized}" aria-label="当前业务演示导览">
   <div class="tour-dock-top">
    <div><small>业务演示 · {{ stepNumber }}/{{ definition.steps.length }}</small>
     <strong>{{ definition.label }}</strong></div>
    <div class="tour-top-actions">
     <button type="button" :aria-label="tour.minimized?'展开演示导览':'收起演示导览'"
      @click="refresh();tour.minimized=!tour.minimized">{{ tour.minimized?'展开':'收起' }}</button>
     <button type="button" aria-label="结束演示导览" @click="stop">×</button>
    </div>
   </div>
   <template v-if="!tour.minimized">
    <div class="tour-body">
     <div class="tour-progress" aria-label="演示路线进度">
      <button v-for="(s,i) in definition.steps" :key="s.id" :class="{here:i===record.step,past:i<record.step}"
       :title="s.name" :aria-label="'步骤 '+(i+1)+'：'+s.name" @click="tour.move(i)">{{ i+1 }}</button>
     </div>
     <div class="tour-current"><span>第 {{ stepNumber }} 步</span><h3>{{ step.name }}</h3>
      <p v-if="step.id==='fault-repair'&&
        (p002Order?.status==='pending_acceptance'||p002Order?.status==='archived')">
        当前故障场景的原工单已经提交处理结果。请展示原因、处理措施和关联证据，再由管理者进入验收；无需也不应重复提交。
      </p>
      <p v-else>{{ step.instruction }}</p></div>
     <div class="tour-proof" :class="{complete:status.complete}">
      <span>{{ status.complete?'已从业务数据核实':'业务状态 / 待操作' }}</span>
      <strong>{{ status.label }}</strong>
     </div>
     <div class="tour-guide">{{ step.context }}</div>
     <div class="tour-boundary">{{ status.warning }}</div>
     <div v-if="currentFlow==='fault'&&!scenarioReady" class="tour-prepare">
      <NButton size="small" type="primary" block @click="prepareScenario">确认准备泵组故障场景</NButton>
     </div>
     <div v-if="step.role&&step.role!==store.role" class="tour-role">
      <span>建议岗位：{{ roleNames[step.role] }} · 当前 {{ roleNames[store.role] }}</span>
      <NButton size="tiny" secondary @click="switchRole(step.role!)">手动切换演示岗位</NButton>
     </div>
     <div v-if="step.id==='cost-compare'&&currentSupplyDraft" class="tour-exact-id">
      本轮原草稿编号：<strong>{{ currentSupplyDraft.id }}</strong> · 仅按此编号核算
     </div>
     <div class="tour-buttons">
      <NButton size="small" secondary :disabled="record.step===0" @click="previous">上一步</NButton>
      <NButton size="small" type="primary" :disabled="!target" @click="gotoCurrent">{{ correctLocation?'仍在本步页面':'进入本步页面' }}</NButton>
      <NButton size="small" secondary :disabled="record.step===definition.steps.length-1" @click="next">下一步 ›</NButton>
     </div>
     <button type="button" class="tour-stop" @click="stop">结束导览，保留本地业务操作结果</button>
    </div>
   </template>
   <div v-else class="tour-mini-row">
    <button type="button" class="tour-mini-detail" @click="refresh();tour.minimized=false">
      <span>{{ step.name }}</span>
      <small :class="{done:status.complete}">{{ status.complete?'业务结果已核验':'查看讲解与操作状态' }}</small>
    </button>
    <button v-if="status.complete&&record.step<definition.steps.length-1"
      type="button" class="tour-mini-next" aria-label="当前步骤已完成，进入下一步"
      @click="next">下一步 ›</button>
   </div>
  </aside>
 </Teleport>
</template>

<style scoped>
.tour-picker-scrim{position:fixed;z-index:3600;inset:0;background:#0b223c80;display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(3px)}
.tour-picker{width:min(810px,100%);max-height:92vh;overflow-y:auto;border:1px solid #bedfeb;border-radius:14px;background:#f6fbfe;box-shadow:0 25px 80px #001b4060;display:grid;gap:16px;padding:24px;color:#285875}
.tour-picker-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.tour-picker-head small{color:#5591a9;letter-spacing:.06em;font-size:11px}
.tour-picker-head h2{margin:6px 0;font-size:22px;color:#1c506c}
.tour-picker-head p{font-size:12px;line-height:1.65;color:#7896a7;margin:0;max-width:630px}
.tour-x{border:0;background:#e8f3f8;color:#598096;border-radius:8px;font-size:22px;line-height:1;width:32px;height:32px;cursor:pointer}
.tour-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tour-option{display:flex;flex-direction:column;align-items:flex-start;gap:12px;text-align:left;border:1px solid #d2e5ee;background:#fff;border-radius:10px;padding:17px;color:#456e83;cursor:pointer;min-height:232px}
.tour-option:hover{border-color:#62abc9;box-shadow:0 7px 25px #268ab31a;transform:translateY(-1px)}
.tour-option-top{display:flex;justify-content:space-between;align-items:center;width:100%;gap:8px;color:#6799b1;font-size:10px}
.tour-option-top small{white-space:nowrap}
.tour-option>strong{font-size:18px;color:#20607f}
.tour-option>span:not(.tour-option-top){font-size:12px;line-height:1.6}
.tour-option>em{font-style:normal;color:#9a8a6d;font-size:10px;line-height:1.6}
.tour-option-entry{margin-top:auto;color:#187fa7;font-size:12px}
.tour-picker>footer{color:#96a7b4;font-size:11px}
.tour-dock{position:fixed;z-index:3500;right:16px;bottom:16px;width:min(370px,calc(100vw - 24px));max-height:calc(100dvh - 80px);overflow-y:auto;border:1px solid #9ed4e7;border-radius:12px;background:#f8fcff;box-shadow:0 14px 42px #122d4160;color:#375d74}
.tour-dock.minimized{width:min(318px,calc(100vw - 24px));overflow:hidden;box-shadow:0 6px 25px #122d4140}
.tour-dock-top{background:linear-gradient(110deg,#1d607f,#237d9d);color:#fff;padding:11px 13px;display:flex;justify-content:space-between;gap:10px;align-items:center}
.tour-dock-top>div:first-child{display:grid;gap:2px}
.tour-dock-top small{font-size:10px;color:#b7e6f5}
.tour-dock-top strong{font-size:13px}
.tour-top-actions{display:flex;gap:5px}
.tour-top-actions button{border:1px solid #ffffff55;color:#e5f7ff;background:#ffffff12;border-radius:5px;padding:4px 7px;font-size:11px;cursor:pointer}
.tour-body{padding:13px;display:grid;gap:11px}
.tour-progress{display:flex;gap:5px}
.tour-progress button{flex:1;height:23px;border-radius:4px;border:1px solid #cde3ee;background:#fff;font-size:10px;color:#81a2b5;cursor:pointer}
.tour-progress button.here{background:#2387ac;color:#fff;border-color:#2387ac}
.tour-progress button.past{background:#e7f6fc;color:#3485a3}
.tour-current>span{font-size:10px;color:#91a8b6}
.tour-current h3{font-size:16px;margin:4px 0 8px;color:#226080}
.tour-current p{font-size:12px;line-height:1.75;color:#668499;margin:0}
.tour-proof{display:grid;gap:4px;padding:10px;border:1px solid #e4d7bf;border-radius:6px;background:#fffaf2}
.tour-proof.complete{border-color:#bddfdb;background:#f0f9f6}
.tour-proof span{font-size:10px;color:#969085}.tour-proof strong{font-size:12px;color:#557887}
.tour-guide,.tour-boundary{font-size:11px;line-height:1.7;color:#758fa0}
.tour-boundary{background:#f1f7fa;border-left:2px solid #74b2d0;padding:7px 9px}
.tour-role{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px;color:#7896a9}
.tour-exact-id{font-size:10px;color:#416f83;overflow-wrap:anywhere}
.tour-buttons{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}
.tour-stop{font-size:10px;border:0;background:none;color:#8199a7;text-decoration:underline;cursor:pointer;justify-self:center;padding:6px}
.tour-mini-row{display:flex;align-items:stretch;min-width:0}
.tour-mini-detail{flex:1;display:grid;gap:3px;text-align:left;min-width:0;
  padding:9px 13px;background:transparent;border:0;cursor:pointer;color:#48748d}
.tour-mini-detail span{font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tour-mini-detail small{font-size:10px;color:#7895a7}
.tour-mini-detail small.done{color:#24856e}
.tour-mini-next{flex:none;border:0;border-left:1px solid #c4dfeb;background:#e8f7f3;
  color:#247f72;font-size:11px;font-weight:750;padding:8px 10px;cursor:pointer}
.tour-mini-next:hover{background:#d6f1e9}
.tour-mini-next:focus-visible,.tour-mini-detail:focus-visible{outline:2px solid #247ba8;outline-offset:-2px}
@media(max-width:700px){
 .tour-picker{padding:16px;gap:12px}
 .tour-options{grid-template-columns:1fr}
 .tour-option{min-height:0;gap:7px;padding:12px}
 .tour-picker-head h2{font-size:18px}
 .tour-dock{right:10px;bottom:10px;max-height:72dvh}
}
</style>

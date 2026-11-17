<script setup lang="ts">
import {computed,defineAsyncComponent,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import {NButton,NInput,NSelect,NTag} from "naive-ui";
import {useDemoStore} from "../demo/store";
import {useUnattendedStore} from "../demo/unattendedStore";
import {useUiStore} from "../demo/ui";
import RoleActionQueue from "../components/RoleActionQueue.vue";
import WorkOrderDrawer from "../components/WorkOrderDrawer.vue";
import {buildEventHub,filterHubEvents,type EventHubFilter,type HubEvent,type EventOrigin} from "../demo/eventHub";

const DutyPanel=defineAsyncComponent(()=>import("./UnattendedView.vue"));
const AlarmsPanel=defineAsyncComponent(()=>import("./AlarmsView.vue"));
const CorrelationPanel=defineAsyncComponent(()=>import("./CorrelationView.vue"));
type WorkTab="queue"|"duty"|"alarms"|"correlation";
const tabs:readonly {value:WorkTab;label:string;hint:string}[]=[
 {value:"queue",label:"全部事件",hint:"跨来源待办"},
 {value:"duty",label:"值守巡查",hint:"规则与异常"},
 {value:"alarms",label:"生产告警",hint:"告警受理"},
 {value:"correlation",label:"协同核查",hint:"关联与证据"},
];
function validTab(v:unknown):v is WorkTab {
 return v==="queue"||v==="duty"||v==="alarms"||v==="correlation";
}
const route=useRoute(),router=useRouter(),demo=useDemoStore(),duty=useUnattendedStore(),ui=useUiStore();
const tab=computed<WorkTab>(()=>validTab(route.query.tab)?route.query.tab:"queue");
const index=computed(()=>buildEventHub(demo.alarms,duty.events,demo.assets,demo.workorders));
const selectedRef=ref(typeof route.query.eventRef==="string"?route.query.eventRef:"");
const state=ref<EventHubFilter>("open");
const origin=ref<"all"|EventOrigin>("all");
const keyword=ref("");
const stateOptions=[
 {label:"待处理 / 待核查",value:"open"},
 {label:"全部记录",value:"all"},
 {label:"已关闭 / 归档",value:"closed"},
];
const originOptions=[
 {label:"全部来源",value:"all"},
 {label:"生产与业务告警",value:"alarm"},
 {label:"智能巡查",value:"duty"},
];
const assetScope=computed(()=>typeof route.query.assetId==="string"&&demo.getAsset(route.query.assetId)?route.query.assetId:"");
const scopedAsset=computed(()=>assetScope.value?demo.getAsset(assetScope.value):undefined);
const visibleSummary=computed(()=>{
 const rows=index.value.events.filter(e=>!assetScope.value||e.assetId===assetScope.value);
 const active=rows.filter(e=>e.active);
 return {
  open:active.length,
  alarms:active.filter(e=>e.origin==="alarm").length,
  duty:active.filter(e=>e.origin==="duty").length,
  assetCount:new Set(active.map(e=>e.assetId)).size,
 };
});
const filtered=computed(()=>filterHubEvents(index.value.events,state.value,origin.value,keyword.value)
 .filter(e=>!assetScope.value||e.assetId===assetScope.value));
const selected=computed(()=>filtered.value.find(x=>x.ref===selectedRef.value)??filtered.value[0]??null);
const related=computed(()=>selected.value?
 index.value.events.filter(x=>x.assetId===selected.value?.assetId&&x.ref!==selected.value?.ref):[]);
const selectedOrder=computed(()=>demo.workorders.find(x=>x.id===selected.value?.workOrderId));
const inlineWorkOrderId=ref<string|null>(null);
const closureTip=computed(()=>{
 if(!selected.value)return "";
 if(selectedOrder.value?.status==="archived"&&selected.value.active)
   return "工单已归档，但原事件尚未独立关闭。下一步应核查测点、设备状态及现场恢复证据，再由有权限人员确认事件。";
 if(selectedOrder.value?.status==="pending_acceptance")
   return "维修结果已提交，等待具备验收权限的人员确认；验收通过后仍需单独核实原事件。";
 if(selectedOrder.value)return "当前事件已经关联工单，可在本页打开工单抽屉办理，无需离开事件上下文。";
 return "当前事件尚无已确认的关联工单，可先核查设备与原始记录，再按权限建立处理任务。";
});
const eventTimeline=computed(()=>{
  if(!selected.value)return [];
  const lines=[{at:selected.value.at,action:"原始事件产生",by:"监测 / 业务记录",note:selected.value.description}];
  if(selectedOrder.value){
    lines.push(...selectedOrder.value.history.map(x=>({
      at:x.at,action:x.action,by:x.by,note:x.note||"工单流程记录"
    })));
  }
  return lines.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
});
watch(()=>route.query.eventRef,refValue=>{
 if(typeof refValue==="string"){
  selectedRef.value=refValue;
  const event=index.value.events.find(x=>x.ref===refValue);
  if(event&&!event.active)state.value="all";
 }
},{immediate:true});
function clearAssetScope(){
 const query={...route.query};
 delete query.assetId;
 void router.replace({path:route.path,query});
}
function select(e:HubEvent){
 selectedRef.value=e.ref;
 void router.replace({path:route.path,query:{...route.query,tab:"queue",eventRef:e.ref}});
}
function changeTab(next:WorkTab){
 const query:Record<string,string>={tab:next};
 if(assetScope.value)query.assetId=assetScope.value;
 const e=selected.value;
 if(e&&next==="alarms"&&e.origin==="alarm")query.alarmId=e.originalId;
 if(e&&next==="duty"&&e.origin==="duty")query.eventId=e.originalId;
 if(e){query.eventRef=e.ref;if(next!=="queue")query.assetId=e.assetId;}
 void router.push({path:"/operations/events",query});
}
function openInWorkflow(e:HubEvent){
 void router.push({path:"/operations/events",query:{
  tab:e.origin==="alarm"?"alarms":"duty",
  ...(e.origin==="alarm"?{alarmId:e.originalId}:{eventId:e.originalId}),
  eventRef:e.ref,
 }});
}
function openOrder(e:HubEvent){
 if(!e.workOrderId||e.isMissingWorkOrder)return;
 inlineWorkOrderId.value=e.workOrderId;
}
function openOrderWorkspace(e:HubEvent){
 if(!e.workOrderId||e.isMissingWorkOrder)return;
 void router.push({path:"/operations/workorders",query:{
  workOrderId:e.workOrderId,returnTo:"/operations/events?tab=queue&eventRef="+encodeURIComponent(e.ref),
 }});
}
function openEmergency(e:HubEvent){
 void router.push({path:"/operations/emergency",query:{
  ...(e.origin==="alarm"?{alarmId:e.originalId}:{}),
  returnTo:route.fullPath,
 }});
}
function openAsset(e:HubEvent){ if(demo.getAsset(e.assetId))ui.openAsset(e.assetId); }
function goAssetWorkspace(e:HubEvent){
 if(!demo.getAsset(e.assetId))return;
 void router.push({path:"/operations/asset-workspace",query:{assetId:e.assetId,tab:"events"}});
}
function detailTag(e:HubEvent){return !e.active?"default":e.severity==="critical"?"error":e.severity==="warning"?"warning":"info";}
function timestamp(v:string){
 const time=Date.parse(v);
 return Number.isFinite(time)?new Date(time).toLocaleString("zh-CN",{hour12:false}):"时间无效";
}
</script>

<template>
 <section class="event-center">
  <div class="hub-intro">
   <div>
    <span class="hub-eyebrow">运行中心 / 统一事件工作台</span>
    <h2>事件汇总与业务处置</h2>
    <p>一个入口处理生产告警、智能巡查与跨系统协同；原事件、状态和证据各自保留，不凭时间接近推定共同故障。</p>
   </div>
   <NTag size="small" type="warning">DEMO · 非现场24小时监护</NTag>
  </div>
  <RoleActionQueue />
  <div class="hub-stats" aria-label="当前事件概况">
   <div><span>未闭环事件</span><strong>{{ visibleSummary.open }}</strong><small>含已确认未关闭；独立于岗位可办理数</small></div>
   <div><span>告警与业务提醒</span><strong>{{ visibleSummary.alarms }}</strong><small>含业务提醒</small></div>
   <div><span>值守事件</span><strong>{{ visibleSummary.duty }}</strong><small>仅已产生的巡查事件</small></div>
   <div><span>涉及设备</span><strong>{{ visibleSummary.assetCount }}</strong><small>按设备去重展示，不合并业务事件</small></div>
  </div>
  <nav class="hub-tabs" aria-label="运行中心工作区">
   <button v-for="t in tabs" :key="t.value" type="button"
     :class="{selected:tab===t.value}" :aria-current="tab===t.value?'page':undefined"
     @click="changeTab(t.value)"><strong>{{ t.label }}</strong><small>{{ t.hint }}</small></button>
  </nav>

  <template v-if="tab==='queue'">
   <div v-if="scopedAsset" class="hub-scope">
    <strong>当前设备：{{ scopedAsset.code }} · {{ scopedAsset.name }}</strong>
    <span>仅展示当前设备关联的告警和值守记录，不自动判定共同根因</span>
    <NButton size="tiny" secondary @click="clearAssetScope">查看全部事件</NButton>
   </div>
   <div class="hub-filter">
    <NSelect v-model:value="state" :options="stateOptions" size="small" aria-label="处理状态筛选"/>
    <NSelect v-model:value="origin" :options="originOptions" size="small" aria-label="事件来源筛选"/>
    <NInput v-model:value="keyword" size="small" clearable placeholder="搜索事件、设备、编号或工单" aria-label="搜索事件"/>
   </div>
   <div class="hub-columns">
    <section class="hub-list" aria-label="统一事件队列">
     <div class="hub-panel-head"><strong>事件队列</strong><span>{{ filtered.length }} 条 · 记录来源明确</span></div>
     <div v-if="!filtered.length" class="hub-empty">当前筛选下没有事件。没有记录不代表现场无故障；仅反映当前模拟数据。</div>
     <div v-else class="hub-items">
      <button v-for="e in filtered" :key="e.ref" type="button"
        class="hub-event-row" :class="{active:selected?.ref===e.ref}" @click="select(e)">
       <span class="row-head"><b>{{ e.title }}</b><NTag size="tiny" :type="detailTag(e)">{{ e.statusLabel }}</NTag></span>
       <span class="row-meta"><span>{{ e.sourceName }}</span> · {{ e.assetLabel }}</span>
       <span class="row-footer"><span>{{ e.originalId }} · {{ timestamp(e.at) }}</span><span v-if="e.workOrderCode">工单 {{ e.workOrderCode }}</span></span>
      </button>
     </div>
    </section>
    <section class="hub-detail" aria-label="事件关联与处理">
     <div class="hub-panel-head"><strong>事件详情与操作</strong><span>保留原始证据</span></div>
     <template v-if="selected">
      <div class="hub-detail-body">
       <div class="detail-top">
        <span class="hub-eyebrow">{{ selected.sourceName }} · {{ selected.originalId }}</span>
        <h3>{{ selected.title }}</h3>
        <div class="detail-badges">
         <NTag size="small" :type="detailTag(selected)">{{ selected.statusLabel }}</NTag>
         <NTag size="small" :type="selected.active?'warning':'default'">{{ selected.active?"待处理/核查":"已归档" }}</NTag>
        </div>
       </div>
       <dl class="hub-dl">
        <div><dt>关联设备</dt><dd>{{ selected.assetLabel }}</dd></div>
        <div><dt>工艺系统</dt><dd>{{ demo.subsystems.find(s=>s.id===selected?.subsystemId)?.name??selected.subsystemId }}</dd></div>
        <div><dt>发生 / 采样时间</dt><dd>{{ timestamp(selected.at) }}</dd></div>
        <div><dt>原始状态</dt><dd>{{ selected.statusLabel }}（{{ selected.status }}）</dd></div>
        <div><dt>工单引用</dt><dd>{{ selected.workOrderId ? (selected.workOrderCode??"原工单不可用") : "尚未关联" }}</dd></div>
       </dl>
       <div class="hub-description"><strong>原始事件描述</strong><p>{{ selected.description }}</p></div>
       <div class="hub-caution">事件队列只汇总展示，不修改原始告警或值守状态。跨工艺关联属于待核线索，必须经工程证据复核。</div>
       <div class="hub-actions">
        <NButton type="primary" size="small" @click="openInWorkflow(selected)">在本工作台处理原事件</NButton>
        <NButton size="small" secondary :disabled="!selected.workOrderId||selected.isMissingWorkOrder" @click="openOrder(selected)">本页办理关联工单</NButton>
        <NButton size="small" quaternary :disabled="!selected.workOrderId||selected.isMissingWorkOrder" @click="openOrderWorkspace(selected)">完整工单页面</NButton>
        <NButton size="small" secondary :disabled="!demo.getAsset(selected.assetId)" @click="goAssetWorkspace(selected)">设备工作台</NButton>
        <NButton size="small" secondary :disabled="!demo.getAsset(selected.assetId)" @click="openAsset(selected)">快速设备详情</NButton>
        <NButton size="small" secondary @click="openEmergency(selected)">发起应急协同（草稿）</NButton>
        <NButton size="small" quaternary @click="changeTab('correlation')">查看协同核查</NButton>
       </div>
       <div class="hub-closure" aria-label="当前事件的下一步处理">
        <strong>下一步处理建议</strong>
        <p>{{closureTip}}</p>
        <NButton v-if="selectedOrder?.status==='archived'&&selected.active" size="small" type="primary"
          secondary @click="openInWorkflow(selected)">返回原事件，核查是否恢复</NButton>
       </div>
       <div class="hub-related">
        <strong>事件与工单时间线（{{ eventTimeline.length }}）</strong>
        <p>事件状态与工单状态独立，工单已归档不代表现场测点恢复或告警自动关闭。</p>
        <ol aria-label="事件处理时间线">
          <li v-for="item in eventTimeline" :key="item.at+'-'+item.action">
            <b>{{ timestamp(item.at) }} · {{ item.action }}</b>
            <span> · {{ item.by }} · {{ item.note }}</span>
          </li>
        </ol>
       </div>
       <div class="hub-related">
        <strong>同设备其他记录（{{ related.length }}）</strong>
        <p>仅表示设备相同，可能来自不同时间和规则；不会自动合并为同一事件或重复创建工单。</p>
        <button v-for="item in related.slice(0,6)" :key="item.ref" class="hub-related-row" @click="select(item)">
         {{ item.sourceName }} · {{ item.originalId }} · {{ item.title }}
        </button>
       </div>
      </div>
     </template>
     <div v-else class="hub-empty">请选择需要核查的事件。</div>
    </section>
   </div>
  </template>
  <DutyPanel v-else-if="tab==='duty'" embedded />
  <AlarmsPanel v-else-if="tab==='alarms'" />
  <CorrelationPanel v-else embedded />
  <WorkOrderDrawer :work-order-id="inlineWorkOrderId" @close="inlineWorkOrderId=null" />
 </section>
</template>

<style scoped>
.event-center{display:grid;gap:14px;min-width:0;color:#345d75}
.hub-intro{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:linear-gradient(110deg,#edf8fd,#fff 70%);border:1px solid #dae9f1;border-radius:10px;padding:14px 18px}
.hub-eyebrow{font-size:10px;letter-spacing:.06em;color:#7c9fb2}
.hub-intro h2{margin:3px 0 4px;color:#194e6f;font-size:20px}
.hub-intro p{font-size:11px;color:#7895a9;line-height:1.65;margin:0}
.hub-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.hub-stats>div{background:#fff;border:1px solid #dce8ee;border-radius:8px;padding:13px;display:grid;gap:5px}
.hub-stats span{font-size:12px;color:#7692a5}.hub-stats strong{font-size:24px;color:#236e94}.hub-stats small{font-size:10px;color:#97adba}
.hub-tabs{display:flex;gap:7px;flex-wrap:wrap;padding:6px;border:1px solid #deebf1;background:#f7fbfd;border-radius:9px}
.hub-tabs button{flex:1;min-width:105px;display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;background:#fff;border:1px solid #e1ebf0;border-radius:6px;padding:10px 13px;color:#557f96;cursor:pointer}
.hub-tabs button.selected{border-color:#7ac0dd;background:#e6f6fc;color:#176b93;box-shadow:inset 3px 0 0 #2b8baf}
.hub-tabs strong{font-size:12px}.hub-tabs small{font-size:10px;color:#89a6b5}
.hub-filter{display:grid;grid-template-columns:190px 190px minmax(160px,1fr);gap:10px}
.hub-columns{display:grid;grid-template-columns:minmax(280px,43%) minmax(0,1fr);gap:12px;align-items:start;min-width:0}
.hub-list,.hub-detail{border:1px solid #dce9f1;border-radius:9px;background:#fff;min-width:0;overflow:hidden}
.hub-panel-head{padding:13px 15px;display:flex;justify-content:space-between;gap:8px;align-items:center;border-bottom:1px solid #edf2f6}
.hub-panel-head strong{font-size:13px;color:#315c78}.hub-panel-head span{font-size:10px;color:#9aafba}
.hub-items{max-height:690px;overflow-y:auto}
.hub-event-row{display:grid;gap:7px;width:100%;text-align:left;border:0;border-bottom:1px solid #e9f0f4;padding:13px 15px;background:#fff;color:#3b6077;cursor:pointer}
.hub-event-row:hover{background:#f7fbfd}.hub-event-row.active{background:#edf8fc;box-shadow:inset 3px 0 0 #369ac5}
.row-head{display:flex;align-items:start;justify-content:space-between;gap:8px}
.row-head b{font-size:12px;line-height:1.5}.row-meta{font-size:11px;color:#7195a9;line-height:1.5}
.row-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:10px;color:#94aebc}
.hub-detail-body{padding:15px;display:grid;gap:15px}
.detail-top h3{margin:6px 0;font-size:17px;color:#194e6e}.detail-badges{display:flex;gap:8px}
.hub-dl{display:grid;gap:0;margin:0}
.hub-dl>div{display:grid;grid-template-columns:105px minmax(0,1fr);gap:10px;padding:9px 0;border-bottom:1px dashed #e3ecf1;font-size:11px}
.hub-dl dt{color:#819fae}.hub-dl dd{margin:0;overflow-wrap:anywhere}
.hub-description{background:#f7fbfd;border-radius:6px;padding:12px;font-size:11px}
.hub-description p{margin:6px 0 0;line-height:1.7;overflow-wrap:anywhere}
.hub-closure{padding:11px 13px;border:1px solid #c7e3ef;border-radius:8px;background:#edf8fd}
.hub-closure strong{font-size:12px;color:#1c688c}
.hub-closure p{font-size:11px;color:#426e83;line-height:1.7;margin:6px 0}
.hub-caution{color:#9a763b;border:1px solid #f1e6d4;background:#fffaf2;padding:10px;border-radius:6px;font-size:11px;line-height:1.6}
.hub-actions{display:flex;gap:8px;flex-wrap:wrap}
.hub-related{display:grid;gap:8px;padding-top:5px;border-top:1px solid #eef2f5;font-size:11px}
.hub-related p{margin:0;color:#8ba2b1;line-height:1.6}
.hub-related-row{text-align:left;padding:8px 10px;background:#f5fafd;border:1px solid #e0ebf0;border-radius:5px;color:#42748e;cursor:pointer}
.hub-empty{padding:22px;font-size:12px;color:#8aa4b4}
@media(max-width:1000px){.hub-columns{grid-template-columns:1fr}.hub-items{max-height:350px}}
@media(max-width:720px){.hub-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.hub-filter{grid-template-columns:1fr}.hub-tabs button{min-width:120px}}
.hub-scope{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#eef8fc;border:1px solid #cde7f2;padding:9px 12px;border-radius:7px;font-size:11px}
.hub-scope strong{color:#236a8c}.hub-scope span{color:#7c9bad;flex:1}
</style>

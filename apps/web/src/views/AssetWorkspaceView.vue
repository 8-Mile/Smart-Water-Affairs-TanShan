<script setup lang="ts">
import {computed,ref,watch} from "vue";
import {RouterLink,useRoute,useRouter,onBeforeRouteLeave} from "vue-router";
import {NButton,NCheckbox,NInput,NTag,useDialog,useMessage} from "naive-ui";
import Chart from "../Chart.vue";
import WorkOrderDrawer from "../components/WorkOrderDrawer.vue";
import {useDemoStore} from "../demo/store";
import {useUnattendedStore} from "../demo/unattendedStore";
import {can,roleNames} from "../demo/permissions";
import {alarmOrder,inspectionOrder,nextInspectionId,validateInspection,type InspectionCheck} from "../demo/assetWorkspace";
import {isPumpAsset,scorePumpHealth} from "../demo/health";
import {alarmLevelLabels,alarmStatusLabels,workOrderStatusLabels,workOrderStatusTagType,workOrderPriorityLabels,workOrderUpdatedAt,formatDateTime} from "../demo/workorderMeta";
import type {Alarm,InspectionRecord,MeasurePoint} from "../demo/types";

type WorkspaceTab="monitor"|"events"|"inspection"|"documents";
const WORKSPACE_TABS:{id:WorkspaceTab;label:string;hint:string}[]=[
 {id:"monitor",label:"状态与监测",hint:"测点、健康"},
 {id:"events",label:"异常与工单",hint:"确认、转单、办理"},
 {id:"inspection",label:"巡检与履历",hint:"登记、追溯"},
 {id:"documents",label:"设备档案",hint:"审核、版本"},
];
const store=useDemoStore(),duty=useUnattendedStore(),route=useRoute(),router=useRouter(),message=useMessage();
const dialog=useDialog();
const requestedId=computed(()=>typeof route.query.assetId==="string"?route.query.assetId:"");
const assetId=computed(()=>requestedId.value||store.assets.find(a=>!a.archived)?.id||"");
const asset=computed(()=>store.getAsset(assetId.value));
const isUnknown=computed(()=>!!requestedId.value&&!asset.value);
const tab=computed<WorkspaceTab>(()=>WORKSPACE_TABS.find(t=>t.id===route.query.tab)?.id??"monitor");
const search=ref("");
const assetOptions=computed(()=>store.assets.filter(a=>
 !search.value.trim()||[a.code,a.name,a.type,store.subsystems.find(s=>s.id===a.subsystemId)?.name??""]
   .join(" ").toLowerCase().includes(search.value.trim().toLowerCase())));
const subsystemName=computed(()=>store.subsystems.find(s=>s.id===asset.value?.subsystemId)?.name??"工艺未登记");
const allPoints=computed(()=>asset.value?store.getPoints(asset.value.id):[]);
const numericalPoints=computed(()=>allPoints.value.filter(p=>p.kind==="number"));
const selectedPointId=ref("");
const selectedPoint=computed(()=>numericalPoints.value.find(p=>p.id===selectedPointId.value)??numericalPoints.value[0]);
const alarms=computed(()=>store.alarms.filter(x=>x.assetId===assetId.value)
 .slice().sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)));
const dutyEvents=computed(()=>duty.events.filter(x=>x.assetId===assetId.value)
 .slice().sort((a,b)=>Date.parse(b.lastSeen)-Date.parse(a.lastSeen)));
const orders=computed(()=>store.workorders.filter(x=>x.assetId===assetId.value)
 .slice().sort((a,b)=>Date.parse(workOrderUpdatedAt(b))-Date.parse(workOrderUpdatedAt(a))));
const inspections=computed(()=>store.inspections.filter(x=>x.assetId===assetId.value)
 .slice().sort((a,b)=>Date.parse(b.inspectedAt)-Date.parse(a.inspectedAt)));
const docs=computed(()=>store.documents.filter(d=>d.assetIds.includes(assetId.value))
 .slice().sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)));
const history=computed(()=>asset.value?store.timeline(asset.value.id):[]);
const historyLimit=ref(8);
const activeAlarmCount=computed(()=>alarms.value.filter(x=>x.status!=="closed").length);
const activeOrderCount=computed(()=>orders.value.filter(x=>x.status!=="cancelled"&&x.status!=="archived").length);
const lastInspection=computed(()=>inspections.value[0]);
const statusNames:Record<string,string>={running:"运行",stopped:"停机",fault:"故障",unknown:"未知"};
const qualityNames:Record<string,string>={valid:"有效",missing:"缺失",estimated:"估算",invalid:"无效"};
const originNames:Record<string,string>={MOCK:"模拟",REFERENCE:"资料",USER_ENTRY:"人工录入",CALCULATED:"规则计算"};
const canCreate=computed(()=>can(store.role,"workorder:create"));
const canHandle=computed(()=>can(store.role,"workorder:handle"));
const canAck=computed(()=>can(store.role,"alarm:ack"));
const selectedOrderId=ref<string|null>(null);
const showInspectionForm=ref(false);
const inspectionError=ref("");
const inspectionNote=ref("");
const inspectionItems=ref<InspectionCheck[]>([]);
const expandedInspection=ref<string|null>(null);
const expandedDoc=ref<string|null>(null);

function defaults():InspectionCheck[]{
 return asset.value&&isPumpAsset(asset.value)?
  [{label:"外观与异响",value:"",abnormal:false},{label:"温度/振动",value:"",abnormal:false},{label:"密封渗漏",value:"",abnormal:false}]:
  [{label:"设备外观",value:"",abnormal:false},{label:"运行/环境状态",value:"",abnormal:false}];
}
watch(assetId,()=>{
 selectedOrderId.value=null;
 showInspectionForm.value=false;
 inspectionItems.value=defaults();
 selectedPointId.value=numericalPoints.value[0]?.id??"";
 expandedInspection.value=null;
 expandedDoc.value=null;
 historyLimit.value=8;
},{immediate:true});

function inspectionHasUnsavedEdits():boolean{
 if(!showInspectionForm.value)return false;
 const baseline=defaults();
 return !!inspectionNote.value.trim()||
  inspectionItems.value.some((item,i)=>item.abnormal||!!item.value.trim()||item.label!==baseline[i]?.label);
}
function confirmDiscard(onAccept:()=>void):void{
 dialog.warning({
  title:"巡检记录尚未保存",
  content:"切换设备或离开工作台会丢失当前填写的检查项。可返回继续编辑，或明确丢弃。",
  positiveText:"丢弃并继续",
  negativeText:"继续编辑",
  closable:false,
  maskClosable:false,
  onPositiveClick:onAccept,
 });
}
onBeforeRouteLeave(()=>{
 if(!inspectionHasUnsavedEdits())return true;
 return new Promise<boolean>(resolve=>{
  dialog.warning({
   title:"巡检记录尚未保存",
   content:"离开设备工作台会丢失当前填写的检查项。确认要丢弃吗？",
   positiveText:"丢弃并离开",
   negativeText:"继续编辑",
   closable:false,maskClosable:false,
   onPositiveClick:()=>resolve(true),
   onNegativeClick:()=>resolve(false),
  });
 });
});
function changeAsset(id:string):void{
 if(!store.getAsset(id)||id===assetId.value)return;
 const proceed=()=>{void router.push({path:"/operations/asset-workspace",query:{assetId:id,tab:"monitor"}});};
 if(inspectionHasUnsavedEdits())confirmDiscard(proceed);
 else proceed();
}
function changeTab(next:WorkspaceTab):void{
 void router.replace({path:route.path,query:{...route.query,tab:next}});
}
const readings=computed(()=>{
 const find=(key:string,label:string):number|null=>{
  const point=allPoints.value.find(p=>p.kind==="number"&&
   (p.id.endsWith("-"+key)||p.label.includes(label)));
  if(!point)return null;
  const sample=store.latest(point.id);
  return sample?.quality==="valid"&&typeof sample.value==="number"&&Number.isFinite(sample.value)?sample.value:null;
 };
 return {vibration:find("vibration","振动"),temperature:find("temperature","温度"),current:find("current","电流")};
});
const health=computed(()=>asset.value&&isPumpAsset(asset.value)?
 scorePumpHealth({asset:asset.value,readings:readings.value,runtimeHours:asset.value.runtimeHours,
  startCount:asset.value.startCount,asOf:store.seed.referenceTime}):null);
function sample(point:MeasurePoint){return store.latest(point.id);}
function latestValue(point:MeasurePoint):string{
 const v=sample(point);
 if(!v||v.quality!=="valid")return "缺数 / 未核验";
 return v.value===null?"无值":String(v.value);
}
const trend=computed(()=>{
 const p=selectedPoint.value;
 if(!p)return {labels:[] as string[],values:[] as (number|null)[]};
 const end=Date.parse(store.seed.referenceTime);
 const points=store.series(p.id,new Date(end-24*3600_000).toISOString(),store.seed.referenceTime);
 return {
  labels:points.map(s=>new Date(s.at).toLocaleTimeString("zh-CN",{hour12:false,hour:"2-digit",minute:"2-digit"})),
  values:points.map(s=>s.quality==="valid"&&typeof s.value==="number"&&Number.isFinite(s.value)?s.value:null),
 };
});
const chartSeries=computed(()=>selectedPoint.value?[{
 name:selectedPoint.value.label,values:trend.value.values,unit:selectedPoint.value.unit??"",
}]:[]);
function alarmLink(a:Alarm){return alarmOrder(a,store.workorders);}
function acknowledge(a:Alarm):void{
 if(!canAck.value||a.status!=="active")return;
 try{store.ackAlarm(a.id);message.success("已确认原始告警，记录已留痕；不代表现场故障消失。");}
 catch(error){message.error((error as Error).message);}
}
function openOrder(id:string|null):void{
 if(!id||!store.workorders.some(o=>o.id===id))return;
 selectedOrderId.value=id;
}
function makeAlarmOrder(a:Alarm):void{
 if(!canCreate.value)return;
 const linked=alarmLink(a);
 if(linked.id){
  if(linked.exists)openOrder(linked.id);
  else message.warning("原告警关联工单ID已失效，不能绕过引用再建第二张工单。");
  return;
 }
 try{
  const order=store.createWorkOrder({
   assetId:a.assetId,alarmId:a.id,source:"alarm",title:"故障核查："+a.title,
   symptom:a.detail,suggestion:"核对原告警测点和设备工况，现场复测后明确处理措施。",
   priority:a.level==="critical"?"high":"medium",
   evidenceIds:[a.id],createdBy:roleNames[store.role]+"（模拟）",
  });
  selectedOrderId.value=order.id;
  message.success("已创建与该告警关联的工单草稿，不自动派单。");
 }catch(err){message.error((err as Error).message);}
}
function showNewInspection():void{
 if(!canHandle.value)return;
 inspectionItems.value=defaults();
 inspectionNote.value="";
 inspectionError.value="";
 showInspectionForm.value=true;
}
function addItem():void{inspectionItems.value.push({label:"",value:"",abnormal:false});}
function removeItem(i:number):void{if(inspectionItems.value.length>1)inspectionItems.value.splice(i,1);}
function saveInspection():void{
 if(!asset.value||!canHandle.value)return;
 inspectionError.value="";
 try{
  const validated=validateInspection(asset.value.id,store.seed.referenceTime,inspectionItems.value,inspectionNote.value);
  const id=nextInspectionId(store.inspections);
  store.addInspection({id,inspector:roleNames[store.role]+"（模拟）",...validated});
  showInspectionForm.value=false;
  expandedInspection.value=id;
  message.success("巡检已写入当前设备履历；异常项不会自动派工。");
 }catch(err){inspectionError.value=(err as Error).message;}
}
function linkedInspectionOrder(record:InspectionRecord){return inspectionOrder(record.id,store.workorders);}
function makeInspectionOrder(record:InspectionRecord):void{
 if(record.result!=="abnormal"||!canCreate.value)return;
 const existing=linkedInspectionOrder(record);
 if(existing){openOrder(existing);return;}
 const abnormal=record.items.filter(i=>i.abnormal);
 if(!abnormal.length)return;
 try{
  const order=store.createWorkOrder({
   title:"巡检异常："+abnormal[0].label,assetId:record.assetId,source:"inspection",
   symptom:"巡检 "+record.id+" 记录异常："+abnormal.map(i=>i.label+"（"+i.value+"）").join("；"),
   suggestion:"检查对应测点与现场运行状态，形成书面维修措施并复核。",
   priority:"medium",evidenceIds:[record.id],createdBy:roleNames[store.role]+"（模拟）",
  });
  selectedOrderId.value=order.id;
  message.success("已生成巡检关联工单草稿，不自动提交派工。");
 }catch(err){message.error((err as Error).message);}
}
const tagTone=(a:Alarm)=>a.level==="critical"?"error" as const:a.level==="warning"?"warning" as const:"info" as const;
const text=(v:string|number|undefined|null)=>v===undefined||v===null||v===""?"未提供":String(v);
</script>

<template>
 <section class="asset-workspace">
  <div class="workspace-head">
   <div>
    <p class="eyebrow">设备运维 / 单设备业务工作台</p>
    <h2>单设备运行与运维</h2>
    <p>围绕同一设备连续核查测点、告警、工单、巡检与原始档案；办理动作沿用原权限和留痕。</p>
   </div>
   <NTag type="warning" size="small">MOCK · 未对接现场控制</NTag>
  </div>
  <div class="workspace-layout">
   <aside class="asset-side" aria-label="设备选择">
    <div class="side-top"><strong>设备目录</strong><span>{{ assetOptions.length }}/{{ store.assets.length }}</span></div>
    <NInput v-model:value="search" size="small" clearable placeholder="搜索编号 / 名称 / 工艺"/>
    <div class="asset-choices">
     <button v-for="item in assetOptions" :key="item.id" type="button" class="asset-choice"
       :class="{active:item.id===assetId}" :aria-pressed="item.id===assetId" @click="changeAsset(item.id)">
      <span><strong>{{ item.code }}</strong><small>{{ item.name }}</small></span>
      <NTag size="tiny" :type="item.status==='fault'?'error':item.status==='running'?'success':'default'">{{ statusNames[item.status] }}</NTag>
     </button>
     <p v-if="!assetOptions.length" class="empty-hint">没有匹配设备，请调整搜索条件。</p>
    </div>
    <div class="side-bottom"><RouterLink to="/operations/assets">完整设备台账与配置</RouterLink></div>
   </aside>

   <div v-if="isUnknown" class="workspace-main invalid-asset" role="alert">
    <h3>设备编号不可用</h3>
    <p>当前链接中的设备 {{ requestedId }} 不存在，已停止加载其告警、工单和档案，避免误显示其他设备数据。</p>
    <NButton secondary @click="changeAsset(store.assets[0]?.id??'')">重新选择设备</NButton>
   </div>
   <div v-else-if="asset" class="workspace-main">
    <div class="asset-banner">
     <div class="asset-identity">
      <p class="eyebrow">{{ subsystemName }} · {{ asset.area==='north'?'北区':'南区' }} · {{ originNames[asset.source] }}</p>
      <h3>{{ asset.code }} <span>{{ asset.name }}</span></h3>
      <p>{{ text(asset.type) }} · {{ text(asset.model) }} · {{ text(asset.manufacturer) }}</p>
     </div>
     <div class="banner-tags">
      <NTag size="small" :type="asset.status==='fault'?'error':asset.status==='running'?'success':'default'">{{ statusNames[asset.status] }}</NTag>
      <NTag v-if="asset.archived" size="small">已退役</NTag>
      <RouterLink :to="{path:'/operations/assets',query:{assetId:asset.id}}" class="text-link">设备完整台账</RouterLink>
     </div>
    </div>

    <div class="kpi-row" aria-label="当前设备核查指标">
     <button class="kpi" @click="changeTab('monitor')"><span>规则健康度</span><strong>{{ health?.score??'—' }}<small v-if="health?.score!==null&&health?.score!==undefined">分</small></strong><em>{{ health?.band??'非泵类设备不评分' }}</em></button>
     <button class="kpi" @click="changeTab('events')"><span>未关闭告警</span><strong>{{ activeAlarmCount }}</strong><em>含已确认，来源按ID保留</em></button>
     <button class="kpi" @click="changeTab('events')"><span>待办工单</span><strong>{{ activeOrderCount }}</strong><em>独立工单，不重复派单</em></button>
     <button class="kpi" @click="changeTab('inspection')"><span>最近一次巡检</span><strong class="kpi-text">{{ lastInspection?lastInspection.result==='normal'?'正常':'异常':'未记录' }}</strong><em>{{ lastInspection?formatDateTime(lastInspection.inspectedAt):'缺失记录不代表正常' }}</em></button>
    </div>

    <nav class="workspace-tabs" aria-label="设备连续业务操作">
     <button v-for="t in WORKSPACE_TABS" :key="t.id" type="button"
       :class="{active:t.id===tab}" :aria-current="t.id===tab?'page':undefined" @click="changeTab(t.id)">
      <strong>{{ t.label }}</strong><small>{{ t.hint }}</small>
     </button>
    </nav>

    <div v-if="tab==='monitor'" class="workspace-panels">
     <section class="workspace-panel">
      <div class="panel-head"><div><h4>测点与工况</h4><small>最近可用样本 · {{ store.seed.referenceTime.slice(0,16).replace('T',' ') }} 演示时标</small></div>
       <NTag size="tiny" type="warning">MOCK / 来源需现场确认</NTag></div>
      <div v-if="allPoints.length" class="point-grid">
       <button v-for="point in allPoints" :key="point.id" type="button" class="point"
        :class="{selected:selectedPoint?.id===point.id}" @click="selectedPointId=point.id">
        <span>{{ point.label }}</span>
        <strong>{{ latestValue(point) }} <small>{{ point.unit??'' }}</small></strong>
        <small>质量 {{ qualityNames[sample(point)?.quality??'missing'] }} · {{ originNames[sample(point)?.source??point.source] }}</small>
       </button>
      </div>
      <p v-else class="empty-hint">暂无此设备测点，不能推断运行正常。</p>
      <div v-if="selectedPoint" class="chart-wrap">
       <div class="panel-head"><h4>{{ selectedPoint.label }} · 最近24小时</h4><small>仅显示有效样本，缺失不会插值造数</small></div>
       <Chart v-if="trend.values.some(x=>x!==null)" :labels="trend.labels" :series="chartSeries" :height="205"/>
       <p v-else class="empty-hint">该测点没有符合条件的历史数据。</p>
      </div>
     </section>
     <section class="workspace-panel">
      <div class="panel-head"><h4>设备状态与健康依据</h4><RouterLink v-if="health" :to="{path:'/decision/health',query:{assetId:asset.id}}">专业健康趋势</RouterLink></div>
      <template v-if="health">
       <div class="score-box">
        <strong>{{ health.score??'—' }}</strong><div><b>{{ health.band }}</b><small>规则评分 · {{ health.ruleVersion }}</small></div>
       </div>
       <p v-if="health.missingReasons.length" class="limit-hint">缺失项：{{ health.missingReasons.join('；') }}。不输出完整健康分。</p>
       <div v-for="f in health.factors" :key="f.key" class="factor-row"><span>{{ f.label }}</span><strong>{{ f.valid?f.deduction??'—':'缺数' }}</strong><small>{{ f.valid?'规则扣分':'不参与评分' }}</small></div>
       <p class="limit-hint">健康分反映演示规则与当前样本，并非剩余寿命、故障概率或设备实际健康证明。</p>
      </template>
      <p v-else class="empty-hint">非泵类设备不套用主泵健康评分规则。需要相应测点、设备类型及审核过的模型。</p>
      <div class="asset-parameters">
       <div><span>累计运行</span><strong>{{ asset.runtimeHours }} h</strong></div>
       <div><span>启停次数</span><strong>{{ asset.startCount }}</strong></div>
       <div><span>额定功率</span><strong>{{ text(asset.rated?.powerKw) }} kW</strong></div>
       <div><span>额定流量</span><strong>{{ text(asset.rated?.flowM3h) }} m³/h</strong></div>
      </div>
     </section>
    </div>

    <div v-else-if="tab==='events'" class="workspace-panels">
     <section class="workspace-panel">
      <div class="panel-head"><div><h4>设备告警与值守事件</h4><small>原事件记录，不按时间接近推断共同根因</small></div><RouterLink :to="{path:'/operations/events',query:{assetId:asset.id}}">全部核查入口</RouterLink></div>
      <div v-if="alarms.length" class="record-stack">
       <article v-for="alarm in alarms" :key="alarm.id" class="record">
        <div class="record-top"><b>{{ alarm.title }}</b><NTag :type="tagTone(alarm)" size="tiny">{{ alarmLevelLabels[alarm.level] }}</NTag></div>
        <p>{{ alarm.detail }}</p>
        <div class="record-meta">{{ alarm.code }} · {{ formatDateTime(alarm.occurredAt) }} · {{ alarmStatusLabels[alarm.status] }}</div>
        <div class="record-actions">
         <NButton v-if="alarm.status==='active'" size="tiny" secondary :disabled="!canAck" @click="acknowledge(alarm)">确认告警</NButton>
         <NButton v-if="alarmLink(alarm).exists" size="tiny" secondary @click="openOrder(alarmLink(alarm).id)">原关联工单</NButton>
         <NTag v-else-if="alarmLink(alarm).orphaned" type="error" size="tiny">工单引用失效 · 禁止重复建单</NTag>
         <NButton v-else-if="alarm.status!=='closed'" size="tiny" type="primary" :disabled="!canCreate" @click="makeAlarmOrder(alarm)">创建核查工单草稿</NButton>
        </div>
       </article>
      </div>
      <p v-else class="empty-hint">当前数据没有此设备告警；不代表设备已全面监测。</p>
      <div v-if="dutyEvents.length" class="duty-events">
       <h4>值守巡查来源（{{ dutyEvents.length }}）</h4>
       <div v-for="event in dutyEvents" :key="event.id" class="record">
        <div class="record-top"><strong>{{ event.title }}</strong><NTag size="tiny">{{ event.status }}</NTag></div>
        <p>{{ event.detail }}</p><small>{{ event.id }} · {{ formatDateTime(event.lastSeen) }}</small>
        <RouterLink :to="{path:'/operations/events',query:{assetId:asset.id,tab:'duty',eventId:event.id}}">在原值守流程处置</RouterLink>
       </div>
      </div>
     </section>
     <section class="workspace-panel">
      <div class="panel-head"><div><h4>关联工单</h4><small>点击即可在当前页打开办理抽屉</small></div>
       <RouterLink :to="{path:'/operations/workorders',query:{assetId:asset.id}}">工单总表</RouterLink></div>
      <div v-if="orders.length" class="record-stack">
       <button v-for="order in orders" :key="order.id" type="button" class="order-row" @click="openOrder(order.id)">
        <span><b>{{ order.code }}</b><small>{{ order.title }}</small></span>
        <span class="order-status"><NTag size="tiny" :type="workOrderStatusTagType(order.status)">{{ workOrderStatusLabels[order.status] }}</NTag><small>优先级 {{ workOrderPriorityLabels[order.priority] }}</small></span>
       </button>
      </div>
      <p v-else class="empty-hint">该设备没有已记录的工单，不能据此认定无需维修。</p>
      <div class="workflow-note">草稿 → 待派单 → 维修中 → 待验收 → 已归档。原工单权限、原因/措施必填、验收与审计规则保持不变；归档不自动修改设备状态。</div>
     </section>
    </div>

    <div v-else-if="tab==='inspection'" class="workspace-panels">
     <section class="workspace-panel">
      <div class="panel-head"><div><h4>设备巡检</h4><small>检查项人工登记，不自动生成工单</small></div>
       <NButton size="small" type="primary" :disabled="!canHandle||showInspectionForm" @click="showNewInspection">{{ showInspectionForm?'正在登记巡检':'新增巡检记录' }}</NButton></div>
      <p v-if="!canHandle" class="limit-hint">当前角色没有 workorder:handle 权限，仅能查看记录。</p>
      <div v-if="showInspectionForm" class="inspection-form">
       <div class="record-top"><strong>登记设备：{{ asset.code }} · {{ asset.name }}</strong><NButton size="tiny" quaternary @click="showInspectionForm=false">取消</NButton></div>
       <p class="limit-hint">演示巡检时间 {{ formatDateTime(store.seed.referenceTime) }}；每个检查项必须填写结果，异常需明确勾选。</p>
       <div v-for="(item,i) in inspectionItems" :key="i" class="inspection-item">
        <NInput v-model:value="item.label" size="small" placeholder="检查项名称"/>
        <NInput v-model:value="item.value" size="small" placeholder="检查结果（必填）"/>
        <NCheckbox v-model:checked="item.abnormal">异常</NCheckbox>
        <NButton size="tiny" secondary :disabled="inspectionItems.length<=1" @click="removeItem(i)">删</NButton>
       </div>
       <NButton size="small" secondary @click="addItem">添加检查项</NButton>
       <NInput v-model:value="inspectionNote" type="textarea" :rows="2" placeholder="巡检备注，可填写复测情况或现场说明"/>
       <p v-if="inspectionError" class="form-error" role="alert">{{ inspectionError }}</p>
       <NButton type="primary" @click="saveInspection">保存当前设备巡检记录</NButton>
      </div>
      <div v-if="inspections.length" class="record-stack">
       <article v-for="record in inspections.slice(0,15)" :key="record.id" class="record">
        <button class="inspection-expand" @click="expandedInspection=expandedInspection===record.id?null:record.id">
         <b>{{ formatDateTime(record.inspectedAt) }}</b><span>{{ record.inspector }}</span>
         <NTag :type="record.result==='abnormal'?'warning':'success'" size="tiny">{{ record.result==='abnormal'?'有异常':'正常' }}</NTag>
        </button>
        <p v-if="record.result==='abnormal'" class="anomaly-summary">
          异常项：{{ record.items.filter(i=>i.abnormal).map(i=>i.label+'：'+i.value).join('；') || '待复核' }}
        </p>
        <template v-if="expandedInspection===record.id">
         <p v-for="(check,i) in record.items" :key="i" class="check-line">{{ check.label }}：{{ check.value }} <NTag v-if="check.abnormal" size="tiny" type="warning">异常</NTag></p>
         <p v-if="record.note">{{ record.note }}</p>
        </template>
        <div v-if="record.result==='abnormal'" class="record-actions">
         <NButton v-if="linkedInspectionOrder(record)" size="tiny" secondary @click="openOrder(linkedInspectionOrder(record))">查看原关联工单</NButton>
         <NButton v-else type="primary" size="tiny" :disabled="!canCreate" @click="makeInspectionOrder(record)">异常转工单草稿</NButton>
         <span v-if="!canCreate" class="limit-hint">当前角色无建单权限</span>
        </div>
       </article>
      </div>
      <p v-else class="empty-hint">暂无巡检记录。未巡检不代表设备健康。</p>
     </section>
     <section class="workspace-panel">
      <div class="panel-head"><div><h4>运维履历</h4><small>同一设备下的原始事件，按记录时间排序</small></div><RouterLink :to="{path:'/operations/assets',query:{assetId:asset.id,tab:'records'}}">台账明细</RouterLink></div>
      <div v-if="history.length" class="timeline">
       <div v-for="entry in history.slice(0,historyLimit)" :key="entry.id" class="timeline-row">
        <small>{{ formatDateTime(entry.at) }} · {{ entry.dataLabel }}</small>
        <strong>{{ entry.summary }}</strong>
        <span v-if="entry.actor">处理人：{{ entry.actor }}</span>
       </div>
       <NButton v-if="history.length>historyLimit" size="small" quaternary @click="historyLimit+=10">加载更多记录（剩余 {{ history.length-historyLimit }}）</NButton>
      </div>
      <p v-else class="empty-hint">没有关联的运维履历。</p>
     </section>
    </div>

    <div v-else class="workspace-panels document-panels">
     <section class="workspace-panel">
      <div class="panel-head"><div><h4>设备技术资料</h4><small>按设备关联，按版本与审核状态区分</small></div><RouterLink :to="{path:'/archives',query:{assetId:asset.id}}">打开资料中心</RouterLink></div>
      <div v-if="docs.length" class="record-stack">
       <article v-for="doc in docs" :key="doc.id" class="record doc-record">
        <button class="doc-open" @click="expandedDoc=expandedDoc===doc.id?null:doc.id">
         <strong>{{ doc.title }}</strong><NTag size="tiny" :type="doc.reviewed?'success':'warning'">{{ doc.reviewed?'已审核':'未审核' }}</NTag>
         <small>{{ doc.version }} · {{ doc.sourceLabel }}</small>
        </button>
        <template v-if="expandedDoc===doc.id">
         <p>{{ doc.summary??'未提供摘要' }}</p>
         <p class="excerpt">{{ doc.contentExcerpt??'没有可核验的原文摘录' }}</p>
         <small>原文位置：{{ doc.lineOrSection??'未提供' }} · 版本：{{ doc.version }}</small>
         <RouterLink :to="{path:'/archives',query:{assetId:asset.id,docId:doc.id}}">查看资料详情与原文</RouterLink>
        </template>
       </article>
      </div>
      <p v-else class="empty-hint">该设备尚无关联技术资料，无法生成有出处的专业诊断结论。</p>
     </section>
     <section class="workspace-panel">
      <div class="panel-head"><h4>资料使用条件</h4></div>
      <p class="limit-hint">资料“已审核”仅表示本系统内的演示审核，不代表现场竣工验收。失效或未审核的资料不能冒充有效专业依据。</p>
      <RouterLink :to="{path:'/decision/knowledge',query:{assetId:asset.id}}">进入证据知识与诊断</RouterLink>
      <div class="asset-parameters">
       <div><span>关联资料</span><strong>{{ docs.length }} 份</strong></div>
       <div><span>已审资料</span><strong>{{ docs.filter(x=>x.reviewed).length }} 份</strong></div>
       <div><span>设备运行历史</span><strong>{{ history.length }} 条</strong></div>
      </div>
     </section>
    </div>
    <p class="workspace-foot">数据来源：当前演示场景的设备/测点/告警/工单/巡检与档案记录。模拟事件不等于现场实时监护；任何控制和工程放行均需正式接口与人工授权。</p>
   </div>
   <div v-else class="workspace-main invalid-asset"><p>暂无可用设备。请先从设备台账建档。</p><RouterLink to="/operations/assets">前往设备台账</RouterLink></div>
  </div>
  <WorkOrderDrawer :work-order-id="selectedOrderId" @close="selectedOrderId=null" />
 </section>
</template>

<style scoped>
.asset-workspace{min-width:0;color:#365a71;display:grid;gap:12px;padding-bottom:22px}
.workspace-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:linear-gradient(110deg,#eaf7fc,#fff 77%);border:1px solid #d9ebf3;border-radius:10px;padding:14px 17px}
.workspace-head h2{margin:2px 0 4px;font-size:20px;color:#215673}
.workspace-head p:not(.eyebrow){margin:0;font-size:11px;color:#819cac;line-height:1.7}
.eyebrow{font-size:10px;color:#87a6b8;margin:0;letter-spacing:.06em}
.workspace-layout{display:grid;grid-template-columns:minmax(185px,215px) minmax(0,1fr);gap:12px;align-items:start}
.asset-side,.workspace-main{min-width:0}
.asset-side{background:#fff;border:1px solid #dce9ef;border-radius:9px;padding:12px;display:grid;gap:9px}
.side-top{display:flex;justify-content:space-between;font-size:12px;color:#356681}
.side-top span{font-size:10px;color:#9babba}
.asset-choices{display:grid;align-content:start;gap:4px;max-height:545px;overflow-y:auto}
.asset-choice{border:1px solid transparent;border-radius:6px;background:#fff;text-align:left;padding:9px 8px;color:#527d92;cursor:pointer;display:flex;align-items:center;gap:6px;justify-content:space-between;min-width:0}
.asset-choice>span{display:grid;gap:3px;min-width:0}.asset-choice strong{font-size:11px}.asset-choice small{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;color:#8ba5b5}
.asset-choice.active{background:#eaf6fb;border-color:#acd7e8;box-shadow:inset 3px 0 0 #358eb6}
.asset-choice:hover{background:#f0f9fd}
.side-bottom{border-top:1px solid #e4eef3;padding-top:10px;font-size:11px}
.workspace-main{display:grid;gap:12px}
.asset-banner{background:#fff;border:1px solid #dce9ef;border-radius:9px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.asset-identity h3{margin:4px 0;font-size:19px;color:#1e5b7b}.asset-identity h3 span{font-weight:500;color:#4b728b;font-size:15px}
.asset-identity p:not(.eyebrow){font-size:11px;margin:0;color:#90a8b6}
.banner-tags{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.text-link,.workspace-panel a{font-size:11px;color:#257eaa;text-decoration:none}.text-link:hover,.workspace-panel a:hover{text-decoration:underline}
.kpi-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
.kpi{background:#fff;border:1px solid #dbeaf1;border-radius:8px;display:grid;gap:5px;text-align:left;padding:12px;cursor:pointer;min-width:0}
.kpi span{font-size:11px;color:#86a0b0}.kpi strong{font-size:23px;color:#257a9c;line-height:1.2}
.kpi strong small{font-size:11px;margin-left:2px}.kpi strong.kpi-text{font-size:18px}
.kpi em{font-size:10px;color:#9cacbb;font-style:normal;line-height:1.4}
.workspace-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;padding:5px;border:1px solid #deebf3;border-radius:8px;background:#f4fafe}
.workspace-tabs button{border:1px solid #e0ebf1;border-radius:6px;background:#fff;color:#61869a;min-width:0;display:grid;gap:3px;cursor:pointer;padding:10px 8px;text-align:center}
.workspace-tabs button strong{font-size:12px}.workspace-tabs button small{font-size:10px;color:#8eabb9}
.workspace-tabs button.active{border-color:#93c9e1;background:#e5f5fc;color:#267aa1;box-shadow:inset 0 -2px 0 #2c8fb9}
.workspace-panels{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:11px;align-items:start;min-width:0}
.workspace-panel{min-width:0;padding:14px;border:1px solid #deebf1;background:#fff;border-radius:9px;display:grid;gap:12px}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.panel-head h4{margin:0;color:#295c76;font-size:13px}.panel-head small{display:block;color:#95aab8;font-size:10px;margin-top:4px}
.point-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.point{background:#f6fbfd;border:1px solid #e1edf2;border-radius:6px;padding:9px;display:grid;gap:5px;text-align:left;color:#537b91;cursor:pointer;min-width:0}
.point.selected{border-color:#8dc7dc;background:#ebf8fd}
.point span{font-size:11px}.point strong{font-size:16px;color:#2b7092;overflow-wrap:anywhere}.point strong small,.point>small{font-size:9px;color:#93a9b6}
.chart-wrap{border-top:1px solid #edf2f5;padding-top:10px;min-width:0;overflow:hidden}
.score-box{background:#f1fafd;padding:14px;border-radius:8px;display:flex;align-items:center;gap:13px}
.score-box>strong{font-size:33px;color:#2b8db1}.score-box div{display:grid;gap:3px;font-size:12px}.score-box small{font-size:10px;color:#8fadb9}
.factor-row{display:grid;grid-template-columns:minmax(0,1fr) 45px 70px;gap:6px;padding:7px 0;border-bottom:1px dashed #e7eef3;align-items:center;font-size:11px}
.factor-row strong{color:#337693}.factor-row small{color:#90aab8}
.limit-hint,.workflow-note,.empty-hint{color:#859fac;font-size:11px;line-height:1.8;margin:0}
.workflow-note{padding:10px;border-radius:7px;background:#f5fafc;border:1px solid #e0edf3}
.asset-parameters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.asset-parameters>div{display:grid;gap:4px;padding:9px;border-radius:6px;background:#f7fafc}
.asset-parameters span{color:#91a8b6;font-size:10px}.asset-parameters strong{font-size:12px;color:#467890}
.record-stack{display:grid;gap:8px}
.record{border:1px solid #e1edf3;border-radius:7px;padding:11px;background:#fbfdfe;display:grid;gap:7px;font-size:11px;line-height:1.55}
.record-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.record-top b,.record-top strong{font-size:12px;color:#32677f}.record p{margin:0;overflow-wrap:anywhere}
.record-meta,.record>small{font-size:10px;color:#98adba}
.record-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.order-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f8fbfd;border:1px solid #e1edf1;border-radius:7px;padding:10px;color:#416e87;text-align:left;cursor:pointer}
.order-row:hover{background:#eff9fd}.order-row>span{display:grid;gap:6px;min-width:0}.order-row b{font-size:12px}.order-row small{font-size:10px;color:#90aab8}
.order-status{justify-items:end;white-space:nowrap}
.duty-events{display:grid;gap:8px;border-top:1px solid #e8f0f3;padding-top:9px}
.duty-events h4{font-size:12px;margin:0}
.inspection-form{display:grid;gap:10px;background:#f1fafc;padding:12px;border:1px solid #cfe7f0;border-radius:7px}
.inspection-item{display:grid;grid-template-columns:minmax(90px,1fr) minmax(90px,1fr) auto auto;gap:6px;align-items:center}
.inspection-item :deep(.n-checkbox){white-space:nowrap;font-size:11px}
.inspection-expand{display:flex;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:8px;color:#4a7890;background:none;padding:0;border:0;cursor:pointer;text-align:left}
.inspection-expand span{font-size:10px;color:#90a7b7}.check-line{display:flex;align-items:center;gap:6px}
.form-error{color:#c55a56;font-size:11px;margin:0}
.anomaly-summary{color:#a77742;background:#fff9ee;border-left:2px solid #debc83;padding:7px 9px;line-height:1.55}
.timeline{display:grid;gap:11px}
.timeline-row{display:grid;gap:6px;padding:2px 10px 10px;border-left:2px solid #a9d5e7}
.timeline-row small,.timeline-row span{font-size:10px;color:#9aafba}.timeline-row strong{font-size:11px;color:#4d7489;line-height:1.5}
.doc-open{border:0;background:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;cursor:pointer;color:#3e718c;text-align:left;padding:0}
.doc-open strong{flex:1;min-width:135px}.doc-open small{color:#96aab7}
.excerpt{background:#f0f7fb;border-left:2px solid #90c8dc;padding:9px}
.workspace-foot{color:#9aafbb;font-size:10px;line-height:1.7;margin:0}
.invalid-asset{padding:25px;border:1px solid #ebd8c3;background:#fffaf2;border-radius:8px;align-content:start}
.invalid-asset h3{color:#956e41}
@media(max-width:1250px){.workspace-panels{grid-template-columns:1fr}.asset-choices{max-height:460px}}
@media(max-width:950px){.workspace-layout{grid-template-columns:1fr}.asset-side{gap:7px}.asset-choices{display:flex;overflow-x:auto;max-height:95px}.asset-choice{min-width:160px}.side-bottom{padding-top:7px}.workspace-panels{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.workspace-panels{grid-template-columns:1fr}.kpi-row{grid-template-columns:repeat(2,minmax(0,1fr))}.workspace-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.inspection-item{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
</style>

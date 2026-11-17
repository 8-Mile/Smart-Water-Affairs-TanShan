<script setup lang="ts">
import {computed,reactive,ref,watch} from "vue";
import {RouterLink,useRoute} from "vue-router";
import {NButton,NInput,NSelect,NTag,useMessage} from "naive-ui";
import {useDemoStore} from "../demo/store";
import {can,roleNames} from "../demo/permissions";
import {
 EMERGENCY_TEMPLATES,createEmergencyCase,readEmergencyCases,advanceEmergencyCase,overdueTasks,
 type EmergencyCase,type EmergencyKind,type EmergencyAction,
} from "../demo/emergencyWorkflow";
import type {Role} from "../demo/types";

defineProps<{embedded?:boolean}>();
const emit=defineEmits<{changed:[]}>();
const route=useRoute();
const store=useDemoStore();
const message=useMessage();
const cases=ref<EmergencyCase[]>(readEmergencyCases(localStorage,store.scenarioId));
const selectedId=ref(typeof route.query.caseId==="string"?route.query.caseId:cases.value.at(-1)?.id??"");
const selected=computed(()=>cases.value.find(c=>c.id===selectedId.value));
const currentAlarm=computed(()=>store.alarms.find(a=>a.id===newEventId.value));
const sourceEventRef=computed(()=>{
 if(newEventId.value)return "alarm:"+newEventId.value;
 return typeof route.query.eventRef==="string"&&route.query.eventRef.startsWith("duty:")
   ?route.query.eventRef:"";
});
const sourceAssetId=computed(()=>typeof route.query.assetId==="string"&&
 store.getAsset(route.query.assetId)?route.query.assetId:"");
const existingLinkedCase=computed(()=>sourceEventRef.value?
 cases.value.find(c=>c.status!=="closed"&&
  (c.sourceEventRef===sourceEventRef.value||
   (newEventId.value&&c.eventId===newEventId.value))):undefined);
const kind=ref<EmergencyKind>("supply");
const newEventId=ref(typeof route.query.alarmId==="string"?route.query.alarmId:"");
const newTitle=ref("关键供水设施异常联合处置（模拟）");
const severity=ref<"critical"|"warning">("critical");
const planRef=ref("");
const commander=ref("");
const resourcesNote=ref("");
const resourceAssetIds=ref<string[]>([]);
const assigned=reactive<Record<string,string>>({});
const note=ref("");
const evidenceRef=ref("");
const replacement=ref("");
const feedback=ref("");
const feedbackTaskId=ref("");
const displayedNow=ref(new Date().toISOString());
const canCreate=computed(()=>can(store.role,"emergency:create"));
const canManage=computed(()=>can(store.role,"emergency:review"));
const canFeedback=computed(()=>can(store.role,"emergency:handle"));
const overdue=computed(()=>selected.value?overdueTasks(selected.value,displayedNow.value):[]);
const timeline=computed(()=>[...(selected.value?.history??[])].reverse());
const states:Record<string,string>={
 draft:"待核预案 / 未启动",active:"岗位协同中",review:"待复盘审核",closed:"已复盘归档",
};
function refresh(){
 cases.value=readEmergencyCases(localStorage,store.scenarioId);
 emit("changed");
 if(!cases.value.some(c=>c.id===selectedId.value))selectedId.value=cases.value.at(-1)?.id??"";
}
watch(()=>store.scenarioId,refresh);
watch(()=>[route.query.alarmId,route.query.eventRef],([id])=>{
 newEventId.value=typeof id==="string"?id:"";
 const match=existingLinkedCase.value;
 if(match)selectedId.value=match.id;
},{immediate:true});
watch(()=>route.query.caseId,(id)=>{
 if(typeof id==="string"&&cases.value.some(c=>c.id===id))selectedId.value=id;
});
function create(){
 try{
  // One open emergency workflow per confirmed source event in a DEMO scenario.
  // Do not silently create duplicate task chains for the same event.
  const existing=existingLinkedCase.value;
  if(existing){
   selectedId.value=existing.id;
   message.info("此来源事件已有未归档应急任务，已定位原任务，不重复创建");
   return;
  }
  const alarm=currentAlarm.value;
  const item=createEmergencyCase(localStorage,{
   scenarioId:store.scenarioId,actor:store.role,kind:kind.value,
   title:newTitle.value,severity:severity.value,
   ...(alarm?{eventId:alarm.id,assetId:alarm.assetId}:
     sourceAssetId.value?{assetId:sourceAssetId.value}:{}),
   ...(sourceEventRef.value?{sourceEventRef:sourceEventRef.value}:{}),
   now:new Date().toISOString(),
  });
  refresh();selectedId.value=item.id;
  message.success("已建立应急演练草稿；预案尚未批准，不会通知现场");
 }catch(e){message.error((e as Error).message);}
}
function change(action:EmergencyAction,taskId?:string){
 const item=selected.value;if(!item)return;
 try{
  const current=new Date().toISOString();
  advanceEmergencyCase(localStorage,item.id,action,store.role,{
   planRef:planRef.value,commander:commander.value,assignments:assigned,
   resourcesNote:resourcesNote.value,resourceAssetIds:resourceAssetIds.value,
   taskId,feedback:feedback.value,evidenceRef:evidenceRef.value,
   newAssignee:replacement.value,note:note.value,
  },current);
  refresh();displayedNow.value=current;
  note.value="";feedback.value="";evidenceRef.value="";replacement.value="";
  message.success("操作已写入本地应急处置时间线（MOCK）");
 }catch(e){message.error((e as Error).message);}
}
function startFeedback(id:string){feedbackTaskId.value=feedbackTaskId.value===id?"":id;}
function resetOverdue(){displayedNow.value=new Date().toISOString();}
function taskCanHandle(role:Role){return canFeedback.value&&(store.role===role||store.role==="admin"||store.role==="manager");}
const labelOf=(role:Role)=>roleNames[role];
</script>

<template>
 <section class="emergency-page" :class="{embedded,'no-selection':!selected}">
  <header v-if="!embedded" class="emergency-head">
   <div><small>运行中心 / 应急协同</small><h2>应急岗位任务与复盘</h2>
    <p>依据事件建立协同任务，人工核对已批准预案与联系人，记录响应、超时升级、反馈证据及复盘。不发送外部通知，不控制设备。</p></div>
   <NTag type="warning">DEMO · 预案模板非正式批准版本</NTag>
  </header>
   <div v-if="sourceEventRef" class="emergency-linkage">
   <strong>当前来源{{newEventId?'告警':'巡查事件'}}：{{currentAlarm?.code??sourceEventRef}}</strong>
   <span>{{currentAlarm?.title??'保留原始事件引用，现场信息需核查'}} · 任务不会自动关闭原告警或巡查事件</span>
   <NButton v-if="existingLinkedCase" size="tiny" secondary @click="selectedId=existingLinkedCase.id">
    查看已关联应急任务 {{existingLinkedCase.id}}
   </NButton>
  </div>
  <div class="emergency-layout">
   <section class="emergency-panel">
    <h3>1. 建立应急协同草稿</h3>
    <label>处置场景
     <NSelect v-model:value="kind" :options="Object.entries(EMERGENCY_TEMPLATES).map(([value,x])=>({value,label:x.label}))" size="small"/>
    </label>
    <label>事件说明<NInput v-model:value="newTitle" size="small"/></label>
    <label>影响等级
     <NSelect v-model:value="severity" size="small" :options="[{label:'严重 · 高优先级',value:'critical'},{label:'警告 · 需协同',value:'warning'}]"/>
    </label>
    <label>关联原始告警（选填，仅选已有数据）
     <NSelect v-model:value="newEventId" clearable size="small" placeholder="不绑定时不生成虚假告警"
      :options="store.alarms.map(a=>({value:a.id,label:a.code+' · '+a.title}))"/>
    </label>
    <p class="emergency-hint">建议模板：{{EMERGENCY_TEMPLATES[kind].plan}}。模板中的岗位任务由人工确认后才能启动。</p>
    <NButton type="primary" size="small" :disabled="!canCreate" @click="create">
     {{existingLinkedCase?'打开来源事件已有应急任务':'创建应急协同草稿'}}
    </NButton>
    <p v-if="!canCreate" class="emergency-hint">当前岗位没有创建应急任务权限，可查看现有记录。</p>
    <hr/>
    <h3>历史演练记录</h3>
    <div class="case-list">
     <button v-for="c in [...cases].reverse()" :key="c.id" type="button" :class="{active:selectedId===c.id}" @click="selectedId=c.id">
      <b>{{c.id}} · {{c.title}}</b><small>{{states[c.status]}} · {{c.createdAt.slice(0,16).replace('T',' ')}}</small>
     </button>
     <p v-if="!cases.length" class="emergency-hint">尚无演练记录。请先建草稿，不能把模拟巡查当作实际应急响应。</p>
    </div>
   </section>
   <section class="emergency-panel" v-if="selected">
    <div class="emergency-selection">
     <div><small>{{selected.id}}</small><h3>{{selected.title}}</h3></div>
     <NTag :type="selected.status==='closed'?'success':'warning'">{{states[selected.status]}}</NTag>
    </div>
    <p class="emergency-hint">关联：{{selected.sourceEventRef??selected.eventId??'未绑定原始事件'}} /
     {{selected.assetId??'无设备引用'}} · 风险等级 {{selected.severity}} · 来源 MOCK / USER_ENTRY</p>
    <p v-if="selected.resourceAvailability" class="emergency-hint">人工资源核查：{{selected.resourceAvailability}} · 候选设备 {{selected.resourceAssetIds?.length??0}} 台（尚未经现场可用性确认）</p>
    <div class="emergency-links">
     <RouterLink v-if="selected.sourceEventRef"
       :to="{path:'/operations/events',query:{tab:'queue',eventRef:selected.sourceEventRef}}">
       返回原始事件 →
     </RouterLink>
     <RouterLink v-if="selected.eventId" :to="{path:'/operations/events',query:{tab:'alarms',alarmId:selected.eventId,returnTo:route.fullPath}}">核查原告警 →</RouterLink>
     <RouterLink v-if="selected.assetId" :to="{path:'/operations/asset-workspace',query:{assetId:selected.assetId,returnTo:route.fullPath}}">查看设备档案 →</RouterLink>
    </div>
    <div v-if="selected.status==='draft'" class="workflow-step">
     <h4>2. 管理岗位核对预案并指定任务负责人</h4>
     <p class="emergency-hint">当前只给出演示模板，不宣称现场已有批准文件。请输入真实核对的预案编号和模拟联络人后才能进入本地演练。</p>
     <label>已批准预案编号<NInput v-model:value="planRef" placeholder="预案编号 / 审批引用，必填" size="small"/></label>
     <label>指挥联络人<NInput v-model:value="commander" placeholder="角色/责任人" size="small"/></label>
     <label>候选设备资源（选填，不代表可用性已确认）
      <NSelect v-model:value="resourceAssetIds" multiple size="small" placeholder="选择需要核查的设备"
       :options="store.assets.filter(a=>!a.archived).map(a=>({value:a.id,label:a.code+' · '+a.name+' ('+a.status+' / MOCK)'}))" />
     </label>
     <label>资源和备用条件核查说明（必填）<NInput v-model:value="resourcesNote" size="small"
       placeholder="设备/人员/物资的可用情况及尚待核条件" /></label>
     <div v-for="t in selected.tasks" :key="t.id" class="task-line">
      <b>{{t.title}}</b><small>{{labelOf(t.role)}} · {{t.deadlineMinutes}} 分钟响应门槛</small>
      <NInput :value="assigned[t.id]??''" size="small" placeholder="指定联络人 / 责任人"
        @update:value="v=>assigned[t.id]=v"/>
     </div>
     <NButton type="primary" size="small" :disabled="!canManage" @click="change('activate')">核对并启动本地协同演练</NButton>
    </div>
    <div v-else class="workflow-step">
     <h4>3. 岗位任务反馈与超时核查</h4>
     <p class="emergency-hint">任务计时从人工启动时刻开始。超时升级需管理岗位主动点击检查；这里只留存模拟升级记录，不发送短信或语音。</p>
     <NButton v-if="selected.status==='active'" size="small" secondary @click="resetOverdue">手动检查任务超时（{{overdue.length}}）</NButton>
     <div v-for="task in selected.tasks" :key="task.id" class="task-line" :class="{overdue:overdue.some(x=>x.id===task.id)}">
      <div class="task-title"><strong>{{task.title}}</strong><NTag size="small" :type="task.state==='done'?'success':'warning'">{{task.state==='done'?'已反馈':'待反馈'}}</NTag></div>
      <small>{{labelOf(task.role)}} · {{task.assignee}} · 截止 {{task.dueAt?.replace('T',' ').slice(0,16)}} · 升级 {{task.escalations}} 次</small>
      <p v-if="task.state==='done'" class="emergency-hint">反馈：{{task.note}} · 证据 {{task.evidenceRef}}</p>
      <template v-else-if="selected.status==='active'">
       <NButton v-if="taskCanHandle(task.role)" size="tiny" @click="startFeedback(task.id)">{{feedbackTaskId===task.id?'收起反馈':'填写本岗位反馈'}}</NButton>
       <div v-if="feedbackTaskId===task.id" class="feedback-form">
        <NInput v-model:value="feedback" type="textarea" :rows="2" placeholder="现场核查与采取措施；不可仅填已处理"/>
        <NInput v-model:value="evidenceRef" placeholder="现场记录或图片引用编号（必填）"/>
        <NButton type="primary" size="small" @click="change('feedback',task.id)">记录人工反馈</NButton>
       </div>
       <div v-if="overdue.some(x=>x.id===task.id)&&canManage" class="feedback-form">
        <NInput v-model:value="replacement" placeholder="升级转派至谁（不发送消息）"/>
        <NButton size="small" type="warning" @click="change('escalate',task.id)">超时升级并记录转派</NButton>
       </div>
      </template>
     </div>
     <div v-if="selected.status==='active'&&canManage" class="workflow-step">
      <label>提交复盘说明<NInput v-model:value="note" type="textarea" :rows="2" placeholder="影响范围、协同处置过程" /></label>
      <NButton type="primary" size="small" :disabled="selected.tasks.some(t=>t.state!=='done')" @click="change('submit-review')">全部任务反馈后提交复盘</NButton>
     </div>
     <div v-if="selected.status==='review'" class="workflow-step">
      <label>复盘结论<NInput v-model:value="note" type="textarea" :rows="2" placeholder="恢复与未解决事项、后续动作" /></label>
      <label>复盘依据编号<NInput v-model:value="evidenceRef" size="small" placeholder="复盘依据编号（必填）"/></label>
      <NButton type="primary" size="small" :disabled="!canManage" @click="change('close')">人工复核并归档</NButton>
     </div>
     <p v-if="selected.status==='closed'" class="emergency-hint">归档依据 {{selected.reviewEvidenceRef}} · {{selected.reviewNote}}。业务任务关闭不等于原告警和设备自动恢复。</p>
    </div>
    <details class="emergency-history" open>
     <summary>4. 事件时间线（{{timeline.length}}）</summary>
     <ol><li v-for="(t,i) in timeline" :key="i"><b>{{t.action}} · {{labelOf(t.actor)}}</b><small>{{t.at.replace('T',' ').slice(0,19)}}</small><p>{{t.detail}}</p></li></ol>
    </details>
   </section>
  </div>
 </section>
</template>

<style scoped>
.emergency-page{display:grid;gap:11px;color:#28536d;font-size:12px}
.emergency-page.embedded .emergency-panel{box-shadow:none}
.emergency-page.embedded.no-selection .emergency-layout{
 grid-template-columns:minmax(0,660px);justify-content:center;
}
.emergency-linkage{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 12px;background:#eef8fe;border:1px solid #d1eaf5;border-radius:7px}
.emergency-linkage span{color:#688fa0}
.emergency-head,.emergency-panel{background:#fafdff;border:1px solid #d4e7f1;border-radius:10px;padding:15px}
.emergency-head{display:flex;align-items:start;justify-content:space-between;gap:12px}
.emergency-head h2{font-size:20px;margin:5px 0}.emergency-head p{font-size:12px;color:#6a8898;margin:0;line-height:1.65;max-width:800px}
.emergency-layout{display:grid;grid-template-columns:minmax(280px,35%) minmax(0,1fr);gap:13px;align-items:start}
.emergency-panel{display:grid;align-content:start;gap:12px;min-width:0}
.emergency-panel h3{font-size:15px;margin:0;color:#1f5c7c}
.emergency-panel label,.workflow-step label{display:grid;gap:6px;color:#50758a}
.emergency-hint{font-size:11px;color:#748fa0;line-height:1.65;margin:4px 0}
.emergency-panel hr{width:100%;border:0;border-top:1px solid #dce9f1}
.case-list{display:grid;gap:5px;max-height:350px;overflow:auto}
.case-list button{background:#f4fbff;border:1px solid #d3e9f4;border-radius:7px;display:grid;gap:5px;text-align:left;padding:10px;color:#2b607d;cursor:pointer}
.case-list button.active{border-color:#54a5cc;background:#e5f5ff}.case-list small{color:#7894a6}
.emergency-selection{display:flex;justify-content:space-between;align-items:start;gap:8px;flex-wrap:wrap}
.emergency-links,.feedback-form{display:flex;flex-wrap:wrap;gap:8px}.emergency-links a{color:#1377a6}
.workflow-step{display:grid;gap:10px;padding:11px;border:1px solid #dce9f0;border-radius:8px}
.workflow-step h4{margin:0;font-size:13px}
.task-line{border:1px solid #dfeaf1;background:#fff;padding:10px;border-radius:7px;display:grid;gap:7px}
.task-line.overdue{border-color:#efb18a;background:#fff9f3}
.task-line small{color:#758f9e}.task-title{display:flex;justify-content:space-between;gap:8px;align-items:center}
.feedback-form{display:grid;border-top:1px solid #e5eef3;padding-top:8px}
.emergency-history ol{padding-left:25px;line-height:1.6}.emergency-history li{padding:6px 0}.emergency-history p{margin:4px 0;color:#5e8095}
.emergency-history small{display:block;color:#90a5b0}
@media(max-width:900px){.emergency-layout{grid-template-columns:1fr}}
@media(max-width:550px){.emergency-head{display:grid}.emergency-panel{padding:12px}}
</style>

<script setup lang="ts">
import {computed,ref,watch} from "vue";
import {RouterLink,useRoute,useRouter} from "vue-router";
import {NButton,NTag} from "naive-ui";
import {useDemoStore} from "../demo/store";
import {useUnattendedStore} from "../demo/unattendedStore";
import {roleNames} from "../demo/permissions";
import {buildRoleQueue,roleShortcuts,type RoleQueueTask} from "../demo/roleQueue";
const store=useDemoStore(),duty=useUnattendedStore(),route=useRoute(),router=useRouter();
const queue=computed(()=>buildRoleQueue(store.role,store.alarms,store.workorders,duty.events,store.assets));
const shortcuts=computed(()=>roleShortcuts(store.role));
const expanded=computed(()=>route.query.focus==="tasks");
const showAll=ref(false);
const showIssues=ref(false);
const visibleTasks=computed(()=>showAll.value?queue.value.tasks:queue.value.tasks.slice(0,5));
const originLabel=(v:RoleQueueTask["origin"])=>
 v==="alarm"?"告警确认":v==="duty"?"值守处置":"工单流转";
watch(()=>store.role,()=>{showAll.value=false;showIssues.value=false;});
function toggle():void{
 const query={...route.query};
 if(expanded.value)delete query.focus;
 else query.focus="tasks";
 void router.replace({path:route.path,query});
}
</script>
<template>
 <section class="role-queue" :class="{expanded}" aria-label="本岗位可办理事项">
  <div class="role-queue-bar">
   <div class="role-label">
    <span class="role-kicker">按现有角色权限计算 · 不代表个人任务分配</span>
    <div class="role-headline">
     <strong>{{ roleNames[store.role] }} · 岗位可办理</strong>
     <NTag size="small" :type="queue.tasks.length?'warning':'default'">{{ queue.tasks.length }} 项</NTag>
     <small>工单 {{ queue.sourceCounts.orders }} / 告警 {{ queue.sourceCounts.alarms }} / 巡查 {{ queue.sourceCounts.duty }}</small>
    </div>
   </div>
   <div class="role-actions">
    <NTag v-if="queue.issues.length" size="small" type="warning">关联待核 {{ queue.issues.length }} 项</NTag>
    <NButton size="small" secondary @click="toggle">{{ expanded?"收起岗位待办":"查看本岗位待办" }}</NButton>
   </div>
  </div>
  <template v-if="expanded">
   <div class="role-content">
    <div class="role-intro">
     <strong>下一步处理建议</strong>
     <span>按严重程度和原始时间排序，只列出此角色有权限执行的业务动作。点击进入原工单、设备或值守流程；不会代替人员自动操作。</span>
    </div>
    <div v-if="queue.tasks.length" class="task-list">
     <RouterLink v-for="task in visibleTasks" :key="task.id" :to="task.to" class="task-row">
      <span class="task-source">
       <NTag size="tiny" :type="task.level==='critical'?'error':task.level==='high'?'warning':'info'">{{ originLabel(task.origin) }}</NTag>
       <small>{{ task.statusLabel }}</small>
      </span>
      <span class="task-text"><strong>{{ task.title }}</strong><small>{{ task.assetLabel }} · {{ task.sourceId }}</small></span>
      <span class="task-action">{{ task.actionLabel }} <span aria-hidden="true">›</span></span>
     </RouterLink>
     <NButton v-if="queue.tasks.length>5" size="small" quaternary @click="showAll=!showAll">
      {{ showAll?'收起事项':'展开全部 '+queue.tasks.length+' 项' }}
     </NButton>
    </div>
    <div v-else class="no-tasks">
     当前角色没有可直接办理的已记录事项。并不意味着设备、事件或现场运行无异常；仅代表当前权限与流程状态下没有可执行动作。
    </div>
    <div class="role-shortcuts">
     <span>岗位常用入口</span>
     <RouterLink v-for="item in shortcuts" :key="item.label" :to="item.path" :title="item.hint">
      {{ item.label }} <small>{{ item.hint }}</small>
     </RouterLink>
    </div>
    <div v-if="queue.issues.length" class="integrity-section">
     <div class="integrity-header">
      <div><strong>业务关联待人工核查 · {{ queue.issues.length }} 项</strong>
       <p>设备、工单与告警的引用完整性检查。风险提示不是新告警，也不表示现场设备已经恢复或失效。</p></div>
      <NButton size="tiny" quaternary @click="showIssues=!showIssues">{{ showIssues?"收起核查清单":"展开核查清单" }}</NButton>
     </div>
     <div v-if="showIssues" class="integrity-list">
      <RouterLink v-for="issue in queue.issues" :key="issue.id" :to="issue.to" class="issue-row">
       <strong>{{ issue.label }}</strong><small>{{ issue.detail }}</small>
      </RouterLink>
     </div>
    </div>
    <p class="role-footnote">场景时间为模拟固定时标；岗位待办为浏览器内推导视图，不存储新的任务状态；无真实排班、人员账号或生产控制。事件数、工单数与岗位动作数不能直接相加。</p>
   </div>
  </template>
 </section>
</template>
<style scoped>
.role-queue{min-width:0;background:linear-gradient(108deg,#f0f9fd,#fff 78%);border:1px solid #cfe5ef;border-radius:10px;color:#3a667e}
.role-queue-bar{padding:11px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.role-label{min-width:0;display:grid;gap:4px}
.role-kicker{font-size:10px;color:#86a4b5}
.role-headline{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.role-headline strong{font-size:13px;color:#2b637f}
.role-headline small{font-size:10px;color:#829fac}
.role-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.role-content{padding:0 13px 13px;display:grid;gap:12px}
.role-intro{border-top:1px solid #dceaf1;padding-top:11px;display:grid;gap:5px}
.role-intro strong{font-size:12px;color:#366e8a}.role-intro span{font-size:11px;color:#849eae;line-height:1.6}
.task-list{display:grid;gap:6px}
.task-row{display:grid;grid-template-columns:110px minmax(0,1fr) 155px;gap:8px;align-items:center;background:#fff;border:1px solid #dceaf2;border-radius:7px;padding:10px 12px;text-decoration:none;color:#4c7991}
.task-row:hover{background:#f2fbfe;border-color:#96cae0}
.task-source{display:grid;gap:4px;justify-items:start}
.task-source small,.task-text small{font-size:10px;color:#92aabb}
.task-text{display:grid;gap:5px;min-width:0}.task-text strong{font-size:12px;color:#3c6c84;overflow-wrap:anywhere;line-height:1.4}
.task-action{justify-self:end;text-align:right;color:#287ba1;font-size:11px;font-weight:700}.task-action span{font-size:14px}
.no-tasks{background:#fff;border:1px solid #e0ecf3;padding:13px;border-radius:8px;font-size:11px;color:#8da7b5;line-height:1.7}
.role-shortcuts{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.role-shortcuts>span{font-size:11px;color:#7895a6}
.role-shortcuts a{display:grid;gap:2px;border:1px solid #d5e9f2;border-radius:7px;padding:8px 11px;background:#fff;color:#317899;text-decoration:none;font-size:11px;font-weight:600}
.role-shortcuts a small{font-size:9px;color:#9aafbc;font-weight:400}
.role-shortcuts a:hover{background:#f0faff}
.integrity-section{border-top:1px solid #e3eaf0;padding-top:10px;display:grid;gap:9px}
.integrity-header{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.integrity-header strong{font-size:12px;color:#876f46}.integrity-header p{font-size:10px;color:#9a9d9e;margin:4px 0 0;line-height:1.5}
.integrity-list{display:grid;gap:6px}
.issue-row{display:grid;gap:5px;padding:10px;border:1px solid #eee3d0;background:#fffdfa;border-radius:7px;text-decoration:none}
.issue-row strong{font-size:11px;color:#896737}.issue-row small{font-size:10px;color:#a1927c;line-height:1.5}
.role-footnote{font-size:10px;color:#98aebe;line-height:1.6;margin:0}
@media(max-width:760px){
 .task-row{grid-template-columns:1fr auto}.task-source{grid-column:1/-1;display:flex;align-items:center}
 .task-action{max-width:120px}
 .role-actions{width:100%;justify-content:space-between}
}
</style>

<script setup lang="ts">
import {computed} from "vue";
import {RouterLink} from "vue-router";
import {NTag} from "naive-ui";
import {useDemoStore} from "../demo/store";
import {can,roleNames} from "../demo/permissions";
import RoleActionQueue from "../components/RoleActionQueue.vue";
import {readBalanceCases} from "../demo/balanceWorkflow";
import {readEmergencyCases} from "../demo/emergencyWorkflow";
import type {Role} from "../demo/types";
const store=useDemoStore();
interface WorkEntry{title:string;hint:string;path:string;count?:number;action?:string;}
const activeAlarms=computed(()=>store.alarms.filter(a=>a.status!=="closed"));
const pendingOrders=computed(()=>store.workorders.filter(w=>!["archived","cancelled"].includes(w.status)));
const pendingAcceptance=computed(()=>store.workorders.filter(w=>w.status==="pending_acceptance"));
const emergencyCases=computed(()=>readEmergencyCases(localStorage,store.scenarioId).filter(x=>x.status!=="closed"));
const waterCases=computed(()=>readBalanceCases(localStorage,store.scenarioId).filter(x=>x.status!=="closed"&&x.status!=="rejected"));
const profiles:Record<Role,{focus:string;instruction:string}>={
 manager:{focus:"生产供水、环保风险、资源成本与闭环审批",instruction:"从风险列表下钻至证据，先完成独立复核再做管理决策"},
 duty:{focus:"集中值守、未闭环事件、巡查与交接班",instruction:"先处理当前岗位可办事项，无法完成时关联工单或启动协同"},
 engineer:{focus:"设备健康、维修工单、档案和设备复测",instruction:"围绕设备编号核对测点、历史工单和复测依据"},
 water:{focus:"水量分类、处理与调蓄条件及资源效率",instruction:"核对计量口径、模型条件、水质限制后形成待审核方案"},
 admin:{focus:"业务流程与数据配置、权限和系统日志",instruction:"验证人员权限和数据映射，不直接以模拟界面替代生产控制"},
 viewer:{focus:"只读查看生产、环保、设备及分析结果",instruction:"当前角色仅可查阅信息，不可办理工单或提交控制"},
};
const tiles=computed<WorkEntry[]>(()=>{
 const role=store.role;
 const common:WorkEntry[]=[{title:"工艺运行",hint:"查看六工艺及运行关注",path:"/overview"}];
 if(role==="manager")return [
  {title:"待复核生产事件",hint:"原始告警与工单状态独立核查",path:"/operations/events",count:activeAlarms.value.length},
  {title:"待验收工单",hint:"需要管理者办理的验收任务",path:"/operations/workorders?status=pending_acceptance",count:pendingAcceptance.value.length},
  {title:"应急任务督办",hint:"核对预案、责任、超时升级和复盘",path:"/operations/emergency",count:emergencyCases.value.length},
  {title:"供需平衡方案复核",hint:"处理—储存—回用与人工跟踪",path:"/water/balance",count:waterCases.value.length},
  {title:"水资源统计与报表",hint:"核对水源口径并导出分析",path:"/data/reports?reportId=water-ledger"},
  ...common,
 ];
 if(role==="duty")return [
  {title:"值守与事件中心",hint:"确认告警、核查设备与关联工单",path:"/operations/events",count:activeAlarms.value.length},
  {title:"应急事件草稿",hint:"按实际事件发起协同请求",path:"/operations/emergency",count:emergencyCases.value.length},
  {title:"巡检与工单",hint:"现场巡检异常转待确认工单",path:"/operations/workorders?tab=inspections"},
  {title:"交接班记录",hint:"已有问题汇总和人工核查",path:"/data/reports"},
  ...common,
 ];
 if(role==="engineer")return [
  {title:"维修任务",hint:"提交处理结果与证据，不代表告警自动恢复",path:"/operations/workorders",count:pendingOrders.value.length},
  {title:"设备健康与能效",hint:"查看风险因子与缺测",path:"/decision/health"},
  {title:"设备与技术档案",hint:"稳定设备编号、维修历史、技术资料",path:"/operations/assets"},
  {title:"应急工程任务",hint:"按岗位提交现场核查反馈",path:"/operations/emergency",count:emergencyCases.value.length},
  ...common,
 ];
 if(role==="water")return [
  {title:"供需动态平衡",hint:"调蓄、处理、回用约束及方案版本",path:"/water/balance",count:waterCases.value.length},
  {title:"水资源分类账本",hint:"三源分类、处理/外供口径及缺数",path:"/water/ledger"},
  {title:"雨污水处理与回用",hint:"按工艺核对污染水流向",path:"/water/port-chain"},
  {title:"水资源分析与看板",hint:"基于已有账本生成可审核分析",path:"/data/ai-workspace?mode=water"},
  {title:"应急环保任务",hint:"处理能力、水质与末端消纳核查",path:"/operations/emergency"},
  ...common,
 ];
 if(role==="admin")return [
  {title:"事件及任务",hint:"核对所有模拟流程",path:"/operations/events",count:activeAlarms.value.length},
  {title:"应急协同",hint:"预案核对、岗位分工和复盘",path:"/operations/emergency",count:emergencyCases.value.length},
  {title:"系统设置",hint:"角色授权、设备配置及操作日志",path:"/admin/roles"},
  {title:"设备台账与资料",hint:"查看和修改配置",path:"/operations/assets"},
  {title:"数据分析与看板",hint:"AI/A2UI受控组件及版本",path:"/data/ai-workspace"},
  ...common,
 ];
 return [
  {title:"综合运行",hint:"只读核心指标",path:"/overview"},
  {title:"水资源账本",hint:"查阅可确认的数据来源",path:"/water/ledger"},
  {title:"设备档案",hint:"查看记录，不允许提交",path:"/operations/assets"},
 ];
});
const allowed=computed(()=>tiles.value.filter(t=>!t.action||can(store.role,t.action as "process:read")));
</script>

<template>
 <section class="role-page">
  <header class="role-head">
   <div><p class="role-eyebrow">统一运营 / 岗位工作台</p><h2>{{roleNames[store.role]}} · 工作入口</h2>
    <p>{{profiles[store.role].focus}}。{{profiles[store.role].instruction}}。</p></div>
   <NTag size="small" type="info">MOCK · 按当前角色权限与业务状态</NTag>
  </header>
  <RoleActionQueue v-if="can(store.role,'process:read') && store.role!=='viewer'"/>
  <section class="role-list" aria-label="当前岗位常用业务">
   <RouterLink v-for="tile in allowed" :key="tile.path" :to="tile.path" class="role-tile">
    <div><strong>{{tile.title}}</strong><small>{{tile.hint}}</small></div>
    <div class="tile-right"><b v-if="tile.count!==undefined">{{tile.count}}</b><span aria-hidden="true">›</span></div>
   </RouterLink>
  </section>
  <p class="role-footer">工作入口仅作岗位导航和当前模拟对象统计。不能根据页面未显示任务推断现场全部正常；跨业务流程仍使用同一设备、告警和工单编号。</p>
 </section>
</template>

<style scoped>
.role-page{display:grid;gap:13px;color:#315a72}
.role-head{background:#fafdff;border:1px solid #d5e7f0;padding:17px 19px;border-radius:9px;display:flex;justify-content:space-between;gap:12px;align-items:start}
.role-eyebrow{font-size:11px;color:#6e96ab;margin:0}.role-head h2{font-size:20px;margin:5px 0}.role-head p:last-child{font-size:12px;line-height:1.7;color:#6a8799;max-width:800px;margin:0}
.role-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.role-tile{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:17px;border:1px solid #d8e9f1;border-radius:10px;background:#fff;color:#275c79;text-decoration:none;min-height:90px}
.role-tile:hover{background:#edf9ff;border-color:#89bed8}
.role-tile>div:first-child{display:grid;gap:8px}.role-tile strong{font-size:14px}.role-tile small{font-size:11px;color:#829dad;line-height:1.5}
.tile-right{display:flex;align-items:center;gap:12px;color:#398cbb}.tile-right b{font-size:23px}.tile-right span{font-size:21px}
.role-footer{color:#7d98a8;font-size:11px;line-height:1.6}
@media(max-width:1100px){.role-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:650px){.role-head{display:grid}.role-list{grid-template-columns:1fr}}
</style>

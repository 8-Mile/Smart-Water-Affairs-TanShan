<script setup lang="ts">
import {computed} from "vue";
import {RouterLink,useRoute} from "vue-router";
import {useDemoStore} from "../demo/store";
import {isPumpAsset} from "../demo/health";

const props=defineProps<{assetId:string}>();
const store=useDemoStore();
const route=useRoute();
const asset=computed(()=>store.getAsset(props.assetId));
const alarms=computed(()=>store.alarms.filter(x=>x.assetId===props.assetId&&x.status!=="closed").length);
const orders=computed(()=>store.workorders.filter(x=>x.assetId===props.assetId).length);
const inspections=computed(()=>store.inspections.filter(x=>x.assetId===props.assetId).length);
const docs=computed(()=>store.documents.filter(x=>x.assetIds.includes(props.assetId)).length);
const endpoints=computed(()=>{
 const id=props.assetId;
 return [
  {label:"设备工作台",to:{path:"/operations/asset-workspace",query:{assetId:id}},active:route.path==="/operations/asset-workspace"},
  {label:"设备台账",to:{path:"/operations/assets",query:{assetId:id}},active:route.path==="/operations/assets"},
  {label:"运行事件",to:{path:"/operations/events",query:{assetId:id}},active:route.path==="/operations/events"},
  {label:"工单",to:{path:"/operations/workorders",query:{assetId:id}},active:route.path==="/operations/workorders"&&route.query.tab!=="inspections"},
  {label:"巡检",to:{path:"/operations/workorders",query:{assetId:id,tab:"inspections"}},active:route.path==="/operations/workorders"&&route.query.tab==="inspections"},
  ...(asset.value&&isPumpAsset(asset.value)?[{label:"健康分析",to:{path:"/decision/health",query:{assetId:id}},active:route.path==="/decision/health"}]:[]),
  {label:"设备档案",to:{path:"/archives",query:{assetId:id}},active:route.path==="/archives"},
 ];
});
</script>
<template>
 <nav v-if="asset" class="asset-journey" aria-label="设备业务快捷操作">
  <div class="journey-head">
   <span class="journey-label">当前设备</span>
   <strong>{{ asset.code }} · {{ asset.name }}</strong>
   <span class="journey-sources">待处理告警 {{ alarms }} · 工单 {{ orders }} · 巡检 {{ inspections }} · 资料 {{ docs }}</span>
  </div>
  <div class="journey-actions">
   <RouterLink v-for="entry in endpoints" :key="entry.label" :to="entry.to"
     :class="{active:entry.active}" :aria-current="entry.active?'page':undefined">{{ entry.label }}</RouterLink>
  </div>
  <span class="journey-note">仅按同一设备编号筛选，事件与工单不自动合并</span>
 </nav>
</template>
<style scoped>
.asset-journey{display:flex;flex-wrap:wrap;align-items:center;gap:10px 15px;border:1px solid #d5e8f2;background:linear-gradient(115deg,#f0f9fe,#fff 75%);border-radius:9px;padding:10px 14px;margin-bottom:11px;color:#386f8c}
.journey-head{display:grid;gap:4px;min-width:175px;flex:1 1 190px}
.journey-head strong{font-size:13px;color:#245977;line-height:1.4}
.journey-label{font-size:10px;color:#80a2b8}
.journey-sources{font-size:10px;color:#819bac}
.journey-actions{display:flex;gap:6px;flex:2 1 390px;flex-wrap:wrap}
.journey-actions a{border:1px solid #d8e9f2;background:#fff;padding:7px 10px;border-radius:6px;font-size:11px;color:#3e7691;text-decoration:none}
.journey-actions a.active{background:#e5f5fc;border-color:#7ab7d4;box-shadow:inset 0 -2px 0 #4e9dc5;font-weight:700}
.journey-actions a:hover{background:#eaf8fe}
.journey-note{flex:1 0 100%;color:#97aeba;font-size:10px}
</style>

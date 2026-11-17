<script setup lang="ts">
import {computed} from "vue";
import {useRoute} from "vue-router";
const route=useRoute();
const flows=[
 {id:"pollution",no:"01",name:"污染水收集 · 处理 · 合规消纳",
  hint:"逐池容量与水质/路径核查",to:"/water/port-chain?scenario=storm"},
 {id:"supply",no:"02",name:"港口生产用水保障",
  hint:"异常影响、设备归属与人工协同",to:"/intelligent/correlation"},
 {id:"duty",no:"03",name:"集中值守与处置",
  hint:"巡查事件、人工确认与工单",to:"/intelligent/unattended"},
] as const;
const active=computed(()=>
 route.path==="/water/port-chain"?"pollution":
 route.path==="/intelligent/correlation"?"supply":
 route.path==="/intelligent/unattended"?"duty":"");
</script>
<template>
 <nav class="business-journey" aria-label="港口三条核心业务线">
  <div class="journey-lead">
   <strong>港口业务流程导航</strong>
   <span>三条独立业务线 · 未经证实的管网关系不自动串接</span>
  </div>
  <div class="journey-links">
   <router-link v-for="f in flows" :key="f.id" :to="f.to" :aria-current="active===f.id?'page':undefined"
     class="journey-link" :class="{active:active===f.id}">
    <span>{{ f.no }} / {{ f.name }}</span><small>{{ f.hint }}</small>
   </router-link>
  </div>
 </nav>
</template>
<style scoped>
.business-journey{display:flex;align-items:center;gap:13px;min-width:0;flex-wrap:wrap;background:#f5fafd;border:1px solid #dceaf1;border-radius:9px;padding:10px 13px;color:#42778e}
.journey-lead{display:grid;gap:3px;min-width:166px;flex:0 1 185px}
.journey-lead strong{font-size:12px;color:#326c8d}.journey-lead span{font-size:10px;color:#8aa4b3;line-height:1.5}
.journey-links{flex:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.journey-link{display:grid;gap:3px;padding:8px 10px;min-width:0;background:#fff;border:1px solid #dfeaf0;border-radius:6px;text-decoration:none;color:#567c92}
.journey-link.active{background:#eaf7fc;border-color:#8fc7dd;box-shadow:inset 3px 0 0 #2c8da9}
.journey-link>span{font-size:11px;font-weight:700;white-space:normal}.journey-link small{font-size:10px;color:#90a8b4;line-height:1.5}
@media(max-width:850px){.journey-lead{flex:1 1 100%}.journey-links{min-width:100%}}
@media(max-width:550px){.journey-links{grid-template-columns:1fr}.journey-link{padding:6px 10px}}
</style>

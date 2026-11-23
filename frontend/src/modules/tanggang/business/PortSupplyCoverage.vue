<script setup lang="ts">
import {computed} from 'vue'
import {useScenarioStore} from '../simulation/store'
const store=useScenarioStore()
const r=computed(()=>store.result)
const fmt=(v:number)=>v.toLocaleString('zh-CN',{maximumFractionDigits:1})
const served=(a:number,d:number)=>d>0?Math.min(100,Math.max(0,a/d*100)):100
</script>

<template>
  <section v-if="r" class="tg-biz-card tg-supply-cover" data-testid="supply-demand-match">
    <div class="tg-supply-head">
      <h2>供水负荷与分配</h2>
      <span :class="{warn:r.shortageM3h>0}">
        {{r.shortageM3h>0?'存在缺口':'需求已覆盖'}}
      </span>
    </div>
    <div class="tg-supply-metrics">
      <div><small>需求合计</small><strong>{{fmt(r.demandedM3h)}} <em>m³/h</em></strong></div>
      <div><small>可分配能力</small><strong>{{fmt(r.usableCapacityM3h)}} <em>m³/h</em></strong></div>
      <div><small>实际分配</small><strong>{{fmt(r.deliveredM3h)}} <em>m³/h</em></strong></div>
      <div><small>未覆盖需求</small><strong :class="{warn:r.shortageM3h>0}">{{fmt(r.shortageM3h)}} <em>m³/h</em></strong></div>
    </div>
    <div class="tg-supply-lines">
      <div v-for="line in r.terminalAssessments" :key="line.id" class="tg-supply-line"
        :data-terminal-id="line.id">
        <span class="tg-supply-terminal">{{line.label}}</span>
        <span class="tg-supply-priority">P{{line.priority}}</span>
        <span class="tg-supply-track">
          <i :style="{width:served(line.allocatedM3h,line.demandM3h)+'%'}"
            :class="{warn:line.shortageM3h>0}"/>
        </span>
        <strong>{{fmt(line.allocatedM3h)}} / {{fmt(line.demandM3h)}}</strong>
        <small>m³/h</small>
      </div>
    </div>
    <div class="tg-supply-formula">可分配能力 = 总能力 − 预留能力；按用水点优先级分配，未满足部分计入供水缺口。</div>
  </section>
</template>

<style scoped>
.tg-supply-cover{padding:16px 20px}
.tg-supply-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:12px}
.tg-supply-head h2{margin:0!important}
.tg-supply-head>span{font-size:11px;color:#428c7d}
.tg-supply-head>span.warn{color:#bb7d4a}
.tg-supply-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:13px}
.tg-supply-metrics>div{padding:12px;border:1px solid #e1edf2;border-radius:7px;
  background:rgba(246,251,253,.85)}
.tg-supply-metrics small{display:block;font-size:10px;color:#849eab}
.tg-supply-metrics strong{display:block;margin-top:6px;font-size:21px;
  font-variant-numeric:tabular-nums;font-weight:700;color:#387d9c}
.tg-supply-metrics strong.warn{color:#bd7e4a}
.tg-supply-metrics em{font-size:11px;font-style:normal;font-weight:400}
.tg-supply-lines{display:flex;flex-direction:column;gap:9px}
.tg-supply-line{display:grid;grid-template-columns:minmax(135px,1fr) 28px minmax(70px,1fr) 98px 36px;
  align-items:center;gap:9px;font-size:11px;color:#678a9a}
.tg-supply-terminal{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-supply-priority{font-size:10px;color:#8b9ead}
.tg-supply-track{height:8px;overflow:hidden;background:#e1eef4;border-radius:4px}
.tg-supply-track>i{display:block;height:100%;background:#65a9c1;border-radius:4px}
.tg-supply-track>i.warn{background:#cfaa70}
.tg-supply-line>strong{text-align:right;font-size:11px;color:#4b768c;font-variant-numeric:tabular-nums}
.tg-supply-line small{font-size:10px;color:#8ba0af}
.tg-supply-formula{font-size:10px;color:#91a4ad;line-height:1.6;margin-top:13px}
@media(max-width:750px){.tg-supply-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
 .tg-supply-line{grid-template-columns:minmax(95px,1fr) 20px minmax(60px,1fr) 85px;gap:5px}
 .tg-supply-line small{display:none}
 .tg-supply-cover{padding:12px}}
</style>

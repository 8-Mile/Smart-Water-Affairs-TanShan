<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {useScenarioStore} from '../simulation/store'
import PortOperationsCaseBoard from './PortOperationsCaseBoard.vue'
import './business.css'
import './scenario-pages.css'
const router=useRouter(),store=useScenarioStore()
const r=computed(()=>store.result)
const n=(v:number)=>v.toLocaleString('zh-CN',{maximumFractionDigits:1})
</script>
<template>
  <main class="tg-biz tg-analysis-page page-fill">
    <div class="tg-biz-head tg-rain-actionbar" data-testid="rain-action-toolbar">
      <div class="tg-biz-actions">
        <span class="tg-datamode" :class="{sim:store.running}" data-testid="rain-source-status">
          {{store.autoEnabled?'SIM · 自动':store.running?'SIM · 分析':'数据未接入'}}
        </span>
        <el-button data-testid="rain-process-button"
          @click="router.push('/port/process/rain?facility=EQ-Y-DRAIN')">
          雨水收集工艺
        </el-button>
      </div>
    </div>
    <div v-if="!r" class="tg-analysis-empty">
      <h2>数据暂不可用</h2>
      <el-button size="small" @click="store.startAuto()">启动自动数据</el-button>
    </div>
    <template v-else>
      <div class="tg-rain-activity" data-testid="rain-operating-state"
        :class="{risk:r.rainRisk!=='normal'}">
        <span class="tg-rain-activity-dot"/>
        <strong>{{r.rainRisk==='critical'?'调蓄溢流预警':
          r.rainRisk==='attention'?'储量接近上限':
          r.input.rainMm>0?'降雨监测中':'当前无降雨'}}</strong>
        <small>{{store.activeScenario?.title}} · SIM</small>
      </div>
      <div class="tg-biz-grid">
        <div class="tg-biz-card art-card"><h2>累计降雨</h2><p class="tg-biz-kpi">{{r.input.rainMm}} <small>mm</small></p><p>降雨历时 {{r.input.rainDurationH}} 小时</p></div>
        <div class="tg-biz-card art-card"><h2>径流汇入量</h2><p class="tg-biz-kpi">{{n(r.rainCapturedM3)}} <small>m³</small></p><p>雨量 × 汇水面积 × 径流系数</p></div>
        <div class="tg-biz-card art-card"><h2>预计溢流</h2><p class="tg-biz-kpi" :class="{risk:r.rainOverflowM3>0}">{{n(r.rainOverflowM3)}} <small>m³</small></p><p>考虑假设排水能力后的超库容水量</p></div>
      </div>
      <div class="tg-biz-grid two">
        <section class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>调蓄容量</h2><span class="tg-biz-chip">SIM</span></div>
          <div class="tg-biz-list-row"><span>初始储量</span><strong>{{n(r.input.rainStorageInitialM3)}} m³</strong></div>
          <div class="tg-biz-list-row"><span>假设总库容</span><strong>{{n(r.input.rainStorageCapacityM3)}} m³</strong></div>
          <div class="tg-biz-list-row"><span>演示期间排水量</span><strong>{{n(r.input.rainDrainM3h*r.input.rainDurationH)}} m³</strong></div>
          <div class="tg-biz-list-row"><span>预计末储量</span><strong>{{n(r.rainEndM3)}} m³</strong></div>
          <el-progress style="margin-top:15px" :percentage="Math.round(r.rainEndM3/r.input.rainStorageCapacityM3*100)"
            :status="r.rainOverflowM3>0?'exception':undefined"/>

        </section>
        <section class="tg-biz-card art-card" data-testid="rain-automatic-events">
          <PortOperationsCaseBoard mode="compact" source-system-id="rain"/>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.tg-rain-actionbar{
  display:flex;align-items:center;justify-content:flex-end;
  min-height:44px;flex:0 0 auto;height:auto;
  margin:0 0 14px;padding:0;
}
.tg-rain-actionbar .tg-biz-actions{position:relative;display:flex;
  justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}
.tg-rain-activity{display:flex;align-items:center;gap:9px;margin:0 0 12px;
  min-height:36px;padding:8px 12px;
  background:var(--default-box-color,#fff);border:1px solid var(--art-card-border,#dfeaf1);
  border-radius:8px;color:#53869c;font-size:12px}
.tg-rain-activity.risk{color:#a56e32;border-color:#e7c9a1}
.tg-rain-activity-dot{width:7px;height:7px;border-radius:50%;background:#55a48c}
.tg-rain-activity.risk .tg-rain-activity-dot{background:#c89752}
.tg-rain-activity small{font-size:10px;color:#879eaa;margin-left:auto}
@media(max-width:650px){
  .tg-rain-actionbar{min-height:40px}
  .tg-rain-actionbar .tg-biz-actions{width:100%}
}
</style>

<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {useScenarioStore} from '../simulation/store'
import './business.css'
import './scenario-pages.css'
const router=useRouter(),store=useScenarioStore()
const r=computed(()=>store.result)
const n=(v:number)=>v.toLocaleString('zh-CN',{maximumFractionDigits:1})
</script>
<template>
  <main class="tg-biz tg-analysis-page page-fill">
    <div class="tg-biz-head">
      <div><div class="tg-page-eyebrow">水资源管理 / 雨水收集</div><h1>雨水调蓄风险</h1>
        <p class="tg-biz-sub">降雨径流 → 有效库容 → 假设排水能力 → 条件溢流</p></div>
      <div class="tg-biz-actions"><span class="tg-datamode" :class="{sim:store.running}">{{store.running?'SIM · 情景联动':'现场数据未接入'}}</span>
        <el-button @click="router.push('/port/process/rain?facility=EQ-Y-DRAIN')">雨水收集工艺</el-button></div>
    </div>
    <div class="tg-biz-note"><b>工程边界：</b>面积、径流系数、库容、排水能力均为模拟假设。尚未核实全港雨污分流、水质、许可排放、管线连接，不能将模拟外排作为现场调度建议。</div>
    <div v-if="!r" class="tg-analysis-empty">
      <div class="tg-empty-icon">◇</div><h2>尚未启动情景推演</h2>
      <p>请在统一控制台选择“强降雨入池”。页面只展示同一次推演的结果，不设单独的雨量、用水量调整控件。</p>
      <el-button type="primary" plain @click="store.openConsole()">打开统一推演控制台</el-button>
    </div>
    <template v-else>
      <section class="tg-analysis-summary">
        <span class="tg-sim-badge">SIM / {{store.activeScenario?.title}}</span>
        <strong>{{r.input.rainMm>0?(r.rainOverflowM3>0?'演示条件下存在调蓄溢流风险':'当前演示降雨未计算出溢流'):'本轮情景未设定降雨量'}}</strong>
        <p>仅按独立演示集水单元进行计算，不代表南北多个集水池的实际汇水关系，不将雨水自动计入生产供水。</p>
      </section>
      <div class="tg-biz-grid">
        <div class="tg-biz-card art-card"><h2>假设降雨量</h2><p class="tg-biz-kpi">{{r.input.rainMm}} <small>mm</small></p><p>降雨历时 {{r.input.rainDurationH}} 小时</p></div>
        <div class="tg-biz-card art-card"><h2>径流汇入量</h2><p class="tg-biz-kpi">{{n(r.rainCapturedM3)}} <small>m³</small></p><p>雨量 × 汇水面积 × 径流系数</p></div>
        <div class="tg-biz-card art-card"><h2>条件溢流</h2><p class="tg-biz-kpi" :class="{risk:r.rainOverflowM3>0}">{{n(r.rainOverflowM3)}} <small>m³</small></p><p>考虑假设排水能力后的超库容水量</p></div>
      </div>
      <div class="tg-biz-grid two">
        <section class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>独立集水池库容条件</h2><span class="tg-biz-chip warn">演示参考</span></div>
          <div class="tg-biz-list-row"><span>初始储量</span><strong>{{n(r.input.rainStorageInitialM3)}} m³</strong></div>
          <div class="tg-biz-list-row"><span>假设总库容</span><strong>{{n(r.input.rainStorageCapacityM3)}} m³</strong></div>
          <div class="tg-biz-list-row"><span>演示期间排水量</span><strong>{{n(r.input.rainDrainM3h*r.input.rainDurationH)}} m³</strong></div>
          <div class="tg-biz-list-row"><span>预计末储量</span><strong>{{n(r.rainEndM3)}} m³</strong></div>
          <el-progress style="margin-top:15px" :percentage="Math.round(r.rainEndM3/r.input.rainStorageCapacityM3*100)"
            :status="r.rainOverflowM3>0?'exception':undefined"/>
          <p class="tg-mini-note">库容试算只适用于同一演示集水单元，不验证全场真实排水拓扑。</p>
        </section>
        <section class="tg-biz-card art-card">
          <h2>风险线索与人工核查</h2>
          <div class="tg-biz-steps"><span>雨量情景（SIM）</span><b>→</b><span>径流估算</span><b>→</b><span>库存约束</span><b>→</b><span>人工核验</span></div>
          <p>如果出现模拟溢流，应核查真实液位、排水泵工况、水质和合法去向。未有批准条件不能“雨前腾库”或执行自动外排。</p>
          <div v-for="event in r.events.filter(e=>e.domain==='雨水')" :key="event.id" class="tg-scenario-evidence">
            <strong>{{event.id}} · {{event.title}}</strong><span>{{event.evidence}}</span>
          </div>
          <p class="tg-mini-note">目前未建立雨水独立监护规则；中压泵监护不代表雨水溢流监测。可到雨水设计节点记录本轮SIM人工核查。</p>
          <div class="tg-biz-actions" style="margin-top:15px">
            <el-button type="primary" plain
              @click="router.push('/port/process/rain?facility=EQ-Y-DRAIN')">
              查看排水沟及闸门设计节点
            </el-button>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>

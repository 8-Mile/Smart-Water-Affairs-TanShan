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
      <div><div class="tg-page-eyebrow">水资源管理 / 生产供水保障</div><h1>大机供水保障</h1>
        <p class="tg-biz-sub">用水负荷 → 中压供水能力 → 优先级分配 → 供水缺口 → 水池安全储量</p></div>
      <div class="tg-biz-actions"><span class="tg-datamode" :class="{sim:store.running}">{{store.running?'SIM · 情景联动':'现场数据未接入'}}</span>
        <el-button @click="router.push('/port/process/middle')">中压供水工艺</el-button></div>
    </div>
    <div class="tg-biz-note"><b>数据说明：</b>{{store.running?'以下全部来自统一推演控制台，是演示假设而非实际用水量、管网输水能力。':'现场大机负荷与泵组能力尚未接入；本页没有模拟参数调整入口，只接收全局“情景推演”结果。'}}</div>
    <div v-if="!r" class="tg-analysis-empty">
      <div class="tg-empty-icon">◇</div><h2>尚未运行统一情景</h2>
      <p>在系统右下角“情景推演”统一入口选择情景，所有业务页面使用同一次推演结果，不必重新填写用水量。</p>
      <el-button type="primary" plain @click="store.openConsole()">打开统一推演控制台</el-button>
    </div>
    <template v-else>
      <section class="tg-analysis-summary">
        <span class="tg-sim-badge">SIM / {{store.activeScenario?.title}}</span>
        <strong>{{r.shortageM3h>0?'演示条件下存在供水缺口':'演示条件下供水需求可覆盖'}}</strong>
        <p>采用预设优先级分配，未进行泵性能曲线、管网水力、真实作业状态或水质校核，不形成实际供水调度指令。</p>
      </section>
      <div class="tg-biz-grid">
        <div class="tg-biz-card art-card"><h2>演示用水需求</h2><p class="tg-biz-kpi">{{n(r.demandedM3h)}} <small>m³/h</small></p><p>当前情景终端需求总计</p></div>
        <div class="tg-biz-card art-card"><h2>可分配能力</h2><p class="tg-biz-kpi">{{n(r.usableCapacityM3h)}} <small>m³/h</small></p><p>假设供水能力减去预留流量</p></div>
        <div class="tg-biz-card art-card"><h2>供水缺口</h2><p class="tg-biz-kpi" :class="{risk:r.shortageM3h>0}">{{n(r.shortageM3h)}} <small>m³/h</small></p><p>纯模拟，不写生产告警</p></div>
      </div>
      <div class="tg-biz-grid two">
        <section class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>终端需求与分配</h2><span class="tg-biz-chip">优先级假设</span></div>
          <el-table :data="r.terminalAssessments" stripe style="width:100%">
            <el-table-column prop="label" label="演示终端" min-width="170"/>
            <el-table-column label="需求" width="80"><template #default="{row}">{{n(row.demandM3h)}}</template></el-table-column>
            <el-table-column label="分配" width="80"><template #default="{row}">{{n(row.allocatedM3h)}}</template></el-table-column>
            <el-table-column label="缺口" width="75"><template #default="{row}"><b :class="{'tg-risk-text':row.shortageM3h>0}">{{n(row.shortageM3h)}}</b></template></el-table-column>
          </el-table>
          <p class="tg-mini-note">A/B/C/D均为演示用水点编号，并非已核实的唐港机位或设备台账。</p>
        </section>
        <section class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>安全储量预判</h2><span class="tg-biz-chip" :class="{warn:r.poolRisk!=='normal'}">{{r.poolRisk==='normal'?'未触及安全线':'安全储量风险'}}</span></div>
          <div class="tg-pool-status">
            <div><small>起始储量</small><strong>{{n(r.input.poolInitialM3)}} m³</strong></div>
            <div><small>{{r.input.horizonHours}}小时预测储量</small><strong>{{n(r.forecastPoolM3)}} m³</strong></div>
            <div><small>假设安全线</small><strong>{{n(r.input.poolSafetyM3)}} m³</strong></div>
          </div>
          <div class="tg-volume-trend">
            <div v-for="point in r.poolPoints" :key="point.hour" class="tg-volume-point">
              <div class="tg-volume-track"><div :style="{height:(point.volumeM3/r.input.poolCapacityM3*100)+'%'}" :class="{warn:point.volumeM3<=r.input.poolSafetyM3}"/></div>
              <small>{{point.hour}}h</small>
            </div>
          </div>
          <p class="tg-mini-note">{{r.hoursToSafety===null?'本窗口未预计触及安全线':'保持本次假设流量，约 '+r.hoursToSafety+'小时触及安全线。'}} V(t)=clamp(V0+(Q入−Q出)×t,0,C)。真实水位库容曲线未接入。</p>
        </section>
      </div>
      <section class="tg-biz-card art-card tg-analysis-footer">
        <div><h2>跨业务联动</h2><p>同一供水缺口会出现在智能监护的模拟线索中；不会写入真实告警或工单。雨水收集不能自动视为生产供水来源。</p></div>
        <el-button type="primary" plain @click="router.push('/port/operations/monitor')">查看智能监护</el-button>
      </section>
    </template>
  </main>
</template>

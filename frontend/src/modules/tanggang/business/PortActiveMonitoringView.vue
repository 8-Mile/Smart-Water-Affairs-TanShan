<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {useScenarioStore} from '../simulation/store'
import './business.css'
import './scenario-pages.css'
const router=useRouter(),store=useScenarioStore()
const r=computed(()=>store.result)
</script>
<template>
  <main class="tg-biz tg-analysis-page page-fill">
    <div class="tg-biz-head">
      <div><div class="tg-page-eyebrow">运行处置 / 提前识别</div><h1>主动智能监护</h1>
        <p class="tg-biz-sub">多测点联合诊断 · 供水异常线索 · 统一事件与工单入口</p></div>
      <div class="tg-biz-actions"><span class="tg-datamode" :class="{sim:store.running}">{{store.running?'SIM · 情景联动':'现场数据未接入'}}</span>
        <el-button @click="router.push('/alarm/realtime')">生产告警中心</el-button></div>
    </div>
    <div class="tg-biz-note"><b>业务边界：</b>本页不生成真实生产告警或维修工单，不下发PLC命令；压力、电流定值均仅演示参考，实际定值与厂家测点质量待核实。</div>
    <div v-if="!r" class="tg-analysis-empty">
      <div class="tg-empty-icon">◇</div><h2>等待统一推演情景</h2>
      <p>只在全局推演控制台选择情景。这里自动关联泵组状态、供水不足和雨水风险，不单独设置模拟数值。</p>
      <el-button type="primary" plain @click="store.openConsole()">打开统一推演控制台</el-button>
    </div>
    <template v-else>
      <section class="tg-analysis-summary"><span class="tg-sim-badge">SIM / {{store.activeScenario?.title}}</span>
        <strong>{{r.pumpDiagnosis.title}}</strong>
        <p>多参数诊断仅作为待核查线索，不等于确定设备故障原因，也不代表真实SCADA在线监控。</p>
      </section>
      <div class="tg-biz-grid">
        <div class="tg-biz-card art-card"><h2>模拟压力</h2><p class="tg-biz-kpi">{{r.input.pressureMpa??'缺测'}} <small>MPa</small></p><p>假设参考下限1.15 MPa</p></div>
        <div class="tg-biz-card art-card"><h2>模拟电流</h2><p class="tg-biz-kpi" :class="{risk:(r.input.currentA??0)>120}">{{r.input.currentA??'缺测'}} <small>A</small></p><p>假设参考上限120 A</p></div>
        <div class="tg-biz-card art-card"><h2>模拟关联线索</h2><p class="tg-biz-kpi">{{r.events.length}}</p><p>SIM事件不进入生产事件表</p></div>
      </div>
      <div class="tg-biz-grid two">
        <section class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>联判依据</h2><span class="tg-biz-chip" :class="{warn:r.pumpDiagnosis.level!=='normal'}">{{r.pumpDiagnosis.level==='normal'?'模拟正常':'待人工核查'}}</span></div>
          <div v-for="line in r.pumpDiagnosis.evidence" :key="line" class="tg-biz-list-row">
            <span>{{line}}</span><span class="tg-biz-chip">SIM</span>
          </div>
          <p class="tg-mini-note">流量尚无额定工况与末端用水依据，因此不能仅按固定绝对流量判故障。缺测不能按零计算。</p>
        </section>
        <section class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>关联线索与核查</h2><span class="tg-biz-chip warn">只读证据</span></div>
          <div v-if="!r.events.length" class="tg-biz-empty">本情景没有触发定义的模拟风险，不代表港区现场无故障。</div>
          <div v-for="event in r.events" :key="event.id" class="tg-scenario-evidence">
            <strong>{{event.id}} · {{event.title}}</strong><span>{{event.evidence}}</span>
            <el-button link type="primary" @click="router.push(event.path)">关联业务 →</el-button>
          </div>
          <h3 class="tg-check-title">建议核查</h3>
          <div v-for="(check,i) in r.pumpDiagnosis.checks" :key="check" class="tg-biz-list-row"><span>{{i+1}}. {{check}}</span></div>
        </section>
      </div>
      <section class="tg-biz-card art-card tg-analysis-footer">
        <div><h2>统一处置源</h2><p>真实告警确认、维修派工及恢复复核仍由5190现有告警工单处理；本页的SIM线索只能查看，不能当作生产事故受理。</p></div>
        <div class="tg-biz-actions"><el-button @click="router.push('/port/water/supply')">查看供水影响</el-button>
          <el-button type="primary" plain @click="router.push('/alarm/realtime')">原告警中心</el-button></div>
      </section>
    </template>
  </main>
</template>

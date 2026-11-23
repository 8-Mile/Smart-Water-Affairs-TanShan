<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {useScenarioStore} from '../simulation/store'
import {processName} from '../simulation/waterOperations'
import PortOperatingInputs from './PortOperatingInputs.vue'
import PortOperationsCaseBoard from './PortOperationsCaseBoard.vue'
import PublishedBoards from './PublishedBoards.vue'
import './business.css'

const store=useScenarioStore()
const router=useRouter()
const result=computed(()=>store.result)
const inputs=computed(()=>store.activeInputs)
const review=computed(()=>store.monitorEvidence)
const risk=computed(()=>result.value?.pumpDiagnosis.level||'normal')
const format=(v:number|null|undefined,d=1)=>v===null||v===undefined?'—':
  v.toLocaleString('zh-CN',{maximumFractionDigits:d})
const rules=computed(()=>review.value?.rules||[])
function riskLabel(v:string){
  return v==='critical'?'异常':v==='attention'?'关注':v==='independent'?'独立':'正常'
}
</script>

<template>
  <main class="tg-biz tg-monitor-v2 page-fill" data-testid="tg-monitor-main">
    <div class="tg-monitor-toolbar">
      <span class="tg-monitor-mode" data-testid="monitor-mode">
        <i :class="{manual:!store.autoEnabled}"/>
        {{store.autoEnabled?'自动监护':store.running?'人工参数':'数据未接入'}}
      </span>
      <span class="tg-monitor-count">{{store.pendingCaseCount}} 条待处理</span>
      <div class="tg-monitor-tools">
        <PortOperatingInputs context="pump"/>
        <el-button plain @click="router.push('/alarm/realtime')">告警中心</el-button>
      </div>
    </div>

    <template v-if="result&&inputs">
      <div class="tg-monitor-kpis">
        <section class="tg-biz-card">
          <span>泵组状态</span>
          <strong :class="{danger:risk==='critical'}">{{inputs.pumpState==='fault'?'异常':'运行'}}</strong>
          <small>{{riskLabel(risk)}} · 中压供水</small>
        </section>
        <section class="tg-biz-card">
          <span>出口压力</span>
          <strong>{{format(inputs.pressureMpa,2)}} <em>MPa</em></strong>
          <small>当前计算输入</small>
        </section>
        <section class="tg-biz-card">
          <span>运行电流</span>
          <strong>{{format(inputs.currentA)}} <em>A</em></strong>
          <small>当前计算输入</small>
        </section>
        <section class="tg-biz-card">
          <span>供水缺口</span>
          <strong :class="{danger:result.shortageM3h>0}">{{format(result.shortageM3h)}} <em>m³/h</em></strong>
          <small>{{format(result.deliveredM3h)}} / {{format(result.demandedM3h)}} m³/h 已分配</small>
        </section>
      </div>

      <div v-if="result.events.length" class="tg-monitor-immediate"
        data-testid="monitor-current-findings">
        <span class="tg-monitor-immediate-title">当前规则发现</span>
        <div v-for="event in result.events" :key="event.id" class="tg-monitor-finding">
          <span class="tg-monitor-risk-dot" :class="event.level"/>
          <strong>{{event.title}}</strong>
          <span>{{event.evidence}}</span>
        </div>
      </div>

      <div class="tg-monitor-columns">
        <section class="tg-biz-card tg-monitor-events" data-testid="monitor-auto-case-board">
          <PortOperationsCaseBoard mode="full"/>
        </section>
        <section class="tg-biz-card tg-monitor-impact" data-testid="monitor-process-impact">
          <div class="tg-monitor-cardhead">
            <h2>关联工艺</h2>
            <el-button link @click="router.push('/port/water/supply')">供水分配</el-button>
          </div>
          <div v-for="impact in store.processImpacts" :key="impact.systemId"
            class="tg-monitor-impact-row">
            <span class="tg-monitor-risk-dot" :class="impact.level"/>
            <strong>{{processName(impact.systemId)}}</strong>
            <span class="tg-monitor-impact-text">{{riskLabel(impact.level)}}</span>
            <el-button link size="small"
              @click="router.push('/port/process/'+impact.systemId)">查看</el-button>
          </div>
          <div class="tg-monitor-links">
            <el-button plain size="small"
              @click="router.push('/port/process/middle')">中压泵工艺</el-button>
            <el-button plain size="small"
              @click="router.push('/port/operations/decision')">处置方案</el-button>
          </div>
        </section>
      </div>

      <details class="tg-biz-card tg-monitor-rules" data-testid="monitor-rule-details">
        <summary>监护规则与记录 <span>{{rules.length}} 项</span></summary>
        <div class="tg-monitor-rules-table">
          <table>
            <thead><tr><th>规则</th><th>判据</th><th>检测</th></tr></thead>
            <tbody>
              <tr v-for="item in rules" :key="item.id">
                <td>{{item.label}}</td><td>{{item.threshold}}</td>
                <td :class="{danger:item.outcome==='TRIGGERED'}">
                  {{item.outcome==='TRIGGERED'?'关注':item.outcome==='INSUFFICIENT'?'缺测':'正常'}}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <PublishedBoards target="/port/operations/monitor"/>
    </template>
    <section v-else class="tg-biz-card tg-monitor-empty">
      <strong>暂无运行数据</strong>
      <el-button size="small" @click="store.resumeAuto()">启动自动数据</el-button>
    </section>
  </main>
</template>

<style scoped>
.tg-monitor-v2{display:flex;flex-direction:column;gap:13px;min-width:0}
.tg-monitor-toolbar{min-height:46px;display:flex;align-items:center;justify-content:flex-end;
  flex-wrap:wrap;gap:9px;margin-bottom:1px}
.tg-monitor-mode{display:flex;align-items:center;gap:7px;color:#477f94;font-size:12px}
.tg-monitor-mode i{height:7px;width:7px;border-radius:50%;background:#55a18a}
.tg-monitor-mode i.manual{background:#c79958}
.tg-monitor-count{font-size:11px;color:#8a9eaa;margin-right:auto}
.tg-monitor-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tg-monitor-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}
.tg-monitor-kpis .tg-biz-card{display:flex;flex-direction:column;gap:8px;padding:14px 17px}
.tg-monitor-kpis span{font-size:11px;color:#819baa}
.tg-monitor-kpis strong{font-size:24px;line-height:1.2;color:#307d9f;font-weight:700}
.tg-monitor-kpis strong.danger{color:#b77e49}
.tg-monitor-kpis em{font-size:11px;font-style:normal;font-weight:400}
.tg-monitor-kpis small{font-size:10px;color:#95a6af}
.tg-monitor-immediate{padding:11px 15px;border:1px solid #e6ccaa;
  background:rgba(255,249,239,.86);border-radius:9px}
.tg-monitor-immediate-title{font-size:11px;font-weight:650;color:#aa7f48}
.tg-monitor-finding{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding-top:7px;font-size:11px;color:#738ca0}
.tg-monitor-finding strong{color:#ab7844}
.tg-monitor-finding>span:last-child{flex:1}
.tg-monitor-columns{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(310px,.8fr);
  gap:13px;align-items:start}
.tg-monitor-events,.tg-monitor-impact{min-width:0;padding:17px}
.tg-monitor-cardhead{display:flex;justify-content:space-between;align-items:center;
  gap:9px;margin-bottom:13px}
.tg-monitor-cardhead h2{margin:0!important}
.tg-monitor-impact-row{display:flex;gap:8px;align-items:center;padding:10px 0;
  border-bottom:1px solid #e3edf2;color:#718e9d;font-size:11px}
.tg-monitor-impact-row strong{flex:1;font-size:11px;color:#50768a}
.tg-monitor-impact-text{font-size:10px;color:#8c9fa9}
.tg-monitor-risk-dot{background:#69a7bb;width:7px;height:7px;border-radius:50%}
.tg-monitor-risk-dot.attention{background:#c9a260}
.tg-monitor-risk-dot.critical{background:#cc8062}
.tg-monitor-risk-dot.independent{background:#a2b5bd}
.tg-monitor-links{display:flex;gap:8px;margin-top:15px;flex-wrap:wrap}
.tg-monitor-rules{padding:14px 18px}
.tg-monitor-rules summary{cursor:pointer;display:flex;align-items:center;
  justify-content:space-between;color:#587c8e;font-size:12px;font-weight:600}
.tg-monitor-rules summary span{font-size:10px;color:#98aab4}
.tg-monitor-rules-table{overflow-x:auto;margin-top:12px}
.tg-monitor-rules-table table{border-collapse:collapse;width:100%;font-size:11px}
.tg-monitor-rules-table th,.tg-monitor-rules-table td{padding:10px;
  text-align:left;border-bottom:1px solid #e0ebf1}
.tg-monitor-rules-table th{color:#829ba9;background:#f5fafc}
.tg-monitor-rules-table td{color:#567d91}
.tg-monitor-rules-table td.danger{color:#b47544}
.tg-monitor-empty{display:flex;align-items:center;justify-content:space-between}
@media(max-width:1150px){.tg-monitor-columns{grid-template-columns:1fr}}
@media(max-width:720px){.tg-monitor-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
 .tg-monitor-toolbar{justify-content:flex-start}
 .tg-monitor-count{margin-right:0}
 .tg-monitor-tools{width:100%}}
</style>

<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {useScenarioStore} from '../simulation/store'
import type {MonitorRuleEvidence} from '../simulation/monitorEvidence'
import './business.css'
import './scenario-pages.css'

const router=useRouter(),store=useScenarioStore()
const current=computed(()=>store.monitorEvidence)
const r=computed(()=>store.result)
const expanded=ref<string[]>([])
const note=ref('')
const conclusion=ref<'requires-field-check'|'sim-recovery-conditions'>('requires-field-check')
const reviewError=ref('')
const riskText=computed(()=>{
  if(!current.value)return ''
  return {
    normal:'未命中当前演示规则',attention:'演示联判线索待核查',
    critical:'模拟设备异常待核查',insufficient:'有效观测不足，无法判断',
  }[current.value.risk]
})
const latest=computed(()=>current.value?.trace[current.value.trace.length-1]||null)
const fmt=(value:unknown,unit='')=>value===null||value===undefined?'缺测':String(value)+(unit?' '+unit:'')
const ruleLabel=(r:MonitorRuleEvidence)=>r.outcome==='TRIGGERED'?'模拟命中':
  r.outcome==='INSUFFICIENT'?'依据不足':'未命中'

watch(()=>store.runNumber,()=>{
  expanded.value=[]
  note.value=''
  conclusion.value='requires-field-check'
  reviewError.value=''
})
watch(()=>store.monitorReview?.status,status=>{
  if(status==='investigating')reviewError.value=''
})
function begin(){
  try{store.beginMonitorReview()}catch(e){ElMessage.error(e instanceof Error?e.message:'无法开始模拟核查')}
}
function record(){
  reviewError.value=''
  try{
    store.recordMonitorReview(conclusion.value,note.value)
    ElMessage.success('SIM核查记录已保存在本次浏览器情景中')
  }catch(e){reviewError.value=e instanceof Error?e.message:'记录失败'}
}
function exportEvidence(){
  if(!store.running||!current.value||!store.activeId)return
  const payload={
    reportType:'TG-SIM-MONITOR-REVIEW',
    stage:'DOCUMENT_BASED_DEMO',
    sourceScope:'USER_UPLOADED_MATERIALS_AND_DEMO_ASSUMPTIONS',
    dataMode:'SIM',
    fieldVerified:false,
    historicalSamples:false,
    productionAlarmCreated:false,
    repairOrderCreated:false,
    operatorActionExecuted:false,
    scenarioId:store.activeId,runNumber:store.runNumber,
    scenarioStartedAt:store.startedAt,
    inputs:store.effectiveScenario?.inputs,
    assessment:current.value,
    review:store.monitorReview,
    warning:'只用于研发演示与规则检验，合成时序不是现场历史，未进行现场设备诊断或恢复验收',
  }
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const link=document.createElement('a')
  link.href=url
  link.download='唐港-SIM监护核查-'+store.runNumber+'.json'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1500)
}
</script>

<template>
  <main class="tg-biz tg-analysis-page tg-monitor-page page-fill">
    <div class="tg-biz-head">
      <div>
        <h1>主动智能监护</h1>
      </div>
      <div class="tg-biz-actions">
        <span class="tg-datamode" :class="{sim:store.running}">
          {{store.running?'SIM · 合成样本':'现场数据未核实'}}
        </span>
        <el-button plain @click="router.push('/alarm/realtime')">告警中心</el-button>
      </div>
    </div>

    <div v-if="!current" class="tg-analysis-empty">
      <h2>尚未运行情景</h2>
      <p>选择统一情景后，可以查看模拟监护规则、诊断证据和核查流程。</p>
      <el-button type="primary" plain @click="store.openConsole()">打开情景推演</el-button>
    </div>

    <template v-else>
      <div class="tg-monitor-status">
        <div>
          <span class="tg-monitor-overline">SIM / {{store.activeScenario?.title}} / 第{{store.runNumber}}轮</span>
          <strong>{{riskText}}</strong>
          <p>合成观测用于演示规则计算，不能视为唐港现场采样、设备诊断或预测性维护。</p>
        </div>
        <div class="tg-monitor-status-tools">
          <el-button plain size="small" @click="store.openConsole()">调整情景</el-button>
          <el-button plain size="small" @click="exportEvidence">导出SIM证据</el-button>
        </div>
      </div>

      <div class="tg-monitor-values">
        <div><span>设备状态</span><strong>{{latest?.pumpState==='fault'?'模拟异常':latest?.pumpState==='running'?'模拟运行':'模拟停止'}}</strong></div>
        <div><span>假设压力</span><strong>{{fmt(latest?.pressureMpa,'MPa')}}</strong></div>
        <div><span>假设电流</span><strong>{{fmt(latest?.currentA,'A')}}</strong></div>
        <div><span>假设流量</span><strong>{{fmt(latest?.flowM3h,'m³/h')}}</strong></div>
      </div>

      <div class="tg-monitor-workflow">
        <div class="tg-monitor-evidence">
          <section class="tg-biz-card art-card">
            <div class="tg-biz-card-head">
              <h2>联判规则与证据</h2>
              <span class="tg-monitor-secondary">演示规则 v1 · 非PLC定值</span>
            </div>
            <el-table :data="current.rules" row-key="id" class="tg-monitor-rule-table"
              :expand-row-keys="expanded"
              @expand-change="(_row:MonitorRuleEvidence,rows:MonitorRuleEvidence[])=>{expanded=rows.map(x=>x.id)}">
              <el-table-column type="expand" width="34">
                <template #default="{row}">
                  <div class="tg-monitor-rule-expand">
                    <p>{{row.reason}}</p>
                    <div class="tg-monitor-snapshots">
                      <span v-for="sample in row.samples" :key="sample.offsetSec"
                        :class="{bad:sample.quality!=='GOOD',hit:sample.conditionMet===true}">
                        {{sample.offsetSec}}s · {{sample.value}} · {{sample.quality}}
                      </span>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="规则" min-width="130">
                <template #default="{row}"><strong class="tg-monitor-rule-name">{{row.label}}</strong></template>
              </el-table-column>
              <el-table-column label="模拟判据" min-width="160">
                <template #default="{row}">{{row.threshold}}</template>
              </el-table-column>
              <el-table-column label="持续条件" min-width="100" align="right">
                <template #default="{row}">{{row.requiredSec}}s</template>
              </el-table-column>
              <el-table-column label="核查结果" min-width="110" align="right">
                <template #default="{row}">
                  <span class="tg-monitor-rule-state" :class="{warn:row.outcome==='TRIGGERED'}">
                    {{ruleLabel(row)}}
                  </span>
                </template>
              </el-table-column>
            </el-table>
            <p class="tg-monitor-sample-note">
              时间轴为同一情景假设重复生成的 -90、-60、-30、0 秒相对样本；60秒持续判断仅用于验证逻辑，未采集任何真实历史。
              流量因缺少额定工况，不参与固定故障阈值。
            </p>
          </section>

          <section class="tg-biz-card art-card">
            <div class="tg-biz-card-head">
              <h2>关联影响</h2>
              <el-button link @click="router.push('/port/water/supply')">供水保障</el-button>
            </div>
            <div class="tg-monitor-impact">
              <div>
                <span>模拟供水缺口</span>
                <strong :class="{warn:r&&r.shortageM3h>0}">{{r?.shortageM3h??0}} m³/h</strong>
              </div>
              <div>
                <span>演示线索</span>
                <strong>{{r?.events.length??0}} 项</strong>
              </div>
              <div>
                <span>恢复条件</span>
                <strong>{{current.recoveryCandidate?'合成阈值满足':'尚未满足'}}</strong>
              </div>
            </div>
            <p class="tg-monitor-sample-note">{{current.recoveryExplanation}}</p>
          </section>
        </div>

        <section class="tg-biz-card art-card tg-monitor-review">
          <div class="tg-biz-card-head">
            <h2>模拟核查记录</h2>
            <span class="tg-monitor-secondary">仅当前浏览器 · 不入库</span>
          </div>
          <div class="tg-monitor-steps">
            <div :class="{done:store.monitorReview}"><span>01</span><b>接收模拟线索</b></div>
            <div :class="{done:store.monitorReview?.status==='recorded'}"><span>02</span><b>记录核查结论</b></div>
            <div><span>03</span><b>现场复核（未开展）</b></div>
          </div>
          <template v-if="!store.monitorReview">
            <p class="tg-monitor-review-copy">可以开展一次仅在浏览器内有效的核查演练。模拟异常不会进入正式事件中心，也不会自动派工。</p>
            <el-button type="primary" plain @click="begin">开始模拟核查</el-button>
          </template>
          <template v-else-if="store.monitorReview.status==='investigating'">
            <div class="tg-monitor-case">{{store.monitorReview.caseId}}</div>
            <el-radio-group v-model="conclusion" class="tg-monitor-choices">
              <el-radio value="requires-field-check">需要现场核对</el-radio>
              <el-radio value="sim-recovery-conditions" :disabled="!current.recoveryCandidate">
                仅模拟恢复条件满足
              </el-radio>
            </el-radio-group>
            <el-input v-model="note" type="textarea" :rows="4"
              maxlength="1000" show-word-limit
              placeholder="填写依据、排查意见或仍缺少哪些现场资料"/>
            <p v-if="reviewError" class="tg-monitor-review-error" role="alert">{{reviewError}}</p>
            <el-button type="primary" class="tg-monitor-submit"
              :disabled="note.trim().length<8" @click="record">记录模拟核查</el-button>
          </template>
          <template v-else>
            <div class="tg-monitor-case">{{store.monitorReview.caseId}}</div>
            <strong class="tg-monitor-finished">
              {{store.monitorReview.outcome==='sim-recovery-conditions'?'合成恢复条件满足':'待现场核对'}}
            </strong>
            <p class="tg-monitor-result-note">{{store.monitorReview.note}}</p>
            <p class="tg-monitor-review-copy">模拟记录只保存在当前情景。切换情景、刷新或退出后清空；不构成设备恢复验收。</p>
          </template>
          <div class="tg-monitor-links">
            <el-button plain size="small" @click="router.push('/alarm/realtime')">查看正式告警</el-button>
            <el-button plain size="small" @click="router.push('/repair/list')">查看维修工单</el-button>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.tg-monitor-page{min-width:0}
.tg-monitor-status{display:flex;justify-content:space-between;align-items:center;gap:16px;
  padding:17px 20px;margin-bottom:12px;border-radius:15px;
  border:1px solid rgba(213,228,238,.82);background:rgba(255,255,255,.62)}
.tg-monitor-status>div:first-child{min-width:0}
.tg-monitor-overline{display:block;font-size:11px;color:#899eae;letter-spacing:.025em;margin-bottom:7px}
.tg-monitor-status strong{display:block;color:#2b516a;font-weight:700;font-size:19px}
.tg-monitor-status p{margin:7px 0 0;color:#7f94a3;font-size:11px;line-height:1.5}
.tg-monitor-status-tools{display:flex;gap:6px;flex:0 0 auto}
.tg-monitor-values{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;
  border:1px solid rgba(213,229,238,.8);background:rgba(255,255,255,.65);border-radius:14px;
  margin:0 0 14px;overflow:hidden}
.tg-monitor-values>div{padding:15px 18px;border-right:1px solid rgba(208,225,233,.75)}
.tg-monitor-values>div:last-child{border-right:0}
.tg-monitor-values span,.tg-monitor-impact span{display:block;font-size:11px;color:#849dac}
.tg-monitor-values strong{display:block;margin-top:7px;font-size:17px;color:#315a73;font-weight:670;font-variant-numeric:tabular-nums}
.tg-monitor-workflow{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(290px,.9fr);gap:14px;align-items:start}
.tg-monitor-evidence{display:grid;gap:14px;min-width:0}
.tg-monitor-secondary{color:#93a7b5;font-size:11px}
.tg-monitor-rule-table{font-size:12px;background:transparent}
.tg-monitor-rule-name{font-size:12px;color:#375d76;font-weight:620}
.tg-monitor-rule-state{color:#638499;font-size:11px;white-space:nowrap}
.tg-monitor-rule-state.warn{color:#ad7935;font-weight:630}
.tg-monitor-rule-expand{padding:8px 15px 14px}
.tg-monitor-rule-expand p{font-size:11px;color:#7c92a2;margin:0 0 9px}
.tg-monitor-snapshots{display:flex;gap:6px;flex-wrap:wrap}
.tg-monitor-snapshots span{border:1px solid #d9e7ee;border-radius:7px;
  background:rgba(243,250,253,.8);padding:5px 7px;font-size:10px;color:#69889b}
.tg-monitor-snapshots span.hit{border-color:#ead6b4;color:#9c773e;background:#fdf8ec}
.tg-monitor-snapshots span.bad{border-color:#dfd9d0;background:#f5f4f3}
.tg-monitor-sample-note{font-size:11px!important;color:#91a3af!important;line-height:1.7!important;margin:11px 0 0!important}
.tg-monitor-impact{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.tg-monitor-impact>div{padding:10px 11px;border-radius:9px;background:rgba(242,249,252,.65)}
.tg-monitor-impact strong{display:block;font-size:15px;color:#38627b;margin-top:7px;white-space:nowrap}
.tg-monitor-impact strong.warn{color:#bb813e}
.tg-monitor-review{min-width:0}
.tg-monitor-steps{display:grid;gap:10px;margin:14px 0 20px}
.tg-monitor-steps>div{display:flex;align-items:center;gap:12px;color:#a4b1bc}
.tg-monitor-steps span{display:grid;place-items:center;width:25px;height:25px;
 border-radius:50%;border:1px solid #d8e4eb;color:#8fa2b1;font-size:10px}
.tg-monitor-steps b{font-weight:550;font-size:12px}
.tg-monitor-steps .done{color:#3e738c}
.tg-monitor-steps .done span{color:#3e738c;border-color:#a4cadc;background:#f0f8fc}
.tg-monitor-review-copy{font-size:12px;color:#7c94a3;line-height:1.75;margin:0 0 15px}
.tg-monitor-case{font-size:12px;color:#60829a;font-variant-numeric:tabular-nums;margin-bottom:11px}
.tg-monitor-choices{display:grid;gap:4px;margin:0 0 14px}
.tg-monitor-choices :deep(.el-radio){margin-right:0;white-space:normal;min-height:27px}
.tg-monitor-submit{margin-top:11px;width:100%}
.tg-monitor-review-error{font-size:11px;color:#bc6647;margin:9px 0 0}
.tg-monitor-finished{color:#426b83;font-size:15px}
.tg-monitor-result-note{font-size:12px;line-height:1.8;color:#657e90;white-space:pre-wrap;margin:11px 0}
.tg-monitor-links{display:flex;gap:5px;flex-wrap:wrap;margin-top:22px;border-top:1px solid #e2edf2;padding-top:16px}
@media(max-width:1080px){.tg-monitor-workflow{grid-template-columns:minmax(0,1fr)}}
@media(max-width:730px){
 .tg-monitor-status{flex-direction:column;align-items:flex-start}
 .tg-monitor-values{grid-template-columns:repeat(2,minmax(0,1fr))}
 .tg-monitor-values>div:nth-child(2){border-right:0}
 .tg-monitor-values>div:nth-child(-n+2){border-bottom:1px solid rgba(208,225,233,.75)}
 .tg-monitor-impact{grid-template-columns:1fr}
}
</style>

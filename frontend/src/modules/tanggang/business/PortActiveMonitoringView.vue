<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {useScenarioStore} from '../simulation/store'
import type {MonitorRuleEvidence} from '../simulation/monitorEvidence'
import PublishedBoards from './PublishedBoards.vue'
import {simNodeOrigin,simNodeReturnPath} from './processReviewNavigation'
import './business.css'
import './scenario-pages.css'

const router=useRouter(),route=useRoute(),store=useScenarioStore()
const linkedNode=computed(()=>simNodeOrigin(route.query,store.processChecks,store.runUid))
const current=computed(()=>store.monitorEvidence)
const impact=computed(()=>store.impactAnalysis)
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
    linkedSupplyImpact:impact.value,
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

    <section v-if="linkedNode" class="tg-biz-card art-card tg-monitor-node-origin"
      data-testid="monitor-node-origin">
      <div>
        <strong>来自工艺节点的SIM核查：{{linkedNode.facility_name}}</strong>
        <p>{{linkedNode.note}}</p>
        <small>仅当前模拟轮次 · 不是正式故障记录</small>
      </div>
      <el-button plain size="small"
        @click="router.push(simNodeReturnPath(linkedNode))">返回原工艺节点</el-button>
    </section>

    <PublishedBoards target="/port/operations/monitor" />
    <div v-if="!current" class="tg-analysis-empty">
      <h2>尚未运行情景</h2>
      <p>选择统一情景后，可以查看模拟监护规则、诊断证据和核查流程。</p>
      <el-button type="primary" plain @click="store.openConsole()">打开情景推演</el-button>
    </div>

    <template v-else>
      <section class="tg-biz-card art-card tg-monitor-status">
        <div>
          <span class="tg-monitor-overline">SIM / {{store.activeScenario?.title}} / 第{{store.runNumber}}轮</span>
          <strong>{{riskText}}</strong>
          <p>合成观测用于演示规则计算，不能视为唐港现场采样、设备诊断或预测性维护。</p>
        </div>
        <div class="tg-monitor-status-tools">
          <el-button plain size="small" @click="store.openConsole()">调整情景</el-button>
          <el-button plain size="small" @click="exportEvidence">导出SIM证据</el-button>
        </div>
      </section>

      <section class="tg-biz-card art-card tg-monitor-readings">
        <el-descriptions :column="4" border size="small">
          <el-descriptions-item label="设备状态">
            {{latest?.pumpState==='fault'?'模拟异常':latest?.pumpState==='running'?'模拟运行':'模拟停止'}}
          </el-descriptions-item>
          <el-descriptions-item label="假设压力">{{fmt(latest?.pressureMpa,'MPa')}}</el-descriptions-item>
          <el-descriptions-item label="假设电流">{{fmt(latest?.currentA,'A')}}</el-descriptions-item>
          <el-descriptions-item label="假设流量">{{fmt(latest?.flowM3h,'m³/h')}}</el-descriptions-item>
        </el-descriptions>
      </section>


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
                    <el-table :data="row.samples" stripe size="small" class="tg-monitor-evidence-table">
                      <el-table-column label="相对时间" min-width="90">
                        <template #default="{row:sample}">{{sample.offsetSec}}s</template>
                      </el-table-column>
                      <el-table-column prop="value" label="模拟值" min-width="90"/>
                      <el-table-column prop="quality" label="质量" min-width="80"/>
                      <el-table-column label="规则条件" min-width="105">
                        <template #default="{row:sample}">
                          {{sample.conditionMet===null?'无效':sample.conditionMet?'满足':'不满足'}}
                        </template>
                      </el-table-column>
                    </el-table>
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
              <h2>关联供水影响</h2>
              <el-button link @click="router.push('/port/water/supply')">查看供水保障</el-button>
            </div>
            <p v-if="impact" class="tg-biz-sub">{{impact.conclusion}}</p>
            <el-table v-if="impact" :data="impact.affectedTerminals" stripe
              size="small" class="tg-monitor-affected-table">
              <el-table-column prop="label" label="演示用水点" min-width="170" show-overflow-tooltip/>
              <el-table-column label="需求 m³/h" min-width="94" align="right">
                <template #default="{row}">{{row.demandM3h}}</template>
              </el-table-column>
              <el-table-column label="分配 m³/h" min-width="94" align="right">
                <template #default="{row}">{{row.allocatedM3h}}</template>
              </el-table-column>
              <el-table-column label="缺口 m³/h" min-width="94" align="right">
                <template #default="{row}"><b class="tg-risk-text">{{row.shortageM3h}}</b></template>
              </el-table-column>
              <template #empty>当前演示未产生用水点分配缺口</template>
            </el-table>
            <div v-if="impact" class="tg-biz-list">
              <div v-for="check in impact.checkpoints" :key="check.key" class="tg-biz-list-row">
                <span>{{check.label}}</span>
                <span class="tg-biz-label">待现场核对</span>
              </div>
            </div>
            <p class="tg-monitor-sample-note">{{impact?.restriction}}</p>
          </section>
        </div>

        <section class="tg-biz-card art-card tg-monitor-review">
          <div class="tg-biz-card-head">
            <h2>模拟核查记录</h2>
            <span class="tg-monitor-secondary">仅当前浏览器 · 不入库</span>
          </div>
          <div class="tg-biz-steps">
            <span>模拟线索</span><b>›</b>
            <span>人工核查记录</span><b>›</b>
            <span>现场复核待开展</span>
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
            <el-button plain size="small"
              @click="router.push('/port/process/middle?facility=EQ-P-MID')">查看中压泵组设计设施</el-button>
            <el-button type="primary" plain size="small" @click="router.push('/port/operations/decision')">模拟处置研判</el-button>
            <el-button plain size="small" @click="router.push('/alarm/realtime')">查看正式告警</el-button>
            <el-button plain size="small" @click="router.push('/repair/list')">查看维修工单</el-button>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
/* Use the existing 5190 business tokens/components; no standalone dashboard skin. */
.tg-monitor-node-origin{display:flex;justify-content:space-between;align-items:center;
  flex-wrap:wrap;gap:8px 20px;margin-bottom:14px}
.tg-monitor-node-origin strong{font-size:12px;font-weight:650;color:#365d75}
.tg-monitor-node-origin p{font-size:12px;color:#6c8899;margin:6px 0}
.tg-monitor-node-origin small{font-size:11px;color:#8aa0ad}

.tg-monitor-page{min-width:0}
.tg-monitor-status{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px}
.tg-monitor-overline{display:block;font-size:11px;color:var(--art-gray-500,#8297a6);margin-bottom:7px}
.tg-monitor-status strong{font-size:18px;font-weight:700;color:var(--art-gray-800,#253f55)}
.tg-monitor-status p{font-size:12px;color:var(--art-gray-500,#8297a6);margin:6px 0 0}
.tg-monitor-status-tools{display:flex;gap:6px;flex:0 0 auto}
.tg-monitor-readings{margin-bottom:14px;padding:14px}
.tg-monitor-readings :deep(.el-descriptions__body){background:transparent}
.tg-monitor-workflow{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(290px,.9fr);gap:14px;align-items:start}
.tg-monitor-evidence{display:grid;gap:14px;min-width:0}
.tg-monitor-secondary{color:var(--art-gray-500,#8ea0ae);font-size:11px}
.tg-monitor-rule-table,.tg-monitor-affected-table{font-size:12px;background:transparent;margin-top:10px}
.tg-monitor-rule-name{font-weight:650;color:var(--art-gray-800,#253f55)}
.tg-monitor-rule-state{color:var(--art-gray-600,#718999);font-size:11px}
.tg-monitor-rule-state.warn{color:#a57939;font-weight:650}
.tg-monitor-rule-expand{padding:6px 14px 12px}
.tg-monitor-rule-expand p{font-size:12px;color:var(--art-gray-600,#718999);margin:0 0 9px}
.tg-monitor-evidence-table{width:100%}
.tg-monitor-sample-note{font-size:11px!important;color:var(--art-gray-500,#8297a6)!important;line-height:1.7!important;margin-top:12px!important}
.tg-monitor-review{min-width:0}
.tg-monitor-review-copy,.tg-monitor-result-note{font-size:12px;color:var(--art-gray-600,#718999);line-height:1.7}
.tg-monitor-case{font-size:12px;color:var(--art-gray-600,#718999);margin-bottom:12px}
.tg-monitor-choices{display:grid;gap:5px;margin-bottom:12px}
.tg-monitor-choices :deep(.el-radio){margin-right:0;white-space:normal}
.tg-monitor-submit{width:100%;margin-top:12px}
.tg-monitor-review-error{font-size:12px;color:#b46c4b;margin:8px 0 0}
.tg-monitor-finished{display:block;margin:8px 0;color:var(--art-gray-800,#253f55)}
.tg-monitor-result-note{white-space:pre-wrap;margin:11px 0}
.tg-monitor-links{display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--art-card-border,#dfeaf1);margin-top:18px;padding-top:14px}
@media(max-width:1120px){.tg-monitor-workflow{grid-template-columns:minmax(0,1fr)}}
@media(max-width:730px){
 .tg-monitor-status{flex-direction:column;align-items:flex-start}
 .tg-monitor-readings :deep(.el-descriptions__table){min-width:0}
 .tg-monitor-readings :deep(.el-descriptions__cell){display:block;width:100%!important}
 .tg-monitor-rule-table,.tg-monitor-affected-table{overflow-x:auto}
}
</style>

<script setup lang="ts">
import {computed,onMounted,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage,ElMessageBox} from 'element-plus'
import {useScenarioStore} from '../simulation/store'
import {simContext} from '../simulation/mockContext'
import {
  analyzeSimDecision,fetchSimDecisions,createSimDecision,reviewSimDecision,
  type AiSimDecisionAnalysis,type AiSimDecision,type SimPlanId,
} from '@/api/ai'
import './business.css'
import './scenario-pages.css'

const router=useRouter()
const scenario=useScenarioStore()
const context=computed(()=>simContext(scenario))
const analysis=ref<AiSimDecisionAnalysis|null>(null)
const allCases=ref<AiSimDecision[]>([])
const caseId=ref<number|null>(null)
const currentCase=computed(()=>allCases.value.find(x=>x.id===caseId.value)||null)
const planId=ref<SimPlanId|null>(null)
const rationale=ref('')
const reviewNote=ref('')
const loading=ref(false)
const saving=ref(false)
const error=ref('')
const currentPlan=computed(()=>analysis.value?.plans.find(x=>x.id===planId.value)||null)
const reviewAvailable=computed(()=>!!currentCase.value
  &&currentCase.value.status==='selected'&&!!context.value
  &&context.value.scenario_id===currentCase.value.scenario_id
  &&context.value.run_number>currentCase.value.baseline_run)
const fmt=(n:number)=>n.toLocaleString('zh-CN',{maximumFractionDigits:1})

function errorText(e:unknown){
  const v=e as {response?:{data?:{detail?:string;message?:string}};message?:string}
  return v?.response?.data?.detail||v?.response?.data?.message||v?.message||'模拟操作失败'
}
async function refresh(){
  try{
    const {data}=await fetchSimDecisions()
    allCases.value=data.data||[]
    if(!allCases.value.some(x=>x.id===caseId.value))
      caseId.value=allCases.value[0]?.id||null
  }catch(e){error.value=errorText(e)}
}
async function analyze(){
  analysis.value=null
  planId.value=null
  const data=context.value
  if(!data)return
  loading.value=true
  error.value=''
  try{
    const response=await analyzeSimDecision(data)
    // If a new SIM run started while the request was in flight, discard
    // the older analysis instead of mixing two run numbers.
    if(scenario.runNumber===data.run_number&&scenario.activeId===data.scenario_id)
      analysis.value=response.data.data
  }catch(e){error.value=errorText(e)}
  finally{loading.value=false}
}
async function choose(){
  const plan=currentPlan.value
  const data=context.value
  if(!plan||!data||!analysis.value||rationale.value.trim().length<8)return
  if(data.run_number!==analysis.value.run_number){
    ElMessage.warning('情景已变化，请重新研判')
    return
  }
  const desc=plan.constraint==='CONSTRAINT_FAIL'
    ?'该方案在简化模型内未通过储量约束，只能保存为待核实的演示研究选择。'
    :'该方案在简化模型内未越过所列储量约束，但全部工程前提尚未现场核实。'
  try{
    await ElMessageBox.confirm(
      desc+'确认只保存研究选择，不向泵阀下发指令，也不创建工单？',
      '记录SIM研判',{type:'warning',confirmButtonText:'确认记录',cancelButtonText:'取消'},
    )
  }catch{return}
  saving.value=true
  error.value=''
  try{
    const {data:response}=await createSimDecision(data,plan.id,rationale.value.trim())
    await refresh()
    caseId.value=response.data.id
    rationale.value=''
    ElMessage.success('已记录SIM方案选择，未执行现场调度')
  }catch(e){error.value=errorText(e)}
  finally{saving.value=false}
}
async function review(){
  const c=currentCase.value
  const data=context.value
  if(!c||!data||!reviewAvailable.value||reviewNote.value.trim().length<8)return
  try{
    await ElMessageBox.confirm(
      '复核只比较新旧SIM输入及计算结果，不能证明该方案已实际实施。确定记录本轮模拟复核吗？',
      '确认SIM复核',{type:'warning',confirmButtonText:'保存复核'},
    )
  }catch{return}
  saving.value=true
  error.value=''
  try{
    await reviewSimDecision(c.id,data,reviewNote.value.trim())
    await refresh()
    reviewNote.value=''
    ElMessage.success('SIM复核完成，记录已归档')
  }catch(e){error.value=errorText(e)}
  finally{saving.value=false}
}
watch(()=>[scenario.activeId,scenario.runNumber],()=>{void analyze()})
onMounted(async()=>{await Promise.all([refresh(),analyze()])})
</script>

<template>
  <main class="tg-biz tg-analysis-page page-fill tg-sim-decisions">
    <div class="tg-biz-head">
      <div><h1>模拟处置研判</h1></div>
      <div class="tg-biz-actions">
        <span class="tg-datamode" :class="{sim:scenario.running}">
          {{scenario.running?'SIM · 第'+scenario.runNumber+'轮':'尚未运行情景'}}
        </span>
        <el-button @click="router.push('/port/operations/monitor')">主动智能监护</el-button>
        <el-button plain @click="scenario.openConsole()">情景推演</el-button>
      </div>
    </div>

    <div class="tg-biz-note">
      <b>数据说明：</b>全部为同一浏览器情景计算。三个分析角色为可追溯的Mock规则，不是真实自主Agent；不会批准或执行泵阀调度。
    </div>
    <p v-if="error" class="tg-biz-sub" role="alert">{{error}}</p>
    <div v-if="!context" class="tg-analysis-empty">
      <h2>尚无SIM研判数据</h2>
      <p>请先在统一情景推演中运行一次供水或监护场景，再查看同一轮的方案约束和研判证据。</p>
      <el-button type="primary" plain @click="scenario.openConsole()">打开统一推演</el-button>
    </div>

    <template v-if="context">
      <section class="tg-biz-card art-card" v-loading="loading">
        <div class="tg-biz-card-head">
          <h2>多角色规则研判</h2>
          <el-button size="small" plain @click="analyze">重新分析</el-button>
        </div>
        <div v-if="analysis" class="tg-decision-roles">
          <div v-for="(step,i) in analysis.roles" :key="step.id" class="tg-decision-role">
            <div class="tg-decision-role-title"><span>{{i+1}}. {{step.name}}</span></div>
            <strong>{{step.finding}}</strong>
            <p>{{step.evidence}}</p>
            <p class="tg-mini-note">{{step.limitation}}</p>
          </div>
        </div>
        <p v-if="analysis" class="tg-mini-note">{{analysis.notice}}</p>
      </section>
    </template>

      <div class="tg-biz-grid two tg-decision-workflow"
        :class="{'tg-decision-history-only':!context}">
        <section v-if="context" class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>四种方案的SIM比选</h2></div>
          <el-table v-if="analysis" :data="analysis.plans" size="small" stripe row-key="id">
            <el-table-column label="方案" min-width="150">
              <template #default="{row}"><strong>{{row.title}}</strong></template>
            </el-table-column>
            <el-table-column label="缺口 m³/h" min-width="95" align="right">
              <template #default="{row}">{{fmt(row.shortage_m3h)}}</template>
            </el-table-column>
            <el-table-column label="期末储量 m³" min-width="110" align="right">
              <template #default="{row}">{{fmt(row.raw_end_storage_m3)}}</template>
            </el-table-column>
            <el-table-column label="约束" min-width="115">
              <template #default="{row}">
                {{row.constraint==='CONSTRAINT_FAIL'?'模型约束未通过':'待现场核实'}}
              </template>
            </el-table-column>
            <el-table-column label="选择" width="92">
              <template #default="{row}">
                <el-button size="small" :type="planId===row.id?'primary':'default'"
                  :disabled="saving" @click="planId=row.id">
                  {{planId===row.id?'已选择':'选择'}}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <p class="tg-mini-note">错峰需求没有消失；假设备用能力不代表现场有备用泵，全部方案均未完成水力、设备及生产审批核实。</p>
          <template v-if="currentPlan">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="研究方案">{{currentPlan.title}}</el-descriptions-item>
              <el-descriptions-item label="模拟顺延需求">{{currentPlan.deferred_m3h}} m³/h</el-descriptions-item>
              <el-descriptions-item label="安全储量余量">{{currentPlan.safety_margin_m3}} m³</el-descriptions-item>
              <el-descriptions-item label="实施前提">
                <div v-for="(reason,i) in currentPlan.blockers" :key="i">{{reason}}</div>
                <span v-if="!currentPlan.blockers.length">模型内尚无列明阻断项，但不代表现场可执行</span>
              </el-descriptions-item>
            </el-descriptions>
            <el-input v-model="rationale" type="textarea" :rows="3" maxlength="1000"
              show-word-limit placeholder="填写选择该演示方案的研究依据（至少8字）"/>
            <el-button type="primary" class="tg-decision-submit" :loading="saving"
              :disabled="rationale.trim().length<8" @click="choose">
              记录SIM研究选择
            </el-button>
          </template>
        </section>

        <section class="tg-biz-card art-card">
          <div class="tg-biz-card-head"><h2>选择记录与模拟复核</h2><el-button link @click="refresh">刷新</el-button></div>
          <el-table :data="allCases" size="small" stripe highlight-current-row
            @row-click="(row:AiSimDecision)=>caseId=row.id">
            <el-table-column prop="id" label="编号" width="70"/>
            <el-table-column label="情景/轮次" min-width="115">
              <template #default="{row}">{{row.scenario_id}} / {{row.baseline_run}}</template>
            </el-table-column>
            <el-table-column label="方案" min-width="110">
              <template #default="{row}">{{row.selected_plan.title}}</template>
            </el-table-column>
            <el-table-column label="状态" min-width="85">
              <template #default="{row}">{{row.status==='reviewed'?'已复核':'待复核'}}</template>
            </el-table-column>
            <template #empty>尚无SIM研究选择。可在左侧选中方案并填写依据。</template>
          </el-table>
          <template v-if="currentCase">
            <div class="tg-decision-review">
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="已记录选择">{{currentCase.selected_plan.title}}</el-descriptions-item>
                <el-descriptions-item label="人工研究依据">{{currentCase.rationale}}</el-descriptions-item>
                <el-descriptions-item label="原轮次模拟缺口">{{currentCase.baseline.shortage_m3h}} m³/h</el-descriptions-item>
                <el-descriptions-item label="生产控制">未执行</el-descriptions-item>
              </el-descriptions>
              <template v-if="currentCase.review">
                <el-descriptions :column="1" border size="small">
                  <el-descriptions-item label="复核轮次">第{{currentCase.review.run_number}}轮</el-descriptions-item>
                  <el-descriptions-item label="数值变化">
                    {{currentCase.review.before_shortage_m3h}} → {{currentCase.review.after_shortage_m3h}} m³/h
                    （Δ{{currentCase.review.shortage_delta_m3h}}）
                  </el-descriptions-item>
                  <el-descriptions-item label="复核结果">{{currentCase.review.finding}}</el-descriptions-item>
                  <el-descriptions-item label="复核意见">{{currentCase.review.human_note}}</el-descriptions-item>
                </el-descriptions>
                <p class="tg-mini-note">{{currentCase.review.warning}}</p>
                <el-button plain @click="router.push('/port/analysis/reports')">运行复盘</el-button>
              </template>
              <template v-else>
                <p class="tg-mini-note" v-if="!reviewAvailable">
                  请在统一推演中对同一情景重新运行一轮（可调整经允许的模拟参数），之后记录数值复核；不会自动宣称方案实施成功。
                </p>
                <template v-else>
                  <p>新SIM轮次：第{{context?.run_number}}轮；模拟供水缺口 {{context?.shortage_m3h}} m³/h。</p>
                  <el-input v-model="reviewNote" type="textarea" :rows="3"
                    maxlength="1000" show-word-limit
                    placeholder="填写复核依据、模拟变化及仍未核实事项（至少8字）"/>
                  <el-button type="primary" class="tg-decision-submit" :loading="saving"
                    :disabled="reviewNote.trim().length<8" @click="review">保存本轮SIM复核</el-button>
                </template>
              </template>
            </div>
          </template>
          <div class="tg-biz-actions tg-decision-bottom-links">
            <el-button plain @click="router.push('/port/water/supply')">供水方案比选</el-button>
            <el-button plain @click="router.push('/port/analysis/reports')">运行复盘</el-button>
          </div>
        </section>
      </div>
  </main>
</template>

<style scoped>
.tg-decision-roles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.tg-decision-role{border:1px solid var(--el-border-color-light);border-radius:7px;padding:13px;min-width:0}
.tg-decision-role-title{font-size:13px;font-weight:600;margin-bottom:8px}
.tg-decision-role strong{font-weight:600;font-size:12px;line-height:1.6}
.tg-decision-role p{font-size:12px;line-height:1.55;margin:8px 0 0}
.tg-decision-workflow{margin-top:14px}
.tg-decision-history-only{grid-template-columns:minmax(0,1fr)}
.tg-decision-review{display:grid;gap:12px;margin-top:16px}
.tg-decision-submit{margin-top:10px}
.tg-decision-bottom-links{margin-top:15px;flex-wrap:wrap}
@media(max-width:1000px){.tg-decision-roles{grid-template-columns:1fr}}
@media(max-width:760px){.tg-decision-workflow{grid-template-columns:1fr}.tg-decision-workflow :deep(.el-table__body-wrapper){overflow-x:auto}}
</style>

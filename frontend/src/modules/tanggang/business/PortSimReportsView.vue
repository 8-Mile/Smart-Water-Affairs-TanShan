<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {fetchAiSimReports,type AiSimReport} from '@/api/ai'
import './business.css'

const router=useRouter()
const route=useRoute()
const reports=ref<AiSimReport[]>([])
const selectedId=ref<number|null>(null)
const busy=ref(false)
const error=ref('')
const current=computed(()=>reports.value.find(r=>r.id===selectedId.value)||null)
const report=computed(()=>current.value?.report||null)

async function refresh(){
  busy.value=true
  error.value=''
  try{
    const {data}=await fetchAiSimReports()
    reports.value=data.data||[]
    if(!reports.value.some(x=>x.id===selectedId.value)){
      const requested=Number(route.query.report)
      selectedId.value=Number.isSafeInteger(requested)&&requested>0&&
        reports.value.some(x=>x.id===requested)
          ? requested : reports.value[0]?.id||null
    }
  }catch(e){
    error.value='无法读取SIM复盘记录，请检查Mock服务与登录状态'
    reports.value=[]
  }finally{busy.value=false}
}
const riskText=(v:string)=>({
  normal:'未触发',attention:'模拟关注',critical:'模拟异常',insufficient:'依据不足',
} as Record<string,string>)[v]||v
const reviewText=(v:string)=>({
  not_started:'尚未核查',investigating:'模拟核查中',recorded:'模拟意见已记录',
} as Record<string,string>)[v]||v
function exportReport(){
  if(!current.value)return
  const blob=new Blob([JSON.stringify({
    report_type:'TG-MOCK-SIM-REPLAY',
    ...current.value,
    verified:false,source_type:'BROWSER_SIM_SNAPSHOT',
    warning:'仅用于研发演示，非现场实际运行、正式告警、维修验收或调度依据',
  },null,2)],{type:'application/json;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a')
  a.href=url
  a.download='唐港-SIM运行复盘-'+current.value.id+'.json'
  document.body.append(a);a.click();a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1500)
  ElMessage.success('已导出SIM复盘记录')
}
onMounted(refresh)
</script>

<template>
  <main class="tg-biz page-fill tg-sim-reports">
    <div class="tg-biz-head">
      <div><h1>运行复盘</h1></div>
      <div class="tg-biz-actions">
        <el-tag size="small" effect="plain" type="info">SIM · 演示</el-tag>
        <el-button @click="router.push('/ai/chat')">智能助手</el-button>
        <el-button @click="refresh">刷新</el-button>
      </div>
    </div>
    <p v-if="error" class="tg-biz-sub" role="alert">{{error}}</p>
    <div class="tg-sim-reports-grid">
      <section class="tg-biz-card art-card">
        <div class="tg-biz-card-head"><h2>复盘记录</h2></div>
        <el-table v-loading="busy" :data="reports" size="small" stripe
          highlight-current-row row-key="id"
          @row-click="(row:AiSimReport)=>{selectedId=row.id}">
          <el-table-column prop="id" label="记录" width="72"/>
          <el-table-column label="情景" min-width="115">
            <template #default="{row}">{{row.scenario_id}} / 第{{row.run_number}}轮</template>
          </el-table-column>
          <el-table-column label="供水缺口" min-width="95">
            <template #default="{row}">{{row.report.shortage_m3h}} m³/h</template>
          </el-table-column>
          <template #empty>暂无SIM复盘记录。可从智能助手执行“生成本轮SIM运行复盘报告”。</template>
        </el-table>
      </section>
      <div class="tg-sim-report-detail">
        <template v-if="report">
          <section class="tg-biz-card art-card">
            <div class="tg-biz-card-head">
              <h2>第{{report.run_number}}轮 · {{report.scenario_id}}</h2>
              <el-button plain size="small" @click="exportReport">导出JSON</el-button>
            </div>
            <el-descriptions size="small" border :column="2">
              <el-descriptions-item label="运行属性">SIM合成推演</el-descriptions-item>
              <el-descriptions-item label="来源">浏览器情景快照</el-descriptions-item>
              <el-descriptions-item v-if="report.run_uid" label="SIM轮次标识">
                {{report.run_uid.slice(0,8)}}（本轮唯一）
              </el-descriptions-item>
              <el-descriptions-item label="假设总需水">{{report.demand_m3h}} m³/h</el-descriptions-item>
              <el-descriptions-item label="模拟已分配">{{report.delivered_m3h}} m³/h</el-descriptions-item>
              <el-descriptions-item label="模拟供水缺口">{{report.shortage_m3h}} m³/h</el-descriptions-item>
              <el-descriptions-item label="需求覆盖率">{{report.coverage_percent}}%</el-descriptions-item>
              <el-descriptions-item label="假设期末储量">{{report.pool_forecast_m3}} m³</el-descriptions-item>
              <el-descriptions-item label="监护状态">{{riskText(report.monitor_risk)}}</el-descriptions-item>
              <el-descriptions-item label="核查进度">{{reviewText(report.review_status)}}</el-descriptions-item>
              <el-descriptions-item label="现场核实">尚未完成</el-descriptions-item>
            </el-descriptions>
            <p class="tg-biz-sub tg-replay-conclusion">{{report.conclusion}}</p>
          </section>
          <section class="tg-biz-card art-card">
            <div class="tg-biz-card-head"><h2>影响终端与监护依据</h2></div>
            <el-table :data="report.affected_terminals" size="small" stripe>
              <el-table-column prop="label" label="演示用水点" min-width="145"/>
              <el-table-column prop="demand_m3h" label="需求 m³/h" min-width="100"/>
              <el-table-column prop="allocated_m3h" label="分配 m³/h" min-width="100"/>
              <el-table-column prop="shortage_m3h" label="缺口 m³/h" min-width="100"/>
              <template #empty>本轮模拟无分配不足的演示用水点</template>
            </el-table>
            <div class="tg-biz-list tg-replay-list">
              <div class="tg-biz-list-row">
                <span>模拟命中规则</span>
                <span>{{report.triggered_rules.join('、')||'无'}}</span>
              </div>
              <div class="tg-biz-list-row">
                <span>依据不足的规则</span>
                <span>{{report.insufficient_rules.join('、')||'无'}}</span>
              </div>
            </div>
            <el-button plain size="small" @click="router.push('/port/operations/monitor')">
              查看监护证据
            </el-button>
          </section>
          <section class="tg-biz-card art-card">
            <div class="tg-biz-card-head"><h2>人工核查与待确认事项</h2></div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="核查状态">{{reviewText(report.review_status)}}</el-descriptions-item>
              <el-descriptions-item label="核查结论">
                {{report.review_outcome==='sim-recovery-conditions'?'模拟恢复条件满足':report.review_outcome==='requires-field-check'?'待现场核对':'尚无结论'}}
              </el-descriptions-item>
              <el-descriptions-item label="核查意见">{{report.review_note||'未记录人工核查意见'}}</el-descriptions-item>
            </el-descriptions>
            <div class="tg-biz-list tg-replay-list">
              <div v-for="(item,i) in report.checkpoints" :key="i" class="tg-biz-list-row">
                <span>{{item}}</span><span class="tg-biz-label">待核实</span>
              </div>
            </div>
            <el-descriptions v-if="report.sim_decision" :column="1" border size="small">
              <el-descriptions-item label="关联SIM研究方案">
                #{{report.sim_decision.id}} · {{report.sim_decision.selected_plan_id}}
              </el-descriptions-item>
              <el-descriptions-item label="研究选择依据">{{report.sim_decision.rationale}}</el-descriptions-item>
              <el-descriptions-item label="模拟复核">
                {{report.sim_decision.review?.finding||'待新情景模拟复核'}}
              </el-descriptions-item>
              <el-descriptions-item label="生产处置">未执行</el-descriptions-item>
            </el-descriptions>
            <div v-if="report.process_checks?.length" class="tg-replay-evidence"
              data-testid="report-process-checks">
              <div class="tg-biz-card-head">
                <h2>工艺节点模拟核查（报告生成时）</h2>
                <span class="tg-mini-note">
                  {{report.process_checks.length}}项 · 无正式告警/工单
                </span>
              </div>
              <el-table :data="report.process_checks" size="small" stripe>
                <el-table-column prop="facility_name" label="设计设施" min-width="140"/>
                <el-table-column label="模拟状态" min-width="92">
                  <template #default="{row}">
                    {{row.state==='fault'?'SIM异常':
                      row.state==='attention'?'SIM关注':'模拟正常'}}
                  </template>
                </el-table-column>
                <el-table-column prop="note" label="人工核查意见" min-width="185"
                  show-overflow-tooltip/>
                <el-table-column label="操作" width="96">
                  <template #default="{row}">
                    <el-button link type="primary" size="small"
                      @click="router.push({
                        path:'/port/process/'+row.system_id,
                        query:{facility:row.facility_id},
                      })">查看设施</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <p class="tg-mini-note">
                以上记录是当次浏览器SIM快照中的人工演示意见，
                不是现场巡检、维修验收或正式生产事件。
              </p>
            </div>
            <div v-if="report.sim_evidence" class="tg-replay-evidence">
              <div class="tg-biz-card-head">
                <h2>资料核查状态（报告生成时）</h2>
                <span class="tg-mini-note">
                  {{report.sim_evidence.total}}项 · 已完成现场验证0项
                </span>
              </div>
              <el-table :data="report.sim_evidence.items" size="small" stripe>
                <el-table-column prop="label" label="待核实项" min-width="170"/>
                <el-table-column label="核对进度" min-width="100">
                  <template #default="{row}">
                    {{row.status==='material-requested'?'资料待提供':
                      row.status==='under-review'?'资料核对中':'尚未核对'}}
                  </template>
                </el-table-column>
                <el-table-column label="备注" min-width="170">
                  <template #default="{row}">{{row.note||'未记录'}}</template>
                </el-table-column>
              </el-table>
              <el-button v-if="report.sim_decision" size="small" plain
                @click="router.push({path:'/port/operations/decision',
                  query:{decision:String(report.sim_decision.id)}})">
                查看原研判及核查记录
              </el-button>
            </div>
            <p class="tg-biz-sub">{{report.next_action}}</p>
            <div class="tg-biz-actions">
              <el-button plain @click="router.push('/port/water/supply')">供水保障</el-button>
              <el-button plain @click="router.push('/port/operations/decision')">模拟处置研判</el-button>
              <el-button plain @click="router.push('/port/operations/monitor')">主动监护</el-button>
            </div>
          </section>
        </template>
        <section v-else class="tg-biz-card art-card">
          <p class="tg-biz-sub">选择一条复盘记录查看模拟计算依据；本页面不会读取生产运行日志。</p>
          <el-button type="primary" plain @click="router.push('/ai/chat')">去智能助手生成SIM复盘</el-button>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.tg-sim-reports-grid{display:grid;grid-template-columns:minmax(310px,.85fr) minmax(0,1.5fr);gap:14px;align-items:start}
.tg-sim-report-detail{display:grid;gap:14px;min-width:0}
.tg-replay-conclusion{margin:14px 0 0}
.tg-replay-list{margin:13px 0}
.tg-replay-evidence{display:grid;gap:10px;padding-top:12px}
.tg-replay-list :deep(.tg-biz-list-row){min-height:38px}
@media(max-width:990px){.tg-sim-reports-grid{grid-template-columns:minmax(0,1fr)}}
</style>

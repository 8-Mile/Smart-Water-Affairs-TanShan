<script setup lang="ts">
import {computed,nextTick,onMounted,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {loadTanggangCatalog,type TanggangCatalog,type TanggangDevice} from '../mapping/tanggangCatalog'
import {buildProcessSchematic} from './processSchematic'
import {mockProcessDevice,type ProcessMockDevice} from './processMock'
import {processWorkflow,processMonitorRelevant} from './processWorkflow'
import {
  applySpecialistCase,getSpecialistCase,isSpecialistSystem,specialistAffectsDevice,
} from './processSpecialist'
import {useProcessSpecialistStore} from './processSpecialistStore'
import PortSpecialistExercise from './PortSpecialistExercise.vue'
import PortProcessSchematic from './PortProcessSchematic.vue'
import PortObjectBindingDialog from './PortObjectBindingDialog.vue'
import {usePermissions} from '@/utils/permissions'
import {
  fetchTanggangObjectLinks,type TanggangObjectLink,type TanggangSystemId,
} from '@/api/tanggang'
import {useScenarioStore,type SimProcessSystem} from '../simulation/store'
import {ElMessage} from 'element-plus'
import './business.css'
import './scenario-pages.css'

const route=useRoute(),router=useRouter(),sim=useScenarioStore()
const specialist=useProcessSpecialistStore()
const {hasPerm}=usePermissions()
const canBind=computed(()=>hasPerm('eq:update'))
const catalog=ref<TanggangCatalog|null>(null)
const error=ref('')
const sysId=computed(()=>String(route.params.systemId||''))
const specialistSystem=computed(()=>isSpecialistSystem(sysId.value)?sysId.value:null)
const specialistCase=computed(()=>{
  const systemId=specialistSystem.value
  if(!systemId||sim.running)return null
  return getSpecialistCase(specialist.selected[systemId],systemId)
})
const system=computed(()=>catalog.value?.systemMap.get(sysId.value))
const displayName=computed(()=>sysId.value==='domestic'
  ?'生活污水提升与外送':system.value?.name||'专业工艺监测')
const schematic=computed(()=>system.value&&catalog.value
  ?buildProcessSchematic(system.value,catalog.value):null)
const unique=computed(()=>schematic.value?.devices||[])
const mockByFacility=computed<ReadonlyMap<string,ProcessMockDevice>>(()=>new Map(
  unique.value.map(device=>[device.id,applySpecialistCase(
    sysId.value,mockProcessDevice(device,sim.effectiveScenario),specialistCase.value,
  )]),
))
const selectedId=computed(()=>{
  const requested=route.query.facility
  if(typeof requested==='string'&&unique.value.some(x=>x.id===requested))return requested
  return unique.value[0]?.id||null
})
const selectedDevice=computed(()=>unique.value.find(d=>d.id===selectedId.value)||null)
const detailPanel=ref<HTMLElement|null>(null)
const selectedMock=computed(()=>selectedId.value?mockByFacility.value.get(selectedId.value):null)
const specialistSelected=computed(()=>!!(selectedId.value&&specialistAffectsDevice(
  sysId.value,selectedId.value,specialistCase.value,
)))
const nodeNote=ref('')
const nodeReviewError=ref('')
const selectedCheck=computed(()=>sim.processChecks.find(x=>
  x.system_id===sysId.value&&x.facility_id===selectedId.value&&
  x.run_uid===sim.runUid)||null)
const currentSystemChecks=computed(()=>sim.processChecks.filter(x=>
  x.system_id===sysId.value&&x.run_uid===sim.runUid))
const reviewedFacilityIds=computed<ReadonlySet<string>>(()=>new Set(
  sim.running?currentSystemChecks.value.map(x=>x.facility_id):[],
))
const monitorRelevant=computed(()=>processMonitorRelevant(sysId.value,selectedId.value))
const canViewAlarms=computed(()=>hasPerm('alarm:realtime'))
const canViewRepairs=computed(()=>hasPerm('repair:list'))
const objectLinks=ref<TanggangObjectLink[]>([])
const linkError=ref('')
const bindingOpen=ref(false)
const bindingDevice=ref<TanggangDevice|null>(null)
const bindingExisting=ref<TanggangObjectLink|null>(null)
const linksByFacility=computed(()=>{
  const map=new Map<string,TanggangObjectLink[]>()
  for(const link of objectLinks.value){
    const entries=map.get(link.facility_id)||[]
    entries.push(link)
    map.set(link.facility_id,entries)
  }
  return map
})
const linkedFacilityIds=computed<ReadonlySet<string>>(()=>new Set(linksByFacility.value.keys()))
const selectedLinks=computed(()=>selectedId.value?linksByFacility.value.get(selectedId.value)||[]:[])
const workflow=computed(()=>processWorkflow(sysId.value,sim.result))
const simSummary=computed(()=>workflow.value.simSummary)
/** Cycle through current system facilities, never invent a new asset or route. */
function focusNext(kind:'attention'|'reviewed'){
  const available=unique.value.filter(device=>
    kind==='reviewed'
      ? reviewedFacilityIds.value.has(device.id)
      : sim.running&&['attention','fault'].includes(
        mockByFacility.value.get(device.id)?.state||'available',
      ),
  ).map(x=>x.id)
  if(!available.length)return
  const i=available.indexOf(selectedId.value||'')
  selectFacility(available[(i+1)%available.length]!)
}
let serial=0
async function loadObjectLinks(id:string){
  const key=++serial
  objectLinks.value=[]
  linkError.value=''
  if(!id)return
  try{
    const all:TanggangObjectLink[]=[]
    let page=1,total=0
    do{
      const response=await fetchTanggangObjectLinks({
        system_id:id as TanggangSystemId,page,page_size:200,
      })
      if(key!==serial)return
      all.push(...response.data.data.items)
      total=response.data.data.total
      page++
      if(page>26)throw Error('工程对象数量超过单次查询限制')
    }while(all.length<total)
    if(key===serial)objectLinks.value=all
  }catch{
    if(key===serial)linkError.value='工程对象关联读取失败，现有设计设施仍可浏览'
  }
}
watch(sysId,id=>{void loadObjectLinks(id)},{immediate:true})
watch(()=>[selectedId.value,sim.runUid],()=>{
  nodeNote.value=selectedCheck.value?.note||''
  nodeReviewError.value=''
})
function recordNodeCheck(){
  const device=selectedDevice.value
  const mock=selectedMock.value
  if(!device||!mock)return
  nodeReviewError.value=''
  try{
    sim.recordProcessCheck({
      systemId:sysId.value as SimProcessSystem,
      facilityId:device.id,
      facilityName:device.name,
      state:mock.state,
      note:nodeNote.value,
    })
    ElMessage.success('本轮SIM节点核查意见已记录；未产生正式告警或工单')
  }catch(e){
    nodeReviewError.value=e instanceof Error?e.message:'模拟核查记录失败'
  }
}
function nodeSourceQuery(){
  const check=selectedCheck.value
  return check?{
    from_system:check.system_id,
    from_facility:check.facility_id,
    run_uid:check.run_uid,
  }:{}
}
function openSimMonitor(){
  if(!sim.running){sim.openConsole();return}
  void router.push({path:'/port/operations/monitor',query:nodeSourceQuery()})
}
function openSimDecision(){
  if(!sim.running){sim.openConsole();return}
  void router.push({path:'/port/operations/decision',query:nodeSourceQuery()})
}
onMounted(async()=>{
  try{catalog.value=await loadTanggangCatalog()}
  catch(e){error.value=e instanceof Error?e.message:String(e)}
})
function selectFacility(id:string){
  if(!unique.value.some(x=>x.id===id))return
  void router.replace({path:route.path,query:{facility:id}}).then(async()=>{
    if(window.innerWidth<=900){
      await nextTick()
      detailPanel.value?.scrollIntoView({behavior:'smooth',block:'start'})
    }
  })
}
function openBinding(device:TanggangDevice,existing:TanggangObjectLink|null=null){
  bindingDevice.value=device
  bindingExisting.value=existing
  bindingOpen.value=true
}
function savedBinding(){void loadObjectLinks(sysId.value)}
</script>

<template>
  <main class="tg-biz tg-process-page page-fill">
    <div class="tg-biz-head">
      <div><h1>{{displayName}}</h1></div>
      <div class="tg-biz-actions">
        <span v-if="sim.running" class="tg-datamode sim">SIM · {{sim.activeScenario?.title}}</span>
        <el-button v-if="workflow.primary" plain
          @click="router.push(workflow.primary.path)">{{workflow.primary.label}}</el-button>
        <el-button plain @click="router.push('/dashboard')">返回港区</el-button>
      </div>
    </div>
    <div v-if="error" class="tg-biz-empty">{{error}}</div>
    <div v-else-if="!catalog" class="tg-biz-empty">正在读取工程资料…</div>
    <div v-else-if="!system" class="tg-biz-empty">该专业系统不存在，请从运行监测菜单选择六个系统之一。</div>

    <template v-else>
      <div v-if="simSummary" class="tg-process-sim">
        <strong>SIM · {{simSummary}}</strong>
        <el-button v-if="workflow.primary" link type="primary"
          @click="router.push(workflow.primary.path)">查看分析</el-button>
      </div>
      <div v-else-if="sim.running" class="tg-process-sim">
        {{workflow.simNoEvidence}}
        <el-button link @click="sim.openConsole()">查看统一情景</el-button>
      </div>
      <div class="tg-process-grid">
        <div class="tg-process-main">
          <PortSpecialistExercise v-if="specialistSystem" :system-id="specialistSystem"
            :global-sim-running="sim.running" @select-facility="selectFacility"/>
          <PortProcessSchematic :sections="schematic?.sections||[]"
            :selected-facility-id="selectedId"
            :linked-facility-ids="linkedFacilityIds"
            :reviewed-facility-ids="reviewedFacilityIds"
            :mock-by-facility="mockByFacility"
            :sim-running="sim.running"
            :source-layers="system.focusPipeLayers"
            @select="selectFacility"
            @focus-attention="focusNext('attention')"
            @focus-reviewed="focusNext('reviewed')"/>
        </div>

        <section ref="detailPanel" class="tg-biz-card tg-process-detail" aria-label="当前选中设施">
          <template v-if="selectedDevice">
            <div class="tg-process-detail-head">
              <h2>{{selectedDevice.name}}</h2>
              <span v-if="selectedLinks.length" class="tg-biz-chip">对象已关联</span>
            </div>
            <div class="tg-process-detail-meta">
              <span>{{selectedDevice.regionName}}</span>
              <span>{{selectedDevice.id}}</span>
            </div>
            <div v-if="selectedMock" class="tg-process-mock" data-testid="process-mock-detail">
              <div class="tg-biz-card-head">
                <h3>模拟运行状态</h3>
                <span class="tg-biz-chip" :class="{warn:selectedMock.state==='fault'||selectedMock.state==='attention'}">
                  {{specialistSelected?'专业Mock演练':
                    selectedMock.context==='ACTIVE_SCENARIO'?'SIM情景':'Mock基线'}}
                </span>
              </div>
              <div class="tg-process-mock-state" :class="selectedMock.state">
                <span class="tg-process-mock-light" aria-hidden="true"/>
                <strong>{{selectedMock.stateLabel}}</strong>
                <small>非现场采集</small>
              </div>
              <div class="tg-process-readings">
                <div v-for="reading in selectedMock.readings" :key="reading.key"
                  class="tg-process-reading-row">
                  <span>{{reading.key}}</span>
                  <div>
                    <strong>{{reading.value}}</strong>
                    <small v-if="reading.provenance==='SCENARIO_INPUT'">情景输入</small>
                  </div>
                </div>
              </div>
              <p class="tg-mini-note">
                示例值仅用于界面演练；不参与供水平衡、真实告警、工单或PLC控制。
              </p>
              <div class="tg-biz-actions">
                <el-button size="small" plain @click="sim.openConsole()">统一情景控制台</el-button>
              </div>
            </div>
            <div class="tg-process-action" data-testid="process-node-actions">
              <div class="tg-biz-card-head">
                <h3>SIM节点核查与后续处置</h3>
                <span class="tg-mini-note">仅浏览器当前情景</span>
              </div>
              <div class="tg-process-stepbar">
                <span>查看Mock状态</span><b>›</b><span>人工核查</span><b>›</b>
                <span>{{workflow.supportsDecision?'规则研判':'节点留痕'}}</span><b>›</b><span>模拟复盘</span>
              </div>
              <p v-if="!sim.running" class="tg-mini-note">
                当前为静态Mock基线。启动统一情景后可登记本轮模拟核查意见。
              </p>
              <template v-else>
                <el-input v-model="nodeNote" type="textarea" :rows="3"
                  maxlength="600" show-word-limit
                  placeholder="填写设备现象、模拟读数、建议排查动作（不少于8字）；不会创建正式工单"
                  data-testid="process-node-note"/>
                <p v-if="nodeReviewError" class="tg-process-inline-error" role="alert">{{nodeReviewError}}</p>
                <el-button type="primary" plain size="small"
                  :disabled="nodeNote.trim().length<8"
                  data-testid="process-record-check" @click="recordNodeCheck">
                  {{selectedCheck?'更新本轮SIM核查':'记录本轮SIM核查'}}
                </el-button>
                <div v-if="selectedCheck" class="tg-process-check-record">
                  <strong>已记录模拟核查</strong>
                  <span>{{selectedCheck.note}}</span>
                  <small>本轮{{currentSystemChecks.length}}个节点已留痕 · 现场未核实</small>
                </div>
              </template>
              <div class="tg-biz-actions tg-process-action-links">
                <el-button v-if="monitorRelevant" size="small" plain
                  @click="openSimMonitor">中压泵SIM监护</el-button>
                <el-button v-if="workflow.supportsDecision" size="small" plain
                  @click="openSimDecision">供水SIM处置研判</el-button>
                <el-button v-if="workflow.primary" size="small" plain
                  @click="router.push(workflow.primary.path)">{{workflow.primary.label}}</el-button>
                <el-button v-if="sim.running" size="small" plain
                  @click="router.push('/ai/chat')">AI助手生成SIM复盘</el-button>
              </div>
              <p class="tg-mini-note">{{workflow.scope}}</p>
              <div class="tg-biz-actions tg-process-formal-links">
                <el-button v-if="canViewAlarms" size="small" link
                  @click="router.push('/alarm/realtime')">查看正式告警中心</el-button>
                <el-button v-if="canViewRepairs" size="small" link
                  @click="router.push('/repair/list')">查看正式维修工单</el-button>
              </div>
              <p class="tg-mini-note">
                SIM设备异常不等于正式告警；这里只能查看正式模块，
                不会为该节点自动创建、关联或关闭任何生产事件。
              </p>
            </div>
            <div class="tg-process-fields">
              <h3>设计建议测点</h3>
              <div v-if="selectedDevice.dataFields?.length" class="tg-process-field-items">
                <span v-for="item in selectedDevice.dataFields" :key="item">{{item}}</span>
              </div>
              <p v-else class="tg-biz-sub">暂无设计参考测点</p>
            </div>
            <div class="tg-process-info">
              <div v-if="selectedDevice.sourceDoc">
                <span>资料来源</span><strong>{{selectedDevice.sourceDoc}}</strong>
              </div>
              <div v-if="selectedDevice.designQuantity">
                <span>设计数量</span><strong>{{selectedDevice.designQuantity}}</strong>
              </div>
              <div v-if="selectedDevice.specSection">
                <span>规格章节</span><strong>{{selectedDevice.specSection}}</strong>
              </div>
              <div v-if="selectedDevice.sourceCadHandle">
                <span>CAD Handle</span><strong>{{selectedDevice.sourceCadHandle}}</strong>
              </div>
            </div>
            <p v-if="selectedDevice.notes" class="tg-process-description">{{selectedDevice.notes}}</p>

            <div class="tg-process-bindings">
              <div class="tg-biz-card-head"><h3>工程对象与设备关联</h3></div>
              <template v-if="selectedLinks.length">
                <div v-for="link in selectedLinks" :key="link.id" class="tg-process-bound-row">
                  <div class="tg-process-bound-top">
                    <span>{{link.object_id}}</span>
                    <el-button v-if="canBind" link @click="openBinding(selectedDevice,link)">编辑</el-button>
                  </div>
                  <div v-for="asset in link.assets||[]" :key="asset.id">
                    <el-button link type="primary"
                      @click="router.push('/equipment/detail/'+asset.id)">{{asset.name}}</el-button>
                  </div>
                  <span v-if="link.metric_ids.length" class="tg-process-point-ids">
                    已登记测点ID：{{link.metric_ids.join('、')}}
                  </span>
                  <span v-if="!link.verified" class="tg-process-point-ids">对象关系尚待审核</span>
                </div>
              </template>
              <p v-else class="tg-biz-sub">暂无对应工程对象/设备记录；不代表现场设备不存在。</p>
              <el-button v-if="canBind" plain size="small"
                @click="openBinding(selectedDevice)">配置工程关联</el-button>
            </div>
          </template>
          <div v-else class="tg-biz-empty">该系统没有设计设施可供查看</div>
        </section>
      </div>

      <div v-if="linkError" class="tg-process-inline-error" role="status">{{linkError}}</div>
      <div v-if="schematic?.missingIds.length" class="tg-process-inline-error" role="status">
        以下设施在区域设计清单中缺少对应条目：{{schematic.missingIds.join('、')}}
      </div>
      <div class="tg-process-bottom">
        <p>{{system.disclaimer||'设计分区不代表已经核实管道连通、泵阀控制与现场点表。'}}</p>
        <el-button link @click="router.push('/port/data/provenance')">资料与测点核对</el-button>
      </div>
    </template>
    <PortObjectBindingDialog v-model:open="bindingOpen"
      :device="bindingDevice" :existing="bindingExisting"
      :system-id="sysId as TanggangSystemId"
      @saved="savedBinding"/>
  </main>
</template>

<style scoped>
.tg-process-page{min-width:0}
.tg-process-main{min-width:0;display:grid;gap:13px}
.tg-process-grid{display:grid;grid-template-columns:minmax(0,1.92fr) minmax(310px,.88fr);
  gap:14px;align-items:start}
.tg-process-detail{position:sticky;top:14px;display:grid;gap:14px}
.tg-process-detail-head{display:flex;align-items:start;justify-content:space-between;gap:8px}
.tg-process-detail-head h2{margin-bottom:0;font-size:17px}
.tg-process-detail-meta{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:11px;color:#869caa}
.tg-process-mock{border-top:1px solid #e7eff4;border-bottom:1px solid #e7eff4;
  padding:13px 0;display:grid;gap:10px}
.tg-process-mock .tg-biz-card-head{margin:0}
.tg-process-mock h3{font-size:13px;font-weight:660;color:#365c73;margin:0}
.tg-process-mock-state{display:flex;gap:8px;align-items:center;color:#357b9a;font-size:12px}
.tg-process-mock-state strong{font-weight:620}
.tg-process-mock-state small{font-size:11px;color:#8ca0ab;margin-left:auto}
.tg-process-mock-state.fault{color:#ba705d}
.tg-process-mock-state.attention{color:#ad8242}
.tg-process-mock-light{width:9px;height:9px;border-radius:50%;background:currentColor;
  box-shadow:0 0 0 3px color-mix(in srgb,currentColor 12%,transparent)}
.tg-process-readings{display:grid;gap:0}
.tg-process-reading-row{display:flex;justify-content:space-between;gap:8px;
  align-items:center;border-bottom:1px solid #edf2f5;padding:9px 1px;font-size:12px}
.tg-process-reading-row:last-child{border-bottom:0}
.tg-process-reading-row>span{color:#718c9b}
.tg-process-reading-row>div{display:flex;align-items:center;gap:8px;text-align:right}
.tg-process-reading-row strong{font-variant-numeric:tabular-nums;font-weight:640;color:#386984}
.tg-process-reading-row small{font-size:10px;color:#aa803e;white-space:nowrap}
.tg-process-mock .tg-mini-note{margin:0!important}
.tg-process-action{display:grid;gap:10px;padding:12px 0;border-bottom:1px solid #e7eff4}
.tg-process-action h3{font-size:13px;font-weight:660;color:#365c73;margin:0}
.tg-process-action .tg-biz-card-head{margin:0}
.tg-process-stepbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;
  font-size:11px;color:#7892a1}
.tg-process-stepbar b{font-weight:500;color:#abc0cc}
.tg-process-action-links,.tg-process-formal-links{flex-wrap:wrap}
.tg-process-check-record{padding:10px 11px;border:1px solid #dce9ef;
  border-radius:6px;background:rgba(241,248,251,.7);display:grid;gap:5px;
  font-size:12px;line-height:1.6;color:#547a90}
.tg-process-check-record strong{font-weight:640;color:#386883}
.tg-process-check-record small{font-size:11px;color:#839ba9}
.tg-process-fields h3,.tg-process-bindings h3{font-size:13px;font-weight:660;
  color:#365c73;margin:0 0 11px}
.tg-process-field-items{display:flex;flex-wrap:wrap;gap:7px}
.tg-process-field-items span{background:rgba(230,242,249,.78);border:1px solid #d6e7ef;
  border-radius:5px;padding:5px 9px;color:#47748b;font-size:11px}
.tg-process-info{display:grid;gap:9px;font-size:12px;border-top:1px solid #e7eff4;
  border-bottom:1px solid #e7eff4;padding:13px 0}
.tg-process-info>div{display:flex;gap:12px;justify-content:space-between}
.tg-process-info span{color:#8399a7}
.tg-process-info strong{font-weight:570;color:#476d83;text-align:right}
.tg-process-description{font-size:12px!important;color:#718b9a!important;
  margin:0!important;line-height:1.7}
.tg-process-bindings{display:grid;gap:9px}
.tg-process-bindings .el-button{justify-self:start}
.tg-process-bound-row{padding:10px 0;border-top:1px solid #ecf2f6;font-size:12px}
.tg-process-bound-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.tg-process-bound-top span{overflow-wrap:anywhere;color:#6c8999}
.tg-process-point-ids{display:block;font-size:11px;color:#8199a8;line-height:1.6}
.tg-process-sim{display:flex;gap:12px;align-items:center;justify-content:space-between;
  flex-wrap:wrap;border:1px solid #eadac1;background:rgba(253,247,236,.75);
  border-radius:8px;padding:10px 13px;margin-bottom:14px;font-size:12px;color:#9b713e}
.tg-process-sim strong{font-weight:620}
.tg-process-bottom{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;
  gap:8px 15px;padding:12px 2px;color:#7f97a4}
.tg-process-bottom p{font-size:11px;max-width:780px;margin:0}
.tg-process-inline-error{color:#ac6d3c;font-size:12px;padding:11px 2px}
@media(max-width:1250px){.tg-process-grid{grid-template-columns:minmax(0,1.4fr) minmax(290px,1fr)}}
@media(max-width:900px){.tg-process-grid{grid-template-columns:minmax(0,1fr)}.tg-process-detail{position:static}}
</style>

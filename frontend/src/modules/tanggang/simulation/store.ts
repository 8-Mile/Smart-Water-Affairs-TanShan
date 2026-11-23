import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { SCENARIOS, calculateScenario, type ScenarioId, type ScenarioInputs } from './engine'
import { compareSupplyPlans } from './supplyPlans'
import {assessSimMonitor} from './monitorEvidence'
import {analyzeSimOperationalImpact} from './impactAnalysis'
import {AUTO_FEED_VERSION,autoScenarioAt} from './autoWaterFeed'
import {
  makeMockTelemetryFrame,assessTelemetryFrame,
  type TelemetryFrame,type FrameAssessment,
} from './telemetryContract'
import {calculateWaterEconomics,calculateProcessImpacts} from './waterOperations'
import {asSimulatedEvents} from './operationsEventReadModel'
import {
  emptyCaseState,evaluateOperatingCases,acknowledgeOperatingCase,
  closeRecoveredOperatingCase,activeOperatingCases,
} from './operationsCases'
export type SimProcessState='running'|'available'|'attention'|'fault'
export type SimProcessSystem='fog'|'middle'|'mineral'|'rain'|'pool'|'domestic'
export interface SimProcessCheck {
  system_id:SimProcessSystem
  facility_id:string
  facility_name:string
  state:SimProcessState
  note:string
  scenario_id:ScenarioId
  run_uid:string
  data_mode:'SIM'
  field_verified:false
  production_alarm_created:false
  repair_order_created:false
  recorded_at:string
}
const SIM_PROCESS_SYSTEMS:readonly string[]=['fog','middle','mineral','rain','pool','domestic']
const SIM_PROCESS_STATES:readonly string[]=['running','available','attention','fault']
/**
 * 情景推演与生产源数据严格隔离：仅当前浏览器内存有效，不写localStorage、后台API或PLC。
 * 路由切换不会重置；刷新、退出登录、关闭页面即消失。
 */
export const useScenarioStore=defineStore('tanggang-scenario',()=>{
  const activeId=ref<ScenarioId|null>(null)
  const activeInputs=ref<ScenarioInputs|null>(null)
  const runNumber=ref(0)
  const startedAt=ref('')
  const autoEnabled=ref(false)
  const autoFrame=ref(0)
  interface AutoSample {
    frame:number;at:string;scenarioId:ScenarioId
    demandM3h:number;deliveredM3h:number;shortageM3h:number
    energyKwhH:number|null;costYuanH:number|null
    eventCount:number;dataMode:'SIM';feedVersion:typeof AUTO_FEED_VERSION
  }
  const autoHistory=ref<AutoSample[]>([])
  const autoTelemetryFrame=ref<TelemetryFrame|null>(null)
  const telemetryAssessment=computed<FrameAssessment|null>(()=>
    autoTelemetryFrame.value
      ?assessTelemetryFrame(autoTelemetryFrame.value,new Date().toISOString()):null,
  )
  function prepareAutoTelemetry(scenario:ReturnType<typeof autoScenarioAt>,frame:number){
    const at=new Date().toISOString()
    const sample=makeMockTelemetryFrame(scenario,frame,at)
    const quality=assessTelemetryFrame(sample,at)
    if(!quality.modelCanCalculate||quality.productionEligible){
      throw Error('自动Mock数据质量校验失败，拒绝推进运行模型')
    }
    return sample
  }
  const autoCaseState=ref(emptyCaseState())
  const operatingCases=computed(()=>autoCaseState.value.cases)
  const simulatedEventViews=computed(()=>asSimulatedEvents(operatingCases.value))
  const activeCases=computed(()=>activeOperatingCases(autoCaseState.value))
  const newCaseCount=computed(()=>activeCases.value.filter(x=>x.status==='new').length)
  const pendingCaseCount=computed(()=>activeCases.value.length)
  function acknowledgeCase(id:string,note:string){
    if(!running.value)throw Error('当前没有有效的Mock运行记录')
    autoCaseState.value=acknowledgeOperatingCase(
      autoCaseState.value,id,note,new Date().toISOString())
  }
  function closeRecoveredCase(id:string,note:string){
    if(!autoEnabled.value)throw Error('自动数据流未运行，无法执行连续恢复复核')
    autoCaseState.value=closeRecoveredOperatingCase(
      autoCaseState.value,id,note,new Date().toISOString())
  }
  function updateOperatingCases(frame:number,scenario:ReturnType<typeof autoScenarioAt>){
    autoCaseState.value=evaluateOperatingCases(
      autoCaseState.value,calculateScenario(scenario),frame,new Date().toISOString(),
    )
  }
  const autoLastUpdated=ref('')
  function appendAutoSample(frame:number,scenario:ReturnType<typeof autoScenarioAt>){
    const snapshot=calculateScenario(scenario)
    const economics=calculateWaterEconomics(snapshot)
    const record:AutoSample={
      frame,at:new Date().toISOString(),scenarioId:scenario.id,
      demandM3h:snapshot.demandedM3h,deliveredM3h:snapshot.deliveredM3h,
      shortageM3h:snapshot.shortageM3h,
      energyKwhH:economics.optimized.energyKwhH,
      costYuanH:economics.optimized.costYuanH,
      eventCount:snapshot.events.length,
      dataMode:'SIM',feedVersion:AUTO_FEED_VERSION,
    }
    autoHistory.value=[...autoHistory.value.slice(-23),record]
    autoLastUpdated.value=record.at
  }
  // Unique to a single in-memory SIM run, even after refresh/relogin resets runNumber.
  const runUid=ref('')
  const consoleOpen=ref(false)
  const activeScenario=computed(()=>activeId.value?SCENARIOS[activeId.value]:null)
  const effectiveScenario=computed(()=>activeScenario.value&&activeInputs.value
    ?{...activeScenario.value,inputs:activeInputs.value}:null)
  const result=computed(()=>effectiveScenario.value?calculateScenario(effectiveScenario.value):null)
  const supplyPlans=computed(()=>effectiveScenario.value?compareSupplyPlans(effectiveScenario.value):[])
  const running=computed(()=>activeId.value!==null)
  const waterEconomics=computed(()=>result.value?calculateWaterEconomics(result.value):null)
  const processImpacts=computed(()=>effectiveScenario.value&&result.value
    ?calculateProcessImpacts(effectiveScenario.value,result.value):[])
  const monitorEvidence=computed(()=>effectiveScenario.value
    ?assessSimMonitor(effectiveScenario.value):null)
  const impactAnalysis=computed(()=>{
    if(!effectiveScenario.value||!result.value||!monitorEvidence.value)return null
    return analyzeSimOperationalImpact(
      effectiveScenario.value,result.value,monitorEvidence.value,supplyPlans.value,
    )
  })
  type SimReviewOutcome='requires-field-check'|'sim-recovery-conditions'
  interface SimReview {
    runNumber:number
    caseId:string
    status:'investigating'|'recorded'
    startedAt:string
    recordedAt:string|null
    outcome:SimReviewOutcome|null
    note:string
    dataMode:'SIM'
    fieldValidated:false
  }
  const monitorReview=ref<SimReview|null>(null)
  // Browser memory only, one note per facility per SIM run. Never production cases.
  const processChecks=ref<SimProcessCheck[]>([])
  function recordProcessCheck(params:{
    systemId:SimProcessSystem
    facilityId:string
    facilityName:string
    state:SimProcessState
    note:string
  }):SimProcessCheck {
    if(!running.value||!activeId.value||!runUid.value)
      throw Error('未启动有效的SIM轮次，不能记录模拟节点核查')
    const {systemId,facilityId,facilityName,state}=params
    const note=params.note.trim()
    if(!SIM_PROCESS_SYSTEMS.includes(systemId)||
      !/^EQ-[A-Z0-9-]{2,70}$/.test(facilityId)||
      !facilityName.trim()||facilityName.trim().length>120||
      !SIM_PROCESS_STATES.includes(state))
      throw Error('节点核查对象无效')
    if(note.length<8||note.length>600)
      throw Error('请填写8至600字的模拟核查意见')
    const existing=processChecks.value.filter(p=>
      p.system_id!==systemId||p.facility_id!==facilityId)
    if(existing.length>=24)throw Error('本轮SIM核查节点数量已达上限')
    const record:SimProcessCheck={
      system_id:systemId,facility_id:facilityId,
      facility_name:facilityName.trim(),state,note,
      scenario_id:activeId.value,run_uid:runUid.value,
      data_mode:'SIM',field_verified:false,
      production_alarm_created:false,repair_order_created:false,
      recorded_at:new Date().toISOString(),
    }
    processChecks.value=[...existing,record]
    return record
  }
  function beginMonitorReview(){
    if(!running.value||!monitorEvidence.value)throw Error('没有可核查的SIM演示情景')
    if(monitorReview.value?.runNumber===runNumber.value)return
    monitorReview.value={
      runNumber:runNumber.value,caseId:'SIM-RUN-'+runNumber.value+'-MON',
      status:'investigating',startedAt:new Date().toISOString(),
      recordedAt:null,outcome:null,note:'',dataMode:'SIM',fieldValidated:false,
    }
  }
  function recordMonitorReview(outcome:SimReviewOutcome,note:string){
    const current=monitorReview.value
    if(!running.value||!current||current.runNumber!==runNumber.value
      ||current.status!=='investigating')throw Error('模拟核查状态已失效')
    const normalized=note.trim()
    if(normalized.length<8||normalized.length>1000)throw Error('请填写8至1000字的核查依据')
    if(outcome!=='requires-field-check'&&outcome!=='sim-recovery-conditions'){
      throw Error('核查结果不在允许范围')
    }
    if(outcome==='sim-recovery-conditions'&&!monitorEvidence.value?.recoveryCandidate){
      throw Error('当前合成数据不满足演示恢复条件')
    }
    monitorReview.value={
      ...current,status:'recorded',outcome,note:normalized,
      recordedAt:new Date().toISOString(),
    }
  }

  /** Only this global console may change a predefined *SIM* input snapshot. */
  const EDITABLE_KEYS=['capacityM3h','reservedM3h','poolInitialM3',
    'poolSafetyM3','poolInflowM3h','horizonHours'] as const
  function startAuto(){
    // The global console calls this after login. Manual analysis explicitly
    // chosen by an operator is never overwritten by the automatic feed.
    if(running.value&&!autoEnabled.value)return
    if(autoEnabled.value)return
    const scenario=autoScenarioAt(0)
    const telemetry=prepareAutoTelemetry(scenario,0)
    calculateScenario(scenario)
    compareSupplyPlans(scenario)
    activeId.value=scenario.id
    activeInputs.value=scenario.inputs
    autoTelemetryFrame.value=telemetry
    autoFrame.value=0
    autoEnabled.value=true
    autoHistory.value=[]
    runNumber.value+=1
    monitorReview.value=null
    processChecks.value=[]
    runUid.value=crypto.randomUUID()
    startedAt.value=new Date().toISOString()
    appendAutoSample(0,scenario)
    updateOperatingCases(0,scenario)
  }
  function advanceAuto(){
    if(!autoEnabled.value)return
    const nextFrame=autoFrame.value+1
    const scenario=autoScenarioAt(nextFrame)
    const telemetry=prepareAutoTelemetry(scenario,nextFrame)
    calculateScenario(scenario)
    compareSupplyPlans(scenario)
    const previous=activeId.value
    activeId.value=scenario.id
    activeInputs.value=scenario.inputs
    autoTelemetryFrame.value=telemetry
    autoFrame.value=nextFrame
    if(previous!==scenario.id){
      runNumber.value+=1
      monitorReview.value=null
      processChecks.value=[]
      runUid.value=crypto.randomUUID()
      startedAt.value=new Date().toISOString()
    }
    appendAutoSample(nextFrame,scenario)
    updateOperatingCases(nextFrame,scenario)
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual',{
      detail:{scenarioId:scenario.id,frame:nextFrame,
        dataMode:'SIM',simulationOnly:true,automatic:true},
    }))
  }
  function start(id:ScenarioId, overrides:Partial<Pick<ScenarioInputs,typeof EDITABLE_KEYS[number]>>={}){
    // Manual scenario is an advanced analysis override; the product defaults
    // to unattended Mock monitoring and resumes only on explicit request.

    if(!SCENARIOS[id])throw Error('未授权的演示情景')
    for(const key of Object.keys(overrides)){
      if(!EDITABLE_KEYS.includes(key as typeof EDITABLE_KEYS[number])){
        throw Error('该参数不能在情景控制台修改')
      }
    }
    const def=SCENARIOS[id]
    const proposed:ScenarioInputs={
      ...def.inputs,
      terminals:def.inputs.terminals.map(t=>({...t})),
      ...overrides,
    }
    // Validate BEFORE updating store, so an invalid run does not poison
    // business pages or leave behind a partially updated scene state.
    calculateScenario({...def,inputs:proposed})
    compareSupplyPlans({...def,inputs:proposed})
    autoEnabled.value=false
    autoTelemetryFrame.value=null
    activeInputs.value=proposed
    activeId.value=id
    runNumber.value+=1
    monitorReview.value=null
    processChecks.value=[]
    runUid.value=crypto.randomUUID()
    startedAt.value=new Date().toISOString()
    // 只用于未来可选的三维展示订阅，不是工控事件、不包含真实测点。
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual', {
      detail:{scenarioId:id,runNumber:runNumber.value,dataMode:'SIM',simulationOnly:true},
    }))
  }
  /** Apply a validated, temporary operator-input snapshot to the SAME model.
   * No backend, control, or formal alarm writes; auto feed pauses until resumed.
   */
  function applyOperatorInputs(inputs:ScenarioInputs,scenarioId:ScenarioId){
    if(!SCENARIOS[scenarioId])throw Error('工况模板无效')
    if(!['running','fault'].includes(inputs.pumpState))throw Error('泵状态无效')
    if(!Array.isArray(inputs.terminals)||inputs.terminals.length<1||
      inputs.terminals.length>24)throw Error('用水点数量无效')
    const proposed:ScenarioInputs={
      ...inputs,
      terminals:inputs.terminals.map(t=>({...t})),
    }
    const next={...SCENARIOS[scenarioId],inputs:proposed}
    calculateScenario(next)
    compareSupplyPlans(next)
    // The manual snapshot and the automatic telemetry stream are mutually
    // exclusive. Human decisions never write to PLC or production records.
    autoEnabled.value=false
    autoTelemetryFrame.value=null
    activeId.value=scenarioId
    activeInputs.value=proposed
    runNumber.value+=1
    monitorReview.value=null
    processChecks.value=[]
    runUid.value=crypto.randomUUID()
    startedAt.value=new Date().toISOString()
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual',{
      detail:{scenarioId,runNumber:runNumber.value,dataMode:'SIM',
        simulationOnly:true,manualInput:true},
    }))
  }
  function resumeAuto(){
    stop()
    startAuto()
  }
  function stop(){
    autoEnabled.value=false
    activeId.value=null
    activeInputs.value=null
    monitorReview.value=null
    processChecks.value=[]
    autoCaseState.value=emptyCaseState()
    autoHistory.value=[]
    autoTelemetryFrame.value=null
    autoLastUpdated.value=''
    startedAt.value=''
    runUid.value=''
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual',{
      detail:{scenarioId:null,runNumber:runNumber.value,dataMode:'MEASURED_OR_UNAVAILABLE',simulationOnly:false},
    }))
  }
  function openConsole(){consoleOpen.value=true}
  function closeConsole(){consoleOpen.value=false}
  return {activeId,activeInputs,runNumber,runUid,startedAt,consoleOpen,activeScenario,
    effectiveScenario,result,supplyPlans,impactAnalysis,monitorEvidence,monitorReview,
    processChecks,recordProcessCheck,beginMonitorReview,recordMonitorReview,
    running,start,stop,startAuto,advanceAuto,applyOperatorInputs,resumeAuto,autoEnabled,autoFrame,
    autoHistory,autoLastUpdated,autoTelemetryFrame,telemetryAssessment,
    waterEconomics,processImpacts,
    operatingCases,simulatedEventViews,activeCases,newCaseCount,pendingCaseCount,
    acknowledgeCase,closeRecoveredCase,
    openConsole,closeConsole}
})

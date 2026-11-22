import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { SCENARIOS, calculateScenario, type ScenarioId, type ScenarioInputs } from './engine'
import { compareSupplyPlans } from './supplyPlans'
import {assessSimMonitor} from './monitorEvidence'
/**
 * 情景推演与生产源数据严格隔离：仅当前浏览器内存有效，不写localStorage、后台API或PLC。
 * 路由切换不会重置；刷新、退出登录、关闭页面即消失。
 */
export const useScenarioStore=defineStore('tanggang-scenario',()=>{
  const activeId=ref<ScenarioId|null>(null)
  const activeInputs=ref<ScenarioInputs|null>(null)
  const runNumber=ref(0)
  const startedAt=ref('')
  const consoleOpen=ref(false)
  const activeScenario=computed(()=>activeId.value?SCENARIOS[activeId.value]:null)
  const effectiveScenario=computed(()=>activeScenario.value&&activeInputs.value
    ?{...activeScenario.value,inputs:activeInputs.value}:null)
  const result=computed(()=>effectiveScenario.value?calculateScenario(effectiveScenario.value):null)
  const supplyPlans=computed(()=>effectiveScenario.value?compareSupplyPlans(effectiveScenario.value):[])
  const running=computed(()=>activeId.value!==null)
  const monitorEvidence=computed(()=>effectiveScenario.value
    ?assessSimMonitor(effectiveScenario.value):null)
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
  function start(id:ScenarioId, overrides:Partial<Pick<ScenarioInputs,typeof EDITABLE_KEYS[number]>>={}){
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
    activeInputs.value=proposed
    activeId.value=id
    runNumber.value+=1
    monitorReview.value=null
    startedAt.value=new Date().toISOString()
    // 只用于未来可选的三维展示订阅，不是工控事件、不包含真实测点。
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual', {
      detail:{scenarioId:id,runNumber:runNumber.value,dataMode:'SIM',simulationOnly:true},
    }))
  }
  function stop(){
    activeId.value=null
    activeInputs.value=null
    monitorReview.value=null
    startedAt.value=''
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual',{
      detail:{scenarioId:null,runNumber:runNumber.value,dataMode:'MEASURED_OR_UNAVAILABLE',simulationOnly:false},
    }))
  }
  function openConsole(){consoleOpen.value=true}
  function closeConsole(){consoleOpen.value=false}
  return {activeId,activeInputs,runNumber,startedAt,consoleOpen,activeScenario,
    effectiveScenario,result,supplyPlans,monitorEvidence,monitorReview,
    beginMonitorReview,recordMonitorReview,
    running,start,stop,openConsole,closeConsole}
})

/**
 * Tanggang TG-205 / TG-306 software-demonstration cross-business impact.
 *
 * Joins a SINGLE run's deterministic supply calculation, monitor rule evidence
 * and plan constraints. It does NOT infer causation, actual plant failures,
 * measured flow, operational feasibility or real-world energy/cost savings.
 */
import type {ScenarioDefinition, ScenarioResult} from './engine'
import type {MonitorAssessment} from './monitorEvidence'
import type {SupplyPlan} from './supplyPlans'

export const IMPACT_MODEL = 'tg-sim-operational-impact-v1'

export interface SimAffectedTerminal {
  id: string
  label: string
  priority: 1 | 2 | 3
  demandM3h: number
  allocatedM3h: number
  shortageM3h: number
}
export interface SimImpactCheckpoint {
  key: 'field-points' | 'pump-condition' | 'operations' | 'pool' | 'network'
  label: string
  reason: string
  fieldVerified: false
}
export interface SimPlanBoundary {
  id: SupplyPlan['id']
  name: string
  shortageM3h: number
  deferredDemandM3h: number
  safetyMarginM3: number
  status: 'CONSTRAINT_FAIL' | 'UNVERIFIED'
}
export interface SimOperationalImpact {
  modelVersion: typeof IMPACT_MODEL
  dataMode: 'SIM'
  scenarioId: ScenarioDefinition['id']
  sourceContext: 'DOCUMENT_BASED_DEMO'
  fieldVerified: false
  inferenceType: 'RULE_EXPLANATION_NOT_AI_DIAGNOSIS'
  affectedTerminals: SimAffectedTerminal[]
  shortageM3h: number
  coveragePercent: number
  poolSafetyRisk: boolean
  triggeredRules: string[]
  insufficientRules: string[]
  checkpoints: SimImpactCheckpoint[]
  planBoundaries: SimPlanBoundary[]
  conclusion: string
  restriction: string
}

export function analyzeSimOperationalImpact(
  scenario: ScenarioDefinition,
  supply: ScenarioResult,
  monitor: MonitorAssessment,
  plans: readonly SupplyPlan[],
): SimOperationalImpact {
  if (scenario.id!==supply.id||scenario.id!==monitor.scenarioId
    ||supply.input!==scenario.inputs||monitor.dataMode!=='SIM'
    ||plans.length!==4||plans.some(p=>p.sourceMode!=='SIM'||p.fieldValidated))
    throw Error('不能混用不同情景、不完整方案或实测记录进行SIM联动分析')

  const affectedTerminals=supply.terminalAssessments
    .filter(t=>t.shortageM3h>0)
    .map(t=>({
      id:t.id,label:t.label,priority:t.priority,
      demandM3h:t.demandM3h,allocatedM3h:t.allocatedM3h,
      shortageM3h:t.shortageM3h,
    }))
  const triggeredRules=monitor.rules.filter(r=>r.outcome==='TRIGGERED').map(r=>r.label)
  const insufficientRules=monitor.rules.filter(r=>r.outcome==='INSUFFICIENT').map(r=>r.label)
  const poolSafetyRisk=supply.poolRisk!=='normal'
    ||plans[0]!.constraint==='CONSTRAINT_FAIL'

  const checkpoints:SimImpactCheckpoint[]=[
    {
      key:'field-points',label:'核对SCADA测点和采集质量',
      reason:'尚无经过现场核实的压力、电流、流量采集点或历史时序',
      fieldVerified:false,
    },
    {
      key:'operations',label:'核对实际作业计划和供水需求',
      reason:'DEMO用水点与需水量仅为演示假设，不能等同于实际生产任务',
      fieldVerified:false,
    },
  ]
  if(triggeredRules.length||insufficientRules.length){
    checkpoints.push({
      key:'pump-condition',label:'核对泵组运行状态与厂家参数',
      reason:'模拟规则命中、观测不足与设备原因之间尚无现场因果证据',
      fieldVerified:false,
    })
  }
  if(poolSafetyRisk){
    checkpoints.push({
      key:'pool',label:'核对池容曲线和安全水位',
      reason:'当前库容、入流、安全线均未按现场曲线与实际水位校核',
      fieldVerified:false,
    })
  }
  checkpoints.push({
    key:'network',label:'核对管网连接、水质及调度权限',
    reason:'设计对象分类不能证明水力连通，不能据此执行泵阀控制',
    fieldVerified:false,
  })

  const planBoundaries=plans.map(p=>({
    id:p.id,name:p.title,
    shortageM3h:p.result.shortageM3h,
    deferredDemandM3h:p.deferredDemandM3h,
    safetyMarginM3:p.safetyMarginM3,
    status:p.constraint,
  }))

  const conclusion=affectedTerminals.length
    ?'本次模拟供水分配存在缺口，需核对用水端与泵组能力假设'
    :poolSafetyRisk
      ?'本次模拟未出现当期供水缺口，但储量安全线需要进一步核对'
      :triggeredRules.length
        ?'本次模拟未出现供水缺口，存在设备监护条件线索'
        :'本次模拟尚未发现定义的供水缺口或监护命中；不代表现场无风险'

  return {
    modelVersion:IMPACT_MODEL,
    dataMode:'SIM',
    scenarioId:scenario.id,
    sourceContext:'DOCUMENT_BASED_DEMO',
    fieldVerified:false,
    inferenceType:'RULE_EXPLANATION_NOT_AI_DIAGNOSIS',
    affectedTerminals,shortageM3h:supply.shortageM3h,
    coveragePercent:supply.coveragePercent,poolSafetyRisk,
    triggeredRules,insufficientRules,checkpoints,planBoundaries,
    conclusion,
    restriction:'只关联同一轮演示假设。相关性不代表设备故障导致缺水；不生成告警、工单、控制指令，也不构成调度建议。',
  }
}

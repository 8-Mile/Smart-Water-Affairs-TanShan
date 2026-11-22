/**
 * TG-301/302 SIM-only monitor evidence engine.
 *
 * This is NOT an alarm engine or an inference about an installed Tanggang pump.
 * Synthesized observations are copied from one DEMO scenario into relative time
 * slots only to demonstrate delay and data-quality gating. They are NOT historical
 * samples nor a claim of 24h monitoring, PHM or actual fault prediction.
 */
import type {ScenarioDefinition, ScenarioId} from './engine'

export const MONITOR_DEMO_MODEL = 'tg-sim-monitor-evidence-v1'
export type SimQuality = 'GOOD' | 'MISSING' | 'STALE' | 'BAD' | 'OFFLINE'
export type MonitorField = 'pumpState' | 'pressureMpa' | 'currentA' | 'flowM3h'
export type MonitorStatus = 'running' | 'stopped' | 'fault' | null
export type RuleOutcome = 'TRIGGERED' | 'CLEAR' | 'INSUFFICIENT'
export type RiskLevel = 'critical' | 'attention' | 'normal' | 'insufficient'
export interface SimMonitorSample {
  offsetSec: number
  dataMode: 'SIM'
  pumpState: MonitorStatus
  pressureMpa: number | null
  currentA: number | null
  flowM3h: number | null
  quality: Record<MonitorField, SimQuality>
}

export interface MonitorRuleEvidence {
  id: 'SIM-STATE' | 'SIM-LOW-PRESSURE' | 'SIM-HIGH-CURRENT'
  label: string
  field: MonitorField
  threshold: string
  requiredSec: number
  sustainedSec: number
  matchedSamples: number
  outcome: RuleOutcome
  reason: string
  samples: Array<{
    offsetSec: number
    value: string
    quality: SimQuality
    conditionMet: boolean | null
  }>
}

export interface MonitorAssessment {
  scenarioId: ScenarioId
  modelVersion: typeof MONITOR_DEMO_MODEL
  dataMode: 'SIM'
  syntheticTimeline: true
  qualityVerified: false
  fieldValidated: false
  trace: SimMonitorSample[]
  rules: MonitorRuleEvidence[]
  risk: RiskLevel
  summary: string
  recoveryCandidate: boolean
  recoveryExplanation: string
  dataWarnings: string[]
}

const formatValue=(v:unknown):string=>v===null||v===undefined?'缺测':String(v)
const valid=(n:number|null):n is number=>n!==null&&Number.isFinite(n)
const qualityFor=(value:number|null):SimQuality=>valid(value)?'GOOD':value===null?'MISSING':'BAD'

/** All four points inherit the SAME current simulated snapshot. No fabricated past transitions. */
export function syntheticMonitorTrace(s:ScenarioDefinition):SimMonitorSample[] {
  const x=s.inputs
  return [-90,-60,-30,0].map(offsetSec=>({
    offsetSec, dataMode:'SIM',
    pumpState:x.pumpState,
    pressureMpa:x.pressureMpa,
    currentA:x.currentA,
    flowM3h:x.flowM3h,
    quality:{
      pumpState:'GOOD',
      pressureMpa:qualityFor(x.pressureMpa),
      currentA:qualityFor(x.currentA),
      flowM3h:qualityFor(x.flowM3h),
    },
  }))
}

function assessRule(
  trace:SimMonitorSample[],
  id:MonitorRuleEvidence['id'],
  label:string,
  field:MonitorField,
  threshold:string,
  requiredSec:number,
  matches:(row:SimMonitorSample)=>boolean|null,
):MonitorRuleEvidence {
  let hitStart:number|null=null
  let duration=0, matched=0, longest=0
  let totalComparable=0
  const samples:MonitorRuleEvidence['samples']=[]
  for(const sample of trace){
    const condition=sample.quality[field]==='GOOD' ? matches(sample) : null
    const comparable=condition!==null
    if(comparable)totalComparable++
    if(condition===true){
      if(hitStart===null){hitStart=sample.offsetSec;matched=0}
      matched++
      duration=sample.offsetSec-hitStart
      longest=Math.max(longest,duration)
    }else{
      hitStart=null
      duration=0
      matched=0
    }
    samples.push({
      offsetSec:sample.offsetSec,
      value:formatValue(sample[field]),
      quality:sample.quality[field],
      conditionMet:condition,
    })
  }
  const triggered=hitStart!==null&&duration>=requiredSec
  const outcome:RuleOutcome=triggered?'TRIGGERED':totalComparable===0?'INSUFFICIENT':'CLEAR'
  return {
    id,label,field,threshold,requiredSec,
    sustainedSec:triggered?duration:longest,
    matchedSamples:triggered?matched:0,
    outcome,
    reason:outcome==='INSUFFICIENT'
      ?'有效的演示测点数据不足；不得将缺测当作0'
      :triggered?'在合成相对时间轴上满足演示持续条件（并非真实历史）'
      :'未形成连续满足条件的有效演示样本',
    samples,
  }
}

function recoveryCondition(row:SimMonitorSample):boolean {
  return row.pumpState==='running'&&row.quality.pumpState==='GOOD'
    &&row.quality.pressureMpa==='GOOD'&&row.quality.currentA==='GOOD'
    &&valid(row.pressureMpa)&&row.pressureMpa>=1.20
    &&valid(row.currentA)&&row.currentA<=115
}

export function assessSimMonitor(
  s:ScenarioDefinition,
  samples:readonly SimMonitorSample[]=syntheticMonitorTrace(s),
):MonitorAssessment {
  const trace=samples.map(p=>({...p,quality:{...p.quality}}))
  if(!trace.length)throw Error('缺少演示观测序列')
  for(let i=0;i<trace.length;i++){
    const v=trace[i]!
    if(v.dataMode!=='SIM'||!Number.isFinite(v.offsetSec)||v.offsetSec>0
      ||(i>0&&trace[i-1]!.offsetSec>=v.offsetSec))
      throw Error('演示时序必须为严格递增的相对时间，不允许混入实测')
    for(const field of ['pressureMpa','currentA','flowM3h'] as const){
      if(v.quality[field]==='GOOD'&&!valid(v[field]))throw Error('GOOD质量不能对应缺测或非法数值')
    }
  }
  const stateRule=assessRule(
    trace,'SIM-STATE','泵组状态','pumpState','演示状态=fault',0,
    row=>row.pumpState==='fault',
  )
  const lowPressure=assessRule(
    trace,'SIM-LOW-PRESSURE','运行时低压','pressureMpa','压力 < 1.15 MPa（演示）',60,
    row=>row.pumpState==='running'&&row.quality.pumpState==='GOOD'
      &&valid(row.pressureMpa)?row.pressureMpa<1.15:null,
  )
  const highCurrent=assessRule(
    trace,'SIM-HIGH-CURRENT','运行时高电流','currentA','电流 > 120 A（演示）',60,
    row=>row.pumpState==='running'&&row.quality.pumpState==='GOOD'
      &&valid(row.currentA)?row.currentA>120:null,
  )
  const rules=[stateRule,lowPressure,highCurrent]
  const risk:RiskLevel=stateRule.outcome==='TRIGGERED'?'critical'
    :rules.some(x=>x.outcome==='TRIGGERED')?'attention'
    :rules.some(x=>x.outcome==='INSUFFICIENT')?'insufficient':'normal'

  const last=trace[trace.length-1]!
  const previous=trace[trace.length-2]
  const recoveryCandidate=!!previous&&last.offsetSec-previous.offsetSec>=30
    &&recoveryCondition(last)&&recoveryCondition(previous)
  const summary=risk==='critical'?'演示状态提示设备异常，需人工核查'
    :risk==='attention'?'合成观测触发演示联判条件'
    :risk==='insufficient'?'观测质量不足，不能判断设备是否正常'
    :'演示条件下未触发定义的监护规则'
  const dataWarnings=[
    '仅根据当前情景生成重复的合成样本，并非历史采样或实际故障预测',
    '流量没有经过额定工况校核，不参与固定阈值故障判断',
    '仅按运行状态评估压力和电流；停机低压不直接判断为泵故障',
    '没有实际设备、点表、生产计划和规则审批依据，不能产生正式告警',
  ]
  return {
    scenarioId:s.id,modelVersion:MONITOR_DEMO_MODEL,
    dataMode:'SIM',syntheticTimeline:true,qualityVerified:false,fieldValidated:false,
    trace,rules,risk,summary,recoveryCandidate,
    recoveryExplanation:recoveryCandidate
      ?'最近两个合成快照满足演示恢复阈值，不能证明现场恢复'
      :'尚未满足演示恢复阈值；缺测和故障状态都不能直接视为恢复',
    dataWarnings,
  }
}

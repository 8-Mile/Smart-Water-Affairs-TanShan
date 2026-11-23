/**
 * M21 simulated operating-event register.
 * Automatic detection / de-duplication / recovery-condition checking are
 * production-style algorithms acting on Mock samples, not real plant alarms.
 * Never issues PLC, work order, real alarm, or confirmed remediation.
 */
import type {ScenarioResult,SimEvent,SimSeverity} from './engine'
import {WATER_RELATIONSHIPS,type ProcessId} from './waterOperations'

export const CASE_MODEL_VERSION='tg-sim-operating-case-v1'
export const OPEN_CONFIRM_FRAMES=2
export const RECOVERY_CONFIRM_FRAMES=2
export type CaseStatus='new'|'acknowledged'|'closed'
export type CaseRiskId='SIM-PUMP'|'SIM-SUPPLY'|'SIM-POOL'|'SIM-RAIN'
export interface RelatedProcess{
  systemId:ProcessId
  relation:'design'|'conditional'
  note:string
  verified:false
}
export interface OperatingCase{
  id:string
  eventId:CaseRiskId
  title:string
  level:SimSeverity
  sourceProcess:ProcessId
  relatedProcesses:RelatedProcess[]
  evidence:string
  recommendations:string[]
  status:CaseStatus
  firstFrame:number
  lastTriggeredFrame:number
  lastUpdatedFrame:number
  observedAt:string
  lastSeenAt:string
  confirmationCount:number
  normalFrames:number
  acknowledgedAt:string|null
  acknowledgedNote:string|null
  closedAt:string|null
  closedNote:string|null
  dataMode:'SIM'
  fieldVerified:false
  productionAlarmCreated:false
  productionWorkOrderCreated:false
  commandExecuted:false
}
export interface OperatingCaseState{
  cases:OperatingCase[]
  pendingHits:Record<string,number>
  sequence:number
}
export const emptyCaseState=():OperatingCaseState=>({
  cases:[],pendingHits:{},sequence:0,
})
type CaseDefinition={
  source:ProcessId
  recommendations:string[]
}
const RULES:Record<CaseRiskId,CaseDefinition>={
  'SIM-PUMP':{
    source:'middle',
    recommendations:[
      '核对中压泵运行状态与上下游压力时间序列',
      '检查设备台账、阀位及备用能力，确认后由授权人员处置',
      '复核受影响供水需求及除尘水池储量',
    ],
  },
  'SIM-SUPPLY':{
    source:'middle',
    recommendations:[
      '核对生产用水负荷与终端供水优先级',
      '比较可分配能力及储量约束，形成供水保障方案',
      '仅在设备、管线及作业许可核验后执行调度',
    ],
  },
  'SIM-POOL':{
    source:'pool',
    recommendations:[
      '核对液位、库容换算和消防预留水量',
      '核实补水来源及入池流量，避免仅按示意容量操作',
      '评估错峰和补水方案，交由授权人员确认',
    ],
  },
  'SIM-RAIN':{
    source:'rain',
    recommendations:[
      '核对降雨、集水池液位和剩余调蓄容量',
      '确认雨污分流及处理场接收能力',
      '核查外排许可、现场管路和阀位，严禁依据Mock直接开阀',
    ],
  },
}
function isKnownEvent(id:string):id is CaseRiskId{
  return Object.prototype.hasOwnProperty.call(RULES,id)
}
export function caseRelatedProcesses(eventId:CaseRiskId):RelatedProcess[]{
  const source=RULES[eventId].source
  return WATER_RELATIONSHIPS
    .filter(e=>e.to===source||e.from===source)
    .map(e=>({
      systemId:e.to===source?e.from:e.to,
      relation:e.relation,
      note:e.reason,
      verified:false as const,
    }))
}
function caseCopy(item:OperatingCase):OperatingCase{
  return {...item,
    recommendations:[...item.recommendations],
    relatedProcesses:item.relatedProcesses.map(x=>({...x})),
  }
}
function validFrame(frame:number,time:string){
  if(!Number.isSafeInteger(frame)||frame<0||!Number.isFinite(Date.parse(time)))
    throw Error('运行事件帧或时间戳非法')
}
export function evaluateOperatingCases(
  state:OperatingCaseState,result:ScenarioResult,frame:number,time:string,
):OperatingCaseState{
  validFrame(frame,time)
  const cases=state.cases.map(caseCopy)
  const pendingHits:{[id:string]:number}={...state.pendingHits}
  const current=new Map<CaseRiskId,SimEvent>()
  for(const event of result.events){
    if(isKnownEvent(event.id))current.set(event.id,event)
  }
  let sequence=state.sequence
  for(const eventId of Object.keys(RULES) as CaseRiskId[]){
    const event=current.get(eventId)
    const previousOpen=cases.find(c=>c.eventId===eventId&&c.status!=='closed')
    if(event){
      pendingHits[eventId]=(pendingHits[eventId]||0)+1
      if(previousOpen){
        previousOpen.lastTriggeredFrame=frame
        previousOpen.lastUpdatedFrame=frame
        previousOpen.lastSeenAt=time
        previousOpen.normalFrames=0
        previousOpen.level=event.level
        previousOpen.evidence=event.evidence
        previousOpen.title=event.title
        previousOpen.confirmationCount=Math.min(99,previousOpen.confirmationCount+1)
      }else if(pendingHits[eventId]>=OPEN_CONFIRM_FRAMES){
        sequence++
        const def=RULES[eventId]
        cases.push({
          id:'SIM-CASE-'+String(sequence).padStart(4,'0'),
          eventId,title:event.title,level:event.level,
          sourceProcess:def.source,
          relatedProcesses:caseRelatedProcesses(eventId),
          evidence:event.evidence,
          recommendations:[...def.recommendations],
          status:'new',
          firstFrame:frame-OPEN_CONFIRM_FRAMES+1,
          lastTriggeredFrame:frame,lastUpdatedFrame:frame,
          observedAt:time,lastSeenAt:time,
          confirmationCount:OPEN_CONFIRM_FRAMES,normalFrames:0,
          acknowledgedAt:null,acknowledgedNote:null,
          closedAt:null,closedNote:null,
          dataMode:'SIM',fieldVerified:false,
          productionAlarmCreated:false,productionWorkOrderCreated:false,
          commandExecuted:false,
        })
      }
    }else{
      pendingHits[eventId]=0
      if(previousOpen){
        previousOpen.normalFrames+=1
        previousOpen.lastUpdatedFrame=frame
      }
    }
  }
  // History retained in browser memory; never drop an unfinished case simply
  // because the Mock scenario changed or the simulated pump recovered.
  return {cases,pendingHits,sequence}
}
function checkedNote(note:string){
  const value=note.trim()
  if(value.length<8||value.length>600)throw Error('请填写8至600字复核意见')
  return value
}
export function acknowledgeOperatingCase(
  state:OperatingCaseState,id:string,note:string,time:string,
):OperatingCaseState{
  if(!Number.isFinite(Date.parse(time)))throw Error('确认时间非法')
  const content=checkedNote(note)
  const current=state.cases.find(x=>x.id===id)
  if(!current||current.status!=='new')throw Error('事件不可重复确认')
  return {
    ...state,
    cases:state.cases.map(x=>x.id===id?{
      ...caseCopy(x),status:'acknowledged' as const,
      acknowledgedAt:time,acknowledgedNote:content,
    }:caseCopy(x)),
  }
}
export function closeRecoveredOperatingCase(
  state:OperatingCaseState,id:string,note:string,time:string,
):OperatingCaseState{
  if(!Number.isFinite(Date.parse(time)))throw Error('恢复时间非法')
  const content=checkedNote(note)
  const current=state.cases.find(x=>x.id===id)
  if(!current||current.status!=='acknowledged')
    throw Error('请先人工确认该事件')
  if(current.normalFrames<RECOVERY_CONFIRM_FRAMES)
    throw Error('尚未获得连续两帧规则恢复证据，不能复核结案')
  return {
    ...state,cases:state.cases.map(x=>x.id===id?{
      ...caseCopy(x),status:'closed' as const,
      closedAt:time,closedNote:content,
    }:caseCopy(x)),
  }
}
export const activeOperatingCases=(state:OperatingCaseState)=>
  state.cases.filter(x=>x.status!=='closed')

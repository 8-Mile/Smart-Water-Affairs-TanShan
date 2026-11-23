/**
 * M22 operations event read model: one UI contract, strictly separate lanes.
 * It is NOT a cross-domain write API. A SIM case cannot become an alarm or
 * maintenance order by simply changing its status or prefixed identifier.
 */
import type {AlarmItem} from '@/api/alarm'
import type {OperatingCase} from './operationsCases'
import {processName} from './waterOperations'

export type EventLane='SIMULATION'|'PRODUCTION'
export type EventStatus='open'|'handling'|'closed'
export interface OperationsEventSummary{
  /** Namespace prevents in-memory SIM sequence IDs colliding with DB IDs. */
  key:string
  sourceId:string
  lane:EventLane
  title:string
  status:EventStatus
  severity:'info'|'warning'|'critical'
  systemLabel:string
  observedAt:string
  detailUrl:string
  quality:'SYNTHETIC'|'NOT_ASSESSED'
  /** A production DB row is not evidence of independently verified PLC data. */
  fieldVerified:false
  canDispatch:false
}
const level=(num:number):OperationsEventSummary['severity']=>
  num===1?'critical':num===2?'warning':'info'
export function asSimulatedEvents(cases:readonly OperatingCase[]):
  OperationsEventSummary[]{
  return cases.map(c=>{
    if(c.dataMode!=='SIM'||c.fieldVerified||
      c.productionAlarmCreated||c.productionWorkOrderCreated||c.commandExecuted||
      !/^SIM-CASE-\d{4,}$/.test(c.id))throw Error('不可将非SIM事件映射为模拟事件')
    return {
      key:'sim:'+c.id,sourceId:c.id,
      lane:'SIMULATION',title:c.title,
      status:c.status==='closed'?'closed':c.status==='acknowledged'?'handling':'open',
      severity:c.level==='critical'?'critical':c.level==='attention'?'warning':'info',
      systemLabel:processName(c.sourceProcess),observedAt:c.observedAt,
      detailUrl:'/port/operations/monitor?case='+encodeURIComponent(c.id),
      quality:'SYNTHETIC',fieldVerified:false,canDispatch:false,
    }
  })
}
export function asProductionAlarmSummaries(alarms:readonly AlarmItem[]):
  OperationsEventSummary[]{
  return alarms.map(a=>{
    if(!Number.isSafeInteger(a.id)||a.id<=0||
      !Number.isSafeInteger(a.equipment_id)||a.equipment_id<=0||
      !Number.isFinite(Date.parse(a.alarm_time))||
      ![1,2,3].includes(a.alarm_level))throw Error('正式告警记录缺少有效标识或时间')
    return {
      key:'alarm:'+a.id,sourceId:String(a.id),
      lane:'PRODUCTION',title:a.rule_name||a.equipment_name,
      status:a.alarm_status==='closed'?'closed':
        a.alarm_status==='processing'?'handling':'open',
      severity:level(a.alarm_level),
      systemLabel:a.equipment_name,
      observedAt:a.alarm_time,
      detailUrl:'/alarm/realtime',
      quality:'NOT_ASSESSED',fieldVerified:false,canDispatch:false,
    }
  })
}
export interface OperationsEventLanes{
  simulation:OperationsEventSummary[]
  production:OperationsEventSummary[]
}
export function separateOperationsEventLanes(
  simulated:readonly OperatingCase[],
  production:readonly AlarmItem[],
):OperationsEventLanes{
  const simulation=asSimulatedEvents(simulated)
  const actual=asProductionAlarmSummaries(production)
  return {simulation,production:actual}
}

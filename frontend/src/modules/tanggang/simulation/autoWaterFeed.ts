/** Deterministic in-browser MOCK telemetry source for an always-on product loop.
 * No randomness, PLC, API writes, actual equipment data, or production alerts.
 */
import {
  SCENARIOS,type ScenarioDefinition,type ScenarioId,type ScenarioInputs,
} from './engine'

export const AUTO_FEED_VERSION='tg-operations-auto-feed-v1'
/** A frame is a new set of simulated readings. UI timer uses 8s per frame. */
export const AUTO_FRAME_INTERVAL_MS=8000
export const AUTO_CYCLE_FRAMES=20

export function autoScenarioId(frame:number):ScenarioId{
  const t=((Math.floor(frame)%AUTO_CYCLE_FRAMES)+AUTO_CYCLE_FRAMES)%AUTO_CYCLE_FRAMES
  return t<5?'baseline':t<10?'peak':t<13?'pump-fault':t<17?'storm':'baseline'
}
const round=(v:number,dp=2)=>Math.round(v*10**dp)/10**dp
export function autoScenarioAt(frame:number):ScenarioDefinition{
  if(!Number.isSafeInteger(frame)||frame<0)throw Error('自动数据帧索引无效')
  const id=autoScenarioId(frame)
  const source=SCENARIOS[id]
  const x=source.inputs
  const phase=frame%AUTO_CYCLE_FRAMES
  const change=Math.sin(frame*0.9)*0.035
  const demandRatio=1+change
  const normal=id==='baseline'
  const fault=id==='pump-fault'
  const storm=id==='storm'
  const inputs:ScenarioInputs={
    ...x,
    terminals:x.terminals.map(t=>({...t,demandM3h:round(t.demandM3h*demandRatio,2)})),
    // Dependent on the same phase as demand; never independently fabricated
    // measured readings. All three data fields are SIM inputs.
    capacityM3h:round(x.capacityM3h*(1+Math.sin(frame*.3)*.025),2),
    flowM3h:x.flowM3h===null?null:round(x.flowM3h*(1+change),2),
    pressureMpa:x.pressureMpa===null?null:round(
      x.pressureMpa+(normal?.015:storm?.005:fault?-.03:-.015)*Math.sin(frame),3),
    currentA:x.currentA===null?null:round(x.currentA*(1+Math.sin(frame)*.018),1),
    rainMm:storm?round(65+15*Math.sin(phase*.5),1):x.rainMm,
  }
  return {...source,inputs,summary:source.summary+'（自动Mock数据帧）'}
}

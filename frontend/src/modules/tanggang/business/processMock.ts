/**
 * TG-104 process-node Mock readings for the six existing CAD-derived systems.
 *
 * No random() / clock / network / DB side effects. Values never become SCADA
 * measurements, hydraulic mass-balance inputs, alarm events or work orders.
 * Re-running an identical scenario yields the same demo values.
 */
import type {TanggangDevice} from '../mapping/tanggangCatalog'
import type {ScenarioDefinition} from '../simulation/engine'
import {SCENARIOS} from '../simulation/engine'

export const PROCESS_MOCK_MODEL='tg-process-node-mock-v1'
export type ProcessDeviceKind =
  'pump'|'pool'|'valve'|'meter'|'controller'|'pipe'|'treatment'|'gate'|'facility'
export type ProcessMockState='running'|'available'|'attention'|'fault'
export interface ProcessMockReading {
  key:string
  value:string
  provenance:'MOCK_PROFILE'|'SCENARIO_INPUT'
  dataMode:'SIM'
}
export interface ProcessMockDevice {
  facilityId:string
  deviceKind:ProcessDeviceKind
  state:ProcessMockState
  stateLabel:string
  readings:ProcessMockReading[]
  highlight:ProcessMockReading|null
  context:'MOCK_BASELINE'|'ACTIVE_SCENARIO'
  scenarioId:string|null
  modelVersion:typeof PROCESS_MOCK_MODEL
  fieldVerified:false
  productionControlEnabled:false
}

export function processDeviceKind(device:Pick<TanggangDevice,'id'|'name'>):ProcessDeviceKind {
  const {id,name}=device
  if (/PLC|控制柜|控制箱/.test(id+' '+name))return 'controller'
  if (/METER|RADAR|WQ|LEVEL|仪表|水表|流量计|液位计|变送器/.test(id+' '+name))return 'meter'
  if (/VALVE|GATE|阀|闸门/.test(id+' '+name))return 'valve'
  if (/泵|LIFT|PUMP/.test(id+' '+name))return 'pump'
  if (/TANK|POOL|水池|集水池|蓄水/.test(id+' '+name))return 'pool'
  if (/排水沟|管网|管道/.test(name))return 'pipe'
  if (/净水器|处理设施|加药|压滤|污泥|格栅/.test(name))return 'treatment'
  return 'facility'
}

function hash(text:string):number {
  let h=2166136261
  for(let i=0;i<text.length;i++){
    h=Math.imul(h^text.charCodeAt(i),16777619)
  }
  return h>>>0
}
const round=(n:number,digits=1)=>n.toFixed(digits)
function sample(seed:number,lo:number,hi:number,precision=1){
  return round(lo+(seed%1000)/1000*(hi-lo),precision)
}
function stateText(kind:ProcessDeviceKind,state:ProcessMockState):string {
  if(state==='fault')return 'SIM异常'
  if(state==='attention')return 'SIM关注'
  if(kind==='pump'||kind==='treatment'||kind==='controller')return '模拟运行'
  return '模拟正常'
}
/**
 * Only EQ-P-MID is the hypothetical affected pump group for the existing
 * "pump-fault" scenario. EQ-P-METER displays the *scenario's assumed input*
 * pressure/flow. No other pump or north/south pond inherits that condition.
 */
export function mockProcessDevice(
  device:TanggangDevice,active:ScenarioDefinition|null,
):ProcessMockDevice {
  const def=active||SCENARIOS.baseline
  const kind=processDeviceKind(device)
  const id=device.id
  const fault=active?.id==='pump-fault'&&id==='EQ-P-MID'
  // Scenario attention means 'inspect this design area in the demo', not an
  // inferred sensor alarm or a demonstrated physical pipe connection.
  const attention=!!active&&(
    (active.id==='pump-fault'&&id==='EQ-P-METER')||
    (active.id==='peak'&&['EQ-P-MID','EQ-DP-TANK'].includes(id))||
    (active.id==='storm'&&['EQ-Y-DRAIN','EQ-NPOOL-POOL','EQ-SPOOL-POOL','EQ-BERTH-DRAIN'].includes(id))
  )
  const state:ProcessMockState=fault?'fault':attention?'attention':
    ['pump','treatment','controller'].includes(kind)?'running':'available'
  const readings:ProcessMockReading[]=[]
  for(const field of device.dataFields||[]){
    const seed=hash(id+'|'+field)
    const lower=field.toLowerCase()
    let value:string
    let origin:ProcessMockReading['provenance']='MOCK_PROFILE'
    if(id==='EQ-P-MID'&&active&&/泵运行状态|运行状态/.test(field)){
      value=def.inputs.pumpState==='fault'?'模拟故障':'模拟运行'
      origin='SCENARIO_INPUT'
    }else if(id==='EQ-P-MID'&&active&&/故障/.test(field)){
      value=def.inputs.pumpState==='fault'?'模拟故障':'模拟无故障'
      origin='SCENARIO_INPUT'
    }else if(id==='EQ-P-MID'&&active&&/出口压力/.test(field)){
      value=def.inputs.pressureMpa===null?'缺测（SIM）':
        round(def.inputs.pressureMpa,2)+' MPa'
      origin='SCENARIO_INPUT'
    }else if(id==='EQ-P-MID'&&active&&/出口流量/.test(field)){
      value=def.inputs.flowM3h===null?'缺测（SIM）':
        round(def.inputs.flowM3h,1)+' m³/h'
      origin='SCENARIO_INPUT'
    }else if(id==='EQ-P-METER'&&active&&/压力/.test(field)){
      value=def.inputs.pressureMpa===null?'缺测（SIM）':
        round(def.inputs.pressureMpa,2)+' MPa'
      origin='SCENARIO_INPUT'
    }else if(id==='EQ-P-METER'&&active&&/瞬时流量/.test(field)){
      value=def.inputs.flowM3h===null?'缺测（SIM）':
        round(def.inputs.flowM3h,1)+' m³/h'
      origin='SCENARIO_INPUT'
    }else if(/pH/.test(field)){
      value=sample(seed,7.0,7.7,2)
    }else if(/SS/.test(field)){
      value=sample(seed,23,58,1)+' mg/L'
    }else if(/氯离子/.test(field)){
      value=sample(seed,72,185,1)+' mg/L'
    }else if(/温度/.test(field)){
      value=sample(seed,29,55,1)+' °C'
    }else if(/压力/.test(field)){
      value=sample(seed,0.68,1.36,2)+' MPa'
    }else if(/高低.*报警|高\/低.*报警|液位报警|设备故障|报警|故障/.test(field)){
      value=fault?'模拟故障':'模拟无告警'
    }else if(id==='EQ-DP-TANK'&&/消防保留水量/.test(field)){
      value=sample(seed,120,320,1)+' m³'
    }else if(id==='EQ-DP-TANK'&&/可用水量/.test(field)){
      value=sample(seed,250,950,1)+' m³'
    }else if(/累计|本日用水量|计量|可用水量|保留水量|消防保留水量/.test(field)){
      value=sample(seed,1820,17600,1)+' m³'
    }else if(/流量|处理量|加水量|水量/.test(field)){
      value=sample(seed,19,96,1)+' m³/h'
    }else if(/液位|水位/.test(field)){
      value=sample(seed,1.3,3.5,2)+' m'
    }else if(/运行时间/.test(field)){
      value=sample(seed,330,2900,0)+' h'
    }else if(/阀门开度/.test(field)){
      value=sample(seed,35,85,0)+' %'
    }else if(/闸门|阀门|开关状态|开闭状态|电控状态/.test(field)){
      value='模拟开启'
    }else if(/控制方式/.test(field)){
      value='模拟远程'
    }else if(/通讯|通信/.test(field)){
      value='模拟在线'
    }else if(/状态|启停|泵启停|运行|控制|格栅/.test(lower)){
      value=fault?'模拟故障':'模拟运行'
    }else{
      // Unknown units or process-specific metrics are not invented.
      value='未配置Mock值'
    }
    readings.push({key:field,value,provenance:origin,dataMode:'SIM'})
  }
  const highlight=readings.find(x=>x.provenance==='SCENARIO_INPUT'&&
    (x.value.includes('故障')||x.value.includes('MPa')))||
    readings.find(x=>/\b(MPa|m³\/h|mg\/L)\b|MPa|m³\/h/.test(x.value))||
    readings.find(x=>!x.value.includes('未配置'))||null
  // Global SIM is not a telemetry feed. Unaffected facilities keep their
  // independent Mock baseline rather than pretending they are in this run.
  const directlyInScenario=!!active&&(
    fault||attention||readings.some(r=>r.provenance==='SCENARIO_INPUT')
  )
  const context:ProcessMockDevice['context']=directlyInScenario
    ?'ACTIVE_SCENARIO':'MOCK_BASELINE'
  return {
    facilityId:id,deviceKind:kind,state,stateLabel:stateText(kind,state),
    readings,highlight,context,scenarioId:directlyInScenario?active?.id:null,
    modelVersion:PROCESS_MOCK_MODEL,fieldVerified:false,
    productionControlEnabled:false,
  }
}

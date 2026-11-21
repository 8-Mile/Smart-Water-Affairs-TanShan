/** 5190统一情景推演：纯函数、无API写入、无生产数据。所有数值仅为演示假设。 */
export type ScenarioId = 'baseline' | 'peak' | 'pump-fault' | 'storm'
export interface SimTerminal {
  id: string
  label: string
  priority: 1 | 2 | 3
  demandM3h: number
}
export interface ScenarioInputs {
  capacityM3h: number
  reservedM3h: number
  poolInitialM3: number
  poolCapacityM3: number
  poolSafetyM3: number
  poolInflowM3h: number
  horizonHours: number
  pumpState: 'running' | 'fault'
  pressureMpa: number | null
  flowM3h: number | null
  currentA: number | null
  rainMm: number
  rainDurationH: number
  rainCatchmentM2: number
  runoffCoefficient: number
  rainStorageInitialM3: number
  rainStorageCapacityM3: number
  rainDrainM3h: number
  terminals: SimTerminal[]
}
export interface ScenarioDefinition {
  id: ScenarioId
  title: string
  subtitle: string
  summary: string
  category: '供水' | '设备' | '雨水'
  inputs: ScenarioInputs
}
const normalTerminals: SimTerminal[] = [
  { id:'DEMO-MA',label:'演示用水点 A · 卸船抑尘',priority:1,demandM3h:34 },
  { id:'DEMO-MC',label:'演示用水点 C · 转运抑尘',priority:2,demandM3h:22 },
]
const peakTerminals: SimTerminal[] = [
  { id:'DEMO-MA',label:'演示用水点 A · 卸船抑尘',priority:1,demandM3h:34 },
  { id:'DEMO-MB',label:'演示用水点 B · 卸船抑尘',priority:1,demandM3h:38 },
  { id:'DEMO-MC',label:'演示用水点 C · 转运抑尘',priority:2,demandM3h:22 },
  { id:'DEMO-MD',label:'演示用水点 D · 生产冲洗',priority:3,demandM3h:45 },
]
const base: ScenarioInputs = {
  capacityM3h:110,reservedM3h:10,poolInitialM3:1200,poolCapacityM3:2000,
  poolSafetyM3:400,poolInflowM3h:80,horizonHours:12,
  pumpState:'running',pressureMpa:1.22,flowM3h:56,currentA:85,
  rainMm:0,rainDurationH:2,rainCatchmentM2:18000,runoffCoefficient:.72,
  rainStorageInitialM3:460,rainStorageCapacityM3:1000,rainDrainM3h:45,
  terminals:normalTerminals,
}
export const SCENARIOS: Readonly<Record<ScenarioId,ScenarioDefinition>> = {
  baseline:{
    id:'baseline',title:'常态作业',subtitle:'基准情景',category:'供水',
    summary:'演示用水负荷低于假设可用供水能力，储量保持安全。',
    inputs:{...base,terminals:normalTerminals},
  },
  peak:{
    id:'peak',title:'多机集中用水',subtitle:'高峰供水风险',category:'供水',
    summary:'多个演示用水点同时启动，展示供水缺口、储量变化和监护线索如何联动。',
    inputs:{...base,capacityM3h:115,poolInitialM3:950,poolInflowM3h:55,
      pressureMpa:1.17,flowM3h:105,currentA:125,terminals:peakTerminals},
  },
  'pump-fault':{
    id:'pump-fault',title:'中压泵异常',subtitle:'供水能力下降',category:'设备',
    summary:'模拟一台泵异常导致供水能力不足，监护页面给出关联排查线索。',
    inputs:{...base,capacityM3h:55,reservedM3h:10,poolInitialM3:850,poolInflowM3h:40,
      pumpState:'fault',pressureMpa:.85,flowM3h:45,currentA:132,
      terminals:peakTerminals.filter(t=>t.id!=='DEMO-MD')},
  },
  storm:{
    id:'storm',title:'强降雨入池',subtitle:'调蓄容量风险',category:'雨水',
    summary:'假设强降雨产生地表径流，计算演示集水池的剩余库容和可能溢流。',
    inputs:{...base,rainMm:80,rainDurationH:2,terminals:normalTerminals},
  },
}
export const SCENARIO_IDS: ScenarioId[]=['baseline','peak','pump-fault','storm']
export type SimSeverity = 'normal' | 'attention' | 'critical'
export interface SimTerminalAssessment extends SimTerminal {
  allocatedM3h:number
  shortageM3h:number
}
export interface SimEvent {
  id:string
  domain:'供水'|'监护'|'雨水'
  level:SimSeverity
  title:string
  evidence:string
  path:string
}
export interface ScenarioResult {
  id:ScenarioId
  input:ScenarioInputs
  demandedM3h:number
  usableCapacityM3h:number
  deliveredM3h:number
  shortageM3h:number
  coveragePercent:number
  terminalAssessments:SimTerminalAssessment[]
  forecastPoolM3:number
  hoursToSafety:number|null
  poolPoints:{hour:number;volumeM3:number}[]
  poolRisk:SimSeverity
  pumpDiagnosis:{level:SimSeverity;title:string;evidence:string[];checks:string[]}
  rainCapturedM3:number
  rainEndM3:number
  rainOverflowM3:number
  rainRisk:SimSeverity
  events:SimEvent[]
}
function valid(label:string,n:number,lower=0,upper=1e8){
  if(!Number.isFinite(n)||n<lower||n>upper)throw Error(label+'：输入超出有效范围')
}
const round=(n:number,digits=1)=>Math.round(n*10**digits)/10**digits
/** 简化优先级配水计算，不代表经水力校核的实际分配，也不会验证管网连通。 */
export function calculateScenario(s:ScenarioDefinition):ScenarioResult{
  const x=s.inputs
  for(const k of ['capacityM3h','reservedM3h','poolInitialM3','poolCapacityM3','poolSafetyM3',
    'poolInflowM3h','horizonHours','rainMm','rainDurationH','rainCatchmentM2',
    'runoffCoefficient','rainStorageInitialM3','rainStorageCapacityM3','rainDrainM3h'] as const){
    valid(k,x[k],0,k==='runoffCoefficient'?1:100000000)
  }
  if(!x.horizonHours||x.horizonHours>72||x.reservedM3h>x.capacityM3h||
    x.poolInitialM3>x.poolCapacityM3||x.poolSafetyM3>x.poolCapacityM3||
    x.rainStorageInitialM3>x.rainStorageCapacityM3||!x.rainDurationH)
    throw Error('容量、储量、安全线或推演时段不满足约束')
  const terminalIds=new Set<string>()
  for(const t of x.terminals){
    if(terminalIds.has(t.id))throw Error('模拟终端编号重复')
    terminalIds.add(t.id);valid('终端需求',t.demandM3h)
    if(![1,2,3].includes(t.priority))throw Error('终端优先级非法')
  }
  const usableCapacity=x.capacityM3h-x.reservedM3h
  let remain=usableCapacity
  const allocated=new Map<string,SimTerminalAssessment>()
  for(const t of [...x.terminals].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))){
    const flow=Math.min(remain,t.demandM3h)
    remain-=flow
    allocated.set(t.id,{...t,allocatedM3h:round(flow),shortageM3h:round(t.demandM3h-flow)})
  }
  const terminals=x.terminals.map(t=>allocated.get(t.id)!)
  const demand=x.terminals.reduce((n,t)=>n+t.demandM3h,0)
  const delivered=terminals.reduce((n,t)=>n+t.allocatedM3h,0)
  const shortage=Math.max(0,demand-delivered)
  const change=x.poolInflowM3h-delivered
  const limit=(t:number)=>round(Math.max(0,Math.min(x.poolCapacityM3,x.poolInitialM3+change*t)))
  const hourMarks=[0,2,4,6,8,10,12,24,48,72].filter(t=>t<=x.horizonHours)
  if(hourMarks[hourMarks.length-1]!==x.horizonHours)hourMarks.push(x.horizonHours)
  const poolPoints=hourMarks.map(hour=>({hour,volumeM3:limit(hour)}))
  const hoursToSafety=x.poolInitialM3<=x.poolSafetyM3?0:change<0?
    round((x.poolInitialM3-x.poolSafetyM3)/(-change),2):null
  const poolRisk:SimSeverity=x.poolInitialM3<=x.poolSafetyM3?'critical':
    hoursToSafety!==null&&hoursToSafety<=x.horizonHours?'attention':'normal'
  // 演示监护定值，不作为实际PLC报警阈值。
  const status=x.pumpState
  const p=x.pressureMpa,c=x.currentA,f=x.flowM3h
  const evidence=[
    '模拟设备状态：'+(status==='fault'?'异常':'运行'),
    '模拟压力：'+(p===null?'缺测':p.toFixed(2)+' MPa'),
    '模拟电流：'+(c===null?'缺测':c.toFixed(0)+' A'),
    '模拟流量：'+(f===null?'缺测':f.toFixed(0)+' m³/h'),
    '参考定值：压力低于1.15 MPa、电流高于120 A、流量低于300 m³/h（仅演示）',
  ]
  const lowP=p!==null&&p<1.15
  const highC=c!==null&&c>120
  // 不使用不适用的流量绝对值作当前情景故障判断：供水需求/设备工况尚无额定数据。
  const level:SimSeverity=status==='fault'||lowP?'critical':highC||shortage>0?'attention':'normal'
  const pumpTitle=status==='fault'?'模拟泵组异常，需核查设备及供水能力':
    lowP?'模拟压力偏低，需多点核验':
    highC?'压力未越限但模拟电流偏高':
    shortage>0?'供水存在假设缺口，建议核实运行工况':'演示条件下未发现定义的监护异常'
  const checks=['核对厂家运行状态和现场时序数据','检查上下游压力、阀位与备用泵条件','必要时从原告警中心核对真实事件编号']
  const rainCaptured=x.rainMm/1000*x.rainCatchmentM2*x.runoffCoefficient
  const rainDrain=x.rainDrainM3h*x.rainDurationH
  const rainRaw=x.rainStorageInitialM3+rainCaptured-rainDrain
  const overflow=Math.max(0,rainRaw-x.rainStorageCapacityM3)
  const rainEnd=Math.max(0,Math.min(x.rainStorageCapacityM3,rainRaw))
  const rainRisk:SimSeverity=overflow>0?'critical':
    rainEnd>0.85*x.rainStorageCapacityM3?'attention':'normal'
  const events:SimEvent[]=[]
  if(shortage>.001)events.push({id:'SIM-SUPPLY',domain:'供水',level:'attention',
    title:'模拟供水缺口',evidence:'需求 '+round(demand)+'、可分配 '+round(delivered)+' m³/h，假设缺口 '+round(shortage)+' m³/h',
    path:'/port/water/supply'})
  if(level!=='normal')events.push({id:'SIM-PUMP',domain:'监护',level,
    title:pumpTitle,evidence:evidence.slice(0,4).join('；'),path:'/port/operations/monitor'})
  if(poolRisk!=='normal')events.push({id:'SIM-POOL',domain:'供水',level:poolRisk,
    title:'演示储量达到安全线风险',evidence:hoursToSafety===null?'未触发':'按恒定流量预计 '+hoursToSafety+' 小时达到假设安全线',
    path:'/port/water/supply'})
  if(x.rainMm>0&&rainRisk!=='normal')events.push({id:'SIM-RAIN',domain:'雨水',level:rainRisk,
    title:'模拟集水池调蓄风险',evidence:'降雨 '+x.rainMm+' mm，条件溢流 '+round(overflow)+' m³',
    path:'/port/water/rain-risk'})
  return {
    id:s.id,input:x,demandedM3h:round(demand),usableCapacityM3h:round(usableCapacity),
    deliveredM3h:round(delivered),shortageM3h:round(shortage),
    coveragePercent:demand?round(delivered/demand*100):100,terminalAssessments:terminals,
    forecastPoolM3:limit(x.horizonHours),hoursToSafety,poolPoints,poolRisk,
    pumpDiagnosis:{level,title:pumpTitle,evidence,checks},
    rainCapturedM3:round(rainCaptured),rainEndM3:round(rainEnd),
    rainOverflowM3:round(overflow),rainRisk,events,
  }
}

/**
 * Tanggang M20: six process chains, cross-system design relationships, and
 * auditable cost/energy/coverage calculations on ONE scenario snapshot.
 *
 * Evidence: V2.3_区域水路关系.csv; V2.5 system mapping. Edges are functional
 * design dependencies, not verified pipe endpoints. Values are illustrative
 * configurable assumptions, never measured savings or dispatch instructions.
 */
import type {ScenarioDefinition,ScenarioResult,ScenarioId} from './engine'
import {calculateScenario} from './engine'

export type ProcessId='fog'|'middle'|'mineral'|'rain'|'pool'|'domestic'
export type Relationship='design'|'conditional'|'independent'
export interface WaterProcess{
  id:ProcessId;label:string;responsibility:string;group:'water'|'wastewater'
  path:string
}
export const WATER_PROCESSES:readonly WaterProcess[]=[
  {id:'rain',label:'雨水收集',responsibility:'堆场/码头雨污水汇集、南北集水与提升',
    group:'wastewater',path:'/port/process/rain'},
  {id:'mineral',label:'含矿污水处理',responsibility:'物化处理、清水达标后回用、污泥处置',
    group:'wastewater',path:'/port/process/mineral'},
  {id:'pool',label:'水池供水',responsibility:'多水源补水、储量与供水约束',
    group:'water',path:'/port/process/pool'},
  {id:'middle',label:'中压供水',responsibility:'泵组向堆场、洗车和码头供水',
    group:'water',path:'/port/process/middle'},
  {id:'fog',label:'射雾器除尘',responsibility:'泵组向室内射雾设备供水',
    group:'water',path:'/port/process/fog'},
  {id:'domestic',label:'生活污水提升与外送',responsibility:'独立生活污水处理/外送；不可混入含矿水',
    group:'wastewater',path:'/port/process/domestic'},
] as const
export interface WaterRelationship{
  id:string;from:ProcessId;to:ProcessId;relation:'design'|'conditional'
  medium:'raw_wastewater'|'treated_water'|'supply_water'
  label:string;reason:string;basis:'V2.3_区域水路关系'
}
const design=(id:string,from:ProcessId,to:ProcessId,medium:WaterRelationship['medium'],
  label:string,reason:string,relation:WaterRelationship['relation']='design'):
  WaterRelationship=>({id,from,to,relation,medium,label,reason,basis:'V2.3_区域水路关系'})
export const WATER_RELATIONSHIPS:readonly WaterRelationship[]=[
  design('collect-treatment','rain','mineral','raw_wastewater','收集后提升至处理系统',
    'V2.3北侧集水池进入处理场；南侧存在其他备选路径'),
  design('clean-reuse','mineral','pool','treated_water','达标清水回用补水',
    '处理达标并满足水质条件方可回补；不包含未处理雨水'),
  design('pool-middle','pool','middle','supply_water','除尘水池取水→中压泵组',
    '泵房与除尘水池、堆场及码头供水的设计关系'),
  design('pool-fog','pool','fog','supply_water','除尘水池→射雾供水泵组',
    '泵房与除尘水池配套；具体支管端点未核实'),
  design('return-wash','middle','rain','raw_wastewater','洗车冲洗后的污水回收',
    '中压供水服务洗车台；洗车沉淀水进入南侧集水系统，非直接水管互连',
    'conditional'),
] as const
export function systemNeighbors(id:ProcessId){
  return {
    upstream:WATER_RELATIONSHIPS.filter(e=>e.to===id),
    downstream:WATER_RELATIONSHIPS.filter(e=>e.from===id),
    independent:id==='domestic',
  }
}
export function processName(id:ProcessId){
  return WATER_PROCESSES.find(x=>x.id===id)?.label||id
}

export const WATER_MODEL_VERSION='tg-water-operations-sim-v1'
export type SourceId='treated'|'reclaimed'|'tap'
export interface WaterSourcePolicy{
  id:SourceId;title:string;maxM3h:number;feeYuanM3:number
  /** Acquisition/treatment electricity before common delivery pumping. */
  sourceKwhM3:number
  condition:string;assumedQualityEligible:boolean
}
export interface WaterOperationsPolicy {
  source:WaterSourcePolicy[]
  baselineShare:Record<SourceId,number>
  /** Hypothetical electrical input per cubic metre at equal delivered volume.
   * Not manufacturer pump efficiency, and not inferred from sample current.
   */
  deliveryBaselineKwhM3:number
  deliveryOptimizedKwhM3:number
  electricityYuanKwh:number
}
export const DEFAULT_WATER_POLICY:WaterOperationsPolicy={
  source:[
    {id:'treated',title:'含矿污水达标回用水',maxM3h:18,feeYuanM3:1.1,
      sourceKwhM3:0.66,
      condition:'假设处理达标且水质许可、阀位及回用管线条件满足',
      assumedQualityEligible:true},
    {id:'reclaimed',title:'市政中水',maxM3h:26,feeYuanM3:1.8,
      sourceKwhM3:0.24,
      condition:'假设满足用途水质与实际接入条件',assumedQualityEligible:true},
    {id:'tap',title:'市政自来水',maxM3h:240,feeYuanM3:3.8,
      sourceKwhM3:0.11,
      condition:'假设有可用进水能力和合法供水许可',assumedQualityEligible:true},
  ],
  baselineShare:{treated:0.10,reclaimed:0.25,tap:0.65},
  deliveryBaselineKwhM3:0.48,
  deliveryOptimizedKwhM3:0.42,
  electricityYuanKwh:0.8,
}
export interface SourceAllocation{
  id:SourceId;title:string;volumeM3h:number;feeYuanH:number
  energyKwhH:number;sharePercent:number;capacityM3h:number
}
export interface PlanEconomics{
  allocation:SourceAllocation[]
  assignedM3h:number
  unmetM3h:number
  costYuanH:number
  energyKwhH:number
  specificKwhM3:number|null
  sourceCostYuanH:number
  sourceEnergyKwhH:number
  deliveryEnergyKwhH:number
  serviceIsMatched:boolean
}
export interface WaterEconomics{
  modelVersion:typeof WATER_MODEL_VERSION;dataMode:'SIM';fieldVerified:false
  assumptionsOnly:true
  source:WaterSourcePolicy[]
  base:PlanEconomics;optimized:PlanEconomics;energyPriority:PlanEconomics
  comparable:boolean
  savedCostYuanH:number|null
  savedEnergyKwhH:number|null
  energyReductionPercent:number|null
  costReductionPercent:number|null
  reusePercent:number
  deliveryCoveragePercent:number
  shortageM3h:number
  blockers:string[]
}
const q=(n:number,precision=2)=>Math.round(n*10**precision)/10**precision
function assertPolicy(policy:WaterOperationsPolicy){
  if(policy.source.length!==3||new Set(policy.source.map(s=>s.id)).size!==3||
    ['treated','reclaimed','tap'].some(id=>!policy.source.some(s=>s.id===id))||
    !Number.isFinite(policy.electricityYuanKwh)||policy.electricityYuanKwh<0||
    !Number.isFinite(policy.deliveryBaselineKwhM3)||
    !Number.isFinite(policy.deliveryOptimizedKwhM3)||
    policy.deliveryBaselineKwhM3<0||policy.deliveryOptimizedKwhM3<0)
    throw Error('节能比选假设参数不完整')
  for(const row of policy.source){
    if(![row.maxM3h,row.feeYuanM3,row.sourceKwhM3].every(
      v=>Number.isFinite(v)&&v>=0,
    ))throw Error('水源上限或单位成本非法')
  }
  const weight=Object.values(policy.baselineShare)
  if(weight.some(v=>!Number.isFinite(v)||v<0)||
    Math.abs(weight.reduce((sum,v)=>sum+v,0)-1)>1e-7)
    throw Error('基准水源比例必须合计100%')
}
function buildAllocation(
  volume:number,policy:WaterOperationsPolicy,mode:'baseline'|'cost'|'energy',
):PlanEconomics{
  const assigned:Record<SourceId,number>={treated:0,reclaimed:0,tap:0}
  const eligible=policy.source.filter(x=>x.assumedQualityEligible)
  let remaining=volume
  if(mode!=='baseline'){
    // Cost-minimizing allocation under explicit quality/flow limits, not
    // a hydraulic or asset-specific dispatch optimization.
    const score=(src:WaterSourcePolicy)=>mode==='cost'?
      src.feeYuanM3+src.sourceKwhM3*policy.electricityYuanKwh:
      src.sourceKwhM3
    const ranked=[...eligible].sort((a,b)=>
      score(a)-score(b)||a.id.localeCompare(b.id))
    for(const src of ranked){
      assigned[src.id]=Math.min(src.maxM3h,Math.max(0,remaining))
      remaining-=assigned[src.id]
    }
  }else{
    // Baseline shares aim at the SAME served volume, then reallocate any
    // capacity-limited remainder in the original source order.
    for(const src of policy.source){
      if(!src.assumedQualityEligible)continue
      assigned[src.id]=Math.min(src.maxM3h,volume*policy.baselineShare[src.id])
      remaining-=assigned[src.id]
    }
    for(const src of eligible){
      if(remaining<=1e-9)break
      const take=Math.min(remaining,src.maxM3h-assigned[src.id])
      assigned[src.id]+=take
      remaining-=take
    }
  }
  const allocated=policy.source.map(src=>({
    id:src.id,title:src.title,volumeM3h:assigned[src.id],
    feeYuanH:assigned[src.id]*src.feeYuanM3,
    energyKwhH:assigned[src.id]*src.sourceKwhM3,
    sharePercent:volume>0?q(assigned[src.id]/volume*100,1):0,
    capacityM3h:src.maxM3h,
  }))
  const delivered=allocated.reduce((sum,x)=>sum+x.volumeM3h,0)
  const sourceCost=allocated.reduce((sum,x)=>sum+x.feeYuanH,0)
  const sourceEnergy=allocated.reduce((sum,x)=>sum+x.energyKwhH,0)
  const pumpEnergy=delivered*(mode!=='baseline'?policy.deliveryOptimizedKwhM3:
    policy.deliveryBaselineKwhM3)
  const electricity=policy.electricityYuanKwh*(sourceEnergy+pumpEnergy)
  return {
    allocation:allocated.map(row=>({
      ...row,volumeM3h:q(row.volumeM3h),feeYuanH:q(row.feeYuanH),
      energyKwhH:q(row.energyKwhH),
    })),
    assignedM3h:q(delivered),unmetM3h:q(Math.max(0,volume-delivered)),
    costYuanH:q(sourceCost+electricity),
    energyKwhH:q(sourceEnergy+pumpEnergy),
    specificKwhM3:delivered>0?q((sourceEnergy+pumpEnergy)/delivered,3):null,
    sourceCostYuanH:q(sourceCost),sourceEnergyKwhH:q(sourceEnergy),
    deliveryEnergyKwhH:q(pumpEnergy),serviceIsMatched:Math.abs(delivered-volume)<1e-6,
  }
}
export function calculateWaterEconomics(result:ScenarioResult,
  policy:WaterOperationsPolicy=DEFAULT_WATER_POLICY):WaterEconomics{
  assertPolicy(policy)
  const served=result.deliveredM3h
  const base=buildAllocation(served,policy,'baseline')
  const optimized=buildAllocation(served,policy,'cost')
  const energyPriority=buildAllocation(served,policy,'energy')
  const comparable=base.serviceIsMatched&&optimized.serviceIsMatched&&
    energyPriority.serviceIsMatched&&
    Math.abs(base.assignedM3h-optimized.assignedM3h)<.01&&
    Math.abs(base.assignedM3h-energyPriority.assignedM3h)<.01
  const blockers=[
    '各水源单位价格、处理费用、单位电耗、可供流量均为模型演示假设，不是合同电价或现场实测',
    '三水源接入、处理达标、用途水质和阀位条件未做现场核实',
    '供水泵组没有实测流量-扬程-效率曲线，优化泵单耗为待校验假设',
    '本模型不生成任何PLC控制命令、生产派单或实际节能确认',
  ]
  if(result.shortageM3h>0)blockers.push(
    '本轮存在未满足用水需求；节能比选仅对两方案相同的已分配水量有效，不能宣称供水已保障')
  if(!comparable)blockers.push('模型水源容量不足，无法在同等服务量下进行节能/成本比选')
  const savingsEnergy=comparable?q(base.energyKwhH-optimized.energyKwhH):null
  const savingsCost=comparable?q(base.costYuanH-optimized.costYuanH):null
  const reused=optimized.allocation
    .filter(x=>x.id==='treated'||x.id==='reclaimed')
    .reduce((sum,x)=>sum+x.volumeM3h,0)
  return {
    modelVersion:WATER_MODEL_VERSION,dataMode:'SIM',fieldVerified:false,
    assumptionsOnly:true,source:policy.source,base,optimized,energyPriority,comparable,
    savedEnergyKwhH:savingsEnergy,savedCostYuanH:savingsCost,
    energyReductionPercent:comparable&&base.energyKwhH>0?
      q((base.energyKwhH-optimized.energyKwhH)/base.energyKwhH*100,1):null,
    costReductionPercent:comparable&&base.costYuanH>0?
      q((base.costYuanH-optimized.costYuanH)/base.costYuanH*100,1):null,
    reusePercent:served>0?q(reused/served*100,1):0,
    deliveryCoveragePercent:result.coveragePercent,
    shortageM3h:result.shortageM3h,blockers,
  }
}
export interface ProcessImpact {
  systemId:ProcessId;level:'normal'|'attention'|'critical'|'independent'
  description:string;scope:string
}
export function calculateProcessImpacts(scenario:ScenarioDefinition,result:ScenarioResult):
 ProcessImpact[]{
  const deficit=result.shortageM3h>0
  const storm=scenario.inputs.rainMm>0
  return [
    {systemId:'rain',level:storm&&result.rainRisk!=='normal'?result.rainRisk:
      storm?'attention':'normal',
      description:storm?'正在评估降雨汇流与假设集水容量':'无强降雨事件',
      scope:'南北池具体容量与连通未知，当前仅独立SIM集水单元'},
    {systemId:'mineral',level:storm?'attention':'normal',
      description:storm?'来水可能增加，需核实处理能力与缓冲储量':'污水处理与达标清水回用候选链',
      scope:'未接入含矿污水站独立流量、药剂与能耗模型'},
    {systemId:'pool',level:result.poolRisk==='normal'?
      deficit?'attention':'normal':result.poolRisk,
      description:result.poolRisk==='normal'?'演示储量未触及安全线':
        '储量安全线存在假设风险',
      scope:'统一示例储量不是除尘水池或南北池实体实测值'},
    {systemId:'middle',level:scenario.inputs.pumpState==='fault'?'critical':
      deficit?'attention':'normal',
      description:scenario.inputs.pumpState==='fault'?'演示中压泵能力受限':
        deficit?'供水负荷存在缺口':'演示中压供水负荷可覆盖',
      scope:'按优先级流量约束计算，未进行管网水力校核'},
    {systemId:'fog',level:deficit?'attention':'normal',
      description:deficit?'上游供水可能受影响，需确认本系统优先级与真实需求':
        '上游供水条件正常（逻辑参考）',
      scope:'无射雾器独立电耗、水量和设备故障模型，不能直接传染中压泵故障'},
    {systemId:'domestic',level:'independent',
      description:'独立生活污水链，不参与含矿污水回用核算',
      scope:'未建立独立的生活污水定量模型；不可借用含矿水指标'},
  ]
}
export function operationsSnapshot(s:ScenarioDefinition){
  const result=calculateScenario(s)
  return {scenario:s,result,economics:calculateWaterEconomics(result),
    impacts:calculateProcessImpacts(s,result)}
}

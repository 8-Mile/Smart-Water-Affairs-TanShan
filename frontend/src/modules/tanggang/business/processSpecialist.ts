/**
 * Three CAD-grounded specialist Mock exercises, independent from the global
 * water-supply/rainfall scenario engine. No SCADA, control, alarms or work orders.
 *
 * The thresholds are illustrative UI exercise rules, NOT owner set points,
 * discharge permits, equipment specifications or hydraulically validated facts.
 */
import type {ProcessMockDevice,ProcessMockReading,ProcessMockState} from './processMock'

export type SpecialistSystem='fog'|'mineral'|'domestic'
export type SpecialistProfileId=
  'fog-normal'|'fog-low-pressure'|'fog-control-offline'|
  'mineral-normal'|'mineral-ss-rise'|'mineral-sludge-high'|
  'domestic-local-reference'|'domestic-outbound-reference'|'domestic-outbound-low-flow'

export interface SpecialistCheckpoint {
  id:string
  facilityId:string
  title:string
  action:string
}
export interface SpecialistCase {
  id:SpecialistProfileId
  system:SpecialistSystem
  label:string
  scope:string
  rule:string
  outcome:'reference'|'attention'
  outcomeTitle:string
  suggestedAction:string
  checkpoints:readonly SpecialistCheckpoint[]
}
export interface SpecialistNodeOverride {
  facilityId:string
  state?:ProcessMockState
  stateLabel?:string
  fields?:Record<string,string>
}
const fogCheckpoints=[
  {id:'source',facilityId:'EQ-P-FOG',title:'核对供水泵组',action:'查看模拟出口压力和供水流量，确认是否影响射雾使用'},
  {id:'endpoint',facilityId:'EQ-Y-FOG',title:'核对室内射雾设备',action:'对照设备模拟压力、启停和现场就地控制条件'},
  {id:'control',facilityId:'EQ-P-PLC',title:'核对泵房控制柜',action:'查看模拟通讯与控制模式；仅提出人工核查建议'},
] as const
const mineralCheckpoints=[
  {id:'lifting',facilityId:'EQ-NPOOL-LIFT',title:'检查污水提升环节',action:'查看北侧提升设计节点；不推断南北池连通关系'},
  {id:'treatment',facilityId:'EQ-WWT-PURIFIER',title:'检查物化处理环节',action:'查看净水器出口SS演示值及工艺设施参考'},
  {id:'quality',facilityId:'EQ-WWT-WQ',title:'检查水质仪表',action:'查看独立示例仪表SS，不能判定达标或实际排放'},
  {id:'sludge',facilityId:'EQ-WWT-SLUDGE',title:'检查污泥处理环节',action:'查看模拟污泥液位；仅作运行排查演练'},
] as const
const domesticLocal=[
  {id:'option',facilityId:'EQ-DOM-SEWAGE',title:'本地处理设施参考',action:'确认这只是设计资料中的备选设施，不代表已投运'},
  {id:'water',facilityId:'EQ-DOM-METER',title:'生活用水表参考',action:'浏览独立Mock水量；用水量不能直接折算实际污水量'},
] as const
const domesticOutbound=[
  {id:'outbound',facilityId:'EQ-DOM-LINK',title:'核对既有处理场接口',action:'查看演示外送流量；真实接口及去向尚未确认'},
  {id:'water',facilityId:'EQ-DOM-METER',title:'生活用水计量参考',action:'区分生活用水与污水外送计量，不自动建立水量平衡'},
] as const

export const SPECIALIST_CASES:Readonly<Record<SpecialistProfileId,SpecialistCase>>={
  'fog-normal':{
    id:'fog-normal',system:'fog',label:'供水正常（演练）',
    scope:'室内射雾设备及供水泵组，供水管线尚未核实',
    rule:'示例出口压力0.62 MPa、室内设备压力0.59 MPa；无真实运行点表',
    outcome:'reference',outcomeTitle:'模拟基准工况',
    suggestedAction:'按供水泵组—室内射雾—控制柜依次检查Mock指标',
    checkpoints:fogCheckpoints,
  },
  'fog-low-pressure':{
    id:'fog-low-pressure',system:'fog',label:'射雾供水压力偏低',
    scope:'只影响已列出的射雾供水泵组与室内射雾设施',
    rule:'演示阈值：压力低于0.45 MPa时提示关注；不是设计最低供水压力',
    outcome:'attention',outcomeTitle:'模拟工况提示：射雾压力偏低',
    suggestedAction:'人工核对泵组出口、室内设备及阀门条件；不下发启停或调压命令',
    checkpoints:fogCheckpoints,
  },
  'fog-control-offline':{
    id:'fog-control-offline',system:'fog',label:'泵房通讯中断',
    scope:'仅演示泵房PLC/控制柜通讯状态，并非现场网络故障',
    rule:'通讯状态=Mock中断时提示人工核对；不推断泵组也已停止',
    outcome:'attention',outcomeTitle:'模拟工况提示：控制柜通讯',
    suggestedAction:'查看PLC/控制柜通讯条件，再核对现场就地状态，禁止远程操作',
    checkpoints:fogCheckpoints,
  },
  'mineral-normal':{
    id:'mineral-normal',system:'mineral',label:'处理流程参考（演练）',
    scope:'南北提升、处理场、水质仪表、污泥处理为设计工艺参考，不代表已核定水力链',
    rule:'示例出口SS=32 mg/L、仪表SS=34 mg/L、污泥液位1.10 m；仅演示参考',
    outcome:'reference',outcomeTitle:'模拟基准工况',
    suggestedAction:'按提升—物化处理—仪表—污泥环节查看设计设施和Mock参数',
    checkpoints:mineralCheckpoints,
  },
  'mineral-ss-rise':{
    id:'mineral-ss-rise',system:'mineral',label:'处理出口SS升高',
    scope:'出口SS仅引用净水器设计字段；独立仪表SS不明确代表实际排口',
    rule:'演示阈值：净水器出口SS高于65 mg/L提示关注；不作为排放标准',
    outcome:'attention',outcomeTitle:'模拟工况提示：出口SS参考值升高',
    suggestedAction:'人工核对处理环节、药剂及仪表示例，不自动断定不达标或外排污染',
    checkpoints:mineralCheckpoints,
  },
  'mineral-sludge-high':{
    id:'mineral-sludge-high',system:'mineral',label:'污泥液位偏高',
    scope:'仅作用于设计污泥池及柱塞泵设施',
    rule:'演示阈值：污泥液位高于3.0 m提示关注；不是实际池体高程或安全水位',
    outcome:'attention',outcomeTitle:'模拟工况提示：污泥液位',
    suggestedAction:'人工核对污泥泵和压滤机运行条件，不触发自动排泥或外排',
    checkpoints:mineralCheckpoints,
  },
  'domestic-local-reference':{
    id:'domestic-local-reference',system:'domestic',label:'方案A：一体化处理参考',
    scope:'独立备选方案A，仅展示设计一体化设施；不证明实际建设、运行或出水达标',
    rule:'两种设计方案互斥展示；没有业主确认时不能视为实际工艺',
    outcome:'reference',outcomeTitle:'备选方案A · 演示参考',
    suggestedAction:'核实设施建设与工艺方案；外送路线不自动视为同时投运',
    checkpoints:domesticLocal,
  },
  'domestic-outbound-reference':{
    id:'domestic-outbound-reference',system:'domestic',label:'方案B：接入既有处理场参考',
    scope:'独立备选方案B，仅展示生活污水接入接口；不证明已经外送',
    rule:'两种设计方案互斥展示；生活用水量不等于实测污水排放量',
    outcome:'reference',outcomeTitle:'备选方案B · 演示参考',
    suggestedAction:'核实既有处理场承接边界与接口，再讨论污水外送策略',
    checkpoints:domesticOutbound,
  },
  'domestic-outbound-low-flow':{
    id:'domestic-outbound-low-flow',system:'domestic',label:'方案B：外送流量偏低',
    scope:'仅在备选方案B里演示接口流量异常，不证明真实污水外送受阻',
    rule:'演示阈值：假设接口流量低于5 m³/h提示关注；并非合同或现场设定值',
    outcome:'attention',outcomeTitle:'模拟工况提示：外送流量偏低',
    suggestedAction:'人工核对计量、接口及承接条件；不得直接推断堵塞或发出控制命令',
    checkpoints:domesticOutbound,
  },
}
export const SPECIALIST_SYSTEM_IDS:Readonly<Record<SpecialistSystem,readonly SpecialistProfileId[]>>={
  fog:['fog-normal','fog-low-pressure','fog-control-offline'],
  mineral:['mineral-normal','mineral-ss-rise','mineral-sludge-high'],
  domestic:['domestic-local-reference','domestic-outbound-reference','domestic-outbound-low-flow'],
}
export const SPECIALIST_SYSTEMS:readonly SpecialistSystem[]=['fog','mineral','domestic']
export function isSpecialistSystem(systemId:string):systemId is SpecialistSystem{
  return SPECIALIST_SYSTEMS.some(s=>s===systemId)
}
export function getSpecialistCase(id:string|null|undefined,systemId:string):SpecialistCase|null{
  if(!id||!(id in SPECIALIST_CASES))return null
  const item=SPECIALIST_CASES[id as SpecialistProfileId]
  return item.system===systemId?item:null
}
function overrides(selected:SpecialistCase):Readonly<Record<string,SpecialistNodeOverride>>{
  switch(selected.id){
    case 'fog-normal':return {
      'EQ-P-FOG':{facilityId:'EQ-P-FOG',fields:{'出口压力':'0.62 MPa','供水流量':'18.0 L/s'}},
      'EQ-Y-FOG':{facilityId:'EQ-Y-FOG',fields:{'压力':'0.59 MPa'}},
    }
    case 'fog-low-pressure':return {
      'EQ-P-FOG':{facilityId:'EQ-P-FOG',state:'attention',
        fields:{'出口压力':'0.32 MPa','供水流量':'10.0 L/s'}},
      'EQ-Y-FOG':{facilityId:'EQ-Y-FOG',state:'attention',fields:{'压力':'0.29 MPa'}},
    }
    case 'fog-control-offline':return {
      'EQ-P-PLC':{facilityId:'EQ-P-PLC',state:'attention',
        fields:{'通讯状态':'Mock中断','报警':'模拟通讯提示'}},
    }
    case 'mineral-normal':return {
      'EQ-WWT-PURIFIER':{facilityId:'EQ-WWT-PURIFIER',fields:{'出口SS':'32 mg/L'}},
      'EQ-WWT-WQ':{facilityId:'EQ-WWT-WQ',fields:{'SS':'34 mg/L'}},
      'EQ-WWT-SLUDGE':{facilityId:'EQ-WWT-SLUDGE',fields:{'污泥液位':'1.10 m'}},
    }
    case 'mineral-ss-rise':return {
      'EQ-WWT-PURIFIER':{facilityId:'EQ-WWT-PURIFIER',state:'attention',
        fields:{'出口SS':'88 mg/L'}},
      'EQ-WWT-WQ':{facilityId:'EQ-WWT-WQ',state:'attention',
        fields:{'SS':'83 mg/L'}},
    }
    case 'mineral-sludge-high':return {
      'EQ-WWT-SLUDGE':{facilityId:'EQ-WWT-SLUDGE',state:'attention',
        fields:{'污泥液位':'3.40 m'}},
      'EQ-WWT-FILTER':{facilityId:'EQ-WWT-FILTER',state:'attention'},
    }
    case 'domestic-local-reference':return {
      'EQ-DOM-SEWAGE':{facilityId:'EQ-DOM-SEWAGE',
        state:'running',fields:{'污水处理量':'24.0 m³/h','运行状态':'方案A模拟运行'}},
    }
    case 'domestic-outbound-reference':return {
      'EQ-DOM-LINK':{facilityId:'EQ-DOM-LINK',
        fields:{'污水流量':'19.0 m³/h'}},
    }
    case 'domestic-outbound-low-flow':return {
      'EQ-DOM-LINK':{facilityId:'EQ-DOM-LINK',state:'attention',
        fields:{'污水流量':'2.0 m³/h'}},
    }
  }
}
/** Never run both domestic alternatives in the same Mock exercise. */
export function applySpecialistCase(
  systemId:string,
  device:ProcessMockDevice,
  selected:SpecialistCase|null,
):ProcessMockDevice{
  if(!isSpecialistSystem(systemId))return device
  let row:ProcessMockDevice={...device,readings:device.readings.map(x=>({...x}))}
  if(systemId==='domestic'&&
    ['EQ-DOM-SEWAGE','EQ-DOM-LINK'].includes(device.facilityId)){
    const unset=row.readings.map(r=>({...r,value:'路线待选择（Mock）'}))
    row={...row,state:'available',stateLabel:'备选方案未启用',
      readings:unset,highlight:unset[0]||null}
  }
  if(!selected||selected.system!==systemId)return row
  const override=overrides(selected)[device.facilityId]
  if(!override)return row
  const fields=override.fields||{}
  const readings:ProcessMockReading[]=row.readings.map(r=>
    Object.prototype.hasOwnProperty.call(fields,r.key)
      ?{...r,value:fields[r.key]!,provenance:'MOCK_PROFILE'}
      :r,
  )
  const highlight=readings.find(r=>Object.prototype.hasOwnProperty.call(fields,r.key))||
    row.highlight
  return {...row,
    state:override.state||row.state,
    stateLabel:override.state==='attention'?'专业Mock关注':(
      systemId==='domestic'?'方案Mock运行':row.stateLabel),
    readings,highlight,
    // Distinct from the independently running global supply/rainfall SIM.
    context:'MOCK_BASELINE',scenarioId:null,
  }
}


export function specialistAffectsDevice(
  systemId:string,facilityId:string,selected:SpecialistCase|null,
):boolean{
  return selected?.system===systemId&&
    Object.prototype.hasOwnProperty.call(overrides(selected),facilityId)
}


export function specialistAttentionFacilityIds(selected:SpecialistCase):string[]{
  return Object.values(overrides(selected))
    .filter(x=>x.state==='attention')
    .map(x=>x.facilityId)
}

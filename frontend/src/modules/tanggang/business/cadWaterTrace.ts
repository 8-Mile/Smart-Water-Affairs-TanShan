/**
 * CAD V2 relationship -> original text anchor -> design-area bridge.
 * CAD designRelationships describe business topology, not verified physical
 * pipes. Axx/Dxx reference codes are not CAD Handles.
 * Only TG-CAD object IDs and their sourceHandle count as original CAD evidence.
 */
import cad from './cadWaterNetwork.generated.json'
import type {ProcessId} from '../simulation/waterOperations'

export type TraceNode = typeof cad.designRelationships[number]['from']
export type TraceRelation = typeof cad.designRelationships[number]
export type TraceSystem = ProcessId|null
type RegionId =
  'REG-YARD'|'REG-PUMP'|'REG-DPOOL'|'REG-NPOOL'|'REG-SPOOL'|
  'REG-WWT'|'REG-WASH'|'REG-ECO'|'REG-DOMESTIC'|'REG-BERTH'
export interface TraceArea {
  regionId:RegionId|null
  /** CAD text anchors / annotations, not verified pipe endpoints */
  anchors:readonly string[]
  process:TraceSystem
  scope:string
}
export const CAD_TRACE_AREA:Readonly<Record<TraceNode,TraceArea>>={
  yard:{regionId:'REG-YARD',anchors:['TG-CAD-01','TG-CAD-02','TG-CAD-03',
    'TG-CAD-04','TG-CAD-05','TG-CAD-06','TG-CAD-07','TG-CAD-08'],
    process:'rain',scope:'堆场文字点；区域边界尚未逐一核实'},
  ditch:{regionId:'REG-YARD',anchors:[],process:'rain',
    scope:'设计排水沟关系；暂无本接口唯一CAD文字点'},
  north:{regionId:'REG-NPOOL',anchors:['TG-CAD-09'],process:'rain',
    scope:'北侧池组文字点；设计2座不等于两个池体已匹配'},
  south:{regionId:'REG-SPOOL',anchors:['TG-CAD-10'],process:'rain',
    scope:'南侧池组文字点；设计5座不等于五座池体已匹配'},
  wash:{regionId:'REG-WASH',anchors:['TG-CAD-13'],process:'middle',
    scope:'洗车台区文字点；沉淀池和加水点未完成一一定位'},
  washsed:{regionId:'REG-WASH',anchors:['TG-CAD-13'],process:'rain',
    scope:'仅洗车台区域锚点，不是三级沉淀池单体位置'},
  sewage:{regionId:'REG-WWT',anchors:['TG-CAD-11'],process:'mineral',
    scope:'污水处理场区域锚点，非具体进水口'},
  purifier:{regionId:'REG-WWT',anchors:['TG-CAD-11'],process:'mineral',
    scope:'污水处理场区域锚点，非净水器实装点位'},
  clear:{regionId:'REG-WWT',anchors:['TG-CAD-11','TG-CAD-26'],process:'mineral',
    scope:'污水场区域及清水池补水管注记；不是清水池中心点或出水口'},
  sludge:{regionId:'REG-WWT',anchors:[],process:'mineral',
    scope:'污泥设施有设计台账，尚无独立可核实CAD文字点'},
  eco:{regionId:'REG-ECO',anchors:['TG-CAD-14'],process:'pool',
    scope:'生态蓄水池文字点，未确认双向阀门实际接通'},
  dusttank:{regionId:'REG-DPOOL',anchors:[],process:'pool',
    scope:'有除尘水池设计清单，尚无两座除尘水池的独立CAD文字点'},
  municipal:{regionId:null,anchors:['TG-CAD-23'],process:'pool',
    scope:'市政水源文字说明，不是市政接入点实测坐标'},
  reclaimed:{regionId:null,anchors:['TG-CAD-23'],process:'pool',
    scope:'市政中水文字说明，不是中水计量点实测坐标'},
  midpump:{regionId:'REG-PUMP',anchors:['TG-CAD-12'],process:'middle',
    scope:'除尘泵房区域锚点，非中压泵组实际安装坐标'},
  fogpump:{regionId:'REG-PUMP',anchors:['TG-CAD-12'],process:'fog',
    scope:'除尘泵房区域锚点，非射雾泵安装坐标'},
  firepump:{regionId:'REG-PUMP',anchors:['TG-CAD-12'],process:null,
    scope:'消防泵组独立专业，不能当成中压泵'},
  fog:{regionId:'REG-YARD',anchors:[],process:'fog',
    scope:'射雾器单体位置尚未逐一与CAD锚点配准'},
  machine:{regionId:'REG-YARD',anchors:[],process:'middle',
    scope:'装卸机械用水终端，暂无单机水口CAD定位'},
  fire:{regionId:'REG-YARD',anchors:[],process:null,
    scope:'独立消防用水，不能当作中压除尘末端'},
  life:{regionId:'REG-DOMESTIC',anchors:[],process:'domestic',
    scope:'生活污水独立于含矿污水；实际方案未确认'},
  lifetreat:{regionId:'REG-DOMESTIC',anchors:['TG-CAD-16','TG-CAD-17'],
    process:'domestic',scope:'两个竞争性CAD设计注记；不能判定同时实施'},
} as const

export function knownCadAnchor(id:string){
  return cad.cadAnchors[id as keyof typeof cad.cadAnchors]||null
}
export function anchorFocusUrl(anchorId:string):string|null{
  const record=knownCadAnchor(anchorId)
  if(!record?.sourceHandle||!/^TG-CAD-\d{2}$/.test(anchorId))return null
  return '/tanggang/audit/cad-review/index.html?focus='+encodeURIComponent(anchorId.slice(7))
}
export function endpointFor(node:string):TraceArea|null{
  return Object.prototype.hasOwnProperty.call(CAD_TRACE_AREA,node)
    ?CAD_TRACE_AREA[node as TraceNode]:null
}
export function relationFor(id:string):TraceRelation|null{
  return cad.designRelationships.find(x=>x.id===id)||null
}
export function relationSourceIsCadHandle(source:string):boolean{
  return Object.values(cad.cadAnchors).some(a=>a.sourceHandle===source)
}
/** An explicitly scoped business relationship subset; NOT a verified pipe graph. */
export const CAD_PROCESS_RELATIONS:Readonly<Record<ProcessId,readonly string[]>>={
  rain:['L01','L02','L03','L04','L05','L06','L07','L08'],
  mineral:['L06','L07','L08','L09','L10','L11','L12','L13'],
  pool:['L12','L13','L14','S01','S02','S03','S04','S05','S06'],
  middle:['S04','S07','S08'],
  fog:['S05','S09'],
  domestic:['X01'],
} as const
export function relationsForProcess(systemId:string):TraceRelation[]{
  if(!Object.prototype.hasOwnProperty.call(CAD_PROCESS_RELATIONS,systemId))return []
  const ids=CAD_PROCESS_RELATIONS[systemId as ProcessId]
  return ids.map(relationFor).filter((v):v is TraceRelation=>!!v)
}

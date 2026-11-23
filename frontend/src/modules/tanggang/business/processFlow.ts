/**
 * CAD-derived functional process diagrams for the five non-fog systems.
 *
 * Evidence hierarchy:
 *  - V2.5 systems-v2.5.json: systems, CAD facility associations, pipe layers
 *  - V2.3 region-equipment-v2.3.json: design facility names and fields
 *  - V2.3 区域水路关系.csv: DESIGN/CONDITIONAL inter-region relationships
 *  - Source DWG endpoints and site as-builts are NOT verified.
 *
 * Routes describe the engineering functional sequence for a demonstrator.
 * They are not surveyed pipeline geometry or verified pipe endpoints.
 */
import type {
  EditableProcessSystemId,FogSymbolId,ProcessDiagramConnection,
  ProcessDiagramDocument,ProcessDiagramNode,
} from '@/api/tanggangProcessDiagrams'
import type {ProcessSchematicSection} from './processSchematic'
import {processDeviceKind} from './processMock'

type NonFogId=Exclude<EditableProcessSystemId,'fog'>
type Medium=ProcessDiagramConnection['medium']
type Relation=ProcessDiagramConnection['relation']
type Symbol=FogSymbolId
interface FacilityPlacement {id:string;x:number;y:number;symbol?:Symbol}
interface ReferencePlacement {id:string;label:string;x:number;y:number;symbol?:Symbol}
interface FlowLink {
  from:string;to:string
  medium?:Medium;relation?:Relation;label?:string
}
export interface ProcessFlowZone {key:string;title:string;subtitle:string;x:number;width:number}
interface ProcessFlowSpec {
  title:string;subtitle:string
  width:number;height:number
  facilities:FacilityPlacement[]
  references:ReferencePlacement[]
  links:FlowLink[]
  zones:ProcessFlowZone[]
}
const box=(key:string,title:string,subtitle:string,x:number,width:number):
  ProcessFlowZone=>({key,title,subtitle,x,width})
const d=(id:string,x:number,y:number,symbol?:Symbol):FacilityPlacement=>
  ({id,x,y,symbol})
const r=(id:string,label:string,x:number,y:number,symbol?:Symbol):ReferencePlacement=>
  ({id,label,x,y,symbol})
const l=(from:string,to:string,medium:Medium='water',
  relation:Relation='design',label?:string):FlowLink=>
  ({from,to,medium,relation,label})

const FLOWS:Record<NonFogId,ProcessFlowSpec>={
  middle:{
    title:'中压供水设计流程',subtitle:'除尘水池供水 → 中压泵 → 管网 → 多用水分支',
    width:1780,height:1050,
    zones:[
      box('source','取水与加压','跨系统水池为设计参考',18,455),
      box('meter','计量与主管','中压除尘专业图层',485,410),
      box('users','分支用水','端点与管径待校核',905,855),
    ],
    references:[r('source-pool','除尘水池水源参考',55,365,'water_tank')],
    facilities:[
      d('EQ-P-MID',300,370,'centrifugal_pump'),
      d('EQ-P-METER',570,370,'flow_meter'),
      d('EQ-Y-DUST',795,370,'pipe_tee'),
      d('EQ-Y-WATER',1120,170,'flow_meter'),
      d('EQ-WASH-PUMP',1120,405,'butterfly_valve'),
      d('EQ-BERTH-FLUSH',1410,605,'generic_equipment'),
      d('EQ-P-PLC',365,715,'generic_equipment'),
    ],
    links:[
      l('ref-source-pool','EQ-P-MID','water','design','水池取水'),
      l('EQ-P-MID','EQ-P-METER','water','design','加压出水'),
      l('EQ-P-METER','EQ-Y-DUST','water','design','中压主管'),
      l('EQ-Y-DUST','EQ-Y-WATER','water','conditional','水车支路待核'),
      l('EQ-Y-DUST','EQ-WASH-PUMP','water','design','冲洗供水'),
      l('EQ-Y-DUST','EQ-BERTH-FLUSH','water','conditional','码头分支待核'),
      l('EQ-P-PLC','EQ-P-MID','signal','design','泵组控制'),
    ],
  },
  mineral:{
    title:'含矿污水收集—净化—污泥处理',subtitle:'南北集水支路 + 加药净化 + 清水回用 / 污泥脱水',
    width:2080,height:1240,
    zones:[
      box('intake','含矿雨污水收集','南北独立提升支路',18,675),
      box('treat','污水处理场','加药、净化及过程监测',705,620),
      box('outlet','清水 / 污泥分流','生态回用为条件路径',1337,725),
    ],
    references:[],
    facilities:[
      d('EQ-NPOOL-GRID',60,180,'y_strainer'),
      d('EQ-NPOOL-LIFT',290,180,'centrifugal_pump'),
      d('EQ-NPOOL-LIFT2',515,180,'centrifugal_pump'),
      d('EQ-NPOOL-RADAR',100,370,'pressure_gauge'),
      d('EQ-SPOOL-LIFT',65,645,'centrifugal_pump'),
      d('EQ-SPOOL-LIFT2',325,645,'centrifugal_pump'),
      d('EQ-SPOOL-SUCTION',535,840,'centrifugal_pump'),
      d('EQ-WWT-DOSING',870,115,'generic_equipment'),
      d('EQ-WWT-PURIFIER',940,440,'y_strainer'),
      d('EQ-WWT-WQ',1130,650,'flow_meter'),
      d('EQ-WWT-PLC',875,950,'generic_equipment'),
      d('EQ-WWT-CLEAN',1410,300,'water_tank'),
      d('EQ-WWT-SLUDGE',1390,735,'water_tank'),
      d('EQ-WWT-FILTER',1745,740,'y_strainer'),
      d('EQ-ECO-PUMP',1650,325,'centrifugal_pump'),
      d('EQ-ECO-VALVE',1860,325,'butterfly_valve'),
    ],
    links:[
      l('EQ-NPOOL-GRID','EQ-NPOOL-LIFT','water','design','预处理提升'),
      l('EQ-NPOOL-LIFT','EQ-NPOOL-LIFT2','water','design','二次提升'),
      l('EQ-NPOOL-LIFT2','EQ-WWT-PURIFIER','water','design','北侧来水'),
      l('EQ-SPOOL-LIFT','EQ-SPOOL-LIFT2','water','design','南侧提升'),
      l('EQ-SPOOL-LIFT2','EQ-WWT-PURIFIER','water','conditional','南侧路径待核'),
      l('EQ-WWT-DOSING','EQ-WWT-PURIFIER','chemical','design','混凝加药'),
      l('EQ-WWT-PURIFIER','EQ-WWT-CLEAN','water','design','清水回用'),
      l('EQ-WWT-PURIFIER','EQ-WWT-SLUDGE','sludge','design','污泥分流'),
      l('EQ-WWT-SLUDGE','EQ-WWT-FILTER','sludge','design','板框压滤'),
      l('EQ-WWT-CLEAN','EQ-ECO-PUMP','water','conditional','条件调蓄'),
      l('EQ-ECO-PUMP','EQ-ECO-VALVE','water','conditional','阀位待核'),
      l('EQ-WWT-PLC','EQ-WWT-PURIFIER','signal','design','控制反馈'),
    ],
  },
  rain:{
    title:'港区雨污水收集与提升流程',subtitle:'堆场、码头分区收集 → 南北集水池 → 提升处理',
    width:1810,height:1110,
    zones:[
      box('catch','收集入口','地面排水沟 / 码头排水',18,390),
      box('split','南北分区收集','不能合并成单个集水池',425,810),
      box('lift','提升与去向','后续处理跨系统参考',1250,540),
    ],
    references:[r('treatment','含矿污水处理场（跨系统）',1530,500,'generic_equipment')],
    facilities:[
      d('EQ-Y-DRAIN',85,350,'pipe_straight'),
      d('EQ-BERTH-DRAIN',90,800,'pipe_straight'),
      d('EQ-NPOOL-GATE',470,155,'butterfly_valve'),
      d('EQ-NPOOL-POOL',730,160,'water_tank'),
      d('EQ-NPOOL-LIFT',1090,195,'centrifugal_pump'),
      d('EQ-NPOOL-RADAR',755,380,'pressure_gauge'),
      d('EQ-SPOOL-GATE',470,690,'butterfly_valve'),
      d('EQ-SPOOL-POOL',730,690,'water_tank'),
      d('EQ-SPOOL-LIFT',1090,710,'centrifugal_pump'),
      d('EQ-SPOOL-RADAR',755,900,'pressure_gauge'),
    ],
    links:[
      l('EQ-Y-DRAIN','EQ-NPOOL-GATE','water','design','北侧收集'),
      l('EQ-Y-DRAIN','EQ-SPOOL-GATE','water','design','南侧收集'),
      l('EQ-BERTH-DRAIN','EQ-SPOOL-GATE','water','design','码头排水'),
      l('EQ-NPOOL-GATE','EQ-NPOOL-POOL','water','design','北侧入池'),
      l('EQ-SPOOL-GATE','EQ-SPOOL-POOL','water','design','南侧入池'),
      l('EQ-NPOOL-POOL','EQ-NPOOL-LIFT','water','design','北侧提升'),
      l('EQ-SPOOL-POOL','EQ-SPOOL-LIFT','water','design','南侧提升'),
      l('EQ-NPOOL-LIFT','ref-treatment','water','design','后续处理'),
      l('EQ-SPOOL-LIFT','ref-treatment','water','conditional','南侧路由待核'),
    ],
  },
  pool:{
    title:'除尘水池补水—储存—供水流程',subtitle:'设计三水源参考 / 计量 / 水池 / 分专业泵组',
    width:1990,height:1170,
    zones:[
      box('replenish','补水来源','不同介质按条件切换',18,500),
      box('storage','进水计量与储存','除尘水池数量须核对',530,775),
      box('out','供水与监测','不同泵组分别供水',1317,654),
    ],
    references:[
      r('reclaimed','市政中水入口（示意）',70,155,'pipe_straight'),
      r('municipal','市政自来水入口（示意）',70,325,'pipe_straight'),
      r('term','堆场除尘 / 射雾负荷',1750,365,'generic_equipment'),
    ],
    facilities:[
      d('EQ-WWT-CLEAN',70,470,'water_tank'),
      d('EQ-ECO-PUMP',80,755,'centrifugal_pump'),
      d('EQ-ECO-LEVEL',80,920,'pressure_gauge'),
      d('EQ-ECO-METER',315,910,'flow_meter'),
      d('EQ-DP-VALVE',545,340,'butterfly_valve'),
      d('EQ-DP-METER',765,340,'flow_meter'),
      d('EQ-DP-TANK',1020,325,'water_tank'),
      d('EQ-DP-RADAR',1030,130,'pressure_gauge'),
      d('EQ-P-FOG',1370,200,'centrifugal_pump'),
      d('EQ-P-MID',1370,550,'centrifugal_pump'),
      d('EQ-P-METER',1640,560,'flow_meter'),
    ],
    links:[
      l('ref-reclaimed','EQ-DP-VALVE','water','design','中水补入'),
      l('ref-municipal','EQ-DP-VALVE','water','design','自来水补入'),
      l('EQ-WWT-CLEAN','EQ-DP-VALVE','water','design','达标清水回用'),
      l('EQ-ECO-PUMP','EQ-ECO-METER','water','design','生态水计量'),
      l('EQ-ECO-METER','EQ-DP-VALVE','water','conditional','生态补水条件'),
      l('EQ-DP-VALVE','EQ-DP-METER','water','design','进水计量'),
      l('EQ-DP-METER','EQ-DP-TANK','water','design','补水入池'),
      l('EQ-DP-TANK','EQ-P-FOG','water','design','射雾取水'),
      l('EQ-DP-TANK','EQ-P-MID','water','design','中压供水'),
      l('EQ-P-MID','EQ-P-METER','water','design','出水计量'),
      l('EQ-P-METER','ref-term','water','conditional','用水端按系统核对'),
    ],
  },
  domestic:{
    title:'生活污水处理与办公用水独立计量',subtitle:'处理去向待设计核验，两种生活污水路径暂按备选分开',
    width:1680,height:950,
    zones:[
      box('sewage','生活污水收集','设计接入方式存在备选',18,600),
      box('disposal','处理与外送','不能将两路径视为串联',630,620),
      box('office','办公用水计量','独立水量，不是污水',1260,400),
    ],
    references:[
      r('sewage-in','生活污水收集入口',55,310,'pipe_straight'),
      r('external','既有污水处理场接口',955,245,'generic_equipment'),
      r('out','处理后去向待核',950,565,'label'),
      r('office','办公生活给水',1280,315,'label'),
    ],
    facilities:[
      d('EQ-DOM-LINK',470,260,'pipe_straight'),
      d('EQ-DOM-SEWAGE',460,570,'generic_equipment'),
      d('EQ-DOM-METER',1440,325,'flow_meter'),
    ],
    links:[
      l('ref-sewage-in','EQ-DOM-LINK','water','conditional','设计接入备选'),
      l('EQ-DOM-LINK','ref-external','water','conditional','外送路径待核'),
      l('ref-sewage-in','EQ-DOM-SEWAGE','water','conditional','一体化处理备选'),
      l('EQ-DOM-SEWAGE','ref-out','water','conditional','去向未核'),
      l('ref-office','EQ-DOM-METER','water','design','办公用水计量'),
    ],
  },
}
const SYMBOL_SIZES:Record<Symbol,{width:number;height:number}>={
  fog_cannon:{width:125,height:96},water_tank:{width:145,height:104},
  centrifugal_pump:{width:146,height:96},pressure_gauge:{width:86,height:104},
  flow_meter:{width:100,height:90},butterfly_valve:{width:105,height:94},
  label:{width:185,height:46},generic_equipment:{width:138,height:105},
  pipe_straight:{width:126,height:74},pipe_elbow:{width:92,height:92},
  pipe_tee:{width:105,height:82},pipe_cross:{width:105,height:82},
  y_strainer:{width:105,height:94},
}
function autoSymbol(id:string,devices:Map<string,ProcessSchematicSection['devices'][number]>):Symbol{
  if(id==='EQ-Y-DUST')return 'pipe_tee'
  const device=devices.get(id)
  if(!device)throw Error('CAD流程设施未登记：'+id)
  const kind=processDeviceKind(device)
  if(kind==='pump')return 'centrifugal_pump'
  if(kind==='pool')return 'water_tank'
  if(kind==='valve'||kind==='gate')return 'butterfly_valve'
  if(kind==='meter')return 'flow_meter'
  if(kind==='pipe')return 'pipe_straight'
  return 'generic_equipment'
}
export function processFlowZones(systemId:EditableProcessSystemId):ProcessFlowZone[]{
  return systemId==='fog'?[]:FLOWS[systemId].zones
}
export function processFlowSummary(systemId:EditableProcessSystemId):string{
  return systemId==='fog'?'射雾供水设计示意':FLOWS[systemId].subtitle
}
export function isLegacyUnconnectedTemplate(
  systemId:EditableProcessSystemId,
  doc:ProcessDiagramDocument|null|undefined,
):boolean{
  return systemId!=='fog'&&!!doc&&doc.connections.length===0&&
    doc.nodes.length>0&&doc.nodes.every(n=>n.id.startsWith('cad-'))
}
export function buildProcessFlowDiagram(
  systemId:NonFogId,systemName:string,sections:ProcessSchematicSection[],
):ProcessDiagramDocument {
  const flow=FLOWS[systemId]
  const devices=new Map(sections.flatMap(s=>s.devices.map(d=>[d.id,d] as const)))
  const original=new Set(devices.keys())
  const bound=new Set(flow.facilities.map(x=>x.id))
  const missing=[...original].filter(id=>!bound.has(id))
  const unknown=[...bound].filter(id=>!original.has(id))
  if(missing.length||unknown.length)throw Error(
    systemId+' CAD设施清单变化，需要审核流程图配置。遗漏：'+missing.join(',')+' 未知：'+unknown.join(','))
  const nodes:ProcessDiagramNode[]=[
    ...flow.facilities.map(({id,x,y,symbol})=>{
      const type=symbol||autoSymbol(id,devices)
      return {
        id:'cad-'+id,symbol_id:type,facility_id:id,
        label:devices.get(id)!.name,position:{x,y},
        size:SYMBOL_SIZES[type],point_keys:[],
        visible:true,locked:false,
      }
    }),
    ...flow.references.map(({id,label,x,y,symbol})=>{
      const type=symbol||'label'
      return {
        id:'ref-'+id,symbol_id:type,facility_id:null,label,
        position:{x,y},size:SYMBOL_SIZES[type],point_keys:[],
        visible:true,locked:false,
      }
    }),
  ]
  const known=new Set(nodes.map(x=>x.id))
  const nodeId=(id:string)=>id.startsWith('ref-')?id:'cad-'+id
  const connections=flow.links.map((line,index):ProcessDiagramConnection=>{
    const source_node_id=nodeId(line.from),target_node_id=nodeId(line.to)
    if(!known.has(source_node_id)||!known.has(target_node_id))
      throw Error(systemId+' 设计流程端点未在CAD设施表：'+line.from+' → '+line.to)
    return {
      id:'design-'+String(index+1).padStart(2,'0'),
      source_node_id,target_node_id,
      medium:line.medium||'water',
      relation:line.relation||'design',
      label:line.label,
      verification:'illustrative',
    }
  })
  return {
    system_id:systemId,name:systemName+' · CAD设计流程组态',
    view_box:{width:flow.width,height:flow.height},
    background:'light-grid',nodes,connections,
  }
}

import type {
  FogSymbolId,ProcessDiagramDocument,ProcessDiagramNode,ProcessDiagramConnection,
} from '@/api/tanggangProcessDiagrams'

export const FOG_SYMBOLS:Readonly<Record<FogSymbolId,{
  name:string;width:number;height:number;asset:string|null
}>>={
  fog_cannon:{name:'室内射雾器',width:172,height:165,asset:'fog_cannon'},
  water_tank:{name:'水池',width:180,height:164,asset:'water_tank'},
  centrifugal_pump:{name:'供水泵',width:172,height:132,asset:'centrifugal_pump'},
  pressure_gauge:{name:'压力表',width:72,height:104,asset:'pressure_gauge'},
  flow_meter:{name:'流量计',width:62,height:62,asset:'flow_meter'},
  butterfly_valve:{name:'蝶阀',width:94,height:104,asset:'butterfly_valve'},
  label:{name:'说明标签',width:148,height:36,asset:null},
  generic_equipment:{name:'控制柜 / 设备',width:132,height:102,asset:null},
  pipe_straight:{name:'直管段',width:125,height:60,asset:'pipe_straight'},
  pipe_elbow:{name:'弯管',width:65,height:65,asset:'pipe_elbow'},
  pipe_tee:{name:'三通管',width:70,height:63,asset:'pipe_tee'},
  pipe_cross:{name:'四通管',width:68,height:69,asset:'pipe_cross'},
  y_strainer:{name:'Y型过滤器',width:75,height:63,asset:'y_strainer'},
}
export const FOG_FACILITIES={
  'EQ-P-FOG':'射雾供水泵组',
  'EQ-Y-FOG':'室内射雾设施',
  'EQ-P-PLC':'泵房PLC/控制柜',
} as const
export function sourceImage(symbol:FogSymbolId):string|null{
  const asset=FOG_SYMBOLS[symbol].asset
  return asset?'/tanggang/process-symbols/'+asset+'.png':null
}
export function copyFogDiagram(d:ProcessDiagramDocument):ProcessDiagramDocument{
  return JSON.parse(JSON.stringify(d)) as ProcessDiagramDocument
}
export function defaultFogDiagram():ProcessDiagramDocument{
  const make=(id:string,symbol_id:FogSymbolId,label:string,
    x:number,y:number,facility_id:string|null=null):ProcessDiagramNode=>({
    id,symbol_id,facility_id,label,position:{x,y},
    size:{width:FOG_SYMBOLS[symbol_id].width,height:FOG_SYMBOLS[symbol_id].height},
    point_keys:facility_id==='EQ-P-FOG'?['出口压力','供水流量']:
      facility_id==='EQ-Y-FOG'?['压力']:
      facility_id==='EQ-P-PLC'?['通讯状态']:[],
    visible:true,locked:false,
  })
  return {
    system_id:'fog',name:'射雾器除尘 · 工艺组态图',
    view_box:{width:1200,height:640},background:'light-grid',
    nodes:[
      make('source-tank','water_tank','水源参考 · 待核实',62,246),
      make('supply-pump','centrifugal_pump','射雾供水泵组',324,260,'EQ-P-FOG'),
      make('valve-demo','butterfly_valve','阀门示意 · 未绑定',608,279),
      make('fog-unit','fog_cannon','室内射雾设施',936,234,'EQ-Y-FOG'),
      make('plc-cabinet','generic_equipment','泵房PLC/控制柜',664,425,'EQ-P-PLC'),
      make('pressure-demo','pressure_gauge','压力表示意 · 未绑定',640,113),
    ],
    connections:[
      {id:'water-a',source_node_id:'source-tank',target_node_id:'supply-pump',
        medium:'water',verification:'illustrative'},
      {id:'water-b',source_node_id:'supply-pump',target_node_id:'valve-demo',
        medium:'water',verification:'illustrative'},
      {id:'water-c',source_node_id:'valve-demo',target_node_id:'fog-unit',
        medium:'water',verification:'illustrative'},
      {id:'signal-a',source_node_id:'plc-cabinet',target_node_id:'supply-pump',
        medium:'signal',verification:'illustrative'},
    ],
  }
}

/** No arbitrary source paths, scripts or verified pipe claims. */
export function validateFogDiagram(d:ProcessDiagramDocument):string[]{
  const errors:string[]=[]
  if(d.system_id!=='fog')errors.push('只能编辑射雾系统')
  if(d.nodes.length<1||d.nodes.length>60)errors.push('图元数量不合法')
  if(d.connections.length>60)errors.push('工艺连接超过上限')
  if(d.view_box.width<400||d.view_box.width>2200||
    d.view_box.height<300||d.view_box.height>1400){
    errors.push('画布尺寸不合法')
  }
  const ids=new Set<string>(),facilities=new Set<string>()
  for(const n of d.nodes){
    if(ids.has(n.id)||!/^[A-Za-z0-9_-]{2,60}$/.test(n.id))
      errors.push('图元ID重复或非法')
    ids.add(n.id)
    if(!(n.symbol_id in FOG_SYMBOLS))errors.push('未登记的图元素材')
    if(n.facility_id){
      if(!(n.facility_id in FOG_FACILITIES))errors.push('未知的CAD设计设施')
      if(facilities.has(n.facility_id))errors.push('同一设施不可重复绑定')
      facilities.add(n.facility_id)
    }
    if(n.point_keys.length&& !n.facility_id)errors.push('未绑定设施不能配置测点')
    if(n.point_keys.length>10||n.point_keys.length!==new Set(n.point_keys).size)
      errors.push('测点字段重复或超出上限')
    if([n.position.x,n.position.y,n.size.width,n.size.height].some(v=>!Number.isFinite(v))||
      n.position.x<0||n.position.y<0||n.size.width<=0||n.size.height<=0||
      n.position.x+n.size.width>d.view_box.width||
      n.position.y+n.size.height>d.view_box.height)
      errors.push('图元超出画布边界')
  }
  const lineIds=new Set<string>()
  for(const line of d.connections){
    if(lineIds.has(line.id)||!ids.has(line.source_node_id)||
      !ids.has(line.target_node_id)||line.source_node_id===line.target_node_id||
      line.verification!=='illustrative')errors.push('连接端点或核实状态不合法')
    lineIds.add(line.id)
  }
  return Array.from(new Set(errors))
}
export function midpoint(node:ProcessDiagramNode):{x:number;y:number}{
  return {x:node.position.x+node.size.width/2,y:node.position.y+node.size.height/2}
}
/**
 * Draw *illustrative* pipes at asset edges instead of through PNG sprite bodies.
 * Water: horizontal right-to-left connector with two orthogonal bends when
 * endpoints differ in elevation. Signal: separate bottom/top control channel.
 * Paths are purely graphical; do not represent verified hydraulic connectivity.
 */
export function schematicRoute(line:ProcessDiagramConnection,diagram:ProcessDiagramDocument):string{
  const from=diagram.nodes.find(x=>x.id===line.source_node_id)
  const to=diagram.nodes.find(x=>x.id===line.target_node_id)
  if(!from||!to)return ''
  if(line.medium==='signal'){
    const src=from.position, dst=to.position
    const targetX=Math.round(dst.x+to.size.width/2)
    const targetY=Math.round(dst.y+to.size.height)
    if(src.x>dst.x+to.size.width+12){
      // Equipment cabinet is to the lower right: route from its left edge,
      // around the water-valve label rather than behind the valve sprite.
      const fromX=Math.round(src.x)
      const fromY=Math.round(src.y+from.size.height/2)
      const bendX=Math.round((src.x+dst.x+to.size.width)/2)
      const bendY=targetY+22
      return 'M'+fromX+','+fromY+' H'+bendX+' V'+bendY+
        ' H'+targetX+' V'+targetY
    }
    const fromX=Math.round(src.x+from.size.width/2)
    const fromY=Math.round(src.y)
    const y=(fromY+targetY)/2
    return 'M'+fromX+','+fromY+' V'+y+' H'+targetX+' V'+targetY
  }
  const right=from.position.x+from.size.width
  const left=to.position.x
  const fromY=from.position.y+from.size.height/2
  const toY=to.position.y+to.size.height/2
  if(left>right+12){
    const mid=(right+left)/2
    return 'M'+right+','+fromY+' H'+mid+' V'+toY+' H'+left
  }
  // A wrapped illustrative link for a user-rearranged layout, never
  // forcing a diagonal stroke through the source or target devices.
  const source=midpoint(from), target=midpoint(to)
  const bend=Math.max(source.x,target.x)+38
  return 'M'+right+','+fromY+' H'+bend+' V'+toY+' H'+left
}

export interface FogZone {
  key:'source'|'pumping'|'terminal'
  index:string
  title:string
  subtitle:string
  from:number
  width:number
  tone:'neutral'|'blue'
}
/** Group headings are visual guide rails only; not a hydraulic topology. */
export function fogZones(canvasWidth:number):FogZone[]{
  return [
    {key:'source',index:'01',title:'水源参考',
      subtitle:'设施与储量待核实',from:20,width:canvasWidth*.225,tone:'neutral'},
    {key:'pumping',index:'02',title:'加压与控制',
      subtitle:'CAD设施绑定 + Mock监视',
      from:canvasWidth*.245,width:canvasWidth*.475,tone:'blue'},
    {key:'terminal',index:'03',title:'室内射雾',
      subtitle:'固定式射雾器参考',
      from:canvasWidth*.74,width:canvasWidth*.24,tone:'neutral'},
  ]
}

export function fogTelemetryPlacement(
  node:ProcessDiagramNode, canvas:{width:number;height:number},
):{x:number;y:number;width:number}{
  const width=node.facility_id==='EQ-P-FOG'?210:186
  // Pump/fog measured labels above assets, PLC to the right.
  const toRight=node.facility_id==='EQ-P-PLC'
  const desiredX=node.position.x+(toRight?node.size.width+17:
    node.size.width/2-width/2)
  const desiredY=node.position.y+(toRight?14:-86)
  const x=Math.min(canvas.width-width-12,Math.max(12,desiredX))
  const y=Math.min(canvas.height-76,Math.max(73,desiredY))
  return {x:x-node.position.x,y:y-node.position.y,width}
}

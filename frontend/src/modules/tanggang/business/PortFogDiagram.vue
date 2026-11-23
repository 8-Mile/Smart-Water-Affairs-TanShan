<script setup lang="ts">
/**
 * Restored 5144-era editor interactions (nodes / drag / bind / lines / undo /
 * redo / draft / publish / restore) on the current Tanggang 5190 design system.
 * Production SCADA controls and real pipe verification are deliberately absent.
 */
import {computed,onMounted,ref,watch} from 'vue'
import {Icon} from '@iconify/vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {
  fetchProcessDiagram,saveProcessDiagramDraft,publishProcessDiagram,
  fetchProcessDiagramHistory,restoreProcessDiagram,
  type EditableProcessSystemId,
  type FogSymbolId,type ProcessDiagramDocument,type ProcessDiagramNode,
  type ProcessDiagramRecord,type ProcessDiagramRevision,type ProcessDiagramConnection,
} from '@/api/tanggangProcessDiagrams'
import {
  FOG_SYMBOLS,sourceImage,copyFogDiagram,
  defaultProcessDiagram,validateFogDiagram,schematicRoute,
  fogZones,fogTelemetryPlacement,
} from './fogDiagram'
import type {ProcessMockDevice} from './processMock'
import type {TanggangDevice} from '../mapping/tanggangCatalog'
import type {ProcessSchematicSection} from './processSchematic'
import {isLegacyUnconnectedTemplate,processFlowZones,processFlowSummary} from './processFlow'
import {calculateProcessFlowRoute} from './processFlowRouting'
import {usePermissions} from '@/utils/permissions'

const props=defineProps<{
  systemId:EditableProcessSystemId
  systemName:string
  sections:ProcessSchematicSection[]
  selectedFacilityId:string|null
  facilities:TanggangDevice[]
  mockByFacility:ReadonlyMap<string,ProcessMockDevice>
  reviewedFacilityIds:ReadonlySet<string>
  simRunning:boolean
}>()
const emit=defineEmits<{
  selectFacility:[id:string]
  editingChange:[editing:boolean]
}>()
const {hasPerm}=usePermissions()
const canPublish=computed(()=>hasPerm('sys:menu:manage'))
const canEdit=computed(()=>hasPerm('eq:update')||canPublish.value)
const loaded=ref(false),loadError=ref('')
const remote=ref<ProcessDiagramRecord|null>(null)
const editing=ref(false),busy=ref(false),dirty=ref(false)
const draft=ref<ProcessDiagramDocument|null>(null)
const selectedNodeId=ref('')
const undoStack=ref<ProcessDiagramDocument[]>([])
const redoStack=ref<ProcessDiagramDocument[]>([])
const symbolQuery=ref('')
const showWater=ref(true)
const showSignal=ref(true)
const showTelemetry=ref(props.systemId==='fog')
const connectTarget=ref('')
const connectMedium=ref<ProcessDiagramConnection['medium']>('water')
const connectRelation=ref<NonNullable<ProcessDiagramConnection['relation']>>('design')
const mediumChoices=[
  {value:'water',label:'水路'},
  {value:'signal',label:'控制信号'},
  {value:'sludge',label:'污泥'},
  {value:'chemical',label:'加药'},
] as const
function mediumTitle(value:ProcessDiagramConnection['medium']):string{
  return mediumChoices.find(x=>x.value===value)?.label||value
}
const history=ref<ProcessDiagramRevision[]>([])
const historyVersion=ref<number|null>(null)
const canvas=ref<SVGSVGElement|null>(null)
const processViewport=ref<HTMLDivElement|null>(null)
function focusStage(x:number){
  if(!processViewport.value||!canvas.value)return
  const svgWidth=canvas.value.getBoundingClientRect().width
  processViewport.value.scrollLeft=Math.max(
    0,Math.round(x/stage.value.view_box.width*svgWidth)-18,
  )
}
const drag=ref<{
  id:string;dx:number;dy:number;pointerId:number;moved:boolean
}|null>(null)
const root=ref<HTMLElement|null>(null)
const symbols=computed(()=>Object.entries(FOG_SYMBOLS).filter(([,v])=>
  v.name.includes(symbolQuery.value.trim()),
) as Array<[FogSymbolId,(typeof FOG_SYMBOLS)[FogSymbolId]]>)
const initialDiagram=computed(()=>defaultProcessDiagram(
  props.systemId,props.systemName,props.sections))
const oldNoFlow=computed(()=>isLegacyUnconnectedTemplate(
  props.systemId,remote.value?.published))
const stage=computed(()=>editing.value&&draft.value?draft.value:
  oldNoFlow.value?initialDiagram.value:
  remote.value?.published||initialDiagram.value)
const zones=computed(()=>fogZones(stage.value.view_box.width))
const flowZones=computed(()=>processFlowZones(props.systemId))
const visibleConnections=computed(()=>stage.value.connections.filter(c=>
  c.medium==='signal'?showSignal.value:showWater.value,
))
const flowRoutes=computed(()=>new Map(stage.value.connections.map(c=>
  [c.id,calculateProcessFlowRoute(c,stage.value)])))
function connectionPath(c:ProcessDiagramConnection):string{
  return props.systemId==='fog'?schematicRoute(c,stage.value):
    flowRoutes.value.get(c.id)?.path||''
}
function routeColor(c:ProcessDiagramConnection):string{
  return c.medium==='sludge'?'#ac7b4e':
    c.medium==='chemical'?'#c39452':
    c.medium==='signal'?'#8fa5ba':'#60a9cf'
}
function routeDash(c:ProcessDiagramConnection):string{
  return c.medium==='signal'?'5 8':
    c.relation==='conditional'?'5 12':'17 8'
}
function labelPosition(c:ProcessDiagramConnection):{x:number;y:number}{
  if(props.systemId!=='fog')
    return flowRoutes.value.get(c.id)?.label||{x:0,y:0}
  const a=stage.value.nodes.find(n=>n.id===c.source_node_id)
  const b=stage.value.nodes.find(n=>n.id===c.target_node_id)
  if(!a||!b)return {x:0,y:0}
  return {
    x:Math.round((a.position.x+a.size.width/2+b.position.x+b.size.width/2)/2),
    y:Math.round((a.position.y+a.size.height/2+b.position.y+b.size.height/2)/2)-8,
  }
}
function telemetryPlacement(node:ProcessDiagramNode){
  return fogTelemetryPlacement(node,stage.value.view_box)
}
const selectedNode=computed(()=>draft.value?.nodes.find(n=>n.id===selectedNodeId.value)||null)
const selectedDesignDevice=computed(()=>props.facilities.find(f=>
  f.id===selectedNode.value?.facility_id)||null)
const availableFields=computed(()=>selectedDesignDevice.value?.dataFields||[])
const canChange=computed(()=>editing.value&&!busy.value&&!!draft.value)
const disabledNote='未验证水力连通 · 图中所有连接仅为设计示意'
const diagramVersion=computed(()=>remote.value?.published_version||0)
const isTemplate=computed(()=>!remote.value?.published)
const focusableNodes=computed(()=>stage.value.nodes.filter(n=>n.facility_id&&n.visible))
const activeCount=computed(()=>focusableNodes.value.filter(n=>['fault','attention'].includes(
  props.mockByFacility.get(n.facility_id!)?.state||'available',
)).length)
const checkedCount=computed(()=>focusableNodes.value.filter(n=>
  props.reviewedFacilityIds.has(n.facility_id!),
).length)
const duplicateFacilities=computed(()=>new Set(draft.value?.nodes
  .filter(n=>n.facility_id&&n.id!==selectedNodeId.value).map(n=>n.facility_id)||[]))
const displayMock=(facilityId:string|null)=>facilityId?props.mockByFacility.get(facilityId):null
function displayPointRows(node:ProcessDiagramNode):Array<{key:string;value:string}>{
  const mock=displayMock(node.facility_id)
  if(!mock)return []
  const keys=node.point_keys
  const selected=keys.length?mock.readings.filter(row=>keys.includes(row.key)):
    mock.highlight?[mock.highlight]:[]
  return selected.slice(0,3).map(row=>({key:row.key,value:row.value}))
}
function pointRowsHeight(node:ProcessDiagramNode):number{
  return 31+Math.max(displayPointRows(node).length,1)*18
}

async function reload(){
  try{
    loadError.value=''
    const response=await fetchProcessDiagram(props.systemId)
    remote.value=response.data.data
  }catch{
    loadError.value='组态服务暂不可用，显示只读演示模板；编辑与发布需连接后端'
  }finally{loaded.value=true}
}
onMounted(()=>{void reload()})
watch(editing,x=>emit('editingChange',x))
function snapshot(){
  if(!draft.value)return
  undoStack.value.push(copyFogDiagram(draft.value))
  if(undoStack.value.length>80)undoStack.value.shift()
  redoStack.value=[]
  dirty.value=true
}
async function beginEdit(){
  if(!canEdit.value||!remote.value)return
  // Old five-system drafts contained only CAD icons and no process connections.
  // Show a coherent flow preview immediately, but require explicit approval
  // before replacing a previously published unconnected legacy canvas.
  if(oldNoFlow.value&&!remote.value.draft){
    try{
      await ElMessageBox.confirm(
        '检测到旧版仅摆放设备、没有流程连线的已发布组态。现在载入按CAD设计关系整理的工艺流程底稿编辑吗？旧发布版本保留在历史中，保存和发布前不会修改它。',
        '载入CAD工艺流程底稿',
        {type:'info',confirmButtonText:'载入新流程',cancelButtonText:'继续保留旧版'},
      )
    }catch{return}
  }
  draft.value=copyFogDiagram(remote.value.draft||
    (oldNoFlow.value?initialDiagram.value:remote.value.published)||
    initialDiagram.value)
  selectedNodeId.value=''
  undoStack.value=[]
  redoStack.value=[]
  historyVersion.value=null
  dirty.value=false
  editing.value=true
  try{
    history.value=(await fetchProcessDiagramHistory(props.systemId)).data.data
  }catch{history.value=[]}
}
function cancelEdit(){
  editing.value=false
  draft.value=null
  selectedNodeId.value=''
  undoStack.value=[]
  redoStack.value=[]
  drag.value=null
  dirty.value=false
}
function undo(){
  if(!draft.value)return
  const d=undoStack.value.pop()
  if(!d)return
  redoStack.value.push(copyFogDiagram(draft.value))
  draft.value=d;dirty.value=true
}
function redo(){
  if(!draft.value)return
  const d=redoStack.value.pop()
  if(!d)return
  undoStack.value.push(copyFogDiagram(draft.value))
  draft.value=d;dirty.value=true
}
async function loadFlowTemplate(){
  if(!canChange.value||props.systemId==='fog')return
  try{
    await ElMessageBox.confirm(
      '将以CAD设计资料整理的主流程与分支替换当前编辑草稿中的无连接布局。已发布历史版本不会被覆盖，仍需人工保存并发布。',
      '载入设计流程',{type:'warning',confirmButtonText:'载入流程',cancelButtonText:'取消'},
    )
  }catch{return}
  snapshot()
  draft.value=copyFogDiagram(initialDiagram.value)
  selectedNodeId.value=''
  ElMessage.success('已载入工艺流程底稿，可编辑和校验后发布')
}
function addNode(symbolId:FogSymbolId){
  if(!draft.value||!canChange.value)return
  if(draft.value.nodes.length>=60){ElMessage.warning('最多60个图元');return}
  snapshot()
  const spec=FOG_SYMBOLS[symbolId]
  const freeSpots:Array<{x:number;y:number}>=[]
  for(let y=34;y+spec.height+36<draft.value.view_box.height;y+=115){
    for(let x=35;x+spec.width+65<draft.value.view_box.width;x+=155){
      const overlaps=draft.value.nodes.some(n=>
        x<n.position.x+n.size.width+22&&x+spec.width+22>n.position.x&&
        y<n.position.y+n.size.height+35&&y+spec.height+35>n.position.y)
      if(!overlaps)freeSpots.push({x,y})
    }
  }
  const position=freeSpots[0]
  if(!position){
    undoStack.value.pop()
    ElMessage.warning('画布空间不足，请先整理已有图元位置')
    return
  }
  const {x,y}=position
  const node:ProcessDiagramNode={
    id:'node-'+crypto.randomUUID().replace(/-/g,'').slice(0,14),
    symbol_id:symbolId,facility_id:null,label:spec.name+' · 未绑定',
    position:{x,y},size:{width:spec.width,height:spec.height},
    point_keys:[],visible:true,locked:false,
  }
  draft.value.nodes.push(node)
  selectedNodeId.value=node.id
}
function removeNode(){
  if(!draft.value||!selectedNode.value||!canChange.value)return
  snapshot()
  const id=selectedNode.value.id
  draft.value.nodes=draft.value.nodes.filter(x=>x.id!==id)
  draft.value.connections=draft.value.connections.filter(
    x=>x.source_node_id!==id&&x.target_node_id!==id)
  selectedNodeId.value=''
}
function setFacility(value:string){
  if(!selectedNode.value)return
  snapshot()
  selectedNode.value.facility_id=value||null
  selectedNode.value.point_keys=[]
  if(value){
    const f=props.facilities.find(x=>x.id===value)
    if(f)selectedNode.value.label=f.name
  }
}
function updateNodeLabel(value:string){
  if(!selectedNode.value||value===selectedNode.value.label)return
  snapshot()
  selectedNode.value.label=value
}
function setNodeDimension(which:'x'|'y'|'width'|'height',next:number){
  if(!selectedNode.value||!draft.value||!Number.isFinite(next))return
  const node=selectedNode.value
  const isPos=which==='x'||which==='y'
  const existing=isPos?node.position[which]:node.size[which]
  if(existing===next)return
  snapshot()
  const max=which==='x'?draft.value.view_box.width-node.size.width:
    which==='y'?draft.value.view_box.height-node.size.height:
    which==='width'?draft.value.view_box.width-node.position.x:
    draft.value.view_box.height-node.position.y
  const clamped=Math.max(isPos?0:1,Math.min(max,next))
  if(which==='x'||which==='y')node.position[which]=clamped
  else node.size[which]=clamped
}
function togglePointKey(key:string,value:boolean){
  if(!selectedNode.value||!selectedNode.value.facility_id)return
  snapshot()
  selectedNode.value.point_keys=value?
    [...selectedNode.value.point_keys,key].slice(0,10):
    selectedNode.value.point_keys.filter(x=>x!==key)
}
function setNodeBool(field:'visible'|'locked',value:boolean){
  if(!selectedNode.value)return
  snapshot()
  selectedNode.value[field]=value
}
function addConnection(){
  if(!draft.value||!selectedNode.value||!connectTarget.value||!canChange.value)return
  if(draft.value.connections.length>=60){ElMessage.warning('最多60条连接');return}
  if(draft.value.connections.some(x=>x.source_node_id===selectedNodeId.value&&
    x.target_node_id===connectTarget.value)){
    ElMessage.warning('同一图元之间已有连接');return
  }
  snapshot()
  const c:ProcessDiagramConnection={
    id:'line-'+crypto.randomUUID().replace(/-/g,'').slice(0,14),
    source_node_id:selectedNodeId.value,target_node_id:connectTarget.value,
    medium:connectMedium.value,relation:connectRelation.value,
    verification:'illustrative',
  }
  draft.value.connections.push(c);connectTarget.value=''
}
function removeConnection(id:string){
  if(!draft.value)return
  snapshot()
  draft.value.connections=draft.value.connections.filter(x=>x.id!==id)
}
function changeConnectionMedium(id:string,medium:ProcessDiagramConnection['medium']){
  const line=draft.value?.connections.find(x=>x.id===id)
  if(!line||line.medium===medium)return
  snapshot();line.medium=medium
}
function changeConnectionRelation(id:string,relation:'design'|'conditional'){
  const line=draft.value?.connections.find(x=>x.id===id)
  if(!line||line.relation===relation)return
  snapshot();line.relation=relation
}
function changeConnectionLabel(id:string,label:string){
  const line=draft.value?.connections.find(x=>x.id===id)
  if(!line||line.label===label)return
  snapshot();line.label=label.slice(0,50)
}
function pickNode(node:ProcessDiagramNode){
  if(editing.value){selectedNodeId.value=node.id;return}
  if(node.facility_id)emit('selectFacility',node.facility_id)
}
function coords(event:PointerEvent){
  const svg=canvas.value
  const matrix=svg?.getScreenCTM()
  if(!svg||!matrix)return null
  const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse())
  return {x:point.x,y:point.y}
}
function pointerDown(event:PointerEvent,node:ProcessDiagramNode){
  if(!editing.value||!draft.value||node.locked||!canChange.value||
    (event.pointerType==='mouse'&&event.button!==0))return
  const point=coords(event)
  if(!point)return
  selectedNodeId.value=node.id
  // Selecting without moving is not an editor change.
  drag.value={
    id:node.id,dx:point.x-node.position.x,dy:point.y-node.position.y,
    pointerId:event.pointerId,moved:false,
  }
  canvas.value?.setPointerCapture(event.pointerId)
}
function pointerMove(event:PointerEvent){
  if(!drag.value||!draft.value||!canChange.value||
    event.pointerId!==drag.value.pointerId)return
  const point=coords(event)
  if(!point)return
  const node=draft.value.nodes.find(x=>x.id===drag.value?.id)
  if(!node)return
  const x=Math.max(0,Math.min(draft.value.view_box.width-node.size.width,
    Math.round(point.x-drag.value.dx)))
  const y=Math.max(0,Math.min(draft.value.view_box.height-node.size.height,
    Math.round(point.y-drag.value.dy)))
  if(!drag.value.moved){
    if(Math.abs(x-node.position.x)<2&&Math.abs(y-node.position.y)<2)return
    snapshot()
    drag.value.moved=true
  }
  node.position.x=x
  node.position.y=y
}
function pointerUp(){drag.value=null}
function focusNext(kind:'attention'|'reviewed'){
  const candidates=focusableNodes.value.filter(n=>
    kind==='reviewed'?props.reviewedFacilityIds.has(n.facility_id!):
      ['fault','attention'].includes(
        props.mockByFacility.get(n.facility_id!)?.state||'available',
      ),
  ).map(n=>n.facility_id!)
  if(!candidates.length)return
  const i=candidates.indexOf(props.selectedFacilityId||'')
  emit('selectFacility',candidates[(i+1)%candidates.length]!)
}
async function saveDraft(){
  if(!draft.value||!remote.value||busy.value)return
  const errors=validateFogDiagram(draft.value,props.facilities)
  if(errors.length){ElMessage.error(errors.join('；'));return}
  busy.value=true
  try{
    remote.value=(await saveProcessDiagramDraft(props.systemId,
      draft.value,remote.value.revision)).data.data
    dirty.value=false
    ElMessage.success('组态草稿已保存到服务器，运行图尚未改变')
  }catch(e){
    ElMessage.error('草稿保存失败；可能发生版本冲突，请刷新组态后重试')
  }finally{busy.value=false}
}
async function publish(){
  if(!canPublish.value||!remote.value||busy.value)return
  // Publishing is an explicit second step on the server. Save pending edits
  // first, then publish the returned optimistic-lock revision.
  if(dirty.value||!remote.value.draft){
    if(!draft.value){
      ElMessage.warning('请先进入编辑模式并保存草稿')
      return
    }
    const errors=validateFogDiagram(draft.value,props.facilities)
    if(errors.length){ElMessage.error(errors.join('；'));return}
    busy.value=true
    try{
      remote.value=(await saveProcessDiagramDraft(props.systemId,
        draft.value,remote.value.revision)).data.data
      dirty.value=false
    }catch{
      ElMessage.error('草稿保存失败，无法发布；请检查版本冲突')
      busy.value=false
      return
    }
    busy.value=false
  }
  try{
    await ElMessageBox.confirm(
      '发布后运行页面将使用这份组态，所有管线仍属于未经现场校核的设计示意。确定发布吗？',
      '发布组态', {type:'warning',confirmButtonText:'确认发布',cancelButtonText:'取消'},
    )
  }catch{return}
  busy.value=true
  try{
    remote.value=(await publishProcessDiagram(props.systemId,remote.value.revision)).data.data
    ElMessage.success('组态已发布到运行页面')
    cancelEdit()
  }catch{ElMessage.error('发布失败：无权限或服务端版本已更改')}
  finally{busy.value=false}
}
async function restoreHistory(){
  if(!canPublish.value||!remote.value||historyVersion.value===null||busy.value)return
  if(dirty.value){ElMessage.warning('请先保存或取消当前更改后，再恢复历史版本');return}
  busy.value=true
  try{
    remote.value=(await restoreProcessDiagram(props.systemId,
      historyVersion.value,remote.value.revision)).data.data
    draft.value=copyFogDiagram(remote.value.draft!)
    undoStack.value=[];redoStack.value=[];dirty.value=false
    ElMessage.success('历史版本已恢复为草稿；仍需人工发布')
  }catch{ElMessage.error('恢复失败：历史版本不可用或已发生编辑冲突')}
  finally{busy.value=false}
}
const iconLabel=(id:string|null)=>id?
  props.facilities.find(f=>f.id===id)?.name||id:'未绑定设计设施'
</script>

<template>
  <section ref="root" class="tg-biz-card tg-diagram-section"
    data-testid="fog-process-diagram">
    <div class="tg-biz-card-head tg-diagram-top">
      <div>
        <h2>{{systemName}} · 组态图</h2>
        <small>{{systemId==='fog'
          ?'二维SCADA设计示意 · 图元点击显示右侧详情':
          processFlowSummary(systemId)+' · CAD设计关系示意，未做管线端点核验'}}</small>
      </div>
      <div class="tg-diagram-toolbar">
        <span class="tg-diagram-version">
          {{isTemplate?'示例模板·未发布':'已发布 v'+diagramVersion}}
        </span>
        <el-button v-if="!editing&&canEdit&&remote" size="small" plain
          data-testid="fog-begin-edit" @click="beginEdit">编辑组态</el-button>
        <el-button v-if="!editing&&canEdit&&remote?.draft" type="primary"
          :disabled="busy||!canPublish" title="发布当前已保存的草稿"
          data-testid="diagram-publish-saved" @click="publish">发布已存草稿</el-button>
        <template v-if="editing">
          <el-button size="small" :disabled="!undoStack.length||busy"
            @click="undo">撤销</el-button>
          <el-button size="small" :disabled="!redoStack.length||busy"
            @click="redo">重做</el-button>
          <el-button size="small" :disabled="busy||!dirty&&!!remote?.draft"
            data-testid="fog-save-draft" @click="saveDraft">保存草稿</el-button>
          <el-button type="primary" size="small"
            :disabled="busy||!canPublish"
            :title="!canPublish?'当前账号缺少组态发布权限（sys:menu:manage）':'保存当前改动并发布运行图'"
            data-testid="fog-publish" @click="publish">保存并发布</el-button>
          <el-button size="small" text @click="cancelEdit">退出编辑</el-button>
        </template>
      </div>
    </div>

    <p v-if="oldNoFlow&&!editing" class="tg-diagram-preview-note"
      data-testid="process-flow-legacy-notice">
      当前显示的是根据CAD设计关系生成的新流程预览。原已发布版本尚无连线；点击“编辑组态”确认载入流程底稿，保存并发布后方正式替换运行组态。
    </p>
    <div v-if="loadError" class="tg-diagram-error" role="status">{{loadError}}</div>
    <div v-else-if="!loaded" class="tg-diagram-helper">正在读取组态版本…</div>
    <div class="tg-diagram-quickbar">
      <span>{{editing?(dirty?'已修改 · 请保存草稿':'编辑模式 · 当前无未保存修改'):
        'CAD设施与演示状态叠加 · 非现场实测'}}</span>
      <template v-if="editing&&systemId!=='fog'&&draft&&draft.connections.length===0">
        <el-button size="small" plain data-testid="load-process-flow-base"
          :disabled="busy" @click="loadFlowTemplate">载入CAD设计流程</el-button>
      </template>
      <template v-if="!editing">
        <el-button text size="small" :disabled="!activeCount" @click="focusNext('attention')">
          定位SIM关注/异常（{{activeCount}}）
        </el-button>
        <el-button text size="small" :disabled="!checkedCount" @click="focusNext('reviewed')">
          定位本轮已核查（{{checkedCount}}）
        </el-button>
      </template>
    </div>
    <div class="tg-diagram-layers" data-testid="fog-diagram-layers"
      aria-label="工艺图显示图层">
      <span>图层显示</span>
      <el-checkbox v-model="showWater" size="small"
        :label="systemId==='fog'?'水路示意':'水路 / 污泥 / 加药'"/>
      <el-checkbox v-model="showSignal" size="small" label="控制信号"/>
      <el-checkbox v-model="showTelemetry" size="small" label="演示数据"/>
      <span class="tg-diagram-layers-hint">图层开关只影响显示，不改变已保存组态</span>
    </div>
    <nav v-if="systemId!=='fog'" class="tg-flow-stages-nav"
      aria-label="工艺流程阶段快速定位" data-testid="process-flow-stage-nav">
      <strong>工艺流程</strong>
      <button v-for="(zone,i) in flowZones" :key="zone.key" type="button"
        :data-stage-key="zone.key" @click="focusStage(zone.x)">
        <span>{{String(i+1).padStart(2,'0')}}</span> {{zone.title}}
      </button>
      <small>点击阶段定位 · 图内可横向滚动</small>
    </nav>
    <div class="tg-diagram-workspace" :class="{'is-editing':editing}">
      <div v-if="editing" class="tg-diagram-symbols">
        <strong>工业图元库</strong>
        <el-input v-model="symbolQuery" size="small" clearable placeholder="搜索图元"/>
        <div class="tg-diagram-symbol-list">
          <button v-for="[key,spec] in symbols" :key="key" type="button"
            class="tg-diagram-symbol-button" @click="addNode(key)">
            <img v-if="sourceImage(key)" :src="sourceImage(key)!" alt="" loading="lazy"/>
            <Icon v-else icon="ri:settings-3-line" width="20"/>
            <span>{{spec.name}}</span>
          </button>
        </div>
      </div>

      <div ref="processViewport" class="tg-diagram-viewport"
        :class="{'is-process-flow':systemId!=='fog'}">
        <p class="tg-diagram-mobile-hint">横向滑动查看完整工艺图，点击设备查看详情</p>
        <svg ref="canvas" class="tg-diagram-svg"
          :viewBox="'0 0 '+stage.view_box.width+' '+stage.view_box.height"
          role="img" :aria-label="systemName+'工艺组态图，点击图元查看设备，设计连接待现场核实'"
          @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
          <defs>
            <pattern id="tg-fog-grid" width="29" height="29" patternUnits="userSpaceOnUse">
              <path d="M 29 0 L 0 0 0 29" fill="none" stroke="#a9c7d8"
                stroke-opacity=".20" stroke-width="1"/>
            </pattern>
            <linearGradient id="tg-fog-canvas-gradient" x1="0" y1="0" x2=".5" y2="1">
              <stop offset="0" stop-color="#f8fbff"/>
              <stop offset="1" stop-color="#eff6fb"/>
            </linearGradient>
            <linearGradient id="tg-fog-zone-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#f3faff" stop-opacity=".94"/>
              <stop offset="1" stop-color="#eaf5fa" stop-opacity=".60"/>
            </linearGradient>
            <marker id="tg-fog-water-arrow" viewBox="0 0 10 10"
              refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 1 1 L 9 5 L 1 9 Z" fill="#6ea6c8"/>
            </marker>
            <marker id="tg-flow-sludge-arrow" viewBox="0 0 10 10"
              refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 1 1 L 9 5 L 1 9 Z" fill="#ac7b4e"/>
            </marker>
            <marker id="tg-flow-chemical-arrow" viewBox="0 0 10 10"
              refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 1 1 L 9 5 L 1 9 Z" fill="#c39452"/>
            </marker>
          </defs>
          <rect :width="stage.view_box.width" :height="stage.view_box.height"
            fill="url(#tg-fog-canvas-gradient)"/>
          <rect :width="stage.view_box.width" :height="stage.view_box.height"
            fill="url(#tg-fog-grid)"/>
          <g v-if="systemId==='fog'" pointer-events="none" data-testid="fog-diagram-zones">
            <g v-for="zone in zones" :key="zone.key">
              <rect :x="zone.from" y="23" :width="zone.width"
                :height="stage.view_box.height-89" rx="13"
                :fill="zone.tone==='blue'?'url(#tg-fog-zone-fill)':'#ffffff'"
                :fill-opacity="zone.tone==='blue'?1:.57"
                stroke="#cedfe8" stroke-width="1.3"
                stroke-dasharray="6 8"/>
              <rect :x="zone.from+16" y="45" width="38" height="29" rx="7"
                fill="#dfedf6"/>
              <text :x="zone.from+35" y="65" font-size="15"
                fill="#4b91b8" font-weight="700" text-anchor="middle">{{zone.index}}</text>
              <text :x="zone.from+65" y="64" font-size="17"
                fill="#355f76" font-weight="650">{{zone.title}}</text>
              <text :x="zone.from+18" y="95" font-size="12"
                fill="#8aa3b1">{{zone.subtitle}}</text>
            </g>
            <rect :x="stage.view_box.width-249" y="19" width="223"
              height="28" rx="7" fill="#e3f1f9" stroke="#bad9e9"/>
            <text :x="stage.view_box.width-138" y="38" text-anchor="middle"
              font-size="12" fill="#557f95">结构参考 / 非实际管网拓扑</text>
          </g>
          <g v-else pointer-events="none" data-testid="process-flow-stages">
            <g v-for="(zone,index) in flowZones" :key="zone.key">
              <rect :x="zone.x" y="23" :width="zone.width"
                :height="stage.view_box.height-118" rx="13"
                :fill="index%2?'#e7f3f9':'#ffffff'" fill-opacity=".65"
                stroke="#cedfe8" stroke-width="1.5" stroke-dasharray="7 8"/>
              <rect :x="zone.x+15" y="48" width="38" height="29" rx="7"
                fill="#deedf5"/>
              <text :x="zone.x+34" y="68" font-size="15"
                fill="#4b91b8" font-weight="700" text-anchor="middle">
                {{String(index+1).padStart(2,'0')}}
              </text>
              <text :x="zone.x+65" y="66" font-size="18"
                fill="#355f76" font-weight="700">{{zone.title}}</text>
              <text :x="zone.x+18" y="98" font-size="13"
                fill="#7899ab">{{zone.subtitle}}</text>
            </g>
            <rect :x="stage.view_box.width-328" y="20" width="308" height="26"
              rx="7" fill="#e6f2f8" stroke="#bdd8e6"/>
            <text :x="stage.view_box.width-174" y="38" text-anchor="middle"
              font-size="12" fill="#507c92">
              设计工艺关系 · 非DWG端点核验
            </text>
          </g>
          <g v-for="line in visibleConnections" :key="line.id"
            class="tg-diagram-pipe" :data-flow-connection="line.id"
            :data-flow-medium="line.medium" :data-flow-relation="line.relation||'design'"
            pointer-events="none">
            <path :d="connectionPath(line)" fill="none"
              stroke="#fff" :stroke-width="line.medium==='signal'?7:11"
              stroke-linecap="round" stroke-linejoin="round" opacity=".96"/>
            <path :d="connectionPath(line)" fill="none"
              :stroke="routeColor(line)"
              :stroke-width="line.medium==='signal'?3:6" stroke-linecap="round"
              stroke-linejoin="round"
              :stroke-dasharray="routeDash(line)"
              :marker-end="line.medium==='signal'?undefined:
                line.medium==='sludge'?'url(#tg-flow-sludge-arrow)':
                line.medium==='chemical'?'url(#tg-flow-chemical-arrow)':
                'url(#tg-fog-water-arrow)'"
              opacity=".96"/>
            <g v-if="line.label&&systemId!=='fog'"
              :transform="'translate('+labelPosition(line).x+','+
                labelPosition(line).y+')'">
              <rect :x="-Math.max(48,line.label.length*6+12)/2"
                y="-14" :width="Math.max(48,line.label.length*6+12)"
                height="20" rx="5" fill="#f8fcfe" fill-opacity=".94"
                stroke="#d4e5ed" stroke-width=".8"/>
              <text text-anchor="middle" y="0" font-size="11"
                :fill="line.relation==='conditional'?'#b18a50':'#658b9d'">
                {{line.label.slice(0,24)}}
              </text>
            </g>
          </g>
          <g v-for="node in stage.nodes" :key="node.id"
            v-show="node.visible||editing"
            class="tg-diagram-node"
            :class="{
              'is-selected':editing?selectedNodeId===node.id:selectedFacilityId===node.facility_id,
              'is-attention':displayMock(node.facility_id)?.state==='attention',
              'is-fault':displayMock(node.facility_id)?.state==='fault',
              'is-locked':editing&&node.locked,
              'is-unbound':!node.facility_id,
              'is-dragging':drag?.id===node.id,
            }"
            :transform="'translate('+node.position.x+','+node.position.y+')'"
            tabindex="0" role="button"
            :aria-label="node.label+'，'+iconLabel(node.facility_id)"
            @click.stop="pickNode(node)"
            @keydown.enter.stop="pickNode(node)"
            @keydown.space.prevent.stop="pickNode(node)"
            @pointerdown.stop="pointerDown($event,node)">
            <rect class="tg-diagram-node-hit" x="-8" y="-6"
              :width="node.size.width+16" :height="node.size.height+36"
              rx="9" fill="transparent"/>
            <ellipse v-if="node.symbol_id!=='label'&&node.symbol_id!=='pipe_straight'"
              :cx="node.size.width/2" :cy="node.size.height-6"
              :rx="node.size.width*.38" ry="9"
              fill="#7ca9bc" opacity=".12"/>
            <rect class="tg-diagram-node-frame" x="-7" y="-6"
              :width="node.size.width+14" :height="node.size.height+12"
              rx="9" fill="#fff" fill-opacity=".07"
              stroke="#4e9cbf" stroke-opacity=".10" stroke-width="2"/>
            <image v-if="sourceImage(node.symbol_id)"
              :href="sourceImage(node.symbol_id)!"
              :width="node.size.width" :height="node.size.height"
              preserveAspectRatio="xMidYMid meet"/>
            <g v-else-if="node.symbol_id==='generic_equipment'">
              <rect :width="node.size.width" :height="node.size.height" rx="10"
                fill="#e5eff4" stroke="#72a4be" stroke-width="3"/>
              <rect x="10" y="12" :width="node.size.width-20" :height="node.size.height-24"
                rx="5" fill="#f6fbfd" stroke="#9fbfce"/>
              <circle cx="25" cy="28" r="5" fill="#65b69f"/>
              <path :d="'M18 48 H'+(node.size.width-18)"
                stroke="#94b6c7" stroke-width="3" stroke-dasharray="8 6"/>
              <text x="50%" y="75%" text-anchor="middle" font-size="14"
                fill="#49758c">{{/PLC|控制柜|控制箱/.test(node.label)?'PLC':'设备'}}</text>
            </g>
            <rect v-if="node.symbol_id==='label'"
              :width="node.size.width" :height="node.size.height" rx="6"
              fill="#e3f0f7" stroke="#90b8cd"/>
            <text v-if="node.symbol_id==='label'"
              :x="node.size.width/2" :y="node.size.height/2+4"
              text-anchor="middle" font-size="13" fill="#426a80">
              {{node.label.slice(0,14)}}
            </text>
            <rect v-if="node.facility_id" x="-12" :y="node.size.height+9"
              :width="node.size.width+24" height="27" rx="7" fill="#f6fbfe"
              stroke="#c3dce9" stroke-width="1.3"/>
            <text v-if="node.facility_id" class="tg-diagram-node-label"
              :x="node.size.width/2" :y="node.size.height+27"
              text-anchor="middle" font-size="15"
              fill="#315c73" font-weight="650">{{node.label.slice(0,13)}}</text>
            <rect v-if="!node.facility_id&&node.symbol_id!=='label'"
              x="-8" :y="node.size.height+10" :width="node.size.width+16"
              height="25" rx="6" fill="#f6f9fb" stroke="#d1e1e8"/>
            <text v-if="!node.facility_id&&node.symbol_id!=='label'"
              :x="node.size.width/2" :y="node.size.height+27"
              text-anchor="middle" font-size="13" fill="#778f9e">
              {{node.label.slice(0,14)}}
            </text>
            <g v-if="node.facility_id&&reviewedFacilityIds.has(node.facility_id)&&simRunning">
              <rect x="-7" y="-18" width="100" height="22" rx="6"
                fill="#dff0f7" stroke="#a8d0e1"/>
              <text x="43" y="-3" font-size="11" fill="#4c88a6" text-anchor="middle">
                本轮SIM已核查
              </text>
            </g>
            <g v-if="node.facility_id&&displayMock(node.facility_id)&&showTelemetry"
              class="tg-diagram-telemetry" pointer-events="none"
              :transform="'translate('+telemetryPlacement(node).x+','+
                telemetryPlacement(node).y+')'">
              <rect x="0" y="0" :width="telemetryPlacement(node).width"
                :height="pointRowsHeight(node)"
                rx="8" fill="#fff" fill-opacity=".98" stroke="#bbd9e8"
                stroke-width="1.4"/>
              <rect x="0" y="0" :width="telemetryPlacement(node).width"
                height="24" rx="8" fill="#e9f4fa"/>
              <circle cx="14" cy="12" r="4.3"
                :fill="displayMock(node.facility_id)?.state==='fault'?'#c87362':
                  displayMock(node.facility_id)?.state==='attention'?'#d5a45a':'#5da896'"/>
              <text x="25" y="16" fill="#557b91" font-size="12" font-weight="650">
                {{displayMock(node.facility_id)?.stateLabel?.slice(0,8)}}
              </text>
              <text :x="telemetryPlacement(node).width-13" y="16"
                text-anchor="end" fill="#8da7b5" font-size="10">MOCK</text>
              <text v-for="(reading,i) in displayPointRows(node)" :key="reading.key"
                x="12" :y="42+i*18" fill="#376c88"
                font-size="13" font-weight="650">
                {{reading.key.slice(0,6)}}：{{reading.value.slice(0,14)}}
              </text>
              <text v-if="!displayPointRows(node).length"
                x="12" y="42" fill="#849aa7" font-size="12">
                暂无Mock测点
              </text>
            </g>
            <g v-if="editing&&selectedNodeId===node.id">
              <circle :cx="node.size.width" :cy="node.size.height"
                r="5" fill="#4e9dbb" stroke="#fff" stroke-width="2"/>
            </g>
          </g>
          <rect x="16" :y="stage.view_box.height-42"
            :width="stage.view_box.width-32" height="28"
            rx="7" fill="#f6fbfe" stroke="#d6e7ef"/>
          <circle cx="37" :cy="stage.view_box.height-28" r="4" fill="#74b3d8"/>
          <text x="49" :y="stage.view_box.height-23" font-size="12" fill="#6f8fa1">
            蓝色：水路设计关系
          </text>
          <path d="M 277,569 H 307" stroke="#98aebd" stroke-width="3"
            stroke-dasharray="5 5"/>
          <text x="319" :y="stage.view_box.height-23" font-size="12" fill="#6f8fa1">
            灰色：控制参考 · 棕色：污泥 · 黄色：加药
          </text>
          <text :x="stage.view_box.width-20" :y="stage.view_box.height-23"
            text-anchor="end" font-size="12" fill="#8b9eaa">
            虚线：设计关系；疏虚线：条件路径，均未经DWG端点核验
          </text>
        </svg>
        <div class="tg-diagram-foot">
          <span>设计设施：{{focusableNodes.length}} · 图元：{{stage.nodes.length}} · 示意连线：{{stage.connections.length}}</span>
          <span>点击绑定图元查看右侧设备资料 · 全部运行值为Mock</span>
        </div>
      </div>

      <aside v-if="editing" class="tg-diagram-properties">
        <strong>组态属性</strong>
        <template v-if="selectedNode">
          <label>图元名称
            <el-input size="small" :model-value="selectedNode.label" maxlength="80"
              @change="updateNodeLabel(String($event))"/>
          </label>
          <label>绑定CAD设计设施
            <el-select size="small" :model-value="selectedNode.facility_id||''"
              placeholder="未绑定 · 示意素材" clearable
              @change="setFacility(String($event||''))">
              <el-option label="不绑定（示意图元）" value=""/>
              <el-option v-for="facility in facilities" :key="facility.id"
                :label="facility.name+' · '+facility.id" :value="facility.id"
                :disabled="duplicateFacilities.has(facility.id)"/>
            </el-select>
          </label>
          <p class="tg-diagram-editor-note">图元绑定设计设施不等于新增正式设备台账</p>
          <div class="tg-diagram-dimensions">
            <label v-for="dimension in (['x','y','width','height'] as const)" :key="dimension">
              {{dimension.toUpperCase()}}
              <input type="number" step="1" :min="dimension==='x'||dimension==='y'?0:1"
                :value="dimension==='x'||dimension==='y'
                  ?selectedNode.position[dimension]:selectedNode.size[dimension]"
                @change="setNodeDimension(dimension,Number(($event.target as HTMLInputElement).value))"/>
            </label>
          </div>
          <div class="tg-diagram-flags">
            <el-checkbox :model-value="selectedNode.visible"
              @change="setNodeBool('visible',!!$event)">显示</el-checkbox>
            <el-checkbox :model-value="selectedNode.locked"
              @change="setNodeBool('locked',!!$event)">锁定位置</el-checkbox>
          </div>
          <strong>CAD建议测点标签</strong>
          <div v-if="availableFields.length" class="tg-diagram-field-list">
            <el-checkbox v-for="key in availableFields" :key="key"
              :model-value="selectedNode.point_keys.includes(key)"
              @change="togglePointKey(key,!!$event)">{{key}}</el-checkbox>
          </div>
          <p v-else class="tg-diagram-editor-note">先绑定CAD设计设施；此处是参考字段，不是已采集的真实点ID</p>
          <el-button size="small" plain type="danger" @click="removeNode">删除图元</el-button>
          <strong>工艺连接（人工示意）</strong>
          <el-select v-model="connectTarget" size="small" placeholder="选择目标图元" clearable>
            <el-option v-for="item in draft?.nodes.filter(x=>x.id!==selectedNodeId)"
              :key="item.id" :label="item.label" :value="item.id"/>
          </el-select>
          <div class="tg-diagram-line-fields">
            <el-select v-model="connectMedium" size="small"
              aria-label="新建连接介质">
              <el-option v-for="item in mediumChoices.filter(x=>
                systemId!=='fog'||['water','signal'].includes(x.value))"
                :key="item.value" :value="item.value" :label="item.label"/>
            </el-select>
            <el-select v-model="connectRelation" size="small"
              aria-label="新建连接依据">
              <el-option value="design" label="设计关系"/>
              <el-option value="conditional" label="条件/备选"/>
            </el-select>
          </div>
          <el-button size="small" plain :disabled="!connectTarget"
            @click="addConnection">添加示意连接</el-button>
          <div v-for="line in draft?.connections.filter(x=>
            x.source_node_id===selectedNodeId||x.target_node_id===selectedNodeId)"
            :key="line.id" class="tg-diagram-line-item">
            <span>{{mediumTitle(line.medium)}} · {{line.relation==='conditional'?'条件路径':'设计关系'}} · 未核实</span>
            <div class="tg-diagram-line-fields">
              <el-select size="small" :model-value="line.medium"
                @change="changeConnectionMedium(line.id,$event)">
                <el-option v-for="item in mediumChoices.filter(x=>
                  systemId!=='fog'||['water','signal'].includes(x.value))"
                  :key="item.value" :value="item.value" :label="item.label"/>
              </el-select>
              <el-select size="small" :model-value="line.relation||'design'"
                @change="changeConnectionRelation(line.id,$event)">
                <el-option value="design" label="设计关系"/>
                <el-option value="conditional" label="条件/备选"/>
              </el-select>
            </div>
            <el-input size="small" :model-value="line.label||''"
              maxlength="50" placeholder="连接说明（可选）"
              @change="changeConnectionLabel(line.id,String($event))"/>
            <el-button link size="small" type="danger"
              @click="removeConnection(line.id)">移除连接</el-button>
          </div>
        </template>
        <p v-else class="tg-diagram-editor-note">在画布上选择图元，可编辑属性、位置与连接</p>
        <div v-if="canPublish" class="tg-diagram-versions">
          <strong>历史已发布版本</strong>
          <el-select v-model="historyVersion" size="small" clearable placeholder="选择历史版本">
            <el-option v-for="item in history" :key="item.version"
              :label="'v'+item.version" :value="item.version"/>
          </el-select>
          <el-button size="small" plain :disabled="historyVersion===null||busy"
            @click="restoreHistory">恢复为草稿</el-button>
        </div>
      </aside>
    </div>
    <div v-if="editing" class="tg-diagram-publish-footer" data-testid="diagram-publish-footer">
      <span>{{dirty?'尚未保存的修改':'可保存或发布当前草稿'}}</span>
      <span v-if="!canPublish" class="tg-diagram-permission">当前账号可编辑，但无发布权限，请联系管理员授权</span>
      <el-button size="small" :disabled="busy" @click="saveDraft">保存草稿</el-button>
      <el-button type="primary" size="small" :disabled="busy||!canPublish"
        data-testid="diagram-publish-footer-button" @click="publish">保存并发布</el-button>
    </div>
    <p class="tg-diagram-disclaimer">
      {{disabledNote}}。发布只更新本系统运行组态外观及CAD设施绑定，
      不会修改真实设备、测点、告警、工单或PLC控制数据。
    </p>
  </section>
</template>

<style scoped>
.tg-diagram-section{padding:16px 17px;min-width:0}
.tg-diagram-top{align-items:center;flex-wrap:wrap;gap:10px}
.tg-diagram-top h2{font-size:15px;font-weight:650;margin:0;color:#355d73}
.tg-diagram-top small{font-size:11px;color:#8ca3b0}
.tg-diagram-toolbar{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.tg-diagram-toolbar :deep(.el-button){margin:0}
.tg-diagram-version{font-size:11px;color:#648da2;background:#edf5f9;
  padding:4px 9px;border-radius:5px;white-space:nowrap}
.tg-diagram-error{padding:10px 12px;border:1px solid #f0d5c4;color:#aa754f;
  border-radius:6px;font-size:12px;background:#fff9f5}
.tg-diagram-helper{font-size:12px;color:#8a9ea9}
.tg-diagram-quickbar{display:flex;align-items:center;justify-content:flex-end;
  gap:6px 14px;flex-wrap:wrap;border-bottom:1px solid #e5edf2;
  padding-bottom:9px;font-size:11px;color:#829aa9}
.tg-diagram-quickbar>span{margin-right:auto}
.tg-diagram-workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.tg-diagram-workspace.is-editing{grid-template-columns:145px minmax(0,1fr) 225px}
.tg-diagram-viewport{min-width:0;border:1px solid #d9e8ee;border-radius:8px;
  overflow:auto;background:#f4fafc}
.tg-diagram-mobile-hint{display:none;font-size:11px;color:#7191a5;
  padding:9px 11px 0;margin:0}
.tg-diagram-svg{display:block;width:100%;height:auto}
.is-process-flow .tg-diagram-svg{min-width:1150px}
.tg-flow-stages-nav{display:flex;align-items:center;gap:7px;flex-wrap:wrap;
  padding:8px 0 11px;margin-top:0}
.tg-flow-stages-nav strong{font-size:11px;color:#577b92;margin-right:6px}
.tg-flow-stages-nav button{display:flex;align-items:center;gap:5px;
  border:1px solid #d2e2eb;background:#f4fafc;cursor:pointer;
  padding:6px 10px;border-radius:6px;font:inherit;font-size:11px;color:#50778a}
.tg-flow-stages-nav button:hover,.tg-flow-stages-nav button:focus-visible{
  background:#e2f3fa;border-color:#83b8d0}
.tg-flow-stages-nav button span{color:#458cb0;font-size:10px;font-weight:700}
.tg-flow-stages-nav small{margin-left:auto;color:#8ca6b4;font-size:10px}
.tg-diagram-preview-note{font-size:11px;color:#637f90;background:#eff7fb;
  border:1px solid #cfe4ed;border-radius:6px;padding:8px 11px;line-height:1.6;
  margin:9px 0}
.tg-diagram-node{cursor:pointer;outline:none}
.tg-diagram-node:focus-visible .tg-diagram-node-frame,
.tg-diagram-node.is-selected .tg-diagram-node-frame{
  stroke:#3d93b7;stroke-width:3.5;stroke-opacity:1;fill:#d9eff8;fill-opacity:.42}
.tg-diagram-node.is-attention .tg-diagram-node-frame{
  stroke:#d5a45a;stroke-width:3;stroke-opacity:.88}
.tg-diagram-node.is-fault .tg-diagram-node-frame{
  stroke:#c87362;stroke-width:3;stroke-opacity:.88}
.tg-diagram-node.is-unbound{opacity:.86}
.tg-diagram-node.is-dragging{cursor:grabbing}
.tg-diagram-node-hit{cursor:inherit}
.is-editing .tg-diagram-node{cursor:grab;touch-action:none}
.tg-diagram-node.is-locked{cursor:default}
.tg-diagram-layers{display:flex;align-items:center;gap:5px 16px;flex-wrap:wrap;
  padding:9px 1px 12px;color:#758c9c}
.tg-diagram-layers>span:first-child{font-size:11px;font-weight:650;color:#608399}
.tg-diagram-layers :deep(.el-checkbox){margin-right:0;height:24px}
.tg-diagram-layers :deep(.el-checkbox__label){font-size:11px;color:#6e899b}
.tg-diagram-layers-hint{margin-left:auto;font-size:10px;color:#91a5b0}
.tg-diagram-pipe{vector-effect:non-scaling-stroke}
.tg-diagram-telemetry{pointer-events:none}
.tg-diagram-foot{display:flex;flex-wrap:wrap;justify-content:space-between;
  gap:6px 16px;border-top:1px solid #e0edf3;padding:9px 12px;
  color:#819bab;font-size:10px}
.tg-diagram-disclaimer{margin:10px 0 0;font-size:11px;line-height:1.6;color:#879fab}
.tg-diagram-symbols,.tg-diagram-properties{min-width:0;background:rgba(244,249,252,.65);
  border:1px solid #e0ebf1;border-radius:7px;padding:10px;display:flex;
  flex-direction:column;align-items:stretch;gap:10px}
.tg-diagram-symbols strong,.tg-diagram-properties>strong,
.tg-diagram-versions strong{font-weight:650;font-size:12px;color:#466b7f}
.tg-diagram-symbol-list{display:flex;flex-direction:column;gap:5px;max-height:430px;overflow:auto}
.tg-diagram-symbol-button{display:flex;align-items:center;gap:6px;min-width:0;
  font-size:11px;color:#567c90;padding:6px;border:1px solid #dbe8ef;
  border-radius:6px;background:#fff;text-align:left;cursor:pointer}
.tg-diagram-symbol-button:hover{border-color:#7eb3ca}
.tg-diagram-symbol-button img{height:29px;width:31px;object-fit:contain;flex:none}
.tg-diagram-symbol-button span{overflow-wrap:anywhere}
.tg-diagram-properties label{display:flex;flex-direction:column;gap:6px;
  font-size:11px;color:#718c9b}
.tg-diagram-dimensions{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.tg-diagram-dimensions input{width:100%;min-width:0;padding:5px 4px;
  border-radius:5px;border:1px solid #d4e4ee;color:#496e81;background:#fff}
.tg-diagram-flags{display:flex;flex-wrap:wrap;gap:6px}
.tg-diagram-flags :deep(.el-checkbox){margin-right:4px}
.tg-diagram-field-list{display:flex;flex-direction:column;max-height:170px;overflow:auto}
.tg-diagram-field-list :deep(.el-checkbox){margin-right:0}
.tg-diagram-line-item{display:flex;align-items:stretch;flex-direction:column;
  flex-wrap:wrap;gap:6px;padding:8px 0;border-bottom:1px solid #e3edf2;
  font-size:11px;color:#8b9ba8}
.tg-diagram-line-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px;
  min-width:0;width:100%}
.tg-diagram-line-fields :deep(.el-select){min-width:0;width:100%}
.tg-diagram-editor-note{color:#889eac;font-size:10px;margin:0;line-height:1.5}
.tg-diagram-versions{display:flex;flex-direction:column;gap:9px;
  padding-top:10px;border-top:1px solid #dfe9f0}
@media(max-width:1400px){.tg-diagram-workspace.is-editing{grid-template-columns:120px minmax(0,1fr)}
  .tg-diagram-properties{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:900px){.tg-diagram-workspace.is-editing{grid-template-columns:1fr}
  .tg-diagram-symbol-list{flex-direction:row;overflow-x:auto}
  .tg-diagram-symbol-button{flex:0 0 118px}
  .tg-diagram-properties{grid-column:auto}
}
@media(max-width:700px){
  .tg-diagram-viewport{overflow-x:auto}
  .tg-diagram-mobile-hint{display:block}
  .tg-diagram-svg{min-width:690px;min-height:0}
  .tg-diagram-properties{display:flex}
  .tg-diagram-layers-hint{width:100%;margin-left:0}
}
.tg-diagram-publish-footer{display:flex;align-items:center;justify-content:flex-end;
  gap:8px;flex-wrap:wrap;border-top:1px solid #dceaf1;margin-top:10px;padding:12px 4px;
  font-size:11px;color:#7b93a2}
.tg-diagram-publish-footer>span:first-child{margin-right:auto}
.tg-diagram-permission{color:#ad7546}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>

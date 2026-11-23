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
  fetchFogProcessDiagram,saveFogDiagramDraft,publishFogDiagram,
  fetchFogDiagramHistory,restoreFogDiagram,
  type FogSymbolId,type ProcessDiagramDocument,type ProcessDiagramNode,
  type ProcessDiagramRecord,type ProcessDiagramRevision,type ProcessDiagramConnection,
} from '@/api/tanggangProcessDiagrams'
import {
  FOG_SYMBOLS,FOG_FACILITIES,sourceImage,copyFogDiagram,
  defaultFogDiagram,validateFogDiagram,schematicRoute,
} from './fogDiagram'
import type {ProcessMockDevice} from './processMock'
import type {TanggangDevice} from '../mapping/tanggangCatalog'
import {usePermissions} from '@/utils/permissions'

const props=defineProps<{
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
const connectTarget=ref('')
const history=ref<ProcessDiagramRevision[]>([])
const historyVersion=ref<number|null>(null)
const canvas=ref<SVGSVGElement|null>(null)
const drag=ref<{id:string;dx:number;dy:number;pointerId:number}|null>(null)
const root=ref<HTMLElement|null>(null)
const symbols=computed(()=>Object.entries(FOG_SYMBOLS).filter(([,v])=>
  v.name.includes(symbolQuery.value.trim()),
) as Array<[FogSymbolId,(typeof FOG_SYMBOLS)[FogSymbolId]]>)
const stage=computed(()=>editing.value&&draft.value?draft.value:
  remote.value?.published||defaultFogDiagram())
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
  return 22+Math.max(displayPointRows(node).length,1)*16
}

async function reload(){
  try{
    loadError.value=''
    const response=await fetchFogProcessDiagram()
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
  draft.value=copyFogDiagram(remote.value.draft||
    remote.value.published||defaultFogDiagram())
  selectedNodeId.value=''
  undoStack.value=[]
  redoStack.value=[]
  historyVersion.value=null
  dirty.value=false
  editing.value=true
  try{
    history.value=(await fetchFogDiagramHistory()).data.data
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
    medium:'water',verification:'illustrative',
  }
  draft.value.connections.push(c);connectTarget.value=''
}
function removeConnection(id:string){
  if(!draft.value)return
  snapshot()
  draft.value.connections=draft.value.connections.filter(x=>x.id!==id)
}
function changeConnectionMedium(id:string,medium:'water'|'signal'){
  const line=draft.value?.connections.find(x=>x.id===id)
  if(!line)return
  snapshot();line.medium=medium
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
  if(!editing.value||!draft.value||node.locked||!canChange.value)return
  const point=coords(event)
  if(!point)return
  selectedNodeId.value=node.id
  snapshot()
  drag.value={
    id:node.id,dx:point.x-node.position.x,dy:point.y-node.position.y,
    pointerId:event.pointerId,
  }
  canvas.value?.setPointerCapture(event.pointerId)
}
function pointerMove(event:PointerEvent){
  if(!drag.value||!draft.value||!canChange.value)return
  const point=coords(event)
  if(!point)return
  const node=draft.value.nodes.find(x=>x.id===drag.value?.id)
  if(!node)return
  node.position.x=Math.max(0,Math.min(draft.value.view_box.width-node.size.width,
    Math.round(point.x-drag.value.dx)))
  node.position.y=Math.max(0,Math.min(draft.value.view_box.height-node.size.height,
    Math.round(point.y-drag.value.dy)))
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
  const errors=validateFogDiagram(draft.value)
  if(errors.length){ElMessage.error(errors.join('；'));return}
  busy.value=true
  try{
    remote.value=(await saveFogDiagramDraft(draft.value,remote.value.revision)).data.data
    dirty.value=false
    ElMessage.success('组态草稿已保存到服务器，运行图尚未改变')
  }catch(e){
    ElMessage.error('草稿保存失败；可能发生版本冲突，请刷新组态后重试')
  }finally{busy.value=false}
}
async function publish(){
  if(!canPublish.value||!remote.value||busy.value)return
  if(dirty.value){ElMessage.warning('请先保存当前草稿，再发布');return}
  if(!remote.value.draft){ElMessage.warning('请先保存组态草稿');return}
  try{
    await ElMessageBox.confirm(
      '发布后运行页面将使用这份组态，所有管线仍属于未经现场校核的设计示意。确定发布吗？',
      '发布组态', {type:'warning',confirmButtonText:'确认发布',cancelButtonText:'取消'},
    )
  }catch{return}
  busy.value=true
  try{
    remote.value=(await publishFogDiagram(remote.value.revision)).data.data
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
    remote.value=(await restoreFogDiagram(historyVersion.value,remote.value.revision)).data.data
    draft.value=copyFogDiagram(remote.value.draft!)
    undoStack.value=[];redoStack.value=[];dirty.value=false
    ElMessage.success('历史版本已恢复为草稿；仍需人工发布')
  }catch{ElMessage.error('恢复失败：历史版本不可用或已发生编辑冲突')}
  finally{busy.value=false}
}
const iconLabel=(id:string|null)=>id?FOG_FACILITIES[id as keyof typeof FOG_FACILITIES]||id:'未绑定设计设施'
</script>

<template>
  <section ref="root" class="tg-biz-card tg-diagram-section"
    data-testid="fog-process-diagram">
    <div class="tg-biz-card-head tg-diagram-top">
      <div>
        <h2>射雾除尘工艺组态图</h2>
        <small>旧版组态图元与编辑能力 · 5190运行Mock</small>
      </div>
      <div class="tg-diagram-toolbar">
        <span class="tg-diagram-version">
          {{isTemplate?'示例模板·未发布':'已发布 v'+diagramVersion}}
        </span>
        <el-button v-if="!editing&&canEdit&&remote" size="small" plain
          data-testid="fog-begin-edit" @click="beginEdit">编辑组态</el-button>
        <template v-if="editing">
          <el-button size="small" :disabled="!undoStack.length||busy"
            @click="undo">撤销</el-button>
          <el-button size="small" :disabled="!redoStack.length||busy"
            @click="redo">重做</el-button>
          <el-button size="small" :disabled="busy||!dirty&&!!remote?.draft"
            data-testid="fog-save-draft" @click="saveDraft">保存草稿</el-button>
          <el-button v-if="canPublish" type="primary" plain size="small"
            :disabled="busy||dirty||!remote?.draft"
            data-testid="fog-publish" @click="publish">校验并发布</el-button>
          <el-button size="small" text @click="cancelEdit">退出编辑</el-button>
        </template>
      </div>
    </div>

    <div v-if="loadError" class="tg-diagram-error" role="status">{{loadError}}</div>
    <div v-else-if="!loaded" class="tg-diagram-helper">正在读取组态版本…</div>
    <div class="tg-diagram-quickbar">
      <span>{{editing?'编辑草稿 · 已发布版本不会同步变动':'图元可点击 · 右侧显示设备运行信息'}}</span>
      <template v-if="!editing">
        <el-button text size="small" :disabled="!activeCount" @click="focusNext('attention')">
          定位SIM关注/异常（{{activeCount}}）
        </el-button>
        <el-button text size="small" :disabled="!checkedCount" @click="focusNext('reviewed')">
          定位本轮已核查（{{checkedCount}}）
        </el-button>
      </template>
    </div>
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

      <div class="tg-diagram-viewport">
        <svg ref="canvas" class="tg-diagram-svg"
          :viewBox="'0 0 '+stage.view_box.width+' '+stage.view_box.height"
          role="img" aria-label="射雾除尘工艺组态图，点击图元查看设备，设计连接待现场核实"
          @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
          <defs>
            <pattern id="tg-fog-grid" width="27" height="27" patternUnits="userSpaceOnUse">
              <path d="M 27 0 L 0 0 0 27" fill="none" stroke="#b7d2e2"
                stroke-opacity=".26" stroke-width="1"/>
            </pattern>
            <linearGradient id="tg-fog-canvas-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#fbfdff"/>
              <stop offset="1" stop-color="#eef7fb"/>
            </linearGradient>
          </defs>
          <rect :width="stage.view_box.width" :height="stage.view_box.height"
            fill="url(#tg-fog-canvas-gradient)"/>
          <rect :width="stage.view_box.width" :height="stage.view_box.height"
            fill="url(#tg-fog-grid)"/>
          <g v-for="line in stage.connections" :key="line.id">
            <path :d="schematicRoute(line,stage)" fill="none"
              :stroke="line.medium==='signal'?'#94a7b8':'#7cb5d1'"
              :stroke-width="line.medium==='signal'?3:5" stroke-linecap="round"
              stroke-dasharray="12 9" opacity=".85"/>
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
            <rect class="tg-diagram-node-frame" x="-5" y="-4"
              :width="node.size.width+10" :height="node.size.height+10"
              rx="7" fill="#fff" fill-opacity=".06"
              stroke="#4e9cbf" stroke-opacity=".08" stroke-width="2"/>
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
                fill="#49758c">PLC</text>
            </g>
            <rect v-if="node.symbol_id==='label'"
              :width="node.size.width" :height="node.size.height" rx="6"
              fill="#e3f0f7" stroke="#90b8cd"/>
            <text v-if="node.symbol_id==='label'"
              :x="node.size.width/2" :y="node.size.height/2+4"
              text-anchor="middle" font-size="13" fill="#426a80">
              {{node.label.slice(0,14)}}
            </text>
            <rect v-if="node.facility_id"
              x="-6" :y="node.size.height+11"
              :width="node.size.width+12" height="20" rx="5" fill="#f0f8fc"
              stroke="#c5deeb" stroke-width="1"/>
            <text class="tg-diagram-node-label" :x="node.size.width/2"
              :y="node.size.height+25" text-anchor="middle" font-size="12"
              fill="#315c73" font-weight="600">{{node.label.slice(0,13)}}</text>
            <text v-if="!node.facility_id&&node.symbol_id!=='label'"
              :x="node.size.width/2" :y="node.size.height+24"
              text-anchor="middle" font-size="11" fill="#829cad">
              {{node.label.slice(0,15)}}
            </text>
            <g v-if="node.facility_id&&displayMock(node.facility_id)" class="tg-diagram-telemetry">
              <rect :x="node.size.width+5" y="3" width="142"
                :height="pointRowsHeight(node)"
                rx="6" fill="#fff" stroke="#c8e1ec"/>
              <circle :cx="node.size.width+18" cy="13" r="4"
                :fill="displayMock(node.facility_id)?.state==='fault'?'#c87362':
                  displayMock(node.facility_id)?.state==='attention'?'#d5a45a':'#5da896'"/>
              <text :x="node.size.width+27" y="16" fill="#627f91" font-size="10">
                {{displayMock(node.facility_id)?.stateLabel?.slice(0,8)}} · Mock
              </text>
              <text v-for="(reading,i) in displayPointRows(node)" :key="reading.key"
                :x="node.size.width+14" :y="33+i*16" fill="#3d718d"
                font-size="11" font-weight="600">
                {{reading.key.slice(0,5)}}：{{reading.value.slice(0,13)}}
              </text>
              <text v-if="!displayPointRows(node).length"
                :x="node.size.width+14" y="33" fill="#849aa7" font-size="10">
                暂无Mock测点
              </text>
            </g>
            <g v-if="editing&&selectedNodeId===node.id">
              <circle :cx="node.size.width" :cy="node.size.height"
                r="5" fill="#4e9dbb" stroke="#fff" stroke-width="2"/>
            </g>
          </g>
          <rect x="12" :y="stage.view_box.height-34" width="382" height="24"
            rx="5" fill="#f5f9fc" stroke="#d4e4ec"/>
          <text x="22" :y="stage.view_box.height-18" font-size="12"
            fill="#7793a5">工艺参考示意 · 所有连接线未经现场水力校核</text>
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
          <el-button size="small" plain :disabled="!connectTarget"
            @click="addConnection">添加示意连接</el-button>
          <div v-for="line in draft?.connections.filter(x=>
            x.source_node_id===selectedNodeId||x.target_node_id===selectedNodeId)"
            :key="line.id" class="tg-diagram-line-item">
            <span>{{line.medium==='water'?'设计水管':'示意信号'}} · 未核实</span>
            <el-button link size="small" type="danger"
              @click="removeConnection(line.id)">移除</el-button>
            <el-button link size="small" @click="changeConnectionMedium(line.id,
              line.medium==='water'?'signal':'water')">切换类型</el-button>
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
  overflow:hidden;background:#f4fafc}
.tg-diagram-svg{display:block;width:100%;height:auto;aspect-ratio:1200/530}
.tg-diagram-node{cursor:pointer;outline:none}
.tg-diagram-node:focus-visible .tg-diagram-node-frame,
.tg-diagram-node.is-selected .tg-diagram-node-frame{
  stroke:#3d93b7;stroke-width:3;stroke-opacity:1;fill:#d9eff8;fill-opacity:.45}
.tg-diagram-node.is-attention .tg-diagram-node-frame{
  stroke:#d5a45a;stroke-width:3;stroke-opacity:.88}
.tg-diagram-node.is-fault .tg-diagram-node-frame{
  stroke:#c87362;stroke-width:3;stroke-opacity:.88}
.tg-diagram-node.is-unbound{opacity:.86}
.tg-diagram-node.is-dragging{cursor:grabbing}
.tg-diagram-node-hit{cursor:inherit}
.is-editing .tg-diagram-node{cursor:grab;touch-action:none}
.tg-diagram-node.is-locked{cursor:default}
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
.tg-diagram-line-item{display:flex;align-items:center;flex-wrap:wrap;
  gap:3px;font-size:11px;color:#8b9ba8}
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
@media(max-width:700px){.tg-diagram-svg{min-height:250px}
  .tg-diagram-properties{display:flex}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>

<script setup lang="ts">
import { defineAsyncComponent, computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RegionEquipmentOverlay from './RegionEquipmentOverlay.vue'
import type { SiteRegion, RegionPayload } from './types/regions'
import * as THREE from 'three'
import { landmarks, landmarksSource } from './harborLandmarks'
import { buildHarborRelief } from './harborRelief'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * 与 5175 唐港首页集成用的受控接口：
 * - initialSystemId：顶部业务导航切换系统时下发给场景；
 * - showFilters：首页由外部导航控制六系统时隐藏场景内重复的系统筛选条；
 * - system-change / object-select：场景向业务层回传当前系统与选中对象。
 */

/** V2.1 preliminary L1 scene. All coordinates originate from V2 DWG, except
 * visual elevation/marker symbols. Source line intersection != hydraulic connection. */
const props = withDefaults(
  defineProps<{
    image: string
    showMarkers: boolean
    initialSystemId?: string
    showFilters?: boolean
  }>(),
  { initialSystemId: 'all', showFilters: true },
)

const emit = defineEmits<{
  (e: 'system-change', id: string, name: string): void
  (e: 'object-select', payload: { type: 'anchor' | 'pipe' | 'yardBand' | 'matchedContour'; id: string; name: string; handle?: string; layer?: string } | null): void
}>()
import type {
  BusinessSystem,
  CadAnchor,
  CadLine,
  CadScene,
  ChainBucketDataset,
  ContinuityAuditData,
  ContinuityIssue,
  ContinuityKind,
  Entry,
  FloatingMark,
  Label,
  MatchedContour,
  PipeAuditData,
  PipeBatch,
  Pt2,
  SpatialCandidateData,
  SystemManifest,
  YardBand,
} from './types/cad'
import { pipeLegend, systemColors } from './config/pipeLayers'
import { loadSceneDatasets } from './data/loadSceneDatasets'

const root = ref<HTMLDivElement | null>(null)
const busy = ref(true)
const failure = ref('')
const activeSystem = ref('全部')
const businessSystems = ref<BusinessSystem[]>([])
const systemModeId = ref('all')
const showFireOverlay = ref(true)
const sourceMode = computed(() => businessSystems.value.find(s=>s.id===systemModeId.value) || null)
const focusedPipeLayerSet = computed(() => new Set(sourceMode.value?.focusPipeLayers || []))
const referencePipeLayerSet = computed(() => new Set(sourceMode.value?.referencePipeLayers || []))
const firePipeLayers = ['$管综-室外消防','$管综-室内消防']
const availableRegions = computed<SiteRegion[]>(()=>{
  const mode=sourceMode.value
  if(!mode)return regions.value
  return mode.areaEquipment.map(m=>{
    const r=regions.value.find(v=>v.id===m.regionId)
    if(!r)return null
    return {...r,devices:r.devices.filter(d=>m.equipmentIds.includes(d.id))}
  }).filter((r):r is SiteRegion=>!!r)
})
const visiblePipeHandles = computed(()=>{
  if(!current)return 0
  const layers=sourceMode.value?.focusPipeLayers
  const sources=current.lines.filter(line=>line.role==='pipe' && (!layers||layers.includes(line.layer)))
  return new Set(sources.map(line=>line.handle)).size
})
const systemDescription = computed(()=>sourceMode.value?.intro || '港区设施总览 · 按系统选择管网与设备 · CAD源图元候选')
const detail = ref<Entry | null>(null)

// —— 与 5175 唐港首页的受控接口 ——
watch(
  () => props.initialSystemId,
  (id) => {
    if (id && id !== systemModeId.value) systemModeId.value = id
  },
)
watch(systemModeId, (id) => {
  const matched = businessSystems.value.find((s) => s.id === id)
  emit('system-change', id, matched?.name ?? '全部')
})
watch(detail, (entry) => {
  if (!entry) {
    emit('object-select', null)
    return
  }
  if (entry.type === 'anchor') {
    emit('object-select', {
      type: 'anchor',
      id: entry.data.id,
      name: entry.data.name,
      handle: entry.data.sourceHandle ?? undefined,
      layer: entry.data.sourceLayer,
    })
  } else if (entry.type === 'pipe') {
    emit('object-select', {
      type: 'pipe',
      id: entry.data.handle,
      name: entry.data.layer,
      handle: entry.data.handle,
      layer: entry.data.layer,
    })
  } else if (entry.type === 'yardBand') {
    emit('object-select', {
      type: 'yardBand',
      id: entry.data.id,
      name: entry.data.name,
      layer: entry.data.sourceLayer,
    })
  } else {
    emit('object-select', {
      type: 'matchedContour',
      id: entry.data.id,
      name: entry.data.labels.join(' / ') || entry.data.id,
      layer: entry.data.sourceLayer,
    })
  }
})
const markersVisible = ref(true)
const labelItems = ref<Label[]>([])
const sourceStats = ref({ sources: 0, pipePieces: 0, pipeHandles: 0, anchors: 0, yards: 0 })
const help = ref(false)
const reliefEnabled = ref(true)
const GalleryStudy=defineAsyncComponent(()=>import('./GalleryStudy.vue'))
const stageParam=new URLSearchParams(location.search).get('stage')
const grayMode=ref(stageParam==='gray')
const sampleMode=ref(stageParam==='sample'||stageParam==='gallery')
const studyOpen=ref(stageParam==='gallery')
const galleryReady=ref(false)
const allLabels = ref(false)
// Default view keeps the scene clear; audit and system tools stay behind one entry.
const toolsOpen = ref(false)
const solidMode = computed(()=>reliefEnabled.value && !continuityOpen.value && !auditOpen.value)
let relief: ReturnType<typeof buildHarborRelief> | null = null
let groundGrid: THREE.GridHelper | null = null
let groundPlane: THREE.Mesh | null = null
let shadowSun: THREE.DirectionalLight | null = null
function changeView(){
  closeContinuity()
  auditOpen.value=false
  reliefEnabled.value=!reliefEnabled.value
  refresh()
}
function toggleAudit(){
  closeContinuity()
  auditOpen.value=!auditOpen.value
  pointIndexOpen.value=false
  refresh()
}
const visibleBands = ref<YardBand[]>([])
const visibleContours = ref<MatchedContour[]>([])
const areasVisible = ref(true)
const regions = ref<SiteRegion[]>([])
const selectedRegionId = ref('REG-YARD')
const regionNavOpen = ref(false)
const showRegionPanel = ref(false)
const floatingDetail = ref<FloatingMark | null>(null)
// 浮动标签/点位索引选中的对象同样回传给唐港首页，用于展示 CAD → 设施追溯链
watch(floatingDetail, (mark) => {
  if (!mark) return
  emit('object-select', {
    type: 'anchor',
    id: mark.id,
    name: mark.name,
    handle: mark.sourceHandle || undefined,
    layer: mark.kind,
  })
})
const pointIndexOpen = ref(false)
const auditOpen = ref(false)
const pipeAudit = ref<PipeAuditData |null>(null)
const continuityOpen = ref(false)
const continuityData = ref<ContinuityAuditData|null>(null)
const continuityFilter = ref('visible_gap_candidate')
const continuityPage = ref(0)
const selectedContinuity = ref<ContinuityIssue|null>(null)
const filteredContinuity = computed(()=>continuityData.value?.issues.filter(i=>
 continuityFilter.value==='all'||i.kind===continuityFilter.value)||[])
const continuityPageCount = computed(()=>Math.max(1,Math.ceil(filteredContinuity.value.length/24)))
const pageContinuity = computed(()=>filteredContinuity.value.slice(continuityPage.value*24,(continuityPage.value+1)*24))
const continuityLabels:Record<ContinuityKind,string> = {
 visible_gap_candidate:'可见断口',filtered_continuation_candidate:'待核漏显线',short_orphan_candidate:'孤立短段'
}
const continuityColors:Record<ContinuityKind,string> = {
 visible_gap_candidate:'#df5b59',
 filtered_continuation_candidate:'#e4a046',
 short_orphan_candidate:'#9561cd'
}
const chainMarkerData = ref<ChainBucketDataset|null>(null)
const pointIndexCount = computed(()=>({
  yards:floatingMarks.value.filter(x=>x.kind==='yardCandidate').length,
  pools:floatingMarks.value.filter(x=>x.kind==='poolContour').length
}))
const floatingPopupPosition = computed(()=>({
  x:floatingPopupLabel.value?.x ?? Math.max(150,Math.min(root.value?.clientWidth||500,480)/2),
  y:floatingPopupLabel.value?.y ?? Math.min(310,(root.value?.clientHeight||550)-100)
}))
const floatingMarks = ref<FloatingMark[]>([])
const compassDegrees = ref(0)
const floatingPopupLabel = computed(()=>labelItems.value.find(l=>l.id===floatingDetail.value?.id)||null)
const compassTitle = '图纸北向参考：根据CAD显示坐标变换计算；工程坐标系与实地真北尚待核对'
const regionLoadError = ref('')
const linkedRegions = computed(() => {
  const q=detail.value
  if(!q)return [] as SiteRegion[]
  return availableRegions.value.filter(r =>
    q.type==='anchor'?r.anchorIds.includes(q.data.id):
    q.type==='yardBand'?r.bandIds.includes(q.data.id):
    q.type==='matchedContour'?r.contourHandles.includes(q.data.handle):
    // candidate CAD layer is not proof of physical equipment connectivity
    sourceMode.value ? focusedPipeLayerSet.value.has(q.data.layer) : r.pipeSystems.includes(q.data.system))
})

let current: CadScene | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let orbit: OrbitControls | null = null
let observer: ResizeObserver | null = null
let windowResizeHandler: (()=>void) | null = null
let canvas: HTMLCanvasElement | null = null
let frameId = 0
let active = true
let lastPointer: [number,number] | null = null
const ray = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const tmp = new THREE.Object3D()
const up = new THREE.Vector3(0,1,0)
const pipeGeometry = new THREE.CylinderGeometry(1,1,1,9,1)
const environmentTextures: THREE.Texture[] = []
type FlowDot = { a: THREE.Vector3; b: THREE.Vector3; phase: number; speed: number; y: number }
let flowPoints: THREE.Points | null = null
let flowPositions: Float32Array | null = null
let flowDots: FlowDot[] = []
function updateFlow(time: number) {
  if (!flowPoints || !flowPositions) return
  for (let i = 0; i < flowDots.length; i++) {
    const d = flowDots[i], f = (d.phase + time * d.speed) % 1, o = i * 3
    flowPositions[o] = d.a.x + (d.b.x - d.a.x) * f
    flowPositions[o + 1] = d.y
    flowPositions[o + 2] = d.a.z + (d.b.z - d.a.z) * f
  }
  (flowPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
}
const batches: PipeBatch[] = []
const pickObjects: THREE.Object3D[] = []
const outlineMeshes: THREE.Object3D[] = []
let markerMesh: THREE.InstancedMesh | null = null
const contourModels: THREE.Mesh[] = []
const yardBandModels: { mesh: THREE.Mesh; band: YardBand; mat: THREE.MeshStandardMaterial }[] = []
const contourPickModels: { mesh: THREE.Mesh; handle: string }[] = []
const areaLines: THREE.Object3D[] = []
const poolSurfaceModels: THREE.Object3D[] = []
let spatialData: SpatialCandidateData | null = null
const northUnitVector=new THREE.Vector3(Math.sin(35.000106*Math.PI/180),0,-Math.cos(35.000106*Math.PI/180))
const bright = new THREE.Group()
const continuityDebugGroup=new THREE.Group()
const continuitySelectionGroup=new THREE.Group()
const geometriesToDispose: THREE.BufferGeometry[] = []
const materialsToDispose: THREE.Material[] = []

function at(x: number,z: number,y=0) { return new THREE.Vector3(x,y,-z) }
function closeContinuity(){
  continuityOpen.value=false
  continuityDebugGroup.visible=false
  continuitySelectionGroup.visible=false
  refresh()
}
function toggleContinuity() {
  if(continuityOpen.value){closeContinuity();return}
  continuityOpen.value=true
  auditOpen.value=false
  pointIndexOpen.value=false
  showRegionPanel.value=false
  floatingDetail.value=null
  continuityDebugGroup.visible=true
  continuitySelectionGroup.visible=true
  const selected=selectedContinuity.value||continuityData.value?.issues.find(x=>x.kind==='visible_gap_candidate')
  if(selected)selectContinuityIssue(selected)
  refresh()
}
function changeContinuityFilter(next:string){
  continuityFilter.value=next
  continuityPage.value=0
}
function disposeContinuitySelection(){
  for(const obj of [...continuitySelectionGroup.children]){
    continuitySelectionGroup.remove(obj)
    if(obj instanceof THREE.Line||obj instanceof THREE.Mesh){
      obj.geometry.dispose()
      const materials=Array.isArray(obj.material)?obj.material:[obj.material]
      materials.forEach(material=>material.dispose())
    }
  }
}
function selectContinuityIssue(item:ContinuityIssue){
  selectedContinuity.value=item
  detail.value=null
  floatingDetail.value=null
  disposeContinuitySelection()
  const [x,z]=item.pointXZ
  const rMat=new THREE.MeshBasicMaterial({color:continuityColors[item.kind],
    depthTest:false,transparent:true,opacity:.95})
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.73,.08,8,32),rMat)
  ring.rotation.x=-Math.PI/2
  ring.position.copy(at(x,z,displayLevel(item.layer)+.26))
  ring.renderOrder=40
  continuitySelectionGroup.add(ring)
  const reference=item.reviewOnlyGeometry
  if(reference && reference.displayPoints.length>=2){
    const points=reference.displayPoints.map(p=>at(p[0],p[1],displayLevel(item.layer)+.28))
    const geo=new THREE.BufferGeometry().setFromPoints(points)
    const color=reference.isApprovedPipeline?'#ff6161':'#ffbd68'
    const material=reference.isApprovedPipeline
      ?new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.98})
      :new THREE.LineDashedMaterial({color,depthTest:false,transparent:true,opacity:.98,
        dashSize:.4,gapSize:.25})
    const line=new THREE.Line(geo,material)
    if(!reference.isApprovedPipeline)line.computeLineDistances()
    line.renderOrder=41
    continuitySelectionGroup.add(line)
  }
  if(camera&&orbit){
    const target=at(x,z,0)
    const dir=camera.position.clone().sub(orbit.target).normalize()
    orbit.target.copy(target)
    setFieldOfView(34)
  camera.position.copy(target).add(dir.multiplyScalar(24))
    orbit.update()
  }
  refresh()
}
function buildContinuityDebug(data:ContinuityAuditData){
  if(!scene)return
  for(const kind of ['visible_gap_candidate','filtered_continuation_candidate','short_orphan_candidate'] as ContinuityKind[]){
    const points=data.issues.filter(i=>i.kind===kind)
    if(!points.length)continue
    const geo=new THREE.SphereGeometry(.28,10,8)
    const mat=new THREE.MeshBasicMaterial({color:continuityColors[kind],transparent:true,
      opacity:.87,depthTest:false})
    const cloud=new THREE.InstancedMesh(geo,mat,points.length)
    cloud.name='CAD待核断点 '+continuityLabels[kind]
    const obj=new THREE.Object3D()
    points.forEach((q,idx)=>{
      obj.position.copy(at(q.pointXZ[0],q.pointXZ[1],displayLevel(q.layer)+.22))
      obj.updateMatrix()
      cloud.setMatrixAt(idx,obj.matrix)
    })
    cloud.instanceMatrix.needsUpdate=true
    cloud.computeBoundingSphere()
    cloud.renderOrder=38
    continuityDebugGroup.add(cloud)
    geometriesToDispose.push(geo)
    materialsToDispose.push(mat)
  }
  scene.add(continuityDebugGroup)
  scene.add(continuitySelectionGroup)
  continuityDebugGroup.visible=false
  continuitySelectionGroup.visible=false
}
function markerColor(a: CadAnchor) {
  if (a.type==='堆场') return '#cf9e4d'
  if (a.type==='泊位') return '#6988a7'
  if (a.name.includes('污水')) return '#9a81b0'
  if (a.name.includes('集水')||a.name.includes('生态')) return '#319f9f'
  return '#357fa8'
}
function disposeHighlights() {
  for(const obj of [...bright.children]) {
    bright.remove(obj)
    if (obj instanceof THREE.Mesh) {
      if(obj.geometry !== pipeGeometry) obj.geometry.dispose()
      const mats=Array.isArray(obj.material)?obj.material:[obj.material]
      mats.forEach(m=>m.dispose())
    }
  }
}
function refresh() {
  const model=!!relief && solidMode.value && areasVisible.value
  if(relief){relief.group.visible=model;relief.setGray(grayMode.value)}
  if(groundGrid)groundGrid.visible=!model
  if(groundPlane)groundPlane.position.y=model?-1.98:-.08
  if(shadowSun?.shadow)shadowSun.shadow.needsUpdate=true
  for(const line of outlineMeshes){
    const mat=(line as THREE.LineSegments).material as THREE.LineBasicMaterial
    mat.opacity=model?.11:Number(line.userData.opacity)
  }
  for(const edge of areaLines)edge.visible=areasVisible.value && !model

  for(const b of yardBandModels){
    b.mesh.visible=areasVisible.value
    const picked=(detail.value?.type==='yardBand' && detail.value.data.id===b.band.id) ||
      (!detail.value && (selectedRegionId.value==='REG-YARD'||sourceMode.value?.areaEquipment.some(g=>g.regionId==='REG-YARD')))
    b.mat.opacity=model?0:(picked?.53:.21)
    b.mat.color.set(picked?'#70d3e5':'#e7bd68')
  }
  for(const item of contourModels)item.visible=areasVisible.value && !model
  for(const object of poolSurfaceModels)object.visible=areasVisible.value && !model
  for (const batch of batches) {
    const mode=sourceMode.value
    const focus=!!mode && focusedPipeLayerSet.value.has(batch.layer)
    const reference=!!mode && referencePipeLayerSet.value.has(batch.layer)
    const fire=showFireOverlay.value && firePipeLayers.includes(batch.layer)
    // Review mode reveals the target pipe layer and dims others for context,
    // avoiding artificial 'vanishing' from business-layer opacity filters.
    const opacity=continuityOpen.value
      ?(selectedContinuity.value?(selectedContinuity.value.layer===batch.layer?1:0.26):0.85)
      :mode?((focus||fire)?1:(reference?0.28:0.09))
       :1
    batch.mesh.visible=!firePipeLayers.includes(batch.layer)||fire||continuityOpen.value||auditOpen.value||reference||focus
    batch.mesh.userData.selectable=(!mode&&batch.mesh.visible)||focus||fire
    const material=batch.mesh.material as THREE.MeshStandardMaterial
    material.transparent=opacity<1
    material.opacity=opacity
    material.depthWrite=opacity>.5
    material.emissiveIntensity=(focus||fire)?0.42:0.06
    material.needsUpdate=true
    // Instance selection selects one original CAD handle. Never joins geometry into a verified hydraulic route.
    for(let i=0;i<batch.edges.length;i++) {
      const isSelected=detail.value?.type==='pipe' && detail.value.data.handle===batch.edges[i].handle
      batch.mesh.setColorAt(i,new THREE.Color(isSelected?'#00ecf5':systemColors[batch.layer]||'#3e99b9'))
    }
    if(batch.mesh.instanceColor)batch.mesh.instanceColor.needsUpdate=true
  }
  disposeHighlights()
  if(detail.value?.type==='pipe') {
    const selected=detail.value.data
    const points=selected.displayPoints
    const mat=new THREE.MeshStandardMaterial({color:'#b4ffff',emissive:'#05d9f5',
      emissiveIntensity:1.6,roughness:.21,metalness:.33})
    const y=displayLevel(selected.layer)+.08
    for(let i=1;i<points.length;i++) {
      const a=at(...points[i-1],y),b=at(...points[i],y),vec=b.clone().sub(a)
      const length=vec.length()
      if(length<.008)continue
      const mesh=new THREE.Mesh(pipeGeometry,mat)
      mesh.position.copy(a).add(b).multiplyScalar(.5)
      mesh.quaternion.setFromUnitVectors(up,vec.normalize())
      mesh.scale.set(.34,length,.34)
      bright.add(mesh)
    }
  } else if(detail.value?.type==='anchor') {
    const a=detail.value.data
    const color=new THREE.MeshBasicMaterial({color:'#33cfe2',transparent:true,opacity:.8,depthTest:false})
    const geo=new THREE.TorusGeometry(.77,.055,8,38)
    const ring=new THREE.Mesh(geo,color);ring.rotation.x=-Math.PI/2
    ring.position.copy(at(a.x,a.z,.16))
    bright.add(ring)
  }
  // Ring selection marks source CAD TEXT anchors, not unverified equipment positions.
  if(!detail.value && current && (!model||sourceMode.value)){
    const area=availableRegions.value.find(a=>a.id===selectedRegionId.value)
    for(const id of area?.anchorIds || []){
      const anchor=current.anchors.find(a=>a.id===id)
      if(!anchor)continue
      const geo=new THREE.TorusGeometry(anchor.type==='堆场'?.68:1.0,.06,7,30)
      const mat=new THREE.MeshBasicMaterial({color:anchor.type==='堆场'?'#efb85b':'#19c6dd',
        transparent:true,opacity:.85,depthTest:false,side:THREE.DoubleSide})
      const mesh=new THREE.Mesh(geo,mat)
      mesh.rotation.x=-Math.PI/2
      mesh.position.copy(at(anchor.x,anchor.z,.25))
      bright.add(mesh)
    }
  }
}
const waterLayers = Object.keys(systemColors)
function displayLevel(layer: string) {
  const i=waterLayers.indexOf(layer)
  // Low pipe-rack elevation: the approved CAD traces read as physical pipes above the
  // yard pad instead of floating linework. Elevation is a presentation parameter.
  return .14 + (i<0?0:i)*.028
}
function toggleAreas() {
  areasVisible.value=!areasVisible.value
  refresh()
}
function chooseSystem(next: string) {
  if(next!=='all' && !businessSystems.value.some(s=>s.id===next))return
  sampleMode.value=false
  systemModeId.value=next
  const mode=businessSystems.value.find(s=>s.id===next)
  activeSystem.value='全部'
  selectedRegionId.value=mode?.primaryRegionId||'REG-YARD'
  showRegionPanel.value=false
  floatingDetail.value=null
  detail.value=null
  showFireOverlay.value=next==='all'
  refresh()
  if(mode)focusByAnchorIds(mode.focusAnchorIds, next==='middle'||next==='rain'?80:63)
  else resetCameraPosition()
}
function toggleFireLayer(){
  showFireOverlay.value=!showFireOverlay.value
  refresh()
}
function focusByAnchorIds(ids:string[],distance=62){
  if(!camera||!orbit||!current)return
  const anchors=ids.map(id=>current!.anchors.find(a=>a.id===id)).filter((a):a is CadAnchor=>!!a)
  if(!anchors.length)return
  const x=anchors.reduce((v,a)=>v+a.x,0)/anchors.length
  const z=anchors.reduce((v,a)=>v+a.z,0)/anchors.length
  const target=at(x,z,0)
  const dir=camera.position.clone().sub(orbit.target).normalize()
  orbit.target.copy(target)
  setFieldOfView(34)
  camera.position.copy(target).add(dir.multiplyScalar(distance))
  orbit.update()
}
function setFieldOfView(value:number){
  if(!camera)return
  camera.fov=value
  camera.updateProjectionMatrix()
}
function resetCameraPosition(){
  if(!camera||!orbit)return
  const aspect=camera.aspect
  // Optional plan view for CAD acceptance screenshots only (?view=top); never the default.
  if(new URLSearchParams(location.search).get('view')==='top'&&!sampleMode.value){
    setFieldOfView(13)
    const centre=new THREE.Vector3(-1,0,2)
    orbit.target.copy(centre)
    camera.position.set(centre.x,600,centre.z+.01)
    camera.up.set(0,0,-1)
    orbit.update();return
  }
  if(!sampleMode.value && aspect>=1.08){
    // Fixed desktop composition. Camera fitted to the 1672×941 design's trapezoidal
    // stockyard apron (perspective, front edge wider than rear). CAD X/Z never changes.
    // Outer ring corners A(295,305) B(1157,305) C(1303,664) D(210,664):
    //   rear 862px / front 1093px (≈+27%), quay waterline ≈y819, mid facility ≈y540.
    // 迁移适配：5188 首页布局与源工程一致，保持原始 FOV 以确保 1:1 取景。
    camera.up.set(0,1,0)
    setFieldOfView(8.53)
    const yaw=THREE.MathUtils.degToRad(0),pitch=THREE.MathUtils.degToRad(16.51)
    const dir=new THREE.Vector3(Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),Math.cos(pitch)*Math.cos(yaw))
    const centre=new THREE.Vector3(-20.34,0,60.26)
    const distance=323.6
    orbit.target.copy(centre);camera.position.copy(centre).addScaledVector(dir,distance)
    orbit.update();return
  }
  setFieldOfView(34)
  if(sampleMode.value){
    const target=at(-4,-40,1.05)
    orbit.target.copy(target)
    camera.position.copy(target).addScaledVector(new THREE.Vector3(.40,.79,1).normalize(),aspect<1?81:49)
    orbit.update();return
  }
  const dir=new THREE.Vector3(.19,aspect<.85?.94:.62,1).normalize()
  const right=new THREE.Vector3(dir.z,0,-dir.x).normalize()
  const vertical=new THREE.Vector3().crossVectors(dir,right)
  const centre=new THREE.Vector3(-4,0,9)
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2))
  let distance=0
  for(const x of [-47,46])for(const z of [-48,68]){
    const p=new THREE.Vector3(x,1,z).sub(centre),depth=p.dot(dir)
    distance=Math.max(distance,depth+Math.abs(p.dot(right))/(tan*aspect*.95),
      depth+Math.abs(p.dot(vertical))/(tan*(aspect<.85?.77:.88)))
  }
  orbit.target.copy(centre)
  camera.position.copy(centre).addScaledVector(dir,distance)
  orbit.update()
}
function showRegion(id:string) {
  const area=availableRegions.value.find(a=>a.id===id)
  if(!area)return
  selectedRegionId.value=id
  showRegionPanel.value=true
  floatingDetail.value=null
  detail.value=null
  activeSystem.value='全部'
  refresh()
  if(!camera||!orbit||!current)return
  const anchors=area.anchorIds.map(id=>current!.anchors.find(a=>a.id===id))
    .filter((a):a is CadAnchor=>!!a)
  if(!anchors.length)return  // No geographical point: data-only view, never invent one
  const favorite=anchors.find(a=>a.id===area.focusAnchorId)
  const x=favorite?.x??anchors.reduce((n,a)=>n+a.x,0)/anchors.length
  const z=favorite?.z??anchors.reduce((n,a)=>n+a.z,0)/anchors.length
  const target=at(x,z,0)
  const dir=camera.position.clone().sub(orbit.target).normalize()
  orbit.target.copy(target)
  setFieldOfView(34)
  camera.position.copy(target).add(dir.multiplyScalar(id==='REG-YARD'||id==='REG-BERTH'?78:49))
  orbit.update()
}
function openAreaForAnchor(id:string){
  const region=availableRegions.value.find(area=>area.anchorIds.includes(id))
  if(region)showRegion(region.id)
  else selectAnchorById(id)
}
function toggleRegionPanel() {
  showRegionPanel.value=!showRegionPanel.value
  detail.value=null
  floatingDetail.value=null
  if(showRegionPanel.value)regionNavOpen.value=false
}
function openFloatingMark(id:string) {
  const mark=floatingMarks.value.find(q=>q.id===id)
  if(!mark)return
  floatingDetail.value=mark
  detail.value=null
  showRegionPanel.value=false
  auditOpen.value=false
  // Selecting an off-screen point from the 40-item index must actually locate it.
  if(!labelItems.value.some(l=>l.id===id)&&camera&&orbit){
    const target=at(mark.x,mark.z,0)
    const view=camera.position.clone().sub(orbit.target).normalize()
    orbit.target.copy(target)
    setFieldOfView(34)
  camera.position.copy(target).addScaledVector(view,55)
    orbit.update()
  }
  if(pointIndexOpen.value)pointIndexOpen.value=false
  if(mark.regionId && availableRegions.value.some(r=>r.id===mark.regionId))selectedRegionId.value=mark.regionId
  refresh()
}
function createFloatingMarks(data:CadScene,spatial:SpatialCandidateData) {
  const marks:FloatingMark[]=[]
  for(const y of spatial.yardSideCandidates){
    // One label per yard column (A side). B side stays clickable through the A-side detail.
    if(y.side!=='A')continue
    marks.push({id:y.id,name:y.label.replace('A侧 ','')+'堆场',kind:'yardCandidate',x:y.sceneXZ[0],z:y.sceneXZ[1],
      regionId:'REG-YARD',sourceHandle:y.sourceTextHandle,note:y.description,status:'两侧列位推算 · 待核'})
  }
  // One floating label per CAD-extracted CLOSED polygon (not per physical pool).
  for(const pool of spatial.poolContourCandidates){
    marks.push({id:pool.id,name:(pool.groupId==='REG-NPOOL'?'北池':'南池')+' 候选'+pool.id.slice(-2),
      kind:'poolContour',x:pool.sceneXZ[0],z:pool.sceneXZ[1],regionId:pool.groupId,
      sourceHandle:pool.sourceGeometryHandles.slice(0,4).join(' / ')||'水池原图层',
      note:pool.description,status:'闭合CAD线构造 · 单池身份待核'})
  }
  for(const a of data.anchors){
    if(a.type==='堆场'||a.type.startsWith('设计文字'))continue
    const r=regions.value.find(reg=>reg.anchorIds.includes(a.id))
    marks.push({id:a.id,name:a.id==='TG-CAD-09'?'北侧集水池 · 设计2座':
      a.id==='TG-CAD-10'?'南侧集水池 · 设计5座':a.name.split('（')[0],
      kind:a.name.includes('集水池')?'poolGroup':'facility',x:a.x,z:a.z,
      regionId:r?.id||'',sourceHandle:a.sourceHandle||'未取得',
      note:(a.note||'源CAD文字插入点，不是设备安装坐标')+
        (a.id==='TG-CAD-09'||a.id==='TG-CAD-10'?'；源图设计池体数量与候选闭合轮廓数量不能混同。':''),
      status:'源CAD文字定位 · 单体未核'})
  }
  const extra=(chainMarkerData.value?.markers || []).map(a=>({
    id:a.id,name:a.name,kind:'chainBucketWash',x:a.sceneXZ[0],z:a.sceneXZ[1],
    regionId:'',sourceHandle:a.sourceHandle,note:a.note,
    status:a.displayStatus
  }))
  const existing=new Set([...extra,...marks].map(m=>m.sourceHandle))
  const additions=(data.sourceDWGSHA256===landmarksSource?landmarks:[]).filter(f=>!existing.has(f.handle)).map(f=>({
    id:'HOME-'+f.handle,name:f.name+(f.handle==='8D367'?'（首钢底图）':''),kind:'facility',x:f.x,z:f.z,
    regionId:'',sourceHandle:f.handle,
    note:f.evidence||('原图层 '+f.layer+'。坐标取文字插入点，三维外观与高度为示意。'),
    status:f.evidenceLevel==='anchor_only'?'CAD文字已定位 · 轮廓待核':'CAD文字已定位 · 轮廓已匹配'
  }))
  floatingMarks.value=[...extra,...marks,...additions]
}
function buildPoolCandidateSurfaces(data:SpatialCandidateData){
  if(!scene)return
  for(const [index,pool] of data.poolContourCandidates.entries()){
    if(pool.displayXZ.length<4)continue
    const shape=new THREE.Shape()
    pool.displayXZ.forEach((point,i)=>i?shape.lineTo(point[0],point[1]):shape.moveTo(point[0],point[1]))
    shape.closePath()
    const geo=new THREE.ShapeGeometry(shape)
    geo.rotateX(-Math.PI/2)
    const mat=new THREE.MeshBasicMaterial({color:pool.groupId==='REG-NPOOL'?'#64cbe5':'#83bfe7',
      transparent:true,opacity:.30,side:THREE.DoubleSide,depthWrite:false})
    const mesh=new THREE.Mesh(geo,mat)
    mesh.position.y=.91+(index%3)*.002
    mesh.renderOrder=9
    mesh.name=pool.name+'（未验证单池身份）'
    scene.add(mesh);poolSurfaceModels.push(mesh)
    geometriesToDispose.push(geo);materialsToDispose.push(mat)
    const edges:number[]=[]
    for(let k=1;k<pool.displayXZ.length;k++){
      const a=pool.displayXZ[k-1],b=pool.displayXZ[k]
      edges.push(a[0],.93,-a[1],b[0],.93,-b[1])
    }
    if(edges.length){
      const outlineGeo=new THREE.BufferGeometry()
      outlineGeo.setAttribute('position',new THREE.Float32BufferAttribute(edges,3))
      const lineMaterial=new THREE.LineBasicMaterial({color:'#2498b3',transparent:true,opacity:.8,depthTest:false})
      const border=new THREE.LineSegments(outlineGeo,lineMaterial)
      border.renderOrder=10
      scene.add(border);poolSurfaceModels.push(border)
      geometriesToDispose.push(outlineGeo);materialsToDispose.push(lineMaterial)
    }
  }
}
function createScreenLabels() {
  if(!camera||!root.value||!markersVisible.value)return
  const w=root.value.clientWidth,h=Math.min(root.value.clientHeight,root.value.getBoundingClientRect().height)
  if(w<1||h<1)return
  const marks=floatingMarks.value.filter(m=>{
    const mode=sourceMode.value
    if(solidMode.value && !allLabels.value && !mode && camera && orbit &&
       camera.position.distanceTo(orbit.target)>105){
      if(m.kind==='poolContour')return false
      if(m.kind==='yardCandidate')return w>=1200
      const key=['TG-CHAIN-1058D8','TG-CAD-09','TG-CAD-10','TG-CAD-11','TG-CAD-12','TG-CAD-14','TG-CAD-19','TG-CAD-20']
      return key.includes(m.id)||['HOME-1028AB','HOME-F9BEE','HOME-8D367','HOME-F9BFB','HOME-103415','TG-CAD-15','TG-CAD-16'].includes(m.id)
    }
    if(!mode)return !(sampleMode.value && !allLabels.value && (m.kind==='yardCandidate'||m.kind==='poolContour'))
    if(m.kind==='chainBucketWash')return mode.id==='middle'
    return !m.regionId||availableRegions.value.some(r=>r.id===m.regionId)
  })
  // Explicit CAD TEXT for chain-bucket basin is always prioritized when in view.
  const priority=(m:FloatingMark)=>m.kind==='chainBucketWash'?-1:
    m.kind==='poolGroup'?0:m.kind==='yardCandidate'?1:m.kind==='poolContour'?2:3
  const used:{x:number;y:number;width:number;height:number}[]=[]
  const placed:Label[]=[]
  // A 4K browser reports full CSS-pixel dimensions at 100% OS scaling.
  // Mirror large-screen label sizing and reserve the taller toolbar+legend area.
  const large=w>=2100 && window.innerWidth>=2200
  const labelScale=large?Math.min(1.9,Math.max(1,Math.min(19,Math.max(13,window.innerWidth*.0026+window.innerHeight*.0033))/10)):1
  const legend=root.value.parentElement?.querySelector('.l1-site-legend')
  const clearance=large&&legend
    ?Math.max(157,legend.getBoundingClientRect().bottom-root.value.getBoundingClientRect().top+14*labelScale)
    :157
  for(const mark of [...marks].sort((a,b)=>priority(a)-priority(b))){
    // Yard labels sit on the visual middle of the stockpile (reference y≈444), not on the
    // northern A-side text anchor. The CAD anchor itself is unchanged.
    const labelZ=mark.kind==='yardCandidate'?mark.z-27:mark.z
    const clip=at(mark.x,labelZ,solidMode.value && mark.kind==='yardCandidate'?3.3:mark.kind==='poolContour'?1.2:1).project(camera)
    if(clip.z>1||clip.z< -1)continue
    const px=(clip.x+1)*w*.5,py=(1-clip.y)*h*.5
    // Facility anchors in the northern row can sit behind the toolbar chips. Keep the
    // anchor, clamp the chip below the clearance band and let the leader line span it.
    if(px<22||px>w-22||py<h*.06||py>h-34)continue
    const compact=w<720
    const name=compact&&mark.kind==='poolContour'?mark.name.replace('候选','C'):mark.name
    const width=(compact?Math.min(110,Math.max(42,name.length*9+17))
      :Math.min(190,Math.max(53,name.length*10.5+20)))*labelScale+(large?28:0)
    const ht=(compact?20:25)*labelScale+(large?8:0)
    let best:{x:number;y:number}|null=null
    const berthBelow=mark.id==='TG-CAD-19'||mark.id==='TG-CAD-20'
    const baseOffsets:number[][]=berthBelow
      ? [[0,120],[-70,110],[70,110],[0,98]]
      : [[0,0],[0,-24],[-31,-12],[31,-12],[-58,0],[58,0],[-31,-35],[31,-35],
        [-74,-19],[74,-19],[-86,-44],[86,-44],[0,-54],[-110,-30],[110,-30],
        [-140,-16],[140,-16],[-170,-52],[170,-52],[-200,-4],[200,-4]]
    const offsets=baseOffsets
      .map(([dx,dy])=>[dx*labelScale,dy*labelScale])
    if(w>900){
      for(let radius=90;radius<=330;radius+=45){
        for(let degree=0;degree<360;degree+=30){
          const rad=degree*Math.PI/180
          offsets.push([Math.cos(rad)*radius*labelScale,Math.sin(rad)*radius*labelScale])
        }
      }
    }
    for(const [dx,dy] of offsets){
      const cx=Math.max(width*.5+6*labelScale,Math.min(w-width*.5-6*labelScale,px+dx))
      const cy=Math.max(clearance+ht,Math.min(h-25*labelScale,py+dy))
      const rect={x:cx-width/2,y:cy-ht,width,height:ht}
      const margin=large?Math.max(13,12*labelScale):(w>900?9:4)
      const clashes=used.some(r=>rect.x<r.x+r.width+margin&&rect.x+rect.width+margin>r.x
        &&rect.y<r.y+r.height+margin&&rect.y+rect.height+margin>r.y)
      if(!clashes){best={x:cx,y:cy};used.push(rect);break}
    }
    if(!best){
      // A label can temporarily disappear at low zoom on a small screen,
      // while the actual geometry and count remain available.
      continue
    }
    placed.push({id:mark.id,name,kind:mark.kind,x:best.x,y:best.y,
      pointX:px,pointY:py,regionId:mark.regionId,sourceHandle:mark.sourceHandle,
      note:mark.note,status:mark.status})
  }
  labelItems.value=placed
}
function updateCompass(){
  if(!camera||!orbit)return
  const target=orbit.target.clone()
  const o=target.clone().project(camera)
  const n=target.addScaledVector(northUnitVector,10).project(camera)
  const deg=Math.atan2(n.x-o.x,n.y-o.y)*180/Math.PI
  if(Number.isFinite(deg) && Math.abs(compassDegrees.value-deg)>.4)compassDegrees.value=deg
}
function selectAnchorById(id: string) {
  const a=current?.anchors.find(item=>item.id===id)
  if(a)chooseEntry({type:'anchor',data:a})
}
function chooseEntry(entry: Entry | null) {
  floatingDetail.value=null
  showRegionPanel.value=false
  if(continuityOpen.value)closeContinuity()
  detail.value=entry
  if(entry && entry.type!=='pipe') {
    const area=availableRegions.value.find(r=>entry.type==='anchor'?r.anchorIds.includes(entry.data.id):
      entry.type==='yardBand'?r.bandIds.includes(entry.data.id):
      r.contourHandles.includes(entry.data.handle))
    if(area)selectedRegionId.value=area.id
  }
  refresh()
  if (entry && entry.type!=='pipe' && camera && orbit) {
    const point=entry.type==='anchor'?[entry.data.x,entry.data.z] as Pt2
      :entry.type==='yardBand'?entry.data.displayXZ.reduce(([x,z],p)=>[x+p[0],z+p[1]],[0,0] as Pt2).map(v=>v/entry.data.displayXZ.length) as Pt2
      :entry.data.displayXZ.reduce(([x,z],p)=>[x+p[0],z+p[1]],[0,0] as Pt2).map(v=>v/entry.data.displayXZ.length) as Pt2
    const target=at(point[0],point[1],0)
    // zoom to marker without losing the current observer orientation
    const offset=camera.position.clone().sub(orbit.target)
    orbit.target.copy(target)
    camera.position.copy(target).add(offset.multiplyScalar(.75))
    orbit.update()
  }
}
function selectBand(id:string){
  const band=current?.yardBands.find(x=>x.id===id)
  if(band)chooseEntry({type:'yardBand',data:band})
}
function selectContour(handle:string){
  const item=current?.matchedFacilityContours.find(x=>x.handle===handle)
  if(item)chooseEntry({type:'matchedContour',data:item})
}
function sourceMatchesForAnchor(a:CadAnchor){
  if(a.type==='堆场')return current?.yardBands.filter(b=>b.yardAnchorIds.includes(a.id)).map(b=>b.id+'，未分割两座堆场').join('；')||'无'
  return current?.matchedFacilityContours.filter(c=>c.anchorIds.includes(a.id)).map(c=>c.handle+'（包含文字点）').join('；')||'未匹配'
}
function focusCandidatePipe() {
  const candidates=(current?.lines||[]).filter(item=>item.role==='pipe'
    && (!sourceMode.value||focusedPipeLayerSet.value.has(item.layer)))
  if(!candidates.length)return
  const longest=candidates.reduce((best,item)=>{
    const len=item.displayPoints.reduce((sum,p,i)=>i?sum+Math.hypot(p[0]-item.displayPoints[i-1][0],p[1]-item.displayPoints[i-1][1]):sum,0)
    return len>best.length?{item,length:len}:best
  },{item:candidates[0],length:0}).item
  chooseEntry({type:'pipe',data:longest})
  const middle=longest.displayPoints[Math.floor(longest.displayPoints.length/2)]
  if(camera&&orbit&&middle){
    const pos=at(...middle,0)
    const offset=camera.position.clone().sub(orbit.target)
    orbit.target.copy(pos)
    camera.position.copy(pos).add(offset.multiplyScalar(.72))
    orbit.update()
  }
}
function switchMaterial(){
  if(sampleMode.value){
    sampleMode.value=false
    resetCameraPosition()
  }
  grayMode.value=!grayMode.value
  refresh()
}
function toggleSample(){
  const next=!sampleMode.value
  chooseSystem('all')
  sampleMode.value=next
  grayMode.value=false
  resetCameraPosition()
  refresh()
}
function resetCamera() {
  sampleMode.value=false
  floatingDetail.value=null
  detail.value=null
  const mode=sourceMode.value
  if(mode)focusByAnchorIds(mode.focusAnchorIds,mode.id==='middle'||mode.id==='rain'?80:63)
  else resetCameraPosition()
  refresh()
}
function drawLinework(items: CadLine[], color:string, h:number,opacity:number) {
  const points:number[]=[]
  for(const item of items) {
    for(let j=1;j<item.displayPoints.length;j++) {
      const a=item.displayPoints[j-1], b=item.displayPoints[j]
      points.push(a[0],h,-a[1],b[0],h,-b[1])
    }
  }
  if(!points.length||!scene)return
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3))
  const material=new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false})
  const obj=new THREE.LineSegments(geometry,material)
  geometriesToDispose.push(geometry);materialsToDispose.push(material)
  obj.userData.opacity=opacity
  scene.add(obj);outlineMeshes.push(obj)
}
function build(data: CadScene) {
  if(!scene)return
  current=data
  visibleBands.value=data.yardBands
  visibleContours.value=data.matchedFacilityContours
  sourceStats.value={
    sources:data.qa.renderEntries,pipePieces:data.qa.visiblePipeGeometries,pipeHandles:data.qa.visibleDistinctPipeSourceHandles,
    anchors:data.anchors.length,yards:data.qa.yardSourceAnchors
  }
  // Four source-backed parallel strips (not eight invented closed parcel boundaries).
  // Only their two long sides are exact DWG source lines; endcaps are derived.
  const edgeSource:number[]=[]
  const edgeCaps:number[]=[]
  for(const band of data.yardBands||[]) {
    const path=band.displayXZ
    if(path.length<5)continue
    const shape=new THREE.Shape()
    shape.moveTo(path[0][0],path[0][1])
    for(let i=1;i<path.length;i++)shape.lineTo(path[i][0],path[i][1])
    const geometry=new THREE.ShapeGeometry(shape)
    geometry.rotateX(-Math.PI/2)
    const mat=new THREE.MeshStandardMaterial({color:'#e7bd68',roughness:.8,metalness:0,
      transparent:true,opacity:.21,side:THREE.DoubleSide,depthWrite:false})
    const mesh=new THREE.Mesh(geometry,mat)
    mesh.position.y=.018
    mesh.name=band.name
    mesh.userData={pick:'yardBand',bandId:band.id}
    scene.add(mesh);pickObjects.push(mesh)
    yardBandModels.push({mesh,band,mat})
    geometriesToDispose.push(geometry);materialsToDispose.push(mat)
    const solid=[[path[0],path[1]],[path[2],path[3]]]
    const caps=[[path[1],path[2]],[path[3],path[0]]]
    for(const [a,b] of solid)edgeSource.push(a[0],.17,-a[1],b[0],.17,-b[1])
    for(const [a,b] of caps)edgeCaps.push(a[0],.17,-a[1],b[0],.17,-b[1])
  }
  if(edgeSource.length){
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.Float32BufferAttribute(edgeSource,3))
    const mat=new THREE.LineBasicMaterial({color:'#bf8b40',transparent:true,opacity:.9})
    const obj=new THREE.LineSegments(geo,mat)
    scene.add(obj);areaLines.push(obj);geometriesToDispose.push(geo);materialsToDispose.push(mat)
  }
  if(edgeCaps.length){
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.Float32BufferAttribute(edgeCaps,3))
    const mat=new THREE.LineDashedMaterial({color:'#c79d68',dashSize:.7,gapSize:.5,transparent:true,opacity:.72})
    const obj=new THREE.LineSegments(geo,mat);obj.computeLineDistances()
    scene.add(obj);areaLines.push(obj);geometriesToDispose.push(geo);materialsToDispose.push(mat)
  }
  // CAD originals: not building or pool solids; only corresponding original linework.
  const base=data.lines.filter(a=>a.role==='background')
  const facilities=data.lines.filter(a=>a.role==='facility')
  const auxiliaries=data.lines.filter(a=>a.role==='support')
  drawLinework(base,'#a9becb',.035,.64)
  drawLinework(facilities,'#6eacbd',.075,.92)
  drawLinework(auxiliaries,'#b6cdd6',.105,.5)
  // Pipe candidate geometry: no automatic joining of intersections or assigning engineering elevations.
  const grouped=new Map<string,{system:string,layer:string,edges:CadLine[],ends:Array<{a:THREE.Vector3,b:THREE.Vector3,ref:CadLine}>}>()
  for(const item of data.lines.filter(a=>a.role==='pipe')) {
    let batch=grouped.get(item.layer)
    if(!batch){batch={system:item.system,layer:item.layer,edges:[],ends:[]};grouped.set(item.layer,batch)}
    const y=displayLevel(item.layer)
    for(let i=1;i<item.displayPoints.length;i++){
      const a=at(...item.displayPoints[i-1],y),b=at(...item.displayPoints[i],y)
      if(a.distanceTo(b)<.02 || a.distanceTo(b)>180)continue
      batch.ends.push({a,b,ref:item})
      batch.edges.push(item)
    }
  }
  for(const batch of grouped.values()) {
    if(!batch.ends.length)continue
    const mat=new THREE.MeshStandardMaterial({
      color:'#ffffff',roughness:.30,metalness:.12,emissive:'#113449',emissiveIntensity:0
    })
    const mesh=new THREE.InstancedMesh(pipeGeometry,mat,batch.ends.length)
    const tint=new THREE.Color(systemColors[batch.layer]||'#4ca5c5')
    mesh.name=batch.layer
    mesh.castShadow=true
    mesh.receiveShadow=true
    for(let i=0;i<batch.ends.length;i++){
      const edge=batch.ends[i],v=edge.b.clone().sub(edge.a)
      tmp.position.copy(edge.a).add(edge.b).multiplyScalar(.5)
      tmp.quaternion.setFromUnitVectors(up,v.clone().normalize())
      // Tube radius tuned so the CAD pipe network reads clearly without dominating.
      const radius=batch.layer.includes('中压')?.24:batch.layer.includes('消防')?.17:.20
      tmp.scale.set(radius,v.length(),radius)
      tmp.updateMatrix()
      mesh.setMatrixAt(i,tmp.matrix)
      mesh.setColorAt(i,tint)
    }
    mesh.instanceMatrix.needsUpdate=true
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true
    mesh.computeBoundingSphere()
    mesh.userData.pick='pipe'
    mesh.userData.batchIndex=batches.length
    scene.add(mesh);pickObjects.push(mesh)
    batches.push({mesh,edges:batch.edges,layer:batch.layer,system:batch.system})
    materialsToDispose.push(mat)
  }
  // Pipe supports under the elevated CAD traces. Presentation furniture only: they
  // express that the drawn pipes are physical, not that any segment is hydraulically verified.
  {
    const supportMap=new Map<string,{x:number;z:number;y:number}>()
    for(const batch of grouped.values()){
      for(const e of batch.ends){
        const len=e.a.distanceTo(e.b)
        if(len<4.6)continue
        for(let d=2.2;d<len-1.4;d+=4.6){
          const t=d/len
          const x=e.a.x+(e.b.x-e.a.x)*t,z=e.a.z+(e.b.z-e.a.z)*t
          const key=`${Math.round(x*3)}|${Math.round(z*3)}`
          const y=Math.min(e.a.y,e.b.y)
          const prev=supportMap.get(key)
          if(!prev||prev.y<y)supportMap.set(key,{x,z,y})
        }
      }
    }
    if(supportMap.size){
      const geo=new THREE.BoxGeometry(1,1,1)
      const mat=new THREE.MeshStandardMaterial({color:'#b3bcb9',roughness:.9,metalness:.04})
      const mesh=new THREE.InstancedMesh(geo,mat,supportMap.size)
      mesh.name='管线支墩 · 表现层'
      let i=0
      for(const p of supportMap.values()){
        const h=Math.max(.05,p.y-.045)
        tmp.position.set(p.x,.06+h/2,p.z)
        tmp.scale.set(.14,h,.14)
        tmp.rotation.set(0,0,0)
        tmp.updateMatrix()
        mesh.setMatrixAt(i++,tmp.matrix)
      }
      mesh.instanceMatrix.needsUpdate=true
      mesh.computeBoundingSphere()
      mesh.castShadow=true
      mesh.receiveShadow=true
      scene.add(mesh)
      geometriesToDispose.push(geo);materialsToDispose.push(mat)
    }
  }
  // Animated flow pulses along approved pipe segments. This is a direction-neutral
  // "signal" motif for readability; it does NOT assert hydraulic direction or connectivity.
  const seeds: { a: THREE.Vector3; b: THREE.Vector3; color: THREE.Color }[] = []
  for(const batch of grouped.values()){
    const color=new THREE.Color(systemColors[batch.layer]||'#4ca5c5').lerp(new THREE.Color('#ffffff'),.55)
    for(const e of batch.ends){
      if(e.a.distanceTo(e.b)<2.6)continue
      seeds.push({a:e.a.clone(),b:e.b.clone(),color})
    }
  }
  const stride=Math.max(1,Math.ceil(seeds.length/240))
  const picked=seeds.filter((_,i)=>i%stride===0)
  if(picked.length){
    const count=picked.length*2
    const pos=new Float32Array(count*3),col=new Float32Array(count*3)
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3))
    geo.setAttribute('color',new THREE.BufferAttribute(col,3))
    const mat=new THREE.PointsMaterial({size:.5,vertexColors:true,transparent:true,
      opacity:.95,depthWrite:false,sizeAttenuation:true})
    flowPoints=new THREE.Points(geo,mat)
    flowPoints.name='管线流动示意 · 非水力方向'
    flowPoints.frustumCulled=false;flowPoints.renderOrder=4
    scene.add(flowPoints)
    materialsToDispose.push(mat);geometriesToDispose.push(geo)
    flowPositions=pos;flowDots=[]
    picked.forEach((s,idx)=>{
      for(let k=0;k<2;k++){
        flowDots.push({a:s.a,b:s.b,phase:(idx*.317+k*.5)%1,speed:.055+(idx%7)*.004,
          y:Math.max(s.a.y,s.b.y)+.13})
        const o=(idx*2+k)*3
        col[o]=s.color.r;col[o+1]=s.color.g;col[o+2]=s.color.b
      }
    })
    geo.attributes.color.needsUpdate=true
  }
  // Low-detail solids are extruded ONLY from genuinely closed original CAD geometry.
  // They are intentionally NOT classified as verified buildings or pool identities.
  const cadVolumeMaterials: Record<string,THREE.MeshStandardMaterial> = {
    '$pm单体':new THREE.MeshStandardMaterial({color:'#b8cfda',metalness:.22,roughness:.48,transparent:true,opacity:.75,side:THREE.DoubleSide}),
    '水池':new THREE.MeshStandardMaterial({color:'#8ed0df',metalness:.27,roughness:.40,transparent:true,opacity:.65,side:THREE.DoubleSide}),
    '---辅建区':new THREE.MeshStandardMaterial({color:'#c1d8e2',metalness:.15,roughness:.55,transparent:true,opacity:.72,side:THREE.DoubleSide})
  }
  materialsToDispose.push(...Object.values(cadVolumeMaterials))
  for(const part of data.cadClosedContourCandidates||[]) {
    if(part.outline.length<4)continue
    const shape=new THREE.Shape()
    const [first,...rest]=part.outline
    shape.moveTo(first[0],first[1])
    for(const p of rest)shape.lineTo(p[0],p[1])
    shape.closePath()
    const geo=new THREE.ExtrudeGeometry(shape,{depth:part.volumeHeightDisplayOnly,bevelEnabled:false,steps:1,curveSegments:2})
    geo.rotateX(-Math.PI/2)
    const mesh=new THREE.Mesh(geo,cadVolumeMaterials[part.layer]||cadVolumeMaterials['$pm单体'])
    mesh.name='CAD闭合轮廓候选 '+part.handle
    mesh.position.y=.11
    mesh.userData={sourceHandle:part.handle,sourceLayer:part.layer,validationStatus:'unknown'}
    scene.add(mesh);contourModels.push(mesh);geometriesToDispose.push(geo)
    if(part.matchedCadTextAnchorIds?.length){
      mesh.userData.pick='matchedContour'
      pickObjects.push(mesh);contourPickModels.push({mesh,handle:part.handle})
    }
  }
  // Unverified facility CAD *text anchors*: stylized markers, not physical buildings.
  const markerGeo=new THREE.CylinderGeometry(.44,.44,.23,12)
  const markerMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.27,metalness:.42})
  const mm=new THREE.InstancedMesh(markerGeo,markerMat,data.anchors.length)
  markerMesh=mm
  markerMesh.userData.pick='anchor'
  geometriesToDispose.push(markerGeo);materialsToDispose.push(markerMat)
  for(let i=0;i<data.anchors.length;i++){
    const a=data.anchors[i]
    tmp.position.copy(at(a.x,a.z,.23))
    tmp.quaternion.identity()
    tmp.scale.setScalar(1)
    tmp.updateMatrix()
    mm.setMatrixAt(i,tmp.matrix)
    mm.setColorAt(i,new THREE.Color(markerColor(a)))
  }
  mm.instanceMatrix.needsUpdate=true
  if(mm.instanceColor)mm.instanceColor.needsUpdate=true
  mm.computeBoundingSphere()
  scene.add(mm);pickObjects.push(mm)
  scene.add(bright)
  refresh()
}
function selectByCanvas(e:PointerEvent) {
  if(!canvas||!camera||!current||!lastPointer)return
  if(Math.hypot(lastPointer[0]-e.clientX,lastPointer[1]-e.clientY)>5) return
  const rect=canvas.getBoundingClientRect()
  pointer.set(2*(e.clientX-rect.left)/rect.width-1,1-2*(e.clientY-rect.top)/rect.height)
  ray.setFromCamera(pointer,camera)
  const activePicks=relief?.group.visible?[...relief.picks,...pickObjects]:pickObjects
  const hits=ray.intersectObjects(activePicks.filter(obj=>obj.visible && (
    obj.userData.pick!=='pipe'||obj.userData.selectable)),false)
  const first=hits[0]
  if(!first)return
  if(first.object.userData.pick==='reliefPoint'){
    openFloatingMark(first.object.userData.pointId)
    return
  }
  if(first.object.userData.pick==='yardBand'){
    const b=current.yardBands.find(item=>item.id===first.object.userData.bandId)
    if(b)chooseEntry({type:'yardBand',data:b})
    return
  }
  if(first.object.userData.pick==='matchedContour'){
    const c=current.matchedFacilityContours.find(item=>item.handle===first.object.userData.sourceHandle)
    if(c)chooseEntry({type:'matchedContour',data:c})
    return
  }
  if(first.instanceId===undefined)return
  if(first.object===markerMesh){
    const a=current.anchors[first.instanceId]
    if(a)openAreaForAnchor(a.id)
    return
  }
  const mesh=first.object as THREE.InstancedMesh
  const batch=batches[Number(mesh.userData.batchIndex)]
  const line=batch?.edges[first.instanceId]
  if(line)chooseEntry({type:'pipe',data:line})
}
function onDown(e:PointerEvent){lastPointer=[e.clientX,e.clientY]}
function onUp(e:PointerEvent){selectByCanvas(e);lastPointer=null}
function setup() {
  if(!root.value)return
  const el=root.value
  scene=new THREE.Scene()
  camera=new THREE.PerspectiveCamera(34,Math.max(el.clientWidth,1)/Math.max(el.clientHeight,1),.1,1500)
  camera.position.set(95,145,154)
  renderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'default'})
  // Bound WebGL framebuffer area on Retina/4K to avoid memory spikes.
  const initialW=Math.max(el.clientWidth,1),initialH=Math.max(el.clientHeight,1)
  const displayPixelRatio=(w:number,h:number)=>Math.min(window.devicePixelRatio||1,1.55,
    Math.max(.85,Math.sqrt(13_000_000/Math.max(1,w*h))))
  renderer.setPixelRatio(displayPixelRatio(initialW,initialH))
  renderer.setSize(initialW,initialH,false)
  renderer.outputColorSpace=THREE.SRGBColorSpace
  renderer.toneMapping=THREE.NeutralToneMapping
  renderer.toneMappingExposure=1.15
  renderer.shadowMap.enabled=true
  renderer.shadowMap.type=THREE.PCFSoftShadowMap
  // Daylight sky: equirectangular canvas used as both background and IBL source.
  // It describes atmosphere only; it is not survey or meteorological data.
  const sky=document.createElement('canvas')
  sky.width=1024;sky.height=512
  const ctx=sky.getContext('2d')
  if(ctx){
    const grad=ctx.createLinearGradient(0,0,0,300)
    grad.addColorStop(0,'#3f89c4');grad.addColorStop(.55,'#8fc0dd');grad.addColorStop(1,'#e7f0ef')
    ctx.fillStyle=grad;ctx.fillRect(0,0,1024,300)
    ctx.fillStyle='#c7d4cd';ctx.fillRect(0,300,1024,212)
    for(let i=0;i<26;i++){
      const cx=(i*173+61)%1024, cy=40+(i*97)%170, rx=70+(i*53)%110, ry=16+(i*29)%22
      const cloud=ctx.createRadialGradient(cx,cy,0,cx,cy,rx)
      cloud.addColorStop(0,'rgba(255,255,255,.86)');cloud.addColorStop(.55,'rgba(255,255,255,.42)')
      cloud.addColorStop(1,'rgba(255,255,255,0)')
      ctx.save();ctx.translate(cx,cy);ctx.scale(1,ry/rx);ctx.translate(-cx,-cy)
      ctx.fillStyle=cloud;ctx.beginPath();ctx.arc(cx,cy,rx,0,Math.PI*2);ctx.fill();ctx.restore()
    }
  }
  const skyTexture=new THREE.CanvasTexture(sky)
  skyTexture.mapping=THREE.EquirectangularReflectionMapping
  skyTexture.wrapS=THREE.RepeatWrapping
  skyTexture.colorSpace=THREE.SRGBColorSpace
  environmentTextures.push(skyTexture)
  scene.background=skyTexture
  scene.fog=new THREE.Fog('#cfe2e7',330,1000)
  try{
    const pmrem=new THREE.PMREMGenerator(renderer)
    const env=pmrem.fromEquirectangular(skyTexture)
    scene.environment=env.texture
    environmentTextures.push(env.texture)
    pmrem.dispose()
  }catch{/* environment map is optional */}
  canvas=renderer.domElement
  canvas.className='l1-webgl'
  // CSS owns visual dimensions even during a fast 4K→2K viewport shrink.
  // renderer.setSize(...,false) controls drawing buffer, not inline CSS pixels.
  canvas.style.width='100%'
  canvas.style.height='100%'
  // Display grade disabled during lighting/pipe evaluation: no canvas filter, so the
  // renderer's true shadow/light/metal response is what gets reviewed.
  canvas.style.filter='none'
  canvas.setAttribute('aria-label','唐港CAD L1轻量三维审查场景：原图几何与管线候选')
  el.appendChild(canvas)
  orbit=new OrbitControls(camera,canvas)
  orbit.target.set(-3,0,1)
  orbit.enableDamping=true
  orbit.dampingFactor=.085
  orbit.minDistance=25;orbit.maxDistance=640
  orbit.maxPolarAngle=Math.PI*.485
  resetCameraPosition()
  scene.add(new THREE.HemisphereLight(0xdfeef8,0x6d855a,.42))
  const sun=new THREE.DirectionalLight(0xfff0d8,3.7)
  sun.position.set(64,104,44);sun.castShadow=true;shadowSun=sun
  Object.assign(sun.shadow.camera,{left:-92,right:92,top:96,bottom:-96,near:1,far:285})
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.mapSize.set(4096,4096);sun.shadow.normalBias=.03;sun.shadow.bias=-.0002
  sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true
  scene.add(sun)
  const edge=new THREE.DirectionalLight(0xc4ebf5,.45);edge.position.set(-66,48,-42);scene.add(edge)
  const planeGeo=new THREE.PlaneGeometry(840,840)
  const planeMat=new THREE.MeshStandardMaterial({color:'#6d8a5e',roughness:1,metalness:0})
  geometriesToDispose.push(planeGeo);materialsToDispose.push(planeMat)
  const plane=new THREE.Mesh(planeGeo,planeMat);plane.rotation.x=-Math.PI/2;plane.position.y=-.08;plane.receiveShadow=true;groundPlane=plane;scene.add(plane)
  const grid=new THREE.GridHelper(160,48,0xb9d6e5,0xd0e2ea)
  grid.position.y=-.049
  const gmat=grid.material as THREE.Material
  gmat.transparent=true;gmat.opacity=.32
  groundGrid=grid;scene.add(grid)
  const onResize=()=>{
    if(!camera||!renderer||!root.value)return
    const w=Math.max(1,root.value.clientWidth),h=Math.max(1,root.value.clientHeight)
    const reframe=Math.abs(w/h-camera.aspect)>.08 && !sourceMode.value && !floatingDetail.value && !detail.value
    camera.aspect=w/h
    // View offsets place the trapezoidal stockyard apron onto the 1672×941 design grid
    // (rear y≈305, front y≈664). Plan coordinates are unchanged. Offsets scale with the
    // canvas so the same 1672×941 fit holds at 2K/4K.
    const ox=w/h<1.08?0:Math.round(w*.13403)
    const oy=w/h<1.08?-Math.min(h*.065,55):-Math.round(h*.24059)
    camera.setViewOffset(w,h,ox,oy,w,h)
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(displayPixelRatio(w,h))
    renderer.setSize(w,h,false)
    if(reframe)resetCameraPosition()
  }
  // ResizeObserver handles parent layout changes; the window listener also
  // reacts promptly to live browser/window resizing on large displays.
  windowResizeHandler=onResize
  window.addEventListener('resize',onResize,{passive:true})
  observer=new ResizeObserver(onResize);observer.observe(el)
  canvas.addEventListener('pointerdown',onDown)
  canvas.addEventListener('pointerup',onUp)
  let n=0
  const tick=()=>{
    if(!active)return
    frameId=requestAnimationFrame(tick)
    if(studyOpen.value&&!busy.value)return
    orbit?.update()
    // Scene motion: water drift, vessel swell, cloud drift and pipe-flow pulses.
    const now=performance.now()/1000
    relief?.update(now)
    updateFlow(now)
    skyTexture.offset.x=(now*.0035)%1
    if(flowPoints)flowPoints.visible=solidMode.value&&!grayMode.value
    if(groundGrid)groundGrid.visible=!solidMode.value
    // Capped frame rate reduces GPU load on the development MacBook.
    if(++n%2!==0)return
    if(n%6===0){updateCompass();createScreenLabels()}
    renderer?.render(scene!,camera!)
  }
  tick()
}
function installDebugProbe(){
  if(new URLSearchParams(location.search).get('debug')!=='probe')return
  const rect=()=>root.value?.querySelector('canvas')?.getBoundingClientRect()??null
  const proj=(x:number,z:number)=>{
    const v=at(x,z,0).project(camera!)
    const r=rect();if(!r)return {x:0,y:0}
    return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height,ndcX:v.x,ndcY:v.y}
  }
  ;(window as any).__probe=()=>{
    const corners={
      A:proj(-43.04419,42.383271),B:proj(18.655788,42.383092),
      C:proj(18.655589,-50.633321),D:proj(-43.044446,-50.633223),
    }
    return {
      camera:{pos:at(0,0,0).copy(camera!.position).toArray(),target:orbit!.target.toArray(),fov:camera!.fov,aspect:camera!.aspect,viewOffset:{ox:camera!.view?.offsetX??0,oy:camera!.view?.offsetY??0}},
      rect:rect(),corners,
      project:(x:number,z:number)=>proj(x,z),
    }
  }
}
onMounted(async()=>{
  try {
    setup()
    const datasets=await loadSceneDatasets()
    const data=datasets.cad
    build(data)
    if(datasets.continuity){
      continuityData.value=datasets.continuity
      buildContinuityDebug(datasets.continuity)
    }
    if(datasets.pipeAudit)pipeAudit.value=datasets.pipeAudit
    if(datasets.chain)chainMarkerData.value=datasets.chain
    datasets.warnings.forEach(message=>{regionLoadError.value=message})
    if(datasets.spatial){
      const spatial=datasets.spatial
      spatialData=spatial
      buildPoolCandidateSurfaces(spatial)
      relief=buildHarborRelief(data,spatial)
      scene?.add(relief.group)
      const built=relief
      built.loadGallery().then(loaded=>{
        if(active&&relief===built){galleryReady.value=loaded;if(shadowSun)shadowSun.shadow.needsUpdate=true}
      }).catch(()=>{if(active)regionLoadError.value='廊架样板模型加载失败'})
      built.loadPortAssets().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun)shadowSun.shadow.needsUpdate=true
      }).catch(()=>{if(active)regionLoadError.value='港口设备表现模型加载失败'})
      built.loadBuildings().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun)shadowSun.shadow.needsUpdate=true
      }).catch(()=>{if(active)regionLoadError.value='精细建筑模型加载失败'})
      built.loadTrees().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun)shadowSun.shadow.needsUpdate=true
      }).catch(()=>{if(active)regionLoadError.value='精细树木模型加载失败'})
      built.loadProcessBuildings().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun)shadowSun.shadow.needsUpdate=true
      }).catch(()=>{if(active)regionLoadError.value='工艺建筑模型加载失败'})
      refresh()
    }
    if(datasets.regions){
      regions.value=datasets.regions.regions
      selectedRegionId.value='REG-YARD'
      if(spatialData)createFloatingMarks(data,spatialData)
      if(datasets.systems)businessSystems.value=datasets.systems.systems
      refresh()
    }
  } catch(e) { failure.value=e instanceof Error?e.message:'三维场景初始化失败' }
  finally {
    busy.value=false
    // Draw floating labels immediately after source data is ready; the first
    // 4K WebGL frame may be delayed while shaders and geometry initialize.
    createScreenLabels()
    installDebugProbe()
  }
})
onBeforeUnmount(()=>{
  active=false
  cancelAnimationFrame(frameId)
  observer?.disconnect()
  if(windowResizeHandler)window.removeEventListener('resize',windowResizeHandler)
  windowResizeHandler=null
  if(canvas){canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp)}
  orbit?.dispose()
  relief?.dispose()
  shadowSun?.shadow.map?.dispose()
  disposeHighlights()
  disposeContinuitySelection()
  continuityDebugGroup.clear()
  for(const batch of batches) batch.mesh.dispose()
  markerMesh?.dispose()
  pipeGeometry.dispose()
  geometriesToDispose.forEach(g=>g.dispose())
  environmentTextures.forEach(t=>t.dispose())
  flowPoints?.geometry.dispose();(flowPoints?.material as THREE.Material|undefined)?.dispose();flowPoints?.removeFromParent()
  flowPoints=null;flowPositions=null;flowDots=[]
  materialsToDispose.forEach(m=>m.dispose())
  scene?.traverse(obj=>{if(obj instanceof THREE.Mesh&&obj.geometry.type==='GridHelper')obj.geometry.dispose()})
  renderer?.dispose()
  renderer?.domElement.remove()
  current=null
})

// 供唐港首页调用：按系统聚焦、按区域定位、复位摄像机
defineExpose({
  focusSystem(id: string) {
    systemModeId.value = id || 'all'
  },
  locateRegion(id: string) {
    showRegion(id)
  },
  resetCamera,
})
</script>

<template>
  <div class="scene-layer l1-scene">
    <section class="cad-zone l1-zone" aria-label="唐港51、52泊位L1 CAD数字化工程场景">
      <div ref="root" class="l1-view"></div>
      <button class="l1-compass" :title="compassTitle" aria-label="指南针，点击重置视角" @click="resetCamera">
        <span class="l1-compass-dial" :style="{transform:'rotate('+compassDegrees+'deg)'}">
          <span class="l1-compass-n">N</span>
          <span class="l1-compass-arrow">▲</span>
          <span class="l1-compass-s">S</span>
        </span>
        <span class="l1-compass-caption">图纸北向</span>
      </button>
      <header class="l1-hud">
        <div>
          <div class="l1-eyebrow"><i></i> CAD DESIGN SOURCE <span>51 / 52</span></div>
          <h2>港区水务总览</h2>
          <p>{{systemDescription}}</p>
        </div>
        <div class="l1-actions">
          <button class="l1-tool-toggle" :class="{active:toolsOpen}" @click="toolsOpen=!toolsOpen"
            :aria-expanded="toolsOpen" aria-controls="l1-tool-stack">
            {{toolsOpen?'收起工具':'工具 / 系统核查'}}
          </button>
          <template v-if="toolsOpen">
          <button data-continuity-toggle="true" :class="{active:continuityOpen}"
            @click="toggleContinuity" :aria-expanded="continuityOpen">
            断点核查<span v-if="continuityData"> {{continuityData.summary.countOfCandidateLocations}}</span>
          </button>
          <button @click="toggleAudit"
            :aria-expanded="auditOpen">管网核验</button>
          <button @click="pointIndexOpen=!pointIndexOpen;auditOpen=false" :aria-expanded="pointIndexOpen">点位索引</button>
          <button @click="toggleRegionPanel" :disabled="busy">{{showRegionPanel?'关闭设备清单':'区域设备'}}</button>
          <a href="/tanggang/audit/cad-review/v2/index.html" target="_blank" rel="noopener">核查CAD</a>
          <button @click="help=!help" title="交互说明">?</button>
          </template>
        </div>
      </header>
      <div class="l1-filters" id="l1-tool-stack" v-if="!busy&&!failure&&toolsOpen" aria-label="六个业务子系统与专业图层">
        <template v-if="showFilters">
          <button class="l1-filter l1-system-tab" data-system="all" :class="{chosen:systemModeId==='all'}"
            :aria-pressed="systemModeId==='all'" @click="chooseSystem('all')">全场总览</button>
          <button v-for="(mode,index) in businessSystems" :key="mode.id"
            class="l1-filter l1-system-tab" :data-system="mode.id"
            :class="{chosen:systemModeId===mode.id}"
            :aria-pressed="systemModeId===mode.id" @click="chooseSystem(mode.id)">
            <i :style="{background:mode.accent}"></i>{{String(index+1).padStart(2,'0')}} {{mode.name}}
          </button>
        </template>
        <button class="l1-filter l1-fire-toggle" data-overlay="fire" :class="{chosen:showFireOverlay}"
          :aria-pressed="showFireOverlay" title="消防为独立专业图层，不属于六个业务子系统"
          @click="toggleFireLayer">消防专业叠加</button>
      </div>
      <div v-if="!busy&&!failure" class="l1-site-legend">
        <span>A侧8位 · B侧8位 <b>边线推算</b></span>
        <span>北池设计2座 / 南池设计5座 <b>轮廓待核</b></span>
        <button v-if="chainMarkerData?.markers.length" class="l1-chain-shortcut"
          data-cad-shortcut="chain-bucket" @click="openFloatingMark('TG-CHAIN-1058D8')">
          链斗冲洗池 <b>CAD文字已定位</b>
        </button>
      </div>
      <div v-if="continuityOpen&&continuityData" class="l1-continuity-panel"
        aria-label="CAD可见管线断口和疑似漏段逐项排查">
        <div class="l1-continuity-title">
          <strong>管线连续性核查</strong>
          <button @click="toggleContinuity" aria-label="关闭断点核查">×</button>
        </div>
        <p class="l1-continuity-warning">这些是二维几何疑点，不是已确认的水力断管。红色为接近但不相接；橙色为被排除CAD线索；紫色为孤立短段。</p>
        <div class="l1-continuity-summary">
          <div><b>{{continuityData.summary.nearVisibleGap}}</b><small>疑似断口端点</small></div>
          <div><b>{{continuityData.summary.hiddenSourceContinuation}}</b><small>疑似漏显后续</small></div>
          <div><b>{{continuityData.summary.shortIsolatedCandidateHandles}}</b><small>孤立短段</small></div>
        </div>
        <div class="l1-continuity-filters">
          <button v-for="opt in [{id:'visible_gap_candidate',name:'断口'},
            {id:'filtered_continuation_candidate',name:'筛掉线'},
            {id:'short_orphan_candidate',name:'孤立短管'},
            {id:'all',name:'全部'}]" :key="opt.id" :class="{chosen:continuityFilter===opt.id}"
            @click="changeContinuityFilter(opt.id)">{{opt.name}}</button>
        </div>
        <div class="l1-continuity-list">
          <button v-for="i in pageContinuity" :key="i.id"
            class="l1-continuity-item" :data-issue-id="i.id"
            :class="{chosen:selectedContinuity?.id===i.id}"
            @click="selectContinuityIssue(i)">
            <i :style="{background:continuityColors[i.kind]}"></i>
            <span><strong>{{i.layer.replace('$管综-','')}}</strong>
              <small>源{{i.handle}} <template v-if="i.relatedHandles.length"> / {{i.relatedHandles.join('、')}}</template></small>
            </span>
            <em v-if="i.gapDisplayUnits">{{i.gapDisplayUnits.toFixed(3)}}</em>
          </button>
        </div>
        <div class="l1-continuity-pages" v-if="continuityPageCount>1">
          <button @click="continuityPage=Math.max(0,continuityPage-1)" :disabled="continuityPage===0">上一页</button>
          <small>{{continuityPage+1}} / {{continuityPageCount}}</small>
          <button @click="continuityPage=Math.min(continuityPageCount-1,continuityPage+1)"
            :disabled="continuityPage===continuityPageCount-1">下一页</button>
        </div>
        <div v-if="selectedContinuity" class="l1-continuity-selected">
          <strong>{{continuityLabels[selectedContinuity.kind]}} · {{selectedContinuity.handle}}</strong>
          <p>{{selectedContinuity.reason}}</p>
          <p v-if="selectedContinuity.reviewOnlyGeometry&&!selectedContinuity.reviewOnlyGeometry.isApprovedPipeline">
            橙色虚线来自CAD源Handle {{selectedContinuity.reviewOnlyGeometry.handle}}，
            状态 {{selectedContinuity.reviewOnlyGeometry.status}}，只是核查线索，未加入正式管网。</p>
          <small>场景坐标：{{selectedContinuity.pointXZ.map(v=>v.toFixed(3)).join('，')}}</small>
        </div>
        <a href="/tanggang/cad/l1-v2_8/V2.8_高疑点位.csv" target="_blank" rel="noopener">导出129项疑点清单</a>
      </div>
      <div v-if="auditOpen&&pipeAudit" class="l1-pipe-audit" aria-label="管网几何显示与拓扑核验结果">
        <div class="l1-pipe-audit-head">
          <strong>管线显示与水力连通审计</strong>
          <button title="关闭管网审计" @click="auditOpen=false;refresh()">×</button>
        </div>
        <div class="l1-pipe-audit-summary">
          <div><small>人工分类批准展示</small><b>{{pipeAudit.totals.sourceApprovedForDisplay}}</b></div>
          <div><small>未批准展示/待复核</small><b>{{pipeAudit.totals.sourceNotApprovedForDisplay}}</b></div>
          <div><small>已确认水力连接</small><b>0</b></div>
        </div>
        <p>已批准的 {{pipeAudit.totals.sourceApprovedForDisplay}} 个源Handle均已渲染（{{pipeAudit.totals.sceneDisplayPieces}} 个几何片段）；这<strong>不代表全CAD管网完整</strong>，其余候选主要为符号、辅助线或待识别线，不可全部画成管道。</p>
        <div class="l1-pipe-audit-table">
          <div v-for="line in pipeAudit.counts" :key="line.layer">
            <span>{{line.layer.replace('$管综-','')}}</span>
            <span>{{line.displayedDistinctHandles}} / {{line.originalRawEntities}}</span>
          </div>
        </div>
        <p class="l1-pipe-audit-warning">设计规格书要求中压管网整体环状布置，但当前未核实三通、阀门、泵房接口和实际闭环路径。雨水、污水管也不应强行按环网理解。</p>
        <a href="/tanggang/cad/l1-v2_7/V2.7_管线图层覆盖统计.csv" target="_blank" rel="noopener">查看源CAD图层覆盖统计</a>
      </div>
      <div v-if="!busy && !failure" class="relief-controls" aria-label="场景显示">
        <button type="button" @click="changeView" :aria-pressed="solidMode" :disabled="continuityOpen||auditOpen">{{solidMode?'立体场景':'CAD 线稿'}} ⇄</button>
        <button type="button" @click="allLabels=!allLabels" v-if="solidMode" :aria-pressed="allLabels">{{allLabels?'全部标注':'主要标注'}}</button>
        <button v-if="solidMode" type="button" data-home-gray :aria-pressed="grayMode" @click="switchMaterial">全场灰模</button>
        <button v-if="solidMode" type="button" data-home-sample :data-model-loaded="galleryReady" :aria-pressed="sampleMode" @click="toggleSample">{{sampleMode?'返回全场':'局部样板'}}</button>
        <button v-if="sampleMode&&solidMode" type="button" data-open-gallery @click="studyOpen=true">廊架构造</button>
      </div>
      <GalleryStudy v-if="studyOpen && !busy && !failure" @close="studyOpen=false"/>
      <div v-if="solidMode && !busy && !failure" class="home-pipe-legend" aria-label="管线用途图例"><span v-for="p in pipeLegend" :key="p.layer" :class="{muted:p.name==='消防'&&!showFireOverlay}"><i :style="{background:p.color}"></i>{{p.name}}</span></div>
      <div v-if="busy" class="l1-message">正在加载原始 CAD 三维审查数据…</div>
      <div v-if="failure" class="l1-message l1-error">{{failure}}</div>
      <div v-if="help" class="l1-help">
        <p>立体场景按CAD位置显示料堆示意、候选水池、构筑物和作业通道。高度、外饰与料形仅供辨识。51、52泊位旁的船型是示意模型，不表示有船在泊。近看或选择全部标注可查看细项。</p>
        鼠标左键拖动：旋转　滚轮：缩放　右键拖动：平移
        <p>六系统切换只高亮对应的源CAD专业候选图元；低亮度管线为背景/设计参照。</p>
        <p>点击源管线只高亮该原图元，绝不自动推断真实连通。消防是独立叠加图层。</p>
        <p>“断点核查”显示基于源CAD几何的疑似漏接和短管，点击可聚焦；虚线只是未通过人工分类的原CAD候选，不会并入正式管道模型。</p>
        <p>链斗冲洗池原CAD文字Handle为1058D8，池体边界及中压供水、排水沟的真实接口均待核。</p>
        <p>已核实展示仅指人工批准的CAD源候选图元已渲染，不代表所有工程管网已识别。中压系统的环网要求尚未核实闭合。</p>
        <p>浮动堆场A/B两侧各8个位置是按原8个编号文字和边界推算，独立堆场身份待核。</p>
        <p>集水池蓝色轮廓来自原CAD“水池”图层的分段线拓扑构造，不可把轮廓数量当成设计池座数。</p>
        <p>指南针表示原CAD显示坐标所对应的北向参考，投影及实地真北待核。</p>
      </div>
      <div v-if="$props.showMarkers && markersVisible&&!busy&&!failure" class="l1-label-layer">
        <svg class="l1-float-stems" aria-hidden="true">
          <line v-for="label in labelItems" :key="label.id"
            :x1="label.pointX" :y1="label.pointY"
            :x2="label.x" :y2="label.y-12"
            stroke="rgba(46,105,134,.55)" stroke-width="1" />
        </svg>
        <button v-for="item in labelItems" :key="item.id" class="l1-label l1-float-label"
          :class="{yard:item.kind==='yardCandidate',pool:item.kind==='poolContour',
            poolGroup:item.kind==='poolGroup',chain:item.kind==='chainBucketWash',
            chosen:floatingDetail?.id===item.id}"
          :style="{left:item.x+'px',top:item.y+'px'}"
          :title="item.note" :data-point-id="item.id" @click="openFloatingMark(item.id)">
          <span class="l1-label-pulse"></span>{{item.name}}
        </button>
      </div>
      <div v-if="floatingDetail" class="l1-point-popover"
        :style="{left:Math.max(160,Math.min(floatingPopupPosition.x,root?.clientWidth ?root.clientWidth-160:1500))+'px',
          top:Math.max(190,Math.min(floatingPopupPosition.y-17,root?.clientHeight ?root.clientHeight-140:800))+'px'}">
        <div class="l1-point-popover-header"><b>{{floatingDetail.name}}</b>
          <button @click="floatingDetail=null" aria-label="关闭点位详情">×</button></div>
        <small>{{floatingDetail.status}}</small>
        <p>{{floatingDetail.note}}</p>
        <p class="l1-point-source">源CAD：{{floatingDetail.sourceHandle}}</p>
        <button v-if="floatingDetail.regionId&&availableRegions.some(r=>r.id===floatingDetail!.regionId)"
          class="l1-point-open" @click="showRegion(floatingDetail.regionId)">查看区域与设计设备</button>
      </div>
      <div v-if="pointIndexOpen" class="l1-point-index" aria-label="全部源CAD与候选点位索引">
        <div class="l1-point-index-head">
          <strong>堆场位置A/B各8 · 集水池几何候选 {{pointIndexCount.pools}}</strong>
          <button @click="pointIndexOpen=false" aria-label="关闭点位索引">×</button>
        </div>
        <div class="l1-point-index-links">
          <button v-for="mark in floatingMarks" :key="mark.id"
            :class="{yard:mark.kind==='yardCandidate',pool:mark.kind==='poolContour',
              chain:mark.kind==='chainBucketWash'}"
            @click="openFloatingMark(mark.id)">{{mark.name}}</button>
        </div>
        <small>索引包含不在当前镜头内或因窄屏避让而暂不显示的浮动标签；点击可查CAD来源。</small>
      </div>
      <RegionEquipmentOverlay v-if="showRegionPanel&&regions.length&&!detail&&!busy&&!failure"
        :regions="availableRegions" :selected-region-id="selectedRegionId"
        :nav-open="regionNavOpen"
        :system-name="sourceMode?.name||''"
        :system-intro="sourceMode?.intro||''"
        :system-disclaimer="sourceMode?.disclaimer||''"
        @select-region="showRegion" @toggle-nav="regionNavOpen=!regionNavOpen" />
      <div v-if="detail" class="l1-selection">
        <div class="l1-detail-top"><span>{{detail.type==='anchor'?'CAD文字定位':
          detail.type==='yardBand'?'原CAD堆场带状区域':
          detail.type==='matchedContour'?'闭合轮廓与文字匹配':'源管线候选图元'}}</span>
          <button title="关闭" @click="chooseEntry(null)">×</button></div>
        <strong>{{detail.type==='anchor'?detail.data.name:
          detail.type==='yardBand'?detail.data.yardAnchorLabels.join(' / '):
          detail.type==='matchedContour'?detail.data.labels.join(' / '):
          detail.data.layer.replace('$管综-','')}}</strong>
        <dl v-if="detail.type==='anchor'">
          <div><dt>原图Handle</dt><dd>{{detail.data.sourceHandle||'无'}}</dd></div>
          <div><dt>原图层</dt><dd>{{detail.data.sourceLayer}}</dd></div>
          <div><dt>原图文字</dt><dd>{{detail.data.sourceText}}</dd></div>
          <div><dt>CAD坐标</dt><dd>{{detail.data.sourceCADXY.map(v=>Math.round(v)).join(' / ')}}</dd></div>
          <div><dt>原图轮廓线索</dt><dd>{{sourceMatchesForAnchor(detail.data)}}</dd></div>
          <div><dt>模型状态</dt><dd>独立设施边界/身份待核</dd></div>
          <div><dt>水量/测点</dt><dd>未接入</dd></div>
        </dl>
        <dl v-else-if="detail.type==='yardBand'">
          <div><dt>候选区域</dt><dd>{{detail.data.id}}</dd></div>
          <div><dt>堆场标签</dt><dd>{{detail.data.yardAnchorLabels.join('、')}}</dd></div>
          <div><dt>源边界Handle</dt><dd>{{detail.data.sourceEdgeHandles.join(' / ')}}</dd></div>
          <div><dt>CAD图层</dt><dd>{{detail.data.sourceLayer}}</dd></div>
          <div><dt>侧边界</dt><dd>两条原图长线有证据</dd></div>
          <div><dt>内部青色长线</dt><dd>中压除尘管 {{detail.data.parallelInternalMiddlePressurePipeHandle}}</dd></div>
          <div><dt>端部封口</dt><dd>计算构造，未核实</dd></div>
          <div><dt>两座分界</dt><dd>未确认，不画假分割线</dd></div>
        </dl>
        <dl v-else-if="detail.type==='matchedContour'">
          <div><dt>源Handle</dt><dd>{{detail.data.handle}}</dd></div>
          <div><dt>源CAD图层</dt><dd>{{detail.data.sourceLayer}}</dd></div>
          <div><dt>CAD文字点</dt><dd>{{detail.data.labels.join('、')}}</dd></div>
          <div><dt>几何关联</dt><dd>原闭合面包围原文字点</dd></div>
          <div><dt>设施身份</dt><dd>尚未工程验收</dd></div>
          <div><dt>内部池体</dt><dd>尚未逐个核对</dd></div>
        </dl>
        <dl v-else>
          <div><dt>源图元</dt><dd>{{detail.data.handle}}</dd></div>
          <div><dt>原始图层</dt><dd>{{detail.data.layer}}</dd></div>
          <div><dt>原图起点</dt><dd>{{detail.data.originalCADPoint.join(' / ')}}</dd></div>
          <div><dt>连通关系</dt><dd>尚未工程验收</dd></div>
          <div><dt>阀门/设备</dt><dd>尚未匹配</dd></div>
          <div><dt>流量/压力</dt><dd>未接入</dd></div>
        </dl>
        <p>{{detail.type==='yardBand'||detail.type==='matchedContour'?detail.data.limitations:
          '当前为原CAD审查信息，不代表已完成物理管网或设施单体的建模验收。'}}</p>
        <div v-if="linkedRegions.length" class="l1-related-areas">
          <strong>对应区域（空间或专业关联，不代表水力连通）</strong>
          <button v-for="item in linkedRegions.slice(0,5)" :key="item.id" @click="showRegion(item.id)">
            {{item.name}} · {{item.devices.length}}类设计设备
          </button>
        </div>
        <a v-if="detail.type==='anchor'" :href="'/tanggang/audit/cad-review/index.html?focus='+detail.data.id.replace('TG-CAD-','')"
          target="_blank" rel="noopener">在二维CAD定位</a>
        <a v-else-if="detail.type==='pipe'" :href="'/tanggang/audit/cad-review/index.html?line='+detail.data.handle"
          target="_blank" rel="noopener">在二维CAD高亮源图元</a>
        <a v-else href="/tanggang/audit/cad-review/v2/index.html" target="_blank" rel="noopener">查看V2.2区域证据图</a>
      </div>
      <div v-if="regionLoadError&&!busy" class="l1-region-load-error">{{regionLoadError}}</div>

    </section>
  </div>
</template>

<style scoped>
.l1-scene {pointer-events:none}
.l1-zone {background:radial-gradient(ellipse 75% 83% at 52% 45%,#fafeff 5%,#e3f1fa 85%); pointer-events:auto}
.l1-view,.l1-webgl {position:absolute;inset:0;width:100%;height:100%}
.l1-view {z-index:0}
.l1-hud {position:absolute;z-index:4;top:17px;left:20px;right:20px;display:flex;align-items:start;justify-content:space-between;gap:12px;pointer-events:none}
.l1-hud h2 {font-size:20px;color:#2a5671;margin:6px 0 3px;font-weight:760}
.l1-hud p {font-size:10px;color:#7594a8;line-height:1.5}
.l1-eyebrow {display:flex;align-items:center;gap:8px;font-size:10px;font-weight:750;letter-spacing:1.05px;color:#448b9d}
.l1-eyebrow i {width:6px;height:6px;border-radius:50%;background:#27babb;box-shadow:0 0 0 4px #38bbcb20}
.l1-eyebrow span {font-size:9px;background:#e7f8fb;border-radius:4px;padding:3px 6px;color:#3b9bab}
.l1-actions {display:flex;align-items:center;gap:6px;pointer-events:auto}
.l1-actions a,.l1-actions button {padding:8px 9px;border-radius:9px;border:1px solid #dcebf3;background:#fffc;font-size:11px;color:#498099;white-space:nowrap}
.l1-actions :is(a,button):hover {background:#fff;color:#207f9f;border-color:#add8e7}
.l1-filters {position:absolute;top:101px;left:20px;right:20px;display:flex;gap:6px;align-items:center;overflow-x:auto;z-index:4}
.l1-filter {display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:17px;border:1px solid #e1edf3;background:#ffffffd9;color:#6b8497;font-size:10px;white-space:nowrap}
.l1-filter i {width:7px;height:7px;border-radius:50%}
.l1-filter.chosen,.l1-filter:hover {border-color:#79c7de;background:#fff;color:#287f9c}
.l1-count {margin-left:auto;font-size:10px;color:#809baa;white-space:nowrap;background:#ffffffca;padding:6px 9px;border-radius:12px}
.l1-label-layer {position:absolute;inset:0;z-index:2;pointer-events:none}
.l1-label {position:absolute;pointer-events:auto;transform:translate(-50%,-130%);padding:4px 7px;font-size:10px;font-weight:660;white-space:nowrap;background:#ffffffed;border:1px solid #d8e9f1;border-left:3px solid #3a9cbc;color:#4a6b7e;box-shadow:0 4px 12px #5591a423;border-radius:6px}
.l1-label.yard {border-left-color:#d8a656;color:#916e36;background:#fffaf2f0}
.l1-label:hover {background:#fff;border-color:#4dacc8;z-index:4}
.l1-selection {position:absolute;z-index:5;right:17px;top:141px;width:288px;border-radius:14px;background:linear-gradient(140deg,#fffefdf2,#ecf8fdf4);padding:14px 16px;box-shadow:0 8px 28px #5c8bad36;border:1px solid #fff;color:#486b81;backdrop-filter:blur(13px)}
.l1-detail-top {display:flex;align-items:center;justify-content:space-between;font-size:10px;color:#358fa8;letter-spacing:.5px;font-weight:720}
.l1-detail-top button {font-size:21px;color:#7e9fb1}
.l1-selection strong {font-size:16px;display:block;color:#315671;margin:7px 0 11px}
.l1-selection dl {display:grid;gap:6px}
.l1-selection dl>div {display:flex;justify-content:space-between;align-items:start;gap:8px;border-bottom:1px solid #ddebf3;padding-bottom:4px}
.l1-selection dt,.l1-selection dd {font-size:10px;line-height:1.6}
.l1-selection dt {flex:none;color:#809cad}.l1-selection dd {text-align:right;margin:0;color:#526d81;max-width:190px;overflow-wrap:anywhere}
.l1-selection p {margin:9px 0;font-size:10px;color:#8c9caa;line-height:1.5}
.l1-selection a {display:inline-block;font-size:10px;padding:6px 9px;background:#e5f5fc;border:1px solid #add9e7;border-radius:6px;color:#3285a0}
.l1-message {position:absolute;z-index:5;top:50%;left:50%;transform:translate(-50%,-50%);padding:12px 20px;border-radius:11px;background:#ffffffdc;color:#5a8095;font-size:12px}
.l1-error {color:#ac5d62}
.l1-help {position:absolute;z-index:6;top:62px;right:19px;font-size:10px;line-height:1.9;padding:12px;border-radius:11px;background:#fffc;border:1px solid #d2e9f1;color:#587d91;box-shadow:0 7px 19px #5288a020}
.l1-footer {position:absolute;z-index:4;bottom:11px;left:18px;right:18px;display:flex;justify-content:space-between;align-items:center;gap:16px;pointer-events:none;font-size:10px;color:#668da4}
.l1-footer b {color:#169cb7;letter-spacing:1px}
.l1-footer em {font-style:normal;color:#b18075}
</style>

<style scoped>
.l1-boundarybar {position:absolute;z-index:4;bottom:43px;left:20px;right:20px;
 display:flex;align-items:center;gap:5px;overflow-x:auto;white-space:nowrap;scrollbar-width:thin}
.l1-boundarybar>span {font-size:10px;font-weight:680;color:#936f46;padding:5px 5px;background:#ffffffcc;border-radius:6px}
.l1-boundarybar .l1-boundary-split {margin-left:8px;color:#4b8ea0}
.l1-boundarybar button {flex:none;padding:7px 9px;font-size:10px;color:#986c3b;
 background:#fff7e6e0;border:1px solid #e6d5b2;border-radius:9px}
.l1-boundarybar button.selected,.l1-boundarybar button:hover{background:#fff;border-color:#2daac5;color:#2f829b}
.l1-boundarybar .l1-boundary-split~button{background:#edf7fbda;border-color:#cde6ef;color:#4a8d9c}
</style>

<style scoped>
.l1-related-areas{background:#f4fbfd;border:1px solid #d6eaf1;border-radius:9px;padding:9px;margin:10px 0}
.l1-related-areas strong{font-size:10px;color:#537f93;display:block;line-height:1.5;margin-bottom:6px}
.l1-related-areas button{display:block;width:100%;background:#fff;border:1px solid #e1eff4;text-align:left;padding:7px;border-radius:6px;margin:4px 0;cursor:pointer;color:#448fa6;font-size:10px}
.l1-related-areas button:hover{background:#e4f7fc}
.l1-region-load-error{position:absolute;left:18px;bottom:70px;color:#b57769;background:#fff;border-radius:8px;padding:8px;font-size:10px;z-index:5}
.l1-selection{max-height:calc(100% - 203px);overflow-y:auto}
</style>

<style scoped>
.l1-system-tab{height:31px;padding:0 10px;font-weight:650;font-size:10px;gap:5px;border-color:#cfdfe9;background:#fffffff2;transition:background .16s,border-color .16s}
.l1-system-tab.chosen{background:#dff5fb;border-color:#64b5c9;color:#216d87;box-shadow:0 3px 8px #5da5be1e}
.l1-fire-toggle{height:31px;padding:0 10px;border:1px dashed #d5aa9d;background:#fff9f7;color:#a97368;font-size:10px;white-space:nowrap;flex:none}
.l1-fire-toggle.chosen{background:#fde8e2;border-color:#c98978;color:#9d4e3a}
.l1-system-evidence{position:absolute;top:129px;left:16px;z-index:3;display:flex;gap:7px;align-items:center;
 max-width:calc(100% - 34px);pointer-events:none;background:#fffffff0;border:1px solid #e0ebf1;border-radius:9px;
 color:#63869a;padding:5px 8px;font-size:9px;box-shadow:0 3px 12px #5d96a219}
.l1-mode-label{color:#1d879f;font-weight:770}
.l1-evidence-warning{color:#a78f78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(min-width:950px){
 .l1-region-navigator{top:167px}
 .l1-system-evidence{top:133px}
 .l1-selection{top:169px!important}
}
@media(max-width:949px){
 .l1-system-evidence{top:137px;left:12px;max-width:calc(100% - 24px)}
}
@media(max-width:650px){
 .l1-system-evidence{top:161px;left:10px;max-width:calc(100% - 20px);font-size:9px}
}
</style>

<style scoped>
/* V2.6: minimal chrome, map first */
.l1-hud{right:109px;top:11px;align-items:flex-start}
.l1-hud h2{font-size:20px;white-space:nowrap}
.l1-hud p{max-width:440px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.l1-eyebrow{font-size:9px}
.l1-actions{gap:5px;flex-wrap:wrap;max-width:42%;justify-content:flex-end}
.l1-filters{top:92px}
.l1-compass{position:absolute;z-index:9;top:13px;right:14px;width:82px;height:89px;
 border:1px solid #cfe7ef;border-radius:16px;background:linear-gradient(145deg,#fffefaee,#eaf9fdf5);
 box-shadow:0 5px 18px #6c9eb630;display:flex;align-items:center;justify-content:center;flex-direction:column;
 color:#377b93;cursor:pointer;backdrop-filter:blur(12px)}
.l1-compass-dial{position:relative;display:flex;align-items:center;flex-direction:column;justify-content:center;
 width:54px;height:54px;border:1px solid #cae3ea;border-radius:50%;background:radial-gradient(#fff,#eaf6fb);
 box-shadow:inset 0 1px 3px #cfe4eb;transition:transform .08s linear}
.l1-compass-n{position:absolute;top:2px;color:#bd765f;font-size:11px;font-weight:850}
.l1-compass-arrow{position:absolute;top:17px;color:#e08e71;font-size:17px;line-height:1}
.l1-compass-s{position:absolute;bottom:2px;font-size:9px;font-weight:650;color:#7796a4}
.l1-compass-caption{font-size:9px;margin-top:5px;color:#7b99a9}
.l1-site-legend{position:absolute;top:134px;left:17px;z-index:4;display:flex;align-items:center;gap:8px;
 max-width:calc(100% - 35px);white-space:nowrap;overflow-x:auto;scrollbar-width:none;pointer-events:none}
.l1-site-legend>span{display:inline-flex;gap:6px;align-items:center;border:1px solid #dceaf1;background:#ffffffd9;
 font-size:10px;padding:4px 7px;border-radius:9px;color:#497c90}
.l1-site-legend b{color:#ad8f6e;font-size:9px;font-weight:550}
.l1-float-stems{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.l1-float-label{transform:translate(-50%,-100%);display:flex;align-items:center;gap:5px;
 padding:5px 9px 5px 7px;border:1px solid #dbe8ee;border-left:2px solid #4a9dba;
 border-radius:8px;background:#fffffff2;backdrop-filter:blur(8px);font-size:11px;font-weight:640;
 color:#1d4f66;letter-spacing:.2px;
 box-shadow:0 5px 14px #3f7f9726,0 1px 0 #fff inset}
.l1-float-label.yard{background:#1e3d61eb;border-color:#2b4b71;border-left-color:#57a7c2;color:#f4f8fc}
.l1-float-label.yard .l1-label-pulse{background:#8fd4e6;box-shadow:0 0 0 3px #8fd4e636}
.l1-float-label.pool{background:#e9faffed;border-left-color:#1f9bb7;color:#357a99}
.l1-float-label.poolGroup{background:#d7f6ff;border-color:#6cbcd1;color:#247c93;font-weight:820}
.l1-float-label.chosen,.l1-float-label:hover{background:#fff;box-shadow:0 0 0 2px #67c1d56e,0 7px 20px #398fa339;z-index:10}
.l1-label-pulse{width:6px;height:6px;flex:none;border-radius:50%;background:#4eabc0;box-shadow:0 0 0 3px #4eabc025}
.l1-float-label.yard .l1-label-pulse{background:#d6a55d;box-shadow:0 0 0 3px #dfb27429}
.l1-point-popover{position:absolute;z-index:9;width:290px;max-width:calc(100% - 20px);
 transform:translate(-50%,-100%);padding:12px 13px;border-radius:13px;
 background:linear-gradient(135deg,#fffffff7,#e8f8fdf7);border:1px solid #c5e2ec;
 box-shadow:0 8px 28px #5b97ac40;backdrop-filter:blur(15px)}
.l1-point-popover-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
.l1-point-popover-header b{font-size:13px;color:#296d84}
.l1-point-popover-header button{font-size:19px;color:#829da9;cursor:pointer}
.l1-point-popover small{color:#ab8652;font-size:10px}
.l1-point-popover p{font-size:10px;color:#67899a;line-height:1.65;margin:7px 0}
.l1-point-popover .l1-point-source{color:#8b9ca9;overflow-wrap:anywhere}
.l1-point-open{border-radius:8px;background:#e0f5fa;color:#267e98;border:1px solid #aed6e4;font-size:10px;padding:7px 9px;cursor:pointer}
@media(max-width:949px){
 .l1-compass{top:9px;right:10px;width:66px;height:76px;border-radius:12px}
 .l1-compass-dial{width:45px;height:45px}
 .l1-compass-caption{font-size:8px}
 .l1-hud{right:83px;top:10px}
 .l1-site-legend{top:149px;left:10px}
 .l1-float-label{font-size:9px;padding:3px 5px}
}
@media(max-width:650px){
 .l1-hud h2{font-size:14px}
 .l1-hud p{display:none}
 .l1-hud{right:80px;left:10px}
 .l1-actions{max-width:100%;justify-content:flex-start}
 .l1-eyebrow span{display:none}
 .l1-site-legend{top:164px;gap:4px}
 .l1-site-legend>span{font-size:9px;padding:3px 5px}
 .l1-point-popover{width:min(285px,calc(100vw - 35px))}
}
</style>

<style scoped>
.l1-point-index{position:absolute;bottom:18px;left:14px;right:14px;z-index:8;
 border:1px solid #c9e6ee;background:#ffffffee;border-radius:13px;box-shadow:0 5px 22px #7eafc332;
 padding:8px 11px;backdrop-filter:blur(15px)}
.l1-point-index-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
 font-size:11px;color:#3c7f97;margin-bottom:6px}
.l1-point-index-head button{font-size:18px;color:#759cae;cursor:pointer}
.l1-point-index-links{display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin;padding:3px 1px 9px}
.l1-point-index-links button{flex:none;border:1px solid #daebf0;color:#467f93;background:#f5fbfe;
 font-size:10px;padding:6px 9px;border-radius:10px;cursor:pointer}
.l1-point-index-links button.yard{background:#fff6e9;border-color:#ecd4aa;color:#9e7642}
.l1-point-index-links button.pool{background:#e8f8fd;border-color:#a8dbeb;color:#3a8da5}
.l1-point-index>small{font-size:9px;color:#99acb5;line-height:1.6;display:block}
@media(max-width:650px){.l1-point-index{bottom:7px;left:8px;right:8px;padding:7px}.l1-point-index-head{font-size:10px}}
</style>

<style scoped>
.l1-chain-shortcut{display:inline-flex;align-items:center;gap:7px;padding:5px 8px;
 border:1px solid #80d5c6;border-radius:10px;background:#e7faf6ef;color:#207f79;
 font-size:10px;cursor:pointer;pointer-events:auto;white-space:nowrap}
.l1-chain-shortcut b{color:#639c93;font-size:9px;font-weight:500}
.l1-float-label.chain{background:#dffbf3ef;border:1px solid #71c8b5;border-left:3px solid #2b9a83;
 color:#28786d;font-weight:760;box-shadow:0 3px 14px #399b8c35}
.l1-float-label.chain .l1-label-pulse{background:#32b19b;box-shadow:0 0 0 3px #57cdbc35}
.l1-point-index-links button.chain{background:#e0f8f2;border-color:#79c9b9;color:#267f72;font-weight:760}
.l1-pipe-audit{position:absolute;right:16px;top:155px;width:340px;max-width:calc(100% - 32px);
 max-height:calc(100% - 184px);overflow-y:auto;z-index:8;padding:12px 13px;border-radius:13px;
 background:linear-gradient(130deg,#ffffffef,#effafff4);border:1px solid #c8dfe8;
 color:#527c8f;backdrop-filter:blur(15px);box-shadow:0 8px 25px #6b9eae35}
.l1-pipe-audit-head{display:flex;align-items:center;justify-content:space-between;gap:9px}
.l1-pipe-audit-head strong{font-size:13px;color:#28758d}
.l1-pipe-audit-head button{font-size:18px;color:#7c9dad}
.l1-pipe-audit-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:10px 0}
.l1-pipe-audit-summary>div{padding:7px;background:#edf9fc;border:1px solid #d5edf3;border-radius:8px}
.l1-pipe-audit-summary small{font-size:9px;line-height:1.4;color:#829eab;display:block}
.l1-pipe-audit-summary b{display:block;font-size:17px;color:#338198;margin-top:5px}
.l1-pipe-audit>p{font-size:10px;line-height:1.7;margin:8px 0;color:#678c9e}
.l1-pipe-audit>p strong{color:#aa775d}
.l1-pipe-audit-table{display:grid;gap:5px}
.l1-pipe-audit-table>div{display:flex;justify-content:space-between;gap:8px;padding:6px;
 border-radius:7px;background:#fff;border:1px solid #e1eef3;font-size:10px}
.l1-pipe-audit-table>div span:first-child{overflow-wrap:anywhere}
.l1-pipe-audit-table>div span:last-child{color:#2c899d;white-space:nowrap}
.l1-pipe-audit .l1-pipe-audit-warning{color:#9b6e61;background:#fff7f0;padding:7px;border-radius:7px}
.l1-pipe-audit>a{display:inline-block;font-size:10px;color:#398da6}
@media(max-width:650px){.l1-chain-shortcut{font-size:9px;padding:3px 5px}.l1-chain-shortcut b{display:none}
.l1-pipe-audit{top:173px;right:8px;max-height:calc(100% - 195px)}}
</style>

<style scoped>
.l1-actions button.active{border-color:#e9a5a0;color:#ae5656;background:#ffefec}
.l1-continuity-panel{position:absolute;right:15px;top:155px;bottom:15px;z-index:12;
 width:355px;max-width:calc(100% - 30px);border:1px solid #cbdce6;
 background:linear-gradient(145deg,#ffffffef,#edf8fbfa);backdrop-filter:blur(16px);
 box-shadow:0 8px 35px #4d8fa532;border-radius:13px;padding:12px;display:flex;flex-direction:column;gap:9px}
.l1-continuity-title{display:flex;align-items:center;justify-content:space-between}
.l1-continuity-title strong{color:#336b85;font-size:13px}
.l1-continuity-title button{font-size:21px;color:#759cac}
.l1-continuity-warning{background:#fff7ec;color:#9b7857;border-radius:8px;
 padding:7px;font-size:10px;line-height:1.55}
.l1-continuity-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.l1-continuity-summary div{padding:7px 5px;background:#f4fbff;border:1px solid #dcecf5;border-radius:8px}
.l1-continuity-summary b{color:#327e96;font-size:17px;display:block;text-align:center}
.l1-continuity-summary small{color:#8297a8;font-size:9px;display:block;text-align:center}
.l1-continuity-filters{display:flex;gap:4px}
.l1-continuity-filters button{flex:1;border:1px solid #d6e7ed;border-radius:7px;
 padding:6px 2px;font-size:10px;color:#688fa0;background:#f9fcfd}
.l1-continuity-filters button.chosen{background:#dff2f8;color:#2b7d96;border-color:#99cedd}
.l1-continuity-list{flex:1;min-height:50px;overflow:auto;display:flex;flex-direction:column;gap:4px;
 scrollbar-width:thin}
.l1-continuity-item{border:1px solid #e0eaf0;background:#fff;display:flex;gap:8px;align-items:center;
 padding:8px 7px;border-radius:9px;text-align:left;cursor:pointer}
.l1-continuity-item.chosen{background:#e6f7fb;border-color:#6bb4c7}
.l1-continuity-item i{flex:none;width:8px;height:8px;border-radius:50%}
.l1-continuity-item span{flex:1;min-width:0}
.l1-continuity-item strong{display:block;color:#497b8d;font-size:10px}
.l1-continuity-item small{display:block;color:#8da7b1;font-size:9px;overflow-wrap:anywhere;margin-top:3px}
.l1-continuity-item em{font-size:10px;font-style:normal;color:#c45f5d}
.l1-continuity-selected{border:1px solid #d3e5ea;background:#fff;border-radius:9px;padding:9px}
.l1-continuity-selected strong{font-size:10px;color:#327d92}
.l1-continuity-selected p{font-size:9px;line-height:1.6;color:#718b9b;margin:5px 0}
.l1-continuity-selected small{font-size:9px;color:#9baab2}
.l1-continuity-panel>a{color:#3688a0;font-size:10px}
.l1-continuity-pages{display:flex;align-items:center;justify-content:center;gap:15px}
.l1-continuity-pages button{font-size:10px;color:#367b95}
.l1-continuity-pages button:disabled{opacity:.4}
.l1-continuity-pages small{font-size:10px;color:#8ba0ae}
@media(max-width:650px){
 .l1-continuity-panel{top:175px;bottom:10px;right:8px;left:8px;width:auto;max-width:none}
}
</style>

<style scoped>
.relief-controls{position:absolute;bottom:14px;left:16px;z-index:5;display:flex;align-items:center;gap:3px;padding:4px;background:#f8fbfcf2;border:1px solid #cedbdc;border-radius:9px;box-shadow:0 3px 14px #243a4817;pointer-events:auto}
.relief-controls button{min-height:30px;padding:0 9px;border-radius:6px;font-size:11px;color:#3b5d65}
.relief-controls button:first-child{background:#24525c;color:white}
.relief-controls small{font-size:10px;color:#657b80;padding:0 6px}
@media(max-width:600px){.relief-controls{left:8px;bottom:8px}.relief-controls small{font-size:9px}.relief-controls button{padding:0 7px}}
</style>

<style scoped>
.home-pipe-legend{position:absolute;z-index:4;right:14px;bottom:14px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:9px 12px;background:#f9fcffed;border:1px solid #d4e1e9;border-radius:8px;color:#29465b;font-size:11px;box-shadow:0 3px 12px #283d5215}
.home-pipe-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.home-pipe-legend i{width:18px;height:4px;border-radius:3px}.home-pipe-legend .muted{opacity:.39}
.relief-controls button[aria-pressed="true"]{background:#245978;color:white}
@media(max-width:950px){.home-pipe-legend{max-width:55%;gap:3px 8px;font-size:10px}}
@media(max-width:640px){.home-pipe-legend{bottom:49px;left:8px;right:auto;max-width:calc(100% - 16px);padding:5px 7px}.home-pipe-legend i{width:11px}}
</style>

<style src="./styles/scene-shell.css"></style>

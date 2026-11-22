<script setup lang="ts">
import { defineAsyncComponent, computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RegionEquipmentOverlay from './RegionEquipmentOverlay.vue'
import type { SiteRegion, RegionPayload } from './types/regions'
import * as THREE from 'three'
import { landmarks, landmarksSource, lakeDisplayOffset } from './harborLandmarks'
import { buildHarborRelief } from './harborRelief'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

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
import { useRouter } from 'vue-router'

const router = useRouter()
// 帧耗采样放在模块级对象上，避免 SFC 编译重命名局部数组后验收函数读到旧作用域。
const perfLog={frames:[] as number[]}

const root = ref<HTMLDivElement | null>(null)
const busy = ref(true)
const failure = ref('')
const activeSystem = ref('全部')
const businessSystems = ref<BusinessSystem[]>([])
const systemModeId = ref('all')
const firePreferenceKey = 'tanggang.dashboard.fire-overlay'
function readFirePreference() {
  try { return localStorage.getItem(firePreferenceKey) === 'on' }
  catch { return false }
}
const showFireOverlay = ref(readFirePreference())
const fireAccessories = new THREE.Group()
fireAccessories.name = '消防管线附件与底图'
const sourceMode = computed(() => businessSystems.value.find(s=>s.id===systemModeId.value) || null)
const focusedPipeLayerSet = computed(() => new Set(sourceMode.value?.focusPipeLayers || []))
const referencePipeLayerSet = computed(() => new Set(sourceMode.value?.referencePipeLayers || []))
const firePipeLayers = ['$管综-室外消防','$管综-室内消防']
// —— 七类管网图例：唯一有效图层集合 ——
// 总览保存用户勾选；切入工艺按主层/参照层初始化；独显临时覆盖；恢复默认一步复位。
const legendLayers = pipeLegend.map(p=>p.layer)
const allLayersOn = ()=>Object.fromEntries(legendLayers.map(layer=>[layer,true])) as Record<string,boolean>
const layerVisible = ref<Record<string,boolean>>(allLayersOn())
const soloLayer = ref<string|null>(null)
const overviewLayerSnapshot = ref<Record<string,boolean>|null>(null)
const VIEW_STATE_KEY = 'tanggang.dashboard.view.v2'
const legendIsFire = (layer:string)=>firePipeLayers.includes(layer)
function layerEnabled(layer:string){
  if(soloLayer.value){
    if(legendIsFire(soloLayer.value))return legendIsFire(layer)&&showFireOverlay.value
    return layer===soloLayer.value
  }
  if(legendIsFire(layer))return showFireOverlay.value
  return layerVisible.value[layer]!==false
}
function legendOn(layer:string){return layerEnabled(layer)}
function isSoloLayer(layer:string){
  if(!soloLayer.value)return false
  if(legendIsFire(soloLayer.value))return legendIsFire(layer)
  return soloLayer.value===layer
}
function toggleLayer(layer:string){
  if(legendIsFire(layer)){toggleFireLayer();return}
  if(soloLayer.value){
    // 独显中点同一项 = 退出独显；点其他项 = 退出独显并切换该项。
    if(isSoloLayer(layer)){soloLayer.value=null}
    else{
      soloLayer.value=null
      const next=layerVisible.value[layer]===false
      layerVisible.value={...layerVisible.value,[layer]:next}
    }
  } else {
    const next=layerVisible.value[layer]===false
    layerVisible.value={...layerVisible.value,[layer]:next}
  }
  syncDetailWithLayers()
  refresh()
}
function soloLegend(layer:string){
  soloLayer.value=isSoloLayer(layer)?null:layer
  if(legendIsFire(layer)&&!showFireOverlay.value){
    showFireOverlay.value=true
    try{localStorage.setItem(firePreferenceKey,'on')}catch{/* 当前标签页仍保留选择 */}
  }
  syncDetailWithLayers()
  refresh()
}
function resetLegend(){
  soloLayer.value=null
  layerVisible.value=allLayersOn()
  showFireOverlay.value=readFirePreference()
  syncDetailWithLayers()
  refresh()
}
function applySystemLegend(mode:BusinessSystem|null,fromOverview=false){
  soloLayer.value=null
  if(!mode){
    layerVisible.value=overviewLayerSnapshot.value?{...overviewLayerSnapshot.value}:allLayersOn()
    return
  }
  if(fromOverview)overviewLayerSnapshot.value={...layerVisible.value}
  const focus=new Set(mode.focusPipeLayers||[]),ref=new Set(mode.referencePipeLayers||[])
  layerVisible.value=Object.fromEntries(legendLayers.map(layer=>[layer,focus.has(layer)||ref.has(layer)]))
}
function syncDetailWithLayers(){
  if(detail.value?.type==='pipe'&&!layerEnabled(detail.value.data.layer))detail.value=null
}
const legendStatus = computed(()=>{
  if(!sourceMode.value&&!soloLayer.value&&legendLayers.every(layer=>!layerEnabled(layer)))
    return '已隐藏全部管网；建筑、道路与绿化保留，可逐项恢复或点“恢复默认”'
  if(!sourceMode.value)return soloLayer.value?'独显中 · 再次点击“独”退出':'点击图例可多选显示；右侧“独”为单类独显'
  if(!sourceMode.value.focusPipeLayers.length&&!sourceMode.value.referencePipeLayers.length)
    return '该系统无已核专属管线，重点在水务设施区域'
  return `${soloLayer.value?'独显中':'已按系统主层与参照层初始化'} · 站内可继续勾选`
})
const processRoute = computed(()=>sourceMode.value&&systemModeId.value!=='all'?`/port/process/${sourceMode.value.id}`:'')
function openProcess(){
  if(!processRoute.value)return
  persistViewState()
  void router.push(processRoute.value)
}
function persistViewState(){
  if(!camera||!orbit)return
  try{
    sessionStorage.setItem(VIEW_STATE_KEY,JSON.stringify({
      system:systemModeId.value,layers:layerVisible.value,solo:soloLayer.value,
      flow:flowToggle.value,fire:showFireOverlay.value,
      camera:{pos:camera.position.toArray(),target:orbit.target.toArray(),fov:camera.fov},
    }))
  }catch{/* 存储不可用不影响当前视图 */}
}
function readViewState():{system?:string;layers?:Record<string,boolean>;solo?:string|null;flow?:boolean;fire?:boolean;camera?:{pos:number[];target:number[];fov?:number}}|null{
  try{return JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY)||'null')}catch{return null}
}
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
// 统一对象详情的运营口径：先给设施名称、关联工艺、最多三项核心指标与数据状态，
// CAD handle、底图版本与位置精度收进“定位依据”，不在首屏堆工程字段。
const detailName = computed(()=>{
  const d=detail.value
  if(!d)return ''
  if(d.type==='anchor')return d.data.name
  if(d.type==='yardBand')return d.data.yardAnchorLabels.join(' / ')||d.data.id
  if(d.type==='matchedContour')return d.data.labels.join(' / ')||d.data.handle
  return d.data.layer.replace('$管综-','')
})
const detailKindLabel = computed(()=>{
  const d=detail.value
  if(!d)return ''
  if(d.type==='anchor')return '水务设施'
  if(d.type==='yardBand')return '堆场区域'
  if(d.type==='matchedContour')return '池体轮廓候选'
  return '输水管段'
})
const detailSystemLabel = computed(()=>sourceMode.value?.name||'全场总览')
const detailKpis = computed<[string,string][]>(()=>{
  const d=detail.value
  if(!d)return []
  if(d.type==='anchor'){
    const n=d.data.name
    if(n.includes('洗车'))return [['今日车辆','未接入'],['当日用水量','未接入'],['最近采样','未接入']]
    if(n.includes('集水')||n.includes('湖')||n.includes('蓄水'))return [['当前液位','未接入'],['进水流量','未接入'],['最近采样','未接入']]
    if(n.includes('污水')||n.includes('处理'))return [['进出水量','未接入'],['运行状态','未接入'],['最近采样','未接入']]
    return [['运行状态','未接入'],['关联测点','未接入'],['最近采样','未接入']]
  }
  if(d.type==='pipe')return [['管线用途',d.data.layer.replace('$管综-','')],['关联测点','未接入'],['流量 / 压力','未接入']]
  return [['区域身份','按原图候选'],['监测测点','未接入'],['最近采样','未接入']]
})
const floatingKpis = computed<[string,string][]>(()=>{
  const mark=floatingDetail.value
  if(!mark)return []
  const n=mark.name
  if(n.includes('洗车'))return [['今日车辆','未接入'],['当日用水量','未接入'],['最近采样','未接入']]
  if(n.includes('池')||n.includes('湖')||n.includes('蓄水'))return [['当前液位','未接入'],['进出水量','未接入'],['最近采样','未接入']]
  return [['运行状态','未接入'],['关联测点','未接入'],['最近采样','未接入']]
})
const floatingNote = computed(()=>{
  const mark=floatingDetail.value
  if(!mark)return ''
  const n=mark.name
  if(n.includes('洗车'))return '洗车台区按原图定位；车辆计数与用水量由厂家设备接入后显示，不从模型车辆推算。'
  if(n.includes('湖'))return '人工湖作为调蓄关联对象；当前无液位与补水实测，容量以审查资料为准。'
  if(n.includes('集水'))return '集水池位置按设计口径表达；液位、提升泵状态待接入后显示。'
  if(n.includes('泊位'))return '泊位用于查看码头用水与作业关联；港机数量不从船舶模型反推。'
  return '设施按原图锚点定位；运营读数与测点状态待接入。'
})
// 选中工艺时高亮该系统的区域锚点标牌；不改变相机与几何位置。
const focusAnchorIds = computed(()=>{
  const ids=new Set<string>()
  const mode=sourceMode.value
  if(!mode)return ids
  for(const item of mode.areaEquipment){
    const region=regions.value.find(r=>r.id===item.regionId)
    if(!region)continue
    region.anchorIds.forEach(id=>ids.add(id))
    region.contourHandles.forEach(handle=>ids.add(handle))
  }
  return ids
})

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
// 真实 HDR 天空加载成功后，Canvas 天空退为回退方案。
let hdrSky: THREE.Texture | null = null
// 水面平面反射：半分辨率 RTT + 镜像相机；相机静止时复用上一帧结果。
let reflectionRT: THREE.WebGLRenderTarget | null = null
let reflectionCamera: THREE.PerspectiveCamera | null = null
let reflectionSignature = ''
let reflectionFrames = 0
let composer: EffectComposer | null = null
let renderPass: RenderPass | null = null
const _reflOrigin = new THREE.Vector3()
const _reflCamPos = new THREE.Vector3()
const _reflView = new THREE.Vector3()
const _reflNormal = new THREE.Vector3(0,1,0)
const _reflRotation = new THREE.Matrix4()
const _reflLookAt = new THREE.Vector3()
const _reflTarget = new THREE.Vector3()
const _reflPlane = new THREE.Plane()
const _reflClip = new THREE.Vector4()
const _reflQ = new THREE.Vector4()
// 流带共享时钟：所有管段材质引用同一 uniform，停流时冻结相位、管身保持可见。
const flowClock = { value: 0 }
// 演示主管：$管综-中压除尘 源Handle 139320，6 点折线、约 98.9 单位、含三处转弯。
// 仅作可读性演示，不声明水力方向或已核实连接。
const DEMO_PIPE_HANDLE = '139320'
const flowToggle = ref(true)
// 演示管段所在的源图层；切换系统时仅当该图层在关注范围内才继续流动。
const DEMO_PIPE_LAYER = '$管综-中压除尘'
// 洗车台开敞棚平面范围（CAD 文字 TG-CAD-13 / FAE1D）。只做展示裁剪，不改源折线：
// 起点落在棚下时从北侧棚边开始表现，避免管线穿过棚架；其余走向保持 CAD 原线。
const WASH_FOOTPRINT = { x0: -49.8, x1: -41.2, z0: -12.5, z1: -0.1 }
function pipeDisplayPoints(pipe: CadLine): [number, number][] {
  const points = pipe.displayPoints
  if (pipe.handle !== DEMO_PIPE_HANDLE || points.length < 2) return points
  const [[ax, az], [bx, bz]] = points
  const { x0, x1, z0, z1 } = WASH_FOOTPRINT
  if (ax <= x0 || ax >= x1 || az <= z0 || az >= z1 || bz <= z1) return points
  const exitX = ax + (bx - ax) * (z1 - az) / (bz - az)
  if (exitX < x0 || exitX > x1) return points
  return [[exitX, z1 + .05], ...points.slice(1)]
}
const demoLayerFocused = computed(()=>!sourceMode.value||focusedPipeLayerSet.value.has(DEMO_PIPE_LAYER))
const flowStatusText = computed(()=>!flowToggle.value?'已停流':demoLayerFocused.value?'运行中':'不在当前系统')
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
/**
 * 工业管身材质 + 沿路径累计弧长的窄水纹流带。
 * - 顶点属性 aFlow = (本段起点里程, 本段带符号长度)，连续折线共享里程，转弯自然通过；
 * - aFlowOn 按实例切换是否显示流带，停流时只冻结时钟，管身质感保留；
 * - 所有管段共用一个时钟 uniform，不逐帧重建几何、不新增全场透明叠层。
 */
function pipeTint(layer:string){
  return new THREE.Color(systemColors[layer]||'#4ca5c5').lerp(new THREE.Color('#c6d3d6'),.06)
}
function createFlowPipeMaterial(){
  const uniforms={
    uFlowTime:flowClock,
    uFlowSpeed:{value:5.6},
    uFlowPeriod:{value:16},
    uFlowWidth:{value:5.4},
    uFlowColor:{value:new THREE.Color('#22d9ff')},
  }
  const mat=new THREE.MeshStandardMaterial({
    color:'#ffffff',roughness:.50,metalness:.10,emissive:'#0d2430',emissiveIntensity:.05,
  })
  mat.envMapIntensity=.5
  mat.userData.flowUniforms=uniforms
  mat.onBeforeCompile=(shader)=>{
    shader.uniforms.uFlowTime=uniforms.uFlowTime
    shader.uniforms.uFlowSpeed=uniforms.uFlowSpeed
    shader.uniforms.uFlowPeriod=uniforms.uFlowPeriod
    shader.uniforms.uFlowWidth=uniforms.uFlowWidth
    shader.uniforms.uFlowColor=uniforms.uFlowColor
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nattribute float aFlow;\nattribute float aFlowOn;\nvarying vec2 vFlow;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvFlow=vec2(aFlow,aFlowOn);')
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform float uFlowTime;\nuniform float uFlowSpeed;\nuniform float uFlowPeriod;\nuniform float uFlowWidth;\nuniform vec3 uFlowColor;\nvarying vec2 vFlow;')
      .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nif(vFlow.y>0.5){\n  float phase=mod(vFlow.x-uFlowTime*uFlowSpeed,uFlowPeriod);\n  float u=phase/uFlowPeriod;\n  float core=smoothstep(0.02,0.05,u)*(1.0-smoothstep(0.30,0.36,u));\n  float trail=(1.0-smoothstep(0.36,0.55,u))*0.5;\n  totalEmissiveRadiance+=uFlowColor*(core*1.9+trail);\n}')
  }
  mat.customProgramCacheKey=()=> 'tanggang-flow-pipe-v1'
  return mat
}
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
    for (const fireLayer of [false,true]) {
      const points=data.issues.filter(i=>i.kind===kind && firePipeLayers.includes(i.layer)===fireLayer)
      if(!points.length)continue
      const geo=new THREE.SphereGeometry(.28,10,8)
      const mat=new THREE.MeshBasicMaterial({color:continuityColors[kind],transparent:true,
        opacity:.87,depthTest:false})
      const cloud=new THREE.InstancedMesh(geo,mat,points.length)
      cloud.userData.fireLayer = fireLayer
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
  fireAccessories.visible = showFireOverlay.value && layerEnabled('$管综-室外消防')
  for (const cloud of continuityDebugGroup.children) {
    cloud.visible = !cloud.userData.fireLayer || showFireOverlay.value
  }
  const issue = selectedContinuity.value
  continuitySelectionGroup.visible = continuityOpen.value && (!issue || !firePipeLayers.includes(issue.layer) || showFireOverlay.value)
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
    const fire=legendIsFire(batch.layer)
    const enabled=layerEnabled(batch.layer)
    // 图例勾选是唯一显隐依据：隐藏即不渲染、不拾取、不保留漂浮阀门。
    // 工艺模式只提高主层对比、降低参照层，不再偷偷显示未勾选图层。
    const opacity=continuityOpen.value
      ?(selectedContinuity.value?(selectedContinuity.value.layer===batch.layer?1:0.26):0.85)
      :enabled?((focus||fire)?1:(reference?0.55:1)):0
    batch.mesh.visible = enabled
    batch.mesh.userData.selectable = enabled
    const material=batch.mesh.material as THREE.MeshStandardMaterial
    material.transparent=opacity<1
    material.opacity=opacity
    material.depthWrite=opacity>.5
    material.emissiveIntensity=(focus||fire)?0.55:0.28
    material.needsUpdate=true
    // 流带只跟随演示主管 139320 的顶点：默认批次里其余管段保持静态，
    // 选中系统时仅在演示层被关注且该层可见时继续流动。
    const layerFocused=!sourceMode.value||focusedPipeLayerSet.value.has(batch.layer)
    const flowActive=flowToggle.value&&!grayMode.value&&!!batch.demo&&layerFocused&&enabled
    if(batch.onAttr&&batch.flowBase){
      const values=batch.onAttr.array as Float32Array
      let changed=false
      for(let i=0;i<values.length;i++){
        const next=flowActive?batch.flowBase[i]:0
        if(values[i]!==next){values[i]=next;changed=true}
      }
      if(changed)batch.onAttr.needsUpdate=true
    }
    // 单段选中由下方仅覆盖该折线的亮色叠层表达；不整批改材质颜色，
    // 否则同一批次里的其他管段会一起变色。
    material.color.copy(batch.mesh.userData.baseColor as THREE.Color)
  }
  disposeHighlights()
  if(detail.value?.type==='pipe' && layerEnabled(detail.value.data.layer)) {
    const selected=detail.value.data
    const points=pipeDisplayPoints(selected)
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
function toggleFlow(){
  flowToggle.value=!flowToggle.value
  refresh()
}
function chooseSystem(next: string) {
  if(next!=='all' && !businessSystems.value.some(s=>s.id===next))return
  sampleMode.value=false
  const fromOverview=systemModeId.value==='all'
  systemModeId.value=next
  const mode=businessSystems.value.find(s=>s.id===next)
  applySystemLegend(mode??null,fromOverview)
  activeSystem.value='全部'
  selectedRegionId.value=mode?.primaryRegionId||'REG-YARD'
  showRegionPanel.value=false
  floatingDetail.value=null
  detail.value=null
  refresh()
  // 系统切换只改变管网高亮与标注，不改动已对齐的默认机位；避免近距重构图导致主体偏离。
  if(!mode)resetCameraPosition()
}
function toggleFireLayer(){
  showFireOverlay.value = !showFireOverlay.value
  try { localStorage.setItem(firePreferenceKey, showFireOverlay.value ? 'on' : 'off') }
  catch { /* The current tab still retains the selection. */ }
  if (!showFireOverlay.value && detail.value?.type === 'pipe' && firePipeLayers.includes(detail.value.data.layer)) {
    detail.value = null
  }
  refresh()
}
function focusByAnchorIds(ids:string[],distance=62){
  if(!camera||!orbit||!current)return
  const anchors=ids.map(id=>current!.anchors.find(a=>a.id===id)).filter((a):a is CadAnchor=>!!a)
  if(!anchors.length)return
  const x=anchors.reduce((v,a)=>v+a.x,0)/anchors.length
  const z=anchors.reduce((v,a)=>v+a.z,0)/anchors.length
  const target=at(x,z,0)
  // 系统聚焦保持俯视航拍：沿用默认偏航，抬高俯角，避免近距时地平线占满画面。
  const pitch=THREE.MathUtils.degToRad(34)
  const dir=new THREE.Vector3(0,Math.sin(pitch),Math.cos(pitch))
  orbit.target.copy(target)
  setFieldOfView(30)
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
    camera.up.set(0,1,0)
    // 内部核查机位：?focus=north|west|south|east|center 平移取景但不改变默认视角参数；
    // ?zoom=0.35 仅用于近距核对模型，不写入正式界面。
    const focusParam=new URLSearchParams(location.search).get('focus')
    const focusPresets:Record<string,[number,number]>={north:[0,41],south:[-6,-45],west:[-45,-4],east:[34,-20],center:[-12,4],nw:[-33,37],ne:[28,26],lake:[34,-41]}
    if(focusParam&&focusPresets[focusParam]){
      setFieldOfView(26)
      const pitch=THREE.MathUtils.degToRad(52)
      const dir=new THREE.Vector3(0,Math.sin(pitch),Math.cos(pitch))
      const zoom=Number(new URLSearchParams(location.search).get('zoom'))||1
      const [fx,fz]=focusPresets[focusParam]
      const centre=new THREE.Vector3(fx,0,-fz)
      orbit.target.copy(centre)
      camera.position.copy(centre).addScaledVector(dir,180*zoom)
      orbit.update();return
    }
    // 1672×941 的水务首页由堆场四角、洗车台、人工湖和岸线共同标定。
    // 取景仅改变相机。较窄桌面退后，为东西两侧设施和船体保留空间。
    // ?cam=pitch,dist,fov,targetZ 仅用于同机位对版校准，不改变正式界面。
    const camOverride=new URLSearchParams(location.search).get('cam')
    const cam=camOverride?camOverride.split(',').map(Number):[]
    const pitch=THREE.MathUtils.degToRad(Number.isFinite(cam[0])?cam[0]:30)
    const dir=new THREE.Vector3(0,Math.sin(pitch),Math.cos(pitch))
    const centre=new THREE.Vector3(-1.2,0,Number.isFinite(cam[3])?cam[3]:-4)
    setFieldOfView(Number.isFinite(cam[2])?cam[2]:32)
    const distance=(Number.isFinite(cam[1])?cam[1]:170)*Math.max(1,(1672/941)/aspect)
    orbit.target.copy(centre);camera.position.copy(centre).addScaledVector(dir,distance)
    orbit.update();return
  }
  setFieldOfView(36)
  if(sampleMode.value){
    const target=at(-4,-40,1.05)
    orbit.target.copy(target)
    camera.position.copy(target).addScaledVector(new THREE.Vector3(.40,.79,1).normalize(),aspect<1?81:49)
    orbit.update();return
  }
  const dir=new THREE.Vector3(.19,aspect<.85?.94:.52,1).normalize()
  const right=new THREE.Vector3(dir.z,0,-dir.x).normalize()
  const vertical=new THREE.Vector3().crossVectors(dir,right)
  const centre=new THREE.Vector3(-4,0,-8)
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2))
  let distance=0
  for(const x of [-47,46])for(const z of [-48,68]){
    const p=new THREE.Vector3(x,1,z).sub(centre),depth=p.dot(dir)
    distance=Math.max(distance,depth+Math.abs(p.dot(right))/(tan*aspect*.95),
      depth+Math.abs(p.dot(vertical))/(tan*(aspect<.85?.77:.88)))
  }
  orbit.target.copy(centre)
  camera.position.copy(centre).addScaledVector(dir,distance*1.18)
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
// 东侧两处水务设施在总览低俯角被前景建筑/设备遮挡，从厂区内侧查看实体。
function inspectEastFacility(mark:FloatingMark){
  if(!camera||!orbit||!relief)return
  const box=new THREE.Box3()
  for(const part of relief.picks){
    if(part.userData.pointId===mark.id)box.expandByObject(part)
  }
  if(box.isEmpty())return
  const target=box.getCenter(new THREE.Vector3())
  const span=box.getSize(new THREE.Vector3()).length()
  const distance=Math.max(orbit.minDistance+2,span*3)
  const dir=new THREE.Vector3(.3,1,-.65).normalize()
  floatingDetail.value=null
  setFieldOfView(31)
  orbit.target.copy(target)
  camera.position.copy(target).addScaledVector(dir,distance)
  orbit.update()
  refresh()
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
    const target=at(mark.labelX??mark.x,mark.labelZ??mark.z,0)
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
  // 南池分组标牌：池体表现位置贴靠堆场南缘，引线落在池组中线上；CAD 文字点保留追溯。
  const southPoolLabel={x:-13.27,z:-42.6}
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
      labelX:a.id==='TG-CAD-10'?southPoolLabel.x:undefined,
      labelZ:a.id==='TG-CAD-10'?southPoolLabel.z:undefined,
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
    // 人工湖：表现湖体在文字点东侧；引线落到可见湖岸，源文字点仍用于追溯。
    labelX:f.kind==='lake'?f.x+lakeDisplayOffset.x:undefined,
    labelZ:f.kind==='lake'?f.z+lakeDisplayOffset.z:undefined,
    regionId:'',sourceHandle:f.handle,
    note:f.evidence||('原图层 '+f.layer+'。坐标取文字插入点，三维外观与高度为示意。'),
    status:f.evidenceLevel==='contour_matched'&&f.footprintHandle?'CAD文字已定位 · 轮廓已匹配':'CAD文字已定位 · 轮廓待核'
  }))
  // 同名“生态蓄水池”两处文字点：首页只保留一条标牌，来源记录并列，避免重复标牌。
  const eco=[...extra,...marks,...additions].filter(m=>m.name==='生态蓄水池')
  const ecoKeep=eco.find(m=>m.id==='TG-CAD-14')||eco[0]
  if(ecoKeep){
    ecoKeep.sourceHandle=[...new Set(eco.map(m=>m.sourceHandle))].join(' / ')
    ecoKeep.note=eco.map(m=>m.note).filter(Boolean).join(' ')
    ecoKeep.status='两处CAD文字同名 · 池体轮廓待核'
  }
  floatingMarks.value=[...extra,...marks,...additions].filter(m=>m.name!=='生态蓄水池'||m===ecoKeep)
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
    // 单座集水池保留模型与详情来源，首页由“北池设计2座/南池设计5座”分组标牌统一表达。
    if(m.name==='集水池'&&m.id.startsWith('HOME-'))return false
    const mode=sourceMode.value
    if(solidMode.value && !allLabels.value && !mode && camera && orbit &&
       camera.position.distanceTo(orbit.target)>105){
      if(m.kind==='poolContour')return false
      if(m.kind==='yardCandidate')return w>=1200
      const key=['TG-CHAIN-1058D8','TG-CAD-09','TG-CAD-10','TG-CAD-11','TG-CAD-12','TG-CAD-13','TG-CAD-14','TG-CAD-19','TG-CAD-20']
      return key.includes(m.id)||['HOME-1028AB','HOME-F9BEE','HOME-8D367','HOME-F9BFB','TG-CAD-15','TG-CAD-16'].includes(m.id)
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
    :w>=1000&&!toolsOpen.value?112:157
  for(const mark of [...marks].sort((a,b)=>priority(a)-priority(b))){
    // 手机窄屏只保留能读懂场地的少数标牌，避免标牌互相压盖。
    if(w<560&&!(mark.kind==='yardCandidate'&&/^(8#|1#)/.test(mark.name))
      &&!/人工湖|集水池|洗车台|链斗冲洗池|智慧中心|维修车间|办公楼/.test(mark.name))continue
    // Yard labels sit on the visual middle of the stockpile (reference y≈444), not on the
    // northern A-side text anchor. The CAD anchor itself is unchanged.
    const labelZ=mark.kind==='yardCandidate'?mark.z-27:(mark.labelZ??mark.z)
    const clip=at(mark.labelX??mark.x,labelZ,solidMode.value && mark.kind==='yardCandidate'?3.3:mark.kind==='poolContour'?1.2:1).project(camera)
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
    // 人工湖水面小：标牌上移，避免小尺寸湖面被标牌完全盖住。
    const lakeChip=mark.id==='HOME-1028AB'
    const baseOffsets:number[][]=lakeChip
      ? [[0,-46],[0,-68],[-56,-46],[56,-46],[-96,-40],[96,-40],[0,-90]]
      : berthBelow
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
function drawLinework(items: CadLine[], color:string, h:number,opacity:number, parent: THREE.Object3D | null = scene) {
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
  parent?.add(obj);outlineMeshes.push(obj)
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
  scene.add(fireAccessories)
  drawLinework(auxiliaries.filter(line=>line.layer!=='消防给水管道'),'#b6cdd6',.105,.5)
  drawLinework(auxiliaries.filter(line=>line.layer==='消防给水管道'),'#b6cdd6',.105,.5,fireAccessories)
  // Pipe candidate geometry: no automatic joining of intersections or assigning engineering elevations.
  type PipeEnd={a:THREE.Vector3,b:THREE.Vector3,ref:CadLine,start:number,len:number}
  const grouped=new Map<string,{system:string,layer:string,edges:CadLine[],ends:PipeEnd[]}>()
  for(const item of data.lines.filter(a=>a.role==='pipe')) {
    let batch=grouped.get(item.layer)
    if(!batch){batch={system:item.system,layer:item.layer,edges:[],ends:[]};grouped.set(item.layer,batch)}
    const y=displayLevel(item.layer)
    const pts=pipeDisplayPoints(item).map(([x,z])=>at(x,z,y))
    // 同一条源折线共享累计弧长，直段、短节与转弯逐一衔接，不跨独立支路拼接。
    let arc=0
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],len=a.distanceTo(b)
      if(len<.02 || len>180)continue
      batch.ends.push({a,b,ref:item,start:arc,len})
      batch.edges.push(item)
      arc+=len
    }
  }
  const jointGeo=new THREE.SphereGeometry(1,8,6)
  const flangeGeo=new THREE.TorusGeometry(1,.26,5,10)
  const jointMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.44,metalness:.48})
  const flangeMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.50,metalness:.42})
  materialsToDispose.push(jointMat,flangeMat)
  geometriesToDispose.push(jointGeo,flangeGeo)
  const jointQ=new THREE.Quaternion()
  // 一条源折线合并为一份带 aFlow 顶点属性的几何：直段共享累计里程、转弯自然通过。
  // 每层仍只有一个管身 draw call，不逐段建材质，也不逐帧重建。
  const tubeTemplate=new THREE.CylinderGeometry(1,1,1,8,1,true)
  const tPos=tubeTemplate.attributes.position, tNor=tubeTemplate.attributes.normal
  const tUv=tubeTemplate.attributes.uv, tIdx=tubeTemplate.index!
  const mtx=new THREE.Matrix4(), nmat=new THREE.Matrix3()
  const v3=new THREE.Vector3(), n3=new THREE.Vector3()
  for(const batch of grouped.values()) {
    if(!batch.ends.length)continue
    // 业务配色压暗并去饱和，管身读作工业涂装，不再像高饱和折线。
    const tint=pipeTint(batch.layer)
    const mat=createFlowPipeMaterial()
    mat.color.copy(tint)
    // 自发光跟随本层业务色：阴天 IBL 下管身不再被环境光洗成浅灰蓝。
    mat.emissive.copy(tint)
    // P4：管径整体加粗，默认机位下橙/绿/蓝/红管线成为与道路同级的视觉线索。
    const radius=batch.layer.includes('中压')?.36:batch.layer.includes('消防')?.24:.28
    const positions:number[]=[],normals:number[]=[],uvs:number[]=[],flowValues:number[]=[],onValues:number[]=[],pickValues:number[]=[],indices:number[]=[]
    let vertexBase=0
    const joints:THREE.Vector3[]=[]
    const flanges:{p:THREE.Vector3,q:THREE.Quaternion}[]=[]
    for(let i=0;i<batch.ends.length;i++){
      const edge=batch.ends[i],v=edge.b.clone().sub(edge.a)
      const len=v.length()
      tmp.position.copy(edge.a).add(edge.b).multiplyScalar(.5)
      tmp.quaternion.setFromUnitVectors(up,v.clone().normalize())
      tmp.scale.set(radius,len,radius)
      tmp.updateMatrix()
      mtx.copy(tmp.matrix);nmat.getNormalMatrix(mtx)
      const signed=edge.ref.handle===DEMO_PIPE_HANDLE?1:-1
      for(let k=0;k<tPos.count;k++){
        v3.fromBufferAttribute(tPos,k).applyMatrix4(mtx)
        positions.push(v3.x,v3.y,v3.z)
        n3.fromBufferAttribute(tNor,k).applyMatrix3(nmat).normalize()
        normals.push(n3.x,n3.y,n3.z)
        uvs.push(tUv.getX(k),tUv.getY(k))
        // 沿轴局部坐标生成相位；同折线各段共享起点里程，接口处连续。
        flowValues.push(edge.start+signed*edge.len*(tPos.getY(k)+.5))
        onValues.push(edge.ref.handle===DEMO_PIPE_HANDLE?1:0)
        pickValues.push(i)
      }
      for(let k=0;k<tIdx.count;k++)indices.push(vertexBase+tIdx.getX(k))
      vertexBase+=tPos.count
      // 接口/弯头：每条折线的端部与内部顶点各加一个可见接头球。
      if(i===0||batch.ends[i-1].ref!==edge.ref)joints.push(edge.a.clone())
      if(i===batch.ends.length-1||batch.ends[i+1].ref!==edge.ref)joints.push(edge.b.clone())
      // 法兰：长段两端与沿线等距布置，默认机位能读出管段而不是一根光管。
      if(len>2.2){
        const dir=v.clone().normalize()
        const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),dir)
        flanges.push({p:edge.a.clone().addScaledVector(dir,.22),q})
        flanges.push({p:edge.b.clone().addScaledVector(dir,-.22),q})
        for(let d=11.5;d<len-4.2;d+=11.5)flanges.push({p:edge.a.clone().addScaledVector(dir,d),q})
      }
    }
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3))
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
    geo.setAttribute('aFlow',new THREE.Float32BufferAttribute(flowValues,1))
    geo.setAttribute('aFlowOn',new THREE.Float32BufferAttribute(onValues,1))
    // 拾取反查：面顶点上的 aPick 指向原折线段序号，保持单段 CAD 源Handle 可选。
    geo.setAttribute('aPick',new THREE.Float32BufferAttribute(pickValues,1))
    geo.setIndex(indices)
    geo.computeBoundingSphere()
    geometriesToDispose.push(geo)
    const mesh=new THREE.Mesh(geo,mat)
    mesh.name=batch.layer
    mesh.castShadow=true
    mesh.receiveShadow=true
    mesh.userData.pick='pipe'
    mesh.userData.batchIndex=batches.length
    mesh.userData.baseColor=tint.clone()
    scene.add(mesh);pickObjects.push(mesh)
    const fittingParent = firePipeLayers.includes(batch.layer) ? fireAccessories : scene
    const jointMesh=joints.length?new THREE.InstancedMesh(jointGeo,jointMat,joints.length):null
    if(jointMesh){
      joints.forEach((p,i)=>{
        jointQ.identity()
        tmp.position.copy(p);tmp.quaternion.copy(jointQ);tmp.scale.setScalar(radius*1.06);tmp.updateMatrix()
        jointMesh.setMatrixAt(i,tmp.matrix);jointMesh.setColorAt(i,tint)
      })
      jointMesh.instanceMatrix.needsUpdate=true
      if(jointMesh.instanceColor)jointMesh.instanceColor.needsUpdate=true
      jointMesh.computeBoundingSphere();jointMesh.castShadow=true;jointMesh.receiveShadow=true
      fittingParent.add(jointMesh)
    }
    const flangeMesh=flanges.length?new THREE.InstancedMesh(flangeGeo,flangeMat,flanges.length):null
    if(flangeMesh){
      const flangeTint=tint.clone().lerp(new THREE.Color('#d7dedb'),.20)
      flanges.forEach((f,i)=>{
        tmp.position.copy(f.p);tmp.quaternion.copy(f.q);tmp.scale.setScalar(radius*1.22);tmp.updateMatrix()
        flangeMesh.setMatrixAt(i,tmp.matrix);flangeMesh.setColorAt(i,flangeTint)
      })
      flangeMesh.instanceMatrix.needsUpdate=true
      if(flangeMesh.instanceColor)flangeMesh.instanceColor.needsUpdate=true
      flangeMesh.computeBoundingSphere();flangeMesh.castShadow=false
      fittingParent.add(flangeMesh)
    }
    batches.push({mesh,edges:batch.edges,layer:batch.layer,system:batch.system,
      flowAttr:geo.getAttribute('aFlow') as THREE.BufferAttribute,
      onAttr:geo.getAttribute('aFlowOn') as THREE.BufferAttribute,
      flowBase:new Float32Array(onValues),
      demo:batch.edges.some(e=>e.handle===DEMO_PIPE_HANDLE)})
    materialsToDispose.push(mat)
  }
  // Pipe supports under the elevated CAD traces. Presentation furniture only: they
  // express that the drawn pipes are physical, not that any segment is hydraulically verified.
  {
    type Support = {x:number;z:number;y:number}
    const waterSupports=new Map<string,Support>()
    const fireSupports=new Map<string,Support>()
    for(const batch of grouped.values()){
      const supportMap = firePipeLayers.includes(batch.layer) ? fireSupports : waterSupports
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
    // A support shared with another service stays visible when fire pipes are hidden.
    for (const key of waterSupports.keys()) fireSupports.delete(key)
    for (const [supportMap, parent] of [[waterSupports, scene], [fireSupports, fireAccessories]] as const) {
      if (!supportMap.size) continue
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
      parent.add(mesh)
      geometriesToDispose.push(geo);materialsToDispose.push(mat)
    }
  }
  // 流带已在管身材质内按实例弧长绘制；不再生成独立流动点或全场透明叠层。
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
  let first=hits[0]
  if(!first)return
  // 细管贴着设施表面掠过时，射线后方 2.5 显示单位内的实体优先，避免
  // “点设施却选中穿行管线”的错配；明显在前方的管线仍按管线选中。
  if(first.object.userData.pick==='pipe'){
    const solid=hits.find(h=>h.object.userData.pick!=='pipe'&&h.distance-first.distance<2.5)
    if(solid)first=solid
  }
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
  if(first.object===markerMesh){
    if(first.instanceId===undefined)return
    const a=current.anchors[first.instanceId]
    if(a)openAreaForAnchor(a.id)
    return
  }
  if(first.object.userData.pick==='pipe'&&first.face){
    const batch=batches[Number(first.object.userData.batchIndex)]
    const pickAttr=(first.object as THREE.Mesh).geometry.getAttribute('aPick')
    const segment=pickAttr?Math.round(pickAttr.getX(first.face.a)):0
    const line=batch?.edges[segment]
    if(line)chooseEntry({type:'pipe',data:line})
  }
}
function onDown(e:PointerEvent){lastPointer=[e.clientX,e.clientY]}
function onUp(e:PointerEvent){selectByCanvas(e);lastPointer=null}
// —— 水面平面反射 ——
// 半分辨率 RTT + 以海平面镜像的相机；相机静止时直接复用上一帧结果。
function initWaterReflection(){
  if(!renderer||!relief)return
  const size=new THREE.Vector2()
  renderer.getDrawingBufferSize(size)
  const scale=window.innerWidth<900?.5:.72
  const w=Math.max(256,Math.floor(size.x*scale)),h=Math.max(256,Math.floor(size.y*scale))
  reflectionRT=new THREE.WebGLRenderTarget(w,h,{type:THREE.HalfFloatType,depthBuffer:true})
  reflectionRT.texture.minFilter=THREE.LinearFilter
  reflectionRT.texture.magFilter=THREE.LinearFilter
  reflectionRT.texture.generateMipmaps=false
  reflectionCamera=new THREE.PerspectiveCamera(camera?.fov??34,camera?.aspect??1,camera?.near??.1,camera?.far??1500)
  relief.seaMaterial.uniforms.uReflection.value=reflectionRT.texture
  relief.seaMaterial.uniforms.uHasReflection.value=0
  // 后处理管线在渲染目标里是线性空间；雾色需与陆域材质一致，避免海面过白。
  if(composer)(relief.seaMaterial.uniforms.uFogColor.value as THREE.Color).set('#d5e5e5')
  reflectionSignature='';reflectionFrames=0
}
function resizeWaterReflection(){
  if(!reflectionRT||!renderer)return
  const size=new THREE.Vector2();renderer.getDrawingBufferSize(size)
  const scale=window.innerWidth<900?.5:.72
  reflectionRT.setSize(Math.max(256,Math.floor(size.x*scale)),Math.max(256,Math.floor(size.y*scale)))
  reflectionFrames=0
}
function updateWaterReflection(cam:THREE.PerspectiveCamera){
  if(!reflectionRT||!reflectionCamera||!renderer||!scene||!relief)return
  const rc=reflectionCamera,level=relief.waterLevel
  _reflOrigin.set(0,level,0)
  cam.getWorldPosition(_reflCamPos)
  _reflView.subVectors(_reflOrigin,_reflCamPos)
  if(_reflView.dot(_reflNormal)>0)return
  _reflView.reflect(_reflNormal).negate().add(_reflOrigin)
  _reflRotation.extractRotation(cam.matrixWorld)
  _reflLookAt.set(0,0,-1).applyMatrix4(_reflRotation).add(_reflCamPos)
  _reflTarget.subVectors(_reflOrigin,_reflLookAt).reflect(_reflNormal).negate().add(_reflOrigin)
  rc.position.copy(_reflView)
  rc.up.set(0,1,0).applyMatrix4(_reflRotation).reflect(_reflNormal)
  rc.lookAt(_reflTarget)
  rc.near=cam.near;rc.far=cam.far;rc.fov=cam.fov;rc.aspect=cam.aspect
  rc.updateMatrixWorld()
  rc.projectionMatrix.copy(cam.projectionMatrix)
  const texMat=relief.seaMaterial.uniforms.uReflectMatrix.value as THREE.Matrix4
  texMat.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1)
  texMat.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse)
  // 斜裁剪：把水面以下的几何排除在反射之外。
  _reflPlane.setFromNormalAndCoplanarPoint(_reflNormal,_reflOrigin)
  _reflPlane.applyMatrix4(rc.matrixWorldInverse)
  _reflClip.set(_reflPlane.normal.x,_reflPlane.normal.y,_reflPlane.normal.z,_reflPlane.constant)
  const p=rc.projectionMatrix
  _reflQ.x=(Math.sign(_reflClip.x)+p.elements[8])/p.elements[0]
  _reflQ.y=(Math.sign(_reflClip.y)+p.elements[9])/p.elements[5]
  _reflQ.z=-1
  _reflQ.w=(1+p.elements[10])/p.elements[14]
  _reflClip.multiplyScalar(2/_reflClip.dot(_reflQ))
  p.elements[2]=_reflClip.x;p.elements[6]=_reflClip.y
  p.elements[10]=_reflClip.z+1;p.elements[14]=_reflClip.w
  for(const mesh of relief.waterMeshes)mesh.visible=false
  const prev=renderer.getRenderTarget()
  renderer.setRenderTarget(reflectionRT)
  renderer.clear()
  renderer.render(scene,rc)
  renderer.setRenderTarget(prev)
  for(const mesh of relief.waterMeshes)mesh.visible=true
  relief.seaMaterial.uniforms.uHasReflection.value=1
  reflectionFrames++
}
function maybeUpdateWaterReflection(cam:THREE.PerspectiveCamera){
  if(!reflectionRT)return
  const sig=cam.position.toArray().map(v=>v.toFixed(3)).join(',')
    +cam.quaternion.toArray().map(v=>v.toFixed(4)).join(',')
  const moving=sig!==reflectionSignature
  // 相机移动时逐帧刷新；静止后复用上一帧，水面动态由 shader 波纹承担。
  if(!moving&&reflectionFrames>8)return
  reflectionSignature=sig
  updateWaterReflection(cam)
}
function setup() {
  if(!root.value)return
  const el=root.value
  scene=new THREE.Scene()
  camera=new THREE.PerspectiveCamera(34,Math.max(el.clientWidth,1)/Math.max(el.clientHeight,1),.1,1500)
  camera.position.set(72,92,116)
  renderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'default'})
  // Bound WebGL framebuffer area on Retina/4K to avoid memory spikes.
  const initialW=Math.max(el.clientWidth,1),initialH=Math.max(el.clientHeight,1)
  const displayPixelRatio=(w:number,h:number)=>Math.min(window.devicePixelRatio||1,1.55,
    Math.max(.85,Math.sqrt(13_000_000/Math.max(1,w*h))))
  renderer.setPixelRatio(displayPixelRatio(initialW,initialH))
  renderer.setSize(initialW,initialH,false)
  renderer.outputColorSpace=THREE.SRGBColorSpace
  renderer.toneMapping=THREE.NeutralToneMapping
  renderer.toneMappingExposure=1.10
  renderer.shadowMap.enabled=true
  renderer.shadowMap.type=THREE.PCFSoftShadowMap
  // 后处理每 pass 都会重置 renderer.info；改为手动按帧重置，才能统计整帧批次。
  renderer.info.autoReset=false
  // 桌面端后处理：Bloom 收住高光、SMAA 补回抗锯齿、OutputPass 统一色调映射与 sRGB。
  if(initialW>=900&&initialW/initialH>=1.08){
    composer=new EffectComposer(renderer)
    renderPass=new RenderPass(scene,camera)
    composer.addPass(renderPass)
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(initialW,initialH),.10,.5,.95))
    composer.addPass(new OutputPass())
    // 调色：轻微降饱和与暗角，保留设计图的青蓝水色与管线饱和度。
    composer.addPass(new ShaderPass({
      uniforms:{tDiffuse:{value:null},uSat:{value:.97},uContrast:{value:1.0},
        uTint:{value:new THREE.Vector3(.99,1.0,1.012)},uVignette:{value:.30}},
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform sampler2D tDiffuse;uniform float uSat,uContrast,uVignette;uniform vec3 uTint;varying vec2 vUv;
        void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float l=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(l),c,uSat);c=(c-.5)*uContrast+.5;c*=uTint;
        float v=smoothstep(.95,.32,length(vUv-.5));c=mix(c,c*(.88+.12*v),uVignette);
        gl_FragColor=vec4(clamp(c,0.,1.),1.);}`
    }))
    // 类型声明仍按旧签名要求宽高，运行时已是无参构造。
    composer.addPass(new (SMAAPass as unknown as { new(): SMAAPass })())
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(initialW,initialH)
  }
  // Daylight sky: equirectangular canvas used as both background and IBL source.
  // It describes atmosphere only; it is not survey or meteorological data.
  const sky=document.createElement('canvas')
  sky.width=2048;sky.height=1024
  const ctx=sky.getContext('2d')
  if(ctx){
    const H=sky.height,W=sky.width,hz=H/2
    // 上半球：天顶深蓝 → 中层天蓝 → 地平线暖白薄雾；地平线严格落在等距柱状图的 H/2。
    const grad=ctx.createLinearGradient(0,0,0,hz)
    grad.addColorStop(0,'#1e5f9e');grad.addColorStop(.45,'#4e93c8')
    grad.addColorStop(.80,'#9cc4da');grad.addColorStop(.90,'#a8c9dc')
    grad.addColorStop(.985,'#cbdde3');grad.addColorStop(1,'#dde9e9')
    ctx.fillStyle=grad;ctx.fillRect(0,0,W,hz)
    // 下半球：海雾与海面反照，参与 IBL，避免天空球下半部纯白。
    const seaGrad=ctx.createLinearGradient(0,hz,0,H)
    seaGrad.addColorStop(0,'#cbdcd8');seaGrad.addColorStop(.35,'#8fa9a8');seaGrad.addColorStop(1,'#557580')
    ctx.fillStyle=seaGrad;ctx.fillRect(0,hz,W,H-hz)
    // 太阳与大气光晕：方向与主光 (64,104,44) 对齐。
    const sunX=.596*W,sunY=(1-.793)*H
    const halo=ctx.createRadialGradient(sunX,sunY,0,sunX,sunY,300)
    halo.addColorStop(0,'rgba(255,252,238,.98)');halo.addColorStop(.10,'rgba(255,247,220,.80)')
    halo.addColorStop(.32,'rgba(255,240,206,.30)');halo.addColorStop(1,'rgba(255,236,206,0)')
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(sunX,sunY,300,0,Math.PI*2);ctx.fill()
    ctx.fillStyle='rgba(255,254,246,.97)';ctx.beginPath();ctx.arc(sunX,sunY,34,0,Math.PI*2);ctx.fill()
    // 层积云：上密下疏、横向拉长，避免上一版等距圆斑。
    for(let i=0;i<34;i++){
      const cx=((i*263+97)%W), cy=90+((i*127)%(hz-190))
      const rx=150+(i*71)%320, ry=20+(i*37)%26
      const alpha=.10+.16*((i*17)%5)/4
      const cloud=ctx.createRadialGradient(cx,cy,0,cx,cy,rx)
      cloud.addColorStop(0,`rgba(255,255,255,${alpha})`)
      cloud.addColorStop(.45,`rgba(250,252,255,${alpha*.55})`)
      cloud.addColorStop(1,'rgba(255,255,255,0)')
      ctx.save();ctx.translate(cx,cy);ctx.scale(1,ry/rx);ctx.translate(-cx,-cy)
      ctx.fillStyle=cloud;ctx.beginPath();ctx.arc(cx,cy,rx,0,Math.PI*2);ctx.fill();ctx.restore()
    }
    // 地平线附近的远云带：默认机位只看到 0–4° 仰角，需要低空云才有层次。
    for(let i=0;i<12;i++){
      const cx=(i*181+40)%W, cy=hz-38-((i*29)%44), rx=210+(i*53)%300, ry=10+(i*7)%8
      const cloud=ctx.createRadialGradient(cx,cy,0,cx,cy,rx)
      cloud.addColorStop(0,'rgba(250,252,252,.50)');cloud.addColorStop(.45,'rgba(226,235,239,.26)')
      cloud.addColorStop(1,'rgba(255,255,255,0)')
      ctx.save();ctx.translate(cx,cy);ctx.scale(1,ry/rx);ctx.translate(-cx,-cy)
      ctx.fillStyle=cloud;ctx.beginPath();ctx.arc(cx,cy,rx,0,Math.PI*2);ctx.fill();ctx.restore()
    }
    // 太阳方位的地平线暖雾，给近地平线一点方向感。
    const glow=ctx.createRadialGradient(sunX,hz,0,sunX,hz,720)
    glow.addColorStop(0,'rgba(255,238,212,.30)');glow.addColorStop(.45,'rgba(255,243,226,.12)')
    glow.addColorStop(1,'rgba(255,245,232,0)')
    ctx.save();ctx.translate(sunX,hz);ctx.scale(1,.10);ctx.translate(-sunX,-hz)
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(sunX,hz,720,0,Math.PI*2);ctx.fill();ctx.restore()
    // 地平线薄雾带：压住天空与海面的硬接缝。
    const haze=ctx.createLinearGradient(0,hz-46,0,hz+16)
    haze.addColorStop(0,'rgba(236,243,240,0)');haze.addColorStop(.72,'rgba(236,243,240,.40)')
    haze.addColorStop(1,'rgba(214,229,227,0)')
    ctx.fillStyle=haze;ctx.fillRect(0,hz-46,W,62)
  }
  const skyTexture=new THREE.CanvasTexture(sky)
  skyTexture.mapping=THREE.EquirectangularReflectionMapping
  skyTexture.wrapS=THREE.RepeatWrapping
  skyTexture.colorSpace=THREE.SRGBColorSpace
  environmentTextures.push(skyTexture)
  scene.background=skyTexture
  scene.fog=new THREE.Fog('#d5e5e5',330,1000)
  try{
    const pmrem=new THREE.PMREMGenerator(renderer)
    const env=pmrem.fromEquirectangular(skyTexture)
    scene.environment=env.texture
    environmentTextures.push(env.texture)
    pmrem.dispose()
  }catch{/* environment map is optional */}
  // 晴天 HDR：设计图为淡蓝晴空，用 clear puresky 接管背景与 IBL。
  new RGBELoader().load(import.meta.env.BASE_URL+'tanggang/environment/syferfontein_clear_puresky_2k.hdr',(hdr)=>{
    if(!active||!scene||!renderer)return
    hdr.mapping=THREE.EquirectangularReflectionMapping
    const pmrem=new THREE.PMREMGenerator(renderer)
    const env=pmrem.fromEquirectangular(hdr)
    scene.background=hdr
    scene.environment=env.texture
    scene.backgroundRotation.set(0,THREE.MathUtils.degToRad(0),0)
    scene.environmentRotation.copy(scene.backgroundRotation)
    scene.backgroundIntensity=1.0
    scene.environmentIntensity=.92
    environmentTextures.push(hdr,env.texture)
    hdrSky=hdr
    reflectionFrames=0;reflectionSignature=''
    pmrem.dispose()
  },undefined,()=>{/* 保留 Canvas 天空回退 */})
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
  orbit.zoomToCursor=true
  orbit.maxPolarAngle=Math.PI*.485
  resetCameraPosition()
  scene.add(new THREE.HemisphereLight(0xdfeef8,0x6d855a,.60))
  const sun=new THREE.DirectionalLight(0xfff0d8,1.7)
  sun.position.set(64,104,-44);sun.castShadow=true;shadowSun=sun
  Object.assign(sun.shadow.camera,{left:-92,right:92,top:96,bottom:-96,near:1,far:285})
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.05;sun.shadow.bias=-.0005;sun.shadow.radius=3.5
  sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true
  scene.add(sun)
  const edge=new THREE.DirectionalLight(0xc4ebf5,.20);edge.position.set(-66,48,-42);scene.add(edge)
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
    // 新机位改为透视构图，桌面端不再用 viewOffset 裁切；移动端仅保留底部留白补偿。
    const ox=0
    const oy=w/h<1.08?-Math.min(h*.065,55):0
    camera.setViewOffset(w,h,ox,oy,w,h)
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(displayPixelRatio(w,h))
    renderer.setSize(w,h,false)
    if(composer){composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h)}
    resizeWaterReflection()
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
  let flowPrev=0
  let labelSig=''
  let framePrev=performance.now()
  const tick=()=>{
    if(!active)return
    const frameNow=performance.now()
    perfLog.frames.push(frameNow-framePrev);framePrev=frameNow
    if(perfLog.frames.length>240)perfLog.frames.shift()
    frameId=requestAnimationFrame(tick)
    if(studyOpen.value&&!busy.value)return
    orbit?.update()
    // Scene motion: water drift, cloud drift and pipe-flow phase.
    const now=performance.now()/1000
    relief?.update(now)
    // 共享时钟只在运行状态累加；停流后相位冻结，不会跳变。
    if(flowPrev===0)flowPrev=now
    if(flowToggle.value&&!grayMode.value)flowClock.value+=Math.min(.06,Math.max(0,now-flowPrev))
    flowPrev=now
    if(!hdrSky)skyTexture.offset.x=(now*.0035)%1
    if(groundGrid)groundGrid.visible=!solidMode.value
    // 逐显示帧绘制：跳过帧会让转动时物体与标牌抖动。标签只在相机变化时重排，
    // 静止时每 30 帧兜底一次（数据更新走 refresh，不依赖逐帧重算）。
    const cam=camera!
    const range = orbit ? cam.position.distanceTo(orbit.target) : 0
    // 近裁剪面只按档位切换，避免转动时逐帧改变深度精度造成共面闪烁。
    // 远景档收紧远距深度误差，近景档保留贴近查看的可用性。
    const targetNear = range > 150 ? 2.4 : range < 110 ? 0.4 : 0
    if (targetNear && Math.abs(cam.near - targetNear) > 0.01) {
      cam.near = targetNear
      cam.updateProjectionMatrix()
    }
    const sig=`${cam.position.x.toFixed(2)},${cam.position.y.toFixed(2)},${cam.position.z.toFixed(2)},${cam.quaternion.x.toFixed(3)},${cam.quaternion.y.toFixed(3)},${cam.quaternion.z.toFixed(3)},${cam.quaternion.w.toFixed(3)}`
    if(sig!==labelSig||++n%30===0){labelSig=sig;updateCompass();createScreenLabels()}
    maybeUpdateWaterReflection(cam)
    renderer?.info.reset()
    if(composer)composer.render()
    else renderer?.render(scene!,cam)
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
      camera:{pos:at(0,0,0).copy(camera!.position).toArray(),target:orbit!.target.toArray(),fov:camera!.fov,aspect:camera!.aspect,near:camera!.near,far:camera!.far,viewOffset:{ox:camera!.view?.offsetX??0,oy:camera!.view?.offsetY??0}},
      rect:rect(),corners,
      project:(x:number,z:number)=>proj(x,z),
    }
  }
  // 植树排查：复算最终树心与当前可绘制道路中心折线的平面距离。
  ;(window as any).__treeAudit=(full=false)=>{
    const sites=relief?.treeSites??[]
    const segs=relief?.roadSegments??[]
    const half=relief?.roadHalfWidth??.66
    let inside=0,west=0,east=0
    const hits:{x:number;z:number;d:number;handle:string}[]=[]
    const rows:{index:number;x:number;z:number;handle:string;d:number;west:number;east:number}[]=[]
    sites.forEach((site,index)=>{
      let best=Infinity,handle=''
      for(const s of segs){
        const dx=s.bx-s.ax,dz=s.bz-s.az,len2=dx*dx+dz*dz
        const t=len2>0?Math.max(0,Math.min(1,((site.x-s.ax)*dx+(site.z-s.az)*dz)/len2)):0
        const d=Math.hypot(s.ax+dx*t-site.x,s.az+dz*t-site.z)
        if(d<best){best=d;handle=s.handle}
      }
      const inWest=site.x>-57&&site.x<-39&&site.z>-45&&site.z<35?1:0
      const inEast=site.x>22?1:0
      if(full)rows.push({index,x:+site.x.toFixed(4),z:+site.z.toFixed(4),handle,d:+best.toFixed(4),west:inWest,east:inEast})
      if(best<half){
        inside++
        if(inWest)west++
        if(inEast)east++
        hits.push({x:site.x,z:site.z,d:best,handle})
      }
    })
    return {count:sites.length,inside,west,east,halfWidth:half,hits:hits.slice(0,40),rows:full?rows:undefined}
  }
  // 旋转稳定性复核：仅调试页可用，按角度绕当前目标水平转动相机。
  ;(window as any).__spin=(deg:number)=>{
    if(!camera||!orbit)return null
    const a=deg*Math.PI/180,off=camera.position.clone().sub(orbit.target)
    camera.position.set(orbit.target.x+off.x*Math.cos(a)-off.z*Math.sin(a),
      camera.position.y,orbit.target.z+off.x*Math.sin(a)+off.z*Math.cos(a))
    orbit.update()
    return camera.position.toArray()
  }
  // 俯仰复核：仅调试页可用，保持水平朝向，把相机抬到指定俯角。
  ;(window as any).__pitch=(deg:number)=>{
    if(!camera||!orbit)return null
    const off=camera.position.clone().sub(orbit.target)
    const flat=Math.hypot(off.x,off.z)
    camera.position.y=orbit.target.y+flat*Math.tan(deg*Math.PI/180)
    orbit.update()
    return camera.position.toArray()
  }
  // 真实渲染统计：renderer.info 只统计已提交的 draw，用于验收记录帧耗与批次。
  ;(window as any).__stats=()=>{
    const sorted=[...perfLog.frames].sort((a,b)=>a-b)
    const at=(q:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]:0
    return {
      frame:renderer?.info.render.frame??-1,
      calls:renderer?.info.render.calls??-1,
      triangles:renderer?.info.render.triangles??-1,
      geometries:renderer?.info.memory.geometries??-1,
      textures:renderer?.info.memory.textures??-1,
      samples:sorted.length,medianMs:+at(.5).toFixed(2),p95Ms:+at(.95).toFixed(2),
      fps:at(.5)>0?+(1000/at(.5)).toFixed(1):0,
    }
  }
}
onMounted(async()=>{
  try {
    setup()
    // 从工艺页返回时恢复相机、系统与图例状态；首次进入没有存档则使用默认机位。
    const restored=readViewState()
    const calibration=!!new URLSearchParams(location.search).get('cam')
    if(!calibration&&restored?.camera&&camera&&orbit){
      camera.position.fromArray(restored.camera.pos)
      orbit.target.fromArray(restored.camera.target)
      if(restored.camera.fov!==undefined&&Number.isFinite(restored.camera.fov))setFieldOfView(restored.camera.fov)
      orbit.update()
    }
    if(typeof restored?.flow==='boolean')flowToggle.value=restored.flow
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
      initWaterReflection()
      const built=relief
      built.loadStockpiles().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun){shadowSun.shadow.needsUpdate=true;reflectionFrames=0}
      }).catch(()=>{if(active)regionLoadError.value='堆场精细模型加载失败'})
      built.loadPortAssets().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun){shadowSun.shadow.needsUpdate=true;reflectionFrames=0}
      }).catch(()=>{if(active)regionLoadError.value='港口设备表现模型加载失败'})
      built.loadBuildings().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun){shadowSun.shadow.needsUpdate=true;reflectionFrames=0}
      }).catch(()=>{if(active)regionLoadError.value='精细建筑模型加载失败'})
      built.loadTrees().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun){shadowSun.shadow.needsUpdate=true;reflectionFrames=0}
      }).catch(()=>{if(active)regionLoadError.value='精细树木模型加载失败'})
      built.loadProcessBuildings().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun){shadowSun.shadow.needsUpdate=true;reflectionFrames=0}
      }).catch(()=>{if(active)regionLoadError.value='工艺建筑模型加载失败'})
      built.loadWashStation().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun){shadowSun.shadow.needsUpdate=true;reflectionFrames=0}
      }).catch(()=>{if(active)regionLoadError.value='洗车台样件加载失败'})
      built.loadTrucks().then(loaded=>{
        if(active&&relief===built&&loaded&&shadowSun){shadowSun.shadow.needsUpdate=true;reflectionFrames=0}
      }).catch(()=>{if(active)regionLoadError.value='出场车辆模型加载失败'})
      refresh()
    }
    if(datasets.regions){
      regions.value=datasets.regions.regions
      selectedRegionId.value='REG-YARD'
      if(spatialData)createFloatingMarks(data,spatialData)
      if(datasets.systems){
        businessSystems.value=datasets.systems.systems
        if(restored?.system&&businessSystems.value.some(s=>s.id===restored.system)){
          systemModeId.value=restored.system
          if(restored.layers)layerVisible.value={...allLayersOn(),...restored.layers}
          soloLayer.value=restored.solo??null
          if(typeof restored.fire==='boolean')showFireOverlay.value=restored.fire
        }
      }
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
  persistViewState()
  active=false
  cancelAnimationFrame(frameId)
  observer?.disconnect()
  if(windowResizeHandler)window.removeEventListener('resize',windowResizeHandler)
  windowResizeHandler=null
  if(canvas){canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp)}
  orbit?.dispose()
  relief?.dispose()
  reflectionRT?.dispose();reflectionRT=null;reflectionCamera=null
  composer?.dispose();composer=null;renderPass=null
  shadowSun?.shadow.map?.dispose()
  disposeHighlights()
  disposeContinuitySelection()
  continuityDebugGroup.clear()
  for(const batch of batches) batch.mesh.removeFromParent()
  markerMesh?.dispose()
  pipeGeometry.dispose()
  geometriesToDispose.forEach(g=>g.dispose())
  environmentTextures.forEach(t=>t.dispose())
  // 流带由管身材质内置，随几何/材质统一释放。
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
        </div>
        <div class="l1-actions">
          <button v-if="!busy && !failure" type="button" class="l1-fire-switch" data-overlay="fire"
            role="switch" :aria-checked="showFireOverlay" @click="toggleFireLayer">
            消防管网<i aria-hidden="true"></i>
          </button>
          <button class="l1-tool-toggle" :class="{active:toolsOpen}" @click="toolsOpen=!toolsOpen"
            :aria-expanded="toolsOpen">
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
      <!-- 顶栏下就近的单行入口：全场总览 + 六工艺；不遮挡场景时也能直接切换。 -->
      <div class="l1-filters l1-system-row" v-if="!busy&&!failure&&showFilters"
        aria-label="全场总览与六个业务子系统">
        <button class="l1-filter l1-system-tab" data-system="all" :class="{chosen:systemModeId==='all'}"
          :aria-pressed="systemModeId==='all'" @click="chooseSystem('all')">全场总览</button>
        <button v-for="(mode,index) in businessSystems" :key="mode.id"
          class="l1-filter l1-system-tab" :data-system="mode.id"
          :class="{chosen:systemModeId===mode.id}"
          :aria-pressed="systemModeId===mode.id" @click="chooseSystem(mode.id)">
          <i :style="{background:mode.accent}"></i>{{String(index+1).padStart(2,'0')}} {{mode.name}}
        </button>
        <button v-if="processRoute" class="l1-filter l1-process-link" @click="openProcess">
          进入{{sourceMode?.name}}工艺页 →
        </button>
      </div>
      <div v-if="!busy&&!failure" class="l1-site-legend">
        <span>A侧8位 · B侧8位 <b>边线推算</b></span>
        <span>北池设计2座 / 南池设计5座 <b>轮廓待核</b></span>
        <button class="l1-flow-chip" data-flow-demo :class="{live:flowToggle&&demoLayerFocused}" :aria-pressed="flowToggle"
          title="中压供水源Handle 139320 折线流带演示；非实时数据，不表示水力方向"
          @click="toggleFlow">
          <i></i>{{sourceMode?sourceMode.name+' · 中压演示段':'流动演示 · 中压供水'}} <b>{{flowStatusText}}</b>
        </button>
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
      <div v-if="solidMode && !busy && !failure" class="home-pipe-legend" role="group"
        aria-label="七类管网用途图例，可多选显示、单类独显与恢复默认">
        <div class="l1-legend-head">
          <strong>管网图例</strong>
          <button class="l1-legend-reset" type="button" @click="resetLegend">恢复默认</button>
        </div>
        <div class="l1-legend-items">
          <span v-for="p in pipeLegend" :key="p.layer" class="l1-legend-item"
            :class="{muted:!legendOn(p.layer),soloed:isSoloLayer(p.layer)}">
            <button type="button" class="l1-legend-toggle" :aria-pressed="legendOn(p.layer)"
              :title="'显示或隐藏：'+p.name" @click="toggleLayer(p.layer)">
              <i :style="{background:p.color}"></i>{{p.name}}
            </button>
            <button type="button" class="l1-legend-solo" :aria-pressed="isSoloLayer(p.layer)"
              :aria-label="'仅看'+p.name" :title="'仅看'+p.name" @click="soloLegend(p.layer)">独</button>
          </span>
        </div>
        <small class="l1-legend-status">{{legendStatus}}</small>
      </div>
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
            chosen:floatingDetail?.id===item.id,systemFocus:focusAnchorIds.has(item.id)}"
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
        <small>{{floatingDetail.status}} · 数据状态：未接入实时采集</small>
        <div class="l1-point-kpis">
          <div v-for="[label,value] in floatingKpis" :key="label">
            <small>{{label}}</small><b>{{value}}</b>
          </div>
        </div>
        <p>{{floatingNote}}</p>
        <details class="l1-point-evidence">
          <summary>定位依据</summary>
          <p>{{floatingDetail.note}}</p>
          <p>源CAD：{{floatingDetail.sourceHandle}}；模型位置为展示锚点。</p>
        </details>
        <button v-if="floatingDetail.id==='TG-CAD-16'||floatingDetail.id==='HOME-1028AB'"
          type="button" class="l1-point-open" data-inspect-east @click="inspectEastFacility(floatingDetail)">从厂区侧查看</button>
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
      <div v-if="detail" class="l1-selection" role="dialog" aria-label="对象详情">
        <div class="l1-detail-top"><span>{{detailKindLabel}} · {{detailSystemLabel}}</span>
          <button title="关闭" aria-label="关闭对象详情" @click="chooseEntry(null)">×</button></div>
        <strong>{{detailName}}</strong>
        <p class="l1-detail-sub">关联工艺：{{detailSystemLabel}} · 数据状态：未接入实时采集</p>
        <div class="l1-kpis">
          <div v-for="[label,value] in detailKpis" :key="label">
            <small>{{label}}</small><b>{{value}}</b>
          </div>
        </div>
        <p class="l1-detail-alert">告警：未接入 · 不显示推测趋势或虚构读数</p>
        <details class="l1-evidence">
          <summary>定位依据（CAD 源与位置精度）</summary>
          <dl v-if="detail.type==='anchor'">
            <div><dt>源Handle</dt><dd>{{detail.data.sourceHandle||'无'}}</dd></div>
            <div><dt>原图层</dt><dd>{{detail.data.sourceLayer}}</dd></div>
            <div><dt>原图文字</dt><dd>{{detail.data.sourceText}}</dd></div>
            <div><dt>CAD坐标</dt><dd>{{detail.data.sourceCADXY.map(v=>Math.round(v)).join(' / ')}}</dd></div>
            <div><dt>轮廓线索</dt><dd>{{sourceMatchesForAnchor(detail.data)}}</dd></div>
            <div><dt>位置精度</dt><dd>文字锚点；独立边界与设施身份待核</dd></div>
          </dl>
          <dl v-else-if="detail.type==='yardBand'">
            <div><dt>候选区域</dt><dd>{{detail.data.id}}</dd></div>
            <div><dt>堆场标签</dt><dd>{{detail.data.yardAnchorLabels.join('、')}}</dd></div>
            <div><dt>源边界Handle</dt><dd>{{detail.data.sourceEdgeHandles.join(' / ')}}</dd></div>
            <div><dt>CAD图层</dt><dd>{{detail.data.sourceLayer}}</dd></div>
            <div><dt>内部中压管</dt><dd>{{detail.data.parallelInternalMiddlePressurePipeHandle}}</dd></div>
            <div><dt>端部封口</dt><dd>计算构造，未核实</dd></div>
            <div><dt>两座分界</dt><dd>未确认，不画假分割线</dd></div>
          </dl>
          <dl v-else-if="detail.type==='matchedContour'">
            <div><dt>源Handle</dt><dd>{{detail.data.handle}}</dd></div>
            <div><dt>源CAD图层</dt><dd>{{detail.data.sourceLayer}}</dd></div>
            <div><dt>CAD文字点</dt><dd>{{detail.data.labels.join('、')}}</dd></div>
            <div><dt>几何关联</dt><dd>原闭合面包围原文字点</dd></div>
            <div><dt>位置精度</dt><dd>轮廓与文字匹配；设施身份未验收</dd></div>
          </dl>
          <dl v-else>
            <div><dt>源图元</dt><dd>{{detail.data.handle}}</dd></div>
            <div><dt>原始图层</dt><dd>{{detail.data.layer}}</dd></div>
            <div><dt>原图起点</dt><dd>{{detail.data.originalCADPoint.join(' / ')}}</dd></div>
            <div><dt>连通关系</dt><dd>尚未工程验收</dd></div>
            <div><dt>阀门/设备</dt><dd>尚未匹配</dd></div>
            <template v-if="detail.data.handle===DEMO_PIPE_HANDLE">
              <div><dt>流动演示</dt><dd>{{flowToggle?'流带运行 · 演示数据':'已停流 · 管身保留'}}</dd></div>
              <div><dt>关联设施候选</dt><dd>除尘泵房 TG-CAD-12（同系统文字锚点，实际接管未核）</dd></div>
              <div><dt>方向依据</dt><dd>按折线绘制方向演示，不作水力方向证据</dd></div>
            </template>
          </dl>
          <p v-if="detail.type==='yardBand'||detail.type==='matchedContour'">{{detail.data.limitations}}</p>
          <p v-else-if="detail.type==='anchor'">当前为原CAD审查信息，不代表已完成物理管网或设施单体的建模验收。</p>
        </details>
        <div v-if="linkedRegions.length" class="l1-related-areas">
          <strong>对应区域（空间或专业关联，不代表水力连通）</strong>
          <button v-for="item in linkedRegions.slice(0,5)" :key="item.id" @click="showRegion(item.id)">
            {{item.name}} · {{item.devices.length}}类设计设备
          </button>
        </div>
        <div class="l1-detail-actions">
          <button v-if="processRoute" class="l1-detail-primary" @click="openProcess">
            进入{{sourceMode?.name}}工艺页
          </button>
          <a v-if="detail.type==='anchor'" :href="'/tanggang/audit/cad-review/index.html?focus='+detail.data.id.replace('TG-CAD-','')"
            target="_blank" rel="noopener">二维CAD定位</a>
          <a v-else-if="detail.type==='pipe'" :href="'/tanggang/audit/cad-review/index.html?line='+detail.data.handle"
            target="_blank" rel="noopener">CAD高亮源图元</a>
          <a v-else href="/tanggang/audit/cad-review/v2/index.html" target="_blank" rel="noopener">查看区域证据图</a>
        </div>
      </div>
      <div v-if="regionLoadError&&!busy" class="l1-region-load-error">{{regionLoadError}}</div>

    </section>
  </div>
</template>

<style scoped>
.l1-scene {pointer-events:none;
  --tg-glass-surface:linear-gradient(150deg,rgba(255,255,255,.84) 0%,rgba(244,250,255,.73) 49%,rgba(231,242,251,.68) 100%);
  --tg-glass-border:rgba(255,255,255,.74);
  --tg-glass-outline:rgba(108,159,194,.24);
  --tg-glass-shadow:0 8px 25px rgba(39,89,135,.12),inset 0 1px 0 rgba(255,255,255,.60)}
.l1-zone {background:radial-gradient(ellipse 75% 83% at 52% 45%,#fafeff 5%,#e3f1fa 85%); pointer-events:auto}
.l1-view,.l1-webgl {position:absolute;inset:0;width:100%;height:100%}
.l1-view {z-index:0}
.l1-hud {position:absolute;z-index:4;top:44px;left:20px;right:20px;display:flex;align-items:start;justify-content:space-between;gap:12px;pointer-events:none}
.l1-hud h2 {font-size:20px;color:#2a5671;margin:6px 0 3px;font-weight:760}
.l1-hud p {font-size:10px;color:#7594a8;line-height:1.5}
.l1-eyebrow {display:flex;align-items:center;gap:8px;font-size:10px;font-weight:750;letter-spacing:1.05px;color:#448b9d}
.l1-eyebrow i {width:6px;height:6px;border-radius:50%;background:#27babb;box-shadow:0 0 0 4px #38bbcb20}
.l1-eyebrow span {font-size:9px;background:#e7f8fb;border-radius:4px;padding:3px 6px;color:#3b9bab}
.l1-actions {display:flex;align-items:center;gap:6px;pointer-events:auto}
.l1-actions a,.l1-actions button {padding:8px 9px;border-radius:9px;border:1px solid #dcebf3;background:#fffc;font-size:11px;color:#498099;white-space:nowrap}
.l1-actions :is(a,button):hover {background:#fff;color:#207f9f;border-color:#add8e7}
.l1-filters {position:absolute;top:6px;left:16px;right:112px;display:flex;gap:5px;align-items:center;overflow-x:auto;scrollbar-width:none;z-index:6}
.l1-filter {display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:17px;border:1px solid #d7e6ee;background:var(--tg-glass-surface);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);color:#5d7f92;font-size:10px;white-space:nowrap;box-shadow:0 3px 12px #3f7f9720}
.l1-filter i {width:7px;height:7px;border-radius:50%}
.l1-filter.chosen,.l1-filter:hover {border-color:#79c7de;background:#fff;color:#1f7591}
.l1-filter:focus-visible,.l1-legend-toggle:focus-visible,.l1-legend-solo:focus-visible,.l1-legend-reset:focus-visible{outline:2px solid #1b7396;outline-offset:1px}
.l1-process-link{margin-left:auto;color:#1d7d96;border-color:#8fcadd;background:#e9f9fd}
.l1-count {margin-left:auto;font-size:10px;color:#809baa;white-space:nowrap;background:#ffffffca;padding:6px 9px;border-radius:12px}
.l1-label-layer {position:absolute;inset:0;z-index:2;pointer-events:none}
.l1-label {position:absolute;pointer-events:auto;transform:translate(-50%,-130%);padding:4px 7px;font-size:10px;font-weight:660;white-space:nowrap;background:#ffffffed;border:1px solid #d8e9f1;border-left:3px solid #3a9cbc;color:#4a6b7e;box-shadow:0 4px 12px #5591a423;border-radius:6px}
.l1-label.yard {border-left-color:#d8a656;color:#916e36;background:#fffaf2f0}
.l1-label:hover {background:#fff;border-color:#4dacc8;z-index:4}
.l1-selection {position:absolute;z-index:5;right:17px;top:132px;width:292px;border-radius:14px;background:var(--tg-glass-surface);padding:14px 16px;box-shadow:var(--tg-glass-shadow);border:1px solid var(--tg-glass-border);color:#486b81;backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3)}
.l1-detail-sub{font-size:10px;color:#6d8ea3;margin:2px 0 10px}
.l1-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0 0 8px}
.l1-kpis>div{padding:7px 6px;border-radius:9px;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.72)}
.l1-kpis small{display:block;font-size:9px;color:#7d98a8;line-height:1.35}
.l1-kpis b{display:block;font-size:12px;color:#2f6f88;margin-top:4px;font-weight:720}
.l1-detail-alert{font-size:9px;color:#9a7a5c;background:rgba(255,247,236,.7);border:1px solid rgba(230,213,178,.8);border-radius:7px;padding:5px 7px;margin:0 0 8px}
.l1-evidence{border:1px solid rgba(214,234,241,.9);border-radius:9px;padding:7px 9px;background:rgba(255,255,255,.45);margin:0 0 9px}
.l1-evidence summary{font-size:10px;color:#3f7f93;cursor:pointer;font-weight:640}
.l1-evidence dl{margin-top:7px}
.l1-evidence p{font-size:9px;line-height:1.6;color:#8198a5;margin:7px 0 0}
.l1-detail-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
.l1-detail-primary{background:#e0f5fa;border:1px solid #8fcadd;border-radius:8px;color:#1d7d96;font-size:10px;padding:7px 9px}
.l1-detail-primary:hover{background:#d0eff7}
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
.l1-actions .l1-fire-switch{display:inline-flex;align-items:center;gap:7px;min-height:32px;color:#35576d;cursor:pointer}
.l1-fire-switch i{display:inline-flex;align-items:center;width:25px;height:15px;border-radius:9px;background:#788b98;padding:2px;box-sizing:border-box}
.l1-fire-switch i::after{content:'';width:11px;height:11px;border-radius:50%;background:white}
.l1-fire-switch[aria-checked="true"] i{background:#ad4446;justify-content:flex-end}
.l1-fire-switch:focus-visible{outline:2px solid #1b7396;outline-offset:2px}
.l1-system-evidence{position:absolute;top:129px;left:16px;z-index:3;display:flex;gap:7px;align-items:center;
 max-width:calc(100% - 34px);pointer-events:none;background:#fffffff0;border:1px solid #e0ebf1;border-radius:9px;
 color:#63869a;padding:5px 8px;font-size:9px;box-shadow:0 3px 12px #5d96a219}
.l1-mode-label{color:#1d879f;font-weight:770}
.l1-evidence-warning{color:#a78f78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(min-width:950px){
 .l1-region-navigator{top:140px}
 .l1-system-evidence{top:140px}
 .l1-selection{top:140px!important}
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
.l1-site-legend{position:absolute;top:122px;left:17px;z-index:4;display:flex;align-items:center;gap:8px;
 max-width:calc(100% - 35px);white-space:nowrap;overflow-x:auto;scrollbar-width:none;pointer-events:none}
.l1-site-legend>span{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--tg-glass-border);background:var(--tg-glass-surface);
 -webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);
 font-size:10px;padding:4px 7px;border-radius:9px;color:#497c90;box-shadow:0 3px 12px #3f7f9718}
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
.l1-float-label.systemFocus{background:#fff8ea;border-color:#e6b26b;border-left-color:#d2762f;color:#8a5720;
 font-weight:800;box-shadow:0 0 0 2px #e2a74e59,0 8px 20px #8f5f1c33;z-index:9}
.l1-float-label.systemFocus .l1-label-pulse{background:#e0842f;box-shadow:0 0 0 3px #e0842f33}
.l1-point-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:7px 0}
.l1-point-kpis>div{padding:5px 6px;border-radius:7px;background:#f5fbff;border:1px solid #e2f0f5}
.l1-point-kpis small{display:block;font-size:9px;color:#7d98a8;line-height:1.35}
.l1-point-kpis b{display:block;font-size:11px;color:#2f6f88;margin-top:3px;font-weight:720}
.l1-point-evidence{margin:6px 0;padding:5px 7px;border:1px solid #e2f0f5;border-radius:7px;background:#f8fcff}
.l1-point-evidence summary{font-size:9px;color:#4b87a0;cursor:pointer}
.l1-point-evidence p{font-size:9px;line-height:1.55;color:#7a93a1;margin:4px 0 0}
.l1-label-pulse{width:6px;height:6px;flex:none;border-radius:50%;background:#4eabc0;box-shadow:0 0 0 3px #4eabc025}
.l1-float-label.yard .l1-label-pulse{background:#d6a55d;box-shadow:0 0 0 3px #dfb27429}
.l1-point-popover{position:absolute;z-index:9;width:290px;max-width:calc(100% - 20px);
 transform:translate(-50%,-100%);padding:12px 13px;border-radius:13px;
 background:var(--tg-glass-surface);border:1px solid var(--tg-glass-border);
 box-shadow:var(--tg-glass-shadow);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3)}
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
.l1-flow-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 9px;
 border:1px solid #b9d7e4;border-radius:10px;background:#f2fbfeef;color:#2b6d86;
 font-size:10px;cursor:pointer;pointer-events:auto;white-space:nowrap}
.l1-flow-chip i{width:7px;height:7px;border-radius:50%;background:#9fb4bd}
.l1-flow-chip.live i{background:#14b4d6;box-shadow:0 0 0 3px #14b4d633;animation:l1FlowPulse 1.6s ease-in-out infinite}
.l1-flow-chip b{color:#5b8ea2;font-size:9px;font-weight:600}
.l1-flow-chip.live b{color:#0f86a3}
@keyframes l1FlowPulse{0%,100%{opacity:1}50%{opacity:.35}}
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
.home-pipe-legend{position:absolute;z-index:6;left:50%;bottom:14px;transform:translateX(-50%);
 display:flex;flex-direction:column;gap:5px;padding:8px 11px;border-radius:12px;
 background:var(--tg-glass-surface);border:1px solid var(--tg-glass-border);
 -webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);
 color:#29465b;font-size:11px;box-shadow:var(--tg-glass-shadow);
 max-width:min(760px,calc(100% - 40px))}
.l1-legend-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.l1-legend-head strong{font-size:11px;letter-spacing:.5px;color:#356c84}
.l1-legend-items{display:flex;flex-wrap:wrap;gap:4px 6px}
.l1-legend-item{display:inline-flex;align-items:center;border:1px solid #d9e8ef;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.72)}
.l1-legend-item.muted{opacity:.45}
.l1-legend-item.soloed{border-color:#2b9fb8;box-shadow:0 0 0 2px #2b9fb82e}
.l1-legend-toggle{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;font-size:10px;color:#2f5568;background:transparent;white-space:nowrap}
.l1-legend-toggle i{width:14px;height:4px;border-radius:3px}
.l1-legend-toggle[aria-pressed="false"]{text-decoration:line-through;color:#7f97a3}
.l1-legend-solo{padding:3px 5px;border-left:1px solid #e2eef3;font-size:9px;color:#7c98a6;background:#f6fbfd}
.l1-legend-solo[aria-pressed="true"]{background:#d9f2f7;color:#1a7f96;font-weight:700}
.l1-legend-reset{font-size:10px;color:#3c8299;padding:2px 6px;border:1px solid #c9e0e8;border-radius:6px;background:#f4fbfd;white-space:nowrap}
.l1-legend-status{font-size:9px;color:#7b95a4;line-height:1.4}
@media(prefers-reduced-transparency:reduce){
 .home-pipe-legend,.l1-filter,.l1-site-legend>span,.l1-selection,.l1-point-popover{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(250,253,255,.96)}
}
@media(max-width:950px){.home-pipe-legend{max-width:calc(100% - 40px);gap:3px 8px;font-size:10px}}
@media(max-width:640px){.home-pipe-legend{bottom:49px;left:8px;right:auto;transform:none;max-width:calc(100% - 16px);padding:5px 7px}.l1-legend-toggle i{width:11px}}
.relief-controls button[aria-pressed="true"]{background:#245978;color:white}
</style>

<style src="./styles/scene-shell.css"></style>

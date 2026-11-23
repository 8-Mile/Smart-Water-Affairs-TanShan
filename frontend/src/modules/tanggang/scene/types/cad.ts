/**
 * 唐港三维场景 CAD / 系统清单 / 审计数据契约。
 * 从 5188 L1WaterScene.vue 抽出的纯类型定义，无运行时代码。
 */
import type { BufferAttribute, Mesh, Object3D } from 'three'

export type Pt2 = [number, number]

export type BusinessSystem = {
  id: string
  name: string
  subtitle: string
  accent: string
  intro: string
  disclaimer: string
  focusPipeLayers: string[]
  referencePipeLayers: string[]
  areaEquipment: { regionId: string; equipmentIds: string[] }[]
  primaryRegionId: string
  focusAnchorIds: string[]
  visibleSourceHandlesByFocusLayer: Record<string, number>
  visibleSourceHandlesByReferenceLayer: Record<string, number>
}

export type SystemManifest = {
  schema: string
  systems: BusinessSystem[]
  independentTechnicalOverlay: { pipeLayers: string[]; defaultOn: boolean }
}

export type CadLine = {
  handle: string
  layer: string
  role: 'background' | 'facility' | 'support' | 'pipe'
  system: string
  status: string
  color: string
  displayPoints: Pt2[]
  originalCADPoint: [number, number]
  isClipped: boolean
}

export type CadAnchor = {
  id: string
  name: string
  type: string
  system: string
  x: number
  z: number
  sourceHandle: string | null
  sourceLayer: string
  sourceCADXY: [number, number]
  status: string
  sourceText: string
  modelType: string
  verifiedFootprint: boolean
  note?: string
}

export type CadContour = {
  handle: string
  layer: string
  outline: Pt2[]
  areaDisplaySq: number
  status: string
  volumeHeightDisplayOnly: number
  matchedCadTextAnchorIds?: string[]
}

export type YardBand = {
  id: string
  name: string
  sourceEdgeHandles: string[]
  sourceLayer: string
  parallelInternalMiddlePressurePipeHandle: string
  yardAnchorIds: string[]
  yardAnchorLabels: string[]
  displayXZ: Pt2[]
  bandWidthCAD: number
  edgeEvidenceStatus: string
  endCapEvidenceStatus: string
  separateYardFootprintsStatus: string
  limitations: string
}

export type MatchedContour = {
  id: string
  handle: string
  sourceLayer: string
  anchorIds: string[]
  labels: string[]
  displayXZ: Pt2[]
  geometricalRelation?: string
  limitations: string
}

export type CadScene = {
  extentXZ: number[]
  schema: string
  sourceDWGSHA256: string
  lines: CadLine[]
  anchors: CadAnchor[]
  cadClosedContourCandidates: CadContour[]
  yardBands: YardBand[]
  matchedFacilityContours: MatchedContour[]
  qa: {
    renderEntries: number
    visiblePipeGeometries: number
    visibleDistinctPipeSourceHandles: number
    yardSourceAnchors: number
    verifiedYardFootprints: number
    verifiedIndividualPoolBodies: number
    verifiedHydraulicEdges: number
  }
  evidenceLimits: string[]
}

export type Entry =
  | { type: 'pipe'; data: CadLine }
  | { type: 'anchor'; data: CadAnchor }
  | { type: 'yardBand'; data: YardBand }
  | { type: 'matchedContour'; data: MatchedContour }

export type PipeBatch = {
  mesh: Mesh
  edges: CadLine[]
  layer: string
  system: string
  /** 与管身同批生成的接头/法兰，随图层显隐一起切换，避免留下漂浮阀件 */
  fittings?: Object3D[]
  /** 沿路径累计弧长的流带属性（顶点里程） */
  flowAttr?: BufferAttribute
  /** 按顶点控制流带开关；停流时置 0，管身保持可见 */
  onAttr?: BufferAttribute
  /** 是否包含演示主管 139320 */
  demo?: boolean
  /** 建批时的逐顶点流带开关（仅演示 handle=1），运行/停流在此基线上切换 */
  flowBase?: Float32Array
}

export type Label = {
  id: string
  name: string
  kind: string
  x: number
  y: number
  pointX: number
  pointY: number
  regionId: string
  sourceHandle: string
  note: string
  status: string
}

export type FloatingMark = {
  id: string
  name: string
  kind: string
  x: number
  z: number
  /** 可选：标牌引线落点（displayXZ）。缺省时使用 CAD 文字点 x/z。 */
  labelX?: number
  labelZ?: number
  regionId: string
  sourceHandle: string
  note: string
  status: string
}

export type YardSide = {
  id: string
  label: string
  sourceAnchorId: string
  sourceTextHandle: string
  side: string
  bandId: string
  sceneXZ: Pt2
  description: string
  physicalSingleYardVerified: boolean
}

export type PoolCandidate = {
  id: string
  name: string
  groupId: string
  sourceLayer: string
  sourceGeometryHandles: string[]
  displayXZ: Pt2[]
  sceneXZ: Pt2
  description: string
  singlePoolIdentityVerified: boolean
}

export type ChainBucketDatum = {
  id: string
  name: string
  kind: string
  sourceHandle: string
  sourceLayer: string
  sceneXZ: Pt2
  regionId: string
  note: string
  relatedBusinessSystem: string
  displayStatus: string
}

export type ChainBucketDataset = {
  schema: string
  sourceDWGSHA256: string
  markers: ChainBucketDatum[]
}

export type PipeAuditRow = {
  layer: string
  originalRawEntities: number
  sourceApprovedForDisplay: number
  sourceNotApprovedForDisplay: number
  displayedDistinctHandles: number
  approvedButNotDisplayed: number
}

export type ContinuityKind = 'visible_gap_candidate' | 'filtered_continuation_candidate' | 'short_orphan_candidate'

export type ContinuityIssue = {
  id: string
  kind: ContinuityKind
  severity: string
  layer: string
  handle: string
  pointXZ: Pt2
  reason: string
  relatedHandles: string[]
  gapDisplayUnits?: number
  reviewOnlyGeometry?: {
    handle: string
    status: string
    sourceLayer: string
    displayPoints: Pt2[]
    isApprovedPipeline: boolean
  }
}

export type ContinuityAuditData = {
  schema: string
  sourceDWGSHA256: string
  summary: {
    endpointTotal: number
    touchingAnotherVisible: number
    nearVisibleGap: number
    hiddenSourceContinuation: number
    unmatchedVisibleEndpoints: number
    shortIsolatedCandidateHandles: number
    countOfCandidateLocations: number
    verifiedHydraulicEdges: number
  }
  issues: ContinuityIssue[]
}

export type PipeAuditData = {
  schema: string
  sourceDWGSHA256: string
  counts: PipeAuditRow[]
  totals: {
    rawPipeEntries: number
    sourceApprovedForDisplay: number
    sourceNotApprovedForDisplay: number
    sourceApprovedButNotDisplayed: number
    displayedDistinctHandles: number
    sceneDisplayPieces: number
  }
}

export type SpatialCandidateData = {
  schema: string
  sourceDWGSHA256: string
  yardSideCandidates: YardSide[]
  poolContourCandidates: PoolCandidate[]
  actualSourceYardTextCount: number
  verifiedIndividualPoolGeometries: number
  designPoolCounts: { N: number; S: number }
}

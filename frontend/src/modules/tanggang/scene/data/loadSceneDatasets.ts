/**
 * 唐港 CAD 场景数据装载与版本校验（5188 L1WaterScene 的取数逻辑外置）。
 *
 * 只负责「取数与契约校验」，不触碰 Three.js 场景对象：
 * - 任一附属数据集校验失败只产生 warning，不阻断主场景；
 * - 主 CAD 数据缺失或版本不符直接抛错，由页面显示失败态。
 * 所有资源均走 ${BASE_URL}tanggang/cad/**，不依赖源项目端口。
 */
import type {
  CadScene,
  ChainBucketDataset,
  ContinuityAuditData,
  PipeAuditData,
  SpatialCandidateData,
  SystemManifest,
} from '../types/cad'
import type { RegionPayload } from '../types/regions'

const BASE = import.meta.env.BASE_URL + 'tanggang/cad/'

async function getJson(path: string): Promise<Response | null> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
  return res.ok ? res : null
}

export interface SceneDatasets {
  cad: CadScene
  continuity?: ContinuityAuditData
  pipeAudit?: PipeAuditData
  chain?: ChainBucketDataset
  spatial?: SpatialCandidateData
  regions?: RegionPayload
  systems?: SystemManifest
  /** 与源页面一致的渐进式告警，按出现顺序写入 */
  warnings: string[]
}

export async function loadSceneDatasets(): Promise<SceneDatasets> {
  const sceneRes = await fetch(`${BASE}l1-v2_2/scene-v2.2.json`, { cache: 'no-store' })
  if (!sceneRes.ok) throw new Error('V2.1 CAD场景数据缺失')
  const cad = (await sceneRes.json()) as CadScene
  if (cad.schema !== 'tanggang-l1-v2.2' || !cad.lines.length) {
    throw new Error('V2.1 CAD数据版本不正确')
  }

  const out: SceneDatasets = { cad, warnings: [] }

  const continuityRes = await getJson('l1-v2_8/V2.8_断点三维核查标记.json')
  if (continuityRes) {
    const diagnostics = (await continuityRes.json()) as ContinuityAuditData
    if (
      diagnostics.schema === 'tanggang-v2.8-visual-continuity-diagnostics' &&
      diagnostics.sourceDWGSHA256 === cad.sourceDWGSHA256 &&
      diagnostics.issues.length === diagnostics.summary.countOfCandidateLocations &&
      diagnostics.summary.verifiedHydraulicEdges === 0
    ) {
      out.continuity = diagnostics
    }
  }

  const auditRes = await getJson('l1-v2_7/V2.7_管线显示覆盖审计.json')
  if (auditRes) {
    const audit = (await auditRes.json()) as PipeAuditData
    if (
      audit.schema === 'tanggang-cad-pipe-coverage-v2.7' &&
      audit.sourceDWGSHA256 === cad.sourceDWGSHA256 &&
      audit.totals.sourceApprovedForDisplay === cad.qa.visibleDistinctPipeSourceHandles
    ) {
      out.pipeAudit = audit
    }
  }

  const chainRes = await getJson('l1-v2_7/chain-bucket-cad-v2.7.json')
  if (chainRes) {
    const chain = (await chainRes.json()) as ChainBucketDataset
    if (
      chain.schema === 'tanggang-chain-bucket-cad-label-v2.7' &&
      chain.sourceDWGSHA256 === cad.sourceDWGSHA256 &&
      chain.markers.length === 1 &&
      chain.markers[0].sourceHandle === '1058D8'
    ) {
      out.chain = chain
    }
  }

  const spatialRes = await getJson('l1-v2_6/spatial-candidates-v2.6.json')
  if (spatialRes) {
    const spatial = (await spatialRes.json()) as SpatialCandidateData
    if (
      spatial.schema === 'tanggang-floating-site-annotations-v2.6' &&
      spatial.sourceDWGSHA256 === cad.sourceDWGSHA256 &&
      spatial.yardSideCandidates.length === 16 &&
      spatial.poolContourCandidates.length >= 7 &&
      spatial.verifiedIndividualPoolGeometries === 0
    ) {
      out.spatial = spatial
    } else {
      out.warnings.push('CAD点位候选校验失败')
    }
  } else {
    out.warnings.push('CAD点位候选资源未找到')
  }

  const regionRes = await getJson('l1-v2_3/region-equipment-v2.3.json')
  if (regionRes) {
    const regions = (await regionRes.json()) as RegionPayload
    if (
      regions.schema === 'tanggang-areas-equipment-v2.3' &&
      regions.regions.length === regions.claims.zones &&
      regions.claims.locatedDevicePoints === 0 &&
      regions.claims.activeRealtimeValues === 0
    ) {
      out.regions = regions
      const sysRes = await getJson('l1-v2_5/systems-v2.5.json')
      if (sysRes) {
        const systems = (await sysRes.json()) as SystemManifest
        if (
          systems.schema === 'tanggang-business-systems-v2.5' &&
          systems.systems.length === 6 &&
          systems.systems.every((s) =>
            s.areaEquipment.every((r) => regions.regions.some((v) => v.id === r.regionId)),
          )
        ) {
          out.systems = systems
        } else {
          out.warnings.push('六系统目录数据不完整')
        }
      } else {
        out.warnings.push('六系统目录文件缺失')
      }
    } else {
      out.warnings.push('区域设备数据版本不匹配')
    }
  } else {
    out.warnings.push('区域设备数据未加载')
  }

  return out
}

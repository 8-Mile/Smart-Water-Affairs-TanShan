/**
 * 唐港三维场景与 5175 业务侧的唯一映射层。
 *
 * 追溯链：CAD Handle → objectId → facilityId → assetId → metricId → systemId
 * - cadHandle / objectId / facilityId 来自 5188 CAD 场景与区域设备清单，可核验；
 * - assetId / metricId 当前没有接入 5175 设备主数据与 SCADA 测点，保持 null，禁止臆造；
 * - 一件设备可关联多个系统，本模块按 systemId → equipmentId 建立反向索引，不重复建档。
 *
 * 数据标注：MEASURED 实测 / SIM 仿真 / REF 设计参考 / CALC 计算 / AI 建议 / UNKNOWN 未知。
 */
export type DataQuality = 'MEASURED' | 'SIM' | 'REF' | 'CALC' | 'AI' | 'UNKNOWN'

export const DATA_QUALITY_LABEL: Record<DataQuality, string> = {
  MEASURED: '实测',
  SIM: '仿真',
  REF: '设计参考',
  CALC: '计算',
  AI: 'AI 建议',
  UNKNOWN: '未知',
}

export interface TanggangSystem {
  id: string
  name: string
  subtitle: string
  accent: string
  intro: string
  disclaimer?: string
  focusPipeLayers: string[]
  referencePipeLayers: string[]
  primaryRegionId?: string
  focusAnchorIds?: string[]
  areaEquipment: { regionId: string; equipmentIds: string[] }[]
}

export interface TanggangDevice {
  id: string
  name: string
  regionId: string
  regionName: string
  designQuantity?: string
  specSection?: string
  sourceDoc?: string
  dataFields: string[]
  positionStatus?: string
  currentStatus?: string
  notes?: string
  sourceCadHandle: string | null
}

export interface TanggangRegion {
  id: string
  name: string
  category?: string
  subtitle?: string
  summary?: string
  warning?: string
  devices: TanggangDevice[]
}

export interface TraceChain {
  cadHandle: string | null
  objectId: string | null
  facilityId: string | null
  assetId: string | null
  metricId: string | null
  systemIds: string[]
  quality: DataQuality
  note: string
}

export interface TanggangCatalog {
  systems: TanggangSystem[]
  regions: TanggangRegion[]
  systemMap: Map<string, TanggangSystem>
  regionMap: Map<string, TanggangRegion>
  deviceMap: Map<string, TanggangDevice>
  /** equipmentId → 所属 systemId 列表（多系统共用一件设备） */
  deviceSystems: Map<string, string[]>
}

interface RawRegion {
  id: string
  name: string
  category?: string
  subtitle?: string
  summary?: string
  warning?: string
  devices?: Array<Omit<TanggangDevice, 'regionId' | 'regionName'>>
}

interface RawRegionPayload {
  regions: RawRegion[]
}

interface RawSystemPayload {
  systems: TanggangSystem[]
}

const BASE = import.meta.env.BASE_URL + 'tanggang/cad/'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`加载唐港工程数据失败：${path} (${res.status})`)
  return (await res.json()) as T
}

let cache: Promise<TanggangCatalog> | null = null

export function loadTanggangCatalog(): Promise<TanggangCatalog> {
  if (!cache) {
    cache = buildCatalog().catch((err) => {
      cache = null
      throw err
    })
  }
  return cache
}

async function buildCatalog(): Promise<TanggangCatalog> {
  const [systemPayload, regionPayload] = await Promise.all([
    fetchJson<RawSystemPayload>('l1-v2_5/systems-v2.5.json'),
    fetchJson<RawRegionPayload>('l1-v2_3/region-equipment-v2.3.json'),
  ])

  const regions: TanggangRegion[] = regionPayload.regions.map((region) => ({
    id: region.id,
    name: region.name,
    category: region.category,
    subtitle: region.subtitle,
    summary: region.summary,
    warning: region.warning,
    devices: (region.devices ?? []).map((device) => ({
      ...device,
      regionId: region.id,
      regionName: region.name,
    })),
  }))

  const systems = systemPayload.systems
  const systemMap = new Map(systems.map((s) => [s.id, s]))
  const regionMap = new Map(regions.map((r) => [r.id, r]))
  const deviceMap = new Map<string, TanggangDevice>()
  regions.forEach((region) => region.devices.forEach((device) => deviceMap.set(device.id, device)))

  // 反向索引：同一设备可被多个系统引用
  const deviceSystems = new Map<string, string[]>()
  systems.forEach((system) => {
    system.areaEquipment.forEach((entry) => {
      entry.equipmentIds.forEach((equipmentId) => {
        const list = deviceSystems.get(equipmentId) ?? []
        if (!list.includes(system.id)) list.push(system.id)
        deviceSystems.set(equipmentId, list)
      })
    })
  })

  return { systems, regions, systemMap, regionMap, deviceMap, deviceSystems }
}

/**
 * 由 CAD 源图元 Handle 生成可核验的追溯链。
 * 仅当设备清单里存在对应 sourceCadHandle 时才建立 facility 关联，否则返回 UNKNOWN。
 */
export function traceCadHandle(handle: string | null, catalog: TanggangCatalog): TraceChain {
  if (!handle) {
    return {
      cadHandle: null,
      objectId: null,
      facilityId: null,
      assetId: null,
      metricId: null,
      systemIds: [],
      quality: 'UNKNOWN',
      note: 'CAD 源图元未关联设备点，无法建立设施与资产追溯',
    }
  }
  const matched = Array.from(catalog.deviceMap.values()).find((d) => d.sourceCadHandle === handle)
  if (!matched) {
    return {
      cadHandle: handle,
      objectId: `cad:${handle}`,
      facilityId: null,
      assetId: null,
      metricId: null,
      systemIds: [],
      quality: 'REF',
      note: '仅存在于 CAD 图元的几何对象，未匹配设计设备清单（设计参考）',
    }
  }
  return {
    cadHandle: handle,
    objectId: `cad:${handle}`,
    facilityId: matched.id,
    assetId: null,
    metricId: null,
    systemIds: catalog.deviceSystems.get(matched.id) ?? [],
    quality: 'REF',
    note: '已匹配设计设备清单；5175 资产与 SCADA 测点未接入，assetId/metricId 留空',
  }
}

/** 供页面展示的系统摘要：设备数量、未定位数量、未接入数量 */
export function summarizeSystem(system: TanggangSystem, catalog: TanggangCatalog) {
  const ids = new Set(system.areaEquipment.flatMap((e) => e.equipmentIds))
  const devices = Array.from(ids)
    .map((id) => catalog.deviceMap.get(id))
    .filter((d): d is TanggangDevice => Boolean(d))
  return {
    designCategories: devices.length,
    unlocated: devices.filter((d) => d.positionStatus === 'unlocated').length,
    notConnected: devices.filter((d) => d.currentStatus === '未接入').length,
  }
}

/** 唐港对象映射唯一后端入口：无映射≠已连通，正式设备和测点ID以数据库为准。 */
import http from './http'
import type { ApiResponse, PageResult, OptionItem } from './types'

export type TanggangSystemId = 'fog' | 'middle' | 'mineral' | 'rain' | 'pool' | 'domestic'
export type TanggangDataMode = 'MEASURED' | 'SIM' | 'REF' | 'CALC' | 'AI' | 'UNKNOWN'
export type TanggangQuality = 'GOOD' | 'STALE' | 'BAD' | 'MISSING' | 'OFFLINE'

export interface TanggangMeasurement {
  metric_id: number
  asset_id: number | null
  value: number | string | boolean | null
  unit: string | null
  data_mode: TanggangDataMode
  quality: TanggangQuality
  observed_at: string | null
  source_ref: string
  calculation_version: string | null
}

export interface TanggangObjectLink {
  id: number
  object_id: string
  facility_id: string
  system_id: TanggangSystemId
  system_name: string
  cad_handle: string | null
  source_ref: string | null
  asset_ids: number[]
  metric_ids: number[]
  assets?: Array<{id:number;name:string;code:string}>
  stale_asset_ids?: number[]
  verified: boolean
  verified_by: number | null
  verified_at: string | null
  created_at: string
  updated_at: string
  data_mode: 'REF'
  hydraulic_topology_verified: false
  measurements?: TanggangMeasurement[]
}
export type TanggangObjectLinkBody = Pick<TanggangObjectLink,
  'object_id' | 'facility_id' | 'system_id' | 'cad_handle' | 'source_ref' |
  'asset_ids' | 'metric_ids' | 'verified'
>

export interface TanggangPointOption {
  id:number
  name:string
  tag_name:string
  node_id:string
  value_type:string
}

export function fetchTanggangSystems() {
  return http.get<ApiResponse<Array<{id:TanggangSystemId;name:string}>>>('/tanggang/systems')
}

export function fetchTanggangObjectLinks(params: {
  object_id?:string;facility_id?:string;system_id?:TanggangSystemId
  asset_id?:number;metric_id?:number;page?:number;page_size?:number;include_latest?:boolean
}) {
  return http.get<ApiResponse<PageResult<TanggangObjectLink>>>('/tanggang/object-links', {
    params, silent:true,
  })
}

export function createTanggangObjectLink(body:TanggangObjectLinkBody) {
  return http.post<ApiResponse<TanggangObjectLink>>('/tanggang/object-links',body,{silent:true})
}

export function updateTanggangObjectLink(id:number,body:TanggangObjectLinkBody) {
  return http.put<ApiResponse<TanggangObjectLink>>('/tanggang/object-links/'+id,body,{silent:true})
}

export function deleteTanggangObjectLink(id:number) {
  return http.delete<ApiResponse<{id:number;deleted:boolean}>>('/tanggang/object-links/'+id,{silent:true})
}

/** Only loaded on edit; reuse existing authenticated equipment and SCADA option endpoints. */
export function fetchTanggangBindingOptions() {
  return Promise.all([
    http.get<ApiResponse<OptionItem[]>>('/equipment/options',{silent:true}),
    http.get<ApiResponse<TanggangPointOption[]>>('/scada/points/options',{silent:true}),
  ])
}

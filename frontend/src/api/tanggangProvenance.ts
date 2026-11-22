/** Tanggang 5190 is a user-document-based software demonstration, NOT live SCADA. */
import http from './http'
import type {ApiResponse,PageResult} from './types'
import type {TanggangSystemId, TanggangDataMode} from './tanggang'

export type PointBasis = 'UNVERIFIED'|'DOCUMENT_REFERENCE'|'ASSUMPTION'|'DEMO_VALUE'

export const POINT_BASIS_LABEL:Record<PointBasis,string>={
  UNVERIFIED:'尚未核对',
  DOCUMENT_REFERENCE:'上传资料参考',
  ASSUMPTION:'依据资料推导',
  DEMO_VALUE:'演示假设',
}
export interface TanggangDataContext {
  stage:'DOCUMENT_BASED_DEMO'
  sources_scope:'USER_UPLOADED_MATERIALS'
  field_data_confirmed:boolean
  production_plc_connected:boolean
  real_hydraulic_topology_confirmed:boolean
  point_mapping_field_verified:boolean
  eligible_measured_point_count:number
  labels:Record<PointBasis,string>
  numeric_values_policy:string
  review_policy:string
}
export interface PointAuditItem {
  point_id:number
  tag_name:string
  node_id:string
  equipment_id:number|null
  unit:string|null
  description:string|null
  data_mode:TanggangDataMode
  field_verified:false
  linked_systems:TanggangSystemId[]
  system_id:TanggangSystemId|null
  basis_type:PointBasis
  source_ref:string|null
  assumption_note:string|null
  updated_by:number|null
  updated_at:string|null
}
export interface PointAuditResponse extends PageResult<PointAuditItem> {
  context:{
    stage:'DOCUMENT_BASED_DEMO'
    field_verified_count:0
    total_existing_scada_points:number
    review_records:number
  }
}
export interface PointReviewBody {
  system_id:TanggangSystemId
  basis_type:PointBasis
  source_ref:string|null
  assumption_note:string|null
}
export const fetchTanggangDataContext=()=>http.get<ApiResponse<TanggangDataContext>>(
  '/tanggang/data-context',{silent:true},
)
export function fetchTanggangPointAudit(params:{
  page?:number;page_size?:number;keyword?:string;system_id?:TanggangSystemId;basis_type?:PointBasis
}){
  return http.get<ApiResponse<PointAuditResponse>>('/tanggang/point-audit',{
    params,silent:true,
  })
}
export function saveTanggangPointReview(pointId:number,body:PointReviewBody){
  return http.put<ApiResponse<PointAuditItem>>('/tanggang/point-reviews/'+pointId,body,{silent:true})
}

export interface SystemReadinessItem {
  id:TanggangSystemId
  name:string
  object_links:number
  object_identity_reviewed:number
  object_source_refs:number
  linked_facility_ids:string[]
  asset_bound_facility_ids:string[]
  asset_links:number
  point_links:number
  point_candidates:number
  point_document_references:number
  point_assumptions:number
  point_demo_values:number
  point_without_review:number
  point_without_object_link:number
  point_system_discrepancies:number
  stale_asset_links:number
  stale_point_links:number
  issues:string[]
  status:'DOCUMENT_PREPARATION_ONLY'
  field_verified:false
  scada_commissioned:false
  hydraulic_topology_verified:false
}
export interface TanggangReadinessResponse {
  stage:'DOCUMENT_BASED_DEMO'
  basis:'PERSISTED_SOFTWARE_CONFIGURATION'
  field_verified:false
  scada_commissioned:false
  measured_point_count:0
  systems:SystemReadinessItem[]
  inventory:{
    registered_scada_points:number
    unassigned_scada_points:number
    reviewed_scada_points:number
    registered_object_links:number
  }
  notice:string
}
export interface PointReviewRevision {
  point_id:number
  actor_id:number
  created_at:string
  before:PointReviewBody|null
  after:PointReviewBody
}
export const fetchTanggangReadiness=()=>http.get<ApiResponse<TanggangReadinessResponse>>(
  '/tanggang/integration-readiness',{silent:true},
)
export const fetchPointReviewHistory=(pointId:number)=>http.get<ApiResponse<PointReviewRevision[]>>(
  '/tanggang/point-reviews/'+pointId+'/revisions',{silent:true},
)

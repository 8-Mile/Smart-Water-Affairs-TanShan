/** M19 CAD candidate review: never interpreted as verified physical piping. */
import http from './http'
import type {ApiResponse} from './types'

export type CadProcessSystemId='middle'|'mineral'|'rain'|'pool'|'domestic'
export type CadCandidateStatus='candidate'|'rejected'
export interface CadConnectionCandidate {
  system_id:CadProcessSystemId
  connection_id:string
  layer:string
  source_handles:string[]
  review_note:string
  status:CadCandidateStatus
  revision:number
  evidence_version:'L1 V2.8'
  updated_by:number
  updated_at:string|null
  physical_connection_verified:false
}
export interface CadConnectionItem {
  connection_id:string
  source_node_id:string
  target_node_id:string
  medium:'water'|'sludge'|'chemical'|'signal'
  relation:'design'|'conditional'
  label:string|null
  candidate_layer:string|null
  diagram_compatible:boolean
  candidate:CadConnectionCandidate|null
  physical_connection_verified:false
}
export interface CadConnectionInventory {
  system_id:CadProcessSystemId
  source_version:'L1 V2.8'
  scope:string
  can_edit:boolean
  can_verify_physical_connection:false
  items:CadConnectionItem[]
  total:number
  candidate_eligible:number
  candidate_recorded:number
}
export interface CadCandidateDraft {
  revision:number
  layer:string
  source_handles:string[]
  review_note:string
  status:CadCandidateStatus
}
const prefix='/tanggang/cad-connection-candidates'
export const fetchCadConnectionCandidates=(systemId:CadProcessSystemId)=>
  http.get<ApiResponse<CadConnectionInventory>>(prefix+'/'+systemId,{silent:true})
export const saveCadConnectionCandidate=(systemId:CadProcessSystemId,
  connectionId:string,payload:CadCandidateDraft)=>
  http.put<ApiResponse<CadConnectionCandidate>>(
    prefix+'/'+systemId+'/'+encodeURIComponent(connectionId),
    payload,{silent:true})
export const fetchCadCandidateHistory=(systemId:CadProcessSystemId,
  connectionId:string)=>
  http.get<ApiResponse<Array<CadConnectionCandidate&{actor_id:number;created_at:string}>>>(
    prefix+'/'+systemId+'/'+encodeURIComponent(connectionId)+'/history',{silent:true})

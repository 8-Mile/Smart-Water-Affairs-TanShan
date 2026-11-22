/** 5190受控A2UI看板：服务器持久化、发布目标页面与角色。数据仅当前浏览器SIM。 */
import http from './http'
import type {ApiResponse} from './types'

export type BoardTarget='/port/water/supply'|'/port/operations/monitor'
export type MetricId='supply-demand'|'supply-capacity'|'supply-shortage'|
  'pool-forecast'|'monitor-risk'|'monitor-rule-count'|'supply-coverage'
export type WidgetKind='metric'|'terminal-table'|'monitor-rules'|'plan-comparison'

export interface BoardWidget {
  id:string
  kind:WidgetKind
  metric:MetricId|null
}
export interface TanggangBoard {
  id:number
  title:string
  target_path:BoardTarget
  owner_id:number
  widgets:BoardWidget[]
  status:'draft'|'published'
  allowed_role_codes:string[]
  version:number
  created_at:string
  updated_at:string
  data_mode:'SIM'
  field_verified:false
}
export interface BoardBody {
  title:string
  target_path:BoardTarget
  widgets:BoardWidget[]
  version?:number
}
export interface BoardCatalog {
  targets:Array<{path:BoardTarget;label:string}>
  metrics:Array<{id:MetricId;label:string}>
  kinds:WidgetKind[]
  source_mode:'SIM'
  stage:'DOCUMENT_BASED_DEMO'
}
export interface BoardRevision {
  version:number
  action:'create'|'update'|'publish'|'revoke'
  actor_id:number
  created_at:string
  snapshot:TanggangBoard
}
const prefix='/tanggang/boards'
export const fetchBoardCatalog=()=>http.get<ApiResponse<BoardCatalog>>(prefix+'/catalog',{silent:true})
export const fetchMyBoards=()=>http.get<ApiResponse<TanggangBoard[]>>(prefix+'/mine',{silent:true})
export const fetchBoardDetail=(id:number)=>http.get<ApiResponse<TanggangBoard>>(prefix+'/'+id,{silent:true})
export const fetchPublishedBoards=(target:BoardTarget)=>http.get<ApiResponse<TanggangBoard[]>>(
  prefix+'/published',{params:{target_path:target},silent:true},
)
export const createBoard=(body:BoardBody)=>http.post<ApiResponse<TanggangBoard>>(prefix,body,{silent:true})
export const updateBoard=(id:number,body:BoardBody)=>http.put<ApiResponse<TanggangBoard>>(
  prefix+'/'+id,body,{silent:true},
)
export const fetchBoardRoles=()=>http.get<ApiResponse<Array<{code:string;name:string}>>>(
  prefix+'/roles',{silent:true},
)
export const publishBoard=(id:number,version:number,roleCodes:string[])=>
  http.post<ApiResponse<TanggangBoard>>(prefix+'/'+id+'/publish',{
    version,allowed_role_codes:roleCodes,
  },{silent:true})
export const revokeBoard=(id:number,version:number)=>
  http.post<ApiResponse<TanggangBoard>>(prefix+'/'+id+'/revoke',{version},{silent:true})
export const fetchBoardHistory=(id:number)=>http.get<ApiResponse<BoardRevision[]>>(
  prefix+'/'+id+'/history',{silent:true},
)

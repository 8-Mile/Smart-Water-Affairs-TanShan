/**
 * Restored 2D SCADA-like diagram editor schema: server stored, never PLC controls.
 * Porting the old SprayProcessCanvas node/connection/point binding contract.
 */
import http from './http'
import type {ApiResponse} from './types'

export type FogSymbolId=
  'fog_cannon'|'water_tank'|'centrifugal_pump'|'pressure_gauge'|
  'flow_meter'|'butterfly_valve'|'label'|'generic_equipment'|
  'pipe_straight'|'pipe_elbow'|'pipe_tee'|'pipe_cross'|'y_strainer'

export interface ProcessDiagramNode {
  id:string
  symbol_id:FogSymbolId
  facility_id:string|null
  label:string
  position:{x:number;y:number}
  size:{width:number;height:number}
  point_keys:string[]
  visible:boolean
  locked:boolean
}
export interface ProcessDiagramConnection {
  id:string
  source_node_id:string
  target_node_id:string
  medium:'water'|'signal'|'sludge'|'chemical'
  /** Design-functional or conditional option; never field-confirmed. */
  relation?:'design'|'conditional'
  label?:string|null
  verification:'illustrative'
}
export type EditableProcessSystemId='fog'|'middle'|'mineral'|'rain'|'pool'|'domestic'

export interface ProcessDiagramDocument {
  system_id:EditableProcessSystemId
  name:string
  view_box:{width:number;height:number}
  background:'light-grid'
  nodes:ProcessDiagramNode[]
  connections:ProcessDiagramConnection[]
}
export interface ProcessDiagramRecord {
  system_id:EditableProcessSystemId
  name:string
  draft:ProcessDiagramDocument|null
  published:ProcessDiagramDocument|null
  revision:number
  published_version:number
  can_edit:boolean
  data_mode:'SIM'
  field_verified:false
  control_enabled:false
}
export interface ProcessDiagramRevision {
  version:number
  revision:number
  snapshot:ProcessDiagramDocument
  created_at:string
  actor_id:number
}
const path=(systemId:EditableProcessSystemId)=>'/tanggang/process-diagrams/'+systemId

export const fetchProcessDiagram=(systemId:EditableProcessSystemId)=>
  http.get<ApiResponse<ProcessDiagramRecord>>(path(systemId),{silent:true})
export const saveProcessDiagramDraft=(systemId:EditableProcessSystemId,
  diagram:ProcessDiagramDocument,revision:number)=>
  http.put<ApiResponse<ProcessDiagramRecord>>(path(systemId)+'/draft',
    {diagram,revision},{silent:true})
export const publishProcessDiagram=(systemId:EditableProcessSystemId,revision:number)=>
  http.post<ApiResponse<ProcessDiagramRecord>>(path(systemId)+'/publish',{revision},{silent:true})
export const fetchProcessDiagramHistory=(systemId:EditableProcessSystemId)=>
  http.get<ApiResponse<ProcessDiagramRevision[]>>(path(systemId)+'/history',{silent:true})
export const restoreProcessDiagram=(systemId:EditableProcessSystemId,
  version:number,revision:number)=>
  http.post<ApiResponse<ProcessDiagramRecord>>(path(systemId)+'/restore',
    {version,revision},{silent:true})

// Backward compatible entry points for the existing 5144-style fog editor.
export const fetchFogProcessDiagram=()=>fetchProcessDiagram('fog')
export const saveFogDiagramDraft=(diagram:ProcessDiagramDocument,revision:number)=>
  saveProcessDiagramDraft('fog',diagram,revision)
export const publishFogDiagram=(revision:number)=>publishProcessDiagram('fog',revision)
export const fetchFogDiagramHistory=()=>fetchProcessDiagramHistory('fog')
export const restoreFogDiagram=(version:number,revision:number)=>
  restoreProcessDiagram('fog',version,revision)

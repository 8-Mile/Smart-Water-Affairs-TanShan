import http from './http'
import type {ApiResponse,PageResult} from './types'
import type {TanggangSystemId} from './tanggang'

export interface ParsedDemoEquipment {
  parse_mode:'CONTROLLED_TEMPLATE_NOT_LLM'
  system_id:TanggangSystemId|null
  name:string
  code:string
  parameters_note:string
  missing:string[]
  request_text:string
  data_mode:'SIM'
  field_verified:false
  source_requirement:string
}
export interface DemoEquipment {
  id:number
  system_id:TanggangSystemId
  system_name:string
  name:string
  code:string
  parameters_note:string|null
  request_text:string
  source_note:string
  created_by:number
  created_at:string
  data_mode:'SIM'
  field_verified:false
  in_official_equipment:false
}
export interface DemoEquipmentBody {
  system_id:TanggangSystemId
  name:string
  code:string
  parameters_note:string|null
  request_text:string
  source_note:string
  confirmed:boolean
}
const prefix='/tanggang/demo-equipment'
export function parseDemoEquipment(text:string){
  return http.post<ApiResponse<ParsedDemoEquipment>>(prefix+'/parse',{text},{silent:true})
}
export function createDemoEquipment(body:DemoEquipmentBody){
  return http.post<ApiResponse<DemoEquipment>>(prefix,body,{silent:true})
}
export function listDemoEquipment(){
  return http.get<ApiResponse<PageResult<DemoEquipment>>>(prefix,{silent:true})
}

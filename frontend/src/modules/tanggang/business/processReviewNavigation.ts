/**
 * The origin is browser-only and scoped to one SIM UUID.
 * Query strings are untrusted: never use an arbitrary supplied facility path
 * as an official equipment/repair record without a matching local SIM note.
 */
import type {LocationQuery} from 'vue-router'
import type {SimProcessCheck} from '../simulation/store'

export function simNodeOrigin(
  query:LocationQuery,
  checks:readonly SimProcessCheck[],
  runUid:string,
):SimProcessCheck|null {
  if(!runUid)return null
  const sid=query.from_system
  const fid=query.from_facility
  const uid=query.run_uid
  if(typeof sid!=='string'||typeof fid!=='string'||typeof uid!=='string'
    ||uid!==runUid)return null
  return checks.find(c=>c.system_id===sid&&c.facility_id===fid&&
    c.run_uid===runUid)||null
}

export function simNodeReturnPath(note:SimProcessCheck):string {
  return '/port/process/'+note.system_id+'?facility='+
    encodeURIComponent(note.facility_id)
}

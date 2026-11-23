import {defineStore} from 'pinia'
import {computed,reactive} from 'vue'
import {
  SPECIALIST_CASES,SPECIALIST_SYSTEM_IDS,getSpecialistCase,
  type SpecialistSystem,type SpecialistProfileId,
} from './processSpecialist'

export interface SpecialistExerciseRecord {
  system_id:SpecialistSystem
  profile_id:SpecialistProfileId
  scenario_title:string
  checkpoint_ids:string[]
  operator_note:string
  conclusion:string
  recorded_at:string
  data_mode:'MOCK'
  field_verified:false
  production_alarm_created:false
  repair_order_created:false
  commands_issued:false
  independent_of_global_sim:true
}

export const useProcessSpecialistStore=defineStore('tg-process-specialist-mock',()=>{
  const selected=reactive<Record<SpecialistSystem,SpecialistProfileId|null>>({
    fog:null,mineral:null,domestic:null,
  })
  const reviewed=reactive<Record<SpecialistSystem,string[]>>({
    fog:[],mineral:[],domestic:[],
  })
  const records=reactive<Record<SpecialistSystem,SpecialistExerciseRecord|null>>({
    fog:null,mineral:null,domestic:null,
  })
  const activeCount=computed(()=>Object.values(selected).filter(Boolean).length)
  function select(systemId:SpecialistSystem,profileId:SpecialistProfileId|null){
    if(profileId!==null&&!SPECIALIST_SYSTEM_IDS[systemId].includes(profileId))
      throw Error('专业Mock工况与当前工艺系统不匹配')
    selected[systemId]=profileId
    reviewed[systemId]=[]
    records[systemId]=null
  }
  function mark(systemId:SpecialistSystem,checkpointId:string,checked:boolean){
    const current=getSpecialistCase(selected[systemId],systemId)
    if(!current)throw Error('尚未选择专业Mock工况')
    if(!current.checkpoints.some(point=>point.id===checkpointId))
      throw Error('演练检查节点不属于当前工况')
    reviewed[systemId]=checked
      ?Array.from(new Set([...reviewed[systemId],checkpointId]))
      :reviewed[systemId].filter(x=>x!==checkpointId)
    records[systemId]=null
  }
  function finish(systemId:SpecialistSystem,note:string):SpecialistExerciseRecord{
    const current=getSpecialistCase(selected[systemId],systemId)
    if(!current)throw Error('尚未选择专业Mock工况')
    if(!current.checkpoints.every(x=>reviewed[systemId].includes(x.id)))
      throw Error('请先逐项完成所有Mock节点查看')
    const clean=note.trim()
    if(clean.length<8||clean.length>500)
      throw Error('请填写8至500字的模拟演练结论')
    const record:SpecialistExerciseRecord={
      system_id:systemId,profile_id:current.id,
      scenario_title:current.label,
      checkpoint_ids:current.checkpoints.map(x=>x.id),
      operator_note:clean,conclusion:current.outcomeTitle,
      recorded_at:new Date().toISOString(),data_mode:'MOCK',
      field_verified:false,production_alarm_created:false,
      repair_order_created:false,commands_issued:false,
      independent_of_global_sim:true,
    }
    records[systemId]=record
    return record
  }
  function reset(systemId:SpecialistSystem){select(systemId,null)}
  return {selected,reviewed,records,activeCount,select,mark,finish,reset}
})

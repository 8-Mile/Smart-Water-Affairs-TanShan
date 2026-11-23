<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ElMessage} from 'element-plus'
import {
  SPECIALIST_CASES,SPECIALIST_SYSTEM_IDS,specialistAttentionFacilityIds,
  type SpecialistCase,type SpecialistSystem,type SpecialistProfileId,
} from './processSpecialist'
import {useProcessSpecialistStore} from './processSpecialistStore'

const props=defineProps<{
  systemId:SpecialistSystem
  globalSimRunning:boolean
}>()
const emit=defineEmits<{selectFacility:[id:string]}>()
const store=useProcessSpecialistStore()
const caseOptions=computed(()=>SPECIALIST_SYSTEM_IDS[props.systemId].map(id=>({
  label:SPECIALIST_CASES[id].label,value:id,
})))
const activeCase=computed<SpecialistCase|null>(()=>{
  const id=store.selected[props.systemId]
  return id?SPECIALIST_CASES[id]:null
})
const checked=computed(()=>store.reviewed[props.systemId])
const affectedIds=computed(()=>
  activeCase.value&&activeCase.value.outcome==='attention'
    ?specialistAttentionFacilityIds(activeCase.value):[],
)
const record=computed(()=>store.records[props.systemId])
const note=ref('')
const formError=ref('')
const expanded=ref(false)
watch(()=>[props.systemId,store.selected[props.systemId]],()=>{
  note.value=record.value?.operator_note||''
  formError.value=''
  expanded.value=false
})
function onSelect(id:string){
  if(props.globalSimRunning)return
  store.select(props.systemId,id?(id as SpecialistProfileId):null)
}
function mark(pointId:string,enabled:boolean){
  if(props.globalSimRunning)return
  store.mark(props.systemId,pointId,enabled)
}
function toggleCheckpoint(pointId:string,value:unknown){
  mark(pointId,!!value)
}
function finish(){
  if(props.globalSimRunning)return
  try{
    formError.value=''
    store.finish(props.systemId,note.value)
    expanded.value=false
    ElMessage.success('专业Mock演练已完成；仅保存在当前浏览器内存')
  }catch(e){
    formError.value=e instanceof Error?e.message:'Mock演练记录失败'
  }
}
function downloadRecord(){
  if(!record.value)return
  const file={
    kind:'TANGGANG_SPECIALIST_MOCK_EXERCISE',
    ...record.value,
    declaration:'仅专业Mock操作演练，不构成真实工艺运行、现场核验、告警或维修工单',
  }
  const blob=new Blob([JSON.stringify(file,null,2)],{type:'application/json'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a')
  a.href=url
  a.download='唐港-'+props.systemId+'-专业Mock演练.json'
  document.body.append(a);a.click();a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1600)
}
</script>

<template>
  <section class="tg-biz-card tg-specialist" data-testid="specialist-exercise">
    <div class="tg-biz-card-head">
      <h2>专业Mock工艺演练</h2>
      <span class="tg-specialist-mode">软件演示 · 无设备控制</span>
    </div>
    <div class="tg-specialist-select">
      <label for="tg-specialist-mode">演练工况</label>
      <el-select id="tg-specialist-mode"
        :model-value="store.selected[systemId]||''"
        :disabled="globalSimRunning"
        clearable placeholder="选择本系统Mock工况"
        aria-label="选择专业Mock演练工况"
        @change="onSelect">
        <el-option v-for="option in caseOptions" :key="option.value"
          :label="option.label" :value="option.value"/>
      </el-select>
      <el-button v-if="activeCase" size="small" text
        :disabled="globalSimRunning"
        @click="store.reset(systemId)">重置</el-button>
    </div>
    <div v-if="globalSimRunning" class="tg-specialist-notice" role="status">
      当前统一供水/雨水SIM正在运行。专业Mock演练暂时停用，避免两套独立模型混用。
      可从统一情景控制台退出SIM后继续。
    </div>
    <template v-else-if="activeCase">
      <div class="tg-specialist-headline">
        <strong>{{activeCase.outcomeTitle}}</strong>
        <span v-if="activeCase.outcome==='attention'">Mock提示</span>
      </div>
      <p class="tg-specialist-rule">{{activeCase.rule}}</p>
      <div class="tg-specialist-compact">
        <span>设计环节：{{activeCase.checkpoints.map(x=>x.title).join(' · ')}}</span>
        <el-button v-if="affectedIds.length" size="small" plain
          data-testid="specialist-focus"
          @click="emit('selectFacility',affectedIds[0]!)">
          定位Mock关注节点（{{affectedIds.length}}）
        </el-button>
        <el-button size="small" link type="primary" @click="expanded=!expanded">
          {{expanded?'收起演练操作':record?'查看演练过程':'展开演练操作'}}
        </el-button>
      </div>
      <div v-if="record&&!expanded" class="tg-specialist-summary">
        <strong>本轮Mock已完成 · 无生产事件</strong>
        <span>{{record.operator_note}}</span>
        <el-button size="small" plain @click="downloadRecord">导出演练记录</el-button>
      </div>
      <template v-if="expanded">
      <p class="tg-specialist-scope">{{activeCase.scope}}</p>
      <div class="tg-specialist-step-head">
        <strong>模拟操作顺序</strong>
        <span>{{checked.length}} / {{activeCase.checkpoints.length}} 已查看</span>
      </div>
      <div class="tg-specialist-steps">
        <div v-for="(step,i) in activeCase.checkpoints" :key="step.id"
          class="tg-specialist-step">
          <span class="tg-specialist-step-num">{{i+1}}</span>
          <div class="tg-specialist-step-content">
            <strong>{{step.title}}</strong>
            <p>{{step.action}}</p>
            <div class="tg-specialist-step-actions">
              <el-button size="small" link type="primary"
                @click="emit('selectFacility',step.facilityId)">定位设施</el-button>
              <el-checkbox :model-value="checked.includes(step.id)"
                @change="toggleCheckpoint(step.id,$event)">已查看Mock</el-checkbox>
            </div>
          </div>
        </div>
      </div>
      <p class="tg-specialist-action">{{activeCase.suggestedAction}}</p>
      <el-input v-model="note" :rows="2" type="textarea" :maxlength="500"
        :disabled="!!record"
        show-word-limit placeholder="记录本次模拟排查结论（8至500字，不代表现场巡检）"/>
      <p v-if="formError" class="tg-specialist-error" role="alert">{{formError}}</p>
      <div class="tg-biz-actions tg-specialist-footer">
        <el-button v-if="!record" size="small" type="primary" plain
          data-testid="specialist-finish" :disabled="checked.length!==activeCase.checkpoints.length||note.trim().length<8"
          @click="finish">完成专业Mock演练</el-button>
        <template v-else>
          <span class="tg-specialist-success">本轮Mock已完成 · 未产生生产事件</span>
          <el-button size="small" plain @click="downloadRecord">导出演练记录</el-button>
        </template>
      </div>
      </template>
    </template>
    <p v-else class="tg-specialist-empty">
      根据CAD资料中的实际设施类别选择一项Mock工况，逐个定位设计节点并记录模拟检查。
      这与统一供水/雨水SIM相互独立，不生成正式告警、工单或PLC指令。
    </p>
  </section>
</template>

<style scoped>
.tg-specialist{padding:15px 18px;min-width:0;display:grid;gap:11px}
.tg-specialist .tg-biz-card-head{margin-bottom:0}
.tg-specialist h2{font-size:15px}
.tg-specialist-mode{font-size:11px;color:#839aa7}
.tg-specialist-select{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.tg-specialist-select label{font-size:12px;white-space:nowrap;color:#6d8998}
.tg-specialist-select :deep(.el-select){flex:1;min-width:180px;max-width:390px}
.tg-specialist-headline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tg-specialist-headline strong{font-size:13px;font-weight:650;color:#386982}
.tg-specialist-headline span{font-size:10px;color:#a17a3f}
.tg-specialist-scope,.tg-specialist-rule,.tg-specialist-empty,.tg-specialist-notice{
 font-size:11px;line-height:1.7;color:#758d9c;margin:0}
.tg-specialist-rule{color:#7e98a7}
.tg-specialist-notice{color:#a37b45}
.tg-specialist-compact{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}
.tg-specialist-compact>span{color:#708c9b;font-size:11px;line-height:1.5;flex:1;min-width:145px}
.tg-specialist-summary{display:flex;align-items:center;gap:7px 12px;flex-wrap:wrap;
  padding:7px 10px;border:1px solid #dce9f0;border-radius:6px;background:rgba(242,248,251,.78)}
.tg-specialist-summary strong{font-size:11px;color:#4e879c;font-weight:650}
.tg-specialist-summary span{font-size:11px;line-height:1.55;color:#718d9d;flex:1;min-width:120px}
.tg-specialist-step-head{display:flex;justify-content:space-between;gap:8px;align-items:center}
.tg-specialist-step-head strong{font-size:12px;font-weight:650;color:#3a6680}
.tg-specialist-step-head span{font-size:11px;color:#859aa8}
.tg-specialist-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.tg-specialist-step{display:flex;gap:9px;border:1px solid #dfeaf0;border-radius:7px;
 background:rgba(246,250,252,.72);padding:10px;min-width:0}
.tg-specialist-step-num{display:flex;flex:0 0 22px;height:22px;border-radius:5px;
 background:#e7f1f7;justify-content:center;align-items:center;font-size:11px;
 color:#5088a1;font-weight:650}
.tg-specialist-step-content{min-width:0;flex:1}
.tg-specialist-step-content strong{font-size:12px;font-weight:620;color:#3c687f}
.tg-specialist-step-content p{font-size:11px;line-height:1.55;color:#748c9b;margin:6px 0}
.tg-specialist-step-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}
.tg-specialist-step-actions :deep(.el-checkbox){margin-right:0}
.tg-specialist-step-actions :deep(.el-checkbox__label){font-size:11px}
.tg-specialist-action{font-size:11px;line-height:1.6;color:#708d9d;margin:0}
.tg-specialist-error{color:#b66758;font-size:11px;margin:0}
.tg-specialist-footer{display:flex;align-items:center;flex-wrap:wrap;gap:9px}
.tg-specialist-success{font-size:11px;color:#54889b}
@media(max-width:700px){.tg-specialist-steps{grid-template-columns:minmax(0,1fr)}}
</style>

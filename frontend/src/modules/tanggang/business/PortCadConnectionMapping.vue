<script setup lang="ts">
/**
 * M19: Engineer's candidate register, never automatic pipe linkage.
 * Exact V2.8 Handles and matching medium/layer are checked again server-side.
 * No physical approval or production control exists in this workflow.
 */
import {computed,nextTick,onMounted,ref,watch} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {
  fetchCadConnectionCandidates,saveCadConnectionCandidate,
  fetchCadCandidateHistory,
  type CadConnectionInventory,type CadConnectionItem,
  type CadCandidateStatus,type CadProcessSystemId,type CadConnectionCandidate,
} from '@/api/tanggangCadConnection'
import {defaultProcessDiagram} from './fogDiagram'
import type {ProcessSchematicSection} from './processSchematic'

const props=defineProps<{
  systemId:CadProcessSystemId
  systemName:string
  sections:ProcessSchematicSection[]
  handlesByLayer:Record<string,string[]>
  selectedLayer:string
  selectedHandle:string
}>()
const inventory=ref<CadConnectionInventory|null>(null)
const loading=ref(false)
const busy=ref(false)
const error=ref('')
const selectedId=ref('')
const pendingSourceHandle=ref('')
const filter=ref<'eligible'|'all'|'recorded'>('eligible')
const handlesInput=ref('')
const reviewNote=ref('')
const history=ref<Array<CadConnectionCandidate&{
  actor_id:number;created_at:string
}>>([])
const showHistory=ref(false)
const flow=computed(()=>defaultProcessDiagram(props.systemId,props.systemName,props.sections))
const nodeLabels=computed(()=>new Map(flow.value.nodes.map(node=>[node.id,node.label])))
const items=computed(()=>inventory.value?.items||[])
const available=computed(()=>items.value.filter(x=>!!x.candidate_layer))
const recorded=computed(()=>items.value.filter(x=>x.candidate?.status==='candidate'))
const selected=computed(()=>items.value.find(x=>x.connection_id===selectedId.value)||null)
const shown=computed(()=>items.value.filter(x=>
  filter.value==='eligible'?!!x.candidate_layer:
  filter.value==='recorded'?x.candidate?.status==='candidate':true,
))
const handleTokens=computed(()=>handlesInput.value.trim().toUpperCase().split(
  /[\s,，;；]+/,
).filter(Boolean))
const validHandles=computed(()=>{
  const selectedLayer=selected.value?.candidate_layer
  if(!selectedLayer)return false
  const index=new Set(props.handlesByLayer[selectedLayer]||[])
  return handleTokens.value.length>0&&handleTokens.value.length<=8&&
    new Set(handleTokens.value).size===handleTokens.value.length&&
    handleTokens.value.every(x=>index.has(x))
})
const canSave=computed(()=>inventory.value?.can_edit&&selected.value?.candidate_layer&&
  selected.value.diagram_compatible&&validHandles.value&&
  reviewNote.value.trim().length>=12&&!busy.value)
const statusLabels:Record<CadCandidateStatus,string>={
  candidate:'候选关联 · 待核',rejected:'已驳回候选',
}
function labelFor(id:string){
  return nodeLabels.value.get(id)||id.replace(/^cad-|^ref-/,'')
}
function textOf(item:CadConnectionItem){
  return labelFor(item.source_node_id)+' → '+labelFor(item.target_node_id)
}
function parseError(e:unknown){
  if(e&&typeof e==='object'&&'response' in e){
    const details=(e as {response?:{data?:{detail?:string;message?:string}}}).response?.data
    return details?.detail||details?.message||'CAD关联服务拒绝请求'
  }
  return e instanceof Error?e.message:'CAD候选保存失败'
}
async function reload(){
  loading.value=true
  error.value=''
  try{
    inventory.value=(await fetchCadConnectionCandidates(props.systemId)).data.data
    if(!selectedId.value||!items.value.some(x=>x.connection_id===selectedId.value)){
      selectedId.value=available.value[0]?.connection_id||items.value[0]?.connection_id||''
    }
  }catch(e){error.value=parseError(e)}
  finally{loading.value=false}
}
onMounted(()=>{void reload()})
watch(selectedId,()=>{
  const saved=selected.value?.candidate
  handlesInput.value=saved?.source_handles.join(', ')||''
  reviewNote.value=saved?.review_note||''
  history.value=[]
  showHistory.value=false
})
watch(()=>props.selectedHandle,handle=>{
  if(!handle||!inventory.value)return
  // A candidate CAD Handle must NOT be silently assigned to the first link.
  // Require explicit process-link selection after choosing a source Handle.
  pendingSourceHandle.value=handle.toUpperCase()
  selectedId.value=''
  filter.value='eligible'
  ElMessage.info('已选取CAD源Handle；必须手动选择对应的设计流程连接并说明依据。')
})
async function choose(id:string){
  selectedId.value=id
  await nextTick()
  if(pendingSourceHandle.value){
    if(selected.value?.candidate_layer===props.selectedLayer){
      handlesInput.value=pendingSourceHandle.value
      reviewNote.value=''
      pendingSourceHandle.value=''
    }else{
      ElMessage.warning('所选流程连接与该CAD源Handle的图层不匹配，请重新选取。')
    }
  }
}
async function save(status:CadCandidateStatus){
  if(!canSave.value||!selected.value?.candidate_layer)return
  if(status==='rejected'&&!selected.value.candidate)return
  if(status==='rejected'){
    try{
      await ElMessageBox.confirm(
        '此操作仅驳回当前候选映射，不会改变组态图和其他CAD原始证据。',
        '驳回候选',{type:'warning'},
      )
    }catch{return}
  }
  busy.value=true
  error.value=''
  const connectionId=selected.value.connection_id
  try{
    const response=await saveCadConnectionCandidate(
      props.systemId,connectionId,{
        revision:selected.value.candidate?.revision||0,
        layer:selected.value.candidate_layer,
        source_handles:handleTokens.value,review_note:reviewNote.value.trim(),status,
      },
    )
    await reload()
    selectedId.value=connectionId
    handlesInput.value=response.data.data.source_handles.join(', ')
    reviewNote.value=response.data.data.review_note
    ElMessage.success(status==='candidate'?'CAD源管段候选已登记，仍需工程核验':'候选关联已驳回')
  }catch(e){
    error.value=parseError(e)
  }finally{busy.value=false}
}
async function toggleHistory(){
  if(showHistory.value){showHistory.value=false;return}
  if(!selectedId.value)return
  try{
    history.value=(await fetchCadCandidateHistory(props.systemId,selectedId.value)).data.data
    showHistory.value=true
  }catch(e){error.value=parseError(e)}
}
</script>

<template>
  <div class="tg-cad-linkage" data-testid="cad-connection-mapping">
    <div class="tg-cad-linkage-head">
      <div>
        <strong>设计流程 ↔ CAD源管段候选关联</strong>
        <p>仅登记人工判断的源Handle候选，不代表组态设备与管段已核实连接</p>
      </div>
      <small v-if="inventory">设计连接 {{inventory.total}} 条 ·
        图层可提出候选 {{inventory.candidate_eligible}} 条 ·
        已录入待核 {{inventory.candidate_recorded}} 条 · 工程核实 0 条
      </small>
    </div>
    <p v-if="loading" class="tg-cad-linkage-note">读取候选关联台账…</p>
    <p v-if="error" class="tg-cad-linkage-error" role="alert">{{error}}</p>
    <template v-if="inventory">
      <div class="tg-cad-linkage-controls">
        <button :class="{active:filter==='eligible'}" @click="filter='eligible'">
          可登记候选（{{available.length}}）
        </button>
        <button :class="{active:filter==='recorded'}" @click="filter='recorded'">
          已登记（{{recorded.length}}）
        </button>
        <button :class="{active:filter==='all'}" @click="filter='all'">
          全部连接（{{items.length}}）
        </button>
      </div>
      <p v-if="pendingSourceHandle" class="tg-cad-linkage-note"
        data-testid="cad-link-select-required">
        已选Handle {{pendingSourceHandle}}（{{selectedLayer}}）。请在下方明确选定设计流程连接；系统不会自动匹配设备。
      </p>
      <div class="tg-cad-linkage-list" data-testid="cad-connection-rows">
        <button v-for="item in shown" :key="item.connection_id"
          :class="{active:selectedId===item.connection_id,unsupported:!item.candidate_layer}"
          :data-connection-id="item.connection_id"
          @click="choose(item.connection_id)">
          <code>{{item.connection_id}}</code>
          <span>{{textOf(item)}}</span>
          <small>{{item.candidate?
            statusLabels[item.candidate.status]:
            item.candidate_layer?'尚未登记候选':'缺少可用同介质CAD图层'}}</small>
        </button>
      </div>
      <template v-if="selected">
        <div class="tg-cad-linkage-edit" data-testid="cad-candidate-editor">
          <div class="tg-cad-linkage-selected">
            <strong>{{selected.connection_id}} · {{textOf(selected)}}</strong>
            <span>{{selected.medium==='sludge'?'污泥':
              selected.medium==='water'?'水路':
              selected.medium==='chemical'?'加药':'控制信号'}} ·
              {{selected.relation==='conditional'?'条件路径':'设计关系'}}
            </span>
          </div>
          <template v-if="selected.candidate_layer">
            <p v-if="!selected.diagram_compatible" class="tg-cad-linkage-error">
              已发布组态中的连接端点与证据索引不同，当前不能编辑候选。请先完成工程校核。
            </p>
            <label class="tg-cad-linkage-label">
              允许的CAD专业图层
              <strong>{{selected.candidate_layer}}</strong>
            </label>
            <label class="tg-cad-linkage-label" for="tg-m19-handle">
              CAD源Handle（最多8个，以逗号分隔）
            </label>
            <el-input id="tg-m19-handle" v-model="handlesInput" size="small"
              data-testid="candidate-handle-input"
              :disabled="!inventory.can_edit||!selected.diagram_compatible"
              placeholder="从下方V2.8端点台账选取，或输入现有Handle"/>
            <p v-if="handlesInput&&!validHandles" class="tg-cad-linkage-error">
              Handle必须存在于该专业图层的V2.8源台账，不能填写邻近猜测值。
            </p>
            <label class="tg-cad-linkage-label" for="tg-m19-note">
              工程关联理由（至少12字；明确哪些接口和图纸仍待核）
            </label>
            <el-input id="tg-m19-note" v-model="reviewNote" type="textarea"
              :rows="3" maxlength="1200" show-word-limit
              data-testid="candidate-review-note"
              :disabled="!inventory.can_edit||!selected.diagram_compatible"
              placeholder="写明依据、图纸版本、尚未核实的设备接口或管段端点；不得填写已实测结论"/>
            <div class="tg-cad-linkage-footer">
              <span>状态：{{selected.candidate?
                statusLabels[selected.candidate.status]:'未登记'}} ·
                {{selected.candidate?.evidence_version||'L1 V2.8'}} ·
                不支持自动工程确认</span>
              <el-button size="small" plain :disabled="!selected.candidate"
                data-testid="candidate-show-history"
                @click="toggleHistory">修改记录</el-button>
              <el-button size="small" plain
                :disabled="!selected.candidate||!canSave"
                data-testid="candidate-reject" @click="save('rejected')">
                驳回候选
              </el-button>
              <el-button type="primary" size="small" :disabled="!canSave"
                data-testid="candidate-save" @click="save('candidate')">
                {{busy?'保存中':'登记待核候选'}}
              </el-button>
            </div>
            <div v-if="showHistory" class="tg-cad-linkage-history"
              data-testid="candidate-history">
              <p v-for="item in history" :key="item.revision">
                v{{item.revision}} · {{statusLabels[item.status]}} ·
                {{item.source_handles.join('、')}} · {{item.review_note}}
              </p>
            </div>
          </template>
          <p v-else class="tg-cad-linkage-note">
            该连接缺少对应介质与设备范围的CAD源管线图层。
            不允许用其他图层的Handle充数；需补充原始DWG和接口资料。
          </p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.tg-cad-linkage{margin:12px 0;border:1px solid #d7e5ed;border-radius:8px;
  padding:14px;background:#f8fbfd}
.tg-cad-linkage-head{display:flex;align-items:flex-start;justify-content:space-between;
  flex-wrap:wrap;gap:8px 16px}
.tg-cad-linkage-head strong{font-size:13px;color:#3a6b84}
.tg-cad-linkage-head p{margin:4px 0;color:#7b93a1;font-size:11px}
.tg-cad-linkage-head small{font-size:10px;color:#62869b}
.tg-cad-linkage-controls{display:flex;flex-wrap:wrap;gap:5px;margin:13px 0 8px}
.tg-cad-linkage-controls button{border:1px solid #d5e6ed;background:#fff;
  border-radius:5px;padding:6px 12px;font:inherit;font-size:11px;
  color:#5c8093;cursor:pointer}
.tg-cad-linkage-controls button.active{background:#e6f4f9;border-color:#83b9ce;
  color:#347c9a;font-weight:650}
.tg-cad-linkage-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:6px;max-height:260px;overflow:auto}
.tg-cad-linkage-list button{min-width:0;text-align:left;display:flex;
  align-items:center;gap:7px;flex-wrap:wrap;border:1px solid #dceaf1;
  background:#fff;border-radius:5px;padding:9px;cursor:pointer;font:inherit}
.tg-cad-linkage-list button.active{border-color:#72abc6;background:#ecf7fb}
.tg-cad-linkage-list button.unsupported{opacity:.65}
.tg-cad-linkage-list code{font-size:10px;color:#5388a3}
.tg-cad-linkage-list span{font-size:11px;color:#3c647a;line-height:1.5}
.tg-cad-linkage-list small{font-size:10px;color:#a0835a}
.tg-cad-linkage-edit{border-top:1px solid #e1eaf0;margin-top:12px;padding-top:12px}
.tg-cad-linkage-selected{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin-bottom:10px}
.tg-cad-linkage-selected strong{font-size:12px;color:#37667f}
.tg-cad-linkage-selected span{font-size:10px;color:#688898}
.tg-cad-linkage-label{display:block;font-size:11px;color:#628397;margin:9px 0 5px}
.tg-cad-linkage-label strong{color:#3e718b;margin-left:8px}
.tg-cad-linkage-footer{display:flex;align-items:center;flex-wrap:wrap;
  gap:7px;margin-top:13px}
.tg-cad-linkage-footer span{font-size:10px;color:#829baa;margin-right:auto}
.tg-cad-linkage-error{color:#a77c50!important;font-size:11px}
.tg-cad-linkage-note{color:#8199a7;font-size:11px;line-height:1.65}
.tg-cad-linkage-history{margin-top:10px;background:#f0f7fa;
  padding:7px 10px;border-radius:7px}
.tg-cad-linkage-history p{font-size:10px;color:#607f90}
@media(max-width:760px){
  .tg-cad-linkage-list{grid-template-columns:minmax(0,1fr)}
  .tg-cad-linkage{padding:11px}
}
</style>

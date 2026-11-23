<script setup lang="ts">
/** M21 automatic Mock event handling; operator only confirms/reviews. */
import {computed,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {useScenarioStore} from '../simulation/store'
import {processName} from '../simulation/waterOperations'
import type {OperatingCase} from '../simulation/operationsCases'
import type {ProcessId} from '../simulation/waterOperations'
import {RECOVERY_CONFIRM_FRAMES} from '../simulation/operationsCases'

const props=withDefaults(defineProps<{mode?:'compact'|'full';sourceSystemId?:ProcessId}>(),{mode:'compact'})
const store=useScenarioStore()
const route=useRoute(),router=useRouter()
const picked=ref('')
const note=ref('')
const error=ref('')
const showClosed=ref(false)
const visibleCases=computed(()=>store.operatingCases.filter(x=>
  (!props.sourceSystemId||x.sourceProcess===props.sourceSystemId)&&
  (showClosed.value||x.status!=='closed'),
).slice(-16).reverse())
const selected=computed<OperatingCase|null>(()=>
  visibleCases.value.find(x=>x.id===picked.value)||null)
watch(()=>visibleCases.value.map(c=>c.id).join('|'),()=>{
  if(selected.value)return
  const requested=route.query.case
  picked.value=typeof requested==='string'&&visibleCases.value.some(c=>c.id===requested)
    ?requested:visibleCases.value[0]?.id||''
},{immediate:true})
watch(picked,()=>{note.value='';error.value=''})
function pick(id:string){picked.value=id}
function action(){
  if(!selected.value)return
  error.value=''
  try{
    if(selected.value.status==='new')store.acknowledgeCase(selected.value.id,note.value)
    else if(selected.value.status==='acknowledged')store.closeRecoveredCase(selected.value.id,note.value)
    note.value=''
    ElMessage.success(selected.value.status==='closed'?
      '模拟事件已完成人工恢复复核':'模拟事件已确认')
  }catch(e){error.value=e instanceof Error?e.message:'事件处理失败'}
}
function focus(id:string){
  void router.push('/port/process/'+id)
}
function displayStatus(record:OperatingCase){
  if(record.status==='closed')return '已复核'
  if(record.normalFrames>=RECOVERY_CONFIRM_FRAMES)return record.status==='new'?
    '待确认 · 恢复条件已满足':'可恢复复核'
  return record.status==='new'?'待确认':'持续观察'
}
const detailLink=computed(()=>selected.value?
  '/port/operations/monitor?case='+encodeURIComponent(selected.value.id):'')
const latestEvidence=computed(()=>selected.value?.evidence||'')
const canResolve=computed(()=>!!selected.value&&
  selected.value.status==='acknowledged'&&store.autoEnabled&&
  selected.value.normalFrames>=RECOVERY_CONFIRM_FRAMES)
const canAcknowledge=computed(()=>selected.value?.status==='new')
const actionEnabled=computed(()=>(canResolve.value||canAcknowledge.value)&&note.value.trim().length>=8)
</script>

<template>
  <section class="tg-caseboard" :class="mode" data-testid="sim-case-board">
    <header class="tg-caseboard-head">
      <div><h3>自动事件</h3>
        <span v-if="props.sourceSystemId?store.activeCases.some(x=>x.sourceProcess===props.sourceSystemId):store.pendingCaseCount" class="tg-caseboard-count"
          data-testid="sim-case-count">{{props.sourceSystemId?
            store.activeCases.filter(x=>x.sourceProcess===props.sourceSystemId).length:
            store.pendingCaseCount}} 条待处理</span>
        <span v-else class="tg-caseboard-count">当前无待处理事件</span>
      </div>
      <el-button link size="small" :disabled="!store.operatingCases.length"
        @click="showClosed=!showClosed">
        {{showClosed?'仅看待处理':'包含已复核'}}
      </el-button>
    </header>
    <div v-if="!visibleCases.length" class="tg-caseboard-empty"
      data-testid="sim-case-empty">暂无待处理事件</div>
    <template v-else>
      <div class="tg-caseboard-grid">
        <div class="tg-caseboard-list" data-testid="sim-case-list">
          <button v-for="item in visibleCases" :key="item.id"
            type="button" :class="{selected:picked===item.id}"
            :data-case-id="item.id" @click="pick(item.id)">
            <span class="tg-caseboard-rowtop">
              <strong>{{item.title}}</strong>
              <small :class="item.status">{{displayStatus(item)}}</small>
            </span>
            <span class="tg-caseboard-rowbottom">
              <code>{{item.id}}</code> · {{processName(item.sourceProcess)}}
            </span>
          </button>
        </div>
        <div v-if="selected" class="tg-caseboard-detail"
          data-testid="sim-case-detail">
          <div class="tg-caseboard-detail-top">
            <strong>{{selected.title}}</strong>
            <div class="tg-caseboard-detail-tools">
              <small>{{displayStatus(selected)}} · <b>SIM</b></small>
              <el-button v-if="mode==='compact'" link size="small"
                data-testid="sim-case-detail-link" @click="router.push(detailLink)">
                事件详情
              </el-button>
            </div>
          </div>
          <p class="tg-caseboard-evidence">{{latestEvidence}}</p>
          <div class="tg-caseboard-chain">
            <span>关联工艺</span>
            <button type="button" @click="focus(selected.sourceProcess)">
              {{processName(selected.sourceProcess)}}
            </button>
            <button v-for="related in selected.relatedProcesses" :key="related.systemId"
              type="button" :title="'设计业务关联，尚未确认真实管路：'+related.note"
              @click="focus(related.systemId)">
              {{processName(related.systemId)}}
            </button>
          </div>
          <details class="tg-caseboard-advice">
            <summary>处置建议与核查依据</summary>
            <ol><li v-for="step in selected.recommendations" :key="step">{{step}}</li></ol>
            <p>跨系统影响按设计业务关系提示，未核实现场管线；不自动控制泵阀。</p>
          </details>
          <div v-if="selected.status!=='closed'" class="tg-caseboard-actions">
            <span v-if="selected.status==='acknowledged'"
              data-testid="sim-case-recovery-progress" class="tg-caseboard-progress">
              {{selected.normalFrames>=RECOVERY_CONFIRM_FRAMES?
                '连续恢复条件满足，待人工复核':
                '等待恢复证据 '+selected.normalFrames+'/'+RECOVERY_CONFIRM_FRAMES+' 帧'}}
            </span>
            <el-input v-model="note" type="textarea" :rows="2"
              maxlength="600" :show-word-limit="mode==='full'"
              data-testid="sim-case-review-note"
              :placeholder="selected.status==='new'?
                '填写核查意见并确认事件（至少8字）':
                '填写恢复复核依据（至少8字）'"/>
            <div class="tg-caseboard-toolbar">
              <span v-if="error" class="tg-caseboard-error" role="alert">{{error}}</span>
              <el-button type="primary" size="small" :disabled="!actionEnabled"
                data-testid="sim-case-action" @click="action">
                {{selected.status==='new'?'确认事件':'复核并关闭'}}
              </el-button>
            </div>
          </div>
          <div v-else class="tg-caseboard-closed"
            data-testid="sim-case-closed">
            <strong>已完成模拟恢复复核</strong>
            <p>{{selected.closedNote}}</p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.tg-caseboard{min-width:0}
.tg-caseboard-head,.tg-caseboard-head>div{display:flex;align-items:center;gap:8px}
.tg-caseboard-head{justify-content:space-between;margin-bottom:10px}
.tg-caseboard-head h3{font-size:13px;color:#43697d;margin:0}
.tg-caseboard-count{font-size:10px;color:#8b9eab}
.tg-caseboard-grid{display:grid;grid-template-columns:minmax(155px,.82fr) minmax(210px,1.2fr);
  gap:10px}
.tg-caseboard-list{display:flex;flex-direction:column;gap:5px;max-height:290px;
  overflow:auto}
.tg-caseboard-list button{width:100%;text-align:left;background:rgba(249,252,254,.8);
  border:1px solid #e3edf2;border-radius:7px;padding:9px;cursor:pointer;
  color:#537388;font:inherit}
.tg-caseboard-list button.selected{border-color:#91bed0;background:#eaf5f9}
.tg-caseboard-rowtop{display:flex;align-items:flex-start;justify-content:space-between;gap:6px}
.tg-caseboard-rowtop strong{font-size:11px;line-height:1.5}
.tg-caseboard-rowtop small{font-size:10px;flex-shrink:0;color:#b0834f}
.tg-caseboard-rowtop small.closed{color:#769b8b}
.tg-caseboard-rowbottom{display:block;margin-top:5px;color:#8ea4b0;font-size:10px}
.tg-caseboard-rowbottom code{font-size:10px}
.tg-caseboard-detail{border:1px solid #e2edf2;background:#f8fbfc;
  border-radius:7px;padding:11px;min-width:0}
.tg-caseboard-detail-top{display:flex;align-items:center;justify-content:space-between;
  gap:6px;flex-wrap:wrap}
.tg-caseboard-detail-top strong{color:#466f83;font-size:12px}
.tg-caseboard-detail-top small{font-size:10px;color:#859bab}
.tg-caseboard-detail-top small b{font-weight:600;color:#bd8c56}
.tg-caseboard-evidence{font-size:11px;color:#748e9f;line-height:1.65;margin:9px 0}
.tg-caseboard-chain{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin:9px 0}
.tg-caseboard-chain>span{color:#869ca7;font-size:10px}
.tg-caseboard-chain button{background:white;border:1px solid #d5e7ef;
  border-radius:5px;padding:4px 6px;color:#4686a4;font:inherit;font-size:10px;cursor:pointer}
.tg-caseboard-chain button:hover{border-color:#8dbbd1}
.tg-caseboard-advice summary{font-size:11px;color:#61859a;cursor:pointer}
.tg-caseboard-advice ol{padding-left:17px}
.tg-caseboard-advice li,.tg-caseboard-advice p{font-size:10px;line-height:1.7;color:#718c9b}
.tg-caseboard-actions{margin-top:11px}
.tg-caseboard-progress{display:block;font-size:10px;color:#a67d52;margin-bottom:8px}
.tg-caseboard-toolbar{display:flex;align-items:center;justify-content:flex-end;
  gap:5px;margin-top:9px}
.tg-caseboard-error{flex:1;font-size:10px;color:#b76d5a}
.tg-caseboard-empty{font-size:11px;color:#8ba1ad;background:#f6fafb;
  padding:16px;border-radius:7px}
.tg-caseboard-closed{font-size:11px;color:#679083}
.tg-caseboard-closed p{font-size:10px;color:#87a19c}
.tg-caseboard.full .tg-caseboard-grid{grid-template-columns:minmax(210px,.8fr) minmax(280px,1.2fr)}
@media(max-width:1200px){.tg-caseboard-grid,.tg-caseboard.full .tg-caseboard-grid{
  grid-template-columns:1fr}}
</style>

<style scoped>
.tg-caseboard-detail-tools{display:flex;align-items:center;gap:5px}
</style>

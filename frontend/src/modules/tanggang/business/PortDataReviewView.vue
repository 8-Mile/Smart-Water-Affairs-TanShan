<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue'
import {ElMessage} from 'element-plus'
import {usePermissions} from '@/utils/permissions'
import {
  fetchTanggangPointAudit,saveTanggangPointReview,fetchTanggangReadiness,
  fetchPointReviewHistory,POINT_BASIS_LABEL,
  type PointAuditItem,type PointBasis,type PointReviewBody,type PointAuditResponse,
  type TanggangReadinessResponse,type PointReviewRevision,type SystemReadinessItem,
} from '@/api/tanggangProvenance'
import {loadTanggangCatalog,summarizeSystem,type TanggangCatalog} from '../mapping/tanggangCatalog'
import type {TanggangSystemId} from '@/api/tanggang'
import './business.css'

const catalog=ref<TanggangCatalog|null>(null)
const {hasPerm}=usePermissions()
const canEdit=computed(()=>hasPerm('scada:point:update'))
const filter=reactive({keyword:'',system_id:'',basis_type:''})
const page=ref(1)
const pageSize=20
const info=ref<PointAuditResponse|null>(null)
const loading=ref(false)
const error=ref('')
const readiness=ref<TanggangReadinessResponse|null>(null)
const readinessLoading=ref(false)
const readinessError=ref('')
const selectedSystem=ref<TanggangSystemId|null>(null)
const historyRows=ref<PointReviewRevision[]>([])
const historyVisible=ref(false)
const historyLoading=ref(false)
const historyPoint=ref<PointAuditItem|null>(null)
const systemMatrix=computed(()=>readiness.value?.systems.map(row=>{
  const design=catalog.value?.systemMap.get(row.id)
  const stats=design&&catalog.value?summarizeSystem(design,catalog.value):null
  const designIds=design
    ?[...new Set(design.areaEquipment.flatMap(e=>e.equipmentIds))]:[]
  const linked=new Set(row.linked_facility_ids)
  const withAsset=new Set(row.asset_bound_facility_ids)
  const nameFor=(id:string)=>catalog.value?.deviceMap.get(id)?.name||id
  return {...row,
    designCategories:stats?.designCategories??null,
    unlocated:stats?.unlocated??null,
    notMappedDesign:designIds.filter(id=>!linked.has(id)).map(nameFor),
    withoutAssetDesign:designIds.filter(id=>linked.has(id)&&!withAsset.has(id)).map(nameFor),
    designNameDifference:design&&design.name!==row.name
      ?'设计文件：'+design.name+'；业务目录：'+row.name : null,
    focusLayers:design?.focusPipeLayers??[],
    topologyHint:design?.disclaimer||'设计工艺拓扑尚需现场逐段核实',
  }
})||[])
const editing=ref<PointAuditItem|null>(null)
const editorVisible=ref(false)
const saving=ref(false)
const editError=ref('')
const form=reactive<{system_id:TanggangSystemId|'';basis_type:PointBasis;source_ref:string;assumption_note:string}>({
  system_id:'',basis_type:'UNVERIFIED',source_ref:'',assumption_note:'',
})
const systemOptions=computed(()=>catalog.value?.systems.map(s=>({value:s.id,label:s.name}))||[])
const designCount=computed(()=>catalog.value?.deviceMap.size??0)
let serial=0
async function refreshReadiness(){
  readinessLoading.value=true
  readinessError.value=''
  try{
    const {data}=await fetchTanggangReadiness()
    readiness.value=data.data
  }catch{
    readinessError.value='六系统接入准备度读取失败'
    readiness.value=null
  }finally{readinessLoading.value=false}
}
function chooseSystem(id:TanggangSystemId){
  selectedSystem.value=selectedSystem.value===id?null:id
  filter.system_id=selectedSystem.value||''
  page.value=1
  void refresh()
}
function csvDownload(filename:string,header:string[],rows:unknown[][]){
  const escapeCsv=(value:unknown)=>'"'+String(value??'').replace(/"/g,'""')+'"'
  const csv='\ufeff'+[header,...rows].map(row=>row.map(escapeCsv).join(',')).join('\r\n')
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a')
  a.href=url;a.download=filename
  document.body.append(a);a.click();a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1500)
}
function exportReadiness(){
  if(!readiness.value)return
  csvDownload('唐港-六系统资料与接入准备核对.csv',[
    '业务系统','设计设施类别（参考）','工程对象关联记录','有工程来源的对象关系',
    '设备台账关联','SCADA测点关联','测点候选总数',
    '上传资料引用测点','依据资料推导','演示假设测点',
    '已关联但未核对测点','资料已登记但未绑定对象','测点系统归属待核',
    '失效设备关联','失效测点关联','设计设施未关联对象',
    '已关联对象但无设备台账','设计与业务名称差异','待核实问题','现场接入状态',
  ],systemMatrix.value.map(x=>[
    x.name,x.designCategories??'未载入',
    x.object_links,x.object_source_refs,x.asset_links,x.point_links,
    x.point_candidates,x.point_document_references,x.point_assumptions,
    x.point_demo_values,x.point_without_review,x.point_without_object_link,
    x.point_system_discrepancies,x.stale_asset_links,x.stale_point_links,
    x.notMappedDesign.join('；'),x.withoutAssetDesign.join('；'),
    x.designNameDifference||'',x.issues.join('；'),'未现场核实',
  ]))
}
async function showHistory(row:PointAuditItem){
  historyPoint.value=row
  historyRows.value=[]
  historyVisible.value=true
  historyLoading.value=true
  try{
    const res=await fetchPointReviewHistory(row.point_id)
    historyRows.value=res.data.data||[]
  }catch{ElMessage.error('核对历史读取失败')}
  finally{historyLoading.value=false}
}
async function refresh(){
  const id=++serial
  error.value=''
  loading.value=true
  try{
    const res=await fetchTanggangPointAudit({
      page:page.value,page_size:pageSize,
      keyword:filter.keyword.trim()||undefined,
      system_id:filter.system_id as TanggangSystemId||undefined,
      basis_type:filter.basis_type as PointBasis||undefined,
    })
    if(serial!==id)return
    info.value=res.data.data
  }catch{
    if(serial===id){error.value='点表核对服务暂时不可用';info.value=null}
  }finally{if(serial===id)loading.value=false}
}
function search(){page.value=1;void refresh()}
function reset(){
  filter.keyword='';filter.system_id='';filter.basis_type=''
  selectedSystem.value=null
  page.value=1;void refresh()
}
function changePage(nextPage:number){
  page.value=nextPage
  void refresh()
}
function edit(row:PointAuditItem){
  editing.value=row
  Object.assign(form,{
    system_id:row.system_id||'',
    basis_type:row.basis_type,
    source_ref:row.source_ref||'',
    assumption_note:row.assumption_note||'',
  })
  editError.value=''
  editorVisible.value=true
}
function formatError(e:unknown){
  if(e&&typeof e==='object'){
    const err=e as {response?:{data?:{message?:string}};message?:string}
    return err.response?.data?.message||err.message||'保存失败'
  }
  return '保存失败'
}
async function save(){
  if(!editing.value)return
  if(!form.system_id){editError.value='必须选择六系统之一';return}
  if(form.basis_type==='DOCUMENT_REFERENCE'&&!form.source_ref.trim()){
    editError.value='请填写引用的上传资料名称或图号';return
  }
  if((form.basis_type==='ASSUMPTION'||form.basis_type==='DEMO_VALUE')&&!form.assumption_note.trim()){
    editError.value='请注明推导或演示假设的依据';return
  }
  editError.value='';saving.value=true
  try{
    const body:PointReviewBody={
      system_id:form.system_id,
      basis_type:form.basis_type,
      source_ref:form.source_ref.trim()||null,
      assumption_note:form.assumption_note.trim()||null,
    }
    await saveTanggangPointReview(editing.value.point_id,body)
    ElMessage.success('资料对账记录已保存')
    editorVisible.value=false
    await Promise.all([refresh(),refreshReadiness()])
  }catch(e){editError.value=formatError(e)}
  finally{saving.value=false}
}
function exportDesignReference(){
  if(!catalog.value)return
  const header=[
    '设计设施ID','资料设施名称','归属系统','所在区域',
    '设计资料来源','建议采集字段（非真实点表）',
    'CAD Handle（待核）','场景objectId（待核）','SCADA测点ID（待核）',
    '现场状态',
  ]
  const rows=Array.from(catalog.value.deviceMap.values()).map(d=>[
    d.id,d.name,(catalog.value?.deviceSystems.get(d.id)||[]).join(';'),
    d.regionName,d.sourceDoc||'资料来源待补充',
    (d.dataFields||[]).join('、'),
    d.sourceCadHandle||'','','','未现场核实',
  ])
  const escapeCsv=(value:unknown)=>'"'+String(value??'').replace(/"/g,'""')+'"'
  const csv='\ufeff'+[header,...rows].map(row=>row.map(escapeCsv).join(',')).join('\r\n')
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a')
  a.href=url
  a.download='唐港-上传资料设施与建议测点对账表.csv'
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1500)
}
onMounted(async()=>{
  try{catalog.value=await loadTanggangCatalog()}catch{/* the point ledger remains available */}
  await Promise.all([refresh(),refreshReadiness()])
})
</script>

<template>
  <main class="tg-biz tg-point-review page-fill">
    <header class="tg-biz-head">
      <div>
        <h1>资料与测点核对</h1>
        <p class="tg-biz-sub">资料参考、推导与演示假设；当前没有经过核实的唐港现场测点。</p>
      </div>
      <div class="tg-biz-actions">
        <el-button :disabled="!catalog" @click="exportDesignReference">导出资料对账表</el-button>
      </div>
    </header>

    <div class="tg-review-summary">
      <span>设计设施项 <strong>{{designCount}}</strong></span>
      <span>现有库测点 <strong>{{info?.context.total_existing_scada_points??'—'}}</strong></span>
      <span>已登记资料依据 <strong>{{info?.context.review_records??'—'}}</strong></span>
      <span>现场确认 <strong>0</strong></span>
    </div>

    <section class="tg-review-workspace tg-readiness-section" v-loading="readinessLoading">
      <div class="tg-biz-card-head">
        <h2>六系统资料接入准备</h2>
        <div class="tg-biz-actions">
          <el-button size="small" plain :disabled="!readiness" @click="exportReadiness">导出核对清单</el-button>
          <el-button size="small" text @click="refreshReadiness">刷新</el-button>
        </div>
      </div>
      <p v-if="readinessError" class="tg-review-error" role="alert">{{readinessError}}</p>
      <el-table v-else :data="systemMatrix" size="small" row-key="id"
        class="tg-review-table" stripe highlight-current-row @row-click="(row:SystemReadinessItem)=>chooseSystem(row.id)">
        <el-table-column label="业务系统" min-width="170">
          <template #default="{row}">
            <strong class="tg-review-sys-name">{{row.name}}</strong>
          </template>
        </el-table-column>
        <el-table-column label="设计设施类别" min-width="108" align="right">
          <template #default="{row}">{{row.designCategories??'—'}}</template>
        </el-table-column>
        <el-table-column label="工程关联" min-width="90" align="right">
          <template #default="{row}">{{row.object_links}}</template>
        </el-table-column>
        <el-table-column label="设备关联" min-width="90" align="right">
          <template #default="{row}">{{row.asset_links}}</template>
        </el-table-column>
        <el-table-column label="测点关联" min-width="90" align="right">
          <template #default="{row}">{{row.point_links}}</template>
        </el-table-column>
        <el-table-column label="资料依据测点" min-width="110" align="right">
          <template #default="{row}">{{row.point_document_references}}</template>
        </el-table-column>
        <el-table-column label="待补齐事项" min-width="250" show-overflow-tooltip>
          <template #default="{row}">{{row.issues.join('；')||'资料层面暂未发现缺项，仍未现场核实'}}</template>
        </el-table-column>
        <el-table-column label="查看" width="72">
          <template #default="{row}">
            <el-button link type="primary" @click.stop="chooseSystem(row.id)">
              {{selectedSystem===row.id?'取消':'核对'}}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>暂无可用的六系统资料映射统计</template>
      </el-table>
      <div v-if="selectedSystem" class="tg-readiness-detail">
        <template v-for="entry in systemMatrix.filter(x=>x.id===selectedSystem)" :key="entry.id">
          <div class="tg-readiness-details-row">
            <span>已有测点资料核对 {{entry.point_candidates}} 项</span>
            <span>设计对象来源 {{entry.object_source_refs}} 项</span>
            <span>仅资料归属待核 {{entry.point_system_discrepancies}} 项</span>
            <span>未绑定对象 {{entry.point_without_object_link}} 项</span>
          </div>
          <div v-if="entry.notMappedDesign.length" class="tg-readiness-details-row">
            <strong>尚未登记工程关联（{{entry.notMappedDesign.length}}）</strong>
            <span>{{entry.notMappedDesign.slice(0,12).join('、')}}{{entry.notMappedDesign.length>12?'等':''}}</span>
          </div>
          <div v-if="entry.withoutAssetDesign.length" class="tg-readiness-details-row">
            <strong>尚未关联设备台账（{{entry.withoutAssetDesign.length}}）</strong>
            <span>{{entry.withoutAssetDesign.slice(0,12).join('、')}}{{entry.withoutAssetDesign.length>12?'等':''}}</span>
          </div>
          <div v-if="entry.designNameDifference" class="tg-readiness-details-row">
            <strong>工艺范围待核</strong>
            <span>{{entry.designNameDifference}}</span>
          </div>
          <div class="tg-readiness-details-row">
            <span>设计管线图层：{{entry.focusLayers.join('、')||'尚无可确认的独立专属管线'}}</span>
          </div>
          <p class="tg-mini-note">{{entry.topologyHint}}</p>
        </template>
      </div>
      <p class="tg-review-safety">统计来自当前软件配置及设计资料，不是现场接入数量。归属核对和已登记依据均不等于传感器、PLC或水力管网验收通过。</p>
    </section>

    <section class="tg-review-workspace">
      <div class="tg-review-toolbar">
        <el-input v-model="filter.keyword" clearable placeholder="测点名称或NodeId"
          class="tg-review-search" @keyup.enter="search" @clear="search"/>
        <el-select v-model="filter.system_id" clearable placeholder="全部系统" class="tg-review-select"
          @change="()=>{selectedSystem=(filter.system_id as TanggangSystemId)||null;search()}">
          <el-option v-for="s in systemOptions" :key="s.value"
            :label="s.label" :value="s.value"/>
        </el-select>
        <el-select v-model="filter.basis_type" clearable placeholder="全部来源" class="tg-review-select"
          @change="search">
          <el-option v-for="(label,key) in POINT_BASIS_LABEL" :key="key"
            :label="label" :value="key"/>
        </el-select>
        <el-button type="primary" plain @click="search">查询</el-button>
        <el-button text @click="reset">重置</el-button>
      </div>
      <div v-if="error" class="tg-biz-empty">{{error}}</div>
      <el-table v-else v-loading="loading" :data="info?.items||[]" row-key="point_id"
        class="tg-review-table" stripe>
        <el-table-column prop="tag_name" label="测点名称" min-width="180" show-overflow-tooltip/>
        <el-table-column prop="node_id" label="NodeId" min-width="135" show-overflow-tooltip/>
        <el-table-column label="归属系统" min-width="145">
          <template #default="{row}">
            {{systemOptions.find(s=>s.value===row.system_id)?.label||
              (row.linked_systems?.length
                ? '关联候选：'+row.linked_systems.map((id:TanggangSystemId)=>
                    systemOptions.find(s=>s.value===id)?.label||id).join('、')
                : '待核对')}}
          </template>
        </el-table-column>
        <el-table-column label="依据类别" min-width="122">
          <template #default="{row}">{{POINT_BASIS_LABEL[row.basis_type as PointBasis]||'尚未核对'}}</template>
        </el-table-column>
        <el-table-column label="资料与假设依据" min-width="210" show-overflow-tooltip>
          <template #default="{row}">{{row.source_ref||row.assumption_note||'—'}}</template>
        </el-table-column>
        <el-table-column label="操作" width="135" align="right">
          <template #default="{row}">
            <el-button v-if="canEdit" link type="primary" @click="edit(row)">核对</el-button>
            <el-button link @click="showHistory(row)">历史</el-button>
          </template>
        </el-table-column>
        <template #empty>暂无符合条件的测点资料</template>
      </el-table>
      <div class="tg-review-bottom">
        <span>系统内的测点记录不代表唐港现场已经接入。</span>
        <el-pagination
          :current-page="page" :page-size="pageSize" :total="info?.total??0"
          layout="prev, pager, next, total"
          @current-change="changePage"/>
      </div>
    </section>

    <el-dialog v-model="historyVisible" append-to-body destroy-on-close
      width="min(730px,96vw)" title="测点资料核对历史">
      <div class="tg-point-review-code">{{historyPoint?.tag_name}}</div>
      <el-table v-loading="historyLoading" :data="historyRows" stripe size="small">
        <el-table-column label="记录时间" prop="created_at" min-width="165"/>
        <el-table-column label="核对来源" min-width="145">
          <template #default="{row}">{{POINT_BASIS_LABEL[row.after.basis_type as PointBasis]||'尚未核对'}}</template>
        </el-table-column>
        <el-table-column label="引用资料" min-width="220" show-overflow-tooltip>
          <template #default="{row}">{{row.after.source_ref||row.after.assumption_note||'—'}}</template>
        </el-table-column>
        <template #empty>尚无核对修订记录</template>
      </el-table>
    </el-dialog>

    <el-dialog v-model="editorVisible" append-to-body destroy-on-close width="min(520px,95vw)"
      class="tg-point-review-dialog" title="测点资料核对" :close-on-click-modal="false">
      <div class="tg-point-review-code">{{editing?.tag_name}}</div>
      <el-form label-position="top" :disabled="saving">
        <el-form-item label="所属工艺">
          <el-select v-model="form.system_id" filterable style="width:100%" placeholder="选择六套工艺之一">
            <el-option v-for="s in systemOptions" :key="s.value" :label="s.label" :value="s.value"/>
          </el-select>
        </el-form-item>
        <el-form-item label="资料类别">
          <el-select v-model="form.basis_type" style="width:100%">
            <el-option v-for="(label,key) in POINT_BASIS_LABEL" :key="key"
              :label="label" :value="key"/>
          </el-select>
        </el-form-item>
        <el-form-item label="用户上传资料名称或图号">
          <el-input v-model="form.source_ref" maxlength="512" placeholder="引用哪份资料，页码或图号"/>
        </el-form-item>
        <el-form-item label="推导或假设依据">
          <el-input v-model="form.assumption_note" type="textarea" :rows="3"
            maxlength="1000" placeholder="说明这是依据资料推导还是用于演示的假设"/>
        </el-form-item>
      </el-form>
      <p class="tg-review-safety">资料分类不能确认现场设备或测点真实性，也不会修改SCADA数值。</p>
      <p v-if="editError" class="tg-review-error" role="alert">{{editError}}</p>
      <template #footer>
        <el-button @click="editorVisible=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存依据</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.tg-readiness-section{margin-bottom:15px}
.tg-readiness-section .tg-biz-card-head{margin-bottom:13px}
.tg-review-sys-name{font-weight:600;font-size:12px}
.tg-readiness-detail{border-top:1px solid var(--el-border-color-lighter);margin-top:12px;padding:11px 0 2px}
.tg-readiness-details-row{display:flex;gap:12px 24px;flex-wrap:wrap;font-size:12px;margin-bottom:7px}
.tg-readiness-detail .tg-mini-note{font-size:11px;margin:5px 0}
.tg-review-summary{display:flex;align-items:center;gap:clamp(15px,3vw,43px);
  padding:14px 19px;margin:12px 0 20px;border-radius:14px;
  background:rgba(255,255,255,.54);box-shadow:0 3px 17px rgba(53,88,111,.04);
  color:#7590a1;font-size:12px;flex-wrap:wrap}
.tg-review-summary strong{font-size:20px;color:#385a75;padding-left:6px;font-variant-numeric:tabular-nums}
.tg-review-workspace{border:1px solid rgba(209,224,234,.8);border-radius:15px;
  background:rgba(255,255,255,.75);box-shadow:0 7px 27px rgba(55,95,115,.05);
  padding:19px;min-width:0}
.tg-review-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:11px;margin-bottom:18px}
.tg-review-search{width:230px}.tg-review-select{width:158px}
.tg-review-table{width:100%;background:transparent}
.tg-review-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-top:18px;flex-wrap:wrap}
.tg-review-bottom>span{color:#8a9ca8;font-size:11px}
.tg-point-review-code{font-size:13px;color:#3f6178;font-weight:650;margin:0 0 17px}
.tg-review-safety{font-size:11px;line-height:1.65;color:#8498a5;margin:4px 0}
.tg-review-error{color:#b64d40;font-size:12px;margin:10px 0}
@media(max-width:750px){
  .tg-review-workspace{padding:12px}
  .tg-review-search,.tg-review-select{width:100%;flex:1 1 165px}
  .tg-review-bottom{justify-content:center}
}
</style>

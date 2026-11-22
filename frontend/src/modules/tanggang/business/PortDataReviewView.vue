<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue'
import {ElMessage} from 'element-plus'
import {usePermissions} from '@/utils/permissions'
import {
  fetchTanggangPointAudit,saveTanggangPointReview,POINT_BASIS_LABEL,
  type PointAuditItem,type PointBasis,type PointReviewBody,type PointAuditResponse,
} from '@/api/tanggangProvenance'
import {loadTanggangCatalog,type TanggangCatalog} from '../mapping/tanggangCatalog'
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
    await refresh()
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
  await refresh()
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

    <section class="tg-review-workspace">
      <div class="tg-review-toolbar">
        <el-input v-model="filter.keyword" clearable placeholder="测点名称或NodeId"
          class="tg-review-search" @keyup.enter="search" @clear="search"/>
        <el-select v-model="filter.system_id" clearable placeholder="全部系统" class="tg-review-select"
          @change="search">
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
            {{systemOptions.find(s=>s.value===row.system_id)?.label||'待核对'}}
          </template>
        </el-table-column>
        <el-table-column label="依据类别" min-width="122">
          <template #default="{row}">{{POINT_BASIS_LABEL[row.basis_type as PointBasis]||'尚未核对'}}</template>
        </el-table-column>
        <el-table-column label="资料与假设依据" min-width="210" show-overflow-tooltip>
          <template #default="{row}">{{row.source_ref||row.assumption_note||'—'}}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="right">
          <template #default="{row}">
            <el-button v-if="canEdit" link type="primary" @click="edit(row)">核对</el-button>
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

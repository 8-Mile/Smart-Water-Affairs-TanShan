<script setup lang="ts">
import {computed,reactive,ref,watch} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import type {OptionItem} from '@/api/types'
import {
  createTanggangObjectLink,updateTanggangObjectLink,deleteTanggangObjectLink,
  fetchTanggangBindingOptions,type TanggangObjectLink,
  type TanggangObjectLinkBody,type TanggangPointOption,type TanggangSystemId,
} from '@/api/tanggang'
import type {TanggangDevice} from '../mapping/tanggangCatalog'

const props=defineProps<{
  open:boolean
  device:TanggangDevice|null
  systemId:TanggangSystemId
  existing:TanggangObjectLink|null
}>()
const emit=defineEmits<{(e:'update:open',value:boolean):void;(e:'saved'):void}>()
const visible=computed({
  get:()=>props.open,
  set:value=>emit('update:open',value),
})
const state=reactive<TanggangObjectLinkBody>({
  object_id:'',facility_id:'',system_id:'middle',cad_handle:null,
  source_ref:null,asset_ids:[],metric_ids:[],verified:false,
})
const equipmentOptions=ref<OptionItem[]>([])
const pointOptions=ref<TanggangPointOption[]>([])
const loading=ref(false)
const saving=ref(false)
const error=ref('')
watch(()=>props.open,async value=>{
  if(!value||!props.device)return
  const old=props.existing
  Object.assign(state,{
    object_id:old?.object_id||'',
    facility_id:props.device.id,
    system_id:props.systemId,
    cad_handle:old?.cad_handle||props.device.sourceCadHandle||null,
    source_ref:old?.source_ref||props.device.sourceDoc||null,
    asset_ids:[...(old?.asset_ids||[])],
    metric_ids:[...(old?.metric_ids||[])],
    verified:old?.verified||false,
  })
  error.value=''
  loading.value=true
  try{
    const [equipment,points]=await fetchTanggangBindingOptions()
    if(!props.open)return
    equipmentOptions.value=equipment.data.data
    pointOptions.value=points.data.data
  }catch(e){
    error.value='无法加载正式设备和测点列表，请检查业务服务后重试'
  }finally{loading.value=false}
})
const valid=computed(()=>state.object_id.trim()&&state.asset_ids.length>0&&!loading.value&&!saving.value)
function messageOf(e:unknown){
  if(e&&typeof e==='object'){
    const object=e as {message?:string;response?:{data?:{message?:string}}}
    return object.response?.data?.message||object.message||'操作失败，请检查关联参数'
  }
  return '操作失败，请检查关联参数'
}
async function submit(){
  error.value=''
  if(!state.object_id.trim()){error.value='必须填写真实三维对象ID，不能自动生成';return}
  if(!state.asset_ids.length){error.value='请选择实际存在的设备台账记录';return}
  if(state.verified&&!state.source_ref?.trim()){error.value='审核通过前必须填写工程依据';return}
  saving.value=true
  try{
    const body:TanggangObjectLinkBody={
      ...state,object_id:state.object_id.trim(),
      source_ref:state.source_ref?.trim()||null,
      cad_handle:state.cad_handle?.trim()||null,
    }
    if(props.existing)await updateTanggangObjectLink(props.existing.id,body)
    else await createTanggangObjectLink(body)
    ElMessage.success('业务对象关联已保存')
    emit('saved')
    emit('update:open',false)
  }catch(e){error.value=messageOf(e)}
  finally{saving.value=false}
}
async function remove(){
  if(!props.existing)return
  try{await ElMessageBox.confirm('解除这条工程对象关联？不会删除设备台账或SCADA测点。','解除关联',{type:'warning'})}
  catch{return}
  saving.value=true
  try{
    await deleteTanggangObjectLink(props.existing.id)
    ElMessage.success('已解除对象关联')
    emit('saved')
    emit('update:open',false)
  }catch(e){error.value=messageOf(e)}
  finally{saving.value=false}
}
</script>

<template>
  <el-dialog v-model="visible" append-to-body width="min(640px, 95vw)" class="tg-binding-dialog"
    :title="existing?'编辑工程关联':'关联业务对象'" :close-on-click-modal="false"
    destroy-on-close>
    <el-form label-position="top" class="tg-binding-form" :disabled="loading||saving">
      <div class="tg-binding-intro">
        <b>{{device?.name}}</b>
        <span>{{device?.id}} · {{device?.regionName}}</span>
      </div>
      <el-form-item label="三维对象ID" required>
        <el-input v-model="state.object_id" :disabled="!!existing" maxlength="128"
          placeholder="填写已经存在的场景objectId，不使用推测编号"/>
      </el-form-item>
      <el-form-item label="现有系统台账（待现场核实）" required>
        <el-select v-model="state.asset_ids" multiple filterable clearable collapse-tags
          collapse-tags-tooltip placeholder="选择真实设备" style="width:100%">
          <el-option v-for="e in equipmentOptions" :key="e.id"
            :label="e.name+' · '+(e.code||e.id)" :value="e.id"/>
        </el-select>
      </el-form-item>
      <el-form-item label="关联SCADA测点">
        <el-select v-model="state.metric_ids" multiple filterable clearable collapse-tags
          collapse-tags-tooltip placeholder="选择已接入点表，非必填" style="width:100%">
          <el-option v-for="p in pointOptions" :key="p.id"
            :label="p.tag_name" :value="p.id"/>
        </el-select>
      </el-form-item>
      <div class="tg-binding-two">
        <el-form-item label="CAD Handle">
          <el-input v-model="state.cad_handle" placeholder="有原图元依据时填写"/>
        </el-form-item>
        <el-form-item label="工程依据">
          <el-input v-model="state.source_ref" maxlength="512" placeholder="CAD图纸或勘察资料编号"/>
        </el-form-item>
      </div>
      <el-form-item>
        <el-switch v-model="state.verified" active-text="资料对象关系已核对（非现场核验）"/>
      </el-form-item>
      <p class="tg-binding-boundary">关联记录仅表示依据上传资料建立的对应关系，不代表现场设备、管网或测点已核实。</p>
      <p v-if="error" class="tg-binding-error" role="alert">{{error}}</p>
    </el-form>
    <template #footer>
      <div class="tg-binding-footer">
        <el-button v-if="existing" type="danger" plain :loading="saving" @click="remove">解除关联</el-button>
        <span/>
        <el-button @click="visible=false">取消</el-button>
        <el-button type="primary" :disabled="!valid" :loading="saving" @click="submit">保存关联</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style>
.tg-binding-dialog{border-radius:16px!important;overflow:hidden}
.tg-binding-dialog .el-dialog__header{padding:20px 23px 14px}
.tg-binding-dialog .el-dialog__body{padding:10px 23px}
.tg-binding-dialog .el-dialog__footer{padding:10px 23px 20px}
.tg-binding-intro{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 15px;border-radius:10px;background:rgba(231,244,249,.68);margin-bottom:16px}
.tg-binding-intro b{font-size:14px;color:#31516c}.tg-binding-intro span{font-size:11px;color:#859caf}
.tg-binding-form .el-form-item{margin-bottom:15px}
.tg-binding-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.tg-binding-boundary{margin:0;color:#8195a1;font-size:11px;line-height:1.7}
.tg-binding-error{font-size:12px;color:#b34a38;margin:9px 0 0}
.tg-binding-footer{display:flex;align-items:center;gap:8px}
.tg-binding-footer span{flex:1}
@media(max-width:610px){.tg-binding-intro{align-items:flex-start;flex-direction:column}.tg-binding-two{grid-template-columns:1fr}}
</style>

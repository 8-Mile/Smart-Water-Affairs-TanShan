<script setup lang="ts">
import {onMounted,reactive,ref} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {usePermissions} from '@/utils/permissions'
import {fetchTanggangSystems,type TanggangSystemId} from '@/api/tanggang'
import {
  parseDemoEquipment,createDemoEquipment,listDemoEquipment,
  type DemoEquipment, type ParsedDemoEquipment,
} from '@/api/tanggangDemoEquipment'
import './business.css'

const router=useRouter()
const {hasPerm}=usePermissions()
const canCreate=hasPerm('eq:create')
const sourceText=ref('')
const parsed=ref<ParsedDemoEquipment|null>(null)
const systems=ref<Array<{id:TanggangSystemId;name:string}>>([])
const entries=ref<DemoEquipment[]>([])
const form=reactive({
  system_id:'' as TanggangSystemId|'',
  name:'',code:'',parameters_note:'',source_note:'',
})
const confirmed=ref(false)
const working=ref(false)
const error=ref('')
const latest=ref<DemoEquipment|null>(null)
function formatError(e:unknown):string{
  if(!e||typeof e!=='object')return '请求失败'
  const ex=e as {message?:string;response?:{data?:{detail?:string;message?:string}}}
  return ex.response?.data?.detail||ex.response?.data?.message||ex.message||'请求失败'
}
async function refresh(){
  try{
    const [s,e]=await Promise.all([fetchTanggangSystems(),listDemoEquipment()])
    systems.value=s.data.data
    entries.value=e.data.data.items
  }catch(e){error.value=formatError(e)}
}
async function parse(){
  if(sourceText.value.trim().length<5){error.value='请输入完整的设备操作描述';return}
  working.value=true;error.value='';latest.value=null;confirmed.value=false
  try{
    const {data}=await parseDemoEquipment(sourceText.value.trim())
    parsed.value=data.data
    Object.assign(form,{
      system_id:data.data.system_id||'',
      name:data.data.name,
      code:data.data.code,
      parameters_note:data.data.parameters_note,
      source_note:'本次软件演示假设，尚未现场核实',
    })
    if(data.data.missing.length)
      ElMessage.info('部分字段无法可靠解析，请在预览中补充')
  }catch(e){error.value=formatError(e)}
  finally{working.value=false}
}
async function save(){
  if(!parsed.value||!canCreate)return
  if(!form.system_id||form.name.trim().length<2||form.code.trim().length<2){
    error.value='必须确认工艺、设备名称和编号'
    return
  }
  if(!confirmed.value){error.value='请先确认这是演示记录，而非现场设备';return}
  working.value=true;error.value=''
  try{
    const {data}=await createDemoEquipment({
      system_id:form.system_id,name:form.name.trim(),
      code:form.code.trim(),parameters_note:form.parameters_note.trim()||null,
      request_text:parsed.value.request_text,
      source_note:form.source_note.trim(),confirmed:true,
    })
    latest.value=data.data
    parsed.value=null;confirmed.value=false
    await refresh()
    ElMessage.success('已登记到独立SIM演示设备清单')
  }catch(e){error.value=formatError(e)}
  finally{working.value=false}
}
onMounted(refresh)
</script>

<template>
  <main class="tg-biz page-fill tg-demo-equipment">
    <header class="tg-biz-head">
      <div><h1>演示设备录入</h1></div>
      <div class="tg-biz-actions">
        <el-button @click="router.push('/ai/chat')">智能助手</el-button>
        <el-button @click="router.push('/equipment/list')">正式设备台账</el-button>
      </div>
    </header>
    <div class="tg-biz-grid two">
      <section class="tg-biz-card art-card">
        <div class="tg-biz-card-head"><h2>操作描述</h2></div>
        <el-input v-model="sourceText" type="textarea" :rows="4" maxlength="500"
          placeholder="例如：在除尘系统新增设备，设备名称：演示喷雾泵，设备编号：SIM-FOG-01，参数：设计参数待核"
        />
        <div class="tg-demo-actions">
          <el-button type="primary" :loading="working" @click="parse">解析并预览</el-button>
        </div>
        <p class="tg-biz-sub">目前是规则模板解析，不调用大模型；缺失字段需要人工填写。</p>
      </section>
      <section class="tg-biz-card art-card">
        <div class="tg-biz-card-head"><h2>人工核对</h2></div>
        <template v-if="parsed">
          <el-form label-position="top">
            <el-form-item label="六系统">
              <el-select v-model="form.system_id" filterable style="width:100%" placeholder="选择工艺">
                <el-option v-for="s in systems" :key="s.id" :label="s.name" :value="s.id"/>
              </el-select>
            </el-form-item>
            <el-form-item label="设备名称">
              <el-input v-model="form.name" maxlength="128"/>
            </el-form-item>
            <el-form-item label="设备编号">
              <el-input v-model="form.code" maxlength="64"/>
            </el-form-item>
            <el-form-item label="设计参数或补充说明">
              <el-input v-model="form.parameters_note" maxlength="1000"/>
            </el-form-item>
            <el-form-item label="资料来源或假设依据">
              <el-input v-model="form.source_note" maxlength="512"/>
            </el-form-item>
          </el-form>
          <el-checkbox v-model="confirmed">
            我确认此记录属于演示假设，不代表现场已安装设备。
          </el-checkbox>
          <div class="tg-demo-actions">
            <el-button v-if="canCreate" type="primary" :disabled="!confirmed"
              :loading="working" @click="save">确认登记演示设备</el-button>
            <span v-else class="tg-biz-label">无设备创建权限，不能保存</span>
          </div>
        </template>
        <template v-else-if="latest">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="演示记录">{{latest.id}}</el-descriptions-item>
            <el-descriptions-item label="设备">{{latest.name}}</el-descriptions-item>
            <el-descriptions-item label="编号">{{latest.code}}</el-descriptions-item>
            <el-descriptions-item label="归属">{{latest.system_name}}</el-descriptions-item>
            <el-descriptions-item label="来源">{{latest.source_note}}</el-descriptions-item>
            <el-descriptions-item label="记录类型">SIM · 非正式台账</el-descriptions-item>
          </el-descriptions>
        </template>
        <p v-else class="tg-biz-sub">解析后核对字段。确认前不会保存记录。</p>
        <p v-if="error" class="tg-demo-error" role="alert">{{error}}</p>
      </section>
    </div>
    <section class="tg-biz-card art-card">
      <div class="tg-biz-card-head"><h2>我的演示设备</h2></div>
      <el-table :data="entries" row-key="id" size="small" stripe>
        <el-table-column prop="code" label="编号" min-width="140"/>
        <el-table-column prop="name" label="设备名称" min-width="170"/>
        <el-table-column prop="system_name" label="工艺" min-width="140"/>
        <el-table-column prop="source_note" label="资料与假设来源" min-width="190" show-overflow-tooltip/>
        <el-table-column label="数据口径" width="115">
          <template #default>SIM · 待核实</template>
        </el-table-column>
        <template #empty>暂无演示设备记录</template>
      </el-table>
    </section>
  </main>
</template>

<style scoped>
.tg-demo-actions{display:flex;align-items:center;gap:10px;margin:16px 0 10px}
.tg-demo-equipment .tg-biz-grid{align-items:start}
.tg-demo-equipment .el-form-item{margin-bottom:14px}
.tg-demo-error{color:#b96548;font-size:12px;margin:14px 0}
</style>

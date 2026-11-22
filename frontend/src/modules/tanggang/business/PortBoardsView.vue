<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage,ElMessageBox} from 'element-plus'
import {usePermissions} from '@/utils/permissions'
import {
  createBoard,fetchBoardCatalog,fetchBoardHistory,fetchBoardRoles,
  fetchMyBoards,publishBoard,revokeBoard,updateBoard,
  type BoardBody,type BoardCatalog,type BoardTarget,
  type BoardWidget,type MetricId,type TanggangBoard,
} from '@/api/tanggangBoards'
import PublishedBoards from './PublishedBoards.vue'
import {useScenarioStore} from '../simulation/store'
import './business.css'

const router=useRouter()
const {hasPerm}=usePermissions()
const canPublish=computed(()=>hasPerm('sys:menu:manage'))
const store=useScenarioStore()
const boards=ref<TanggangBoard[]>([])
const catalog=ref<BoardCatalog|null>(null)
const roleOptions=ref<Array<{code:string;name:string}>>([])
const selectedRoles=ref<string[]>([])
const selectedId=ref<number|null>(null)
const board=reactive<BoardBody>({
  title:'',target_path:'/port/water/supply',widgets:[],
})
const loading=ref(false)
const saving=ref(false)
const publishOpen=ref(false)
const historyOpen=ref(false)
const history=ref<Array<{version:number;action:string;created_at:string;actor_id:number}>>([])
const error=ref('')
const previewOpen=ref(false)
const templatePrompt=ref('')
const readyBoard=computed(()=>boards.value.find(b=>b.id===selectedId.value)||null)
const isPublished=computed(()=>readyBoard.value?.status==='published')
const displayPreview=computed<TanggangBoard>(()=>({
  id:selectedId.value||0,title:board.title||'未命名看板',
  target_path:board.target_path,owner_id:0,
  widgets:board.widgets.map(w=>({...w})),
  status:'draft',allowed_role_codes:[],version:readyBoard.value?.version||1,
  created_at:'',updated_at:'',data_mode:'SIM',field_verified:false,
}))
const widgetOptions=computed(()=>[
  ...(catalog.value?.metrics||[]).map(x=>({id:x.id,label:x.label,kind:'metric' as const,metric:x.id})),
  {id:'terminal-table',label:'受影响用水点',kind:'terminal-table' as const,metric:null},
  {id:'monitor-rules',label:'监护规则证据',kind:'monitor-rules' as const,metric:null},
  {id:'plan-comparison',label:'供水方案比选',kind:'plan-comparison' as const,metric:null},
])
function errorText(e:unknown):string {
  if(!e||typeof e!=='object')return '操作失败，请稍后重试'
  const ex=e as {response?:{data?:{detail?:string;message?:string}};message?:string}
  return ex.response?.data?.detail||ex.response?.data?.message||ex.message||'请求失败'
}
async function refresh(){
  loading.value=true
  try{
    const res=await fetchMyBoards()
    boards.value=res.data.data
  }catch(e){error.value=errorText(e)}
  finally{loading.value=false}
}
function reset(){
  selectedId.value=null
  Object.assign(board,{title:'',target_path:'/port/water/supply',widgets:[]})
  previewOpen.value=false;error.value='';templatePrompt.value=''
}
function open(b:TanggangBoard){
  selectedId.value=b.id
  board.title=b.title
  board.target_path=b.target_path
  board.widgets=b.widgets.map(x=>({...x}))
  previewOpen.value=false;error.value=''
}
function uniqueWidgetId():string{
  let index=1
  while(board.widgets.some(x=>x.id==='w'+index))index++
  return 'w'+index
}
function addWidget(kind:string,metric:MetricId|null=null){
  if(isPublished.value){error.value='请先撤回已发布的看板';return}
  if(board.widgets.length>=8){ElMessage.warning('单个看板最多8个组件');return}
  if(!['metric','terminal-table','monitor-rules','plan-comparison'].includes(kind))return
  board.widgets.push({
    id:uniqueWidgetId(),
    kind:kind as BoardWidget['kind'],metric:kind==='metric'?metric:null,
  })
}
function addOption(value:string){
  const option=widgetOptions.value.find(x=>x.id===value)
  if(option)addWidget(option.kind,option.metric as MetricId|null)
}
function move(index:number,delta:number){
  if(isPublished.value)return
  const pos=index+delta
  if(pos<0||pos>=board.widgets.length)return
  const [x]=board.widgets.splice(index,1)
  board.widgets.splice(pos,0,x)
}
function fillTemplate(){
  if(isPublished.value){error.value='已发布看板需先撤回';return}
  const prompt=templatePrompt.value.trim()
  if(!prompt){ElMessage.warning('请输入关注的业务主题');return}
  const monitor=/监护|故障|电流|压力|预警|告警/.test(prompt)
  const isSupply=/供水|大机|水池|缺口|生产|储量/.test(prompt)
  if(!monitor&&!isSupply){ElMessage.warning('目前只支持供水保障和主动监护两类业务模板');return}
  board.target_path=monitor&&!isSupply?'/port/operations/monitor':'/port/water/supply'
  board.title=prompt.slice(0,40).length>=2?prompt.slice(0,40):(monitor?'监护分析':'供水分析')
  const keys:(string|MetricId)[]=monitor&&!isSupply
    ?['monitor-risk','monitor-rule-count','monitor-rules']
    :['supply-demand','supply-shortage','pool-forecast','terminal-table','plan-comparison']
  board.widgets=keys.map((key,i)=>({
    id:'w'+(i+1),
    kind:key==='terminal-table'||key==='monitor-rules'||key==='plan-comparison'?key:'metric',
    metric:key==='terminal-table'||key==='monitor-rules'||key==='plan-comparison'
      ?null:key as MetricId,
  })) as BoardWidget[]
  ElMessage.success('已按业务模板生成布局，请预览后保存')
}
function valid():string{
  if(board.title.trim().length<2)return '请输入至少2个字符的看板名称'
  if(!board.widgets.length)return '请至少添加一个组件'
  if(!catalog.value?.targets.some(x=>x.path===board.target_path))return '目标页面不在发布白名单'
  return ''
}
async function save(){
  if(isPublished.value){error.value='已发布看板请先撤回再修改';return}
  const bad=valid()
  if(bad){error.value=bad;return}
  saving.value=true;error.value=''
  try{
    const body:BoardBody={
      title:board.title.trim(),target_path:board.target_path,
      widgets:board.widgets.map(x=>({...x})),
      ...(readyBoard.value?{version:readyBoard.value.version}:{}),
    }
    const res=readyBoard.value
      ?await updateBoard(readyBoard.value.id,body):await createBoard(body)
    await refresh()
    open(res.data.data)
    ElMessage.success('看板已保存到服务端')
  }catch(e){error.value=errorText(e)}
  finally{saving.value=false}
}
async function showPublish(){
  if(!readyBoard.value){error.value='请先保存看板';return}
  if(!canPublish.value){error.value='当前用户没有看板发布权限';return}
  try{
    const {data}=await fetchBoardRoles()
    roleOptions.value=data.data
    selectedRoles.value=readyBoard.value.allowed_role_codes.length
      ?[...readyBoard.value.allowed_role_codes]
      :roleOptions.value.filter(x=>x.code==='admin').map(x=>x.code)
    publishOpen.value=true
  }catch(e){error.value=errorText(e)}
}
async function publish(){
  const current=readyBoard.value
  if(!current||!selectedRoles.value.length){ElMessage.warning('请选择可查看的角色');return}
  saving.value=true;error.value=''
  try{
    const {data}=await publishBoard(current.id,current.version,selectedRoles.value)
    await refresh()
    open(data.data)
    publishOpen.value=false
    ElMessage.success('已发布，授权角色可在指定业务页面查看')
  }catch(e){error.value=errorText(e)}
  finally{saving.value=false}
}
async function revoke(){
  const current=readyBoard.value
  if(!current||!canPublish.value)return
  try{await ElMessageBox.confirm('撤回后，原业务页面将不再显示此看板。','确认撤回',{type:'warning'})}
  catch{return}
  saving.value=true
  try{
    const {data}=await revokeBoard(current.id,current.version)
    await refresh();open(data.data)
    ElMessage.success('看板已撤回')
  }catch(e){error.value=errorText(e)}
  finally{saving.value=false}
}
async function showHistory(){
  if(!selectedId.value)return
  try{
    const {data}=await fetchBoardHistory(selectedId.value)
    history.value=data.data
    historyOpen.value=true
  }catch(e){error.value=errorText(e)}
}
onMounted(async()=>{
  try{
    const {data}=await fetchBoardCatalog()
    catalog.value=data.data
  }catch(e){error.value=errorText(e)}
  await refresh()
})
</script>

<template>
  <main class="tg-biz page-fill tg-a2ui-page">
    <div class="tg-biz-head">
      <div><h1>我的看板</h1></div>
      <div class="tg-biz-actions">
        <el-button @click="router.push('/ai/chat')">智能助手</el-button>
        <el-button type="primary" @click="reset">新建看板</el-button>
      </div>
    </div>

    <div class="tg-a2ui-layout">
      <section class="tg-biz-card art-card tg-a2ui-list">
        <div class="tg-biz-card-head"><h2>已保存看板</h2></div>
        <div v-loading="loading" class="tg-biz-list">
          <button v-for="item in boards" :key="item.id" type="button"
            class="tg-a2ui-list-item" :class="{active:selectedId===item.id}" @click="open(item)">
            <strong>{{item.title}}</strong>
            <span>{{catalog?.targets.find(t=>t.path===item.target_path)?.label||item.target_path}}</span>
            <el-tag size="small" effect="plain" :type="item.status==='published'?'success':'info'">
              {{item.status==='published'?'已发布':'草稿'}}
            </el-tag>
          </button>
          <p v-if="!boards.length&&!loading" class="tg-biz-sub">暂无已保存看板</p>
        </div>
      </section>

      <section class="tg-biz-card art-card tg-a2ui-editor">
        <div class="tg-biz-card-head">
          <h2>{{selectedId?'编辑看板':'新建看板'}}</h2>
          <div class="tg-biz-actions">
            <el-button v-if="selectedId" link @click="showHistory">版本记录</el-button>
            <el-button link @click="previewOpen=!previewOpen">{{previewOpen?'收起预览':'预览'}}</el-button>
          </div>
        </div>
        <el-form label-position="top" :disabled="saving||isPublished">
          <el-form-item label="看板名称">
            <el-input v-model="board.title" maxlength="80" show-word-limit placeholder="例如：生产供水与风险分析"/>
          </el-form-item>
          <el-form-item label="发布位置">
            <el-select v-model="board.target_path" style="width:100%">
              <el-option v-for="target in catalog?.targets||[]" :key="target.path"
                :label="target.label" :value="target.path"/>
            </el-select>
          </el-form-item>
        </el-form>

        <div v-if="!isPublished" class="tg-a2ui-template">
          <el-input v-model="templatePrompt" clearable placeholder="输入供水或监护主题，按业务模板生成"
            @keyup.enter="fillTemplate">
            <template #append><el-button @click="fillTemplate">生成布局</el-button></template>
          </el-input>
        </div>

        <div class="tg-biz-card-head">
          <h2>看板组件</h2>
          <el-select v-if="!isPublished" placeholder="添加组件" style="width:166px"
            :model-value="''" @change="addOption">
            <el-option v-for="item in widgetOptions" :key="item.id" :label="item.label" :value="item.id"/>
          </el-select>
        </div>
        <div class="tg-biz-list">
          <div v-for="(widget,i) in board.widgets" :key="widget.id" class="tg-biz-list-row tg-a2ui-row">
            <span>{{widgetOptions.find(x=>x.id===(widget.kind==='metric'?widget.metric:widget.kind))?.label||widget.kind}}</span>
            <div v-if="!isPublished" class="tg-biz-actions">
              <el-button link :disabled="i===0" @click="move(i,-1)">上移</el-button>
              <el-button link :disabled="i===board.widgets.length-1" @click="move(i,1)">下移</el-button>
              <el-button link type="danger" @click="board.widgets.splice(i,1)">移除</el-button>
            </div>
          </div>
          <p v-if="!board.widgets.length" class="tg-biz-sub">选择组件，或按业务模板生成。</p>
        </div>

        <p v-if="error" class="tg-a2ui-error" role="alert">{{error}}</p>
        <div class="tg-a2ui-actions">
          <el-button v-if="!isPublished" type="primary" :loading="saving" @click="save">保存看板</el-button>
          <el-button v-if="selectedId&&!isPublished&&canPublish" :loading="saving" @click="showPublish">发布</el-button>
          <el-button v-if="selectedId&&isPublished&&canPublish" type="warning" plain
            :loading="saving" @click="revoke">撤回发布</el-button>
          <el-button v-if="selectedId&&isPublished" @click="router.push(board.target_path)">打开发布位置</el-button>
        </div>
      </section>
    </div>

    <section v-if="previewOpen" class="tg-a2ui-preview">
      <div class="tg-biz-card-head">
        <h2>布局预览</h2>
        <el-button size="small" plain @click="store.openConsole()">选择SIM情景</el-button>
      </div>
      <PublishedBoards :target="board.target_path" :preview="displayPreview"/>
    </section>

    <el-dialog v-model="publishOpen" title="发布看板" append-to-body width="min(480px,95vw)">
      <el-form label-position="top">
        <el-form-item label="允许查看的角色">
          <el-select v-model="selectedRoles" multiple filterable style="width:100%">
            <el-option v-for="role in roleOptions" :key="role.code"
              :label="role.name" :value="role.code"/>
          </el-select>
        </el-form-item>
      </el-form>
      <p class="tg-biz-sub">发布后只在指定业务页对授权角色显示，所有数值仍仅来自SIM演示。</p>
      <template #footer>
        <el-button @click="publishOpen=false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!selectedRoles.length" @click="publish">确认发布</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="historyOpen" title="看板版本" append-to-body width="min(580px,95vw)">
      <el-table :data="history" size="small">
        <el-table-column prop="version" label="版本" width="70"/>
        <el-table-column label="动作" min-width="120">
          <template #default="{row}">
            {{({create:'创建',update:'编辑',publish:'发布',revoke:'撤回'} as Record<string,string>)[row.action]||row.action}}
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" min-width="180"/>
        <el-table-column prop="actor_id" label="操作者" width="90"/>
      </el-table>
    </el-dialog>
  </main>
</template>

<style scoped>
.tg-a2ui-layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:14px;align-items:start}
.tg-a2ui-list,.tg-a2ui-editor{min-width:0}
.tg-a2ui-list-item{width:100%;text-align:left;display:flex;gap:6px;flex-direction:column;
  padding:12px;border:1px solid transparent;border-radius:var(--custom-radius,8px);
  background:transparent;cursor:pointer;font-family:inherit;color:inherit}
.tg-a2ui-list-item:hover,.tg-a2ui-list-item.active{background:var(--art-gray-100,#f3f7fa);border-color:var(--art-card-border,#dfeaf1)}
.tg-a2ui-list-item strong{font-weight:650;font-size:13px;color:var(--art-gray-800,#253f55)}
.tg-a2ui-list-item span{font-size:11px;color:var(--art-gray-600,#718999)}
.tg-a2ui-list-item .el-tag{align-self:flex-start}
.tg-a2ui-template{margin:12px 0 20px}
.tg-a2ui-row{min-height:47px}
.tg-a2ui-row>span{font-size:13px}
.tg-a2ui-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:22px}
.tg-a2ui-error{color:#ba6a4d;font-size:12px;margin:15px 0 0}
.tg-a2ui-preview{margin-top:17px}
@media(max-width:850px){.tg-a2ui-layout{grid-template-columns:minmax(0,1fr)}}
</style>

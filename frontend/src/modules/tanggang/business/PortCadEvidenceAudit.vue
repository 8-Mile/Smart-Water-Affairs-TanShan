<script setup lang="ts">
/**
 * V2.8 CAD source-handle audit. Layer-scoped documentary evidence only.
 * NEVER asserts a pipe is connected to a process node / pump / valve.
 */
import {computed,ref,watch} from 'vue'

type EndpointStatus=
  'touches_another_visible_candidate'|'unmatched_visible_endpoint'|
  'hidden_source_continuation'|'near_visible_gap'
interface Endpoint{
  handle:string
  side:string
  status:EndpointStatus
  sceneXZ:string
  sourceCADXY:string
  closestHandle:string|null
  closestDistance:number|null
  hiddenHandle:string|null
  hiddenStatus:string|null
  gapHandle:string|null
  gapDistance:number|null
}
interface Suspicion{
  type:string
  primaryHandle:string
  neighborHandle:string|null
  sceneX:number|null
  sceneZ:number|null
  distance:number|null
  severity:string
  note:string
}
interface Layer{
  layer:string
  endpointCount:number
  unresolvedCount:number
  suspiciousCount:number
  suspiciousHighCount:number
  statuses:Record<string,number>
  endpoints:Endpoint[]
  suspicions:Suspicion[]
}
interface Audit{
  schemaVersion:number
  sourceVersion:string
  statusLabels:Record<EndpointStatus,string>
  total:{endpoints:number;candidateContacts:number;unresolved:number;
    suspicions:number;highSuspicions:number}
  layers:Record<string,Layer>
}
const props=defineProps<{
  systemId:string
  sourceLayers:string[]
}>()

const expanded=ref(false)
const loading=ref(false)
const error=ref('')
const audit=ref<Audit|null>(null)
const activeLayer=ref('')
const tab=ref<'unresolved'|'suspicions'|'all'>('unresolved')
const keyword=ref('')
const page=ref(1)
const pageSize=15
const trackedLayers=computed(()=>props.sourceLayers.filter(x=>!!x))
const covered=computed(()=>trackedLayers.value.map(name=>audit.value?.layers[name]).filter(
  (x):x is Layer=>!!x,
))
const selected=computed(()=>audit.value?.layers[activeLayer.value]||null)
const summary=computed(()=>covered.value.reduce((sum,x)=>({
  endpoints:sum.endpoints+x.endpointCount,
  unresolved:sum.unresolved+x.unresolvedCount,
  suspected:sum.suspected+x.suspiciousCount,
  high:sum.high+x.suspiciousHighCount,
}),{endpoints:0,unresolved:0,suspected:0,high:0}))
const statusLabels:Record<EndpointStatus,string>={
  touches_another_visible_candidate:'可见端点接触候选（非核实）',
  unmatched_visible_endpoint:'可见端点未匹配',
  hidden_source_continuation:'隐藏源继续延伸',
  near_visible_gap:'近距离存在间隙',
}
function isUnresolved(x:Endpoint):boolean{
  return x.status!=='touches_another_visible_candidate'
}
type AuditRow={key:string;type:'point'|'suspicion';handle:string;
  status:string;details:string;position:string;secondary:string}
const rows=computed<AuditRow[]>(()=>{
  const layer=selected.value
  if(!layer)return []
  const endpoints=layer.endpoints.filter(x=>tab.value==='all'||isUnresolved(x))
    .map((x,i)=>({
      key:'e-'+i+'-'+x.handle,
      type:'point' as const,handle:x.handle,
      status:statusLabels[x.status]||x.status,
      details:'端点 '+x.side+(x.closestHandle?' · 最近候选 '+x.closestHandle:'')+
        (x.hiddenHandle?' · 隐藏源 '+x.hiddenHandle:'')+
        (x.gapHandle?' · 缺口参考 '+x.gapHandle:''),
      position:'场景XZ '+x.sceneXZ,
      secondary:'CAD原坐标 '+x.sourceCADXY,
    }))
  const suspects=layer.suspicions.map((x,i)=>({
    key:'s-'+i+'-'+x.primaryHandle,
    type:'suspicion' as const,handle:x.primaryHandle,
    status:x.severity==='high'?'高优先级复核':'设计复核',
    details:x.note,
    position:'场景XZ ['+String(x.sceneX??'—')+', '+String(x.sceneZ??'—')+']',
    secondary:'临近源 '+(x.neighborHandle||'—')+' · 距离 '+String(x.distance??'未提供'),
  }))
  const list=tab.value==='suspicions'?suspects:endpoints
  const q=keyword.value.trim().toUpperCase()
  if(!q)return list
  // Searching a complete source Handle should resolve that source first,
  // rather than mixing it with nearby/closest candidate mentions.
  const exact=list.filter(x=>x.handle.toUpperCase()===q)
  if(exact.length)return exact
  return list.filter(x=>[x.handle,x.status,x.details,x.position,x.secondary].some(
    item=>item.toUpperCase().includes(q),
  ))
})
const paged=computed(()=>rows.value.slice((page.value-1)*pageSize,page.value*pageSize))
const pages=computed(()=>Math.max(1,Math.ceil(rows.value.length/pageSize)))
watch([activeLayer,tab,keyword],()=>{page.value=1})
watch(()=>props.systemId,()=>{
  expanded.value=false
  activeLayer.value=''
  keyword.value=''
  tab.value='unresolved'
})
async function toggle(){
  expanded.value=!expanded.value
  if(!expanded.value||audit.value||loading.value)return
  loading.value=true
  error.value=''
  try{
    const response=await fetch('/tanggang/cad/l1-v2_8/process-endpoint-audit-v2.8.json',
      {cache:'no-cache'})
    if(!response.ok)throw Error('CAD核查文件 HTTP '+response.status)
    const data=await response.json() as Audit
    if(data.schemaVersion!==1||data.sourceVersion!=='L1 V2.8'||
      !data.layers||!data.total)throw Error('CAD核查文件格式不匹配')
    audit.value=data
    activeLayer.value=trackedLayers.value.find(x=>data.layers[x])||''
  }catch(e){
    error.value=e instanceof Error?e.message:'核查台账加载失败'
  }finally{loading.value=false}
}
function setLayer(layer:string){
  if(!audit.value?.layers[layer])return
  activeLayer.value=layer
}
function setTab(next:typeof tab.value){tab.value=next}
</script>

<template>
  <section v-if="trackedLayers.length" class="tg-biz-card tg-cad-audit"
    data-testid="cad-evidence-audit">
    <div class="tg-cad-summary">
      <div>
        <strong>CAD 管线端点核查</strong>
        <p>V2.8 源图层核查台账 · 不等于现场管网连通确认</p>
      </div>
      <el-button size="small" plain :aria-expanded="expanded"
        data-testid="cad-audit-toggle" @click="toggle">
        {{expanded?'收起核查台账':'展开端点与疑点'}}
      </el-button>
    </div>
    <template v-if="expanded">
      <div v-if="loading" class="tg-cad-message" role="status">正在读取 CAD V2.8 核查资料…</div>
      <div v-else-if="error" class="tg-cad-message" role="alert">{{error}}
        <el-button size="small" link @click="audit=null;expanded=false;toggle()">重试</el-button>
      </div>
      <template v-else-if="audit">
        <div class="tg-cad-counters" data-testid="cad-audit-summary">
          <div><span>当前专业端点记录</span><strong>{{summary.endpoints}}</strong></div>
          <div><span>待核端点</span><strong>{{summary.unresolved}}</strong></div>
          <div><span>疑点记录</span><strong>{{summary.suspected}}</strong></div>
          <div><span>高优先疑点</span><strong>{{summary.high}}</strong></div>
        </div>
        <div class="tg-cad-scope">
          <strong>图层范围</strong>
          <button v-for="name in trackedLayers" :key="name" type="button"
            :disabled="!audit.layers[name]"
            :class="{active:activeLayer===name}"
            @click="setLayer(name)">{{name.replace('$管综-','')}}</button>
          <span v-if="trackedLayers.some(x=>!audit?.layers[x])" class="tg-cad-warning">
            存在未纳入V2.8端点台账的图层
          </span>
        </div>
        <div v-if="systemId==='mineral'" class="tg-cad-warning">
          含矿污水系统当前只对应“污泥管”CAD图层；进出水、加药等完整物理管线不在本系统端点台账覆盖范围内。
        </div>
        <template v-if="selected">
          <div class="tg-cad-actions">
            <div class="tg-cad-tabs" role="group" aria-label="CAD核查筛选">
              <button :class="{active:tab==='unresolved'}"
                data-testid="cad-tab-unresolved"
                @click="setTab('unresolved')">待核端点（{{selected.unresolvedCount}}）</button>
              <button :class="{active:tab==='suspicions'}"
                data-testid="cad-tab-suspicions"
                @click="setTab('suspicions')">疑点（{{selected.suspiciousCount}}）</button>
              <button :class="{active:tab==='all'}"
                data-testid="cad-tab-all"
                @click="setTab('all')">全部候选端点（{{selected.endpointCount}}）</button>
            </div>
            <el-input v-model="keyword" size="small" clearable
              data-testid="cad-handle-search"
              aria-label="搜索CAD源Handle或坐标"
              placeholder="检索源Handle / 邻近Handle / 坐标"/>
          </div>
          <div class="tg-cad-records" data-testid="cad-evidence-rows">
            <article v-for="item in paged" :key="item.key" class="tg-cad-record">
              <div class="tg-cad-record-header">
                <code>{{item.handle}}</code>
                <span>{{item.status}}</span>
              </div>
              <p>{{item.details}}</p>
              <small>{{item.position}} · {{item.secondary}}</small>
            </article>
            <p v-if="!rows.length" class="tg-cad-empty">
              当前图层及筛选条件下没有记录。这不表示该管网已经核验完成。
            </p>
          </div>
          <div class="tg-cad-pagination">
            <small>共 {{rows.length}} 条，当前第 {{page}} / {{pages}} 页</small>
            <el-button size="small" plain :disabled="page<=1" @click="page--">上一页</el-button>
            <el-button size="small" plain :disabled="page>=pages" @click="page++">下一页</el-button>
          </div>
        </template>
        <p class="tg-cad-evidence-note">
          说明：端点“接触候选”只是源图元几何筛查结果，不代表已确认的水力连接。
          此台账按 CAD 专业图层展示，无法直接证明组态图中任意两个设备已经相连。
          正式工程核验仍需原DWG、标高、阀门及接口资料。
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.tg-cad-audit{padding:13px 17px;margin-top:12px;min-width:0}
.tg-cad-summary{display:flex;align-items:center;justify-content:space-between;gap:14px;
  flex-wrap:wrap}
.tg-cad-summary strong{font-size:13px;font-weight:700;color:#395e73}
.tg-cad-summary p{font-size:11px;margin:3px 0 0;color:#8398a7}
.tg-cad-message{font-size:12px;color:#628398;padding:12px 0}
.tg-cad-counters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:9px;margin-top:13px}
.tg-cad-counters>div{border:1px solid #dfe9ef;border-radius:7px;
  background:#f5f9fb;padding:9px 11px;min-width:0}
.tg-cad-counters span{display:block;color:#718b9d;font-size:10px;margin-bottom:4px}
.tg-cad-counters strong{font-size:19px;color:#426e83;font-variant-numeric:tabular-nums}
.tg-cad-scope{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:13px 0 10px}
.tg-cad-scope strong{font-size:11px;color:#698b9b}
.tg-cad-scope button,.tg-cad-tabs button{border:1px solid #d6e5eb;
  border-radius:5px;background:#f7fbfd;color:#557f95;padding:6px 11px;
  font-size:11px;font-family:inherit;cursor:pointer}
.tg-cad-scope button.active,.tg-cad-tabs button.active{
  border-color:#87bed2;background:#e8f4f9;color:#2e7794;font-weight:650}
.tg-cad-scope button:disabled{opacity:.45;cursor:not-allowed}
.tg-cad-warning{font-size:11px;color:#a47b3b}
.tg-cad-actions{display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:9px;margin:10px 0}
.tg-cad-tabs{display:flex;flex-wrap:wrap;gap:5px}
.tg-cad-actions :deep(.el-input){width:240px;max-width:100%}
.tg-cad-records{border-top:1px solid #e4edf2}
.tg-cad-record{padding:8px 2px;border-bottom:1px solid #e9f0f4}
.tg-cad-record-header{display:flex;gap:12px;align-items:center}
.tg-cad-record-header code{background:#eaf4f8;padding:3px 8px;
  border-radius:4px;font-size:11px;color:#457d99}
.tg-cad-record-header span{font-size:11px;color:#7f8490}
.tg-cad-record p{font-size:11px;line-height:1.6;color:#547487;margin:4px 0}
.tg-cad-record small{color:#8da4af;font-size:10px}
.tg-cad-empty{color:#899dac;font-size:11px;padding:12px 0}
.tg-cad-pagination{display:flex;gap:7px;align-items:center;justify-content:flex-end;
  margin:9px 0}
.tg-cad-pagination small{color:#839aa6;margin-right:auto;font-size:10px}
.tg-cad-evidence-note{font-size:11px;color:#8398a5;
  line-height:1.7;border-top:1px solid #e7eef2;padding-top:9px}
@media(max-width:680px){.tg-cad-counters{grid-template-columns:repeat(2,minmax(0,1fr))}
.tg-cad-actions :deep(.el-input){width:100%}}
</style>

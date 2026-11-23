<script setup lang="ts">
import {computed,ref,watch,onMounted,nextTick} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import cad from './cadWaterNetwork.generated.json'
import {WATER_PROCESSES,type ProcessId} from '../simulation/waterOperations'
import PortCadEndpointEvidence from './PortCadEndpointEvidence.vue'
import {relationFor} from './cadWaterTrace'

type CadView='all'|'collection'|'supply'|'separate'
type CadLink=typeof cad.designRelationships[number]
const router=useRouter(),route=useRoute()
const selectedView=ref<CadView>('all')
const initialRelation=typeof route.query.cad_relation==='string'
  ?route.query.cad_relation:'L12'
const selectedId=ref(relationFor(initialRelation)?initialRelation:'L12')
watch(()=>route.query.cad_relation,id=>{
  if(typeof id==='string'&&relationFor(id))selectedId.value=id
})
// When arriving from a process diagram, bring the actual CAD relationship
// into view rather than dropping the operator at the dashboard KPI row.
onMounted(async()=>{
  if(typeof route.query.cad_relation!=='string'||!relationFor(route.query.cad_relation))return
  await nextTick()
  requestAnimationFrame(()=>document.querySelector('[data-testid="cad-water-network"]')
    ?.scrollIntoView({block:'start',behavior:'smooth'}))
})
const CAD_HOME='/tanggang/audit/cad-review/index.html'
const CAD_MASTER='/tanggang/audit/cad-review/v2/index.html'
const CAD_MAP='/tanggang/audit/cad-review/v2/唐港5152_智慧水务CAD总控梳理图_V2.png'
const groupNames:Record<CadView,string>={
  all:'全港关系',collection:'雨污水收集',supply:'供水与回用',separate:'生活水独立链',
}
const links=computed<CadLink[]>(()=>cad.designRelationships.filter(e=>
  selectedView.value==='all'||e.view===selectedView.value,
))
const selected=computed(()=>cad.designRelationships.find(e=>e.id===selectedId.value)||null)
function selectEdge(id:string){
  if(!relationFor(id))return
  selectedId.value=id
  void router.replace({path:route.path,query:{...route.query,cad_relation:id}})
}
function selectView(v:CadView){
  selectedView.value=v
  if(!links.value.some(e=>e.id===selectedId.value)&&links.value[0]){
    selectEdge(links.value[0].id)
  }
}
function openSystem(id:ProcessId){void router.push('/port/process/'+id)}
function state(status:string){
  return status==='design'?'设计关系':
    status==='alternative'?'备选路径':
    status==='conditional'?'条件路径':
    status==='cad_note'?'CAD注记':'未核实'
}
</script>

<template>
  <section class="tg-biz-card tg-cad-water" data-testid="cad-water-network">
    <div class="tg-cad-water-head">
      <h2>CAD水资源关联</h2>
      <div class="tg-cad-water-actions">
        <span class="tg-cad-water-tag">V2 · 设计关系</span>
        <a :href="CAD_HOME" class="tg-cad-link" target="_blank" rel="noopener"
          data-testid="cad-master-view">CAD图层查看</a>
        <a :href="CAD_MASTER" class="tg-cad-link" target="_blank" rel="noopener"
          data-testid="cad-master-plan">CAD总控图</a>
        <a href="/dashboard" class="tg-cad-link" data-testid="cad-scene-view">三维港区</a>
      </div>
    </div>
    <div class="tg-cad-water-systems" data-testid="cad-process-shortcuts">
      <button v-for="s in WATER_PROCESSES" :key="s.id" :data-system-node="s.id"
        @click="openSystem(s.id)">{{s.label}}</button>
    </div>
    <div class="tg-cad-water-body">
      <div class="tg-cad-water-preview">
        <a :href="CAD_MASTER" target="_blank" rel="noopener" title="打开可缩放CAD总控图">
          <img :src="CAD_MAP" alt="现有唐港51、52号泊位CAD V2总控梳理图"
            loading="lazy" data-testid="cad-master-image"/>
        </a>
        <div class="tg-cad-water-viewlinks">
          <a href="/tanggang/audit/cad-review/index.html" target="_blank" rel="noopener">
            二维CAD定位
          </a>
          <a href="/tanggang/cad/l1-v2_8/V2.8_高疑点位.csv"
            target="_blank" rel="noopener">端点核查</a>
        </div>
      </div>
      <div class="tg-cad-water-panel">
        <div class="tg-cad-water-filters" role="group" aria-label="设计关系分类">
          <button v-for="view in (['all','collection','supply','separate'] as const)"
            :key="view" :class="{active:selectedView===view}" @click="selectView(view)">
            {{groupNames[view]}}
          </button>
        </div>
        <div class="tg-cad-water-relationships" data-testid="cad-relationships">
          <button v-for="edge in links" :key="edge.id" :data-relation-id="edge.id"
            type="button" :class="{picked:selectedId===edge.id}"
            @click="selectEdge(edge.id)">
            <strong>{{edge.label}}</strong>
            <small>{{edge.id}} · {{state(edge.status)}}</small>
          </button>
        </div>
        <div v-if="selected" class="tg-cad-water-detail"
          data-testid="cad-relationship-detail">
          <div class="tg-cad-water-detail-top">
            <strong>{{selected.label}}</strong>
            <span>{{state(selected.status)}}</span>
          </div>
          <p v-if="selected.note">{{selected.note}}</p>
          <div class="tg-cad-water-sources">
            <span>V2关系来源代码（非CAD Handle）</span>
            <code v-for="source in selected.sources" :key="source">{{source}}</code>
          </div>
          <div class="tg-cad-water-detail-actions">

            <a :href="CAD_MASTER" target="_blank" rel="noopener">查看总图</a>
          </div>
          <small class="tg-cad-water-unverified">
            {{cad.allConnectionsVerified?'工程待复核':'管段端点与启闭状态尚未核验'}}
          </small>
          <PortCadEndpointEvidence :relation-id="selected.id"/>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tg-cad-water{padding:16px 18px;min-width:0}
.tg-cad-water-head{display:flex;justify-content:space-between;align-items:center;
  flex-wrap:wrap;gap:10px;margin-bottom:12px}
.tg-cad-water-head h2{margin:0!important}
.tg-cad-water-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tg-cad-water-tag{font-size:10px;color:#7592a1}
.tg-cad-link,.tg-cad-water-detail-actions a,.tg-cad-water-viewlinks a{
  font-size:11px;border:1px solid #cfe4ee;background:rgba(244,250,253,.85);
  color:#347e9b;padding:7px 10px;text-decoration:none;border-radius:6px;white-space:nowrap}
.tg-cad-link:hover,.tg-cad-water-detail-actions a:hover{border-color:#6cb1cc}
.tg-cad-water-systems{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:8px 0 13px}
.tg-cad-water-systems button{border:1px solid #dbe8f0;background:#f8fbfd;
  color:#507f96;border-radius:7px;font-size:11px;padding:7px 10px;cursor:pointer}
.tg-cad-water-systems button:hover{background:#e7f4f9}
.tg-cad-water-body{display:grid;grid-template-columns:minmax(0,1.32fr) minmax(300px,.9fr);
  gap:14px;align-items:start}
.tg-cad-water-preview,.tg-cad-water-panel{min-width:0;border-radius:9px;
  overflow:hidden;border:1px solid #dceaf0;background:#f7fafc}
.tg-cad-water-preview>a{display:block;overflow:hidden}
.tg-cad-water-preview img{width:100%;height:auto;max-height:520px;
  display:block;object-fit:contain;background:#eef5f9}
.tg-cad-water-viewlinks{display:flex;justify-content:flex-end;gap:7px;
  flex-wrap:wrap;padding:9px}
.tg-cad-water-viewlinks a{background:#fff;font-size:10px}
.tg-cad-water-panel{padding:10px;display:flex;flex-direction:column;gap:10px}
.tg-cad-water-filters{display:flex;flex-wrap:wrap;gap:6px}
.tg-cad-water-filters button{font:inherit;font-size:11px;border:0;
  border-radius:5px;background:transparent;color:#7895a4;cursor:pointer;padding:6px 9px}
.tg-cad-water-filters button.active{background:#e3f1f7;color:#287e9e;font-weight:650}
.tg-cad-water-relationships{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:7px;max-height:330px;overflow-y:auto}
.tg-cad-water-relationships button{display:flex;flex-direction:column;gap:5px;
  text-align:left;border:1px solid #e0ebf1;background:#fff;border-radius:6px;
  padding:8px 9px;cursor:pointer;min-width:0}
.tg-cad-water-relationships button.picked{border-color:#71b3ce;background:#ebf7fb}
.tg-cad-water-relationships strong{font-size:11px;color:#4a7487;font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-cad-water-relationships small{font-size:10px;color:#96a9b1}
.tg-cad-water-detail{border-top:1px solid #dce9f0;padding:11px 2px 3px}
.tg-cad-water-detail-top{display:flex;align-items:center;justify-content:space-between;
  gap:8px}
.tg-cad-water-detail-top strong{font-size:12px;color:#3d758f}
.tg-cad-water-detail-top span{font-size:10px;color:#9a875f;flex-shrink:0}
.tg-cad-water-detail p{margin:8px 0;font-size:11px;color:#6a8799}
.tg-cad-water-sources,.tg-cad-water-detail-actions{display:flex;flex-wrap:wrap;
  align-items:center;gap:6px;margin-top:9px}
.tg-cad-water-sources span{color:#8aa0ad;font-size:10px}
.tg-cad-water-sources code{color:#527c8f;background:#e7f1f6;font-size:10px;padding:3px 6px;border-radius:4px}
.tg-cad-water-unverified{display:block;color:#9caeb6;font-size:10px;margin-top:9px}
@media(max-width:1120px){.tg-cad-water-body{grid-template-columns:1fr}}
@media(max-width:580px){.tg-cad-water{padding:12px}
 .tg-cad-water-relationships{grid-template-columns:1fr}
 .tg-cad-water-preview img{max-height:320px}}
</style>

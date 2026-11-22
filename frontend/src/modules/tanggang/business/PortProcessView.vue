<script setup lang="ts">
import {computed,onMounted,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {loadTanggangCatalog,type TanggangCatalog,type TanggangDevice} from '../mapping/tanggangCatalog'
import {buildProcessSchematic} from './processSchematic'
import PortProcessSchematic from './PortProcessSchematic.vue'
import PortObjectBindingDialog from './PortObjectBindingDialog.vue'
import {usePermissions} from '@/utils/permissions'
import {
  fetchTanggangObjectLinks,type TanggangObjectLink,type TanggangSystemId,
} from '@/api/tanggang'
import {useScenarioStore} from '../simulation/store'
import './business.css'
import './scenario-pages.css'

const route=useRoute(),router=useRouter(),sim=useScenarioStore()
const {hasPerm}=usePermissions()
const canBind=computed(()=>hasPerm('eq:update'))
const catalog=ref<TanggangCatalog|null>(null)
const error=ref('')
const sysId=computed(()=>String(route.params.systemId||''))
const system=computed(()=>catalog.value?.systemMap.get(sysId.value))
const displayName=computed(()=>sysId.value==='domestic'
  ?'生活污水提升与外送':system.value?.name||'专业工艺监测')
const schematic=computed(()=>system.value&&catalog.value
  ?buildProcessSchematic(system.value,catalog.value):null)
const unique=computed(()=>schematic.value?.devices||[])
const selectedId=computed(()=>{
  const requested=route.query.facility
  if(typeof requested==='string'&&unique.value.some(x=>x.id===requested))return requested
  return unique.value[0]?.id||null
})
const selectedDevice=computed(()=>unique.value.find(d=>d.id===selectedId.value)||null)
const objectLinks=ref<TanggangObjectLink[]>([])
const linkError=ref('')
const bindingOpen=ref(false)
const bindingDevice=ref<TanggangDevice|null>(null)
const bindingExisting=ref<TanggangObjectLink|null>(null)
const linksByFacility=computed(()=>{
  const map=new Map<string,TanggangObjectLink[]>()
  for(const link of objectLinks.value){
    const entries=map.get(link.facility_id)||[]
    entries.push(link)
    map.set(link.facility_id,entries)
  }
  return map
})
const linkedFacilityIds=computed<ReadonlySet<string>>(()=>new Set(linksByFacility.value.keys()))
const selectedLinks=computed(()=>selectedId.value?linksByFacility.value.get(selectedId.value)||[]:[])
const simSummary=computed(()=>{
  if(!sim.running||!sim.result)return null
  const r=sim.result
  switch(sysId.value){
    case 'middle':return '供水需求 '+r.demandedM3h+' m³/h，模拟分配 '+r.deliveredM3h+' m³/h，缺口 '+r.shortageM3h+' m³/h'
    case 'pool':return '假设未来'+r.input.horizonHours+'小时，统一演示水池储量 '+r.forecastPoolM3+' m³'
    case 'rain':return '假设降雨 '+r.input.rainMm+' mm，单个演示集水单元溢流 '+r.rainOverflowM3+' m³'
    default:return null
  }
})
const nextPath=computed(()=>{
  if(sysId.value==='middle'||sysId.value==='pool')return '/port/water/supply'
  if(sysId.value==='rain')return '/port/water/rain-risk'
  return '/port/operations/monitor'
})
const nextLabel=computed(()=>{
  if(sysId.value==='middle'||sysId.value==='pool')return '供水保障'
  if(sysId.value==='rain')return '雨水风险'
  return '主动智能监护'
})
let serial=0
async function loadObjectLinks(id:string){
  const key=++serial
  objectLinks.value=[]
  linkError.value=''
  if(!id)return
  try{
    const all:TanggangObjectLink[]=[]
    let page=1,total=0
    do{
      const response=await fetchTanggangObjectLinks({
        system_id:id as TanggangSystemId,page,page_size:200,
      })
      if(key!==serial)return
      all.push(...response.data.data.items)
      total=response.data.data.total
      page++
      if(page>26)throw Error('工程对象数量超过单次查询限制')
    }while(all.length<total)
    if(key===serial)objectLinks.value=all
  }catch{
    if(key===serial)linkError.value='工程对象关联读取失败，现有设计设施仍可浏览'
  }
}
watch(sysId,id=>{void loadObjectLinks(id)},{immediate:true})
onMounted(async()=>{
  try{catalog.value=await loadTanggangCatalog()}
  catch(e){error.value=e instanceof Error?e.message:String(e)}
})
function selectFacility(id:string){
  if(!unique.value.some(x=>x.id===id))return
  void router.replace({path:route.path,query:{facility:id}})
}
function openBinding(device:TanggangDevice,existing:TanggangObjectLink|null=null){
  bindingDevice.value=device
  bindingExisting.value=existing
  bindingOpen.value=true
}
function savedBinding(){void loadObjectLinks(sysId.value)}
</script>

<template>
  <main class="tg-biz tg-process-page page-fill">
    <div class="tg-biz-head">
      <div><h1>{{displayName}}</h1></div>
      <div class="tg-biz-actions">
        <span v-if="sim.running" class="tg-datamode sim">SIM · {{sim.activeScenario?.title}}</span>
        <el-button plain @click="router.push(nextPath)">{{nextLabel}}</el-button>
        <el-button plain @click="router.push('/dashboard')">返回港区</el-button>
      </div>
    </div>
    <div v-if="error" class="tg-biz-empty">{{error}}</div>
    <div v-else-if="!catalog" class="tg-biz-empty">正在读取工程资料…</div>
    <div v-else-if="!system" class="tg-biz-empty">该专业系统不存在，请从运行监测菜单选择六个系统之一。</div>

    <template v-else>
      <div v-if="simSummary" class="tg-process-sim">
        <strong>SIM · {{simSummary}}</strong>
        <el-button link type="primary" @click="router.push(nextPath)">查看分析</el-button>
      </div>
      <div v-else-if="sim.running" class="tg-process-sim">
        本情景没有与该系统具体设施核对过的模拟测点，不展示单台设备数值。
        <el-button link @click="sim.openConsole()">查看统一情景</el-button>
      </div>
      <div class="tg-process-grid">
        <PortProcessSchematic :sections="schematic?.sections||[]"
          :selected-facility-id="selectedId"
          :linked-facility-ids="linkedFacilityIds"
          :source-layers="system.focusPipeLayers"
          @select="selectFacility"/>

        <section class="tg-biz-card tg-process-detail" aria-label="当前选中设施">
          <template v-if="selectedDevice">
            <div class="tg-process-detail-head">
              <h2>{{selectedDevice.name}}</h2>
              <span v-if="selectedLinks.length" class="tg-biz-chip">对象已关联</span>
            </div>
            <div class="tg-process-detail-meta">
              <span>{{selectedDevice.regionName}}</span>
              <span>{{selectedDevice.id}}</span>
            </div>
            <div class="tg-process-fields">
              <h3>设计建议测点</h3>
              <div v-if="selectedDevice.dataFields?.length" class="tg-process-field-items">
                <span v-for="item in selectedDevice.dataFields" :key="item">{{item}}</span>
              </div>
              <p v-else class="tg-biz-sub">暂无设计参考测点</p>
            </div>
            <div class="tg-process-info">
              <div v-if="selectedDevice.sourceDoc">
                <span>资料来源</span><strong>{{selectedDevice.sourceDoc}}</strong>
              </div>
              <div v-if="selectedDevice.designQuantity">
                <span>设计数量</span><strong>{{selectedDevice.designQuantity}}</strong>
              </div>
              <div v-if="selectedDevice.specSection">
                <span>规格章节</span><strong>{{selectedDevice.specSection}}</strong>
              </div>
              <div v-if="selectedDevice.sourceCadHandle">
                <span>CAD Handle</span><strong>{{selectedDevice.sourceCadHandle}}</strong>
              </div>
            </div>
            <p v-if="selectedDevice.notes" class="tg-process-description">{{selectedDevice.notes}}</p>

            <div class="tg-process-bindings">
              <div class="tg-biz-card-head"><h3>工程对象与设备关联</h3></div>
              <template v-if="selectedLinks.length">
                <div v-for="link in selectedLinks" :key="link.id" class="tg-process-bound-row">
                  <div class="tg-process-bound-top">
                    <span>{{link.object_id}}</span>
                    <el-button v-if="canBind" link @click="openBinding(selectedDevice,link)">编辑</el-button>
                  </div>
                  <div v-for="asset in link.assets||[]" :key="asset.id">
                    <el-button link type="primary"
                      @click="router.push('/equipment/detail/'+asset.id)">{{asset.name}}</el-button>
                  </div>
                  <span v-if="link.metric_ids.length" class="tg-process-point-ids">
                    已登记测点ID：{{link.metric_ids.join('、')}}
                  </span>
                  <span v-if="!link.verified" class="tg-process-point-ids">对象关系尚待审核</span>
                </div>
              </template>
              <p v-else class="tg-biz-sub">暂无对应工程对象/设备记录；不代表现场设备不存在。</p>
              <el-button v-if="canBind" plain size="small"
                @click="openBinding(selectedDevice)">配置工程关联</el-button>
            </div>
          </template>
          <div v-else class="tg-biz-empty">该系统没有设计设施可供查看</div>
        </section>
      </div>

      <div v-if="linkError" class="tg-process-inline-error" role="status">{{linkError}}</div>
      <div v-if="schematic?.missingIds.length" class="tg-process-inline-error" role="status">
        以下设施在区域设计清单中缺少对应条目：{{schematic.missingIds.join('、')}}
      </div>
      <div class="tg-process-bottom">
        <p>{{system.disclaimer||'设计分区不代表已经核实管道连通、泵阀控制与现场点表。'}}</p>
        <el-button link @click="router.push('/port/data/provenance')">资料与测点核对</el-button>
      </div>
    </template>
    <PortObjectBindingDialog v-model:open="bindingOpen"
      :device="bindingDevice" :existing="bindingExisting"
      :system-id="sysId as TanggangSystemId"
      @saved="savedBinding"/>
  </main>
</template>

<style scoped>
.tg-process-page{min-width:0}
.tg-process-grid{display:grid;grid-template-columns:minmax(0,1.92fr) minmax(310px,.88fr);
  gap:14px;align-items:start}
.tg-process-detail{position:sticky;top:14px;display:grid;gap:14px}
.tg-process-detail-head{display:flex;align-items:start;justify-content:space-between;gap:8px}
.tg-process-detail-head h2{margin-bottom:0;font-size:17px}
.tg-process-detail-meta{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:11px;color:#869caa}
.tg-process-fields h3,.tg-process-bindings h3{font-size:13px;font-weight:660;
  color:#365c73;margin:0 0 11px}
.tg-process-field-items{display:flex;flex-wrap:wrap;gap:7px}
.tg-process-field-items span{background:rgba(230,242,249,.78);border:1px solid #d6e7ef;
  border-radius:5px;padding:5px 9px;color:#47748b;font-size:11px}
.tg-process-info{display:grid;gap:9px;font-size:12px;border-top:1px solid #e7eff4;
  border-bottom:1px solid #e7eff4;padding:13px 0}
.tg-process-info>div{display:flex;gap:12px;justify-content:space-between}
.tg-process-info span{color:#8399a7}
.tg-process-info strong{font-weight:570;color:#476d83;text-align:right}
.tg-process-description{font-size:12px!important;color:#718b9a!important;
  margin:0!important;line-height:1.7}
.tg-process-bindings{display:grid;gap:9px}
.tg-process-bindings .el-button{justify-self:start}
.tg-process-bound-row{padding:10px 0;border-top:1px solid #ecf2f6;font-size:12px}
.tg-process-bound-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.tg-process-bound-top span{overflow-wrap:anywhere;color:#6c8999}
.tg-process-point-ids{display:block;font-size:11px;color:#8199a8;line-height:1.6}
.tg-process-sim{display:flex;gap:12px;align-items:center;justify-content:space-between;
  flex-wrap:wrap;border:1px solid #eadac1;background:rgba(253,247,236,.75);
  border-radius:8px;padding:10px 13px;margin-bottom:14px;font-size:12px;color:#9b713e}
.tg-process-sim strong{font-weight:620}
.tg-process-bottom{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;
  gap:8px 15px;padding:12px 2px;color:#7f97a4}
.tg-process-bottom p{font-size:11px;max-width:780px;margin:0}
.tg-process-inline-error{color:#ac6d3c;font-size:12px;padding:11px 2px}
@media(max-width:1250px){.tg-process-grid{grid-template-columns:minmax(0,1.4fr) minmax(290px,1fr)}}
@media(max-width:900px){.tg-process-grid{grid-template-columns:minmax(0,1fr)}.tg-process-detail{position:static}}
</style>

<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import {useRouter} from 'vue-router'
import {loadTanggangCatalog,type TanggangCatalog} from '../mapping/tanggangCatalog'
import {relationFor,endpointFor,knownCadAnchor,anchorFocusUrl} from './cadWaterTrace'
const props=defineProps<{relationId:string}>()
const router=useRouter()
const catalog=ref<TanggangCatalog|null>(null)
const catalogError=ref('')
const rel=computed(()=>relationFor(props.relationId))
const sides=computed(()=>{
  if(!rel.value)return []
  return [
    {key:'from',title:'来源区域',node:rel.value.from,area:endpointFor(rel.value.from)},
    {key:'to',title:'去向区域',node:rel.value.to,area:endpointFor(rel.value.to)},
  ]
})
const areaName=(id:string|null|undefined)=>
  id&&catalog.value?.regionMap.get(id)?.name||'尚无独立区域映射'
const devices=(regionId:string|null|undefined)=>
  regionId?catalog.value?.regionMap.get(regionId)?.devices.slice(0,4)||[]:[]
function goProcess(id:string|null){
  if(!id)return
  void router.push({path:'/port/process/'+id,query:{cad_relation:props.relationId}})
}
onMounted(async()=>{
  try{catalog.value=await loadTanggangCatalog()}
  catch{catalogError.value='设计设备目录暂时无法加载，CAD原图证据仍可查看'}
})
</script>

<template>
  <div v-if="rel" class="tg-evidence" data-testid="cad-endpoint-evidence">
    <div class="tg-evidence-head">
      <strong>两端设施追溯</strong>
      <small>CAD文字定位 ≠ 实际管道连通</small>
    </div>
    <div class="tg-evidence-sides">
      <section v-for="side in sides" :key="side.key"
        class="tg-evidence-side" :data-endpoint="side.key">
        <div class="tg-evidence-side-head">
          <span>{{side.title}}</span>
          <strong>{{areaName(side.area?.regionId)}}</strong>
        </div>
        <p>{{side.area?.scope||'尚无CAD区域资料'}}</p>
        <div v-if="side.area?.anchors.length" class="tg-evidence-anchors">
          <template v-for="anchorId in side.area.anchors" :key="anchorId">
            <a v-if="anchorFocusUrl(anchorId)"
              :href="anchorFocusUrl(anchorId)!"
              target="_blank" rel="noopener"
              :data-cad-anchor="anchorId">
              {{anchorId}}
              <span>{{knownCadAnchor(anchorId)?.type==='设计文字（非设施中心）'?'文字注记':'区域文字点'}}</span>
            </a>
          </template>
        </div>
        <div v-else class="tg-evidence-unmapped">该环节暂无可直达的CAD设施锚点</div>
        <button v-if="side.area?.process"
          type="button" class="tg-evidence-process"
          :data-cad-process="side.area.process"
          @click="goProcess(side.area.process)">
          查看关联工艺
        </button>
      </section>
    </div>
    <details class="tg-evidence-data" data-testid="cad-measurement-readiness">
      <summary>设备与测点准备情况</summary>
      <p>下列是设计设备目录中建议采集的字段，不是已经安装或接入的测点。</p>
      <div v-if="catalogError" class="tg-evidence-unmapped">{{catalogError}}</div>
      <div v-for="side in sides" :key="side.key" class="tg-evidence-device-group">
        <strong>{{side.title}} · {{areaName(side.area?.regionId)}}</strong>
        <template v-if="devices(side.area?.regionId).length">
          <div v-for="dev in devices(side.area?.regionId)" :key="dev.id" class="tg-evidence-device">
            <span>{{dev.name}} <small>{{dev.id}}</small></span>
            <span>{{dev.dataFields.join(' / ')||'暂无设计测点'}}</span>
            <small>CAD设备级对应：{{dev.sourceCadHandle||'待绑定'}} · {{dev.currentStatus||'现场状态待确认'}}</small>
          </div>
        </template>
        <span v-else class="tg-evidence-unmapped">无设备级映射或尚未读取目录</span>
      </div>
      <div class="tg-evidence-connection-status">现场实测值、测点ID、实际阀位、泵曲线及管网端点：尚未核验</div>
    </details>
  </div>
</template>

<style scoped>
.tg-evidence{border-top:1px solid #dfeaf0;padding:13px 0 2px;margin-top:12px}
.tg-evidence-head{display:flex;justify-content:space-between;gap:9px;align-items:center}
.tg-evidence-head strong{font-size:12px;color:#3b718c}
.tg-evidence-head small{font-size:10px;color:#96a9b3}
.tg-evidence-sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
.tg-evidence-side{min-width:0;background:#fff;border:1px solid #e0ebf1;
  border-radius:7px;padding:11px}
.tg-evidence-side-head{display:flex;flex-direction:column;gap:4px}
.tg-evidence-side-head span{font-size:10px;color:#93a9b5}
.tg-evidence-side-head strong{font-size:11px;color:#487c94}
.tg-evidence-side>p{margin:7px 0;color:#889eab;font-size:10px;line-height:1.65}
.tg-evidence-anchors{display:flex;gap:5px;flex-wrap:wrap}
.tg-evidence-anchors a{display:inline-flex;gap:3px;flex-direction:column;
  font-size:10px;text-decoration:none;color:#377f9e;border:1px solid #d3e8f1;
  background:#f1f8fc;border-radius:5px;padding:5px 6px}
.tg-evidence-anchors span{color:#8ea4ae;font-size:9px}
.tg-evidence-unmapped{font-size:10px;color:#9cacb5;line-height:1.6}
.tg-evidence-process{font:inherit;font-size:10px;cursor:pointer;
  border:0;background:transparent;color:#347f9e;padding:8px 0 0;text-align:left}
.tg-evidence-data{margin-top:13px;border-top:1px solid #e2edf3;padding-top:11px}
.tg-evidence-data summary{font-size:11px;color:#52839a;cursor:pointer}
.tg-evidence-data>p{font-size:10px;line-height:1.6;color:#94a4ae;margin:9px 0}
.tg-evidence-device-group{padding:10px 0;border-top:1px dashed #dfeaf0}
.tg-evidence-device-group>strong{font-size:10px;color:#587b8e}
.tg-evidence-device{font-size:10px;display:flex;flex-direction:column;gap:4px;
  color:#668a9d;padding:8px 0;border-bottom:1px solid #ecf2f5}
.tg-evidence-device span:last-child{color:#8a9eac}
.tg-evidence-device small{font-size:9px;color:#9eacb5}
.tg-evidence-connection-status{color:#ae8667;font-size:10px;padding:9px 0}
@media(max-width:650px){.tg-evidence-sides{grid-template-columns:1fr}}
</style>

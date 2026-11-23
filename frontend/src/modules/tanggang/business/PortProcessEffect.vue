<script setup lang="ts">
/**
 * CAD-grounded *conceptual effect preview*.
 * It must never claim field geometry, hydraulic connections or telemetry.
 * Each illustrated symbol resolves to the same catalog facility as SCADA.
 */
import {computed} from 'vue'
import type {ProcessSchematicSection} from './processSchematic'
import type {ProcessMockDevice,ProcessDeviceKind} from './processMock'

const props=defineProps<{
  sections:ProcessSchematicSection[]
  selectedFacilityId:string|null
  mockByFacility:ReadonlyMap<string,ProcessMockDevice>
  sourceLayers:string[]
}>()
const emit=defineEmits<{select:[id:string]}>()
const total=computed(()=>props.sections.reduce((n,s)=>n+s.devices.length,0))
const symbols:Partial<Record<ProcessDeviceKind,string>>={
  pump:'centrifugal_pump',pool:'water_tank',
  valve:'butterfly_valve',meter:'flow_meter',
  pipe:'pipe_straight',
}
function assetFor(id:string){
  const kind=props.mockByFacility.get(id)?.deviceKind||'facility'
  const file=symbols[kind]
  return file?'/tanggang/process-symbols/'+file+'.png':null
}
function stateFor(id:string){
  return props.mockByFacility.get(id)?.state||'available'
}
</script>

<template>
  <section class="tg-biz-card tg-effect-sheet" data-testid="process-effect-sheet">
    <div class="tg-effect-head">
      <div>
        <h2>工艺设施效果示意</h2>
        <p>依据CAD设计设施与分区关系重新绘制，展示设备类别和业务位置关系</p>
      </div>
      <span class="tg-effect-count">{{sections.length}} 个区域 · {{total}} 处设计设施</span>
    </div>
    <div class="tg-effect-landscape" :class="{'is-single':sections.length===1}">
      <div class="tg-effect-ground" aria-hidden="true"/>
      <section v-for="(section,i) in sections" :key="section.id"
        class="tg-effect-sector" :data-region-id="section.id">
        <div class="tg-effect-sector-head">
          <span class="tg-effect-index">{{String(i+1).padStart(2,'0')}}</span>
          <strong>{{section.title}}</strong>
          <small>CAD 区域 · {{section.devices.length}} 处</small>
        </div>
        <div class="tg-effect-devices">
          <button v-for="device in section.devices" :key="device.id"
            type="button" class="tg-effect-facility"
            :class="{'is-selected':selectedFacilityId===device.id,
              'is-attention':['attention','fault'].includes(stateFor(device.id))}"
            :data-facility-id="device.id"
            :aria-label="'查看'+device.name+'详情'"
            :aria-pressed="selectedFacilityId===device.id"
            @click="emit('select',device.id)">
            <span class="tg-effect-unit" aria-hidden="true">
              <span class="tg-effect-unit-base"/>
              <img v-if="assetFor(device.id)" :src="assetFor(device.id)!"
                alt="" loading="lazy"/>
              <span v-else class="tg-effect-machine">
                <span class="tg-effect-machine-top"/>
                <span class="tg-effect-machine-face">
                  <i/><i/><i/>
                </span>
              </span>
            </span>
            <span class="tg-effect-device-label">
              <strong :title="device.name">{{device.name}}</strong>
              <small>{{device.id}}</small>
            </span>
          </button>
        </div>
      </section>
      <p v-if="!sections.length" class="tg-biz-empty">
        暂无可显示的CAD设计设施
      </p>
    </div>
    <div class="tg-effect-foot">
      <span>仅为效果概念预览 · 图示位置与尺寸不是实测坐标 · 不暗示设备间水力连接</span>
      <span v-if="sourceLayers.length">原图层：{{sourceLayers.join('、')}}</span>
    </div>
  </section>
</template>

<style scoped>
.tg-effect-sheet{padding:17px 18px;min-width:0}
.tg-effect-head{display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:10px;margin-bottom:13px}
.tg-effect-head h2{margin:0 0 4px;font-size:15px;font-weight:670;color:#355d73}
.tg-effect-head p{margin:0;font-size:11px;color:#849aa9}
.tg-effect-count{font-size:11px;color:#6790a7;white-space:nowrap}
.tg-effect-landscape{position:relative;overflow:hidden;isolation:isolate;
  min-height:545px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  align-content:start;gap:11px;padding:15px;border:1px solid #d6e6ef;
  border-radius:8px;background:linear-gradient(180deg,#eaf6fb 0%,#f2f8f9 54%,#e2f0ee 100%)}
.tg-effect-ground{position:absolute;z-index:-1;inset:0;pointer-events:none;
  background-image:linear-gradient(125deg,transparent 30%,rgba(127,179,201,.12) 50%,transparent 72%),
    repeating-linear-gradient(0deg,transparent 0 39px,rgba(105,150,166,.075) 40px 41px),
    repeating-linear-gradient(90deg,transparent 0 55px,rgba(105,150,166,.065) 56px 57px);
  transform:perspective(520px) rotateX(12deg) scale(1.1);transform-origin:50% 100%}
.tg-effect-landscape.is-single{grid-template-columns:minmax(0,1fr)}
.tg-effect-sector{min-width:0;padding:11px 13px 14px;border:1px solid rgba(163,198,215,.65);
  border-radius:9px;background:linear-gradient(160deg,rgba(255,255,255,.9),rgba(231,245,251,.66));
  box-shadow:0 5px 15px rgba(80,136,158,.08),inset 0 1px 0 rgba(255,255,255,.8)}
.tg-effect-sector-head{display:flex;align-items:center;gap:8px;min-width:0;
  border-bottom:1px solid #dceaf0;padding-bottom:9px;color:#3b6c84}
.tg-effect-index{background:#dbeef7;color:#4f8caa;padding:3px 6px;border-radius:4px;
  font-size:11px;font-weight:750}
.tg-effect-sector-head strong{font-size:12px;font-weight:650;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.tg-effect-sector-head small{font-size:10px;color:#86a0ad;margin-left:auto;
  white-space:nowrap}
.tg-effect-devices{display:flex;align-items:flex-start;justify-content:space-around;
  flex-wrap:wrap;gap:10px 7px;padding:11px 0 0;min-height:150px}
.tg-effect-facility{appearance:none;border:1px solid transparent;background:transparent;
  width:104px;display:flex;flex-direction:column;align-items:center;padding:5px 4px 6px;
  gap:5px;cursor:pointer;border-radius:8px;transition:background .15s,border-color .15s}
.tg-effect-facility:hover,.tg-effect-facility:focus-visible{border-color:#a8cadc;
  background:rgba(250,254,255,.8)}
.tg-effect-facility.is-selected{background:rgba(236,249,254,.92);
  border-color:#4b98bd;box-shadow:0 0 0 1px rgba(75,152,189,.22)}
.tg-effect-facility.is-attention .tg-effect-device-label strong{color:#b77e45}
.tg-effect-unit{position:relative;width:90px;height:77px;display:grid;
  place-items:center}
.tg-effect-unit-base{position:absolute;bottom:1px;left:8px;width:74px;height:22px;
  border-radius:50%;background:rgba(72,116,134,.14);transform:skewX(-12deg)}
.tg-effect-unit img{position:relative;display:block;max-width:84px;max-height:74px;
  object-fit:contain;filter:drop-shadow(0 4px 3px rgba(56,108,130,.19))}
.tg-effect-machine{position:relative;display:block;width:55px;height:47px;
  margin-top:-5px;filter:drop-shadow(4px 6px 3px rgba(72,128,149,.18))}
.tg-effect-machine-face{display:flex;align-items:start;gap:6px;padding:11px 8px;
  width:55px;height:40px;background:linear-gradient(115deg,#d4e9f1,#a6c9d9);
  border:1px solid #7da9bc;border-radius:3px 3px 6px 6px;
  box-shadow:inset -8px 0 0 rgba(75,130,153,.13)}
.tg-effect-machine-face i{width:7px;height:7px;border-radius:50%;
  border:1px solid #83b0c5;background:#e9f5f7}
.tg-effect-machine-top{position:absolute;top:-8px;left:5px;width:51px;height:10px;
  background:#e8f5f9;border:1px solid #a5c5d4;transform:skewX(-36deg)}
.tg-effect-device-label{display:flex;flex-direction:column;align-items:center;
  gap:3px;max-width:95px;text-align:center}
.tg-effect-device-label strong{font-size:11px;color:#39697f;font-weight:650;
  line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.tg-effect-device-label small{font-size:9px;color:#8aa5b2;overflow-wrap:anywhere}
.tg-effect-foot{display:flex;justify-content:space-between;gap:6px 18px;
  flex-wrap:wrap;padding:11px 2px 0;font-size:10px;color:#839ba7}
@media(max-width:1260px){.tg-effect-landscape{grid-template-columns:1fr}}
@media(max-width:900px){.tg-effect-landscape{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:660px){.tg-effect-landscape{grid-template-columns:1fr;
  min-height:0;padding:9px}.tg-effect-sector{padding:10px}
  .tg-effect-facility{width:91px}.tg-effect-sector-head small{display:none}}
@media(prefers-reduced-motion:reduce){.tg-effect-facility{transition:none}}
</style>

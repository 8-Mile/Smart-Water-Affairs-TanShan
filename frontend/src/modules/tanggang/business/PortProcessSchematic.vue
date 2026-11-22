<script setup lang="ts">
import {computed} from 'vue'
import type {ProcessSchematicSection} from './processSchematic'

const props=defineProps<{
  sections:ProcessSchematicSection[]
  selectedFacilityId:string|null
  linkedFacilityIds:ReadonlySet<string>
  sourceLayers:string[]
}>()
const emit=defineEmits<{select:[id:string]}>()
const totalNodes=computed(()=>props.sections.reduce((n,s)=>n+s.devices.length,0))
</script>

<template>
  <section class="tg-biz-card tg-scada-board">
    <div class="tg-biz-card-head">
      <h2>工艺设施分区</h2>
      <span class="tg-scada-board-count">{{totalNodes}} 个设计设施类别</span>
    </div>
    <div class="tg-scada-canvas">
      <div v-for="section in sections" :key="section.id" class="tg-scada-zone">
        <div class="tg-scada-zone-name">
          <strong>{{section.title}}</strong>
        </div>
        <div class="tg-scada-nodes">
          <button v-for="device in section.devices" :key="device.id"
            type="button" class="tg-scada-node"
            :class="{'is-selected':selectedFacilityId===device.id,
                     'is-linked':linkedFacilityIds.has(device.id)}"
            :aria-pressed="selectedFacilityId===device.id"
            :data-facility-id="device.id"
            @click="emit('select',device.id)">
            <span class="tg-scada-indicator" aria-hidden="true"/>
            <span class="tg-scada-node-content">
              <strong>{{device.name}}</strong>
              <small>{{device.id}}</small>
            </span>
            <span v-if="linkedFacilityIds.has(device.id)"
              class="tg-scada-link-dot" aria-label="已登记对象关联"/>
          </button>
        </div>
      </div>
      <div v-if="!sections.length" class="tg-biz-empty">暂无可显示的设计设施</div>
    </div>
    <div class="tg-scada-board-foot">
      <span>CAD设计分区 · 非管网连通图</span>
      <span v-if="sourceLayers.length">参考图层：{{sourceLayers.join('、')}}</span>
    </div>
  </section>
</template>

<style scoped>
.tg-scada-board{padding:18px;min-width:0}
.tg-scada-board-count{font-size:12px;color:var(--art-gray-500,#849aa7)}
.tg-scada-canvas{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:13px;min-width:0;padding:15px;border:1px solid #dce7ee;border-radius:9px;
  background-color:rgba(242,248,251,.48);
  background-image:linear-gradient(rgba(119,169,192,.065) 1px,transparent 1px),
    linear-gradient(90deg,rgba(119,169,192,.065) 1px,transparent 1px);
  background-size:24px 24px;
}
.tg-scada-zone{min-width:0;border:1px solid #d6e3ec;border-radius:8px;
  background:rgba(255,255,255,.78);padding:12px}
.tg-scada-zone-name{display:flex;align-items:center;gap:7px;border-bottom:1px solid #e3edf2;
  padding:0 0 10px;margin:0 0 11px}
.tg-scada-zone-name strong{font-size:13px;color:#355c72;font-weight:650}
.tg-scada-nodes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.tg-scada-node{width:100%;min-width:0;min-height:70px;display:flex;align-items:flex-start;
  gap:9px;text-align:left;padding:12px 10px;
  border-radius:7px;border:1px solid #d6e4eb;background:rgba(255,255,255,.92);
  cursor:pointer;font:inherit;color:inherit;transition:border-color .16s,background .16s,box-shadow .16s}
.tg-scada-node:hover{border-color:#8abbd3;background:#f7fcff}
.tg-scada-node:focus-visible{outline:2px solid var(--theme-color,#3c93b4);outline-offset:2px}
.tg-scada-node.is-selected{border-color:var(--theme-color,#4193b4);background:#eff8fc;
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--theme-color,#4193b4) 32%,transparent)}
.tg-scada-indicator{display:block;width:8px;height:8px;border-radius:2px;
  background:#b7c9d2;border:1px solid #9bb5c3;margin-top:4px;flex-shrink:0}
.tg-scada-node.is-linked .tg-scada-indicator{background:#82b8cf;border-color:#62a1bf}
.tg-scada-node-content{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.tg-scada-node-content strong{font-size:12px;font-weight:620;line-height:1.5;
  color:#33586e;overflow-wrap:anywhere}
.tg-scada-node-content small{color:#849da9;font-size:10px;overflow-wrap:anywhere}
.tg-scada-link-dot{width:5px;height:5px;flex-shrink:0;border-radius:100%;
  background:#71aac0;margin-top:5px}
.tg-scada-board-foot{display:flex;justify-content:space-between;gap:8px 20px;flex-wrap:wrap;
  font-size:11px;color:#829aa9;padding:13px 2px 0;line-height:1.6}
@media(max-width:1380px){.tg-scada-canvas{grid-template-columns:1fr}}
@media(max-width:900px){.tg-scada-canvas{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.tg-scada-canvas{grid-template-columns:1fr}}
@media(max-width:440px){.tg-scada-nodes{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.tg-scada-node{transition:none}}
</style>

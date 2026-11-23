<script setup lang="ts">
import {computed} from 'vue'
import {Icon} from '@iconify/vue'
import type {ProcessMockDevice,ProcessDeviceKind} from './processMock'
import type {ProcessSchematicSection} from './processSchematic'

const props=defineProps<{
  sections:ProcessSchematicSection[]
  selectedFacilityId:string|null
  linkedFacilityIds:ReadonlySet<string>
  reviewedFacilityIds:ReadonlySet<string>
  simRunning:boolean
  sourceLayers:string[]
  mockByFacility:ReadonlyMap<string,ProcessMockDevice>
}>()
const emit=defineEmits<{
  select:[id:string]
  focusAttention:[]
  focusReviewed:[]
}>()
const totalNodes=computed(()=>props.sections.reduce((n,s)=>n+s.devices.length,0))
const attentionCount=computed(()=>props.simRunning
  ?props.sections.reduce((n,section)=>n+section.devices.filter(d=>
      ['attention','fault'].includes(props.mockByFacility.get(d.id)?.state||'available'),
    ).length,0):0)
const reviewedCount=computed(()=>props.simRunning
  ?props.sections.reduce((n,section)=>n+section.devices.filter(d=>
      props.reviewedFacilityIds.has(d.id),
    ).length,0):0)

const icons:Record<ProcessDeviceKind,string>={
  pump:'ri:water-flash-line',
  pool:'ri:drop-line',
  valve:'ri:equalizer-line',
  meter:'ri:dashboard-3-line',
  controller:'ri:cpu-line',
  pipe:'ri:route-line',
  treatment:'ri:filter-3-line',
  gate:'ri:door-open-line',
  facility:'ri:settings-3-line',
}
function iconOf(id:string){
  return icons[props.mockByFacility.get(id)?.deviceKind||'facility']
}
</script>

<template>
  <section class="tg-biz-card tg-scada-board">
    <div class="tg-biz-card-head">
      <h2>工艺设施分区</h2>
      <span class="tg-scada-board-count">{{totalNodes}} 个设计设施类别</span>
    </div>
    <div class="tg-scada-quickbar" data-testid="process-focus-bar">
      <span>{{simRunning?'SIM节点快速定位':'Mock基线 · 可启动情景'}}</span>
      <el-button size="small" text :disabled="!attentionCount"
        @click="emit('focusAttention')">
        定位SIM关注/异常（{{attentionCount}}）
      </el-button>
      <el-button size="small" text :disabled="!reviewedCount"
        @click="emit('focusReviewed')">
        定位本轮已核查（{{reviewedCount}}）
      </el-button>
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
                     'is-linked':linkedFacilityIds.has(device.id),
                     'is-fault':mockByFacility.get(device.id)?.state==='fault',
                     'is-attention':mockByFacility.get(device.id)?.state==='attention',
                     'is-reviewed':simRunning&&reviewedFacilityIds.has(device.id)}"
            :aria-pressed="selectedFacilityId===device.id"
            :data-facility-id="device.id"
            @click="emit('select',device.id)">
            <span class="tg-scada-symbol" aria-hidden="true">
              <Icon :icon="iconOf(device.id)" width="19" height="19"/>
            </span>
            <span class="tg-scada-node-content">
              <strong>{{device.name}}</strong>
              <small>{{device.id}}</small>
              <span v-if="mockByFacility.get(device.id)" class="tg-scada-node-bottom">
                <span class="tg-scada-node-state">{{mockByFacility.get(device.id)?.stateLabel}}</span>
                <span v-if="simRunning&&reviewedFacilityIds.has(device.id)"
                  class="tg-scada-reviewed">本轮已核查</span>
                <span class="tg-scada-node-sample">
                  {{mockByFacility.get(device.id)?.highlight?.value||'SIM示例'}}
                </span>
              </span>
            </span>
            <span v-if="linkedFacilityIds.has(device.id)"
              class="tg-scada-link-dot" aria-label="已登记对象关联"/>
          </button>
        </div>
      </div>
      <div v-if="!sections.length" class="tg-biz-empty">暂无可显示的设计设施</div>
    </div>
    <div class="tg-scada-board-foot">
      <span>CAD设计分区 · 节点值均为Mock · 非水力连通图</span>
      <span v-if="sourceLayers.length">参考图层：{{sourceLayers.join('、')}}</span>
    </div>
  </section>
</template>

<style scoped>
.tg-scada-board{padding:18px;min-width:0}
.tg-scada-board-count{font-size:12px;color:var(--art-gray-500,#849aa7)}
.tg-scada-quickbar{display:flex;gap:6px 12px;align-items:center;flex-wrap:wrap;
  margin:-3px 0 12px;padding:0 1px 11px;border-bottom:1px solid #e4edf3}
.tg-scada-quickbar>span{font-size:11px;color:#8299a7;margin-right:auto}
.tg-scada-quickbar :deep(.el-button){font-size:11px;height:24px}
.tg-scada-reviewed{font-size:10px;color:#4c8aa3;font-weight:600}
.tg-scada-node.is-reviewed{box-shadow:inset 0 -2px 0 rgba(87,156,184,.45)}

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
.tg-scada-node{width:100%;min-width:0;min-height:92px;display:flex;align-items:flex-start;
  gap:9px;text-align:left;padding:12px 10px;
  border-radius:7px;border:1px solid #d6e4eb;background:rgba(255,255,255,.92);
  cursor:pointer;font:inherit;color:inherit;transition:border-color .16s,background .16s,box-shadow .16s}
.tg-scada-node:hover{border-color:#8abbd3;background:#f7fcff}
.tg-scada-node:focus-visible{outline:2px solid var(--theme-color,#3c93b4);outline-offset:2px}
.tg-scada-node.is-selected{border-color:var(--theme-color,#4193b4);background:#eff8fc;
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--theme-color,#4193b4) 32%,transparent)}
.tg-scada-symbol{display:flex;align-items:center;justify-content:center;flex:0 0 29px;
  width:29px;height:29px;background:#eaf3f7;border:1px solid #d9e9ef;border-radius:6px;color:#4589a8}
.tg-scada-node.is-fault{border-color:#e9b2a6;background:#fff9f7}
.tg-scada-node.is-fault .tg-scada-symbol{background:#fff0ea;color:#bd715b;border-color:#efd2c6}
.tg-scada-node.is-attention{border-color:#ead5ac;background:#fffdf7}
.tg-scada-node.is-attention .tg-scada-symbol{background:#fff5e4;color:#af8b52}
.tg-scada-node-bottom{display:flex;gap:4px 8px;align-items:baseline;flex-wrap:wrap}
.tg-scada-node-state{font-size:10px;color:#6a90a4;white-space:nowrap}
.tg-scada-node.is-fault .tg-scada-node-state{color:#ba705d}
.tg-scada-node.is-attention .tg-scada-node-state{color:#b38947}
.tg-scada-node-sample{font-size:11px;color:#486e86;font-variant-numeric:tabular-nums}

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

<script setup lang="ts">
import {computed} from 'vue'
import type {ProcessMockDevice,ProcessDeviceKind} from './processMock'
import type {ProcessSchematicSection} from './processSchematic'
import {layoutProcessRegions} from './processDiagramLayout'

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
const diagram=computed(()=>layoutProcessRegions(props.sections))
const totalNodes=computed(()=>props.sections.reduce((n,s)=>n+s.devices.length,0))
const attentionCount=computed(()=>props.simRunning
  ?props.sections.reduce((n,s)=>n+s.devices.filter(d=>
    ['attention','fault'].includes(props.mockByFacility.get(d.id)?.state||'available'),
  ).length,0):0)
const reviewedCount=computed(()=>props.simRunning
  ?props.sections.reduce((n,s)=>n+s.devices.filter(d=>
    props.reviewedFacilityIds.has(d.id),
  ).length,0):0)

const imageByKind:Partial<Record<ProcessDeviceKind,string>>={
  pump:'centrifugal_pump',pool:'water_tank',valve:'butterfly_valve',
  meter:'flow_meter',pipe:'pipe_straight',
}
function imageFor(id:string):string|null{
  const kind=props.mockByFacility.get(id)?.deviceKind||'facility'
  const asset=imageByKind[kind]
  return asset?'/tanggang/process-symbols/'+asset+'.png':null
}
function statusFor(id:string){return props.mockByFacility.get(id)?.stateLabel||'未提供模拟状态'}
function stateFor(id:string){return props.mockByFacility.get(id)?.state||'available'}
function readingFor(id:string){
  const reading=props.mockByFacility.get(id)?.highlight
  return reading?reading.key+'：'+reading.value:'暂无模拟读数'
}
</script>

<template>
  <section class="tg-biz-card tg-scada-board">
    <div class="tg-biz-card-head">
      <h2>工艺设施组态总览</h2>
      <span class="tg-scada-board-count">{{totalNodes}} 处设计设施 · {{sections.length}} 个 CAD 区域</span>
    </div>
    <div class="tg-scada-quickbar" data-testid="process-focus-bar">
      <span>{{simRunning?'SIM节点快速定位':'Mock基线 · 可启动情景'}}</span>
      <el-button size="small" text :disabled="!attentionCount"
        @click="emit('focusAttention')">定位SIM关注/异常（{{attentionCount}}）</el-button>
      <el-button size="small" text :disabled="!reviewedCount"
        @click="emit('focusReviewed')">定位本轮已核查（{{reviewedCount}}）</el-button>
    </div>

    <div class="tg-scada-viewport" data-testid="process-schematic-diagram">
      <svg class="tg-scada-graphic"
        :viewBox="'0 0 '+diagram.width+' '+diagram.height"
        role="group" aria-label="工艺设计设施示意图，按CAD区域分组，非现场水力连接图">
        <defs>
          <pattern id="tg-process-grid" width="24" height="24"
            patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="#b5d3e2"
              stroke-width=".6" stroke-opacity=".42"/>
          </pattern>
        </defs>
        <rect x="0" y="0" :width="diagram.width" :height="diagram.height"
          fill="#f5fafc"/>
        <rect x="0" y="0" :width="diagram.width" :height="diagram.height"
          fill="url(#tg-process-grid)"/>

        <g v-for="(region,index) in diagram.regions" :key="region.id"
          class="tg-scada-zone" :data-region-id="region.id">
          <rect x="16" :y="region.y" :width="diagram.width-32"
            :height="region.height" rx="12" fill="#fff"
            fill-opacity=".84" stroke="#d6e5ee" stroke-width="1.4"/>
          <rect x="16" :y="region.y" width="190" :height="region.height"
            rx="12" fill="#e9f4fa" fill-opacity=".88"/>
          <rect x="199" :y="region.y+1" width="8"
            :height="region.height-2" fill="#f1f8fb"/>
          <path :d="'M207 '+(region.y+14)+'V'+(region.y+region.height-14)"
            stroke="#b8d7e5" stroke-width="1.5" stroke-dasharray="5 5"/>
          <text x="37" :y="region.y+35" class="tg-scada-zone-code">
            {{String(index+1).padStart(2,'0')}} / CAD区域
          </text>
          <text x="37" :y="region.y+61" class="tg-scada-zone-title">
            {{region.title.slice(0,11)}}
          </text>
          <text x="37" :y="region.y+82" class="tg-scada-zone-sub">
            设计设施 {{region.nodes.length}} 处
          </text>
          <text x="37" :y="region.y+region.height-23" class="tg-scada-zone-sub">
            仅分区关联 · 非流向
          </text>

          <g v-for="node in region.nodes" :key="node.device.id"
            class="tg-scada-node" role="button" tabindex="0"
            :data-facility-id="node.device.id"
            :aria-label="'查看'+node.device.name+'详情'"
            :aria-pressed="selectedFacilityId===node.device.id"
            :class="{'is-selected':selectedFacilityId===node.device.id,
              'is-linked':linkedFacilityIds.has(node.device.id),
              'is-fault':stateFor(node.device.id)==='fault',
              'is-attention':stateFor(node.device.id)==='attention',
              'is-reviewed':simRunning&&reviewedFacilityIds.has(node.device.id)}"
            :transform="'translate('+node.x+','+node.y+')'"
            @click="emit('select',node.device.id)"
            @keydown.enter.prevent="emit('select',node.device.id)"
            @keydown.space.prevent="emit('select',node.device.id)">
            <rect class="tg-scada-node-frame" x="0" y="0" width="204"
              height="96" rx="8" fill="#fff" stroke="#cbdde8"
              stroke-width="1.4"/>
            <rect x="8" y="10" width="55" height="56" rx="6"
              fill="#edf6fa" stroke="#d5e8f1"/>
            <image v-if="imageFor(node.device.id)"
              :href="imageFor(node.device.id)!" x="12" y="15" width="47"
              height="45" preserveAspectRatio="xMidYMid meet"/>
            <text v-else x="35" y="45" text-anchor="middle"
              class="tg-scada-fallback">设备</text>
            <text x="73" y="25" class="tg-scada-node-title">
              {{node.device.name.slice(0,11)}}
            </text>
            <text x="73" y="43" class="tg-scada-node-id">
              {{node.device.id.slice(0,22)}}
            </text>
            <circle cx="73" cy="58" r="3.5"
              :fill="stateFor(node.device.id)==='fault'?'#c97766':
                stateFor(node.device.id)==='attention'?'#d4a558':'#64a89d'"/>
            <text x="83" y="62" class="tg-scada-node-state">
              {{statusFor(node.device.id).slice(0,10)}} · MOCK
            </text>
            <line x1="9" y1="72" x2="195" y2="72"
              stroke="#e5eff4"/>
            <text x="12" y="87" class="tg-scada-node-reading">
              {{readingFor(node.device.id).slice(0,24)}}
            </text>
            <circle v-if="linkedFacilityIds.has(node.device.id)"
              cx="194" cy="9" r="5" fill="#5799ba" stroke="#fff" stroke-width="2"/>
            <path v-if="simRunning&&reviewedFacilityIds.has(node.device.id)"
              d="M 180 5 L 185 10 L 194 0" fill="none"
              stroke="#409ab7" stroke-width="2.5"/>
          </g>
        </g>
        <text x="25" :y="diagram.height-14" class="tg-scada-footer-note">
          按工程CAD区域组织 · 图元位置仅为界面排版 · 不代表真实管道或控制连接
        </text>
      </svg>
      <div v-if="!sections.length" class="tg-biz-empty">暂无可显示的设计设施</div>
    </div>
    <div class="tg-scada-board-foot">
      <span>点击图元后在右侧查看设备、Mock测点与人工核查；本图不推断水力连通。</span>
      <span v-if="sourceLayers.length">关联CAD图层：{{sourceLayers.join('、')}}</span>
    </div>
  </section>
</template>

<style scoped>
.tg-scada-board{padding:18px;min-width:0}
.tg-scada-board-count{font-size:12px;color:#849aa7}
.tg-scada-quickbar{display:flex;gap:6px 12px;align-items:center;flex-wrap:wrap;
  margin:-3px 0 12px;padding:0 1px 11px;border-bottom:1px solid #e4edf3}
.tg-scada-quickbar>span{font-size:11px;color:#8299a7;margin-right:auto}
.tg-scada-quickbar :deep(.el-button){font-size:11px;height:24px}
.tg-scada-viewport{min-width:0;overflow:auto;border:1px solid #dce7ee;
  border-radius:9px;background:#f5fafc;max-height:850px}
.tg-scada-graphic{display:block;min-width:760px;width:100%;height:auto}
.tg-scada-zone-code{font-size:12px;font-weight:700;letter-spacing:1.1px;fill:#78a4b9}
.tg-scada-zone-title{font-size:17px;font-weight:700;fill:#315c71}
.tg-scada-zone-sub{font-size:11px;fill:#829eaf}
.tg-scada-node{cursor:pointer;outline:none}
.tg-scada-node .tg-scada-node-frame{transition:fill .15s,stroke .15s}
.tg-scada-node:hover .tg-scada-node-frame,
.tg-scada-node:focus-visible .tg-scada-node-frame{
  fill:#eff8fc;stroke:#63a8c7;stroke-width:2.7}
.tg-scada-node.is-selected .tg-scada-node-frame{
  fill:#e6f4fa;stroke:#358db5;stroke-width:3}
.tg-scada-node.is-fault .tg-scada-node-frame{stroke:#df9e90}
.tg-scada-node.is-attention .tg-scada-node-frame{stroke:#dbc58e}
.tg-scada-node-title{font-size:13px;font-weight:700;fill:#365f73}
.tg-scada-node-id{font-size:10px;fill:#8b9fac}
.tg-scada-node-state{font-size:11px;fill:#62869a}
.tg-scada-node-reading{font-size:11px;font-weight:600;fill:#547a90}
.tg-scada-fallback{font-size:12px;fill:#7294aa}
.tg-scada-footer-note{font-size:11px;fill:#8aa0ad}
.tg-scada-board-foot{display:flex;justify-content:space-between;gap:8px 20px;
  flex-wrap:wrap;font-size:11px;color:#829aa9;padding:13px 2px 0;line-height:1.6}
@media(max-width:900px){.tg-scada-viewport{max-height:none}}
@media(prefers-reduced-motion:reduce){.tg-scada-node .tg-scada-node-frame{transition:none}}
</style>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { AssetStatus } from "../../demo/types";
import type { ProcessNode, ProcessConnection } from "../../demo/diagram";
import { SPRAY_EQUIPMENT, SYMBOLS } from "../../demo/diagram";
import { useDemoStore } from "../../demo/store";
import flowMeterUrl from "../../assets/process/spray/flow_meter.png";
import fogCannonUrl from "../../assets/process/spray/fog_cannon.png";
import pressureGaugeUrl from "../../assets/process/spray/pressure_gauge.png";
import sprayMistUrl from "../../assets/process/spray/spray_mist.png";
import waterTankUrl from "../../assets/process/spray/water_tank.png";
import pumpUrl from "../../assets/process/spray/centrifugal_pump.png";
import { spraySymbolImages } from "./spraySymbolImages";

/**
 * 射雾器除尘 SCADA 工艺组态图。
 * 管线/连接/流向由 SVG 绘制；蓄水池、泵、射雾器、压力表、流量计与喷雾使用独立透明 PNG；
 * 编号、状态、测点、液位与点击热区由业务数据驱动。
 * 泵组为工艺示意设备，水池与喷雾为演示表现，不代表现场资产或实际管线拓扑。
 */

export interface SprayUnitView {
  assetId: string;
  code: string;
  name: string;
  zone: "A" | "B";
  status: AssetStatus;
  pressureMpa: number | null;
  flowM3h: number | null;
}

const props = defineProps<{
  units: SprayUnitView[];
  zoneWorking: Record<"A" | "B", boolean>;
  mainPressureMpa: number | null;
  mainFlowM3h: number | null;
  tankLevelM: number;
  tankAvailableM3: number;
  highlightId?: string | null;
  nodes: ProcessNode[];
  connections: ProcessConnection[];
  viewWidth?: number;
  editable?: boolean;
  selectedNodeId?: string;
}>();
const store = useDemoStore();
function pointText(pointId: string): string {
  const point = store.points.find(item => item.id === pointId);
  if (!point) return '无效测点';
  const sample = store.latest(pointId);
  const value = sample?.value;
  return `${point.label} ${value === null || value === undefined ? '待接入' : String(value) + (point.unit ?? '')}`;
}

const emit = defineEmits<{ (event: "select", assetId: string): void; (event: "selectNode", nodeId: string): void; (event: "moveNode", payload: { id: string; x: number; y: number }): void }>();
const svgRef = ref<SVGSVGElement | null>(null);
const dragging = ref<{ id: string; dx: number; dy: number } | null>(null);

/** 统一坐标体系：所有设备、管线、文字与热区都由这里派生。 */
const LAYOUT = {
  tank: { x: 36, y: 128, w: 160, h: 162 },
  pumpBox: { x: 262, y: 134, w: 220, h: 198 },
  pump: { x: 278, w: 90, h: 89, ys: [148, 240] },
  mainY: 240,
  gauge: { x: 560, y: 158, w: 52, h: 84 },
  flow: { x: 648, y: 212, w: 56, h: 56 },
  splitX: 740,
  branchY: { A: 88, B: 258 },
  pill: { x: 756, w: 160, h: 24, y: { A: 56, B: 226 } },
  unit: { w: 91, h: 98, xs: [910, 1018], top: { A: 92, B: 262 } },
  mist: { w: 86, h: 54 },
} as const;

const statusText: Record<AssetStatus, string> = {
  running: "运行",
  stopped: "停机",
  fault: "异常",
  unknown: "未知",
};
const otherNodes = computed(() => props.nodes.filter(node => node.visible && node.symbolId !== 'fog_cannon' && !equipmentIds.has(node.id)));
function connectionPath(line: ProcessConnection): string {
  const source = props.nodes.find(node => node.id === line.sourceNodeId);
  const target = props.nodes.find(node => node.id === line.targetNodeId);
  if (!source || !target) return '';
  const x1 = source.position.x + source.size.width;
  const y1 = source.position.y + source.size.height / 2;
  const x2 = target.position.x;
  const y2 = target.position.y + target.size.height / 2;
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1} H${mid} V${y2} H${x2}`;
}

const rows = computed(() => props.nodes.filter(node => node.visible && node.symbolId === 'fog_cannon').map(node => {
  const unit = props.units.find(item => item.assetId === node.assetId);
  const zone = node.position.y < 200 ? 'A' : 'B';
  return { key: node.id, node, zone, x: node.position.x, top: node.position.y, width: node.size.width, height: node.size.height, unit,
    code: node.label || unit?.code || '未绑定', pipeY: LAYOUT.branchY[zone],
    labelY: node.position.y + node.size.height + 26, dotY: node.position.y + node.size.height + 40 };
}));
const originalNodeIds = new Set(['node-asset-sp001', 'node-asset-sp002', 'node-asset-sp003', 'node-asset-sp004']);
const branchEndX = LAYOUT.unit.xs[1] + LAYOUT.unit.w / 2;
const suggestedRows = computed(() => rows.value.filter(row =>
  row.node.assetId && !originalNodeIds.has(row.key) &&
  !props.connections.some(line => line.targetNodeId === row.key),
));
function suggestedBranchPath(row: (typeof rows.value)[number]): string {
  const inletX = row.x + row.width / 2;
  const tapX = Math.max(LAYOUT.splitX, Math.min(inletX, branchEndX));
  return `M${tapX} ${row.pipeY} H${inletX} V${row.top + 10}`;
}

const equipmentIds = new Set<string>(SPRAY_EQUIPMENT.map(item => item.id));
const equipmentNodes = computed(() => Object.fromEntries(props.nodes
  .filter(node => equipmentIds.has(node.id) && node.visible)
  .map(node => [node.id, node])));
const draggedNode = computed(() => props.nodes.find(node => node.id === dragging.value?.id));
function equipmentTransform(node: ProcessNode): string {
  const base = SPRAY_EQUIPMENT.find(item => item.id === node.id)!;
  const spec = SYMBOLS[base.symbolId];
  return `translate(${node.position.x} ${node.position.y}) scale(${node.size.width / spec.width} ${node.size.height / spec.height}) translate(${-base.x} ${-base.y})`;
}
function equipmentAnchor(id: string, x: number, y: number) {
  const node = equipmentNodes.value[id];
  const base = SPRAY_EQUIPMENT.find(item => item.id === id);
  if (!node || !base) return undefined;
  const spec = SYMBOLS[base.symbolId];
  return {
    x: node.position.x + (x - base.x) * node.size.width / spec.width,
    y: node.position.y + (y - base.y) * node.size.height / spec.height,
  };
}
const tankSupplyPath = computed(() => {
  const tank = equipmentAnchor('spray-tank', 198, LAYOUT.mainY);
  const pump = equipmentAnchor('spray-pump-2', 290, LAYOUT.mainY);
  if (!tank || !pump) return '';
  const middle = (tank.x + pump.x) / 2;
  return `M${tank.x} ${tank.y} H${middle} V${pump.y} H${pump.x}`;
});
const mainSupplyPath = computed(() => {
  const flow = equipmentAnchor('spray-flow', 676, LAYOUT.mainY);
  const route = flow ? `H${flow.x - 28} V${flow.y} H${flow.x + 28} V${LAYOUT.mainY}` : '';
  return `M470 ${LAYOUT.mainY} ${route} H${LAYOUT.splitX}`;
});
const pressurePath = computed(() => {
  const gauge = equipmentAnchor('spray-pressure', 586, 242);
  return gauge ? `M586 ${LAYOUT.mainY} H${gauge.x} V${gauge.y}` : '';
});
function fmt(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "缺数" : value.toFixed(digits);
}

function flowText(): string {
  return props.mainFlowM3h === null ? "缺数" : `${props.mainFlowM3h.toFixed(1)} m³/h`;
}

function select(unit: SprayUnitView | undefined): void {
  if (unit) emit("select", unit.assetId);
}

function mistTransform(row: { x: number; top: number }): string {
  const mx = row.x + LAYOUT.unit.w - 14;
  const my = row.top + 16 - LAYOUT.mist.h / 2;
  return `translate(${mx} ${my}) rotate(-14)`;
}
function svgPoint(event: PointerEvent): { x: number; y: number } {
  const matrix = svgRef.value?.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
}
function startDrag(event: PointerEvent, node: ProcessNode): void {
  if (!props.editable) return;
  event.preventDefault();
  emit('selectNode', node.id);
  const point = svgPoint(event);
  dragging.value = { id: node.id, dx: point.x - node.position.x, dy: point.y - node.position.y };
  svgRef.value?.setPointerCapture(event.pointerId);
}
function onDrag(event: PointerEvent): void {
  if (!dragging.value) return;
  const point = svgPoint(event);
  const node = props.nodes.find(item => item.id === dragging.value?.id);
  if (!node) return;
  emit('moveNode', { id: node.id, x: Math.max(0, Math.min((props.viewWidth ?? 1200) - node.size.width, Math.round((point.x - dragging.value.dx) / 10) * 10)), y: Math.max(0, Math.min(400 - node.size.height - 42, Math.round((point.y - dragging.value.dy) / 10) * 10)) });
}
function stopDrag(): void { dragging.value = null; }
</script>

<template>
  <div class="spray-canvas">
    <svg ref="svgRef" :viewBox="`0 0 ${viewWidth ?? 1200} 400`" role="img" aria-label="射雾器除尘工艺示意图" @pointermove="onDrag" @pointerup="stopDrag" @pointercancel="stopDrag">
      <defs>
        <pattern id="spray-edit-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 H 0 V 10" fill="none" stroke="#cadfed" stroke-width=".65" />
        </pattern>
        <linearGradient id="scada-pipe" gradientUnits="userSpaceOnUse" x1="198" y1="0" x2="1120" y2="0">
          <stop stop-color="#59B7E8" />
          <stop offset="0.45" stop-color="#2E8FD4" />
          <stop offset="1" stop-color="#1E7DE8" />
        </linearGradient>
        <marker id="scada-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#3E9AD8" />
        </marker>
      </defs>

      <rect v-if="editable" width="100%" height="100%" fill="url(#spray-edit-grid)" pointer-events="none" />
      <!-- 蓄水池 -->
      <g v-if="equipmentNodes['spray-tank']" class="node tank" data-node-id="spray-tank" :class="{ movable: editable }"
        :transform="equipmentTransform(equipmentNodes['spray-tank'])"
        @pointerdown="startDrag($event, equipmentNodes['spray-tank'])">
        <text x="106" y="106" class="node-title">{{ equipmentNodes['spray-tank'].label }}</text>
        <rect x="172" y="92" width="46" height="16" rx="8" class="mock-chip" />
        <text x="195" y="103" class="mock-text">MOCK</text>
        <image
          :href="waterTankUrl"
          :x="LAYOUT.tank.x"
          :y="LAYOUT.tank.y"
          :width="LAYOUT.tank.w"
          :height="LAYOUT.tank.h"
          preserveAspectRatio="xMidYMax meet"
        />
        <text x="46" y="320" class="io-label">液位</text>
        <text x="80" y="320" class="io-value">{{ fmt(tankLevelM) }} m</text>
        <text x="46" y="344" class="io-label">可用水量</text>
        <text x="106" y="344" class="io-value">{{ tankAvailableM3.toLocaleString("zh-CN") }} m³</text>
      </g>

      <!-- 加压泵组（工艺示意） -->
      <g class="node pump-group">
        <rect :x="LAYOUT.pumpBox.x" :y="LAYOUT.pumpBox.y" :width="LAYOUT.pumpBox.w" :height="LAYOUT.pumpBox.h" rx="14" class="pump-box" />
        <text x="372" y="112" class="node-title">加压泵组（定频）</text>
        <text x="372" y="126" class="node-sub">工艺示意 · 非现场资产</text>
        <template v-for="(id, index) in ['spray-pump-1', 'spray-pump-2']" :key="id">
        <g v-if="equipmentNodes[id]" :data-node-id="id" :class="{ movable: editable }" :transform="equipmentTransform(equipmentNodes[id])"
          @pointerdown="startDrag($event, equipmentNodes[id])">
          <image
            :href="pumpUrl"
            :x="LAYOUT.pump.x"
            :y="LAYOUT.pump.ys[index]"
            :width="LAYOUT.pump.w"
            :height="LAYOUT.pump.h"
            preserveAspectRatio="xMidYMid meet"
          />
          <text x="380" :y="LAYOUT.pump.ys[index] + 44" class="pump-name">{{ equipmentNodes[id].label }}</text>
          <circle cx="380" :cy="LAYOUT.pump.ys[index] + 62" r="3.6" class="status-dot ok" />
          <text x="390" :y="LAYOUT.pump.ys[index] + 66" class="pump-status">运行</text>
        </g>
        </template>
      </g>

      <!-- 供水主管 -->
      <path class="pipe-halo" :d="tankSupplyPath" />
      <path class="pipe" :d="tankSupplyPath" />
      <path class="pipe-halo" :d="mainSupplyPath" />
      <path class="pipe" :d="mainSupplyPath" marker-end="url(#scada-arrow)" />
      <circle :cx="LAYOUT.splitX" :cy="LAYOUT.mainY" r="6" class="junction" />

      <!-- 末端压力均值（测点口径，非主管实测） -->
      <path class="pipe" :d="pressurePath" />
      <g v-if="equipmentNodes['spray-pressure']" data-node-id="spray-pressure" :class="{ movable: editable }"
        :transform="equipmentTransform(equipmentNodes['spray-pressure'])"
        @pointerdown="startDrag($event, equipmentNodes['spray-pressure'])">
      <image
        :href="pressureGaugeUrl"
        :x="LAYOUT.gauge.x"
        :y="LAYOUT.gauge.y"
        :width="LAYOUT.gauge.w"
        :height="LAYOUT.gauge.h"
        preserveAspectRatio="xMidYMid meet"
      />
      <text x="586" y="124" class="metric-label">{{ equipmentNodes['spray-pressure'].label }}</text>
      <text x="586" y="144" class="metric-value">
        {{ mainPressureMpa === null ? "缺数" : `${fmt(mainPressureMpa)} MPa` }}
      </text>

      </g>
      <!-- 喷射流量合计 -->
      <g v-if="equipmentNodes['spray-flow']" data-node-id="spray-flow" :class="{ movable: editable }"
        :transform="equipmentTransform(equipmentNodes['spray-flow'])"
        @pointerdown="startDrag($event, equipmentNodes['spray-flow'])">
      <image
        :href="flowMeterUrl"
        :x="LAYOUT.flow.x"
        :y="LAYOUT.flow.y"
        :width="LAYOUT.flow.w"
        :height="LAYOUT.flow.h"
        preserveAspectRatio="xMidYMid meet"
      />
      <text x="676" y="296" class="metric-label">{{ equipmentNodes['spray-flow'].label }}</text>
      <text x="676" y="314" class="metric-value">{{ flowText() }}</text>

      </g>
      <!-- 区域支管 -->
      <path class="pipe-halo" :d="`M${LAYOUT.splitX} ${LAYOUT.mainY} V${LAYOUT.branchY.A}`" />
      <path class="pipe-halo" :d="`M${LAYOUT.splitX} ${LAYOUT.mainY} V${LAYOUT.branchY.B}`" />
      <path class="pipe" :d="`M${LAYOUT.splitX} ${LAYOUT.mainY} V${LAYOUT.branchY.A} H${LAYOUT.unit.xs[1] + LAYOUT.unit.w / 2}`" />
      <path class="pipe" :d="`M${LAYOUT.splitX} ${LAYOUT.mainY} V${LAYOUT.branchY.B} H${LAYOUT.unit.xs[1] + LAYOUT.unit.w / 2}`" />
      <g class="zone-label" :class="zoneWorking.A ? 'working' : 'idle'">
        <rect :x="LAYOUT.pill.x" :y="LAYOUT.pill.y.A" :width="LAYOUT.pill.w" :height="LAYOUT.pill.h" rx="12" />
        <text :x="LAYOUT.pill.x + LAYOUT.pill.w / 2" :y="LAYOUT.pill.y.A + 16">
          堆场 A 区（{{ zoneWorking.A ? "作业中" : "已结束" }}）
        </text>
      </g>
      <g class="zone-label" :class="zoneWorking.B ? 'working' : 'idle'">
        <rect :x="LAYOUT.pill.x" :y="LAYOUT.pill.y.B" :width="LAYOUT.pill.w" :height="LAYOUT.pill.h" rx="12" />
        <text :x="LAYOUT.pill.x + LAYOUT.pill.w / 2" :y="LAYOUT.pill.y.B + 16">
          堆场 B 区（{{ zoneWorking.B ? "作业中" : "已结束" }}）
        </text>
      </g>

      <g v-if="suggestedRows.length">
        <path v-for="row in suggestedRows" :key="row.key" :d="suggestedBranchPath(row)" class="suggested-branch">
          <title>{{ row.code }} · {{ row.zone }} 区支管示意 · 待现场确认</title>
        </path>
        <text x="24" y="386" class="node-sub" style="text-anchor:start">自动匹配的区域支管为示意，待现场确认</text>
      </g>

      <!-- 喷雾层（在设备图片之下，运行才渲染） -->
      <g class="mist-layer">
        <g
          v-for="row in rows"
          :key="`mist-${row.key}`"
          v-show="row.unit?.status === 'running'"
          class="mist"
          :transform="mistTransform(row)"
        >
          <image :href="sprayMistUrl" :width="LAYOUT.mist.w" :height="LAYOUT.mist.h" preserveAspectRatio="xMinYMid meet" />
        </g>
      </g>

      <!-- 射雾器 -->
      <path v-for="line in connections" :key="line.id" :d="connectionPath(line)" class="unit-stub" fill="none" stroke="#2e8fd4" stroke-width="3" />
      <g
        v-for="row in rows"
        :key="row.key"
        class="unit"
        :class="[`is-${row.unit?.status ?? 'unknown'}`, { highlight: props.highlightId === row.unit?.assetId }]"
        :data-node-id="row.node.id"
        role="button"
        tabindex="0"
        :aria-label="`${row.code} ${statusText[row.unit?.status ?? 'unknown']}`"
        @pointerdown="startDrag($event, row.node)"
        @click="editable ? emit('selectNode', row.node.id) : select(row.unit)"
        @keydown.enter="select(row.unit)"
      >
        <image
          :href="fogCannonUrl"
          :x="row.x"
          :y="row.top"
          :width="row.width"
          :height="row.height"
          preserveAspectRatio="xMidYMid meet"
        />
        <rect
          :x="row.x - 4"
          :y="row.top - 4"
          :width="row.width + 8"
          :height="row.height + 8"
          rx="10"
          class="unit-hit"
        />
        <path v-if="originalNodeIds.has(row.key)" :d="suggestedBranchPath(row)" class="unit-stub" />
        <text :x="row.x + LAYOUT.unit.w / 2" :y="row.labelY" class="unit-code">{{ row.code }}</text>
        <circle :cx="row.x + 25" :cy="row.dotY - 4" r="3.5" :class="['unit-dot', row.unit?.status ?? 'unknown']" />
        <text :x="row.x + 34" :y="row.dotY" class="unit-status">
          {{ statusText[row.unit?.status ?? "unknown"] }}
        </text>
        <text v-for="(binding, index) in row.node.pointBindings.filter(item => item.displayRole === 'label')" :key="binding.pointId" :x="row.x + row.width / 2" :y="row.dotY + 15 + index * 13" class="unit-status" text-anchor="middle">{{ pointText(binding.pointId) }}</text>
      </g>
      <g v-for="node in otherNodes" :key="node.id" class="unit" role="button" tabindex="0" @pointerdown="startDrag($event, node)" @click="editable ? emit('selectNode', node.id) : node.assetId && emit('select', node.assetId)">
        <image v-if="spraySymbolImages[node.symbolId]" :href="spraySymbolImages[node.symbolId]" :x="node.position.x" :y="node.position.y" :width="node.size.width" :height="node.size.height" preserveAspectRatio="xMidYMid meet" />
        <rect v-else :x="node.position.x" :y="node.position.y" :width="node.size.width" :height="node.size.height" rx="6" fill="#eff8ff" stroke="#9cc7e8" />
        <text :x="node.position.x + node.size.width / 2" :y="node.position.y + node.size.height + 15" class="unit-code">{{ node.label }}</text>
      </g>
      <g v-if="editable && draggedNode" class="alignment-guides" pointer-events="none">
        <path :d="`M${draggedNode.position.x} 0 V400 M0 ${draggedNode.position.y} H${viewWidth ?? 1200}`" />
        <text :x="draggedNode.position.x + 5" :y="Math.max(14, draggedNode.position.y - 5)">X {{ draggedNode.position.x }} · Y {{ draggedNode.position.y }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.movable { cursor: grab; touch-action: none; }
.alignment-guides path { fill: none; stroke: #1677c8; stroke-width: 1; }
.alignment-guides text { fill: #14598d; font-size: 11px; }

.spray-canvas {
  width: 100%;
  height: 100%;
  min-width: 0;
}
svg {
  display: block;
  width: 100%;
  height: 100%;
}
.node-title {
  font-size: 13.5px;
  font-weight: 700;
  fill: #173553;
  text-anchor: middle;
}
.node-sub {
  font-size: 9.5px;
  fill: #9bafbf;
  text-anchor: middle;
}
.mock-chip {
  fill: #fdf3e2;
  stroke: #f0d6a4;
  stroke-width: 1;
}
.mock-text {
  font-size: 8.5px;
  fill: #a06a1f;
  text-anchor: middle;
}
.io-label {
  font-size: 11px;
  fill: #6b8199;
}
.io-value {
  font-size: 12.5px;
  font-weight: 700;
  fill: #173553;
}
.pump-box {
  fill: #f7fbff;
  stroke: #d3e6f6;
  stroke-width: 1.6;
  stroke-dasharray: 6 5;
}
.pump-name {
  font-size: 11.5px;
  font-weight: 700;
  fill: #173553;
}
.pump-status {
  font-size: 10.5px;
  fill: #25aa64;
}
.status-dot.ok {
  fill: #25aa64;
}
.pipe-halo {
  fill: none;
  stroke: #d9eefb;
  stroke-width: 11;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pipe {
  fill: none;
  stroke: url(#scada-pipe);
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 2px 3px rgba(37, 134, 244, 0.18));
}
.junction {
  fill: #3e9ad8;
  stroke: #ffffff;
  stroke-width: 2;
}
.metric-label {
  font-size: 10.5px;
  fill: #6b8199;
  text-anchor: middle;
}
.metric-value {
  font-size: 13px;
  font-weight: 700;
  fill: #173553;
  text-anchor: middle;
}
.zone-label rect {
  fill: rgba(255, 255, 255, 0.94);
  stroke: #bcd9ee;
  stroke-width: 1.2;
}
.zone-label text {
  font-size: 11px;
  fill: #6b8199;
  text-anchor: middle;
}
.zone-label.working rect {
  fill: #2586f4;
  stroke: #2586f4;
}
.zone-label.working text {
  fill: #ffffff;
}
.mist image {
  opacity: 0.62;
  animation: mist-drift 4.8s ease-in-out infinite;
}
@keyframes mist-drift {
  0%,
  100% {
    opacity: 0.52;
    transform: translateX(0) scale(0.98);
  }
  50% {
    opacity: 0.74;
    transform: translateX(6px) scale(1.03);
  }
}
.unit {
  cursor: pointer;
  outline: none;
}
.unit-hit {
  fill: transparent;
  pointer-events: all;
}
.unit:hover .unit-hit,
.unit:focus-visible .unit-hit {
  fill: rgba(37, 134, 244, 0.06);
  stroke: #8ec6f2;
  stroke-width: 1.4;
}
.unit.highlight .unit-hit {
  fill: rgba(232, 163, 62, 0.1);
  stroke: #e8a33e;
  stroke-width: 1.6;
}
.unit-stub {
  fill: none;
  stroke: #8fd4f5;
  stroke-width: 3;
}
.suggested-branch {
  fill: none;
  stroke: #2e8fd4;
  stroke-width: 3;
}
.unit-code {
  font-size: 12px;
  font-weight: 700;
  fill: #173553;
  text-anchor: middle;
}
.unit-status {
  font-size: 10.5px;
  fill: #25aa64;
}
.unit-dot.running {
  fill: #25aa64;
}
.unit-dot.stopped {
  fill: #9aa9b5;
}
.unit-dot.fault {
  fill: #e45252;
}
.unit-dot.unknown {
  fill: #c7d3de;
}
.unit.is-stopped .unit-status,
.unit.is-unknown .unit-status {
  fill: #8ba0b2;
}
.unit.is-stopped image,
.unit.is-unknown image {
  filter: grayscale(0.75) opacity(0.82);
}
.unit.is-fault .unit-status {
  fill: #e45252;
}
.unit.is-fault image {
  filter: drop-shadow(0 0 6px rgba(228, 82, 82, 0.55)) saturate(1.05);
}
@media (max-width: 760px) {
  .spray-canvas {
    overflow-x: auto;
  }

}
</style>

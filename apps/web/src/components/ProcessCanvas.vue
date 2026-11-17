<script setup lang="ts">
import { computed, ref } from "vue";
import { getProcessLayout } from "../demo/processLayouts";
import { useDemoStore } from "../demo/store";
import type { AssetStatus } from "../demo/types";

const props = withDefaults(
  defineProps<{
    subsystemId: string;
    interactive?: boolean;
    selected?: { xPct: number; yPct: number } | null;
    height?: number;
  }>(),
  { interactive: false, selected: null, height: 400 },
);

const emit = defineEmits<{
  select: [assetId: string];
  pick: [point: { xPct: number; yPct: number }];
}>();

const store = useDemoStore();

const canvasRef = ref<HTMLElement | null>(null);
const hoveredId = ref<string | null>(null);
const cursor = ref<{ xPct: number; yPct: number } | null>(null);

const layout = computed(() => getProcessLayout(props.subsystemId));
const gradientId = computed(() => `process-pipe-${props.subsystemId}`);

const STATUS_LABELS: Record<AssetStatus, string> = {
  running: "运行",
  stopped: "停机",
  fault: "故障",
  unknown: "未知",
};

interface Hotspot {
  id: string;
  assetId: string;
  code: string;
  name: string;
  status: AssetStatus;
  x: number;
  y: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

const hotspots = computed<Hotspot[]>(() => {
  const list: Hotspot[] = [];
  for (const binding of store.bindings) {
    if (binding.subsystemId !== props.subsystemId) continue;
    const asset = store.getAsset(binding.assetId);
    if (!asset) continue;
    list.push({
      id: binding.id,
      assetId: asset.id,
      code: asset.code,
      name: asset.name,
      status: asset.status,
      x: clamp01(binding.xPct),
      y: clamp01(binding.yPct),
    });
  }
  return list.sort((a, b) => a.x - b.x);
});

const hovered = computed(
  () => hotspots.value.find((item) => item.id === hoveredId.value) ?? null,
);

interface PointPreview {
  id: string;
  label: string;
  unit: string;
  value: string | null;
}

function formatValue(value: number, unit: string | undefined): string {
  const digits = unit === "MPa" ? 2 : unit === "%" ? 1 : Math.abs(value) >= 100 ? 1 : 2;
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const hoveredPoints = computed<PointPreview[]>(() => {
  if (!hovered.value) return [];
  return store
    .getPoints(hovered.value.assetId)
    .filter((point) => point.kind === "number")
    .slice(0, 4)
    .map((point) => {
      const sample = store.latest(point.id);
      return {
        id: point.id,
        label: point.label,
        unit: point.unit ?? "",
        value:
          sample && typeof sample.value === "number"
            ? formatValue(sample.value, point.unit)
            : null,
      };
    });
});

function tipStyle(hotspot: Hotspot): Record<string, string> {
  const style: Record<string, string> = {};
  const horizontal = `${hotspot.x * 100}%`;
  if (hotspot.x > 0.55) style.right = `calc(${(1 - hotspot.x) * 100}% + 12px)`;
  else style.left = `calc(${horizontal} + 12px)`;
  if (hotspot.y > 0.62) style.bottom = `calc(${(1 - hotspot.y) * 100}% + 10px)`;
  else style.top = `calc(${hotspot.y * 100}% + 10px)`;
  return style;
}

function pointFromEvent(event: MouseEvent): { xPct: number; yPct: number } | null {
  const element = canvasRef.value;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    xPct: clamp01((event.clientX - rect.left) / rect.width),
    yPct: clamp01((event.clientY - rect.top) / rect.height),
  };
}

function onCanvasClick(event: MouseEvent): void {
  if (!props.interactive) return;
  const point = pointFromEvent(event);
  if (point) emit("pick", point);
}

function onPointerMove(event: MouseEvent): void {
  if (!props.interactive) return;
  cursor.value = pointFromEvent(event);
}

function onHotspotActivate(hotspot: Hotspot): void {
  if (props.interactive) {
    emit("pick", { xPct: hotspot.x, yPct: hotspot.y });
    return;
  }
  emit("select", hotspot.assetId);
}
</script>

<template>
  <div class="process-canvas">
    <div
      ref="canvasRef"
      class="canvas"
      :class="{ interactive }"
      :style="{ height: `${height}px` }"
      @click="onCanvasClick"
      @mousemove="onPointerMove"
      @mouseleave="cursor = null"
    >
      <div class="canvas-bg" aria-hidden="true"></div>

      <svg
        class="base-pipes"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            :id="gradientId"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="100"
            y2="0"
          >
            <stop
              offset="0%"
              :stop-color="layout?.accent ?? '#247ba8'"
              stop-opacity="0.5"
            />
            <stop
              offset="100%"
              :stop-color="layout?.accent ?? '#247ba8'"
              stop-opacity="0.95"
            />
          </linearGradient>
        </defs>
        <path
          v-for="(pipe, index) in layout?.pipes ?? []"
          :key="`pipe-${index}`"
          :d="pipe.d"
          class="pipe"
          :class="{ dashed: pipe.dashed }"
          :stroke="`url(#${gradientId})`"
        />
      </svg>

      <span
        v-for="block in layout?.blocks ?? []"
        :key="block.id"
        class="block"
        :class="block.kind"
        :style="{
          left: `${block.x * 100}%`,
          top: `${block.y * 100}%`,
          width: `${block.w * 100}%`,
          height: `${block.h * 100}%`,
        }"
      >
        {{ block.label }}
      </span>

      <button
        v-for="hotspot in hotspots"
        :key="hotspot.id"
        type="button"
        class="hotspot"
        :class="`status-${hotspot.status}`"
        :style="{ left: `${hotspot.x * 100}%`, top: `${hotspot.y * 100}%` }"
        :title="`模拟数据 · ${hotspot.name}（${hotspot.code}）· ${
          STATUS_LABELS[hotspot.status]
        }`"
        @click.stop="onHotspotActivate(hotspot)"
        @mouseenter="hoveredId = hotspot.id"
        @mouseleave="hoveredId = null"
        @focus="hoveredId = hotspot.id"
        @blur="hoveredId = null"
      >
        <span class="hotspot-dot"></span>
        <span class="hotspot-badge">{{ hotspot.code }}</span>
        <span class="mock-flag">模拟</span>
      </button>

      <div v-if="hovered" class="hotspot-tip" :style="tipStyle(hovered)">
        <div class="tip-head">
          <strong>{{ hovered.name }}</strong>
          <span>{{ hovered.code }}</span>
        </div>
        <ul v-if="hoveredPoints.length" class="tip-points">
          <li v-for="point in hoveredPoints" :key="point.id">
            <span>{{ point.label }}</span>
            <strong>{{ point.value ?? "缺数" }}</strong>
            <em>{{ point.unit }}</em>
          </li>
        </ul>
        <p v-else class="tip-empty">暂无监测</p>
        <small>
          模拟数据 · {{ STATUS_LABELS[hovered.status] }} · 点击打开设备抽屉
        </small>
      </div>

      <template v-if="interactive">
        <span
          v-if="cursor"
          class="crosshair vertical"
          :style="{ left: `${cursor.xPct * 100}%` }"
          aria-hidden="true"
        ></span>
        <span
          v-if="cursor"
          class="crosshair horizontal"
          :style="{ top: `${cursor.yPct * 100}%` }"
          aria-hidden="true"
        ></span>
        <div
          v-if="selected"
          class="pick-marker"
          :style="{
            left: `${selected.xPct * 100}%`,
            top: `${selected.yPct * 100}%`,
          }"
        >
          <span class="pick-ring"></span>
          <span class="pick-label">
            x {{ (selected.xPct * 100).toFixed(0) }}% · y
            {{ (selected.yPct * 100).toFixed(0) }}%
          </span>
        </div>
      </template>

      <p v-if="!hotspots.length" class="canvas-empty">暂无已布置设备</p>
    </div>

    <div class="canvas-footer">
      <div class="legend">
        <span class="legend-item running"><i></i>运行</span>
        <span class="legend-item stopped"><i></i>停机</span>
        <span class="legend-item fault"><i></i>故障</span>
        <span class="legend-item unknown"><i></i>未知</span>
        <span class="legend-text">热点坐标 0~1 归一化 · 数据标签 MOCK</span>
      </div>
      <p class="canvas-note">
        示意底图仅表达工艺单元与管线走向；点位选择仅用于可视化绑定，不代表真实管网连接。
      </p>
    </div>
  </div>
</template>

<style scoped>
.process-canvas {
  min-width: 0;
}
.canvas {
  position: relative;
  width: 100%;
  min-width: 0;
  border-radius: 10px;
  border: 1px solid #d3e4ef;
  overflow: hidden;
  background: linear-gradient(165deg, #f7fbfe 0%, #eef7fb 52%, #eaf3f7 100%);
  cursor: default;
}
.canvas.interactive {
  cursor: crosshair;
  border-color: #8fbdd4;
  box-shadow: inset 0 0 0 1px rgba(36, 123, 168, 0.12);
}
.canvas-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(128, 166, 190, 0.12) 1px, transparent 1px),
    linear-gradient(90deg, rgba(128, 166, 190, 0.12) 1px, transparent 1px);
  background-size: 6.25% 10%;
  pointer-events: none;
}
.base-pipes {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}
.pipe {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pipe.dashed {
  stroke-dasharray: 5 5;
  opacity: 0.65;
}
.block {
  position: absolute;
  display: flex;
  align-items: flex-start;
  padding: 5px 7px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.3;
  color: #5c7b8f;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}
.block.tank {
  border: 1px solid rgba(74, 155, 181, 0.5);
  background: linear-gradient(180deg, rgba(207, 234, 245, 0.72), rgba(187, 222, 237, 0.5));
  color: #34687f;
}
.block.building {
  border: 1px solid rgba(120, 152, 176, 0.45);
  background: rgba(228, 238, 245, 0.7);
}
.block.unit {
  border: 1px dashed rgba(120, 152, 176, 0.55);
  background: rgba(255, 255, 255, 0.5);
}
.block.yard {
  border: 1px dashed rgba(84, 168, 146, 0.45);
  background: rgba(214, 240, 232, 0.42);
  color: #42796c;
}
.block.outfall {
  border: 1px solid rgba(62, 143, 160, 0.5);
  background: rgba(212, 238, 242, 0.6);
}
.hotspot {
  position: absolute;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transform: translate(-50%, -50%);
  padding: 2px 7px 2px 3px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 4px 12px rgba(28, 62, 87, 0.16);
  cursor: pointer;
  font-size: 11px;
  color: #2a4660;
  transition: transform 0.15s, box-shadow 0.15s;
}
.hotspot:hover,
.hotspot:focus-visible {
  transform: translate(-50%, -50%) scale(1.06);
  box-shadow: 0 8px 18px rgba(28, 62, 87, 0.24);
  outline: none;
}
.hotspot-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.8);
}
.hotspot.status-running .hotspot-dot {
  background: #3f9d7c;
}
.hotspot.status-stopped .hotspot-dot {
  background: #9aa8b4;
}
.hotspot.status-fault .hotspot-dot {
  background: #d0574f;
}
.hotspot.status-unknown .hotspot-dot {
  background: #e1a249;
}
.hotspot-badge {
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.mock-flag {
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 14px;
  color: #a06a1f;
  background: #fdf1da;
  border: 1px solid #f0d6a4;
}
.hotspot-tip {
  position: absolute;
  z-index: 5;
  width: 208px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid #d5e6f0;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 16px 32px rgba(28, 62, 87, 0.18);
  pointer-events: none;
}
.tip-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #1c3e57;
}
.tip-head span {
  font-size: 10px;
  color: #8ba0b2;
  white-space: nowrap;
}
.tip-points {
  margin: 8px 0 6px;
  padding: 0;
  list-style: none;
  border-top: 1px dashed #e0ecf4;
}
.tip-points li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 5px;
  align-items: baseline;
  padding: 4px 0;
  font-size: 11px;
  color: #5d7387;
}
.tip-points li + li {
  border-top: 1px solid #f0f6fa;
}
.tip-points strong {
  color: #204058;
  font-weight: 600;
}
.tip-points em {
  font-style: normal;
  color: #93a7b7;
  font-size: 10px;
}
.tip-empty {
  margin: 8px 0 6px;
  font-size: 11px;
  color: #93a7b7;
}
.hotspot-tip small {
  font-size: 10px;
  color: #93a7b7;
}
.crosshair {
  position: absolute;
  z-index: 2;
  background: rgba(36, 123, 168, 0.45);
  pointer-events: none;
}
.crosshair.vertical {
  top: 0;
  bottom: 0;
  width: 1px;
}
.crosshair.horizontal {
  left: 0;
  right: 0;
  height: 1px;
}
.pick-marker {
  position: absolute;
  z-index: 4;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.pick-ring {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #247ba8;
  background: rgba(36, 123, 168, 0.16);
  margin: 0 auto;
}
.pick-label {
  position: absolute;
  left: 20px;
  top: -6px;
  padding: 2px 6px;
  border-radius: 5px;
  background: #1c3e57;
  color: #fff;
  font-size: 10px;
  white-space: nowrap;
}
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 12px;
  color: #8296a8;
}
.canvas-footer {
  padding: 8px 2px 0;
}
.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  color: #6c8296;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.legend-item i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9aa8b4;
}
.legend-item.running i {
  background: #3f9d7c;
}
.legend-item.stopped i {
  background: #9aa8b4;
}
.legend-item.fault i {
  background: #d0574f;
}
.legend-item.unknown i {
  background: #e1a249;
}
.legend-text {
  color: #93a7b7;
}
.canvas-note {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #93a7b7;
}
</style>

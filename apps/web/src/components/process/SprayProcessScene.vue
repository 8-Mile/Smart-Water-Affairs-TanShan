<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NModal } from "naive-ui";
import { useDemoStore } from "../../demo/store";
import sceneUrl from "../../assets/process/spray/bg.png";
import { spraySymbolImages } from "./spraySymbolImages";
import type { ProcessNode } from "../../demo/diagram";
import type { SprayUnitView } from "./SprayProcessCanvas.vue";

const props = defineProps<{
  nodes: ProcessNode[];
  units: SprayUnitView[];
  statusLabels: Record<SprayUnitView["status"], string>;
}>();
const emit = defineEmits<{ select: [assetId: string] }>();
const store = useDemoStore();
const selectedId = ref<string | null>(null);

// Normalized anchors for the four machines drawn in bg.png.
const anchors: Record<string, [number, number]> = {
  "asset-sp001": [41, 41],
  "asset-sp002": [65, 32],
  "asset-sp003": [47, 79],
  "asset-sp004": [81, 65],
};

const devices = computed(() => {
  const units = new Map(props.units.map(unit => [unit.assetId, unit]));
  return props.nodes.flatMap(node => {
    const asset = node.visible && node.assetId ? store.getAsset(node.assetId) : undefined;
    if (!asset || asset.archived) return [];
    const unit = units.get(asset.id);
    const zone = node.position.y < 200 ? "A" : "B";
    const anchor = anchors[asset.id];
    return [{
      assetId: asset.id, code: asset.code, name: asset.name, type: asset.type, status: asset.status,
      zone,
      pressureMpa: unit?.pressureMpa ?? null, flowM3h: unit?.flowM3h ?? null,
      symbolId: node.symbolId,
      imageUrl: spraySymbolImages[node.symbolId],
      label: node.label || asset.code, anchor: anchor && (anchor[1] < 50 ? "A" : "B") === zone ? anchor : undefined,
    }];
  });
});

const selected = computed(() => devices.value.find(device => device.assetId === selectedId.value));
const selectedPoints = computed(() => selected.value ? store.getPoints(selected.value.assetId) : []);
const extraDevices = computed(() => devices.value.filter(device => !device.anchor));

function pointReading(pointId: string, unit?: string): string {
  const sample = store.latest(pointId);
  if (sample?.value == null || sample.quality === "missing" || sample.quality === "invalid") return "缺测";
  return typeof sample.value === "number" ? reading(sample.value, 2, unit ?? "") : String(sample.value);
}

function reading(value: number | null, digits: number, unit: string): string {
  return value === null ? "缺测" : `${value.toFixed(digits)} ${unit}`;
}
</script>

<template>
  <div class="spray-scene">
    <div class="scene-stage">
    <div class="scene-image">
      <img :src="sceneUrl" alt="射雾器工艺场景底图，包含 A 区和 B 区" />
      <template v-for="device in devices" :key="device.assetId">
        <button
          v-if="device.anchor"
          type="button"
          class="scene-pin"
          :style="{ left: device.anchor[0] + '%', top: device.anchor[1] + '%' }"
          :aria-label="'查看设备 ' + device.code"
          @click="selectedId = device.assetId"
        >
          <i :class="device.status" />{{ device.label }}
        </button>
      </template>
      <div v-for="zone in ['A', 'B']" :key="zone" class="scene-extra" :class="'zone-' + zone">
        <button v-for="device in extraDevices.filter(item => item.zone === zone)" :key="device.assetId"
          type="button" class="scene-extra-pin" :aria-label="'查看设备 ' + device.code"
          @click="selectedId = device.assetId">
          <img v-if="device.imageUrl" :src="device.imageUrl" class="scene-device-image"
            :class="{ 'scene-fog-cannon': device.symbolId === 'fog_cannon' }" alt="" />
          <span><i :class="device.status" />{{ device.code }}</span>
        </button>
      </div>
    </div>
    </div>
    <p class="scene-note">场景为静态示意，新增设备图标按组态区域叠加，可点击查看设备信息。</p>
    <div class="scene-devices" aria-label="已发布设备">
      <button v-for="device in devices" :key="device.assetId" type="button" @click="selectedId = device.assetId">
        <strong>{{ device.code }} · {{ device.name }}</strong>
        <span><i :class="device.status" />{{ statusLabels[device.status] }}</span>
        <small>末端压力 {{ reading(device.pressureMpa, 2, 'MPa') }} · 喷射流量 {{ reading(device.flowM3h, 1, 'm³/h') }}</small>
      </button>
    </div>
    <NModal :show="!!selected" preset="card" title="设备基础信息" style="width: min(440px, calc(100vw - 32px))" @update:show="value => { if (!value) selectedId = null; }">
      <template v-if="selected">
        <dl class="device-info">
          <dt>设备编号</dt><dd>{{ selected.code }}</dd>
          <dt>设备名称</dt><dd>{{ selected.name }}</dd>
          <dt>设备类型</dt><dd>{{ selected.type }}</dd>
          <dt>组态区域</dt><dd>{{ selected.zone }} 区</dd>
          <dt>运行状态</dt><dd><i :class="selected.status" />{{ statusLabels[selected.status] }}</dd>
          <template v-for="point in selectedPoints" :key="point.id">
            <dt>{{ point.label }}</dt><dd>{{ pointReading(point.id, point.unit) }} · {{ point.source }}</dd>
          </template>
        </dl>
        <NButton size="small" @click="emit('select', selected.assetId); selectedId = null">查看设备详情</NButton>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.spray-scene { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.scene-stage { flex: 1 1 0; min-height: 0; container-type: size; display: grid; place-items: center; }
.scene-image { width: min(100%, calc(100cqh * 1672 / 941)); position: relative; container-type: inline-size; overflow: hidden; border-radius: 10px; }
.scene-image img { display: block; width: 100%; height: auto; }
.scene-pin { position: absolute; transform: translate(-50%, -50%); padding: 4px 7px; border: 1px solid #bce3ff; border-radius: 6px; background: #123951; color: white; white-space: nowrap; cursor: pointer; }
.scene-extra { position: absolute; left: 39%; right: 6%; display: flex; align-items: end; gap: 6px; overflow-x: auto; padding: 3px; }
.scene-extra.zone-A { bottom: 52%; --device-image-width: 5.6cqw; }
.scene-extra.zone-B { bottom: 5%; --device-image-width: 6.6cqw; }
.scene-extra-pin { flex: none; display: grid; justify-items: center; gap: 2px; padding: 0; border: 0; background: transparent; color: white; cursor: pointer; }
.scene-extra-pin .scene-device-image { width: var(--device-image-width); height: auto; filter: drop-shadow(0 3px 3px #142c4a99); }
/* Match the shallower upward angle of the cannons in the scene. */
.scene-extra-pin .scene-fog-cannon { transform: rotate(10deg); transform-origin: 50% 75%; }
.scene-extra-pin span { padding: 2px 5px; border: 1px solid #bce3ff; border-radius: 5px; background: #123951; white-space: nowrap; }
.device-info { display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; margin: 0 0 16px; }
.device-info dt { color: #4a6780; }
.device-info dd { margin: 0; overflow-wrap: anywhere; }
.scene-note { margin: 8px 0; font-size: 12px; color: #4a6780; }
.scene-devices { display: flex; overflow-x: auto; gap: 6px; padding: 0 4px 4px; }
.scene-devices button { flex: 1 0 185px; display: grid; gap: 4px; padding: 7px; text-align: left; cursor: pointer; background: #f2f9ff; border: 1px solid #d3e6f6; border-radius: 6px; color: #173553; }
i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #899bad; margin-right: 4px; }
i.running { background: #25aa64; }
i.fault { background: #e14e4e; }
</style>

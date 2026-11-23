<script setup lang="ts">
/**
 * 首页左侧「项目建设与运维」悬浮卡。
 * 上半部分为业务系统入口（全场总览 + 六个子系统），下半部分为项目概况、当前系统说明与数据接入状态。
 * 统计值只使用 CAD/设计资料可核实的结构性数据，不展示未经确认的现场实测值。
 */
import { computed } from 'vue'
import type { BusinessSystem } from '../../scene/types/cad'
import { pipeLegend } from '../../scene/config/pipeLayers'

const p = defineProps<{
  systems: BusinessSystem[]
  active: string
  processRoute?: string
}>()
const emit = defineEmits<{
  select: [id: string]
  process: []
}>()

const activeSystem = computed(() => p.systems.find((s) => s.id === p.active))
const activeName = computed(() => activeSystem.value?.name ?? '全场总览')
const equipmentTotal = computed(() =>
  activeSystem.value?.areaEquipment.reduce((sum, area) => sum + area.equipmentIds.length, 0) ?? 0,
)
const focusLayers = computed(() =>
  (activeSystem.value?.focusPipeLayers ?? []).map((layer) => layer.replace(/^\$管综-/, '')),
)
const referenceLayers = computed(() =>
  (activeSystem.value?.referencePipeLayers ?? [])
    .map((layer) => layer.replace(/^\$管综-/, ''))
    .filter((layer) => !focusLayers.value.includes(layer)),
)

const dataAccess = [
  ['CAD 工程图', '已加载'],
  ['场景模型', '已生成'],
  ['现场实测', '未接入'],
  ['数据口径', '资料演示'],
] as const
</script>

<template>
  <aside class="tg-project-card" aria-label="项目建设与运维信息">
    <header class="tg-project-head">
      <span class="tg-project-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 21h18" />
          <path d="M5 21V7l7-4 7 4v14" />
          <path d="M9 21v-5h6v5" />
          <path d="M9 10h.01M15 10h.01M9 13h.01M15 13h.01" />
        </svg>
      </span>
      <div class="tg-project-title">
        <b>项目建设与运维</b>
        <small>PROJECT &amp; OPERATIONS</small>
      </div>
      <span class="tg-project-state"><i></i>运行中</span>
    </header>

    <div class="tg-project-body">
      <div class="tg-project-label">业务系统</div>
      <nav class="tg-project-nav" aria-label="业务系统入口">
        <button type="button" class="tg-project-nav-item" :class="{ active: p.active === 'all' }"
          :aria-current="p.active === 'all' ? 'true' : undefined" @click="emit('select', 'all')">
          <span class="tg-nav-dot all"></span>
          <span class="tg-nav-name">全场总览</span>
          <span class="tg-nav-arrow"></span>
        </button>
        <button v-for="(s, i) in p.systems" :key="s.id" type="button" class="tg-project-nav-item"
          :class="{ active: p.active === s.id }"
          :aria-current="p.active === s.id ? 'true' : undefined" @click="emit('select', s.id)">
          <span class="tg-nav-dot" :style="{ background: s.accent }"></span>
          <span class="tg-nav-index">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="tg-nav-name">{{ s.name }}</span>
          <span class="tg-nav-arrow"></span>
        </button>
        <button v-if="processRoute" type="button" class="tg-nav-process" @click="emit('process')">
          进入{{ activeName }}工艺页 →
        </button>
      </nav>

      <template v-if="!activeSystem">
        <div class="tg-project-label">管网图层</div>
        <ul class="tg-layer-list">
          <li v-for="layer in pipeLegend" :key="layer.layer">
            <i :style="{ background: layer.color }"></i>{{ layer.name }}
          </li>
        </ul>
        <p class="tg-overview-tip">点击上方任一子系统，场景仅显示该专业管线与标签；返回全场总览可恢复全部图层。</p>
      </template>

      <template v-else>
        <div class="tg-project-label">当前系统</div>
        <div class="tg-system-block">
          <p class="tg-system-intro">{{ activeSystem.intro }}</p>
          <div class="tg-system-meta">
            <span>涉及区域 <b>{{ activeSystem.areaEquipment.length }}</b></span>
            <span>设备点位 <b>{{ equipmentTotal }}</b></span>
          </div>
          <div v-if="focusLayers.length" class="tg-layer-chips">
            <span v-for="layer in focusLayers" :key="layer">{{ layer }}</span>
          </div>
          <div v-if="referenceLayers.length" class="tg-layer-chips reference">
            <span v-for="layer in referenceLayers" :key="layer">{{ layer }} · 参照</span>
          </div>
          <p class="tg-system-disclaimer">{{ activeSystem.disclaimer }}</p>
        </div>
        <p class="tg-system-hint">场景仅显示本系统主层与参照层；点击场景标签可查看对应点位数据。</p>
      </template>

      <div class="tg-project-label">场景构成</div>
      <dl class="tg-access-rows">
        <div><dt>堆场</dt><dd>8 座</dd></div>
        <div><dt>泊位</dt><dd>51 / 52 号</dd></div>
        <div><dt>集水池</dt><dd>北 2 · 南 5（设计）</dd></div>
        <div><dt>辅建区</dt><dd>办公楼 · 食堂 · 库场楼</dd></div>
      </dl>

      <div class="tg-project-spacer"></div>

      <div class="tg-project-label">数据接入</div>
      <dl class="tg-access-rows">
        <div v-for="[label, value] in dataAccess" :key="label">
          <dt>{{ label }}</dt>
          <dd :class="{ off: value === '未接入' || value === '资料演示' }">{{ value }}</dd>
        </div>
      </dl>
    </div>

    <p class="tg-project-note">数据依据：51/52 号泊位 CAD 工程图 · 资料演示口径</p>
  </aside>
</template>

<style scoped>
.tg-project-card {
  position: absolute;
  z-index: 6;
  left: 16px;
  top: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  width: 320px;
  padding: 15px 16px 13px;
  pointer-events: auto;
  color: #486b81;
  border: 1px solid var(--tg-glass-border, rgba(255, 255, 255, 0.74));
  border-radius: 16px;
  background: var(--tg-glass-surface, linear-gradient(150deg, rgba(255, 255, 255, 0.84) 0%, rgba(244, 250, 255, 0.73) 49%, rgba(231, 242, 251, 0.68) 100%));
  box-shadow: var(--tg-glass-shadow, 0 8px 25px rgba(39, 89, 135, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.6));
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  backdrop-filter: blur(14px) saturate(1.3);
}

.tg-project-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(203, 226, 238, 0.72);
}

.tg-project-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: #2f88a4;
  background: rgba(226, 246, 251, 0.85);
  border: 1px solid rgba(160, 216, 231, 0.62);
}

.tg-project-icon svg {
  width: 17px;
  height: 17px;
}

.tg-project-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tg-project-title b {
  font-size: 14px;
  font-weight: 700;
  color: #2b5a72;
  letter-spacing: 0.02em;
}

.tg-project-title small {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.13em;
  color: #8aa8b8;
}

.tg-project-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: #2f7c96;
  white-space: nowrap;
}

.tg-project-state i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2f9bb8;
  box-shadow: 0 0 0 3px rgba(47, 155, 184, 0.18);
}

.tg-project-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(158, 192, 209, 0.6) transparent;
  /* 内容超出时底部渐隐，提示可继续滚动，避免出现被截断的半行。 */
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent 100%);
}

.tg-project-body::-webkit-scrollbar {
  width: 4px;
}

.tg-project-body::-webkit-scrollbar-thumb {
  background: rgba(158, 192, 209, 0.6);
  border-radius: 4px;
}

.tg-project-label {
  flex: none;
  margin: 10px 0 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #8aa4b4;
}

.tg-project-nav {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tg-project-nav-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 27px;
  padding: 0 8px;
  border-radius: 7px;
  color: #46677c;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.tg-project-nav-item:hover {
  background: rgba(232, 246, 251, 0.85);
  color: #1f7491;
}

.tg-project-nav-item.active {
  background: rgba(219, 242, 249, 0.95);
  color: #176b88;
  box-shadow: inset 2px 0 0 #3fa5c2;
}

.tg-nav-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.tg-nav-dot.all {
  background: #7fa9c9;
  box-shadow: 0 0 0 3px rgba(127, 169, 201, 0.16);
}

.tg-nav-index {
  flex: none;
  font-size: 9px;
  font-weight: 700;
  color: #9db4c2;
  font-variant-numeric: tabular-nums;
}

.tg-project-nav-item.active .tg-nav-index {
  color: #3f9ab8;
}

.tg-nav-name {
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tg-nav-arrow {
  flex: none;
  width: 5px;
  height: 5px;
  margin-left: auto;
  border-top: 1.4px solid #a9c2d0;
  border-right: 1.4px solid #a9c2d0;
  transform: rotate(45deg);
}

.tg-project-nav-item.active .tg-nav-arrow {
  border-color: #4ba4c0;
}

.tg-nav-process {
  margin-top: 3px;
  padding: 4px 8px;
  border-radius: 7px;
  background: rgba(233, 249, 253, 0.9);
  border: 1px solid rgba(143, 202, 221, 0.66);
  color: #1d7d96;
  font-size: 10px;
  text-align: left;
}

.tg-nav-process:hover {
  background: #d9f3f9;
}

.tg-project-stats {
  flex: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
}

.tg-project-stats > div {
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(214, 234, 242, 0.78);
}

.tg-project-stats dt {
  font-size: 9.5px;
  color: #7d98a8;
  line-height: 1.3;
}

.tg-project-stats dd {
  margin: 2px 0 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.15;
  color: #2f6f88;
  font-variant-numeric: tabular-nums;
}

.tg-project-stats dd small {
  margin-left: 2px;
  font-size: 9px;
  font-weight: 600;
  color: #7d98a8;
}

.tg-stat-note {
  display: block;
  margin-top: 1px;
  font-size: 8.5px;
  color: #9aafbc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-layer-list {
  flex: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px 8px;
  margin: 0;
  padding: 7px 9px;
  list-style: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(214, 234, 242, 0.72);
}

.tg-layer-list li {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #587587;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-layer-list i {
  flex: none;
  width: 8px;
  height: 3px;
  border-radius: 2px;
}

.tg-overview-tip {
  margin: 7px 0 0;
  font-size: 9px;
  line-height: 1.55;
  color: #93aab8;
}

.tg-system-block {
  flex: none;
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(214, 234, 242, 0.78);
}

.tg-system-intro {
  margin: 0;
  font-size: 10px;
  line-height: 1.6;
  color: #5b788c;
}

.tg-system-meta {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: 9.5px;
  color: #7d98a8;
}

.tg-system-meta b {
  color: #2f6f88;
  font-size: 11px;
}

.tg-layer-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.tg-layer-chips span {
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(226, 244, 249, 0.9);
  border: 1px solid rgba(178, 220, 233, 0.7);
  font-size: 9px;
  color: #2f7f99;
}

.tg-layer-chips.reference span {
  background: rgba(247, 249, 251, 0.92);
  border-color: rgba(219, 231, 239, 0.9);
  color: #8199a8;
}

.tg-system-disclaimer {
  margin: 6px 0 0;
  font-size: 8.5px;
  line-height: 1.5;
  color: #9aafbc;
}

.tg-system-hint {
  flex: none;
  margin: 7px 0 0;
  padding: 6px 8px;
  border: 1px dashed rgba(178, 220, 233, 0.75);
  border-radius: 7px;
  background: rgba(238, 248, 252, 0.8);
  font-size: 9px;
  line-height: 1.5;
  color: #7e99a9;
}

.tg-project-spacer {
  flex: 1 1 auto;
  min-height: 10px;
}

.tg-access-rows {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 6px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(214, 234, 242, 0.72);
}

.tg-access-rows > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 2.5px 0;
}

.tg-access-rows dt {
  font-size: 10px;
  color: #839bAA;
}

.tg-access-rows dd {
  margin: 0;
  font-size: 10.5px;
  font-weight: 650;
  color: #347b93;
}

.tg-access-rows dd.off {
  color: #b08a63;
}

.tg-project-note {
  flex: none;
  margin: 9px 0 0;
  padding-top: 8px;
  border-top: 1px dashed rgba(203, 226, 238, 0.9);
  font-size: 9px;
  line-height: 1.5;
  color: #93aab8;
}

/* 区域设备面板会占用同一左侧位置，展开时让位。 */
.l1-zone:has(.region-overlay) .tg-project-card {
  opacity: 0;
  visibility: hidden;
}

@media (min-width: 2200px) {
  .tg-project-card {
    left: clamp(16px, 0.75vw, 32px);
    top: clamp(16px, 0.75vw, 32px);
    bottom: clamp(16px, 0.75vw, 32px);
    width: clamp(330px, 15vw, 480px);
    padding: clamp(15px, 0.65vw, 24px);
    border-radius: clamp(14px, 0.55vw, 22px);
  }
  .tg-project-head {
    gap: clamp(9px, 0.4vw, 15px);
    padding-bottom: clamp(10px, 0.42vw, 16px);
  }
  .tg-project-icon {
    width: clamp(30px, 1.2vw, 44px);
    height: clamp(30px, 1.2vw, 44px);
    border-radius: clamp(9px, 0.36vw, 14px);
  }
  .tg-project-icon svg {
    width: clamp(16px, 0.68vw, 24px);
    height: clamp(16px, 0.68vw, 24px);
  }
  .tg-project-title b {
    font-size: clamp(14px, 0.55vw, 20px);
  }
  .tg-project-title small {
    font-size: clamp(9px, 0.32vw, 13px);
  }
  .tg-project-state {
    font-size: clamp(11px, 0.4vw, 15px);
  }
  .tg-project-label {
    margin: clamp(10px, 0.42vw, 16px) 0 clamp(6px, 0.25vw, 10px);
    font-size: clamp(10px, 0.38vw, 14px);
  }
  .tg-project-nav-item {
    height: clamp(27px, 1.15vw, 42px);
    gap: clamp(7px, 0.3vw, 12px);
    border-radius: clamp(7px, 0.3vw, 11px);
    padding: 0 clamp(8px, 0.34vw, 13px);
  }
  .tg-nav-name {
    font-size: clamp(12px, 0.44vw, 16px);
  }
  .tg-nav-index {
    font-size: clamp(9px, 0.33vw, 12px);
  }
  .tg-project-stats {
    gap: clamp(6px, 0.28vw, 10px);
  }
  .tg-project-stats > div {
    padding: clamp(7px, 0.3vw, 11px) clamp(8px, 0.34vw, 13px);
    border-radius: clamp(8px, 0.32vw, 12px);
  }
  .tg-project-stats dt {
    font-size: clamp(10px, 0.35vw, 13px);
  }
  .tg-project-stats dd {
    font-size: clamp(16px, 0.66vw, 24px);
  }
  .tg-stat-note,
  .tg-system-disclaimer {
    font-size: clamp(8.5px, 0.3vw, 12px);
  }
  .tg-project-note {
    font-size: clamp(9px, 0.32vw, 13px);
  }
  .tg-system-intro {
    font-size: clamp(10px, 0.36vw, 13px);
  }
  .tg-access-rows dt,
  .tg-access-rows dd {
    font-size: clamp(10px, 0.36vw, 13px);
  }
}

@media (min-width: 950px) and (max-width: 1199px) {
  .tg-project-card {
    width: 264px;
    padding: 12px 13px 10px;
  }
  .tg-project-title b {
    font-size: 13px;
  }
  .tg-nav-name {
    font-size: 11px;
  }
  .tg-project-stats dd {
    font-size: 14px;
  }
}

/* 窄屏场景顶部保留原系统入口条，卡片隐藏。 */
@media (max-width: 949px) {
  .tg-project-card {
    display: none;
  }
}
</style>

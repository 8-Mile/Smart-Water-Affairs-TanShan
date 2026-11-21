<template>
  <el-card shadow="never" class="da-children dash-card" :style="{ '--i': startIndex }">
    <template #header>
      <div class="dc-head">
        <div class="dc-head-left">
          <ArtSvgIcon icon="ri:apps-2-line" />
          <span>下属设备（{{ items.length }}）</span>
        </div>
        <div v-if="items.length > PAGE_SIZE" class="dc-head-right">
          <span class="dc-page-info">{{ pageStart }} - {{ pageEnd }} / {{ items.length }}</span>
          <span class="dc-page-btn" :class="{ 'is-disabled': page === 0 }" title="上一页" @click="prevPage">
            <ArtSvgIcon icon="ri:arrow-left-s-line" />
          </span>
          <span
            class="dc-page-btn is-primary"
            :class="{ 'is-disabled': page >= pageCount - 1 }"
            title="下一页"
            @click="nextPage"
          >
            <ArtSvgIcon icon="ri:arrow-right-s-line" />
          </span>
          <span class="dc-all-btn" @click="openPanel">全部设备</span>
        </div>
      </div>
    </template>

    <div class="dc-grid">
      <div
        v-for="(child, idx) in pagedItems"
        :key="child.id"
        class="dc-card dash-card"
        :class="{ 'is-current': child.id === selectedId }"
        :style="[
          alarmCount(child) > 0
            ? { borderColor: levelColor(alarmLevel(child)), background: levelColor(alarmLevel(child)) + '0a' }
            : {},
          { '--i': idx + startIndex + 1 },
        ]"
        @click="emit('select', child.id)"
      >
        <span
          v-if="alarmCount(child) > 0"
          class="dc-alarm-dot"
          :style="{ background: levelColor(alarmLevel(child)) }"
          :title="`${alarmCount(child)} 条未闭环告警，最高${LEVEL_TEXT[alarmLevel(child)]}级`"
        >{{ alarmCount(child) > 9 ? '9+' : alarmCount(child) }}</span>
        <div class="dc-thumb">
          <img v-if="childImage(child)" :src="childImage(child)" :alt="child.name" />
          <ArtSvgIcon v-else :icon="treeNodeIcon(child)" :style="{ color: typeColor(child.type_id) }" />
        </div>
        <div class="dc-info">
          <div class="dc-name" :title="child.name">{{ shortName(child.name) }}</div>
          <el-tag :type="child.has_data === false ? 'info' : runTag(child.running_status)" size="small" effect="plain">
            {{ child.has_data === false ? '未接入' : runLabel(child.running_status) }}
          </el-tag>
          <div class="dc-type">{{ child.type_name || '—' }}</div>
        </div>
        <span class="dc-arrow"><ArtSvgIcon icon="ri:arrow-right-s-line" /></span>
      </div>
    </div>

    <!-- 全部下属设备：右侧浮层面板（设计图） -->
    <Teleport to="body">
      <transition name="dc-fade">
        <div v-if="panelOpen" class="dc-panel-mask" @click.self="panelOpen = false">
          <div class="dc-panel">
            <div class="dc-panel-head">
              <span class="dc-panel-title">全部下属设备（{{ items.length }}）</span>
              <span class="dc-panel-close" title="关闭" @click="panelOpen = false">
                <ArtSvgIcon icon="ri:close-line" />
              </span>
            </div>
            <el-input v-model="keyword" class="dc-panel-search" placeholder="搜索设备名称" clearable>
              <template #prefix><ArtSvgIcon icon="ri:search-line" /></template>
            </el-input>
            <div class="dc-panel-list">
              <div
                v-for="child in filteredItems"
                :key="child.id"
                class="dc-panel-item"
                :class="{ 'is-current': child.id === selectedId }"
                @click="emit('select', child.id)"
              >
                <div class="dc-thumb">
                  <img v-if="childImage(child)" :src="childImage(child)" :alt="child.name" />
                  <ArtSvgIcon v-else :icon="treeNodeIcon(child)" :style="{ color: typeColor(child.type_id) }" />
                </div>
                <div class="dc-panel-name" :title="child.name">{{ shortName(child.name) }}</div>
                <span class="dc-arrow"><ArtSvgIcon icon="ri:arrow-right-s-line" /></span>
              </div>
              <div v-if="!filteredItems.length" class="dc-panel-empty">未找到匹配设备</div>
            </div>
            <div class="dc-panel-hint">点击设备切换详情</div>
          </div>
        </div>
      </transition>
    </Teleport>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EquipmentItem } from '@/api/equipment'
import { equipmentImage } from '@/utils/equipmentImages'
import {
  alarmCountOf,
  alarmLevelOf,
  LEVEL_TEXT,
  levelColor,
  runLabel,
  runTag,
  shortName,
  treeNodeIcon,
  typeColor,
} from '@/utils/equipmentDisplay'

const props = withDefaults(
  defineProps<{
    /** 下属设备列表 */
    items: EquipmentItem[]
    /** 当前选中的设备 ID */
    selectedId: number | null
    /** 告警计数表（本地 + WS 增量） */
    alarmCounts: Record<string, number>
    /** 最高告警等级表 */
    alarmLevels: Record<string, number>
    /** 入场动画序号起始值，接在主详情卡之后 */
    startIndex?: number
  }>(),
  { startIndex: 1 },
)

const emit = defineEmits<{ select: [id: number] }>()

const PAGE_SIZE = 6
const page = ref(0)
const panelOpen = ref(false)
const keyword = ref('')

const pageCount = computed(() => Math.max(1, Math.ceil(props.items.length / PAGE_SIZE)))
const pagedItems = computed(() =>
  props.items.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE),
)
const pageStart = computed(() => (props.items.length ? page.value * PAGE_SIZE + 1 : 0))
const pageEnd = computed(() => Math.min((page.value + 1) * PAGE_SIZE, props.items.length))
const filteredItems = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return props.items
  return props.items.filter((c) => c.name.includes(kw) || (c.code || '').includes(kw))
})

const alarmCount = (eq: EquipmentItem) => alarmCountOf(eq, props.alarmCounts)
const alarmLevel = (eq: EquipmentItem) => alarmLevelOf(eq, props.alarmLevels)
const childImage = equipmentImage

function prevPage() {
  if (page.value > 0) page.value -= 1
}
function nextPage() {
  if (page.value < pageCount.value - 1) page.value += 1
}
function openPanel() {
  keyword.value = ''
  panelOpen.value = true
}

// 切换设备或列表变化时回到第一页，避免停留在超出范围的页码
watch(
  () => [props.selectedId, props.items.length],
  () => {
    page.value = 0
    panelOpen.value = false
  },
)
</script>

<style scoped lang="scss">
/* 子设备网格：固定高度上限，内容多时自身滚动，避免挤压主详情 */
.da-children {
  flex: 0 0 auto;
  min-height: 0;
  max-height: 45%;
  display: flex;
  flex-direction: column;
  background: rgb(255 255 255 / 72%) !important;
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border-color: rgb(200 220 240 / 30%);
}
.da-children :deep(.el-card__body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.da-children :deep(.el-card__header) {
  background: transparent !important;
}
.dc-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-weight: 600; color: #0b1e33;
}
.dc-head-left {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.dc-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 400;
}
.dc-page-info { font-size: 12px; color: #8a97a8; letter-spacing: 0.5px; }
.dc-page-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #8a97a8;
  background: #fff;
  border: 1px solid #e2e9f2;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: #166dfe; border-color: #a9cdf7; }
  &.is-primary {
    background: linear-gradient(180deg, #2a8bff 0%, #166dfe 100%);
    border-color: #166dfe;
    color: #fff;
  }
  &.is-disabled { opacity: 0.45; pointer-events: none; }
}
.dc-all-btn {
  height: 26px;
  padding: 0 12px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: #166dfe;
  background: #f2f8ff;
  border: 1px solid #b6d6f8;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { background: #e4f1ff; border-color: #166dfe; }
}
/* 一行 6 个的横向卡片 */
.dc-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}
.dc-card {
  background: #fff;
  border: 1px solid #e6edf5;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  &:hover {
    border-color: #0e7ff0;
    background: #f4f9ff;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(14, 127, 240, 0.12);
  }
  &.is-current {
    border-color: #0e7ff0;
    background: #e8f1ff;
  }
}
.dc-alarm-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  background: #ff3b5c;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  text-align: center;
}
/* 下属设备条目：缩略图 + 名称/状态/类型 + 圆圈箭头 */
.dc-thumb {
  flex: none;
  width: 52px;
  height: 42px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  overflow: hidden;
  img { width: 100%; height: 100%; object-fit: contain; }
}
.dc-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  .dc-name {
    max-width: 100%;
    font-weight: 600;
    color: #0b1e33;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .el-tag {
    align-self: flex-start;
    height: 18px;
    padding: 0 5px;
    font-size: 11px;
  }
  /* 停机标签与顶部“离线设备”卡片同色 */
  .el-tag--danger {
    --el-tag-text-color: #ff3b5c;
    --el-tag-border-color: color-mix(in srgb, #ff3b5c 45%, transparent);
    --el-tag-bg-color: color-mix(in srgb, #ff3b5c 10%, transparent);
  }
  .dc-type { font-size: 11px; color: #8a97a8; }
}
.dc-arrow {
  flex: none;
  font-size: 13px;
  color: #9aa8b8;
  width: 22px;
  height: 22px;
  border: 1.5px solid #dfe6ee;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* —— 全部下属设备：右侧浮层面板 —— */
.dc-panel-mask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  justify-content: flex-end;
  padding: 76px 28px 28px;
  background: rgb(12 28 48 / 18%);
}
.dc-panel {
  width: 320px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 10px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 36px rgb(8 26 48 / 22%);
}
.dc-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dc-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #0b1e33;
}
.dc-panel-close {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  color: #8a97a8;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: #ff3b5c; background: #feeff1; }
}
.dc-panel-search :deep(.el-input__wrapper) { border-radius: 6px; }
.dc-panel-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}
.dc-panel-item {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: #b6d6f8; background: #f6fbff; }
  &.is-current {
    border-color: #9fc7f5;
    background: #eaf4ff;
  }
  .dc-thumb { width: 44px; height: 36px; font-size: 18px; }
  .dc-arrow { width: 22px; height: 22px; font-size: 14px; }
}
.dc-panel-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0b1e33;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dc-panel-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: #a8b3c0;
}
.dc-panel-hint {
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid #f0f3f7;
  text-align: center;
  font-size: 12px;
  color: #a8b3c0;
}
.dc-fade-enter-active, .dc-fade-leave-active { transition: opacity 0.18s ease; }
.dc-fade-enter-from, .dc-fade-leave-to { opacity: 0; }

@media screen and (max-width: 1600px) {
  /* 不再固定 6 列，按可用宽度自适应，避免卡片被压成竖排文字 */
  .dc-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .dc-thumb { width: 40px; height: 34px; font-size: 16px; }
  .dc-info .dc-name { font-size: 13px; }
  .dc-info .dc-type { display: none; }
  .dc-arrow { display: none; }
  .dc-head { flex-wrap: wrap; row-gap: 6px; }
}
@media screen and (max-width: 1440px) {
  .dc-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .dc-card { padding: 8px 10px; gap: 8px; }
}
@media screen and (max-width: 820px) {
  .dc-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .dc-panel { width: 280px; }
}
@media screen and (max-width: 720px) {
  .dc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dc-panel { width: 100%; }
  .dc-head-right { flex-wrap: wrap; }
}
</style>

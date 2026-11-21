<template>
  <Teleport to="body">
    <div
      ref="floatRef"
      class="ai-float-btn"
      role="button"
      tabindex="0"
      aria-label="智能助手"
      :class="{ dragging, docked }"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @mousedown="onDragStart"
      @click="onFloatClick"
    >
      <RobotLive ref="robotRef" class="ai-robot-live" @ready="onRobotReady" />
      <div v-if="!robotReady" class="ai-robot-loading" aria-hidden="true"><i /></div>
      <span v-if="unread" class="dot" />
    </div>

    <ProDialog
      v-model="visible"
      title="智能助手"
      width="min(980px, 94vw)"
      top="8vh"
      :close-on-click-modal="false"
      destroy-on-close
      append-to-body
      hide-footer
    >
      <AiChatPanel @emotion="onEmotion" />
    </ProDialog>
  </Teleport>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AiChatPanel from '@/components/AiChatPanel.vue'
import ProDialog from '@/components/ProDialog.vue'

// 性能优化：RobotLive 静态引用会把 three.js（~600KB）拉进首屏 chunk；
// 改为异步组件后 three 仅在悬浮助手实际渲染时才加载
const RobotLive = defineAsyncComponent(() => import('@/components/RobotLive.vue'))

type Mood = 'happy' | 'sad' | 'blink' | 'clear'

const visible = ref(false)
const dragging = ref(false)
const unread = ref(false)
// 停靠态：默认半贴右边缘（露出 72px），避让右下角内容；悬停/聚焦滑出，拖拽后取消停靠
const docked = ref(false)

const robotRef = ref<InstanceType<typeof RobotLive> | null>(null)
const robotReady = ref(false)
let pendingMood: Mood | null = null

// 与 CSS 尺寸保持一致（128px），避免默认位置按旧尺寸计算导致悬浮球离屏幕角落过远、压住表格内容
const SIZE = 128
const pos = reactive({ x: 0, y: 0 })

// 鼠标位置转发：机器人头部/身体跟随鼠标方向转动
function onHostMouseMove(e: MouseEvent) {
  if (!robotReady.value) return
  const x = (e.clientX / window.innerWidth) * 2 - 1
  const y = -(e.clientY / window.innerHeight) * 2 + 1
  robotRef.value?.setPointer(x, y)
}

const floatRef = ref<HTMLElement | null>(null)
let startX = 0
let startY = 0
let moved = false

function placeDefault() {
  const w = window.innerWidth || document.documentElement.clientWidth
  const h = window.innerHeight || document.documentElement.clientHeight
  pos.x = Math.max(0, w - SIZE - 24)
  pos.y = Math.max(0, h - SIZE - 120)
  docked.value = true
}

function onDragStart(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
  docked.value = false
  moved = false
  startX = e.clientX - pos.x
  startY = e.clientY - pos.y
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  const nx = e.clientX - startX
  const ny = e.clientY - startY
  if (Math.abs(nx - pos.x) > 3 || Math.abs(ny - pos.y) > 3) moved = true
  pos.x = Math.max(0, Math.min(window.innerWidth - SIZE, nx))
  pos.y = Math.max(0, Math.min(window.innerHeight - SIZE, ny))
}

function onDragEnd() {
  dragging.value = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
}

function onFloatClick() {
  if (moved) return
  visible.value = true
  unread.value = false
}

function onResize() {
  pos.x = Math.max(0, Math.min(window.innerWidth - SIZE, pos.x))
  pos.y = Math.max(0, Math.min(window.innerHeight - SIZE, pos.y))
}

function onRobotReady() {
  robotReady.value = true
  if (pendingMood) {
    const mood = pendingMood
    pendingMood = null
    robotRef.value?.setMood(mood)
  }
}

// 对话内容驱动的表情：对话框打开时机器人被遮挡，先缓存，关闭对话后再播放
function onEmotion(mood: Mood) {
  if (visible.value || !robotReady.value) {
    pendingMood = mood
    return
  }
  robotRef.value?.setMood(mood)
}

watch(visible, (v) => {
  if (!v && pendingMood) {
    const mood = pendingMood
    pendingMood = null
    // 等对话框关闭动画结束再播放，避免仍被遮罩挡住
    window.setTimeout(() => robotRef.value?.setMood(mood), 240)
  }
})

onMounted(() => {
  placeDefault()
  window.addEventListener('resize', onResize)
  window.addEventListener('mousemove', onHostMouseMove)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', onHostMouseMove)
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>

<style scoped>
.ai-float-btn {
  position: fixed;
  z-index: 2500;
  width: 128px;
  height: 128px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  background: transparent;
  /* 静默态半透明，减少对右下角表格数据的遮挡；悬停恢复实色并轻微抬升 */
  opacity: 0.82;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}
.ai-float-btn .ai-robot-live {
  width: 100%;
  height: 100%;
  /* 指针事件交给浮窗外层：拖拽移动浮窗、点击弹出对话 */
  pointer-events: none;
}
/* 模型加载占位：iframe 在 Three.js + GLB 加载完成前为空白 */
.ai-float-btn .ai-robot-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.ai-float-btn .ai-robot-loading i {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid rgba(127, 232, 255, 0.22);
  border-top-color: rgba(127, 232, 255, 0.95);
  box-shadow: 0 0 14px rgba(127, 232, 255, 0.25);
  animation: ai-robot-spin 0.9s linear infinite;
}
@keyframes ai-robot-spin {
  to {
    transform: rotate(360deg);
  }
}
.ai-float-btn:hover {
  transform: translateY(-2px);
  opacity: 1;
}
/* 停靠态：半贴右边缘（128px 中露出 72px），避让右下角表格/图表内容；
   悬停与键盘聚焦时滑出全貌，拖拽后进入自由态（移除 docked 类） */
.ai-float-btn.docked {
  transform: translateX(56px);
}
.ai-float-btn.docked:hover,
.ai-float-btn.docked:focus-visible {
  transform: translateX(0) translateY(-2px);
  opacity: 1;
}
/* 停靠时未读点移到可见侧（左侧），避免随右半部分移出屏幕 */
.ai-float-btn.docked .dot {
  right: auto;
  left: 8px;
}
.ai-float-btn.dragging {
  cursor: grabbing;
  transition: none;
  opacity: 0.92;
}
.ai-float-btn .dot {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #f56c6c;
  border: 2px solid #fff;
}

/* 小屏与桌面端保持一致：悬浮球同为 128px */
@media only screen and (max-width: 768px) {
  .ai-float-btn {
    width: 128px;
    height: 128px;
  }
  .ai-float-btn .dot {
    top: 4px;
    right: 4px;
    width: 10px;
    height: 10px;
  }
}
</style>

<script setup lang="ts">
/**
 * 唐港首页 · 5188 原版布局
 *
 * 以 5188 industrial-operations-screen 的 App.vue 为原样基线：
 * DashboardStage + 顶部 DashboardHeader + 中央 CAD 三维场景 + OverviewCards + 页脚。
 * 场景来自本工程 modules/tanggang/scene，不依赖 5188 端口。
 * 全局样式已通过 PostCSS 前缀收敛到 .tanggang-home，避免影响 5175 既有页面。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElConfigProvider, ElDrawer } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import DashboardStage from './components/DashboardStage.vue'
import DashboardHeader from './components/DashboardHeader.vue'
import L1WaterScene from '../scene/L1WaterScene.vue'
import OverviewCards from './components/OverviewCards.vue'
import ProjectInfoCard from './components/ProjectInfoCard.vue'
import ProjectKpiStrip from './components/ProjectKpiStrip.vue'
import RegisterView from './components/RegisterView.vue'
import DisplaySettings from './components/DisplaySettings.vue'
import Icon from './components/Icon.vue'
import {
  navItems,
  snapshots,
  slots,
  sum,
  fmt,
  registerLabels,
  type Page,
  type Fact,
  type Entry,
  type Activity,
} from './data/demo'
import { readImage, storeImage } from './data/display'
import './styles/tanggang-home.css'
import './styles/system-header.css'

function currentPage(): Page {
  return 'overview'
}
const page = ref<Page>(currentPage())
const day = ref<0 | 1>(0)
const snap = computed(() => snapshots[day.value])
const change = computed(() =>
  day.value === 0 ? (snapshots[0].operation / snapshots[1].operation - 1) * 100 : null,
)
const open = ref(false)
type Mode =
  | 'operation'
  | 'schedule'
  | 'online'
  | 'throughput'
  | 'activities'
  | 'pending'
  | 'entry'
  | 'event'
  | 'settings'
const mode = ref<Mode>('operation')
const targetId = ref('')
const eventId = ref('')
const entry = computed(() => snap.value.entries.find((i) => i.id === targetId.value))
const eventItem = computed(() => snap.value.events.find((e) => e.id === eventId.value))
const eventList = computed(() =>
  snap.value.events.filter((e) => mode.value !== 'pending' || e.pending),
)
const modeTitles: Record<Mode, string> = {
  operation: '作业量统计口径',
  schedule: '作业准点率',
  online: '设备在线明细',
  throughput: '分时吞吐明细',
  activities: '全部作业动态',
  pending: '待跟进事件',
  entry: '对象详情',
  event: '事件详情',
  settings: '显示设置',
}
function show(next: Mode) {
  mode.value = next
  open.value = true
}
function selectEntry(id: string) {
  targetId.value = id
  show('entry')
}
function selectEvent(e: Activity) {
  eventId.value = e.id
  show('event')
}
function navigate(next: Page) {
  open.value = false
  location.hash = next
}
function onHash() {
  page.value = currentPage()
  open.value = false
}
function sweepDay(n: 0 | 1) {
  if (n !== day.value) {
    open.value = false
    day.value = n
  }
}
const facts = computed<Fact[]>(() => {
  const s = snap.value
  if (mode.value === 'online')
    return [
      ['在线设备', s.online + ' 台'],
      ['未在线设备', s.totalDevices - s.online + ' 台'],
      ['纳入监测', s.totalDevices + ' 台'],
      ['在线率', ((s.online / s.totalDevices) * 100).toFixed(1) + '%'],
    ]
  if (mode.value === 'schedule')
    return [
      ['按时完成', s.completed + ' 项'],
      ['计划任务', s.scheduled + ' 项'],
      ['准点率', ((s.completed / s.scheduled) * 100).toFixed(1) + '%'],
    ]
  if (mode.value === 'entry' && entry.value) {
    const i: Entry = entry.value
    return [['对象编号', i.id], ['位置', i.location], ['当前状态', i.state], ...i.facts]
  }
  return [
    ['入库', fmt(s.inTotal) + ' 件次'],
    ['出库', fmt(s.outTotal) + ' 件次'],
    ['场内搬运', fmt(sum(s.internal)) + ' 件次'],
    ['合计', fmt(s.operation) + ' 件次'],
  ]
})
const markers = ref(true),
  image = ref(''),
  busy = ref(false),
  feedback = ref('')
let active = true
let changeNumber = 0
function updateUrl(url: string) {
  if (image.value) URL.revokeObjectURL(image.value)
  image.value = url
}
function setMarkers(value: boolean) {
  markers.value = value
  try {
    localStorage.setItem('flowops.display.markers', value ? 'on' : 'off')
  } catch {
    feedback.value = '浮签设置仅在本次打开期间生效。'
  }
}
async function replaceImage(file: File | null) {
  if (busy.value) return
  if (
    file &&
    (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
  ) {
    feedback.value = '请选择 8 MB 以内的 PNG、JPEG 或 WebP 图片。'
    return
  }
  ++changeNumber
  busy.value = true
  let url = ''
  try {
    if (file) {
      url = URL.createObjectURL(file)
      const test = new Image()
      test.src = url
      await test.decode()
    }
    try {
      await storeImage(file)
      feedback.value = file ? '底图已保存在当前浏览器。' : '已恢复默认背景。'
    } catch {
      feedback.value = '浏览器存储不可用，本次显示已更新。'
    }
    if (active) {
      updateUrl(url)
      url = ''
    }
  } catch {
    feedback.value = '图片读取失败，请选择可正常打开的图像文件。'
  } finally {
    if (url) URL.revokeObjectURL(url)
    busy.value = false
  }
}
onMounted(async () => {
  window.addEventListener('hashchange', onHash)
  if (location.hash && location.hash !== '#overview') history.replaceState(null, '', '#overview')
  try {
    markers.value = localStorage.getItem('flowops.display.markers') !== 'off'
  } catch {}
  const version = changeNumber
  try {
    const blob = await readImage()
    if (active && blob && version === changeNumber) updateUrl(URL.createObjectURL(blob))
  } catch {}
})
onBeforeUnmount(() => {
  active = false
  window.removeEventListener('hashchange', onHash)
  updateUrl('')
})
</script>

<template>
  <div class="tanggang-home">
    <DashboardStage>
      <DashboardHeader />
      <L1WaterScene
        v-if="page === 'overview'"
        :image="image"
        :show-markers="markers"
      >
        <template #overlay="{ systems, active, choose, processRoute, openProcess }">
          <ProjectInfoCard
            :systems="systems"
            :active="active"
            :process-route="processRoute"
            @select="choose"
            @process="openProcess"
          />
          <ProjectKpiStrip />
        </template>
      </L1WaterScene>
      <main v-if="page === 'overview'" class="overview">
        <OverviewCards
          :snapshot="snap"
          :change="change"
          @details="show"
          @navigate="navigate"
          @event="selectEvent"
        />
      </main>
      <main v-else class="register-main">
        <RegisterView
          :page="page"
          :entries="snap.entries"
          :date="snap.date"
          @select="selectEntry"
        />
      </main>

    </DashboardStage>
    <ElConfigProvider :locale="zhCn"
      ><ElDrawer
        v-model="open"
        :title="modeTitles[mode]"
        append-to-body
        destroy-on-close
        size="min(448px, 100vw)"
        class="detail-sheet"
        :close-on-click-modal="true"
      >
        <DisplaySettings
          v-if="mode === 'settings'"
          :markers="markers"
          :has-image="!!image"
          :busy="busy"
          :feedback="feedback"
          @markers="setMarkers"
          @image="replaceImage"
        />
        <template v-else>
          <p class="drawer-stamp">
            <span class="live-dot"></span>本地演示快照　{{ snap.date }} 16:00
          </p>
          <template v-if="mode === 'activities' || mode === 'pending'">
            <div class="drawer-event-list">
              <button v-for="e in eventList" :key="e.id" @click="selectEvent(e)">
                <time>{{ e.time }}</time
                ><span
                  ><b>{{ e.title }}</b
                  ><small>{{ e.detail }}</small></span
                ><Icon name="chevron" />
              </button>
            </div>
          </template>
          <template v-else-if="mode === 'event' && eventItem">
            <h2 class="drawer-subtitle">{{ eventItem.title }}</h2>
            <p class="drawer-note">{{ eventItem.detail }}</p>
            <dl class="data-list">
              <div>
                <dt>记录时间</dt>
                <dd>{{ snap.date }} {{ eventItem.time }}</dd>
              </div>
              <div>
                <dt>跟进状态</dt>
                <dd>{{ eventItem.pending ? '待跟进' : '已记录' }}</dd>
              </div>
            </dl>
            <button class="primary-button" @click="selectEntry(eventItem.target)">
              查看关联对象 {{ eventItem.target }}
            </button>
          </template>
          <template v-else-if="mode === 'throughput'">
            <table class="drawer-table">
              <thead>
                <tr>
                  <th>时段</th>
                  <th>入库（件）</th>
                  <th>出库（件）</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(label, i) in slots" :key="label">
                  <td>{{ label }}</td>
                  <td>{{ fmt(snap.inbound[i]) }}</td>
                  <td>{{ fmt(snap.outbound[i]) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th>合计</th>
                  <td>{{ fmt(snap.inTotal) }}</td>
                  <td>{{ fmt(snap.outTotal) }}</td>
                </tr>
              </tfoot>
            </table>
          </template>
          <template v-else>
            <h2 v-if="mode === 'entry' && entry" class="drawer-subtitle">{{ entry.name }}</h2>
            <p v-if="mode === 'operation'" class="drawer-note">
              每完成一次入库、出库或场内搬运计一次作业，同一件货物可产生多次作业。
            </p>
            <dl class="data-list">
              <div v-for="[label, value] in facts" :key="label">
                <dt>{{ label }}</dt>
                <dd>{{ value }}</dd>
              </div>
            </dl>
            <button
              v-if="mode === 'entry' && entry"
              class="primary-button"
              @click="navigate(entry.page)"
            >
              打开{{ registerLabels[entry.page][0] }}
            </button>
          </template>
        </template>
      </ElDrawer></ElConfigProvider
    >
  </div>
</template>

<style>
/* 仅收敛页面根容器尺寸，其余样式见 styles/tanggang-home.css */
.tanggang-home {
  width: 100%;
  min-height: 100dvh;
  overflow-x: clip;
  background: #edf2f8;
}
</style>

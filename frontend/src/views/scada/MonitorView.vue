<template>
  <div class="page mod-monitor" :class="{ 'screen-mode': screenMode }">
    <button
      class="screen-toggle"
      :title="screenMode ? '退出大屏模式' : '进入大屏模式'"
      @click="screenMode = !screenMode"
    >
      <el-icon :size="16"><component :is="screenMode ? 'Sunny' : 'Monitor'" /></el-icon>
      <span>{{ screenMode ? '浅色' : '大屏' }}</span>
    </button>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="实时监控" name="monitor">
    <el-card shadow="never" class="status-card art-table-card">
      <div class="status-row">
        <div>
          <div class="label">运行状态</div>
          <el-tag :type="runtime?.running ? 'success' : 'info'" size="large">
            <i v-if="runtime?.running" class="pulse-dot mon-pulse" />
            {{ runtime?.running ? '仿真运行中' : '已停止' }}
          </el-tag>
        </div>
        <div>
          <div class="label">模式 / 端点</div>
          <div class="value">{{ runtime?.mode }} · {{ runtime?.endpoint }}</div>
        </div>
        <div>
          <div class="label">周期 / Tick</div>
          <div class="value">
            {{ runtime?.interval_sec }}s · #{{ runtime?.tick_count ?? 0 }}
            （最近 {{ runtime?.last_sample_count ?? 0 }} 点）
          </div>
        </div>
        <div>
          <div class="label">配置 OPC 端点</div>
          <div class="value muted">{{ runtime?.opcua_endpoint_config }}</div>
        </div>
        <div class="actions">
          <el-button v-if="hasPerm('scada:sim:control')" type="success" :disabled="runtime?.running" @click="onStart">启动仿真</el-button>
          <el-button v-if="hasPerm('scada:sim:control')" type="danger" :disabled="!runtime?.running" @click="onStop">停止</el-button>
          <el-button @click="refreshAll">刷新</el-button>
        </div>
      </div>
      <el-alert
        v-if="runtime?.last_error"
        type="error"
        :title="`最近错误：${runtime.last_error}`"
        show-icon
        :closable="false"
        style="margin-top: 12px"
      />
      <el-alert
        v-if="missingCount > 0"
        type="warning"
        :title="`数据缺失提醒：${missingCount} 个测点超过 5 分钟未更新，请检查采集链路`"
        show-icon
        :closable="false"
        class="missing-alert"
        style="margin-top: 12px"
      />
    </el-card>

    <el-card shadow="never" class="latest-table-card art-table-card">
      <!-- 卡片标题栏：图标徽章 + 标题 + 科技线条，右侧过滤输入（对齐维修工单页标准） -->
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:radar-line" />
        </span>
        <span class="head-title">实时测点值</span>
        <span class="head-deco" aria-hidden />
        <el-input
          v-model="keyword"
          clearable
          placeholder="过滤测点"
          style="width: 200px"
          @keyup.enter="loadLatest"
        />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="latest"
        export-filename="实时测点值"
        @refresh="loadLatest"
      />
      <ProTable
        :data="latest"
        :loading="loading"
        :columns="tableColumns"
        row-key="tag_name"
        max-height="560"
      >
        <template #display_value="{ row }">
          <span class="val">{{ formatVal(row) }}</span>
          <span v-if="row.unit" class="unit">{{ row.unit }}</span>
        </template>
        <template #status_name="{ row }">
          <el-tag
            size="small"
            effect="light"
            :type="row.status_name === 'Good' ? 'success' : 'warning'"
          >
            {{ row.status_name }}
          </el-tag>
        </template>
        <template #ts_ms="{ row }">
          {{ formatTs(row.ts_ms) }}
        </template>
        <template #freshness="{ row }">
          <el-tag
            v-if="freshness(row).level !== 'ok'"
            size="small"
            :type="freshness(row).level === 'missing' ? 'danger' : 'warning'"
            effect="light"
          >
            {{ freshness(row).label }}
          </el-tag>
          <span v-else style="color:var(--el-color-success)">正常</span>
        </template>
      </ProTable>
    </el-card>
      </el-tab-pane>
        <!-- 测点配置属管理职能：无任何 scada:point 权限的角色（如操作员）不渲染该 Tab -->
      <el-tab-pane
        v-if="hasAnyPerm(['scada:point:create', 'scada:point:update', 'scada:point:inject', 'scada:point:delete'])"
        label="测点配置"
        name="points"
        lazy
      >
        <PointsView />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchRuntimeStatus,
  fetchScadaLatest,
  startRuntime,
  stopRuntime,
  type ScadaLatest,
  type ScadaRuntimeStatus,
} from '@/api/scada'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import PointsView from './PointsView.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm, hasAnyPerm } = usePermissions()

const activeTab = ref('monitor')
/** 本页深色大屏模式（仅覆盖本页，不影响全局主题） */
const screenMode = ref(false)

const runtime = ref<ScadaRuntimeStatus | null>(null)
const latest = ref<ScadaLatest[]>([])
const loading = ref(false)
const keyword = ref('')
let timer: number | undefined

const tableColumns = ref<ProColumn[]>([
  { prop: 'tag_name', label: '测点', minWidth: 120 },
  { prop: 'node_id', label: 'NodeId', minWidth: 140, showOverflowTooltip: true },
  { prop: 'display_value', label: '当前值', width: 120 },
  { prop: 'value_type', label: '类型', width: 90, align: 'center' },
  { prop: 'status_name', label: '质量', width: 90, align: 'center' },
  { prop: 'description', label: '描述', minWidth: 120, showOverflowTooltip: true },
  { prop: 'ts_ms', label: '时间戳', width: 170 },
  { prop: 'freshness', label: '新鲜度', width: 90, align: 'center' },
])

const exportColumns = [
  { prop: 'tag_name', label: '测点' },
  { prop: 'node_id', label: 'NodeId' },
  { prop: 'display_value', label: '当前值', formatter: (r: any) => formatVal(r) },
  { prop: 'value_type', label: '类型' },
  { prop: 'status_name', label: '质量' },
  { prop: 'description', label: '描述' },
  { prop: 'ts_ms', label: '时间戳', formatter: (r: any) => formatTs(r.ts_ms) },
  {
    prop: 'freshness',
    label: '新鲜度',
    formatter: (r: any) => freshness(r).label,
  },
]

function formatTs(ts?: number) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString()
}

function formatVal(row: ScadaLatest) {
  if (row.display_value === null || row.display_value === undefined) return '—'
  if (typeof row.display_value === 'number') return row.display_value.toFixed(3)
  return String(row.display_value)
}

/* 数据新鲜度：<60s 正常 / 60s~5min 超时 / >5min 缺失 */
function freshness(row: ScadaLatest): { level: 'ok' | 'timeout' | 'missing'; label: string } {
  if (!row.ts_ms) return { level: 'missing', label: '缺失' }
  const diff = (Date.now() - row.ts_ms) / 1000
  if (diff > 300) return { level: 'missing', label: '缺失' }
  if (diff > 60) return { level: 'timeout', label: '超时' }
  return { level: 'ok', label: '正常' }
}

const missingCount = computed(() =>
  latest.value.filter((r) => freshness(r).level === 'missing').length,
)

/* 声光提醒：出现缺失测点时闪烁告警横幅并播放提示音 */
let audioCtx: AudioContext | null = null
function playBeep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + 0.3)
  } catch {
    // 忽略音频错误
  }
}
watch(
  () => missingCount.value,
  (n, old) => {
    if (n > 0 && (old ?? 0) === 0) playBeep()
  },
)

async function loadStatus() {
  const { data } = await fetchRuntimeStatus()
  runtime.value = data.data
}

async function loadLatest() {
  loading.value = true
  try {
    const { data } = await fetchScadaLatest({
      keyword: keyword.value || undefined,
      limit: 200,
    })
    latest.value = data.data
  } finally {
    loading.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadLatest()])
}

async function onStart() {
  await startRuntime({ mode: 'mock', interval_sec: 1 })
  ElMessage.success('仿真已启动')
  await refreshAll()
}

async function onStop() {
  await stopRuntime()
  ElMessage.success('仿真已停止')
  await refreshAll()
}

onMounted(async () => {
  await refreshAll()
  timer = window.setInterval(() => {
    loadStatus()
    loadLatest()
  }, 2000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<style scoped>
.page {
  position: relative;
}
.status-card {
  /* 下方卡片由全局 .art-table-card 的 margin-top: 12px 提供间距，此处不再叠加 margin-bottom，避免 24px */
  /* !important 提级：对冲全局 .art-table-card 的 border:none，保留运行状态卡左侧主色标识条 */
  border-left: 4px solid var(--el-color-primary) !important;
}
.status-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  align-items: end;
}
.label {
  color: var(--art-gray-600);
  font-size: 12px;
  margin-bottom: 6px;
}
.value {
  font-size: 14px;
  color: var(--art-gray-900);
  word-break: break-all;
}
.muted {
  color: var(--art-gray-600);
  font-size: 12px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* 卡片标题栏样式统一走全局 .card-head/.head-badge/.head-title/.head-deco */
.val {
  font-weight: 600;
  color: var(--theme-color);
}
.unit {
  margin-left: 4px;
  color: var(--art-gray-600);
  font-size: 12px;
}
.missing-alert {
  animation: blink 1.2s ease-in-out infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@media only screen and (max-width: 1024px) {
  .status-row {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 560px) {
  .status-row {
    grid-template-columns: 1fr;
  }
}
.mon-pulse {
  margin-right: 6px;
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.9);
}
.mon-pulse::after {
  border-color: #10b981;
}

/* ===== 大屏模式切换按钮（两种模式都可见） ===== */
.screen-toggle {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
  color: var(--art-gray-500, #949eb7);
  cursor: pointer;
  background: var(--default-box-color, #fff);
  border: 1px solid var(--art-card-border, rgba(0, 0, 0, 0.08));
  border-radius: calc(var(--custom-radius, 0.75rem) + 0px);
  box-shadow: none;
  transition: all 0.2s ease;
}
.screen-toggle:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

/* ===== 深色大屏模式（局部覆盖，不动全局主题） ===== */
.screen-mode::before {
  position: fixed;
  inset: 0;
  z-index: 0;
  content: '';
  pointer-events: none;
  background:
    radial-gradient(900px 400px at 78% -140px, rgba(34, 211, 238, 0.12), transparent 70%),
    radial-gradient(1100px 460px at 10% -180px, rgba(14, 127, 240, 0.16), transparent 72%),
    radial-gradient(rgba(14, 160, 220, 0.13) 1px, transparent 1px),
    linear-gradient(180deg, var(--hydro-ink-800, #0d2742) 0%, var(--hydro-ink-900, #081a2e) 100%);
  background-size:
    100% 560px,
    100% 620px,
    22px 22px,
    100% 100%;
}
.screen-mode > * {
  position: relative;
  z-index: 1;
}
.screen-mode .screen-toggle {
  color: rgba(232, 244, 255, 0.82);
  background: rgba(34, 211, 238, 0.1);
  border-color: rgba(34, 211, 238, 0.32);
}
.screen-mode :deep(.el-card) {
  color: #dcebfb;
  background: rgba(13, 39, 66, 0.66);
  border-color: rgba(34, 211, 238, 0.2);
  box-shadow: 0 14px 34px -18px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
}
.screen-mode :deep(.el-card__header) {
  border-bottom-color: rgba(150, 200, 230, 0.16);
}
.screen-mode .label,
.screen-mode .muted,
.screen-mode .card-head {
  color: rgba(232, 244, 255, 0.62) !important;
}
/* 卡头升级为全局 card-head 后，标题字被全局深色锁定，深色大屏下提亮保证可读 */
.screen-mode .head-title {
  color: rgba(232, 244, 255, 0.85) !important;
}
.screen-mode .head-badge {
  color: var(--hydro-cyan-bright, #22d3ee);
  background: rgba(34, 211, 238, 0.12);
  border-color: rgba(34, 211, 238, 0.32);
}
.screen-mode .value {
  color: #eaf5ff;
}
.screen-mode .val {
  color: var(--hydro-cyan-bright, #22d3ee);
  text-shadow: 0 0 12px rgba(34, 211, 238, 0.4);
}
.screen-mode :deep(.el-tabs__item) {
  color: rgba(232, 244, 255, 0.55);
}
.screen-mode :deep(.el-tabs__item.is-active) {
  color: var(--hydro-cyan-bright, #22d3ee);
}
.screen-mode :deep(.el-tabs__active-bar) {
  background: linear-gradient(90deg, var(--hydro-blue, #0e7ff0), var(--hydro-cyan-bright, #22d3ee));
}
.screen-mode :deep(.el-tabs__nav-wrap::after) {
  background-color: rgba(150, 200, 230, 0.16);
}
.screen-mode :deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(8, 26, 46, 0.55);
  --el-table-header-text-color: rgba(232, 244, 255, 0.72);
  --el-table-text-color: #cfe4f7;
  --el-table-border-color: rgba(150, 200, 230, 0.14);
  --el-table-row-hover-bg-color: rgba(6, 182, 212, 0.1);
  background: transparent;
}
.screen-mode :deep(.el-table th.el-table__cell) {
  background: rgba(8, 26, 46, 0.55);
}
.screen-mode :deep(.el-table__empty-text) {
  color: rgba(232, 244, 255, 0.55);
}
.screen-mode :deep(.el-input__wrapper) {
  background: rgba(8, 26, 46, 0.6);
  box-shadow: 0 0 0 1px rgba(150, 200, 230, 0.22) inset;
}
.screen-mode :deep(.el-input__inner) {
  color: #eaf5ff;
}
.screen-mode :deep(.el-input__inner::placeholder) {
  color: rgba(232, 244, 255, 0.4);
}
.screen-mode :deep(.el-button:not(.el-button--primary):not(.el-button--success):not(.el-button--danger):not(.el-button--warning)) {
  color: rgba(232, 244, 255, 0.85);
  background: rgba(34, 211, 238, 0.08);
  border-color: rgba(34, 211, 238, 0.3);
}
</style>

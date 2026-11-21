<template>
  <div class="page mod-alarm page-fill" :class="{ flash: flashing, 'is-ready': pageReady }">
    <IconTabs v-model="activeTab" class="alarm-tabs" :tabs="alarmTabs" @tab-change="onTabChange">
      <template #realtime>
        <!-- 跨页定位提示：工作台带 ?focus=告警id 跳转命中时展示 -->
        <el-alert
          v-if="banner"
          class="focus-banner"
          type="info"
          :title="`已从工作台定位到告警 #${focus}`"
          closable
          @close="dismiss"
        />
        <!-- KPI 实时态势卡：四卡通栏（对齐设计图），不随下方主栏/侧栏收窄 -->
        <div class="kpi-panel">
          <div class="kpi-row">
            <KpiCard
              v-for="(c, idx) in kpis"
              :key="c.label"
              class="dash-card"
              :style="{ '--i': idx }"
              variant="alarm"
              :skin="c.variant"
              :color="c.color"
              :label="c.label"
              :value="c.value"
              unit="条"
              :percent="c.pct"
              :left-icon="c.leftIcon"
              :right-icon="c.rightIcon"
              chart-type="line"
              clickable
              :active="activeKpi === c.kpiKey"
              :breathing="activeKpi === c.kpiKey"
              @click="onKpiClick(c)"
            />
          </div>
        </div>

        <div class="rt-grid">
          <div class="rt-main">
    <!-- 筛选区 -->
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="onReset"
    />

    <!-- 新增告警提示条：静默刷新检测到新告警时浮现（不打断列表滚动/选中），点击跳回第 1 页查看 -->
    <transition name="el-fade-in-linear">
      <div v-if="newAlertCount > 0" class="new-alert-bar" @click="viewNewAlerts">
        <span class="na-icon"><ArtSvgIcon icon="ri:notification-3-line" /></span>
        <span class="na-text">当前有 <b>{{ newAlertCount }}</b> 条新增告警，点击查看最新数据</span>
      </div>
    </transition>

    <!-- 实时告警表格：磨砂通栏（与维修工单页同框架） -->
    <div class="table-section">
      <el-card shadow="never" class="art-table-card table-card">
        <div class="card-head">
          <span class="head-badge">
            <ArtSvgIcon icon="ri:alarm-warning-line" />
          </span>
          <span class="head-title">实时告警</span>
          <span class="head-deco" aria-hidden />
        </div>

      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-data="rows"
        export-filename="实时告警"
        layout="export,refresh"
        @refresh="load"
      />

      <ProTable
        v-show="!showFilterEmpty"
        :data="rows"
        :loading="loading"
        :columns="tableColumns"
        row-key="id"
        :row-class-name="tableRowClass"
        :pagination="{ current: page, size: pageSize, total }"
        @row-click="onRowClick"
        @page-change="onPageChange"
        @size-change="onPageSizeChange"
      >
        <template #alarm_level="{ row }">
          <el-tag class="lv-tag" :type="levelType(row.alarm_level)" size="small">
            {{ levelLabel(row.alarm_level) }}
          </el-tag>
        </template>
        <template #alarm_status="{ row }">
          <el-tag
            class="st-tag"
            :class="`st-${displayStatusKey(row)}`"
            size="small"
            :type="displayStatusTag(row)"
            effect="light"
          >
            {{ displayStatusLabel(row) }}
          </el-tag>
        </template>
        <template #alarm_time="{ row }">
          {{ formatDateTime(row.alarm_time) }}
        </template>
        <template #__actions="{ row }">
          <div class="action-cell">
            <!-- 维修处理：管理员一键生成维修工单（告警侧唯一处理入口，建单后自动跳转工单页） -->
            <ArtButtonTable
              v-if="canRepairHandle(row)"
              icon="ri:tools-line"
              icon-class="bg-warning/12 text-warning"
              title="维修处理"
              label="维修处理"
              @click="onRepairHandle(row)"
            />
            <!-- 关联工单：跳转维修工单页定位到对应工单（操作员侧只看自己的工单） -->
            <ArtButtonTable
              v-if="row.repair_order_no"
              icon="ri:link"
              icon-class="bg-success/12 text-success"
              title="关联工单"
              label="关联工单"
              @click="goRepairOrder(row)"
            />
            <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
            <ArtButtonTable type="view" title="详情" label="详情" @click="showDetail(row)" />
          </div>
        </template>
      </ProTable>

      <!-- 有筛选条件但无结果时给清空引导；无筛选时走表格内置空态 -->
      <div v-if="showFilterEmpty" class="filter-empty">
        <el-empty :image-size="120" description="没有符合条件的告警">
          <el-button link type="primary" @click="onClearFilter">清除筛选条件</el-button>
        </el-empty>
      </div>
    </el-card>
    </div>
          </div>

          <!-- 右侧统计栏 -->
          <div class="rt-side">
            <!-- 告警统计：24小时趋势 -->
            <div class="side-card dash-card" style="--i: 4">
              <div class="side-head">
                <span class="bar" />
                告警统计
                <el-select v-model="trendRange" size="small" style="width: 110px; margin-left: auto">
                  <el-option label="近24小时" value="24h" />
                </el-select>
              </div>
              <div ref="trendRef" class="trend-chart" />
            </div>

            <!-- 告警等级分布 -->
            <div class="side-card dash-card" style="--i: 5">
              <div class="side-head"><span class="bar" />告警等级分布</div>
              <div class="dist-body">
                <div class="dist-chart-wrap">
                  <div ref="distRef" class="dist-chart" />
                  <div class="dist-center">共 <b>{{ levelTotal }}</b> 条</div>
                </div>
                <div class="dist-legend">
                  <div v-for="d in levelDist" :key="d.level" class="legend-item">
                    <i class="dot" :style="{ background: d.color }" />
                    <span class="lg-name">{{ d.name }}</span>
                    <span class="lg-num">{{ d.count }}</span>
                    <span class="lg-pct">{{ d.pct }}%</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 当前告警详情（形制对齐维修工单详情卡；一/二/三类对应红/橙/蓝边框阴影）
                 宽屏：右侧栏常驻卡；窄屏（≤1600px）变为右侧滑出抽屉。
                 抽屉态 Teleport 到 body：避免祖先变换/磨砂建立 fixed 包含块，
                 导致抽屉顶部相对内容区偏移、底部超出视口 -->
            <Teleport to="body" :disabled="!isNarrow">
            <Transition name="drawer-mask">
              <div v-if="isNarrow && detailOpen" class="detail-mask" @click="closeDetailDrawer" />
            </Transition>
            <div
              class="side-card detail-card"
              :style="{ '--i': 6 }"
              :class="[
                selected ? `lv-${selected.alarm_level}` : '',
                detailFlash ? 'detail-flash' : '',
                isNarrow && detailOpen ? 'drawer-open' : '',
                isNarrow ? '' : 'dash-card',
              ]"
            >
              <template v-if="selected">
                <div class="ad-head">
                  <span class="ad-badge"><ArtSvgIcon icon="ri:alarm-warning-line" /></span>
                  <div class="ad-titles">
                    <h3 class="ad-title">告警详情</h3>
                    <p class="ad-sub">{{ selected.rule_name }}</p>
                  </div>
                  <span class="ad-level-pill" :class="`lv-${selected.alarm_level}`">
                    {{ levelLabel(selected.alarm_level) }}
                  </span>
                  <button
                    v-if="isNarrow"
                    class="drawer-close"
                    type="button"
                    aria-label="关闭详情"
                    @click="closeDetailDrawer"
                  >
                    <ArtSvgIcon icon="ri:close-line" />
                  </button>
                </div>
                <div class="cur-scroll">
                  <section class="ad-info">
                    <div class="ad-row">
                      <div class="ad-label"><ArtSvgIcon class="lab-icon" icon="ri:server-line" /><span>设备名称</span></div>
                      <div class="ad-value">{{ selected.equipment_name }}</div>
                    </div>
                    <div class="ad-row">
                      <div class="ad-label"><ArtSvgIcon class="lab-icon" icon="ri:map-pin-2-line" /><span>设备位置</span></div>
                      <div class="ad-value">{{ selected.location_name || '—' }}</div>
                    </div>
                    <div class="ad-row">
                      <div class="ad-label"><ArtSvgIcon class="lab-icon" icon="ri:pulse-line" /><span>触发值</span></div>
                      <div class="ad-value">{{ selected.trigger_value || '—' }}</div>
                    </div>
                    <div class="ad-row">
                      <div class="ad-label"><ArtSvgIcon class="lab-icon" icon="ri:radiobox-line" /><span>当前状态</span></div>
                      <div class="ad-value">
                        <span class="ad-status-pill" :class="`st-${displayStatusKey(selected)}`">
                          {{ displayStatusLabel(selected) }}
                        </span>
                      </div>
                    </div>
                    <div class="ad-row">
                      <div class="ad-label"><ArtSvgIcon class="lab-icon" icon="ri:link" /><span>关联工单</span></div>
                      <div class="ad-value">
                        <el-button
                          v-if="selected.repair_order_no"
                          link
                          type="primary"
                          class="cur-link"
                          @click="goRepairOrder(selected)"
                        >
                          {{ selected.repair_order_no }}
                        </el-button>
                        <span v-else>—</span>
                      </div>
                    </div>
                    <div class="ad-row ad-row--top">
                      <div class="ad-label"><ArtSvgIcon class="lab-icon" icon="ri:file-text-line" /><span>告警详情</span></div>
                      <div class="ad-value ad-detail">{{ selected.trigger_detail || '—' }}</div>
                    </div>
                  </section>
                  <div class="cur-flow">
                    <div class="flow-title">处理流程</div>
                    <el-timeline>
                      <el-timeline-item
                        v-for="(log, i) in flowNodes"
                        :key="i"
                        :timestamp="formatDateTime(log.time)"
                        :type="log.tone"
                        :hollow="i !== flowNodes.length - 1"
                      >
                        <b>{{ log.title }}</b>
                        <div v-if="log.detail" class="log-detail">{{ log.detail }}</div>
                      </el-timeline-item>
                    </el-timeline>
                  </div>
                </div>
              </template>
              <el-empty v-else :image-size="56" description="点击左侧表格行查看详情" />
            </div>
            </Teleport>
          </div>
        </div>

    </template>
      <template #history>
        <HistoryView ref="historyRef" />
      </template>
      <template #rules>
        <RulesPanel />
      </template>
      <template #types>
        <TypesView />
      </template>
    </IconTabs>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import echarts from '@/utils/echarts'
import { CircleCheck, Clock, Timer, Warning } from '@element-plus/icons-vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import {
  fetchAlarmStats,
  fetchAlarmTrend24h,
  getAlarm,
  listAlarms,
  repairHandle,
  type AlarmItem,
  type AlarmStats,
  type AlarmTrend24h,
} from '@/api/alarm'
import { connectAlarmWs, disconnectAlarmWs, onAlarmEvent } from '@/utils/alarmWs'
import { usePermissions } from '@/utils/permissions'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import KpiCard from '@/components/KpiCard.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
// KPI 卡设计素材（alarm/alerting）：背景图与左图标用 SVG（矢量、KB 级），右侧 3D 插画用 WebP
// 背景图不由 JS 传入，而是在 KpiCard 样式表内按 skin 类引用（见 skin-pending 等规则）
import kpiIconPending from '@/assets/img/alarm/alerting/left_icons_svg/01_pending_left_icon.svg'
import kpiIconProcessing from '@/assets/img/alarm/alerting/left_icons_svg/02_processing_left_icon.svg'
import kpiIconUnassigned from '@/assets/img/alarm/alerting/left_icons_svg/03_unassigned_left_icon.svg'
import kpiIconAll from '@/assets/img/alarm/alerting/left_icons_svg/04_all_left_icon.svg'
import kpiRightPending from '@/assets/img/alarm/alerting/01_pending_right_icon.webp'
import kpiRightProcessing from '@/assets/img/alarm/alerting/02_processing_right_icon.webp'
import kpiRightAccept from '@/assets/img/alarm/alerting/03_acceptance_right_icon.webp'
import kpiRightAll from '@/assets/img/alarm/alerting/04_all_right_icon.webp'
import {
  hydroTooltip,
  hydroGrid,
  hydroCategoryAxis,
  hydroValueAxis,
  hydroLineSeries,
  hydroDonutSeries,
} from '@/utils/chartTheme'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import HistoryView from './HistoryView.vue'
import TypesView from './TypesView.vue'
import RulesPanel from './components/RulesPanel.vue'
import IconTabs, { type IconTabItem } from '@/components/IconTabs.vue'

// 权限需先于 alarmTabs / 路由 Tab 初始化，避免 setup 阶段读取未初始化的 hasAnyPerm
const { hasPerm, hasAnyPerm, isManager, isMineScope } = usePermissions()

const alarmTabs = computed<IconTabItem[]>(() => {
  const tabs: IconTabItem[] = [
    { name: 'realtime', label: '实时告警', icon: 'ri:alarm-warning-line' },
    { name: 'history', label: '历史告警', icon: 'ri:history-line' },
  ]
  // 规则/类型配置属管理职能：无任何对应权限的角色（如操作员）不渲染该 Tab
  if (hasAnyPerm(['alarm:rule:create', 'alarm:rule:update', 'alarm:rule:delete'])) {
    tabs.push({ name: 'rules', label: '告警规则', icon: 'ri:settings-3-line' })
  }
  if (hasAnyPerm(['alarm:type:create', 'alarm:type:update', 'alarm:type:delete'])) {
    tabs.push({ name: 'types', label: '告警类型', icon: 'ri:price-tag-3-line' })
  }
  return tabs
})
import { useFocusRow } from '@/composables/useFocusRow'
import { useReloadPage } from '@/composables/useReloadPage'
import { formatDateTime } from '@/utils/time'
import { ALARM_LEVEL_TAG, ALARM_STATUS_LABEL, ALARM_STATUS_TAG } from '@/constants/status'
import { setAlertBadge } from '@/utils/titleAlert'

const router = useRouter()
const route = useRoute()
// 跨页跳转定位：工作台 → 实时告警（?focus=告警id）
const { focus, banner, rowClassName, locate, dismiss } = useFocusRow('id')
useReloadPage(() => load())

/* Tab 与地址栏 ?tab= 双向同步：支持 /alarm/history 深层链接、刷新保持与收藏 */
function tabFromRoute(): string {
  const t = String(route.query.tab || '')
  return t && alarmTabs.value.some((x) => x.name === t) ? t : 'realtime'
}
const activeTab = ref(tabFromRoute())
watch(
  () => route.query.tab,
  () => {
    const t = tabFromRoute()
    if (t !== activeTab.value) activeTab.value = t
  },
)
watch(activeTab, (n) => {
  const current = String(route.query.tab || '')
  if (current === (n === 'realtime' ? '' : n)) return
  const query = { ...route.query }
  if (n === 'realtime') delete query.tab
  else query.tab = n
  router.replace({ path: route.path, query })
})
/* 历史告警子组件引用：切回实时告警时重置其筛选 */
const historyRef = ref<InstanceType<typeof HistoryView> | null>(null)
const loading = ref(false)
const rows = ref<AlarmItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const stats = ref<AlarmStats | null>(null)
const flashing = ref(false)
const wsOk = ref(false)
let offWs: (() => void) | undefined
let flashTimer: number | undefined
let pollTimer: number | undefined
let audioCtx: AudioContext | null = null

const query = reactive<Record<string, any>>({
  keyword: undefined,
  alarm_level: undefined,
  alarm_status: undefined,
  unassigned_only: false,
  assigned_only: false,
  // 数据范围收口 §5.2.2：mine 数据范围（操作员）默认「指派给我」视角，可手动取消查看全部
  mine: false,
  time_range: undefined,
})
// 设备台账跳入：?keyword=设备名 直接带入关键字过滤
if (route.query.keyword) query.keyword = String(route.query.keyword)

const searchItems: SearchFormItem[] = [
  {
    key: 'keyword',
    label: '规则/设备',
    labelWidth: '80px',
    type: 'input',
    props: { clearable: true, placeholder: '请输入规则名称或设备名称' },
  },
  {
    key: 'alarm_level',
    label: '告警等级',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '全部等级',
      options: [
        { label: '一类', value: 1 },
        { label: '二类', value: 2 },
        { label: '三类', value: 3 },
      ],
    },
  },
  {
    key: 'alarm_status',
    label: '告警状态',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '全部状态',
      options: [
        { label: '全部数据', value: '__all' },
        { label: '未处理', value: 'pending' },
        { label: '处理中', value: 'processing' },
        { label: '待指派', value: '__unassigned' },
      ],
    },
  },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'rule_name', label: '告警名称', minWidth: 150, fixed: 'left', showOverflowTooltip: true },
  { prop: 'alarm_type_name', label: '类型', width: 110 },
  { prop: 'alarm_level', label: '等级', width: 90, align: 'center' },
  { prop: 'equipment_name', label: '设备', width: 120 },
  { prop: 'location_name', label: '位置', width: 110 },
  { prop: 'trigger_value', label: '触发值', minWidth: 120, showOverflowTooltip: true },
  { prop: 'alarm_time', label: '告警时间', width: 170, sortable: true },
  { prop: 'alarm_status', label: '状态', width: 100, align: 'center' },
  { prop: 'assignee_name', label: '指派', width: 100 },
  // 操作列宽按最多 3 个图标按钮（维修处理/关联工单/详情）紧凑适配，详情固定排最右
  { prop: '__actions', label: '操作', width: 150, fixed: 'right', align: 'right', disabled: true },
])

const kpis = computed(() => {
  const s = stats.value
  // 互斥划分（四卡相加 = 未闭环总数，无重叠）：
  //   待指派 = 未闭环且无关联工单（unassigned）；未处理 = pending 且已派工；处理中 = processing 且已派工；
  //   待验收必有工单，天然互斥。全部数据 = 四者之和 = 实时列表 realtime=true 的 total。
  const pendingAssigned = s?.pending_assigned ?? 0
  const processingAssigned = s?.processing_assigned ?? 0
  const unassigned = s?.unassigned ?? 0
  const pendingAccept = s?.pending_accept ?? 0
  const activeTotal = pendingAssigned + processingAssigned + unassigned + pendingAccept
  // 占比统一以"全部数据"为分母：全部数据恒 100%
  const pctOf = (n: number) => (activeTotal ? Math.round((n / activeTotal) * 1000) / 10 : 0)
  // 设计图主色与素材 SVG 内渐变色一一对应
  return [
    { label: '未处理', value: pendingAssigned, color: '#F35D74', icon: Warning, kpiKey: 'pending', status: 'pending', assigned: true, unassigned: false, variant: 'pending' as const, leftIcon: kpiIconPending, rightIcon: kpiRightPending, pct: pctOf(pendingAssigned) },
    { label: '处理中', value: processingAssigned, color: '#F5A12B', icon: Timer, kpiKey: 'processing', status: 'processing', assigned: true, unassigned: false, variant: 'processing' as const, leftIcon: kpiIconProcessing, rightIcon: kpiRightProcessing, pct: pctOf(processingAssigned) },
    { label: '待指派', value: unassigned, color: '#488AF5', icon: Clock, kpiKey: 'unassigned', status: '', assigned: false, unassigned: true, variant: 'unassigned' as const, leftIcon: kpiIconUnassigned, rightIcon: kpiRightAccept, pct: pctOf(unassigned) },
    { label: '全部数据', value: activeTotal, color: '#25C785', icon: CircleCheck, kpiKey: 'active', status: '', assigned: false, unassigned: false, variant: 'all' as const, leftIcon: kpiIconAll, rightIcon: kpiRightAll, pct: 100 },
  ]
})

/* 当前生效的 KPI 筛选卡标识（null 表示无筛选） */
const activeKpi = ref<string | null>(null)

/* KPI 卡点击：按对应条件筛选；再次点击同一卡则清除筛选恢复全量。
   互斥口径：未处理/处理中卡 = 对应状态且已派工（assigned_only）；
   待指派卡 = 未闭环且无关联工单（unassigned_only）。 */
function onKpiClick(card: { status?: string; unassigned?: boolean; assigned?: boolean; kpiKey: string }) {
  const { kpiKey: key } = card
  if (activeKpi.value === key) {
    activeKpi.value = null
    query.alarm_status = undefined
    query.unassigned_only = false
    query.assigned_only = false
  } else {
    activeKpi.value = key
    query.alarm_status = card.unassigned ? undefined : card.status || undefined
    query.unassigned_only = !!card.unassigned
    query.assigned_only = !!card.assigned
  }
  onSearch()
}

/* ===== 右侧统计栏：趋势图 / 等级分布 / 当前告警详情 ===== */
const LEVEL_NAMES: Record<number, string> = { 1: '一类', 2: '二类', 3: '三类' }
const LEVEL_COLORS: Record<number, string> = { 1: '#ef4444', 2: '#f59e0b', 3: '#3b82f6' }
const trendRange = ref('24h')
const trendRef = ref<HTMLDivElement | null>(null)
const distRef = ref<HTMLDivElement | null>(null)
let trendChart: echarts.ECharts | null = null
let distChart: echarts.ECharts | null = null
const trendData = ref<AlarmTrend24h | null>(null)

const levelDist = computed(() => {
  const map = new Map((stats.value?.by_level || []).map((x) => [x.level, x.count]))
  const total = [1, 2, 3].reduce((s, lv) => s + (map.get(lv) || 0), 0)
  return [1, 2, 3].map((lv) => {
    const count = map.get(lv) || 0
    return {
      level: lv,
      name: LEVEL_NAMES[lv],
      color: LEVEL_COLORS[lv],
      count,
      pct: total ? Math.round((count / total) * 1000) / 10 : 0,
    }
  })
})
const levelTotal = computed(() => levelDist.value.reduce((s, d) => s + d.count, 0))

/** 当前选中告警（默认第一行，点击行切换） */
const selectedId = ref<number | null>(null)
const selected = computed<AlarmItem | null>(() => {
  if (selectedId.value != null) {
    const hit = rows.value.find((r) => r.id === selectedId.value)
    if (hit) return hit
  }
  return rows.value[0] ?? null
})

function onRowClick(row: AlarmItem) {
  selectedId.value = row.id
  void revealDetailOnNarrow()
}

/** 焦点行高亮（跨页定位）+ 选中行高亮 */
function tableRowClass({ row }: { row: Record<string, unknown> }) {
  const cls = [rowClassName({ row })]
  if (selected.value && row.id === selected.value.id) cls.push('row-selected')
  return cls.join(' ')
}

/** 处理流程时间线：动作日志 + 当前状态节点（圆点按节点语义着色） */
const flowNodes = computed(() => {
  const a = selected.value
  if (!a) return []
  const nodes = (a.logs || []).map((log) => ({
    title: `${log.action}${log.operator_name ? ' · ' + log.operator_name : ''}`,
    detail: log.detail || '',
    time: log.created_at || '',
    tone: logTone(log.action),
  }))
  nodes.push({
    title: statusLabel(a.alarm_status),
    detail: a.alarm_status === 'pending' ? '正在处理…' : '',
    time: '',
    tone: statusTone(a.alarm_status),
  })
  return nodes
})

/* 时间线圆点配色（Element Plus type 色板） */
type FlowTone = 'primary' | 'success' | 'warning' | 'danger' | 'info'
function statusTone(s: string): FlowTone {
  const map: Record<string, FlowTone> = {
    pending: 'danger',
    processing: 'warning',
    pending_accept: 'primary',
    closed: 'success',
    rejected: 'info',
    reopened: 'warning',
  }
  return map[s] || 'primary'
}
function logTone(action: string): FlowTone {
  const a = action || ''
  if (/close|archiv|accept/.test(a)) return 'success' // 验收/归档/闭环
  if (/reject/.test(a)) return 'danger' // 驳回
  if (/handle|assign|dispatch|process|repair/.test(a)) return 'warning' // 派工/处理
  return 'primary' // 产生/确认等起始动作
}

function renderTrendChart() {
  if (!trendRef.value || !trendData.value) return
  if (!trendChart) trendChart = echarts.init(trendRef.value)
  const td = trendData.value
  trendChart.setOption({
    tooltip: { trigger: 'axis', ...hydroTooltip, axisPointer: { lineStyle: { color: 'rgba(6,182,212,.35)', type: 'dashed' } } },
    legend: {
      top: 0,
      right: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#5b6b82', fontSize: 11 },
    },
    grid: { ...hydroGrid, top: 28 },
    xAxis: hydroCategoryAxis(td.labels),
    yAxis: hydroValueAxis({ minInterval: 1 }),
    series: td.series.map((s) => hydroLineSeries(s.name, s.data, s.color)),
  })
}

function renderDistChart() {
  if (!distRef.value) return
  if (!distChart) distChart = echarts.init(distRef.value)
  const data = levelDist.value
    .filter((d) => d.count > 0)
    .map((d) => ({ value: d.count, name: d.name, itemStyle: { color: d.color } }))
  distChart.setOption({
    tooltip: { trigger: 'item', ...hydroTooltip },
    series: hydroDonutSeries(data),
  })
}

function renderSideCharts() {
  renderTrendChart()
  renderDistChart()
}

function onResize() {
  trendChart?.resize()
  distChart?.resize()
}

function levelLabel(lv: number) {
  return ({ 1: '一类', 2: '二类', 3: '三类' } as Record<number, string>)[lv] || String(lv)
}
// 等级 tag 色板统一引用 constants/status，禁止散点硬编码
function levelType(lv: number) {
  return ALARM_LEVEL_TAG[lv] || 'info'
}
function statusLabel(s: string) {
  return ALARM_STATUS_LABEL[s] || s
}
function statusTagType(s: string) {
  return ALARM_STATUS_TAG[s] || 'info'
}

/* ---- 状态展示细分：未关联维修工单的未闭环告警一律显示"待指派" ----
   与 KPI 待指派卡（unassigned = ACTIVE_STATUSES 且 repair_id 为空）及下拉筛选口径完全一致；
   已关联工单的按原始状态流转展示（处理中/待验收）。 */
interface StatusRow {
  alarm_status: string
  repair_id?: number | null
}
function displayStatusKey(row: StatusRow) {
  return row.repair_id ? row.alarm_status : 'unassigned'
}
function displayStatusLabel(row: StatusRow) {
  return row.repair_id ? statusLabel(row.alarm_status) : '待指派'
}
function displayStatusTag(row: StatusRow) {
  return row.repair_id ? statusTagType(row.alarm_status) : 'primary'
}

// ---- 按钮级权限（渲染显隐，后端接口同样强校验） ----
function canRepairHandle(row: AlarmItem) {
  // 维修处理：仅管理员/领导可操作（操作员只看详情）
  return (
    isManager.value &&
    !row.repair_id &&
    (row.alarm_status === 'pending' || row.alarm_status === 'processing') &&
    hasPerm('alarm:handle')
  )
}

// ---- 告警详情：右下角固定区域联动（只读，不分权限） ----
async function showDetail(row: AlarmItem) {
  // 拉取最新详情（含处理日志），回填行数据后联动右侧固定详情区
  selectedId.value = row.id
  try {
    const { data } = await getAlarm(row.id)
    const idx = rows.value.findIndex((r) => r.id === row.id)
    if (idx >= 0) rows.value[idx] = data.data
    else rows.value.unshift(data.data)
  } catch {
    /* 沿用列表行数据即可 */
  }
  void revealDetailOnNarrow()
}

/* 窄屏（≤1200px）：详情卡变为右侧滑出抽屉（DOM 原地复用，仅定位切换），
   行点击/详情按钮后打开抽屉；宽屏保持右侧常驻卡，行为不变 */
const isNarrow = ref(false)
// 卡片交错入场：挂载后置位，让 .dash-card 按 --i 依次浮现（不阻塞数据加载）
const pageReady = ref(false)
const detailOpen = ref(false)
let mqNarrow: MediaQueryList | undefined
function onMqChange(e: MediaQueryListEvent) {
  isNarrow.value = e.matches
  if (!isNarrow.value) detailOpen.value = false // 回到宽屏时复位抽屉态
}
const detailFlash = ref(false)
let detailFlashTimer: number | undefined
async function revealDetailOnNarrow() {
  if (!isNarrow.value) return
  detailOpen.value = true
  // 打开后对详情头部做一次高亮闪烁，提示已定位
  detailFlash.value = false
  await nextTick()
  detailFlash.value = true
  if (detailFlashTimer) window.clearTimeout(detailFlashTimer)
  detailFlashTimer = window.setTimeout(() => (detailFlash.value = false), 1800)
}
function closeDetailDrawer() {
  detailOpen.value = false
}

function beep() {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.connect(g)
    g.connect(audioCtx.destination)
    o.frequency.value = 880
    g.gain.value = 0.05
    o.start()
    o.stop(audioCtx.currentTime + 0.2)
  } catch {
    // ignore autoplay block
  }
}

function flash() {
  flashing.value = true
  if (flashTimer) window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    flashing.value = false
  }, 2500)
}

async function loadStats() {
  const { data } = await fetchAlarmStats({ mine: query.mine || undefined })
  stats.value = data.data
}

/* 请求序号守卫：静默刷新与手动查询并发时，仅最新请求可应用数据，避免旧响应覆盖新状态 */
let reqSeq = 0

async function load() {
  const seq = ++reqSeq
  loading.value = true
  try {
    const { data } = await listAlarms({
      page: page.value,
      page_size: pageSize.value,
      realtime: true,
      keyword: query.keyword || undefined,
      alarm_level: query.alarm_level,
      alarm_status: query.alarm_status || undefined,
      unassigned_only: query.unassigned_only || undefined,
      assigned_only: query.assigned_only || undefined,
      mine: query.mine || undefined,
      start_time: query.time_range?.[0] || undefined,
      end_time: query.time_range?.[1] || undefined,
    })
    if (seq !== reqSeq) return
    rows.value = data.data.items
    total.value = data.data.total
    await loadStats()
    // 右侧统计栏：24小时分等级趋势
    try {
      const tr = await fetchAlarmTrend24h()
      trendData.value = tr.data.data
    } catch {
      trendData.value = null
    }
    await nextTick()
    renderSideCharts()
    // 数据就绪后执行焦点行定位（无 focus 参数时内部直接返回）
    await locate()
  } finally {
    if (seq === reqSeq) loading.value = false
  }
}

/* ===== 静默增量刷新：轮询 / WS 事件触发 =====
   不置全局 loading、不整体替换列表，与本地按 id 差异合并：
   - 已有条目：就地合并字段（同 id 行对象引用不变，行 DOM 复用），状态变更原位生效
   - 新增条目：插入列表顶部并累计提示条计数；不重排/不移除已有项
   - 右侧统计：setOption 增量 patch，图表无闪烁
   任何失败静默吞掉，保留现有数据等下一轮轮询 */
const newAlertCount = ref(0)

/* 新告警角标：标签页标题前缀 + favicon 数字角标（切到其他窗口也能看见） */
watch(newAlertCount, (n) => setAlertBadge(n))

/* 点击提示条：跳回第 1 页按当前筛选重新查询（主动查看，带 loading） */
function viewNewAlerts() {
  newAlertCount.value = 0
  page.value = 1
  load()
}

async function silentRefresh() {
  const seq = ++reqSeq
  try {
    const { data } = await listAlarms({
      page: page.value,
      page_size: pageSize.value,
      realtime: true,
      keyword: query.keyword || undefined,
      alarm_level: query.alarm_level,
      alarm_status: query.alarm_status || undefined,
      unassigned_only: query.unassigned_only || undefined,
      assigned_only: query.assigned_only || undefined,
      mine: query.mine || undefined,
      start_time: query.time_range?.[0] || undefined,
      end_time: query.time_range?.[1] || undefined,
    })
    if (seq !== reqSeq) return
    const incoming = data.data.items as AlarmItem[]
    const prevTotal = total.value
    total.value = data.data.total

    const localMap = new Map(rows.value.map((r) => [r.id, r]))
    // 已有条目：就地合并字段（状态流转 pending→processing→…时该行标签原位更新）
    for (const item of incoming) {
      const local = localMap.get(item.id)
      if (local) Object.assign(local, item)
    }
    // 新增条目：接口按告警时间倒序，插入顶部后顺序与重新查询一致
    const added = incoming.filter((r) => !localMap.has(r.id))
    if (page.value === 1) {
      if (added.length > 20) {
        // 短时间爆发式新增：退化为整页刷新，避免本地列表无限膨胀
        await load()
        return
      }
      if (added.length) rows.value = [...added, ...rows.value]
      newAlertCount.value += added.length
    } else if (data.data.total > prevTotal) {
      // 非第 1 页：不插入（保持分页语义），仅累计提示
      newAlertCount.value += data.data.total - prevTotal
    }

    // 右侧统计静默同步
    await loadStats()
    try {
      const tr = await fetchAlarmTrend24h()
      if (seq === reqSeq) trendData.value = tr.data.data
    } catch {
      /* 保留上次趋势数据 */
    }
    await nextTick()
    if (seq === reqSeq) renderSideCharts()
  } catch {
    /* 静默失败：保留现有数据 */
  }
}

// 维修处理：一键生成维修工单。完成后不强制跳走，让值班员自行选择「继续下一条」或「查看工单」
async function onRepairHandle(row: AlarmItem) {
  const { data } = await repairHandle(row.id)
  const orderNo = data.data?.repair_order_no
  // 就地合并刷新：保留当前页码/筛选/滚动位置（旧的 load() 会整表替换，容易失去当前位置）
  await silentRefresh()

  ElMessageBox.confirm(
    `已生成维修工单${orderNo ? ' ' + orderNo : ''}。是否继续处理下一条待指派告警？`,
    '处理完成',
    {
      confirmButtonText: '继续下一条',
      cancelButtonText: '查看工单',
      distinguishCancelAndClose: true,
      closeOnClickModal: false,
      type: 'success',
    },
  )
    .then(() => focusNextPending(row.id))
    .catch((action: string) => {
      // cancel = 点了「查看工单」；close = 关闭弹窗 → 留在当前列表位置
      if (action === 'cancel' && orderNo) {
        router.push({ path: '/repair/list', query: { focus: orderNo } })
      }
    })
}

/** 处理完自动落到下一条待处理告警：优先当前行之后，找不到再从头回绕 */
function focusNextPending(fromId: number) {
  const start = rows.value.findIndex((r) => r.id === fromId)
  const after = start >= 0 ? rows.value.slice(start + 1) : rows.value
  const before = start > 0 ? rows.value.slice(0, start) : []
  const next = after.find((r) => canRepairHandle(r)) ?? before.find((r) => canRepairHandle(r))
  if (!next) {
    ElMessage.info('当前列表中已无待处理告警')
    return
  }
  selectedId.value = next.id
  void revealDetailOnNarrow()
  void nextTick().then(() => scrollToAlarmRow(next.id))
}

/** 滚到当前页表格中指定告警行（不重排列表，只移动视野） */
function scrollToAlarmRow(id: number) {
  const idx = rows.value.findIndex((r) => r.id === id)
  if (idx < 0) return
  const tbody = document.querySelector('.rt-main .el-table__body-wrapper tbody')
  const tr = tbody?.children[idx] as HTMLElement | undefined
  tr?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

// 跳转工单列表并定位到关联工单
function goRepairOrder(row: AlarmItem) {
  if (!row.repair_order_no) return
  router.push({ path: '/repair/list', query: { focus: row.repair_order_no } })
}

async function onSearch() {
  newAlertCount.value = 0 // 主动查询视为已读最新数据
  page.value = 1

  // 特殊选项转换：待指派 → unassigned_only=true + alarm_status=undefined；全部数据 → 两个开关均复位
  if (query.alarm_status === '__unassigned') {
    query.unassigned_only = true
    query.assigned_only = false
    query.alarm_status = undefined
  } else if (query.alarm_status === '__all') {
    query.unassigned_only = false
    query.assigned_only = false
    query.alarm_status = undefined
  }

  load()
}

/* 搜索栏重置：清除所有筛选条件（含 KPI 卡选中态） */
function onReset() {
  activeKpi.value = null
  query.alarm_status = undefined
  query.unassigned_only = false
  query.assigned_only = false
  onSearch()
}

// 是否存在激活的筛选条件
const hasActiveFilter = computed(
  () =>
    !!query.keyword ||
    (query.alarm_level !== undefined && query.alarm_level !== null && query.alarm_level !== '') ||
    !!query.alarm_status ||
    query.unassigned_only === true ||
    query.assigned_only === true ||
    !!(query.time_range && query.time_range.length === 2),
)
// 筛选激活但结果为空：展示清空引导，替换表格默认空态
const showFilterEmpty = computed(
  () => hasActiveFilter.value && !loading.value && rows.value.length === 0,
)
// 清除筛选条件并重新查询
function onClearFilter() {
  query.keyword = undefined
  query.alarm_level = undefined
  query.alarm_status = undefined
  query.time_range = undefined
  query.unassigned_only = false
  query.assigned_only = false
  activeKpi.value = null
  onSearch()
}

/* Tab 切换：回到目标页时重置筛选，展示默认全量数据 */
function onTabChange(name: string | number) {
  if (name === 'realtime') {
    // 重置实时告警筛选
    query.keyword = undefined
    query.alarm_level = undefined
    query.alarm_status = undefined
    query.time_range = undefined
    query.unassigned_only = false
    query.assigned_only = false
    activeKpi.value = null
    onSearch()
  } else if (name === 'history') {
    // 重置历史告警筛选（子组件已挂载时）
    historyRef.value?.resetFilter?.()
  }
}
function onPageChange(p: number) {
  page.value = p
  load()
}
function onPageSizeChange(size: number) {
  pageSize.value = size
  load()
}

onMounted(async () => {
  pageReady.value = true
  await load()
  window.addEventListener('resize', onResize)
  // 窄屏侦测：详情卡切换抽屉形态
  mqNarrow = window.matchMedia('(max-width: 1600px), (max-height: 1000px)')
  isNarrow.value = mqNarrow.matches
  mqNarrow.addEventListener('change', onMqChange)
  connectAlarmWs()
  offWs = onAlarmEvent((event) => {
    if (event === 'connected') {
      wsOk.value = true
      return
    }
    if (event === 'alarm.created') {
      // 新告警：声音 + 顶部闪烁 + 静默增量刷新（提示条浮出，不打断列表）
      beep()
      flash()
      silentRefresh()
    } else if (event === 'alarm.updated') {
      silentRefresh()
    }
  })
  // 兜底轮询：静默增量刷新，不闪烁、不打断滚动/选中/分页
  pollTimer = window.setInterval(silentRefresh, 10000)
})

onUnmounted(() => {
  setAlertBadge(0) // 离开告警页清除标签页角标
  offWs?.()
  disconnectAlarmWs()
  mqNarrow?.removeEventListener('change', onMqChange)
  if (pollTimer) window.clearInterval(pollTimer)
  if (flashTimer) window.clearTimeout(flashTimer)
  if (detailFlashTimer) window.clearTimeout(detailFlashTimer)
  window.removeEventListener('resize', onResize)
  trendChart?.dispose()
  distChart?.dispose()
})
</script>

<style scoped>
/* 高度链：根 .page-fill 接入（全局类），el-tabs 链由 IconTabs 组件内置，
   本页只需让 .rt-grid 吃掉 pane 剩余高度 → .rt-main → .table-section(已有 flex:1) */

/* ===== 实时告警左右两栏 ===== */
.rt-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
}
.rt-main {
  min-width: 0;
  /* 拉伸占满行高，让表格卡 flex:1 生效（分页贴卡片底部） */
  display: flex;
  flex-direction: column;
}

/* ===== KPI 磨砂面板：与维修工单页同框架 ===== */
.kpi-panel {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

/* ===== 新增告警提示条：静默刷新检测到新告警时浮现（磨砂同框架，警示红浅底） ===== */
.new-alert-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 9px 14px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255, 235, 235, 0.9) 0%, rgba(255, 224, 224, 0.82) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: 1px solid rgba(243, 93, 116, 0.3);
  box-shadow: 0 6px 24px rgba(243, 93, 116, 0.12);
  color: #b42334;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.new-alert-bar .na-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(243, 93, 116, 0.14);
  color: #e0445c;
  font-size: 14px;
}
.new-alert-bar .na-text b {
  margin: 0 2px;
  font-size: 15px;
  font-family: Arial, 'PingFang SC', sans-serif;
  font-variant-numeric: tabular-nums;
}

/* 搜索条：白色卡改磨砂（移除页面白色背景层） */
:deep(.pro-search-bar) {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none;
  border-radius: 14px;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}

/* ===== 卡片标题栏：图标徽章 + 标题 + 科技线条 + 右侧状态标签（与维修工单页一致） ===== */
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 14px;
  margin-bottom: 14px;
}
.head-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 16px;
  color: #2f7cf6;
  background: linear-gradient(135deg, #e3eefe, #eef4ff);
  border: 1px solid #d7e6fd;
}
.head-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2d3d;
  letter-spacing: 0.02em;
}
.head-deco {
  flex: 1 1 auto;
  height: 20px;
  background:
    linear-gradient(90deg, transparent 62%, rgba(47, 124, 246, 0.55) 82%, rgba(47, 124, 246, 0) 100%) right 8px / 100% 1px no-repeat,
    linear-gradient(90deg, transparent 70%, rgba(47, 124, 246, 0.35) 88%, rgba(47, 124, 246, 0) 100%) right 0 / 100% 1px no-repeat;
  opacity: 0.8;
  pointer-events: none;
}
/* 「只看指派给我的」勾选：卡头右侧，操作员默认勾选 */
.mine-check {
  flex-shrink: 0;
  margin-right: 2px;
}
.head-right {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  margin-left: 18px;
}

/* ===== 表格区：磨砂通栏（与维修工单页一致，压过 [data-box-mode] 全局白卡规则） ===== */
.table-section {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}
.table-section .table-card {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%) !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none !important;
  border-radius: 14px !important;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08) !important;
}
.ws-pulse {
  margin-right: 6px;
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.9);
}
.ws-pulse::after {
  border-color: #10b981;
}

/* ===== 右侧统计栏 ===== */
.rt-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.side-card {
  padding: 14px 16px;
  /* 磨砂底（与维修工单页同质感），替代原白色背景层 */
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none;
  border-radius: 14px;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}
/* 当前告警详情：对齐维修工单详情卡形制；未选告警时中性，选中后按级别变色（一/二/三类 = 红/橙/蓝） */
.detail-card {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  /* 固定区域：高度不超过屏幕 80%，内容区滚动 */
  max-height: 80vh;
  min-height: 0;
  border: 1px solid var(--lv-bd, rgba(55, 135, 220, 0.18));
  box-shadow: 0 6px 24px var(--lv-shadow, rgba(55, 135, 220, 0.08));
  transition:
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}
/* 一类：红 */
.detail-card.lv-1 {
  --lv-bd: rgba(240, 61, 69, 0.5);
  --lv-shadow: rgba(240, 61, 69, 0.16);
}
/* 二类：橙 */
.detail-card.lv-2 {
  --lv-bd: rgba(245, 154, 7, 0.5);
  --lv-shadow: rgba(245, 154, 7, 0.16);
}
/* 三类：蓝 */
.detail-card.lv-3 {
  --lv-bd: rgba(23, 107, 255, 0.5);
  --lv-shadow: rgba(23, 107, 255, 0.16);
}
/* 详情卡内容区：标题栏固定，内容超出整体滚动 */
.cur-scroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.cur-scroll .cur-flow {
  flex: 0 0 auto;
}
.side-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--art-gray-900, #1b2a3d);
  font-size: 15px;
  font-weight: 700;
}
.side-head .bar {
  /* 标题竖条随全局统一移除 */
  display: none;
}
.trend-chart {
  width: 100%;
  height: 200px;
}
.dist-body {
  display: flex;
  align-items: center;
  gap: 14px;
}
.dist-chart-wrap {
  position: relative;
  flex-shrink: 0;
  width: 130px;
  height: 130px;
}
.dist-chart {
  width: 100%;
  height: 100%;
}
.dist-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--art-gray-600, #6b7a90);
  font-size: 12px;
  pointer-events: none;
}
.dist-center b {
  font-size: 14px;
}
.dist-legend {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.legend-item .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.lg-name {
  color: var(--art-gray-600, #6b7a90);
}
.lg-num {
  margin-left: auto;
  color: var(--art-gray-900, #1b2a3d);
  font-weight: 700;
}
.lg-pct {
  width: 46px;
  color: var(--art-gray-500, #8a97a8);
  text-align: right;
}
/* ===== 告警详情卡：头部（徽章+标题/副标题+级别胶囊），形制对齐维修工单详情 ===== */
.ad-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.ad-badge {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  font-size: 18px;
  color: var(--lv-fg, #176bff);
  background: var(--lv-soft, #e8f1ff);
  border: 1px solid var(--lv-bd-soft, #c9deff);
}
.ad-titles {
  flex: 1;
  min-width: 0;
}
.ad-title {
  margin: 0;
  color: var(--art-gray-900, #1b2a3d);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
}
.ad-sub {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--art-gray-500, #8a97a8);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 级别胶囊（一/二/三类 = 红/橙/蓝） */
/* 告警等级标签：去除类别前的圆点 */
.lv-tag::before {
  display: none !important;
}

/* 处理状态：设计图指定配色（未处理 / 处理中）
   选择器带 .pro-table .el-table 前缀，特异性高于全局 el-tag--danger/warning 皮肤 */
.st-tag.st-pending::before {
  background: #7fa6c9 !important;
}
.st-tag.st-processing::before {
  background: #c98a4a !important;
}
.pro-table .el-table .st-tag.st-pending {
  color: #4e6e8e !important;
  background: #e7f0f8 !important;
  border-color: #bdd3e7 !important;
}
.pro-table .el-table .st-tag.st-processing {
  color: #8a5a2b !important;
  background: #f8e7d6 !important;
  border-color: #e9c7a3 !important;
}
/* 待指派：未关联工单的未闭环告警（KPI 卡同款蓝 #488AF5 系） */
.st-tag.st-unassigned::before {
  background: #488af5 !important;
}
.pro-table .el-table .st-tag.st-unassigned {
  color: #2e6fd6 !important;
  background: #e9f1fe !important;
  border-color: #c7dcfb !important;
}

.ad-level-pill {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--lv-bd-soft, #c9deff);
  background: var(--lv-soft, #e8f1ff);
  color: var(--lv-fg, #176bff);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.detail-card.lv-1 {
  --lv-fg: #f03d45;
  --lv-soft: #ffecee;
  --lv-bd-soft: #ffd5d9;
}
.detail-card.lv-2 {
  --lv-fg: #f59a07;
  --lv-soft: #fff2db;
  --lv-bd-soft: #ffe1af;
}
.detail-card.lv-3 {
  --lv-fg: #176bff;
  --lv-soft: #e8f1ff;
  --lv-bd-soft: #c9deff;
}

/* ===== 信息行：左图标标签 + 右值（维修工单 info-row 形制） ===== */
.ad-info {
  display: flex;
  flex-direction: column;
}
.ad-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed rgba(148, 173, 205, 0.28);
  font-size: 13px;
  line-height: 1.6;
}
.ad-row:last-child {
  border-bottom: none;
}
/* 顶部对齐行：标签保持垂直居中，值贴顶（多行值场景） */
.ad-row--top {
  align-items: stretch;
}
.ad-row--top .ad-label {
  align-self: center;
}
.ad-row--top .ad-value {
  align-self: flex-start;
}
.ad-label {
  display: flex;
  flex: 0 0 78px;
  align-items: center;
  gap: 6px;
  color: #5a6b83;
}
.ad-label .lab-icon {
  font-size: 13px;
  color: #5f8dc9;
}
.ad-value {
  flex: 1;
  min-width: 0;
  color: var(--art-gray-800, #33415a);
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
}
.ad-detail {
  font-weight: 500;
  line-height: 1.7;
}
/* 告警状态胶囊（与维修 status-pill 同形制） */
.ad-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--st-bd, #d9e1eb);
  background: var(--st-bg, #edf1f6);
  color: var(--st-fg, #78879c);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
/* 详情胶囊配色与列表 .st-tag 状态色一一对齐（设计稿指定色板） */
.ad-status-pill.st-pending {
  --st-bg: #e7f0f8;
  --st-fg: #4e6e8e;
  --st-bd: #bdd3e7;
  --st-dot: #7fa6c9;
}
.ad-status-pill.st-processing {
  --st-bg: #f8e7d6;
  --st-fg: #8a5a2b;
  --st-bd: #e9c7a3;
  --st-dot: #c98a4a;
}
/* 待验收：列表用 el-tag primary（蓝），胶囊同步蓝色系 */
.ad-status-pill.st-pending_accept {
  --st-bg: #e8f1ff;
  --st-fg: #176bff;
  --st-bd: #c9deff;
}
/* 待指派：未关联工单的未闭环告警（KPI 卡同款蓝系） */
.ad-status-pill.st-unassigned {
  --st-bg: #e9f1fe;
  --st-fg: #2e6fd6;
  --st-bd: #c7dcfb;
  --st-dot: #488af5;
}
.ad-status-pill.st-closed {
  --st-bg: #e7f8ed;
  --st-fg: #16a34a;
  --st-bd: #c3f0d4;
}
.ad-status-pill.st-rejected {
  --st-bg: #edf1f6;
  --st-fg: #78879c;
  --st-bd: #d9e1eb;
}
.ad-status-pill.st-reopened {
  --st-bg: #e8f1fe;
  --st-fg: #2f6bd8;
  --st-bd: #c6dbfb;
}
.cur-link {
  height: auto;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  vertical-align: baseline;
}
.cur-flow {
  flex: 1 1 auto;
  /* 允许收缩到内容以下：嵌套滚动容器必需，否则 min-height:auto 撑破外层滚动约束 */
  min-height: 0;
  padding-top: 10px;
  margin-top: 6px;
  overflow-y: auto;
  border-top: 1px dashed var(--art-card-border, #e5eaf3);
}
.cur-flow .flow-title {
  margin-bottom: 8px;
  color: var(--art-gray-800, #33415a);
  font-size: 13px;
  font-weight: 700;
}

/* 表格选中行（右侧详情联动） */
.row-selected {
  background: rgb(37 99 235 / 8%) !important;
}
.filter-empty {
  padding: 24px 0;
}
.flash {
  animation: flashBg 0.6s ease-in-out 4;
}
@keyframes flashBg {
  0%,
  100% {
    background: transparent;
  }
  50% {
    background: rgba(245, 108, 108, 0.12);
  }
}
.log-detail {
  color: var(--art-gray-600);
  font-size: 12px;
}

/* ===== 响应式：KPI 降列只随宽度；详情卡在宽 <1600px 或高 <1000px 时切换为滑出抽屉 ===== */
/* 详情抽屉触发：宽 <1600px 或高 <1000px。
   布局约定：详情卡定位（fixed 抽屉）由本块负责；.rt-grid 在 >1024px 保持
   列表区（搜索/表格）+ 右侧统计/分布卡双栏，≤1024px 堆叠为单栏（见文件末尾媒体查询） */
@media (max-width: 1600px), (max-height: 1000px) {
  /* 小屏抽屉形态：DOM 原地复用（样式与宽屏常驻卡完全一致），仅定位从文档流切换为 fixed 右侧滑入；
     高度 = 浏览器视口高度（100dvh 随地址栏/窗口缩放实时变化），
     由 Teleport 到 body 保证 top:0 相对真实视口，长内容在 .cur-scroll 内部滚动 */
  .detail-card {
    position: fixed;
    top: 0;
    right: 0;
    width: min(420px, 92vw);
    height: 100vh;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    border-radius: 0;
    z-index: 2100;
    display: flex;
    flex-direction: column;
    transform: translateX(105%);
    transition: transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
    box-shadow: -16px 0 48px rgb(15 32 55 / 0.22);
  }
  .detail-card.drawer-open {
    transform: translateX(0);
  }
  .detail-card .cur-scroll {
    flex: 1;
    min-height: 0;
  }
  /* 遮罩：与抽屉同质感的浅磨砂（点击关闭） */
  .detail-mask {
    position: fixed;
    inset: 0;
    z-index: 2090;
    background: rgba(226, 239, 255, 0.45);
    -webkit-backdrop-filter: blur(6px) saturate(1.2);
    backdrop-filter: blur(6px) saturate(1.2);
  }
  .drawer-mask-enter-active,
  .drawer-mask-leave-active {
    transition: opacity 0.28s ease;
  }
  .drawer-mask-enter-from,
  .drawer-mask-leave-to {
    opacity: 0;
  }
  /* 抽屉头部关闭按钮（宽屏常驻卡不渲染） */
  .drawer-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin-left: 8px;
    border: none;
    border-radius: 8px;
    background: rgb(38 54 77 / 0.06);
    color: var(--art-gray-600);
    font-size: 17px;
    cursor: pointer;
    flex: none;
  }
  .drawer-close:hover {
    background: rgb(38 54 77 / 0.12);
    color: var(--art-gray-900);
  }
  .detail-card.detail-flash {
    animation: ad-flash 1.6s ease;
  }
  @keyframes ad-flash {
    0%,
    55% {
      outline: 3px solid rgba(59, 130, 246, 0.55);
      outline-offset: 2px;
    }
    100% {
      outline: 3px solid transparent;
      outline-offset: 2px;
    }
  }
}
/* KPI 降列只随宽度变化：矮屏（高 <1000px）的宽屏不应触发（KPI 行本就横向通栏） */
@media only screen and (max-width: 1024px) {
  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* 左右两栏堆叠为单栏：统计/分布卡移到表格下方，自然高度随内容撑开 */
  .rt-grid {
    grid-template-columns: minmax(0, 1fr);
    flex: 0 0 auto;
  }
  /* 高度链让位给整页滚动：pane 内容由 hidden 改为纵向滚动（表格不再内部定高） */
  .alarm-tabs :deep(.el-tabs__content) {
    overflow-y: auto;
  }
}
@media only screen and (max-width: 768px) {
  .kpi-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<!-- 非 scoped：page-content 是本页祖先元素，scoped 无法命中；
     仅在告警页移除 border-mode 给 .page-content 的 1px 描边，其他页面不受影响 -->
<style>
html[data-box-mode] .page-content:has(.mod-alarm) {
  border: none !important;
}
</style>

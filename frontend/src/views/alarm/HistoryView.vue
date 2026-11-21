<template>
  <div class="page mod-alarm">
    <!-- KPI 汇总卡：磨砂面板包裹（与维修工单页同框架），卡片为设计图样式 -->
    <div class="kpi-panel">
      <div class="kpi-row">
        <KpiCard
          v-for="c in kpis"
          :key="c.label"
          variant="alarm"
          :skin="c.variant"
          :color="c.color"
          :label="c.label"
          :value="c.value"
          unit="条"
          :percent="c.pct"
          :left-icon="c.leftIcon"
          :right-icon="c.rightIcon"
          clickable
          :active="activeKpi === c.label"
          :breathing="activeKpi === c.label"
          @click="onKpiClick(c)"
        />
      </div>
    </div>

    <!-- 筛选区 -->
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="onReset"
    />
    <!-- 从设备台账跳入时的设备过滤提示（可清除） -->
    <div v-if="eqFilterId" class="eq-filter-bar">
      <ArtSvgIcon icon="ri:cpu-line" />
      <span>已按设备过滤：{{ eqFilterName || `#${eqFilterId}` }}</span>
      <el-button text type="primary" size="small" @click="clearEqFilter">清除过滤</el-button>
    </div>

    <!-- 表格卡片：磨砂通栏（与维修工单页同框架） -->
    <div class="table-section">
      <el-card shadow="never" class="art-table-card table-card">
        <div class="card-head">
          <span class="head-badge">
            <ArtSvgIcon icon="ri:history-line" />
          </span>
          <span class="head-title">历史告警</span>
          <span class="head-deco" aria-hidden />
        </div>

        <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="历史告警"
        layout="export,refresh"
        @refresh="load"
      />

      <ProTable
        :data="rows"
        :loading="loading"
        :columns="tableColumns"
        row-key="id"
        :row-class-name="rowClassName"
        :pagination="{ current: page, size: pageSize, total }"
        @page-change="onPageChange"
        @size-change="onSizeChange"
      >
        <template #alarm_time="{ row }">
          {{ formatDateTime(row.alarm_time) }}
        </template>
        <template #alarm_level="{ row }">
          <el-tag class="lv-tag" :type="levelType(row.alarm_level)" size="small" effect="light">
            {{ levelLabel(row.alarm_level) }}
          </el-tag>
        </template>
        <template #alarm_status="{ row }">
          <el-tag
            class="st-tag"
            :class="`st-${row.alarm_status}`"
            :type="statusTagType(row.alarm_status)"
            effect="light"
          >
            {{ statusLabel(row.alarm_status) }}
          </el-tag>
        </template>
        <template #duration_sec="{ row }">
          {{ formatDuration(row.duration_sec) }}
        </template>
        <template #end_time="{ row }">
          {{ formatDateTime(row.end_time) }}
        </template>
        <template #__actions="{ row }">
          <div class="action-cell">
            <!-- 关联工单：重新处理中的告警跳转到其绑定的维修工单（高亮定位） -->
            <ArtButtonTable
              v-if="canOpenLinkedOrder(row)"
              icon="ri:file-list-3-line"
              icon-class="bg-primary/12 text-primary"
              title="关联工单"
              label="关联工单"
              @click="onOpenLinkedOrder(row)"
            />
            <!-- 恢复关联：已驳回告警重新生成维修工单（新工单，旧驳回单留档），仅管理员可见 -->
            <ArtButtonTable
              v-if="canRepairHandle(row)"
              icon="ri:links-line"
              icon-class="bg-warning/12 text-warning"
              title="恢复关联"
              label="恢复关联"
              @click="onReRepair(row)"
            />
            <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
            <ArtButtonTable type="view" title="详情" label="详情" @click="openDetail(row)" />
          </div>
        </template>
      </ProTable>
      </el-card>
    </div>

    <!-- 告警详情抽屉（统一 ProDetailDrawer 形制；徽章/胶囊按一/二/三类级别配色） -->
    <ProDetailDrawer
      v-model="detailVisible"
      title="告警详情"
      subtitle="查看历史告警的触发详情与处理日志"
      icon="ri:alarm-warning-line"
      :badge-class="detail ? `lv-${detail.alarm_level}` : ''"
      :border-level="detail?.alarm_level"
      body-fill
    >
      <template #title-extra>
        <span v-if="detail" class="dd-pill" :class="levelPill(detail.alarm_level)">
          {{ levelLabel(detail.alarm_level) }}
        </span>
      </template>

      <template v-if="detail">
        <ProDetailSection flush>
          <ProDetailRow icon="ri:alarm-warning-line" label="告警名称" :value="detail.rule_name" />
          <ProDetailRow icon="ri:tools-line" label="设备/测点" :value="detail.equipment_name" />
          <ProDetailRow icon="ri:map-pin-line" label="泵站位置" :value="detail.location_name || '—'" />
          <ProDetailRow icon="ri:dashboard-line" label="触发值" :value="detail.trigger_value || '—'" mono />
          <ProDetailRow icon="ri:pulse-line" label="处理状态">
            <span class="dd-pill" :class="statusPill(detail.alarm_status)">
              {{ statusLabel(detail.alarm_status) }}
            </span>
          </ProDetailRow>
          <!-- 驳回理由：仅已驳回告警展示（工单审批驳回时由工单同步写入） -->
          <ProDetailRow v-if="detail.reject_reason" icon="ri:close-circle-line" label="驳回理由" top>
            <div class="dd-desc">{{ detail.reject_reason }}</div>
          </ProDetailRow>
          <ProDetailRow icon="ri:file-text-line" label="详情" top>
            <div v-if="detail.trigger_detail" class="dd-desc">{{ detail.trigger_detail }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">暂无详情</span>
            </div>
          </ProDetailRow>
        </ProDetailSection>

        <!-- 处理日志：彩色时间线（FlowTimeline 复用 logMeta 配色映射） -->
        <ProDetailSection icon="ri:time-line" title="处理日志" :count="`${(detail.logs || []).length} 条记录`">
          <FlowTimeline :nodes="timelineNodes" empty-text="暂无处理日志" />
        </ProDetailSection>
      </template>
    </ProDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import KpiCard from '@/components/KpiCard.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import FlowTimeline from '@/components/FlowTimeline.vue'
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'
import {
  fetchAlarmHistorySummary,
  getAlarm,
  listAlarms,
  repairHandle,
  type AlarmHistorySummary,
  type AlarmItem,
} from '@/api/alarm'
import { ALARM_LEVEL_TAG, ALARM_STATUS_LABEL, ALARM_STATUS_TAG, ALARM_STATUS_PILL, ALARM_LEVEL_PILL } from '@/constants/status'
import { formatDateTime } from '@/utils/time'
// 历史告警 KPI 卡素材：背景图在 KpiCard 样式表内按 skin 引用，
// 此处仅引入左侧圆形图标与右侧 3D 插画（一一对应一/二/三类与已驳回）
import kpiLeftLevel1 from '@/assets/img/alarm/history/left_png/01_level1_bell.svg'
import kpiLeftLevel2 from '@/assets/img/alarm/history/left_png/02_level2_gear.svg'
import kpiLeftLevel3 from '@/assets/img/alarm/history/left_png/03_level3_document.svg'
import kpiLeftRejected from '@/assets/img/alarm/history/left_png/04_rejected_ban.svg'
import kpiRightLevel1 from '@/assets/img/alarm/history/right_webp/01_level1_red.webp'
import kpiRightLevel2 from '@/assets/img/alarm/history/right_webp/02_level2_orange.webp'
import kpiRightLevel3 from '@/assets/img/alarm/history/right_webp/03_level3_blue.webp'
import kpiRightRejected from '@/assets/img/alarm/history/right_webp/04_rejected_purple.webp'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

/* 告警处理日志 action → 彩色流程节点映射（与档案管理运维记录时间轴同色系） */
type FlowColor = 'red' | 'blue' | 'orange' | 'purple' | 'green'
const ALARM_LOG_META: Record<string, { name: string; icon: string; color: FlowColor }> = {
  created: { name: '告警触发', icon: 'ri:alarm-warning-line', color: 'red' },
  auto_repair: { name: '自动生成工单', icon: 'ri:file-add-line', color: 'blue' },
  repair_handle: { name: '生成工单', icon: 'ri:file-add-line', color: 'blue' },
  apply_repair: { name: '申请维修', icon: 'ri:user-settings-line', color: 'orange' },
  repair_processing: { name: '维修处理中', icon: 'ri:tools-line', color: 'purple' },
  complete_repair: { name: '维修完成', icon: 'ri:tools-line', color: 'purple' },
  repair_pending_accept: { name: '待验收', icon: 'ri:time-line', color: 'orange' },
  accept_pass: { name: '验收通过', icon: 'ri:checkbox-circle-line', color: 'green' },
  accept_reject: { name: '验收驳回', icon: 'ri:close-circle-line', color: 'red' },
  repair_rejected: { name: '工单驳回', icon: 'ri:close-circle-line', color: 'red' },
  repair_archived: { name: '工单归档', icon: 'ri:archive-line', color: 'blue' },
  handle: { name: '手动处理', icon: 'ri:hand-heart-line', color: 'orange' },
}
/** 未知 action 兜底：展示原始 action 文本 */
function logMeta(action: string) {
  return ALARM_LOG_META[action] || { name: action, icon: 'ri:record-circle-line', color: 'blue' }
}
import { usePermissions } from '@/utils/permissions'

const router = useRouter()
const route = useRoute()
/** 设备台账跳入的设备过滤（equipment_id 查询参数） */
const eqFilterId = computed(() => Number(route.query.equipment_id) || 0)
const eqFilterName = computed(() => String(route.query.equipment_name || ''))
function clearEqFilter() {
  const q = { ...route.query }
  delete q.equipment_id
  delete q.equipment_name
  router.replace({ path: route.path, query: q })
}
watch(
  () => route.query.equipment_id,
  () => {
    page.value = 1
    void load()
  },
)
const { hasPerm } = usePermissions()

/** 恢复关联入口：仅「已驳回且未绑定工单」的告警，且持 alarm:handle 权限 */
function canRepairHandle(row: AlarmItem) {
  return !row.repair_id && row.alarm_status === 'rejected' && hasPerm('alarm:handle')
}

/** 关联工单入口：重新处理中且已绑定工单的告警（不限角色，均可查看工单进度） */
function canOpenLinkedOrder(row: AlarmItem) {
  return row.alarm_status === 'reopened' && !!row.repair_id
}

/** 跳转维修工单页并按工单号高亮定位关联工单 */
function onOpenLinkedOrder(row: AlarmItem) {
  if (!row.repair_order_no) {
    ElMessage.warning('未获取到关联工单号，请刷新后重试')
    return
  }
  router.push({ path: '/repair/list', query: { focus: row.repair_order_no } })
}

/** 恢复关联：重新生成新工单（驳回的工单保留为历史档案），成功后跳转工单页；
 *  异常场景（如已被其他操作绑定工单）由服务端 400 拦截，此处弹窗展示 */
async function onReRepair(row: AlarmItem) {
  try {
    const { data } = await repairHandle(row.id)
    const orderNo = data.data?.repair_order_no
    ElMessage.success(`已恢复关联，生成维修工单${orderNo ? ' ' + orderNo : ''}，正在跳转`)
    await load()
    if (orderNo) router.push({ path: '/repair/list', query: { focus: orderNo } })
  } catch (e: any) {
    const message = e?.response?.data?.message || '当前告警不可恢复关联'
    await ElMessageBox.alert(message, '无法恢复关联', {
      confirmButtonText: '我知道了',
      type: 'warning',
    })
  }
}

const loading = ref(false)
const rows = ref<AlarmItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const summary = ref<AlarmHistorySummary | null>(null)

const query = reactive<Record<string, any>>({
  alarm_status: undefined,
  alarm_level: undefined,
})

const searchItems = computed<SearchFormItem[]>(() => [
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
    label: '处理状态',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '全部状态',
      options: [
        { label: '已关闭', value: 'closed' },
        { label: '已驳回', value: 'rejected' },
        { label: '重新处理中', value: 'reopened' },
      ],
    },
  },
])

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'alarm_time', label: '告警时间', width: 170, sortable: true, fixed: 'left' },
  { prop: 'location_name', label: '泵站', width: 100 },
  { prop: 'equipment_name', label: '设备/测点', minWidth: 120, showOverflowTooltip: true },
  { prop: 'rule_name', label: '告警名称', minWidth: 140, showOverflowTooltip: true },
  { prop: 'alarm_type_name', label: '类型', width: 100 },
  { prop: 'alarm_level', label: '等级', width: 90, align: 'center' },
  { prop: 'trigger_value', label: '告警值', minWidth: 110, showOverflowTooltip: true },
  { prop: 'duration_sec', label: '持续时长', width: 100, sortable: true },
  { prop: 'alarm_status', label: '处理状态', width: 100, align: 'center' },
  { prop: 'handler_name', label: '处理人', width: 90 },
  { prop: 'end_time', label: '处理时间', width: 170 },
  // 操作列宽按最多 3 个图标按钮（关联工单/恢复关联/详情）紧凑适配，详情固定排最右
  { prop: '__actions', label: '操作', width: 150, fixed: 'right', align: 'right', disabled: true },
])

/* ===== KPI 汇总卡（设计图样式：进度条占比 = 各等级占告警总数比例，已处理卡为处理率） ===== */

const kpis = computed(() => {
  const levels = summary.value?.levels || []
  const byLevel = (lv: number) => levels.find((x) => x.level === lv)
  const l1 = byLevel(1)
  const l2 = byLevel(2)
  const l3 = byLevel(3)
  const totalLv = (l1?.total ?? 0) + (l2?.total ?? 0) + (l3?.total ?? 0)
  const pct = (n: number) => (totalLv ? Math.round((n / totalLv) * 1000) / 10 : 0)
  const rejected = summary.value?.rejected ?? 0
  return [
    {
      label: '一类告警',
      value: l1?.total ?? 0,
      color: '#ef4444',
      variant: 'level1' as const,
      level: 1,
      status: undefined,
      pct: pct(l1?.total ?? 0),
      leftIcon: kpiLeftLevel1,
      rightIcon: kpiRightLevel1,
    },
    {
      label: '二类告警',
      value: l2?.total ?? 0,
      color: '#f59e0b',
      variant: 'level2' as const,
      level: 2,
      status: undefined,
      pct: pct(l2?.total ?? 0),
      leftIcon: kpiLeftLevel2,
      rightIcon: kpiRightLevel2,
    },
    {
      label: '三类告警',
      value: l3?.total ?? 0,
      color: '#3b82f6',
      variant: 'level3' as const,
      level: 3,
      status: undefined,
      pct: pct(l3?.total ?? 0),
      leftIcon: kpiLeftLevel3,
      rightIcon: kpiRightLevel3,
    },
    {
      label: '已驳回',
      value: rejected,
      color: '#8b5cf6',
      variant: 'rejected' as const,
      level: undefined,
      status: 'rejected',
      // 占比分母与三张等级卡统一（历史口径总数），避免四卡合计超 100% 的口径错乱
      pct: totalLv ? Math.round((rejected / totalLv) * 1000) / 10 : 0,
      leftIcon: kpiLeftRejected,
      rightIcon: kpiRightRejected,
    },
  ]
})

/* 当前生效的 KPI 筛选卡标识（用 label 区分等级卡和状态卡） */
const activeKpi = ref<string | null>(null)

/* KPI 卡点击：前三张按等级筛选，第四张按状态(rejected)筛选；再次点击同一卡清除筛选 */
function onKpiClick(card: { label: string; level?: number; status?: string }) {
  if (activeKpi.value === card.label) {
    activeKpi.value = null
    query.alarm_level = undefined
    query.alarm_status = undefined
  } else {
    activeKpi.value = card.label
    query.alarm_level = card.level
    query.alarm_status = card.status
  }
  onSearch()
}

function levelLabel(lv: number) {
  return ({ 1: '一类', 2: '二类', 3: '三类' } as Record<number, string>)[lv] || String(lv)
}
function levelType(lv: number) {
  return ALARM_LEVEL_TAG[lv] || 'info'
}

const exportColumns = [
  { prop: 'alarm_time', label: '告警时间', formatter: (r: any) => formatDateTime(r.alarm_time) },
  { prop: 'location_name', label: '泵站' },
  { prop: 'equipment_name', label: '设备/测点' },
  { prop: 'rule_name', label: '告警名称' },
  { prop: 'alarm_type_name', label: '类型' },
  { prop: 'alarm_level', label: '等级', formatter: (r: any) => levelLabel(r.alarm_level) },
  { prop: 'trigger_value', label: '告警值' },
  {
    prop: 'duration_sec',
    label: '持续时长',
    formatter: (r: any) => formatDuration(r.duration_sec),
  },
  {
    prop: 'alarm_status',
    label: '处理状态',
    formatter: (r: any) => statusLabel(r.alarm_status),
  },
  { prop: 'handler_name', label: '处理人' },
  { prop: 'end_time', label: '处理时间', formatter: (r: any) => formatDateTime(r.end_time) },
]
function statusLabel(s: string) {
  return ALARM_STATUS_LABEL[s] || s
}
function statusTagType(s: string) {
  return ALARM_STATUS_TAG[s] || 'info'
}
function statusPill(s: string) {
  return ALARM_STATUS_PILL[s] || 'is-gray'
}
function levelPill(lv: number) {
  return ALARM_LEVEL_PILL[lv] || 'is-gray'
}
function formatDuration(sec?: number) {
  if (sec == null) return '—'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${(sec / 3600).toFixed(1)}h`
}

/* ===== 告警详情抽屉 ===== */
const detailVisible = ref(false)
const detail = ref<AlarmItem | null>(null)
const selectedId = ref<number | null>(null)

/* 处理日志 → FlowTimeline 节点（复用 logMeta 的名称/图标/配色映射） */
const timelineNodes = computed(() =>
  (detail.value?.logs || []).map((log) => {
    const meta = logMeta(log.action)
    return {
      name: meta.name,
      icon: meta.icon,
      color: meta.color,
      operator: log.operator_name || '系统',
      desc: log.detail,
      time: log.created_at,
    }
  })
)
async function openDetail(row: AlarmItem) {
  selectedId.value = row.id
  const { data } = await getAlarm(row.id)
  detail.value = data.data
  detailVisible.value = true
}

/* 详情抽屉打开时高亮对应行（参考维修工单 row-selected 机制） */
function rowClassName({ row }: { row: Record<string, unknown> }) {
  return selectedId.value != null && Number(row.id) === selectedId.value ? 'row-selected' : ''
}
/* 抽屉关闭时清除行高亮 */
watch(detailVisible, (v) => {
  if (!v) selectedId.value = null
})

async function load() {
  loading.value = true
  try {
    // 历史告警域：已关闭 / 已驳回 / 重新处理中（驳回重开后在此跟踪），未选状态时默认三者
    const status = query.alarm_status || 'closed,rejected,reopened'
    const { data } = await listAlarms({
      page: page.value,
      page_size: pageSize.value,
      alarm_status: status,
      alarm_level: query.alarm_level,
      equipment_id: eqFilterId.value || undefined,
    })
    rows.value = data.data.items
    total.value = data.data.total
    const { data: sm } = await fetchAlarmHistorySummary()
    summary.value = sm.data
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  load()
}

/* 搜索栏重置：清除所有筛选条件（含 KPI 卡选中态） */
function onReset() {
  activeKpi.value = null
  onSearch()
}
function onPageChange(p: number) {
  page.value = p
  load()
}
function onSizeChange(size: number) {
  pageSize.value = size
  load()
}

/* 供父组件（告警中心 tabs）调用：切回本页时重置筛选条件并重新加载 */
function resetFilter() {
  activeKpi.value = null
  query.alarm_level = undefined
  query.alarm_status = undefined
  onSearch()
}
defineExpose({ resetFilter })

onMounted(() => {
  load()
})
</script>

<style scoped>
/* 设备台账跳入的设备过滤提示条 */
.eq-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #eef4ff;
  border: 1px solid #cfe2fb;
  color: #0e7ff0;
  font-size: 13px;
}
/* 告警等级标签：去除类别前的圆点 */
.lv-tag::before {
  display: none !important;
}

/* 处理状态：设计图指定配色（未处理 / 处理中） */
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

/* 处理状态「已驳回」：与紫色 KPI 卡（#8b5cf6）呼应，取设计系统 is-purple 色系 */
.st-tag.st-rejected::before {
  background: #8b5cf6 !important;
}
.pro-table .el-table .st-tag.st-rejected {
  color: #8055db !important;
  background: #f2ecff !important;
  border-color: #e0d1ff !important;
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

/* 搜索条：白色卡改磨砂（移除页面白色背景层） */
:deep(.pro-search-bar) {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none;
  border-radius: 14px;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}

/* ===== 卡片标题栏：图标徽章 + 标题 + 科技线条（与维修工单页一致） ===== */
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

/* 详情抽屉打开时高亮对应行（与维修工单 row-selected 一致） */
:deep(.row-selected) {
  background: rgb(37 99 235 / 8%) !important;
}

@media only screen and (max-width: 1024px) {
  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media only screen and (max-width: 768px) {
  .kpi-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

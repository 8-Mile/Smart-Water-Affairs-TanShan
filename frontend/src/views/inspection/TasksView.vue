<template>
  <div class="page mod-inspect page-fill">
    <IconTabs v-model="activeTab" :tabs="tabs">
      <template #tasks>
    <div class="tab-page">
    <!-- 跨页跳转定位提示：命中行高亮，可手动关闭 -->
    <el-alert
      v-if="banner"
      class="focus-banner"
      type="info"
      :title="`已从工作台定位到巡检任务 #${focus}`"
      closable
      @close="dismiss"
    />
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="onReset"
    />
    <el-card shadow="never" class="art-table-card">
      <!-- 卡片标题栏：图标徽章 + 标题 + 科技线条（全站统一形制） -->
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:task-line" />
        </span>
        <span class="head-title">巡检任务</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="巡检任务"
        @refresh="load"
      />
      <ProTable
        :data="rows"
        :loading="loading"
        :columns="tableColumns"
        row-key="id"
        :pagination="{ current: page, size: pageSize, total }"
        :row-class-name="rowClassName"
        @page-change="onPage"
        @size-change="onSize"
      >
        <template #items="{ row }">{{ formatInspItems(row.items) }}</template>
        <template #task_status="{ row }">
          <el-tag :type="taskTagType(row)" size="small" effect="light">
            {{ taskStatusText(row) }}
          </el-tag>
        </template>
        <template #assignee_name="{ row }">
          <span v-if="row.assignee_name">{{ row.assignee_name }}</span>
          <span v-else class="cell-dash">—</span>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable
              v-if="canExecuteTask(row)"
              :icon="row.assignee_id ? 'ri:checkbox-circle-line' : 'ri:play-circle-line'"
              :icon-class="row.assignee_id ? 'bg-theme/12 text-theme' : 'bg-warning/12 text-warning'"
              :title="row.assignee_id ? '执行巡检' : '认领并执行'"
              :label="row.assignee_id ? '执行巡检' : '认领并执行'"
              @click="openComplete(row)"
            />
            <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
            <ArtButtonTable type="view" title="详情" label="详情" @click="openDetail(row)" />
          </div>
        </template>
        <template #empty>
          <!-- 有筛选激活时引导清除筛选，无筛选保持默认空文案 -->
          <div v-if="hasActiveFilter">
            没有符合条件的任务
            <el-button link type="primary" @click="onReset">清除筛选条件</el-button>
          </div>
          <el-empty v-else :image-size="110" description="暂无数据" />
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" title="执行巡检任务" width="780px">
      <div v-if="current" class="task-meta">
        {{ current.plan_name }} · {{ current.task_date }} · {{ current.team_name }}
        <span v-if="snapshotTs" class="scada-fresh">
          <ArtSvgIcon v-if="snapshotLoading" icon="ri:loader-4-line" class="is-spin" />
          <ArtSvgIcon v-else icon="ri:refresh-line" />
          SCADA 实时值 · {{ snapshotTs.replace('T', ' ') }}
        </span>
        <el-button link type="primary" size="small" :loading="snapshotLoading" @click="refreshSnapshot">
          刷新
        </el-button>
      </div>
      <div class="insp-groups">
        <div v-for="(group, gi) in groupedResultRows" :key="gi" class="insp-group">
          <div class="insp-group-head">
            <ArtSvgIcon icon="ri:server-line" class="insp-group-ico" />
            {{ group.equipment_name }}
            <el-tag size="small" type="info">{{ group.rows.length }} 项</el-tag>
          </div>
          <el-table :data="group.rows" border>
            <el-table-column prop="check_item" label="检查项" width="140" />
            <el-table-column label="SCADA 实时值" min-width="220">
              <template #default="{ row }">
                <div v-if="snapshotMap.get(_snapshotKey(row.equipment_id, row.check_item))?.length" class="scada-cell">
                  <div
                    v-for="p in snapshotMap.get(_snapshotKey(row.equipment_id, row.check_item))"
                    :key="(p.point_id ?? p.point_name ?? '') + ''"
                    class="scada-chip"
                    :class="{ offline: p.offline || p.value === null }"
                  >
                    <span class="scada-chip-name">{{ p.point_name }}</span>
                    <span class="scada-chip-val">
                      {{ p.value === null || p.value === undefined ? '—' : (typeof p.value === 'number' ? p.value.toFixed(p.value % 1 === 0 ? 0 : 2) : String(p.value)) }}
                      <span v-if="p.unit" class="scada-chip-unit">{{ p.unit }}</span>
                    </span>
                    <span v-if="p.offline" class="scada-chip-badge">离线</span>
                  </div>
                </div>
                <span v-else-if="!row.equipment_id" class="scada-empty muted">— 人工目测 —</span>
                <span v-else class="scada-empty muted">— 无关联测点 —</span>
              </template>
            </el-table-column>
            <el-table-column label="结果" width="160">
              <template #default="{ row }">
                <el-radio-group v-model="row.result">
                  <el-radio value="normal">正常</el-radio>
                  <el-radio value="abnormal">异常</el-radio>
                </el-radio-group>
              </template>
            </el-table-column>
            <el-table-column label="备注">
              <template #default="{ row }">
                <el-input
                  v-model="row.remark"
                  :placeholder="row.result === 'abnormal' ? '异常说明（必填）' : '异常说明'"
                  :class="{ 'remark-required': row.result === 'abnormal' && !row.remark?.trim() }"
                >
                  <template #prefix>
                    <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
                  </template>
                </el-input>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <div class="field-textarea" style="margin-top: 12px">
        <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
        <el-input
          v-model="remark"
          type="textarea"
          placeholder="总体备注"
        />
      </div>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="onComplete">提交</el-button>
      </template>
    </ProDialog>

    <!-- 巡检任务详情（只读，不分权限；统一 ProDetailDrawer 形制） -->
    <ProDetailDrawer
      v-model="detailVisible"
      title="巡检任务详情"
      subtitle="查看巡检任务的执行情况与检查结果"
      icon="ri:task-line"
      :border-tone="taskTone"
    >
      <template v-if="detailData">
        <ProDetailSection flush>
          <ProDetailRow icon="ri:route-line" label="巡检计划" :value="detailData.plan_name" />
          <ProDetailRow icon="ri:team-line" label="所属班组" :value="detailData.team_name || '—'" />
          <ProDetailRow icon="ri:calendar-line" label="任务日期" :value="detailData.task_date" mono />
          <ProDetailRow icon="ri:pulse-line" label="任务状态">
            <span class="dd-pill" :class="detailData && taskPill(detailData)">
              {{ taskStatusText(detailData) }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:user-shared-line" label="认领人" :value="detailData.assignee_name || '—'" />
          <ProDetailRow icon="ri:user-line" label="执行人" :value="detailData.executor_name || '—'" />
          <ProDetailRow icon="ri:time-line" label="执行时间" :value="detailData.execute_time || '—'" mono />
          <ProDetailRow icon="ri:share-forward-2-line" label="来源" :value="detailData.source === 'manual' ? '手动派发' : '计划生成'" />
        </ProDetailSection>

        <!-- 巡检项及结果：按设备分组 -->
        <ProDetailSection icon="ri:clipboard-line" title="巡检项及结果" :count="`${detailResultRows.length} 项`">
          <div v-if="groupedDetailRows.length" class="dd-groups">
            <div v-for="(group, gi) in groupedDetailRows" :key="gi" class="dd-group">
              <div class="dd-group-head">
                <ArtSvgIcon icon="ri:server-line" class="dd-group-ico" />
                <span class="dd-group-name">{{ group.equipment_name }}</span>
                <span class="dd-group-count">{{ group.rows.length }} 项</span>
              </div>
              <ul class="dd-timeline">
                <li v-for="(r, i) in group.rows" :key="i" class="dd-tl">
                  <span class="dd-tl-rail" aria-hidden>
                    <i class="dd-tl-dot" />
                  </span>
                  <div class="dd-tl-body">
                    <p class="dd-tl-action">{{ r.check_item }}</p>
                    <p v-if="r.remark" class="dd-tl-detail">{{ r.remark }}</p>
                    <span v-if="r.result" class="dd-pill dd-tl-pill" :class="r.result === 'normal' ? 'is-green' : 'is-red'">
                      {{ r.result === 'normal' ? '正常' : '异常' }}
                    </span>
                    <span v-else class="dd-pill dd-tl-pill is-gray">
                      未检查
                    </span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
          <el-empty v-else :image-size="80" description="暂无巡检项" />
        </ProDetailSection>
      </template>
    </ProDetailDrawer>
    </div>
      </template>
      <template #plans>
        <PlansView ref="plansRef" />
      </template>
      <template #records>
        <RecordsView ref="recordsRef" />
      </template>
    </IconTabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  claimInspTask,
  completeInspTask,
  formatInspItems,
  getTaskScadaSnapshot,
  groupByEquipment,
  listInspTasks,
  taskStatusLabel,
  type InspectionTask,
  type ScadaSnapshotPoint,
  type TaskScadaSnapshot,
} from '@/api/inspection'
import { useFocusRow } from '@/composables/useFocusRow'
import { INSPECTION_STATUS_TAG } from '@/constants/status'
import { celebrateClosedLoop } from '@/utils/feedback'
import { usePermissions } from '@/utils/permissions'
import { optionsResource } from '@/api/system'
import ProSearchBar from '@/components/ProSearchBar.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import ProDialog from '@/components/ProDialog.vue'
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'
import IconTabs, { type IconTabItem } from '@/components/IconTabs.vue'
import PlansView from './PlansView.vue'
import RecordsView from './RecordsView.vue'

const route = useRoute()
/** 默认落点：班组操作员直进「任务」Tab（核心场景抢单执行），管理角色落「计划」（流程起点）；
 *  带 focus 跳转定位任务时自动切到「任务」 */
const { isManager, hasAnyPerm } = usePermissions()
const activeTab = ref(route.query.focus ? 'tasks' : isManager.value ? 'plans' : 'tasks')

/* 子页实例：Tab 切换时调用其筛选重置 */
const plansRef = ref<InstanceType<typeof PlansView> | null>(null)
const recordsRef = ref<InstanceType<typeof RecordsView> | null>(null)
/* Tab 切换即还原默认视图：清空目标页全部筛选条件并按默认条件重新查询。
   首次懒挂载的 pane 自身无筛选（ref 可能尚未就绪，可选链兜底） */
watch(activeTab, (tab) => {
  if (tab === 'tasks') onReset()
  else if (tab === 'plans') plansRef.value?.resetFilters()
  else if (tab === 'records') recordsRef.value?.resetFilters()
})

/* 巡检管理 tab（顺序即业务流：建计划 → 执行任务 → 沉淀记录） */
const tabs = computed<IconTabItem[]>(() => {
  const list: IconTabItem[] = []
  // 巡检计划维护属管理职能：无任何 insp:plan 权限的角色（操作员）不渲染该 Tab
  if (hasAnyPerm(['insp:plan:create', 'insp:plan:update', 'insp:plan:delete'])) {
    list.push({ name: 'plans', label: '巡检计划', icon: 'ri:route-line' })
  }
  list.push(
    { name: 'tasks', label: '巡检任务', icon: 'ri:task-line' },
    { name: 'records', label: '巡检记录', icon: 'ri:file-list-3-line' }
  )
  return list
})
const loading = ref(false)
const rows = ref<InspectionTask[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
/** 班组筛选项（/system/teams/options） */
const teamOptions = ref<{ label: string; value: number }[]>([])
const current = ref<InspectionTask | null>(null)
const resultRows = ref<{ equipment_id?: number | null; equipment_name?: string | null; check_item: string; result: string; remark: string }[]>([])
const remark = ref('')

// ---- SCADA 实时快照 ----
/** 每条 resultRow → 对应的测点实时值列表，key 为 ${equipment_id ?? '_none'}__${check_item} */
const snapshotMap = ref<Map<string, ScadaSnapshotPoint[]>>(new Map())
const snapshotTs = ref('')
const snapshotLoading = ref(false)
let snapshotPollTimer: number | null = null
const SNAPSHOT_POLL_MS = 30_000

function _snapshotKey(equipment_id: number | null | undefined, check_item: string) {
  return `${equipment_id ?? '_none'}__${check_item}`
}

async function refreshSnapshot() {
  if (!current.value) return
  snapshotLoading.value = true
  try {
    const { data } = await getTaskScadaSnapshot(current.value.id)
    const snap: TaskScadaSnapshot = data.data
    const map = new Map<string, ScadaSnapshotPoint[]>()
    for (const it of snap.items) {
      map.set(_snapshotKey(it.equipment_id, it.check_item), it.scada_points || [])
    }
    snapshotMap.value = map
    snapshotTs.value = snap.snapshot_ts
  } catch {
    // 快照拉取失败不阻断巡检流程，静默降级
    snapshotMap.value = new Map()
  } finally {
    snapshotLoading.value = false
  }
}

function startSnapshotPolling() {
  stopSnapshotPolling()
  void refreshSnapshot()
  snapshotPollTimer = window.setInterval(() => {
    void refreshSnapshot()
  }, SNAPSHOT_POLL_MS)
}
function stopSnapshotPolling() {
  if (snapshotPollTimer !== null) {
    window.clearInterval(snapshotPollTimer)
    snapshotPollTimer = null
  }
}
onBeforeUnmount(stopSnapshotPolling)

// 弹窗无论因何种原因关闭（提交完成/点取消/遮罩）都停掉快照轮询，避免后台空转
watch(visible, (v) => {
  if (!v) stopSnapshotPolling()
})

// 详情抽屉
const detailVisible = ref(false)
const detailData = ref<InspectionTask | null>(null)
const detailResultRows = computed(() => {
  const d = detailData.value
  if (!d) return []
  if (d.results?.length) return d.results
  return (d.items || []).map((it) => ({
    equipment_id: it.equipment_id ?? null,
    equipment_name: it.equipment_name ?? null,
    check_item: it.check_item || '',
    result: '',
    remark: '',
  }))
})

/** 执行弹窗 / 详情抽屉：按设备分组（共享工具函数） */
const groupedResultRows = computed(() => groupByEquipment(resultRows.value))
const groupedDetailRows = computed(() => groupByEquipment(detailResultRows.value))
function openDetail(row: InspectionTask) {
  detailData.value = row
  detailVisible.value = true
}

/** 查询条件（默认「今日待办」：task_date=今天，值班员进入即见当日任务；已完成任务已归档至巡检记录） */
function todayStr() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
type TaskState = 'unclaimed' | 'claimed' | 'overdue'
const query = reactive<{ keyword: string; task_status: TaskState | undefined; task_date: string | undefined; team_id: number | undefined }>({
  keyword: '',
  task_status: undefined,
  task_date: todayStr(),
  team_id: undefined,
})

/** 状态三态 → 后端参数映射：待认领/待巡检同为 pending，按 unclaimed 细分 */
const TASK_STATE_PARAMS: Record<TaskState, { task_status: string; unclaimed?: number }> = {
  unclaimed: { task_status: 'pending', unclaimed: 1 },
  claimed: { task_status: 'pending', unclaimed: 0 },
  overdue: { task_status: 'overdue' },
}

const searchItems = computed<SearchFormItem[]>(() => [
  {
    key: 'task_date',
    label: '任务日期',
    type: 'date',
    props: {
      clearable: true,
      placeholder: '默认今日',
      valueFormat: 'YYYY-MM-DD',
      // 撑满栅格列，与后续筛选字段间距一致
      style: 'width: 100%',
    },
  },
  {
    key: 'task_status',
    label: '状态',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '状态',
      options: [
        { label: '待认领', value: 'unclaimed' },
        { label: '待巡检', value: 'claimed' },
        { label: '已超时', value: 'overdue' },
      ],
    },
  },
  {
    key: 'team_id',
    label: '班组',
    type: 'select',
    props: {
      clearable: true,
      filterable: true,
      placeholder: '班组',
      // 异步选项须取 .value（静态数组会在加载前被捕获为空）
      options: teamOptions.value,
    },
  },
  {
    key: 'keyword',
    type: 'input',
    props: { clearable: true, placeholder: '计划名称' },
  },
])

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'plan_name', label: '计划', minWidth: 140, showOverflowTooltip: true },
  { prop: 'team_name', label: '班组', width: 120 },
  { prop: 'task_date', label: '任务日期', width: 110, align: 'center' },
  { prop: 'items', label: '巡检设备', minWidth: 220, showOverflowTooltip: true },
  { prop: 'task_status', label: '任务状态', width: 132, align: 'center' },
  { prop: 'assignee_name', label: '认领人', width: 110 },
  // 操作列宽按最多 2 个图标按钮（执行/认领 + 详情）紧凑适配，详情固定排最右
  { prop: 'operation', label: '操作', width: 110, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'plan_name', label: '计划' },
  { prop: 'team_name', label: '班组' },
  { prop: 'task_date', label: '任务日期' },
  { prop: 'items', label: '巡检设备', formatter: (r: any) => formatInspItems(r.items) },
  {
    prop: 'task_status',
    label: '状态',
    formatter: (r: any) => {
      if (isOverdue(r)) return `已超时 ${overdueDays(r)} 天`
      return r.task_status === 'pending' ? (r.assignee_id ? '待巡检' : '待认领') : taskStatusLabel(r.task_status)
    },
  },
  { prop: 'assignee_name', label: '认领人', formatter: (r: any) => r.assignee_name || '' },
  { prop: 'executor_name', label: '执行人' },
]

// 跨页跳转行定位：工作台带 ?focus=任务id，命中行高亮 + 滚动定位
// autoLocate=false：同页 focus 变化由下方 watch 清筛选重载后 locate，避免重载前空滚动+提前淡出
const { focus, banner, rowClassName, locate, dismiss } = useFocusRow('id', { autoLocate: false })

// 同页点击通知（?focus 变化）时重新定位：清筛选回第一页加载，保证焦点行可见
watch(
  () => route.query.focus,
  (v, ov) => {
    if (!v || v === ov) return
    query.keyword = ''
    query.task_status = undefined
    query.task_date = undefined
    query.team_id = undefined
    page.value = 1
    load()
  },
)

/** 可执行：未完成且（无人认领→班组内可认领；已认领→仅认领本人）；班组可见性由后端过滤保证。
 *  认领互斥：任务被认领后其他人不再显示执行按钮（认领制先到先得，避免点击才报「已被认领」） */
const { myId, hasPerm } = usePermissions()
function canExecuteTask(row: InspectionTask) {
  return (
    row.task_status !== 'done' &&
    (!row.assignee_id || row.assignee_id === myId.value)
  )
}

/** 超时天数：任务日期按自然日计，昨日到期即超时 1 天 */
function overdueDays(row: InspectionTask): number {
  if (!row.task_date) return 0
  const d = new Date(`${row.task_date}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86400000))
}

/** 是否超时：含实时判定——pending 但任务日期已过（调度器批量改状态前）也按已超时展示 */
function isOverdue(row: InspectionTask): boolean {
  return row.task_status === 'overdue' || (row.task_status === 'pending' && overdueDays(row) > 0)
}

/** 状态文案：超时带时长；pending 按认领状态细分为「待认领/待巡检」（与筛选下拉口径一致） */
function taskStatusText(row: InspectionTask) {
  if (isOverdue(row)) return `已超时 ${overdueDays(row)} 天`
  if (row.task_status === 'pending') return row.assignee_id ? '待巡检' : '待认领'
  return taskStatusLabel(row.task_status)
}

/** 是否存在激活筛选（空态引导判断用） */
const hasActiveFilter = computed(
  () => !!(query.keyword || query.task_status || query.task_date || query.team_id),
)

/** 任务状态色统一取色板：超时（含实时判定）红、完成态 done 映射到色板 completed 键；
 *  待巡检（pending 且已认领）用蓝色「进行中」语义，与待认领的橙色区分 */
function taskTagType(row: InspectionTask) {
  if (isOverdue(row)) return 'danger'
  if (row.task_status === 'pending' && row.assignee_id) return 'primary'
  return INSPECTION_STATUS_TAG[row.task_status === 'done' ? 'completed' : row.task_status] ?? 'warning'
}
// 详情抽屉胶囊色系（dd-pill）：待巡检蓝（与列表 tag 一致）/ 待认领橙 / done绿 / overdue红
function taskPill(row: InspectionTask) {
  if (isOverdue(row)) return 'is-red'
  if (row.task_status === 'pending') return row.assignee_id ? 'is-blue' : 'is-orange'
  return ({ done: 'is-green' } as Record<string, string>)[row.task_status] || 'is-gray'
}
// 详情抽屉呼吸边框色：与胶囊同色系（含 isOverdue 实时判定）
const taskTone = computed(() => {
  const d = detailData.value
  if (!d) return undefined
  if (isOverdue(d)) return 'red'
  if (d.task_status === 'pending') return d.assignee_id ? 'blue' : 'orange'
  return ({ done: 'green' } as Record<string, string>)[d.task_status] || 'gray'
})

async function load() {
  loading.value = true
  try {
    const { data } = await listInspTasks({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
      ...(query.task_status ? TASK_STATE_PARAMS[query.task_status] : {}),
      task_date: query.task_date || undefined,
      team_id: query.team_id,
    })
    rows.value = data.data.items
    total.value = data.data.total
    // 数据渲染完成后滚动定位到焦点行（无 focus 参数时内部直接返回）
    await locate()
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  load()
}

/** 清空全部筛选并重新查询（空态引导与重置按钮共用） */
function onReset() {
  query.keyword = ''
  query.task_status = undefined
  query.task_date = undefined
  query.team_id = undefined
  page.value = 1
  load()
}

function onPage(p: number) {
  page.value = p
  load()
}
function onSize(s: number) {
  pageSize.value = s
  page.value = 1
  load()
}

async function openComplete(row: InspectionTask) {
  let task = row
  // 班组池任务：点击即认领（原子操作），并发落败时拦截器提示并刷新列表
  if (!row.assignee_id) {
    try {
      const { data } = await claimInspTask(row.id)
      task = data.data
      const idx = rows.value.findIndex((r) => r.id === row.id)
      if (idx > -1) rows.value[idx] = task
    } catch {
      await load()
      return
    }
  }
  current.value = task
  resultRows.value = (task.items || []).map((it) => ({
    equipment_id: it.equipment_id ?? null,
    equipment_name: it.equipment_name ?? null,
    check_item: it.check_item || '',
    result: 'normal',
    remark: '',
  }))
  remark.value = ''
  visible.value = true
  startSnapshotPolling()
}

async function onComplete() {
  if (!current.value) return
  const task = current.value
  // 异常项必须填写异常说明：拦截提交并聚焦提示
  const missing = resultRows.value.find((r) => r.result === 'abnormal' && !r.remark?.trim())
  if (missing) {
    ElMessage.warning(
      `「${missing.equipment_name ? `${missing.equipment_name}·` : ''}${missing.check_item}」结果为异常，请填写异常说明`,
    )
    return
  }
  await completeInspTask(task.id, {
    results: resultRows.value,
    remark: remark.value || undefined,
  })
  stopSnapshotPolling()
  visible.value = false
  // 闭环轻庆祝：巡检结果提交归档的正向反馈
  celebrateClosedLoop('巡检任务已完成', `计划「${task.plan_name}」${task.task_date} 结果已归档`)
  await load()
}

onMounted(async () => {
  await load()
  // 班组筛选项异步补充，不阻塞首屏列表
  try {
    const { data } = await optionsResource('/system/teams/options')
    teamOptions.value = (data.data || []).map((t: { id: number; name: string }) => ({
      label: t.name,
      value: t.id,
    }))
  } catch {
    teamOptions.value = []
  }
})
</script>

<style scoped>
.tab-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 搜索栏紧凑化：收窄卡片内边距与表单项下边距，避免纵向留白过长 */
.tab-page :deep(.pro-search-bar) {
  padding: 12px 20px 0;
}
.tab-page :deep(.pro-search-bar .el-form-item) {
  margin-bottom: 12px;
}
/* 表格卡片与搜索栏间距对齐设备台账页（全局 .art-table-card 的 margin-top:12px 在此改为由 gap 提供） */
.tab-page > .art-table-card {
  margin-top: 0;
}
.task-meta {
  margin-bottom: 12px;
  color: var(--art-gray-800);
}
/* 认领人列空值占位：弱化显示 */
.cell-dash {
  color: #a8abb2;
}
/* 执行弹窗：设备分组容器 */
.insp-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.insp-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.insp-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13.5px;
  font-weight: 600;
  color: #12234d;
  background: linear-gradient(90deg, rgba(14, 127, 240, 0.08), rgba(14, 127, 240, 0));
  border-left: 3px solid #0e7ff0;
  border-radius: 4px;
}
.insp-group-ico {
  color: #0e7ff0;
}
/* 异常项未填说明时的输入框红边提示 */
:deep(.remark-required .el-input__wrapper) {
  box-shadow: 0 0 0 1px #f03d45 inset;
}
/* SCADA 实时值：元信息条（快照时间 + 刷新按钮） */
.task-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.scada-fresh {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
  color: #0e7ff0;
  background: rgba(14, 127, 240, 0.08);
  border-radius: 10px;
}
.scada-fresh .is-spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
/* SCADA 实时值：测点 chip 列表 */
.scada-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.scada-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  background: #f3f7fc;
  border: 1px solid #dbe8f8;
  border-radius: 4px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scada-chip.offline {
  background: #fef0f0;
  border-color: #fde2e2;
  color: #f03d45;
}
.scada-chip-name {
  color: #606266;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scada-chip.offline .scada-chip-name {
  color: #f03d45;
}
.scada-chip-val {
  font-weight: 600;
  color: #12234d;
}
.scada-chip-unit {
  font-weight: 400;
  color: #909399;
  font-size: 11px;
}
.scada-chip-badge {
  font-size: 10px;
  padding: 0 5px;
  background: #f03d45;
  color: #fff;
  border-radius: 8px;
  line-height: 1.6;
}

/* 高度链：根 .page-fill 接入（全局类），el-tabs 链由 IconTabs 组件内置，
   本页只需让 .tab-page 与表格卡吃掉 pane 剩余高度 */
.tab-page {
  flex: 1 1 auto;
  min-height: 0;
}
.tab-page > .art-table-card {
  flex: 1 1 auto;
  min-height: 0;
}
.scada-empty.muted {
  color: #909399;
  font-size: 12px;
}
</style>

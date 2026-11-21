<template>
  <div class="page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="维保计划" name="plans">
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="onReset"
    />
    <el-card shadow="never" class="art-table-card">
      <div class="card-head">
        <span class="head-badge"><ArtSvgIcon icon="ri:calendar-check-line" /></span>
        <span class="head-title">维保计划</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="维保计划"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('maint:plan:create')" class="btn-gradient" type="primary" @click="openCreate">
            <ArtSvgIcon icon="ri:add-line" style="margin-right: 4px" />新增计划
          </el-button>
        </template>
      </ProTableHeader>
      <ProTable
        :data="rows"
        :loading="loading"
        :columns="tableColumns"
        row-key="id"
        :pagination="{ current: page, size: pageSize, total }"
        @page-change="onPage"
        @size-change="onSize"
      >
        <template #plan_type="{ row }">{{ typeLabel(row.plan_type) }}</template>
        <template #next_due="{ row }">
          <!-- 彩色文字（无圆点）：红=逾期/今日到期，橙=临期，蓝=正常 -->
          <span v-if="nextDue(row)" class="due-state" :class="dueCls(row)">
            {{ nextDue(row)!.date }}
            <span v-if="dueBadge(row)" class="tip">{{ dueBadge(row)!.text }}</span>
          </span>
          <span v-else class="due-state is-gray">—</span>
        </template>
        <template #equipment_names="{ row }">{{ (row.equipment_names || []).join('、') || '—' }}</template>
        <template #task_status="{ row }">
          <!-- 圆点+彩色文字（无胶囊）：蓝=待执行 / 橙=待验收 / 绿=本轮完成 / 灰=待首次派发·已停用 -->
          <div class="task-state-wrap">
            <!-- 停用优先：计划是循环任务，只有停用才真正"结束" -->
            <div v-if="row.enabled !== 1" class="task-state is-gray">
              <i class="dot" />已停用
            </div>
            <div v-else-if="(row.pending_count || 0) > 0" class="task-state is-blue">
              <i class="dot" />待执行
              <span class="cnt">{{ row.pending_count }}项</span>
            </div>
            <div v-else-if="(row.accept_count || 0) > 0" class="task-state is-orange">
              <i class="dot" />待验收
              <span class="cnt">{{ row.accept_count }}项</span>
            </div>
            <div v-else-if="row.last_dispatch_date" class="task-state is-green">
              <i class="dot" />本轮完成
            </div>
            <div v-else class="task-state is-gray"><i class="dot" />待首次派发</div>
            <!-- 本轮有到期未做的任务：红色警示（与下轮"下次维保"提醒相互独立） -->
            <span v-if="(row.overdue_count || 0) > 0 && row.enabled === 1" class="od">
              逾期{{ row.overdue_count }}项
            </span>
          </div>
        </template>
        <template #enabled="{ row }">
          <el-tag :type="row.enabled === 1 ? 'success' : 'info'" size="small" effect="light">
            {{ row.enabled === 1 ? '是' : '否' }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('maint:plan:dispatch')" icon="ri:send-plane-line" icon-class="bg-success/12 text-success" title="手动派发" label="手动派发" @click="openDispatch(row)" />
            <ArtButtonTable v-if="hasPerm('maint:plan:update')" type="edit" title="编辑" label="编辑" @click="openEdit(row)" />
            <DeleteConfirm
              v-if="hasPerm('maint:plan:delete')"
              :text="`删除计划「${row.name}」？`"
              @confirm="onDelete(row)"
            >
              <ArtButtonTable type="delete" title="删除" label="删除" />
            </DeleteConfirm>
            <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
            <ArtButtonTable type="view" title="详情" label="详情" @click="openDetail(row)" />
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑维保计划' : '新增维保计划'" width="560px">
      <!-- 已派发的计划编辑时提示：规则只影响未来，不碰已生成任务 -->
      <el-alert
        v-if="editTipVisible"
        type="warning"
        show-icon
        :closable="false"
        :title="`该计划已派发 ${editTipCount} 条任务未完结，本次修改仅影响下次派发，已生成任务不受影响`"
        style="margin-bottom: 14px"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="计划名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:task-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="计划类型" prop="plan_type" required>
          <el-select v-model="form.plan_type" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:tools-line" /></span>
            </template>
            <el-option label="检修" value="overhaul" />
            <el-option label="润滑" value="lubrication" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始时间" prop="start_date" required>
          <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="周期(天)" prop="cycle_days" required>
          <el-input-number v-model="form.cycle_days" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="提前通知(天)" prop="advance_days" required>
          <el-input-number v-model="form.advance_days" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="关联设备" prop="equipment_ids" required>
          <EquipmentTreeSelect v-model="form.equipment_ids" :options="equipments" multiple />
        </el-form-item>
        <el-form-item label="默认执行人" prop="default_assignee_id" required>
          <el-select v-model="form.default_assignee_id" filterable style="width: 100%" placeholder="派发与自动派发将默认指派给该人员">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:user-line" /></span>
            </template>
            <el-option v-for="u in users" :key="u.id" :label="u.display_name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
        </el-form-item>
        <el-form-item label="需验收">
          <el-switch v-model="form.need_accept" :active-value="1" :inactive-value="0" />
          <span class="form-hint">开启后，该计划生成的维保任务完成时需验收通过才计入台账</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </ProDialog>

    <!-- 派发维保任务：选择指派人 + 填写备注 -->
    <ProDialog v-model="dispatchVisible" title="派发维保任务" width="480px">
      <el-form label-width="90px">
        <el-form-item label="计划">{{ dispatchPlan?.name }}</el-form-item>
        <el-form-item label="指派人员">
          <el-select
            v-model="assigneeId"
            filterable
            clearable
            placeholder="不指定则任务开放给全员认领"
            style="width: 100%"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:user-line" /></span>
            </template>
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="u.display_name || u.username"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="dispatchRemark" type="textarea" :rows="3" placeholder="可填写派发说明，留空则无备注" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmDispatch">确认派发</el-button>
      </template>
    </ProDialog>

    <!-- 维保计划详情（只读，不分权限；统一 ProDetailDrawer 形制） -->
    <ProDetailDrawer
      v-model="detailVisible"
      title="维保计划详情"
      subtitle="查看维保计划的周期与派发执行情况"
      icon="ri:calendar-check-line"
      :border-tone="planTone"
    >
      <template v-if="detailData">
        <ProDetailSection flush>
          <ProDetailRow icon="ri:price-tag-3-line" label="计划名称" :value="detailData.name" />
          <ProDetailRow icon="ri:apps-2-line" label="计划类型" :value="typeLabel(detailData.plan_type)" />
          <ProDetailRow icon="ri:calendar-line" label="开始日期" :value="detailData.start_date" mono />
          <ProDetailRow icon="ri:loop-left-line" label="周期(天)" :value="detailData.cycle_days" mono />
          <ProDetailRow icon="ri:alarm-line" label="提前提醒(天)" :value="detailData.advance_days" mono />
          <ProDetailRow icon="ri:link" label="关联设备" top>
            <div v-if="(detailData.equipment_names || []).length" class="dd-desc">
              {{ detailData.equipment_names.join('、') }}
            </div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">未关联设备</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:user-star-line" label="默认执行人" :value="detailData.default_assignee_name || '—'" />
          <ProDetailRow icon="ri:pulse-line" label="启用状态">
            <span class="dd-pill" :class="detailData.enabled === 1 ? 'is-green' : 'is-gray'">
              {{ detailData.enabled === 1 ? '启用' : '停用' }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:send-plane-line" label="上次派发" :value="detailData.last_dispatch_date || '—'" mono />
          <ProDetailRow icon="ri:list-check-2" label="待执行任务数" :value="detailData.pending_count ?? 0" mono />
          <ProDetailRow v-if="(detailData.accept_count || 0) > 0" icon="ri:checkbox-circle-line" label="待验收任务数" :value="detailData.accept_count ?? 0" mono />
          <ProDetailRow icon="ri:shield-check-line" label="验收要求">
            <span class="dd-pill" :class="detailData.need_accept === 1 ? 'is-blue' : 'is-gray'">
              {{ detailData.need_accept === 1 ? '完成后需验收' : '无需验收' }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:file-text-line" label="备注" top>
            <div v-if="detailData.remark" class="dd-desc">{{ detailData.remark }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">暂无备注</span>
            </div>
          </ProDetailRow>
        </ProDetailSection>
      </template>
    </ProDetailDrawer>
      </el-tab-pane>
      <el-tab-pane label="维保记录" name="records" lazy>
        <RecordsView />
      </el-tab-pane>
      <el-tab-pane label="台账汇总" name="ledger" lazy>
        <LedgerView />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  createMaintPlan,
  deleteMaintPlan,
  dispatchMaintPlan,
  listMaintPlans,
  typeLabel,
  updateMaintPlan,
  type MaintPlan,
} from '@/api/maintenance'
import { optionsResource } from '@/api/system'
import type { OptionItem } from '@/api/types'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProDialog from '@/components/ProDialog.vue'
import EquipmentTreeSelect from '@/components/EquipmentTreeSelect.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'
import RecordsView from './RecordsView.vue'
import LedgerView from './LedgerView.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()

interface UserItem {
  id: number
  username: string
  display_name: string
  role_code: string
}

// 消息通知跳转带 ?tab=records&focus=<id>：直接落到维保记录 Tab 并定位高亮
const route = useRoute()
const activeTab = ref((route.query.tab as string) || 'plans')
watch(
  () => route.query.tab,
  (v) => {
    if (v) activeTab.value = v as string
  },
)
const loading = ref(false)
const rows = ref<MaintPlan[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const detailVisible = ref(false)
const detailData = ref<MaintPlan | null>(null)
// 详情抽屉呼吸边框色：按任务状态——停用灰 / 有待执行任务橙 / 无待执行绿
const planTone = computed(() => {
  const d = detailData.value
  if (!d) return undefined
  if (d.enabled !== 1) return 'gray'
  return (d.pending_count ?? 0) > 0 ? 'orange' : 'green'
})
function openDetail(row: MaintPlan) {
  detailData.value = row
  detailVisible.value = true
}
const equipments = ref<OptionItem[]>([])
/** 操作员池（全量加载，派发时指派维保任务给指定操作员） */
const users = ref<UserItem[]>([])
const dispatchVisible = ref(false)
const dispatchPlan = ref<MaintPlan | null>(null)
const assigneeId = ref<number | undefined>(undefined)
const dispatchRemark = ref('')
const query = reactive({ keyword: '' })

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '计划名称', type: 'input', props: { clearable: true, placeholder: '计划名称' } },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'name', label: '计划名称', minWidth: 140, showOverflowTooltip: true },
  { prop: 'plan_type', label: '类型', width: 90, align: 'center' },
  { prop: 'start_date', label: '开始', width: 120 },
  { prop: 'cycle_days', label: '周期(天)', width: 90, align: 'center' },
  { prop: 'advance_days', label: '提前提醒', width: 90, align: 'center' },
  { prop: 'next_due', label: '下次维保', width: 260 },
  { prop: 'equipment_names', label: '关联设备', minWidth: 160, showOverflowTooltip: true },
  { prop: 'default_assignee_name', label: '默认执行人', width: 130, showOverflowTooltip: true },
  { prop: 'task_status', label: '任务状态', width: 180, align: 'left' },
  { prop: 'enabled', label: '启用', width: 80, align: 'center' },
  // 操作列宽按最多 4 个图标按钮（派发/编辑/删除/详情）紧凑适配，详情固定排最右
  { prop: 'operation', label: '操作', width: 200, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'name', label: '计划名称' },
  { prop: 'plan_type', label: '类型', formatter: (r: MaintPlan) => typeLabel(r.plan_type) },
  { prop: 'start_date', label: '开始' },
  { prop: 'cycle_days', label: '周期(天)' },
  { prop: 'advance_days', label: '提前提醒(天)' },
  {
    prop: 'next_due',
    label: '下次维保',
    formatter: (r: MaintPlan) => {
      const n = nextDue(r)
      if (!n) return '—'
      const b = dueBadge(r)
      return b ? `${n.date}（${b.text}）` : n.date
    },
  },
  { prop: 'equipment_names', label: '关联设备', formatter: (r: MaintPlan) => (r.equipment_names || []).join('、') },
  { prop: 'default_assignee_name', label: '默认执行人', formatter: (r: MaintPlan) => r.default_assignee_name || '—' },
  {
    prop: 'task_status',
    label: '任务状态',
    formatter: (r: MaintPlan) => {
      if (r.enabled !== 1) return '已停用'
      // 与列表圆点状态文案保持一致
      const base =
        (r.pending_count || 0) > 0
          ? `待执行 ${r.pending_count}项`
          : (r.accept_count || 0) > 0
            ? `待验收 ${r.accept_count}项`
            : r.last_dispatch_date
              ? '本轮完成'
              : '待首次派发'
      const od = (r.overdue_count || 0) > 0 ? `（逾期${r.overdue_count}项）` : ''
      return base + od
    },
  },
  { prop: 'enabled', label: '启用', formatter: (r: MaintPlan) => (r.enabled === 1 ? '是' : '否') },
]

const form = reactive({
  id: null as number | null,
  name: '',
  plan_type: 'overhaul',
  start_date: '',
  cycle_days: 30,
  advance_days: 3,
  equipment_ids: [] as number[],
  enabled: 1,
  need_accept: 0,
  default_assignee_id: undefined as number | undefined,
})

const formRef = ref<FormInstance>()
/* 编辑提示：计划有待完结任务时说明规则修改的作用域 */
const editTipVisible = ref(false)
const editTipCount = ref(0)
const rules: FormRules = {
  name: [{ required: true, message: '请填写计划名称', trigger: 'blur' }],
  plan_type: [{ required: true, message: '请选择计划类型', trigger: 'change' }],
  start_date: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  cycle_days: [{ required: true, message: '请填写周期天数', trigger: 'blur' }],
  advance_days: [{ required: true, message: '请填写提前通知天数', trigger: 'blur' }],
  equipment_ids: [{ required: true, type: 'array', message: '请选择关联设备', trigger: 'change' }],
  default_assignee_id: [{ required: true, message: '请选择默认执行人', trigger: 'change' }],
}

async function load() {
  loading.value = true
  try {
    const { data } = await listMaintPlans({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
    })
    rows.value = data.data.items
    total.value = data.data.total
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  load()
}
function onReset() {
  query.keyword = ''
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

function openCreate() {
  if (!hasPerm('maint:plan:create')) return
  Object.assign(form, {
    id: null,
    name: '',
    plan_type: 'overhaul',
    start_date: '',
    cycle_days: 30,
    advance_days: 3,
    equipment_ids: [],
    enabled: 1,
    need_accept: 0,
    default_assignee_id: undefined,
  })
  editTipVisible.value = false
  editTipCount.value = 0
  visible.value = true
}

function openEdit(row: MaintPlan) {
  if (!hasPerm('maint:plan:update')) return
  Object.assign(form, {
    id: row.id,
    name: row.name,
    plan_type: row.plan_type,
    start_date: row.start_date,
    cycle_days: row.cycle_days,
    advance_days: row.advance_days,
    equipment_ids: [...(row.equipment_ids || [])],
    enabled: row.enabled,
    need_accept: row.need_accept ?? 0,
    default_assignee_id: row.default_assignee_id ?? undefined,
  })
  editTipCount.value = (row.pending_count || 0) + (row.accept_count || 0)
  editTipVisible.value = editTipCount.value > 0
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload = { ...form }
  delete (payload as { id?: number | null }).id
  if (form.id) await updateMaintPlan(form.id, payload)
  else await createMaintPlan(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

/** 打开派单弹窗：选择指派人 + 填写备注 */
function openDispatch(row: MaintPlan) {
  if (!hasPerm('maint:plan:dispatch')) return
  dispatchPlan.value = row
  // 预填计划默认执行人，可改可清空
  assigneeId.value = row.default_assignee_id ?? undefined
  dispatchRemark.value = ''
  dispatchVisible.value = true
}

async function confirmDispatch() {
  if (!dispatchPlan.value) return
  const { data } = await dispatchMaintPlan(dispatchPlan.value.id, {
    assignee_id: assigneeId.value,
    remark: dispatchRemark.value || undefined,
  })
  ElMessage.success(`已派发 ${data.data.count} 条维保任务`)
  dispatchVisible.value = false
  await load()
}

async function onDelete(row: MaintPlan) {
  if (!hasPerm('maint:plan:delete')) return
  await deleteMaintPlan(row.id)
  ElMessage.success('已删除')
  await load()
}

/* 下次维保日期：与后端自动派发同口径（首次=开始日，之后=上次派发+周期） */
function nextDue(row: MaintPlan): { date: string; days: number } | null {
  if (!row.start_date || !row.cycle_days) return null
  const anchorSrc = row.last_dispatch_date || row.start_date
  const anchor = new Date(`${anchorSrc}T00:00:00`)
  if (isNaN(anchor.getTime())) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  // 首次应执行日即开始日本身；派发过则从上次派发起加一个周期
  const nextTime = row.last_dispatch_date
    ? anchor.getTime() + row.cycle_days * 86400000
    : anchor.getTime()
  const days = Math.round((nextTime - now.getTime()) / 86400000)
  const d = new Date(nextTime)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { date, days }
}

/* 到期提醒三级：逾期/今日到期标红，advance_days 内临期橙色 */
function dueBadge(row: MaintPlan): { text: string; type: 'danger' | 'warning'; overdue: boolean } | null {
  if (row.enabled !== 1) return null
  const n = nextDue(row)
  if (!n) return null
  if (n.days < 0) return { text: `逾期${-n.days}天`, type: 'danger', overdue: true }
  if (n.days === 0) return { text: '今日到期', type: 'danger', overdue: true }
  if (n.days <= (row.advance_days ?? 0)) return { text: `剩${n.days}天`, type: 'warning', overdue: false }
  return null
}

/* 下次维保圆点色级：红=逾期/今日到期，橙=临期，蓝=正常 */
function dueCls(row: MaintPlan) {
  const b = dueBadge(row)
  if (!b) return 'is-normal'
  return b.overdue ? 'is-red' : 'is-orange'
}

onMounted(async () => {
  const [equipRes, usersRes] = await Promise.all([
    optionsResource('/equipment/options'),
    // 人员下拉用轻量选项接口：/system/users 需要 sys:user:list，业务角色无此权限
    optionsResource('/system/users/options'),
  ])
  equipments.value = equipRes.data.data
  // 指派对象仅限操作员角色
  users.value = (usersRes.data.data as unknown as UserItem[]).filter(
    (u) => u.role_code === 'operator',
  )
  await load()
})
// keep-alive / tab 切换回来时重新加载，确保数据实时
onActivated(() => {
  load()
})
</script>

<style lang="scss" scoped>
.form-hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--art-gray-400, var(--el-text-color-secondary));
}
/* 下次维保：彩色文字 */
.due-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #264779;

  .tip {
    font-weight: 600;
  }

  &.is-normal {
    color: #264779;
  }
  &.is-orange {
    .tip {
      color: #f59a07;
    }
  }
  &.is-red {
    color: #f03d45;
    font-weight: 600;

    .tip {
      color: #f03d45;
    }
  }
  &.is-gray {
    color: #8a97a8;
  }
}
/* 任务状态：圆点+彩色文字（无胶囊） */
.task-state-wrap {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.task-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  &.is-blue {
    color: #176bff;
  }
  &.is-orange {
    color: #f59a07;
  }
  &.is-green {
    color: #16a34a;
  }
  &.is-gray {
    color: #8a97a8;
  }

  .cnt {
    color: #264779;
    font-weight: 500;
  }
}
.od {
  color: #f03d45;
  font-size: 13px;
  font-weight: 600;
}
</style>

<template>
  <div class="page mod-dispatch">
    <div class="kpi-panel">
      <div class="kpi-row">
        <KpiCard
          v-for="c in kpis"
          :key="c.label"
          variant="poster"
          :label="c.label"
          :value="c.value"
          :color="c.color"
          :icon="c.icon"
          :desc="c.desc"
          :active="activeKpi === c.key"
          :breathing="activeKpi === c.key"
          clickable
          @click="onKpiClick(c.key)"
        />
      </div>
    </div>

    <!-- 跨页跳转定位提示：命中行高亮，可手动关闭 -->
    <el-alert
      v-if="banner"
      class="focus-banner"
      type="info"
      :title="`已从工作台定位到调度指令 ${focus}`"
      closable
      @close="dismiss"
    />
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="reset"
    />
    <el-card shadow="never" class="art-table-card">
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:send-plane-line" />
        </span>
        <span class="head-title">调度指令</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="调度指令"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('dispatch:create')" class="btn-gradient" type="primary" @click="openCreate">添加指令</el-button>
        </template>
      </ProTableHeader>

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
        <template #instruction_type="{ row }">{{ typeLabel(row.instruction_type) }}</template>
        <template #publish_time="{ row }">
          {{ formatDateTime(row.publish_time) }}
        </template>
        <template #priority="{ row }">
          <el-tag :type="priorityType(row.priority)" size="small" effect="light">
            {{ priorityLabel(row.priority) }}
          </el-tag>
        </template>
        <template #audit_status="{ row }">
          <el-tag
            size="small"
            effect="light"
            :type="row.audit_status === 'approved' ? 'success' : row.audit_status === 'rejected' ? 'danger' : 'warning'"
          >
            {{ auditLabel(row.audit_status) }}
          </el-tag>
        </template>
        <template #execute_status="{ row }">
          <el-tag size="small" effect="light" :type="row.execute_status === 'done' ? 'success' : 'info'">
            {{ execLabel(row.execute_status) }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable type="view" title="查看" @click="openDetail(row)" />
            <ArtButtonTable
              v-if="canAudit(row)"
              icon="ri:file-check-line"
              icon-class="bg-success/12 text-success"
              title="审核"
              @click="openAudit(row)"
            />
            <ArtButtonTable v-if="canEdit(row)" type="edit" title="编辑" @click="openEdit(row)" />
            <DeleteConfirm
              v-if="canDelete(row)"
              :text="`删除指令 ${row.instruction_code}？`"
              @confirm="onDelete(row)"
            >
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
            <ArtButtonTable
              v-if="canComplete(row)"
              icon="ri:checkbox-circle-line"
              icon-class="bg-success/12 text-success"
              title="执行完毕"
              @click="openComplete(row)"
            />
          </div>
        </template>
        <template #empty>
          <!-- 有筛选激活时引导清除筛选，无筛选保持默认空文案 -->
          <div v-if="hasActiveFilter" class="empty-filter">
            <p>没有符合条件的指令</p>
            <el-button link type="primary" @click="reset">清除筛选条件</el-button>
          </div>
          <span v-else>暂无数据</span>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="formVisible" :title="form.id ? '编辑指令' : '新增指令'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="指令类型" prop="instruction_type" required>
          <el-select v-model="form.instruction_type" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:price-tag-3-line" /></span>
            </template>
            <el-option label="上级指令" value="superior" />
            <el-option label="内部指令" value="internal" />
          </el-select>
        </el-form-item>
        <el-form-item label="指令内容" prop="content" required>
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="form.content" type="textarea" :rows="3" />
          </div>
        </el-form-item>
        <el-form-item label="执行人" prop="executor_id" required>
          <el-select v-model="form.executor_id" filterable style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:user-line" /></span>
            </template>
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.display_name || u.username}`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="预计完成" prop="expected_finish_time" required>
          <el-date-picker
            v-model="form.expected_finish_time"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="优先级" prop="priority" required>
          <el-radio-group v-model="form.priority">
            <el-radio value="normal">一般</el-radio>
            <el-radio value="important">重要</el-radio>
            <el-radio value="urgent">紧急</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </ProDialog>

    <ProDialog v-model="auditVisible" title="审核详情" width="560px">
      <template v-if="current">
        <el-timeline style="margin-bottom: 12px">
          <el-timeline-item timestamp="发布" type="primary">
            {{ current.publisher_name }} · {{ formatDateTime(current.publish_time, false) }}
          </el-timeline-item>
          <el-timeline-item timestamp="审核" type="warning">当前环节</el-timeline-item>
          <el-timeline-item timestamp="执行" type="info">待审核通过后下发</el-timeline-item>
        </el-timeline>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="编号">{{ current.instruction_code }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ typeLabel(current.instruction_type) }}</el-descriptions-item>
          <el-descriptions-item label="内容">{{ current.content }}</el-descriptions-item>
          <el-descriptions-item label="优先级">{{ priorityLabel(current.priority) }}</el-descriptions-item>
          <el-descriptions-item label="执行人">{{ current.executor_name }}</el-descriptions-item>
          <el-descriptions-item label="预计完成">{{ formatDateTime(current.expected_finish_time, false) }}</el-descriptions-item>
        </el-descriptions>
        <el-form ref="auditFormRef" :model="auditForm" :rules="auditRules" style="margin-top: 16px" label-width="90px">
          <el-form-item label="审核意见" prop="comment" required>
            <div class="field-textarea">
              <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
              <el-input v-model="auditForm.comment" type="textarea" :rows="3" placeholder="必填" />
            </div>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="auditVisible = false">关闭</el-button>
        <el-button type="danger" @click="onAudit(false)">审核驳回</el-button>
        <el-button type="primary" @click="onAudit(true)">审核通过</el-button>
      </template>
    </ProDialog>

    <ProDialog v-model="completeVisible" title="执行反馈" width="480px">
      <el-form label-width="90px">
        <el-form-item label="指令">{{ current?.instruction_code }}</el-form-item>
        <el-form-item label="内容">{{ current?.content }}</el-form-item>
        <el-form-item label="反馈">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="executeFeedback" type="textarea" :rows="3" placeholder="可选" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="completeVisible = false">取消</el-button>
        <el-button type="primary" @click="onComplete">确认完成</el-button>
      </template>
    </ProDialog>

    <!-- 指令详情（统一 ProDetailDrawer 形制） -->
    <ProDetailDrawer
      v-model="detailVisible"
      title="指令详情"
      subtitle="查看调度指令的审批执行与流转记录"
      icon="ri:send-plane-line"
      width="420px"
    >
      <template v-if="detail">
        <ProDetailSection flush>
          <ProDetailRow icon="ri:file-list-line" label="编号" :value="detail.instruction_code" mono />
          <ProDetailRow icon="ri:apps-2-line" label="类型" :value="typeLabel(detail.instruction_type)" />
          <ProDetailRow icon="ri:file-text-line" label="内容" top>
            <div v-if="detail.content" class="dd-desc">{{ detail.content }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">暂无内容</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:user-shared-line" label="发布人" :value="detail.publisher_name" />
          <ProDetailRow icon="ri:user-line" label="执行人" :value="detail.executor_name" />
          <ProDetailRow
            icon="ri:calendar-check-line"
            label="预计完成"
            :value="formatDateTime(detail.expected_finish_time, false)"
            mono
          />
          <ProDetailRow icon="ri:shield-check-line" label="审核">
            <span class="dd-pill" :class="auditPill(detail.audit_status)">
              {{ auditLabel(detail.audit_status) }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:pulse-line" label="执行">
            <span class="dd-pill" :class="execPill(detail.execute_status)">
              {{ execLabel(detail.execute_status) }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:chat-3-line" label="审核意见" top>
            <div v-if="detail.audit_comment" class="dd-desc">{{ detail.audit_comment }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">暂无审核意见</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:chat-1-line" label="执行反馈" top>
            <div v-if="detail.execute_feedback" class="dd-desc">{{ detail.execute_feedback }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">暂无执行反馈</span>
            </div>
          </ProDetailRow>
        </ProDetailSection>

        <!-- 流转记录：彩色时间线（与告警处理日志同形制） -->
        <ProDetailSection icon="ri:time-line" title="流转记录" :count="`${(detail.logs || []).length} 条记录`">
          <ul v-if="(detail.logs || []).length" class="dd-timeline">
            <li v-for="(log, i) in detail.logs" :key="i" class="dd-tl">
              <span class="dd-tl-rail" aria-hidden>
                <i class="dd-tl-dot" />
              </span>
              <div class="dd-tl-body">
                <p class="dd-tl-action">{{ log.action }} · {{ log.operator_name || '系统' }}</p>
                <p v-if="log.detail" class="dd-tl-detail">{{ log.detail }}</p>
                <p class="dd-tl-time">
                  <ArtSvgIcon class="tl-time-icon" icon="ri:time-line" />
                  {{ formatDateTime(log.created_at, false) }}
                </p>
              </div>
            </li>
          </ul>
          <el-empty v-else :image-size="80" description="暂无流转记录" />
        </ProDetailSection>
      </template>
    </ProDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRef } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { AlarmClock, Clock, Notification, TrendCharts } from '@element-plus/icons-vue'
import {
  auditDispatch,
  auditLabel,
  completeDispatch,
  createDispatch,
  deleteDispatch,
  execLabel,
  fetchDispatchStats,
  getDispatch,
  listDispatches,
  priorityLabel,
  priorityType,
  typeLabel,
  updateDispatch,
  type DispatchItem,
  type DispatchStats,
} from '@/api/dispatch'
import { optionsResource } from '@/api/system'
import { usePermissions } from '@/utils/permissions'
import { useFocusRow } from '@/composables/useFocusRow'
import { useQueryState } from '@/composables/useQueryState'
import { formatDateTime } from '@/utils/time'
import { STATUS_COLORS } from '@/constants/status'
import { celebrateClosedLoop } from '@/utils/feedback'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProDialog from '@/components/ProDialog.vue'
import KpiCard from '@/components/KpiCard.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'

// 跨页焦点定位：工作台带 ?focus=指令编号 跳转时高亮定位行
const { focus, banner, rowClassName, locate, dismiss } = useFocusRow('instruction_code')

const loading = ref(false)
const rows = ref<DispatchItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const stats = ref<DispatchStats | null>(null)

const query = reactive<{
  keyword: string
  audit_status: string | undefined
  execute_status: string | undefined
  date_range: string[] | null
}>({
  keyword: '',
  audit_status: undefined,
  execute_status: undefined,
  date_range: null,
})

// 筛选/页码与 URL query 双向同步（dateRange 为数组类型，无法安全序列化到 query，不同步）
useQueryState(
  reactive({
    keyword: toRef(query, 'keyword'),
    auditStatus: toRef(query, 'audit_status'),
    executeStatus: toRef(query, 'execute_status'),
    page,
  }),
)

const searchItems: SearchFormItem[] = [
  {
    key: 'audit_status',
    label: '审核状态',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '审核状态',
      options: [
        { label: '待审批', value: 'pending' },
        { label: '已通过', value: 'approved' },
        { label: '已驳回', value: 'rejected' },
      ],
    },
  },
  {
    key: 'date_range',
    label: '时间',
    type: 'daterange',
    span: 8,
    props: {
      type: 'daterange',
      valueFormat: 'YYYY-MM-DD',
      startPlaceholder: '开始',
      endPlaceholder: '结束',
      style: 'width: 100%',
    },
  },
  {
    key: 'keyword',
    type: 'input',
    props: { clearable: true, placeholder: '内容/编号/执行人' },
  },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'instruction_code', label: '指令编号', width: 160 },
  { prop: 'instruction_type', label: '类型', width: 100, align: 'center' },
  { prop: 'content', label: '指令内容', minWidth: 180, showOverflowTooltip: true },
  { prop: 'publisher_name', label: '发布人', width: 100 },
  { prop: 'publish_time', label: '发布时间', width: 120 },
  { prop: 'priority', label: '优先级', width: 90, align: 'center' },
  { prop: 'audit_status', label: '审核', width: 90, align: 'center' },
  { prop: 'execute_status', label: '执行', width: 90, align: 'center' },
  { prop: 'operation', label: '操作', width: 182, fixed: 'right', align: 'center' },
])

const exportColumns = [
  { prop: 'instruction_code', label: '指令编号' },
  { prop: 'instruction_type', label: '类型', formatter: (r: any) => typeLabel(r.instruction_type) },
  { prop: 'content', label: '指令内容' },
  { prop: 'publisher_name', label: '发布人' },
  { prop: 'publish_time', label: '发布时间' },
  { prop: 'priority', label: '优先级', formatter: (r: any) => priorityLabel(r.priority) },
  { prop: 'audit_status', label: '审核', formatter: (r: any) => auditLabel(r.audit_status) },
  { prop: 'execute_status', label: '执行', formatter: (r: any) => execLabel(r.execute_status) },
]

const formVisible = ref(false)
const auditVisible = ref(false)
const completeVisible = ref(false)
const detailVisible = ref(false)
const current = ref<DispatchItem | null>(null)
const detail = ref<DispatchItem | null>(null)
const auditForm = reactive<{ comment: string }>({ comment: '' })
const executeFeedback = ref('')
const users = ref<{ id: number; username: string; display_name: string }[]>([])

const form = reactive({
  id: null as number | null,
  instruction_type: 'internal',
  content: '',
  executor_id: undefined as number | undefined,
  expected_finish_time: '',
  priority: 'normal',
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  instruction_type: [{ required: true, message: '请选择指令类型', trigger: 'change' }],
  content: [{ required: true, message: '请填写指令内容', trigger: 'blur' }],
  executor_id: [{ required: true, message: '请选择执行人', trigger: 'change' }],
  expected_finish_time: [{ required: true, message: '请选择预计完成时间', trigger: 'change' }],
  priority: [{ required: true, message: '请选择优先级', trigger: 'change' }],
}
const auditFormRef = ref<FormInstance>()
const auditRules: FormRules = {
  comment: [{ required: true, message: '请填写审核意见', trigger: 'blur' }],
}

const { myId, hasPerm } = usePermissions()

/** 是否有筛选条件激活（用于空结果引导） */
const hasActiveFilter = computed(
  () => !!(query.keyword || query.audit_status || query.date_range?.length),
)

/** 按钮级权限（与后端一致：审核需权限；完成仅指派人；编辑/删除仅发布人或具备权限） */
function canAudit(row: DispatchItem) {
  return row.audit_status === 'pending' && hasPerm('dispatch:audit')
}
function canEdit(row: DispatchItem) {
  return (
    row.audit_status === 'pending' &&
    (row.publisher_id === myId.value || hasPerm('dispatch:update'))
  )
}
function canDelete(row: DispatchItem) {
  return (
    row.audit_status === 'pending' &&
    (row.publisher_id === myId.value || hasPerm('dispatch:delete'))
  )
}
function canComplete(row: DispatchItem) {
  // 执行完毕：被指派执行人本人，或具备执行权限
  return (
    row.audit_status === 'approved' &&
    row.execute_status === 'pending' &&
    (row.executor_id === myId.value || hasPerm('dispatch:execute'))
  )
}

const kpis = computed(() => {
  const s = stats.value
  return [
    {
      key: 'all',
      label: '全部指令',
      value: s?.total ?? 0,
      desc: `今日 ${s?.today_count ?? 0} 条`,
      color: STATUS_COLORS.primary,
      icon: Notification,
    },
    {
      key: 'pending_execute',
      label: '待处理指令',
      value: s?.pending_execute ?? 0,
      desc: '已审批待执行',
      color: STATUS_COLORS.warning,
      icon: AlarmClock,
    },
    {
      key: 'pending_audit',
      label: '待审批指令',
      value: s?.pending_audit ?? 0,
      desc: '等待领导复核',
      color: STATUS_COLORS.danger,
      icon: Clock,
    },
    {
      key: 'done',
      label: '执行完成率',
      value: `${s?.completion_rate ?? 0}%`,
      desc: `已完成 ${s?.done ?? 0} / 共 ${s?.total ?? 0}`,
      color: STATUS_COLORS.success,
      icon: TrendCharts,
    },
  ]
})

async function loadStats() {
  const { data } = await fetchDispatchStats()
  stats.value = data.data
}

async function load() {
  loading.value = true
  try {
    const { data } = await listDispatches({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
      audit_status: query.audit_status,
      execute_status: query.execute_status,
      start_date: query.date_range?.[0],
      end_date: query.date_range?.[1],
    })
    rows.value = data.data.items
    total.value = data.data.total
    await loadStats()
    // 数据就绪后执行焦点行滚动定位
    await locate()
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  load()
}

function reset() {
  query.keyword = ''
  query.audit_status = undefined
  query.execute_status = undefined
  query.date_range = null
  activeKpi.value = null
  page.value = 1
  load()
}

/** KPI 卡片点击 → 快捷筛选（再次点击同卡或点 all 取消筛选） */
const activeKpi = ref<string | null>(null)
const KPI_FILTER_MAP: Record<string, { audit_status?: string; execute_status?: string }> = {
  all: {},
  pending_execute: { audit_status: 'approved', execute_status: 'pending' },
  pending_audit: { audit_status: 'pending' },
  done: { execute_status: 'done' },
}
function onKpiClick(key: string) {
  // 再次点击同卡 → 取消 KPI 筛选（保留其他 filter bar 条件）
  if (activeKpi.value === key) {
    activeKpi.value = null
    query.audit_status = undefined
    query.execute_status = undefined
  } else {
    activeKpi.value = key
    const map = KPI_FILTER_MAP[key] || {}
    query.audit_status = map.audit_status
    query.execute_status = map.execute_status
  }
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
  Object.assign(form, {
    id: null,
    instruction_type: 'internal',
    content: '',
    executor_id: undefined,
    expected_finish_time: '',
    priority: 'normal',
  })
  formVisible.value = true
}

function openEdit(row: DispatchItem) {
  Object.assign(form, {
    id: row.id,
    instruction_type: row.instruction_type,
    content: row.content,
    executor_id: row.executor_id,
    expected_finish_time: row.expected_finish_time?.slice(0, 19),
    priority: row.priority,
  })
  formVisible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload = {
    instruction_type: form.instruction_type,
    content: form.content,
    executor_id: form.executor_id,
    expected_finish_time: form.expected_finish_time,
    priority: form.priority,
  }
  if (form.id) await updateDispatch(form.id, payload)
  else await createDispatch(payload)
  ElMessage.success('保存成功')
  formVisible.value = false
  await load()
}

async function onDelete(row: DispatchItem) {
  await deleteDispatch(row.id)
  ElMessage.success('已删除')
  await load()
}

function openAudit(row: DispatchItem) {
  current.value = row
  auditForm.comment = ''
  auditVisible.value = true
}

async function onAudit(passed: boolean) {
  if (!current.value) return
  const valid = await auditFormRef.value?.validate().catch(() => false)
  if (!valid) return
  await auditDispatch(current.value.id, { passed, comment: auditForm.comment })
  ElMessage.success(passed ? '已通过' : '已驳回')
  auditVisible.value = false
  await load()
}

function openComplete(row: DispatchItem) {
  current.value = row
  executeFeedback.value = ''
  completeVisible.value = true
}

async function onComplete() {
  if (!current.value) return
  const row = current.value
  await completeDispatch(row.id, executeFeedback.value || undefined)
  completeVisible.value = false
  // 闭环轻庆祝：执行完毕的正向反馈
  celebrateClosedLoop('调度指令执行完毕', `指令 ${row.instruction_code} 已完成`)
  await load()
}

async function openDetail(row: DispatchItem) {
  const { data } = await getDispatch(row.id)
  detail.value = data.data
  detailVisible.value = true
}

// 详情抽屉胶囊色系（dd-pill）：审核 pending橙/approved绿/rejected红；执行 pending灰/executing蓝/done绿
function auditPill(v: string) {
  return ({ pending: 'is-orange', approved: 'is-green', rejected: 'is-red' } as Record<string, string>)[v] || 'is-gray'
}
function execPill(v: string) {
  return ({ pending: 'is-gray', executing: 'is-blue', done: 'is-green' } as Record<string, string>)[v] || 'is-gray'
}

onMounted(async () => {
  // 人员下拉用轻量选项接口：/system/users 需要 sys:user:list，业务角色无此权限
  const { data } = await optionsResource('/system/users/options')
  users.value = data.data as unknown as typeof users.value
  await load()
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 统一：搜索栏与表格卡片间距 12px（对齐维保计划） */
.page > .art-table-card {
  margin-top: 0;
}
/* KPI 面板与下方内容仅保留一层 12px 间距（对齐档案页，避免 gap+margin 叠加成 26px） */
.page .kpi-panel {
  margin-bottom: 0;
}
</style>

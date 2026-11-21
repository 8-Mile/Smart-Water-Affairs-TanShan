<template>
  <div class="page">
    <!-- 消息通知跳转定位：命中行高亮，可手动关闭 -->
    <el-alert
      v-if="banner"
      class="focus-banner"
      type="info"
      :title="`已从消息通知定位到维保任务`"
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
      <div class="card-head">
        <span class="head-badge"><ArtSvgIcon icon="ri:clipboard-line" /></span>
        <span class="head-title">维保记录</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="维保记录"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('maint:record:create')" class="btn-gradient" type="primary" @click="openCreate">
            <ArtSvgIcon icon="ri:add-line" style="margin-right: 4px" />临时维保
          </el-button>
        </template>
      </ProTableHeader>
      <ProTable
        :data="rows"
        :loading="loading"
        :columns="tableColumns"
        :row-class-name="rowClassName"
        row-key="id"
        :pagination="{ current: page, size: pageSize, total }"
        @page-change="onPage"
        @size-change="onSize"
      >
        <template #maintain_type="{ row }">
          <el-tag type="info" size="small" effect="light">{{ typeLabel(row.maintain_type) }}</el-tag>
        </template>
        <template #due_date="{ row }">
          <!-- 彩色文字（无圆点）：红=逾期，蓝=正常 -->
          <span class="due-state" :class="overdueDays(row) !== null ? 'is-red' : 'is-normal'">
            {{ row.due_date || '—' }}
            <span v-if="overdueDays(row) !== null" class="tip">逾期{{ overdueDays(row) }}天</span>
          </span>
        </template>
        <template #record_status="{ row }">
          <el-tag
            :type="row.record_status === 'done' ? 'success' : row.record_status === 'pending_accept' ? 'warning' : 'info'"
            size="small"
            effect="light"
          >
            {{ recordStatusLabel(row.record_status) }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable
              v-if="
                row.record_status === 'pending' &&
                hasPerm('maint:record:complete') &&
                (isManager || row.operator_id === myId)
              "
              icon="ri:checkbox-circle-line"
              icon-class="bg-theme/12 text-theme"
              title="执行"
              label="执行"
              @click="openComplete(row)"
            />
            <!-- 发现异常已转维修工单：跳转定位关联工单（生成工单那一刻即出现） -->
            <ArtButtonTable
              v-if="row.repair_order_no"
              icon="ri:link"
              icon-class="bg-success/12 text-success"
              title="关联工单"
              label="关联工单"
              @click="goRepairOrder(row)"
            />
            <ArtButtonTable
              v-if="row.record_status === 'pending_accept' && hasPerm('maint:record:accept')"
              icon="ri:shield-check-line"
              icon-class="bg-success/12 text-success"
              title="验收"
              label="验收"
              @click="openAccept(row)"
            />
            <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
            <ArtButtonTable type="view" title="详情" label="详情" @click="openDetail(row)" />
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="createVisible" title="临时维保录入" width="520px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="设备" prop="equipment_id" required>
          <EquipmentTreeSelect v-model="createForm.equipment_id" :options="equipments" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="createForm.maintain_type" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:tools-line" /></span>
            </template>
            <el-option label="检修" value="overhaul" />
            <el-option label="润滑" value="lubrication" />
          </el-select>
        </el-form-item>
        <el-form-item label="内容" prop="content" required>
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="createForm.content" type="textarea" />
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:sticky-note-line" /></span>
            <el-input v-model="createForm.remark" type="textarea" :rows="2" placeholder="选填" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="onCreate">保存</el-button>
      </template>
    </ProDialog>

    <ProDialog v-model="completeVisible" title="执行维保" width="520px">
      <el-form ref="completeFormRef" :model="completeForm" :rules="completeRules" label-width="90px">
        <el-form-item label="内容">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="completeForm.content" type="textarea" />
          </div>
        </el-form-item>
        <!-- 执行结果：发现异常时自动转维修工单（source=maintenance），走独立派单/处理/验收闭环 -->
        <el-form-item label="执行结果">
          <el-radio-group v-model="completeForm.result">
            <el-radio value="normal">正常完成</el-radio>
            <el-radio value="issue">发现异常</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="completeForm.result === 'issue'" label="发现问题" prop="issue_found">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:alarm-warning-line" /></span>
            <el-input
              v-model="completeForm.issue_found"
              type="textarea"
              :rows="3"
              placeholder="描述发现的问题，提交后自动生成维修工单待派单"
            />
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="completeForm.remark">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            </template>
          </el-input>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="completeVisible = false">取消</el-button>
        <el-button type="primary" @click="onComplete">提交</el-button>
      </template>
    </ProDialog>

    <ProDialog v-model="acceptVisible" title="维保验收" width="480px">
      <el-form :model="acceptForm" label-width="90px">
        <el-form-item label="验收结论" required>
          <el-radio-group v-model="acceptForm.passed">
            <el-radio-button :value="true">通过</el-radio-button>
            <el-radio-button :value="false">驳回</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="acceptForm.passed ? '验收意见' : '驳回理由'">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:chat-1-line" /></span>
            <el-input
              v-model="acceptForm.comment"
              type="textarea"
              :rows="3"
              :placeholder="acceptForm.passed ? '选填' : '驳回时必填，说明退回原因'"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="acceptVisible = false">取消</el-button>
        <el-button :type="acceptForm.passed ? 'primary' : 'danger'" @click="onAccept">
          {{ acceptForm.passed ? '确认通过' : '确认驳回' }}
        </el-button>
      </template>
    </ProDialog>

    <!-- 维保记录详情（只读，统一 ProDetailDrawer 形制） -->
    <ProDetailDrawer
      v-model="detailVisible"
      title="维保记录详情"
      subtitle="查看维保执行的完整内容与结果"
      icon="ri:file-list-3-line"
      :border-tone="recordTone"
    >
      <template v-if="detailData">
        <ProDetailSection flush>
          <ProDetailRow icon="ri:tools-line" label="设备" :value="equipmentText" />
          <ProDetailRow icon="ri:apps-2-line" label="类型" :value="typeLabel(detailData.maintain_type)" />
          <ProDetailRow icon="ri:calendar-check-line" label="来源计划" :value="detailData.plan_name || '临时维保'" />
          <ProDetailRow icon="ri:calendar-line" label="到期日" :value="detailData.due_date || '—'" mono />
          <ProDetailRow icon="ri:pulse-line" label="状态">
            <span
              class="dd-pill"
              :class="detailData.record_status === 'done' ? 'is-green' : detailData.record_status === 'pending_accept' ? 'is-orange' : 'is-gray'"
            >
              {{ recordStatusLabel(detailData.record_status) }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:user-line" label="操作人" :value="detailData.operator_name || '—'" />
          <ProDetailRow
            icon="ri:time-line"
            label="操作时间"
            :value="detailData.operate_time ? formatDateTime(detailData.operate_time, false) : '—'"
            mono
          />
          <ProDetailRow icon="ri:file-text-line" label="内容" top>
            <div v-if="detailData.content" class="dd-desc">{{ detailData.content }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">暂无内容</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:sticky-note-line" label="备注" top>
            <div v-if="detailData.remark" class="dd-desc">{{ detailData.remark }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">暂无备注</span>
            </div>
          </ProDetailRow>
          <!-- 验收信息：need_accept 计划的任务完成后由验收人填写 -->
          <ProDetailRow v-if="detailData.acceptor_name" icon="ri:shield-check-line" label="验收人" :value="detailData.acceptor_name" />
          <ProDetailRow
            v-if="detailData.accept_time"
            icon="ri:time-line"
            label="验收时间"
            :value="formatDateTime(detailData.accept_time, false)"
            mono
          />
          <ProDetailRow v-if="detailData.accept_comment" icon="ri:chat-1-line" label="验收意见" top>
            <div class="dd-desc">{{ detailData.accept_comment }}</div>
          </ProDetailRow>
        </ProDetailSection>
      </template>
    </ProDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  acceptMaintRecord,
  completeMaintRecord,
  createMaintRecord,
  listMaintRecords,
  recordStatusLabel,
  typeLabel,
  type MaintRecord,
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
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import { usePermissions } from '@/utils/permissions'
import { useFocusRow } from '@/composables/useFocusRow'
import { useReloadPage } from '@/composables/useReloadPage'
import { formatDateTime } from '@/utils/time'

const { hasPerm, isManager, myId, isMineScope } = usePermissions()
const router = useRouter()
// 消息通知跳转定位：?focus=<记录id> 命中行高亮 + 滚动定位（列表加载后调用 locate）
const { focus, banner, rowClassName, locate, dismiss } = useFocusRow('id')
useReloadPage(() => load())
const loading = ref(false)
const rows = ref<MaintRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const equipments = ref<OptionItem[]>([])
const createVisible = ref(false)
const completeVisible = ref(false)
// 执行弹窗当前行：提交后本地同步工单号，「关联工单」按钮立即出现（无需等列表刷新）
const currentRow = ref<MaintRecord | null>(null)

/* 记录详情抽屉 */
const detailVisible = ref(false)
const detailData = ref<MaintRecord | null>(null)
// 详情抽屉呼吸边框色：已完成绿 / 未开始橙
const recordTone = computed(() => {
  const d = detailData.value
  if (!d) return undefined
  return d.record_status === 'done' ? 'green' : 'orange'
})
const equipmentText = computed(() => {
  const d = detailData.value
  if (!d) return '—'
  return d.equipment_code ? `${d.equipment_name || '—'}（${d.equipment_code}）` : d.equipment_name || '—'
})
function openDetail(row: MaintRecord) {
  detailData.value = row
  detailVisible.value = true
}

const query = reactive<Record<string, any>>({
  keyword: '',
  maintain_type: undefined,
  record_status: undefined,
  // mine 数据范围（操作员）默认只看指派给自己的任务（一线执行视角），管理角色默认全量
  mine: isMineScope.value,
})

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '关键字', type: 'input', props: { clearable: true, placeholder: '设备/计划' } },
  {
    key: 'maintain_type',
    label: '类型',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '全部',
      options: [
        { label: '检修', value: 'overhaul' },
        { label: '润滑', value: 'lubrication' },
      ],
    },
  },
  {
    key: 'record_status',
    label: '状态',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '全部',
      options: [
        { label: '未开始', value: 'pending' },
        { label: '待验收', value: 'pending_accept' },
        { label: '已完成', value: 'done' },
      ],
    },
  },
  { key: 'mine', label: '只看我的', type: 'switch', labelWidth: '80px' },
]

/* 未开始且已过到期日的任务 → 返回逾期天数 */
function overdueDays(row: MaintRecord): number | null {
  if (row.record_status !== 'pending' || !row.due_date) return null
  const d = new Date(`${row.due_date}T00:00:00`)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.round((now.getTime() - d.getTime()) / 86400000)
  return diff > 0 ? diff : null
}

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'equipment_code', label: '设备编号', width: 120 },
  { prop: 'equipment_name', label: '设备名称', minWidth: 120, showOverflowTooltip: true },
  { prop: 'maintain_type', label: '类型', width: 90, align: 'center' },
  { prop: 'plan_name', label: '来源计划', minWidth: 120, showOverflowTooltip: true },
  { prop: 'due_date', label: '到期日', width: 200 },
  { prop: 'record_status', label: '状态', width: 100, align: 'center' },
  { prop: 'operator_name', label: '操作人', width: 100 },
  { prop: 'content', label: '内容', minWidth: 140, showOverflowTooltip: true },
  // 操作列宽按最多 3 个图标按钮（执行/关联工单/验收 + 详情）紧凑适配，详情固定排最右
  { prop: 'operation', label: '操作', width: 150, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'equipment_code', label: '设备编号' },
  { prop: 'equipment_name', label: '设备名称' },
  { prop: 'maintain_type', label: '类型', formatter: (r: MaintRecord) => typeLabel(r.maintain_type) },
  { prop: 'plan_name', label: '来源计划' },
  {
    prop: 'due_date',
    label: '到期日',
    formatter: (r: MaintRecord) => {
      const d = overdueDays(r)
      return d !== null ? `${r.due_date}（逾期${d}天）` : r.due_date || '—'
    },
  },
  { prop: 'record_status', label: '状态', formatter: (r: MaintRecord) => recordStatusLabel(r.record_status) },
  { prop: 'operator_name', label: '操作人' },
  { prop: 'content', label: '内容' },
]

const createForm = reactive({
  equipment_id: undefined as number | undefined,
  maintain_type: 'overhaul',
  content: '',
  remark: '',
})
const completeForm = reactive({
  content: '',
  remark: '',
  result: 'normal' as 'normal' | 'issue',
  issue_found: '',
})
/* 验收弹窗：通过→done；驳回→退回待执行 */
const acceptVisible = ref(false)
const acceptForm = reactive({ id: 0, passed: true, comment: '' })

const createFormRef = ref<FormInstance>()
const createRules: FormRules = {
  equipment_id: [{ required: true, message: '请选择设备', trigger: 'change' }],
  content: [{ required: true, message: '请填写内容', trigger: 'blur' }],
}
const completeFormRef = ref<FormInstance>()
const completeRules: FormRules = {
  issue_found: [
    {
      validator: (_r, v: string, cb) => {
        if (completeForm.result === 'issue' && !v?.trim()) cb(new Error('请描述发现的问题'))
        else cb()
      },
      trigger: 'blur',
    },
  ],
}

async function load() {
  loading.value = true
  try {
    const { data } = await listMaintRecords({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
      maintain_type: query.maintain_type,
      record_status: query.record_status,
      mine: query.mine ? 1 : undefined,
    })
    rows.value = data.data.items
    total.value = data.data.total
  } finally {
    loading.value = false
  }
  // 列表渲染后滚动定位到通知指向的行（autoLocate watch 触发时数据可能未就绪，这里兜底）
  void locate()
}

function onSearch() {
  page.value = 1
  load()
}
function onReset() {
  query.keyword = ''
  query.maintain_type = undefined
  query.record_status = undefined
  query.mine = isMineScope.value
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
  createForm.equipment_id = undefined
  createForm.maintain_type = 'overhaul'
  createForm.content = ''
  createForm.remark = ''
  createVisible.value = true
}

async function onCreate() {
  const valid = await createFormRef.value?.validate().catch(() => false)
  if (!valid) return
  await createMaintRecord({ ...createForm })
  ElMessage.success('已录入')
  createVisible.value = false
  await load()
}

function openComplete(row: MaintRecord) {
  currentRow.value = row
  completeForm.content = row.content || ''
  completeForm.remark = ''
  completeForm.result = 'normal'
  completeForm.issue_found = ''
  completeVisible.value = true
}

async function onComplete() {
  if (!currentRow.value) return
  const valid = await completeFormRef.value?.validate().catch(() => false)
  if (!valid) return
  const { data } = await completeMaintRecord(currentRow.value.id, {
    content: completeForm.content,
    remark: completeForm.remark,
    issue_found: completeForm.result === 'issue' ? completeForm.issue_found.trim() : '',
  })
  const orderNo = data?.data?.repair_order_no
  // 本地同步关联状态：生成工单那一刻「关联工单」按钮即出现
  if (orderNo && currentRow.value) currentRow.value.repair_order_no = orderNo
  ElMessage.success(orderNo ? `已提交验收，发现异常已转维修工单 ${orderNo}` : '已提交验收')
  completeVisible.value = false
  await load()
}

// 跳转维修工单列表并定位高亮关联工单（与巡检/告警页同款交互）
function goRepairOrder(row: MaintRecord) {
  if (!row.repair_order_no) return
  router.push({ path: '/repair/list', query: { focus: row.repair_order_no } })
}

function openAccept(row: MaintRecord) {
  if (!hasPerm('maint:record:accept')) return
  acceptForm.id = row.id
  acceptForm.passed = true
  acceptForm.comment = ''
  acceptVisible.value = true
}

async function onAccept() {
  if (!acceptForm.passed && !acceptForm.comment.trim()) {
    ElMessage.warning('驳回时请填写驳回理由')
    return
  }
  await acceptMaintRecord(acceptForm.id, {
    passed: acceptForm.passed,
    comment: acceptForm.comment.trim() || undefined,
  })
  ElMessage.success(acceptForm.passed ? '验收通过' : '已驳回，退回待执行')
  acceptVisible.value = false
  await load()
}

onMounted(async () => {
  const { data } = await optionsResource('/equipment/options')
  equipments.value = data.data
  await load()
})
// keep-alive / tab 切换回来时重新加载，确保数据实时
onActivated(() => {
  load()
})
</script>

<style lang="scss" scoped>
.page {
  gap: 12px;
}
/* 统一：搜索栏与表格卡片间距 12px（对齐维保计划） */
.page > .art-table-card {
  margin-top: 0;
}
.muted {
  color: var(--art-gray-500);
}
/* 消息通知跳转定位提示条 */
.focus-banner {
  margin-bottom: 12px;
}
/* 到期日：彩色文字 */
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

  &.is-red {
    color: #f03d45;
    font-weight: 600;

    .tip {
      color: #f03d45;
    }
  }
}
</style>

<template>
  <div class="page">
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="onReset"
    />
    <el-card shadow="never" class="art-table-card">
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="巡检计划"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('insp:plan:create')" class="btn-gradient" type="primary" @click="openCreate">
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
        <template #items="{ row }">{{ formatInspItems(row.items) }}</template>
        <template #frequency="{ row }">{{ freqLabel(row.frequency) }}</template>
        <template #date_range="{ row }">{{ row.start_date }} ~ {{ row.end_date }}</template>
        <template #enabled="{ row }">
          <el-tag :type="row.enabled === 1 ? 'success' : 'info'" size="small" effect="light">
            {{ row.enabled === 1 ? '是' : '否' }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('insp:task:create')" icon="ri:send-plane-line" icon-class="bg-success/12 text-success" title="手动派发" label="手动派发" @click="openDispatch(row)" />
            <ArtButtonTable v-if="hasPerm('insp:plan:update')" type="edit" title="编辑" label="编辑" @click="openEdit(row)" />
            <DeleteConfirm
              v-if="hasPerm('insp:plan:delete')"
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

    <ProDialog v-model="visible" :title="form.id ? '编辑计划' : '新增计划'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="计划名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:edit-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="班组" prop="team_id" required>
          <el-select v-model="form.team_id" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:team-line" /></span>
            </template>
            <el-option v-for="t in teams" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始日期" prop="start_date" required>
          <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束日期" prop="end_date" required>
          <el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="频次" prop="frequency" required>
          <el-select v-model="form.frequency" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:repeat-line" /></span>
            </template>
            <el-option label="每日" value="day" />
            <el-option label="每周" value="week" />
            <el-option label="每月" value="month" />
          </el-select>
        </el-form-item>
        <el-form-item label="巡检设备" prop="items" required>
          <div class="insp-items-editor">
            <div v-if="!form.items.length" class="insp-items-empty">
              尚未添加巡检项，请点击下方「添加」选择设备并填写检查内容
            </div>
            <div v-for="(it, idx) in form.items" :key="idx" class="insp-item-row">
              <EquipmentTreeSelect
                v-model="it.equipment_id"
                :options="equipOptions"
                placeholder="选择设备"
                style="width: 220px"
                @update:model-value="(v) => onPickEquipment(it, Number(v))"
              />
              <el-input
                v-model="it.check_item"
                placeholder="检查项，如：泵温 / 振动 / 油位"
                style="flex: 1"
              />
              <el-button text type="danger" @click="form.items.splice(idx, 1)">
                <ArtSvgIcon icon="ri:delete-bin-5-line" />
              </el-button>
            </div>
            <el-button text type="primary" @click="addItem">
              <ArtSvgIcon icon="ri:add-line" />添加巡检项
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </ProDialog>

    <ProDialog v-model="dispatchVisible" title="派发巡检任务" width="480px">
      <el-form label-width="90px">
        <el-form-item label="计划">{{ dispatchPlan?.name }}</el-form-item>
        <el-form-item label="指派人员">
          <el-select
            v-model="assigneeId"
            filterable
            clearable
            placeholder="不指定则班组全员可执行"
            style="width: 100%"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:user-line" /></span>
            </template>
            <el-option
              v-for="u in assigneeOptions"
              :key="u.id"
              :label="u.display_name || u.username"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" @click="onDispatch">确认派发</el-button>
      </template>
    </ProDialog>

    <!-- 巡检计划详情（只读，不分权限；统一 ProDetailDrawer 形制） -->
    <ProDetailDrawer
      v-model="detailVisible"
      title="巡检计划详情"
      subtitle="查看巡检计划的班组安排与巡检项目"
      icon="ri:route-line"
    >
      <template v-if="detailData">
        <ProDetailSection flush>
          <ProDetailRow icon="ri:price-tag-3-line" label="计划名称" :value="detailData.name" />
          <ProDetailRow icon="ri:team-line" label="所属班组" :value="detailData.team_name || '—'" />
          <ProDetailRow icon="ri:calendar-line" label="开始日期" :value="detailData.start_date" mono />
          <ProDetailRow icon="ri:calendar-2-line" label="结束日期" :value="detailData.end_date" mono />
          <ProDetailRow icon="ri:loop-left-line" label="频次" :value="freqLabel(detailData.frequency)" />
          <ProDetailRow icon="ri:list-check-2" label="巡检设备" top>
            <div v-if="(detailData.items || []).length" class="dd-desc">
              {{ formatInspItems(detailData.items) }}
            </div>
            <div v-else class="dd-empty">
              <span class="dd-empty-dash">—</span>
              <span class="dd-empty-hint">未配置巡检设备</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:pulse-line" label="启用状态">
            <span class="dd-pill" :class="detailData.enabled === 1 ? 'is-green' : 'is-gray'">
              {{ detailData.enabled === 1 ? '启用' : '停用' }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:send-plane-line" label="上次派发" :value="detailData.last_dispatch_date || '—'" mono />
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  createInspPlan,
  deleteInspPlan,
  dispatchInspPlan,
  formatInspItems,
  listInspPlans,
  updateInspPlan,
  type InspectionItem,
  type InspectionPlan,
} from '@/api/inspection'
import { optionsResource } from '@/api/system'
import type { OptionItem } from '@/api/types'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ProDialog from '@/components/ProDialog.vue'
import EquipmentTreeSelect from '@/components/EquipmentTreeSelect.vue'
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()

interface UserItem {
  id: number
  username: string
  display_name: string
  role_code: string
  team_id?: number | null
}

const loading = ref(false)
const rows = ref<InspectionPlan[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const teams = ref<OptionItem[]>([])
/** 操作员池（全量加载，指派时按计划班组过滤） */
const users = ref<UserItem[]>([])
const dispatchVisible = ref(false)
const dispatchPlan = ref<InspectionPlan | null>(null)
const assigneeId = ref<number | undefined>(undefined)

/** 指派候选：仅该计划所属班组的操作员（任务归属计划班组，防止跨班组误派） */
const assigneeOptions = computed(() =>
  users.value.filter((u) => u.team_id != null && u.team_id === dispatchPlan.value?.team_id),
)
const detailVisible = ref(false)
const detailData = ref<InspectionPlan | null>(null)
function openDetail(row: InspectionPlan) {
  detailData.value = row
  detailVisible.value = true
}
const query = reactive<{ keyword: string; date_range: [string, string] | undefined }>({
  keyword: '',
  date_range: undefined,
})

const searchItems: SearchFormItem[] = [
  { key: 'keyword', type: 'input', props: { clearable: true, placeholder: '计划名称' } },
  {
    key: 'date_range',
    label: '起止时间',
    type: 'daterange',
    props: {
      type: 'daterange',
      valueFormat: 'YYYY-MM-DD',
      startPlaceholder: '开始日期',
      endPlaceholder: '结束日期',
      clearable: true,
      style: 'width: 100%',
    },
  },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'name', label: '计划名称', minWidth: 140, showOverflowTooltip: true },
  { prop: 'team_name', label: '班组', width: 120 },
  { prop: 'items', label: '项目', minWidth: 160, showOverflowTooltip: true },
  { prop: 'frequency', label: '频次', width: 80, align: 'center' },
  { prop: 'date_range', label: '起止', width: 200 },
  { prop: 'enabled', label: '启用', width: 80, align: 'center' },
  // 操作列宽按最多 4 个图标按钮（派发/编辑/删除/详情）紧凑适配，详情固定排最右
  { prop: 'operation', label: '操作', width: 200, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'name', label: '计划名称' },
  { prop: 'team_name', label: '班组' },
  { prop: 'items', label: '巡检设备', formatter: (r: any) => formatInspItems(r.items) },
  { prop: 'frequency', label: '频次', formatter: (r: any) => freqLabel(r.frequency) },
  {
    prop: 'date_range',
    label: '起止',
    formatter: (r: any) => `${r.start_date} ~ ${r.end_date}`,
  },
  { prop: 'enabled', label: '启用', formatter: (r: any) => (r.enabled === 1 ? '是' : '否') },
]

const form = reactive({
  id: null as number | null,
  name: '',
  team_id: undefined as number | undefined,
  start_date: '',
  end_date: '',
  frequency: 'day',
  items: [] as InspectionItem[],
  enabled: 1,
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写计划名称', trigger: 'blur' }],
  team_id: [{ required: true, message: '请选择班组', trigger: 'change' }],
  start_date: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  end_date: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  frequency: [{ required: true, message: '请选择频次', trigger: 'change' }],
}

// 设备选项（用于巡检设备编辑器）
const equipOptions = ref<OptionItem[]>([])

function addItem() {
  form.items.push({ equipment_id: null, equipment_name: null, check_item: '' })
}

function onPickEquipment(item: InspectionItem, equipmentId: number) {
  const opt = equipOptions.value.find((o) => o.id === equipmentId)
  item.equipment_name = opt?.name ?? null
}

async function loadEquipmentOptions() {
  try {
    const { data } = await optionsResource('/equipment/options')
    equipOptions.value = (data.data || []) as OptionItem[]
  } catch {
    equipOptions.value = []
  }
}

function freqLabel(f: string) {
  return ({ day: '日', week: '周', month: '月' } as Record<string, string>)[f] || f
}

async function load() {
  loading.value = true
  try {
    const { data } = await listInspPlans({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
      // 起止时间：与计划执行周期有交集即命中
      start_date_from: query.date_range?.[0],
      start_date_to: query.date_range?.[1],
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
  query.date_range = undefined
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

/** 供父级 Tab 切换时调用：清空筛选并按默认条件刷新 */
function resetFilters() {
  query.keyword = ''
  query.date_range = undefined
  page.value = 1
  load()
}
defineExpose({ resetFilters })

function openCreate() {
  if (!hasPerm('insp:plan:create')) return
  Object.assign(form, {
    id: null,
    name: '',
    team_id: undefined,
    start_date: '',
    end_date: '',
    frequency: 'day',
    items: [],
    enabled: 1,
  })
  visible.value = true
}

function openEdit(row: InspectionPlan) {
  if (!hasPerm('insp:plan:update')) return
  Object.assign(form, {
    id: row.id,
    name: row.name,
    team_id: row.team_id,
    start_date: row.start_date,
    end_date: row.end_date,
    frequency: row.frequency,
    items: (row.items || []).map((it) => ({
      equipment_id: it.equipment_id ?? null,
      equipment_name: it.equipment_name ?? null,
      check_item: it.check_item || '',
    })),
    enabled: row.enabled,
  })
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const validItems = form.items.filter((it) => it.equipment_id && it.check_item?.trim())
  if (!validItems.length) {
    ElMessage.warning('请至少添加一条巡检项（选择设备并填写检查项）')
    return
  }
  const payload = { ...form, items: validItems }
  delete (payload as { id?: number | null }).id
  if (form.id) await updateInspPlan(form.id, payload)
  else await createInspPlan(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

function openDispatch(row: InspectionPlan) {
  if (!hasPerm('insp:task:create')) return
  dispatchPlan.value = row
  assigneeId.value = undefined
  dispatchVisible.value = true
}

async function onDispatch() {
  if (!dispatchPlan.value) return
  await dispatchInspPlan(
    dispatchPlan.value.id,
    assigneeId.value ? { assignee_id: assigneeId.value } : undefined,
  )
  ElMessage.success('已派发今日任务')
  dispatchVisible.value = false
  await load()
}

async function onDelete(row: InspectionPlan) {
  if (!hasPerm('insp:plan:delete')) return
  await deleteInspPlan(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  const [teamsRes, usersRes] = await Promise.all([
    optionsResource('/system/teams/options'),
    // 人员下拉用轻量选项接口：/system/users 需要 sys:user:list，业务角色无此权限
    optionsResource('/system/users/options'),
  ])
  teams.value = teamsRes.data.data
  // 指派对象仅限操作员（与后端派发校验口径一致）
  users.value = (usersRes.data.data as unknown as UserItem[]).filter(
    (u) => u.role_code === 'operator',
  )
  await loadEquipmentOptions()
  await load()
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 巡检设备编辑器：每行 设备下拉 + 检查项输入 + 删除 */
.insp-items-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  background: #fafbfc;
}
.insp-items-empty {
  padding: 8px 12px;
  font-size: 12.5px;
  color: #909399;
  text-align: center;
  background: #fff;
  border-radius: 4px;
}
.insp-item-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
/* 表格卡片与搜索栏间距对齐巡检任务页（全局 .art-table-card 的 margin-top:12px 在此改为由 gap 提供） */
.page > .art-table-card {
  margin-top: 0;
}
</style>

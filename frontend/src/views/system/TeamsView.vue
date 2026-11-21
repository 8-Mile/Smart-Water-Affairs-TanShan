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
        export-filename="班组管理"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('sys:dept:create')" class="btn-gradient" type="primary" @click="openCreate">新增</el-button>
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
        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="light">
            {{ row.status === 1 ? '正常' : '禁用' }}
          </el-tag>
        </template>
        <template #member_names="{ row }">
          <span v-if="row.member_names?.length">{{ row.member_names.join('、') }}</span>
          <el-tag v-else size="small" type="warning" effect="plain">暂无成员</el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('sys:dept:update')" type="edit" title="编辑" @click="openEdit(row)" />
            <DeleteConfirm v-if="hasPerm('sys:dept:delete')" text="确认删除？" @confirm="onDelete(row)">
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑班组' : '新增班组'" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="班组名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:team-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="编码" prop="code" required>
          <el-input v-model="form.code">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:code-s-slash-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="所属部门">
          <el-select v-model="form.department_id" clearable style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:building-line" /></span>
            </template>
            <el-option v-for="d in depts" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="form.leader">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:user-star-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="班组成员">
          <el-select
            v-model="memberIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="选择班组成员（可多选）"
            style="width: 100%"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:group-line" /></span>
            </template>
            <el-option
              v-for="u in userOptions"
              :key="u.id"
              :label="memberLabel(u)"
              :value="u.id"
              :disabled="u.status !== 1"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="form.remark" type="textarea" />
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="1">正常</el-radio>
            <el-radio :value="0">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  createResource,
  deleteResource,
  listResource,
  optionsResource,
  updateResource,
} from '@/api/system'
import type { OptionItem } from '@/api/types'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProDialog from '@/components/ProDialog.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import { usePermissions } from '@/utils/permissions'

/** 组织主数据写操作走按钮权限码 */
const { hasPerm, hasAnyPerm } = usePermissions()

const loading = ref(false)
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const depts = ref<OptionItem[]>([])
/** 班组成员多选：v-model 仅持有用户 ID 标量数组（el-option value 同为 id，保证回显一致） */
const memberIds = ref<number[]>([])
interface MemberOption {
  id: number
  name: string
  status: number
  team_id?: number | null
  team_name?: string | null
}
const userOptions = ref<MemberOption[]>([])
const query = reactive({ keyword: '' })

/** 成员选项文案：禁用标注；已归属其他班组时提示（一人一班，勾选即调岗） */
function memberLabel(u: MemberOption): string {
  if (u.status !== 1) return `${u.name}（禁用）`
  if (u.team_id && u.team_id !== (form.id as number | null)) return `${u.name}（属：${u.team_name}）`
  return u.name
}

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '关键字', type: 'input', props: { clearable: true, placeholder: '班组名称/编码' } },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'name', label: '班组名称', minWidth: 140, showOverflowTooltip: true },
  { prop: 'code', label: '编码', width: 140 },
  { prop: 'department_name', label: '所属部门', minWidth: 120, showOverflowTooltip: true },
  { prop: 'leader', label: '负责人', width: 110 },
  { prop: 'member_names', label: '班组成员', minWidth: 200, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 90, align: 'center' },
  // 操作列：有编辑或删除权限之一即展示
  ...(hasAnyPerm(['sys:dept:update', 'sys:dept:delete'])
    ? [{ prop: 'operation', label: '操作', width: 120, fixed: 'right' as const, align: 'right' as const }]
    : []),
])

const exportColumns = [
  { prop: 'name', label: '班组名称' },
  { prop: 'code', label: '编码' },
  { prop: 'department_name', label: '所属部门' },
  { prop: 'leader', label: '负责人' },
  { prop: 'member_names', label: '班组成员', formatter: (r: any) => (r.member_names || []).join('、') },
  { prop: 'status', label: '状态', formatter: (r: any) => (r.status === 1 ? '正常' : '禁用') },
]

const form = reactive<Record<string, unknown>>({
  id: null,
  name: '',
  code: '',
  department_id: undefined,
  leader: '',
  remark: '',
  status: 1,
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写班组名称', trigger: 'blur' }],
  code: [{ required: true, message: '请填写编码', trigger: 'blur' }],
}

async function load() {
  loading.value = true
  try {
    const { data } = await listResource('/system/teams', {
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
    })
    rows.value = data.data.items as Record<string, unknown>[]
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
  if (!hasPerm('sys:dept:create')) return
  Object.assign(form, {
    id: null,
    name: '',
    code: '',
    department_id: undefined,
    leader: '',
    remark: '',
    status: 1,
  })
  memberIds.value = []
  visible.value = true
}

function openEdit(row: Record<string, unknown>) {
  if (!hasPerm('sys:dept:update')) return
  Object.assign(form, row)
  // 回填仅取 ID 数组，与 el-option :value=id 语义一致
  memberIds.value = Array.isArray(row.member_ids) ? (row.member_ids as number[]) : []
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload: Record<string, unknown> = { ...form, member_ids: memberIds.value }
  delete payload.id
  delete payload.department_name
  // member_names 为后端聚合展示字段，不入库
  delete payload.member_names
  if (form.id) {
    await updateResource('/system/teams', form.id as number, payload)
  } else {
    await createResource('/system/teams', payload)
  }
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

async function onDelete(row: Record<string, unknown>) {
  if (!hasPerm('sys:dept:delete')) return
  await deleteResource('/system/teams', row.id as number)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  const [deptRes, userRes] = await Promise.all([
    optionsResource('/system/departments/options'),
    optionsResource('/system/users/options'),
  ])
  depts.value = deptRes.data.data
  // users/options 较通用 OptionItem 多 status/team 字段，显式映射成本地成员选项类型
  userOptions.value = (
    userRes.data.data as Array<{
      id: number
      name: string
      status?: number
      team_id?: number | null
      team_name?: string | null
    }>
  ).map((u) => ({
    id: u.id,
    name: u.name,
    status: u.status ?? 1,
    team_id: u.team_id ?? null,
    team_name: u.team_name ?? null,
  }))
  await load()
})
</script>

<style lang="scss" scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 统一：搜索栏与表格卡片间距 12px（对齐维保计划） */
.page > .art-table-card {
  margin-top: 0;
}
</style>

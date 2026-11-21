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
        export-filename="机组管理"
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
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('sys:dept:update')" type="edit" title="编辑" @click="openEdit(row)" />
            <DeleteConfirm
              v-if="hasPerm('sys:dept:delete')"
              text="确认删除该单位？"
              @confirm="onDelete(row)"
            >
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑机组' : '新增机组'" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="机组名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:edit-line" /></span>
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
        <el-form-item label="位置">
          <el-select v-model="form.location_id" clearable style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:map-pin-line" /></span>
            </template>
            <el-option v-for="d in locations" :key="d.id" :label="d.name" :value="d.id" />
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
const locations = ref<OptionItem[]>([])
const query = reactive({ keyword: '' })

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '关键字', type: 'input', props: { clearable: true, placeholder: '机组名称/编码' } },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'name', label: '机组名称', minWidth: 140, showOverflowTooltip: true },
  { prop: 'code', label: '编码', width: 140 },
  { prop: 'location_name', label: '位置', minWidth: 120, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 90, align: 'center' },
  // 操作列：有编辑或删除权限之一即展示
  ...(hasAnyPerm(['sys:dept:update', 'sys:dept:delete'])
    ? [{ prop: 'operation', label: '操作', width: 120, fixed: 'right' as const, align: 'right' as const }]
    : []),
])

const exportColumns = [
  { prop: 'name', label: '机组名称' },
  { prop: 'code', label: '编码' },
  { prop: 'location_name', label: '位置' },
  { prop: 'status', label: '状态', formatter: (r: any) => (r.status === 1 ? '正常' : '禁用') },
]

const form = reactive<Record<string, unknown>>({
  id: null,
  name: '',
  code: '',
  location_id: undefined,
  remark: '',
  status: 1,
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写机组名称', trigger: 'blur' }],
  code: [{ required: true, message: '请填写编码', trigger: 'blur' }],
}

async function load() {
  loading.value = true
  try {
    const { data } = await listResource('/system/units', {
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
    location_id: undefined,
    remark: '',
    status: 1,
  })
  visible.value = true
}

function openEdit(row: Record<string, unknown>) {
  if (!hasPerm('sys:dept:update')) return
  Object.assign(form, row)
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload = { ...form }
  delete payload.id
  delete payload.location_name
  if (form.id) await updateResource('/system/units', form.id as number, payload)
  else await createResource('/system/units', payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

async function onDelete(row: Record<string, unknown>) {
  if (!hasPerm('sys:dept:delete')) return
  await deleteResource('/system/units', row.id as number)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  const { data } = await optionsResource('/system/locations/options')
  locations.value = data.data
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

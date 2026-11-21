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
        export-filename="SCADA测点"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('scada:point:create')" class="btn-gradient" type="primary" @click="openCreate">新增测点</el-button>
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
        <template #enabled="{ row }">
          <el-tag :type="row.enabled === 1 ? 'success' : 'info'" size="small" effect="light">
            {{ row.enabled === 1 ? '是' : '否' }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('scada:point:update')" type="edit" title="编辑" @click="openEdit(row)" />
            <ArtButtonTable v-if="hasPerm('scada:point:inject')" icon="ri:upload-2-line" icon-class="bg-warning/12 text-warning" title="注入" @click="openInject(row)" />
            <DeleteConfirm
              v-if="hasPerm('scada:point:delete')"
              :text="`确认删除测点 ${row.tag_name}？`"
              @confirm="onDelete(row)"
            >
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑测点' : '新增测点'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="测点名称" prop="tag_name" required>
          <el-input v-model="form.tag_name" placeholder="如 PLC1.Flow 或 700">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:gauge-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="NodeId" prop="node_id" required>
          <el-input v-model="form.node_id" placeholder="ns=1;i=686">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:code-s-slash-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="值类型">
          <el-select v-model="form.value_type" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:price-tag-3-line" /></span>
            </template>
            <el-option label="数值 number" value="number" />
            <el-option label="布尔 bool" value="bool" />
            <el-option label="字符串 string" value="string" />
          </el-select>
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="form.unit">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:building-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="仿真基值">
          <el-input-number v-model="form.sim_base" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="仿真振幅">
          <el-input-number v-model="form.sim_amplitude" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="仿真周期(秒)">
          <el-input-number v-model="form.sim_period_sec" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用采集">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
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

    <ProDialog v-model="injectVisible" title="手动注入测点值" width="420px">
      <el-form ref="injectFormRef" :model="injectForm" :rules="injectRules" label-width="80px">
        <el-form-item label="测点">{{ injectForm.tag_name }}</el-form-item>
        <el-form-item label="值">
          <el-input v-model="injectForm.value" placeholder="数值 / true/false">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:speed-line" /></span>
            </template>
          </el-input>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="injectVisible = false">取消</el-button>
        <el-button type="primary" @click="onInject">注入</el-button>
      </template>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  createScadaPoint,
  deleteScadaPoint,
  fetchScadaPoints,
  injectValue,
  updateScadaPoint,
  type ScadaPoint,
} from '@/api/scada'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProDialog from '@/components/ProDialog.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()

const loading = ref(false)
const rows = ref<ScadaPoint[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const injectVisible = ref(false)

const query = reactive<{ keyword: string }>({ keyword: '' })

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '关键字', type: 'input', props: { clearable: true, placeholder: '测点名/节点ID' } },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'tag_name', label: '测点名称', minWidth: 120 },
  { prop: 'node_id', label: 'NodeId', minWidth: 140, showOverflowTooltip: true },
  { prop: 'value_type', label: '类型', width: 90, align: 'center' },
  { prop: 'unit', label: '单位', width: 80, align: 'center' },
  { prop: 'latest_value', label: '最新值', width: 110 },
  { prop: 'description', label: '描述', minWidth: 120, showOverflowTooltip: true },
  { prop: 'enabled', label: '采集', width: 80, align: 'center' },
  { prop: 'operation', label: '操作', width: 160, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'tag_name', label: '测点名称' },
  { prop: 'node_id', label: 'NodeId' },
  { prop: 'value_type', label: '类型' },
  { prop: 'unit', label: '单位' },
  { prop: 'latest_value', label: '最新值' },
  { prop: 'description', label: '描述' },
  { prop: 'enabled', label: '采集', formatter: (r: any) => (r.enabled === 1 ? '是' : '否') },
]

const empty = () => ({
  id: null as number | null,
  tag_name: '',
  node_id: '',
  value_type: 'number',
  unit: '',
  description: '',
  sim_base: 0,
  sim_amplitude: 1,
  sim_period_sec: 60,
  enabled: 1,
  status: 1,
})
const form = reactive(empty())
const injectForm = reactive({ point_id: 0, tag_name: '', value: '' })

const formRef = ref<FormInstance>()
const rules: FormRules = {
  tag_name: [{ required: true, message: '请填写测点名称', trigger: 'blur' }],
  node_id: [{ required: true, message: '请填写 NodeId', trigger: 'blur' }],
}
const injectFormRef = ref<FormInstance>()
const injectRules: FormRules = {}

async function load() {
  loading.value = true
  try {
    const { data } = await fetchScadaPoints({
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
  Object.assign(form, empty())
  visible.value = true
}

function openEdit(row: ScadaPoint) {
  Object.assign(form, empty(), row)
  visible.value = true
}

function openInject(row: ScadaPoint) {
  injectForm.point_id = row.id
  injectForm.tag_name = row.tag_name
  injectForm.value = row.latest_value != null ? String(row.latest_value) : ''
  injectVisible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload = { ...form }
  delete (payload as { id?: number | null }).id
  if (form.id) await updateScadaPoint(form.id, payload)
  else await createScadaPoint(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

async function onInject() {
  const valid = await injectFormRef.value?.validate().catch(() => false)
  if (!valid) return
  let value: unknown = injectForm.value
  if (injectForm.value === 'true' || injectForm.value === 'false') {
    value = injectForm.value === 'true'
  } else if (!Number.isNaN(Number(injectForm.value)) && injectForm.value !== '') {
    value = Number(injectForm.value)
  }
  await injectValue({ point_id: injectForm.point_id, value })
  ElMessage.success('注入成功')
  injectVisible.value = false
  await load()
}

async function onDelete(row: ScadaPoint) {
  await deleteScadaPoint(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(load)
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

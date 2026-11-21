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
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:calendar-check-line" />
        </span>
        <span class="head-title">供水计划</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="供水计划"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('water:plan:create')" class="btn-gradient" type="primary" @click="openCreate">新增计划</el-button>
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
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('water:plan:update')" type="edit" title="编辑" @click="openEdit(row)" />
            <DeleteConfirm
              v-if="hasPerm('water:plan:delete')"
              text="确认删除该用水计划？"
              @confirm="onDelete(row)"
            >
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑计划' : '新增计划'" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="计划类型" prop="plan_type" required>
          <el-select v-model="form.plan_type" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:task-line" /></span>
            </template>
            <el-option label="日计划" value="day" />
            <el-option label="月计划" value="month" />
            <el-option label="年计划" value="year" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划日期" prop="plan_date" required>
          <el-date-picker v-model="form.plan_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划值(m³)" prop="plan_value" required>
          <el-input-number v-model="form.plan_value" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            </template>
          </el-input>
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
import { createWaterPlan, deleteWaterPlan, listWaterPlans, updateWaterPlan, type WaterPlan } from '@/api/water'
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
const rows = ref<WaterPlan[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const query = reactive<{ plan_type: string | undefined }>({ plan_type: undefined })

const searchItems: SearchFormItem[] = [
  {
    key: 'plan_type',
    label: '计划类型',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '计划类型',
      options: [
        { label: '日计划', value: 'day' },
        { label: '月计划', value: 'month' },
        { label: '年计划', value: 'year' },
      ],
    },
  },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'plan_date', label: '时间', width: 140 },
  { prop: 'plan_type', label: '计划类型', width: 110, align: 'center' },
  { prop: 'plan_value', label: '计划供水量(m³)', minWidth: 140 },
  { prop: 'remark', label: '备注', minWidth: 120, showOverflowTooltip: true },
  { prop: 'operation', label: '操作', width: 120, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'plan_date', label: '时间' },
  { prop: 'plan_type', label: '计划类型', formatter: (r: any) => typeLabel(r.plan_type) },
  { prop: 'plan_value', label: '计划供水量(m³)' },
  { prop: 'remark', label: '备注' },
]

const form = reactive({ id: null as number | null, plan_type: 'day', plan_date: '', plan_value: 0, remark: '' })

const formRef = ref<FormInstance>()
const rules: FormRules = {
  plan_type: [{ required: true, message: '请选择计划类型', trigger: 'change' }],
  plan_date: [{ required: true, message: '请选择计划日期', trigger: 'change' }],
  plan_value: [{ required: true, message: '请填写计划值', trigger: 'blur' }],
}

function typeLabel(t: string) {
  return ({ day: '日计划', month: '月计划', year: '年计划' } as Record<string, string>)[t] || t
}

async function load() {
  loading.value = true
  try {
    const { data } = await listWaterPlans({ page: page.value, page_size: pageSize.value, plan_type: query.plan_type })
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
  query.plan_type = undefined
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
  Object.assign(form, { id: null, plan_type: 'day', plan_date: '', plan_value: 0, remark: '' })
  visible.value = true
}
function openEdit(row: WaterPlan) {
  Object.assign(form, { id: row.id, plan_type: row.plan_type, plan_date: row.plan_date, plan_value: row.plan_value, remark: row.remark || '' })
  visible.value = true
}
async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload = { plan_type: form.plan_type, plan_date: form.plan_date, plan_value: form.plan_value, remark: form.remark }
  if (form.id) await updateWaterPlan(form.id, payload)
  else await createWaterPlan(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}
async function onDelete(row: WaterPlan) {
  await deleteWaterPlan(row.id)
  ElMessage.success('已删除')
  await load()
}
onMounted(load)
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
</style>

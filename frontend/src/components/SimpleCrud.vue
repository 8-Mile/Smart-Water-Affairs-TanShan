<template>
  <div class="page">
    <!-- 独立搜索区：搜索框单独一行（与设备列表/告警中心布局一致） -->
    <ProSearchBar
      v-if="searchable"
      v-model="searchModel"
      :items="searchItems"
      :span="8"
      @search="onSearch"
      @reset="onReset"
    />

    <el-card shadow="never" class="simple-crud-card art-table-card">
      <!-- 卡片标题栏：图标徽章 + 标题 + 科技线条 + 条数标签（沿用 title prop 驱动，与原 #header 行为一致） -->
      <div v-if="title" class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:list-settings-line" />
        </span>
        <span class="head-title">{{ title }}</span>
        <span class="head-deco" aria-hidden />
        <el-tag v-if="showCount" type="success" effect="light" round>{{ rows.length }} 条数据</el-tag>
      </div>

      <ProTableHeader
        v-model:columns="proColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        :export-filename="title || '数据导出'"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="canCreate" class="btn-gradient" type="primary" @click="openCreate">
            <ArtSvgIcon icon="ri:add-line" style="margin-right: 4px" />{{ createText }}
          </el-button>
        </template>
      </ProTableHeader>

      <ProTable
        :data="rows"
        :loading="loading"
        :columns="proColumns"
        :pagination="{ current: page, size: pageSize, total }"
        @page-change="onPageChange"
        @size-change="onPageSizeChange"
      >
        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'">
            {{ row.status === 1 ? '正常' : '禁用' }}
          </el-tag>
        </template>
        <template v-if="canWrite" #__actions="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="canUpdate" type="edit" title="编辑" @click="openEdit(row)" />
            <DeleteConfirm v-if="canDelete" text="确认删除该记录？" @confirm="doDelete(row)">
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <!-- 新增/编辑弹窗：ProDialog 统一形制（波纹标题栏由全局样式提供）+ 字段图标徽章 -->
    <ProDialog
      v-model="visible"
      class="sc-dialog"
      :title="editingId ? '编辑' : '新增'"
      width="540px"
      confirm-text="保存"
      :confirm-loading="saving"
      @confirm="onSave"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="92px" class="sc-form">
        <el-form-item
          v-for="field in fields"
          :key="field.prop"
          :label="field.label"
          :prop="field.prop"
        >
          <el-input
            v-if="field.type === 'input' || !field.type"
            v-model="form[field.prop]"
            :placeholder="field.placeholder || `请输入${field.label}`"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon :icon="field.icon || 'ri:edit-line'" /></span>
            </template>
          </el-input>
          <div v-else-if="field.type === 'textarea'" class="field-textarea">
            <span class="field-badge">
              <ArtSvgIcon :icon="field.icon || 'ri:file-text-line'" />
            </span>
            <el-input
              v-model="form[field.prop]"
              type="textarea"
              :rows="4"
              :placeholder="field.placeholder || `请输入${field.label}`"
            />
          </div>
          <el-select
            v-else-if="field.type === 'select'"
            v-model="form[field.prop]"
            clearable
            style="width: 100%"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon :icon="field.icon || 'ri:list-check-2'" /></span>
            </template>
            <el-option
              v-for="opt in field.options || []"
              :key="String(opt.value)"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-radio-group v-else-if="field.type === 'status'" v-model="form[field.prop]">
            <el-radio :value="1">正常</el-radio>
            <el-radio :value="0">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import {
  createResource,
  deleteResource,
  listResource,
  updateResource,
} from '@/api/system'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProDialog from '@/components/ProDialog.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import { usePermissions } from '@/utils/permissions'

export interface CrudColumn {
  prop: string
  label: string
  width?: number
}

export interface CrudField {
  prop: string
  label: string
  type?: 'input' | 'textarea' | 'select' | 'status'
  required?: boolean
  placeholder?: string
  /** 输入框左侧图标徽章（ri:* 图标，缺省按控件类型给默认图标） */
  icon?: string
  options?: { label: string; value: string | number }[]
}

const props = withDefaults(
  defineProps<{
    apiPath: string
    columns: CrudColumn[]
    fields: CrudField[]
    title?: string
    /** 新增按钮文案（默认「新增」，如设备分类页传「新增分类」） */
    createText?: string
    /** 卡头右上角「n 条数据」标签（默认显示） */
    showCount?: boolean
    searchable?: boolean
    searchPlaceholder?: string
    searchParam?: string
    /** 写操作（新增/编辑/删除）所需角色：'' 不限 / 'manager' 超管+领导 / 'super_admin' 仅超管 / 'perm' 按 writePerm(s) 校验 */
    writeRole?: '' | 'manager' | 'super_admin' | 'perm'
    /** writeRole='perm' 时使用的按钮权限码（如 'eq:create'），增删改共用 */
    writePerm?: string
    /** writeRole='perm' 时的细粒度权限码（优先级高于 writePerm）：分别控制 新增/编辑/删除 按钮 */
    writePerms?: { create?: string; update?: string; delete?: string }
    defaultForm?: Record<string, unknown>
  }>(),
  {
    title: '',
    createText: '新增',
    showCount: true,
    searchable: true,
    searchPlaceholder: '关键词',
    searchParam: 'keyword',
    writeRole: '',
    writePerm: '',
    writePerms: undefined,
    defaultForm: () => ({ status: 1 }),
  },
)

const loading = ref(false)
const saving = ref(false)
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const searchModel = ref<Record<string, any>>({ keyword: '' })
const visible = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<Record<string, unknown>>({})

/* 当前用户是否有写权限（渲染显隐 + 点击拦截共用） */
const { isSuper, isManager, hasPerm } = usePermissions()
const canWrite = computed(() => {
  if (props.writeRole === 'super_admin') return isSuper.value
  if (props.writeRole === 'manager') return isManager.value
  if (props.writeRole === 'perm') {
    // 细粒度权限码优先：任一项命中即视为有写权限（具体操作再按 canCreate/Update/Delete 细分）
    if (props.writePerms) {
      const { create, update, delete: del } = props.writePerms
      return [create, update, del].some((p) => p && hasPerm(p))
    }
    return hasPerm(props.writePerm)
  }
  return true
})

/* 细粒度校验：writePerms 提供对应权限码时按码校验，否则回退 canWrite（角色模式/单码模式行为不变） */
const canCreate = computed(() =>
  props.writeRole === 'perm' && props.writePerms?.create ? hasPerm(props.writePerms.create) : canWrite.value,
)
const canUpdate = computed(() =>
  props.writeRole === 'perm' && props.writePerms?.update ? hasPerm(props.writePerms.update) : canWrite.value,
)
const canDelete = computed(() =>
  props.writeRole === 'perm' && props.writePerms?.delete ? hasPerm(props.writePerms.delete) : canWrite.value,
)

/* ProTable 列配置（业务列 + 操作列），无写权限时不渲染操作列 */
const proColumns = computed<ProColumn[]>(() => {
  const base: ProColumn[] = props.columns.map((c) => ({
    prop: c.prop,
    label: c.label,
    minWidth: c.width || 120,
    showOverflowTooltip: true,
  }))
  return canWrite.value
    ? [...base, { prop: '__actions', label: '操作', width: 120, fixed: 'right', disabled: true }]
    : base
})

/* 导出列（排除操作列） */
const exportColumns = computed(() =>
  props.columns.map((c) => ({ prop: c.prop, label: c.label })),
)

const rules = props.fields.reduce((acc, f) => {
  if (f.required) {
    acc[f.prop] = [{ required: true, message: `请填写${f.label}`, trigger: 'blur' }]
  }
  return acc
}, {} as FormRules)

function resetForm(data?: Record<string, unknown>) {
  Object.keys(form).forEach((k) => delete form[k])
  Object.assign(form, { ...props.defaultForm, ...(data || {}) })
}

/* 独立搜索区配置：单关键词输入（对接 props.searchParam，默认 keyword） */
const searchItems = computed<SearchFormItem[]>(() => [
  {
    key: 'keyword',
    label: '关键词',
    type: 'input',
    props: { clearable: true, placeholder: props.searchPlaceholder },
  },
])

function onSearch() {
  page.value = 1
  load()
}
function onReset() {
  searchModel.value.keyword = ''
  page.value = 1
  load()
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      page: page.value,
      page_size: pageSize.value,
    }
    if (searchModel.value.keyword) params[props.searchParam] = searchModel.value.keyword
    const { data } = await listResource<Record<string, unknown>>(props.apiPath, params)
    rows.value = data.data.items
    total.value = data.data.total
  } finally {
    loading.value = false
  }
}

function openCreate() {
  if (!canCreate.value) return
  editingId.value = null
  resetForm()
  visible.value = true
}

function openEdit(row: Record<string, unknown>) {
  if (!canUpdate.value) return
  editingId.value = row.id as number
  resetForm(row)
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = { ...form }
    if (editingId.value) {
      await updateResource(props.apiPath, editingId.value, payload)
    } else {
      await createResource(props.apiPath, payload)
    }
    ElMessage.success('保存成功')
    visible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function doDelete(row: Record<string, unknown>) {
  if (!canDelete.value) return
  await deleteResource(props.apiPath, row.id as number)
  ElMessage.success('已删除')
  await load()
}

function onPageChange(p: number) {
  page.value = p
  load()
}
function onPageSizeChange(size: number) {
  pageSize.value = size
  load()
}

onMounted(load)
</script>

<style lang="scss">
/*
  SimpleCrud 表单弹窗（.sc-dialog 经 ProDialog 透传至 .el-dialog）
  标题栏/波纹背景/按钮/字段徽章/输入框形制均由全局样式（styles/index.css .el-dialog / .field-badge）统一提供
*/
.sc-dialog {
  /* ---- 表单区局部微调 ---- */
  .el-dialog__body {
    padding: 10px 24px 4px 24px; /* 左右 24px 对称，与全局弹窗规范一致 */
  }
  .sc-form {
    .el-form-item {
      margin-bottom: 22px;
    }
    .el-radio {
      margin-right: 28px;
    }
  }

  /* textarea：设计稿高文本区 */
  .field-textarea .el-textarea__inner {
    min-height: 96px !important;
  }
}
</style>

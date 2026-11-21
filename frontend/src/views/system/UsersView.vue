<template>
  <div class="page mod-system">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="用户管理" name="users">
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
            export-filename="用户管理"
            @refresh="load"
          >
            <template #left>
              <el-button v-if="hasPerm('sys:user:create')" class="btn-gradient" type="primary" @click="openCreate">新增用户</el-button>
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
            <template #temp_expire_at="{ row }">
              <span v-if="row.temp_expire_at" :class="{ expired: isTempExpired(row.temp_expire_at) }">
                {{ formatDateTime(row.temp_expire_at, false) }}
                <el-tag
                  v-if="isTempExpired(row.temp_expire_at)"
                  type="danger"
                  size="small"
                  effect="light"
                  style="margin-left: 4px"
                >已过期</el-tag>
              </span>
              <span v-else style="color: var(--el-text-color-secondary)">—</span>
            </template>
            <template #operation="{ row }">
              <ArtButtonTable v-if="hasPerm('sys:user:update')" type="edit" title="编辑" @click="openEdit(row)" />
              <ArtButtonTable v-if="hasPerm('sys:user:update')" icon="ri:key-2-line" icon-class="bg-warning/12 text-warning" title="临时授权" @click="openTempAuth(row)" />
              <DeleteConfirm v-if="hasPerm('sys:user:delete')" text="确认删除该用户？" @confirm="onDelete(row)">
                <ArtButtonTable type="delete" title="删除" />
              </DeleteConfirm>
            </template>
          </ProTable>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="角色管理" name="roles" lazy>
        <RolesView />
      </el-tab-pane>
      <el-tab-pane label="菜单管理" name="menus" lazy>
        <MenusView />
      </el-tab-pane>
    </el-tabs>

    <ProDialog v-model="visible" :title="form.id ? '编辑用户' : '新增用户'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="用户名" prop="username" required>
          <el-input v-model="form.username" :disabled="!!form.id">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:account-circle-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item :label="form.id ? '新密码' : '密码'" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="不修改可留空">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:lock-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="姓名" prop="display_name" required>
          <el-input v-model="form.display_name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:user-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="手机">
          <el-input v-model="form.phone">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:phone-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="form.department_id" clearable style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:building-line" /></span>
            </template>
            <el-option v-for="d in depts" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="班组" prop="team_id">
          <el-select v-model="form.team_id" clearable style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:team-line" /></span>
            </template>
            <el-option v-for="d in teams" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联角色" prop="role_code" required>
          <el-select v-model="form.role_code" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:shield-user-line" /></span>
            </template>
            <el-option v-for="r in roleOptions" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
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

    <ProDialog v-model="tempVisible" title="临时授权" width="460px">
      <el-form ref="tempFormRef" :model="tempForm" :rules="tempRules" label-width="110px">
        <el-form-item label="用户">
          <span>{{ tempForm.display_name }}（{{ tempForm.username }}）</span>
        </el-form-item>
        <el-form-item label="有效期至" prop="temp_expire_at" required>
          <el-date-picker
            v-model="tempForm.temp_expire_at"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="选择授权到期时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="说明">
          <span style="color: var(--el-text-color-secondary); font-size: 13px">
            到期后该账号将无法登录。清空表示取消临时授权（转为普通账号）。
          </span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tempVisible = false">取消</el-button>
        <el-button @click="onClearTempAuth">取消授权</el-button>
        <el-button type="primary" @click="onSaveTempAuth">保存</el-button>
      </template>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { formatDateTime } from '@/utils/time'
import { ElMessage, ElMessageBox } from 'element-plus'
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
import RolesView from './RolesView.vue'
import MenusView from './MenusView.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()

const activeTab = ref('users')
const loading = ref(false)
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const depts = ref<OptionItem[]>([])
const teams = ref<OptionItem[]>([])
const roles = ref<OptionItem[]>([])
const query = reactive({ keyword: '' })

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '关键字', type: 'input', props: { clearable: true, placeholder: '用户名/姓名/手机' } },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'username', label: '用户名', width: 120 },
  { prop: 'display_name', label: '姓名', width: 120 },
  { prop: 'phone', label: '手机', width: 130 },
  { prop: 'department_name', label: '部门', minWidth: 110, showOverflowTooltip: true },
  { prop: 'team_name', label: '班组', minWidth: 110, showOverflowTooltip: true },
  { prop: 'role_code', label: '关联角色', width: 120, formatter: (r: any) => roleNameByCode(r.role_code) },
  { prop: 'status', label: '状态', width: 90, align: 'center' },
  { prop: 'temp_expire_at', label: '临时授权', width: 170 },
  { prop: 'operation', label: '操作', width: 210, fixed: 'right', align: 'center' },
])

const roleCodeText: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '领导',
  operator: '操作员',
}
// 「关联角色」下拉选项：以角色管理列表为准（显示角色名），内置三码兜底（防角色停用/删除后无法回显）
const roleOptions = computed(() => {
  const opts = roles.value
    .filter((r) => r.code)
    .map((r) => ({ label: r.name, value: r.code as string }))
  for (const [code, name] of Object.entries(roleCodeText)) {
    if (!opts.some((o) => o.value === code)) opts.push({ label: name, value: code })
  }
  return opts
})
// 角色 code → 显示名（表格/导出用）：优先角色管理里的自定义名称，内置映射兜底
function roleNameByCode(code: unknown) {
  const key = String(code ?? '')
  return roles.value.find((r) => r.code === key)?.name || roleCodeText[key] || key
}
// 由所选角色代码反查角色 id，提交时同步维护 user_role 关联（权限采集依赖该关联）
const roleIdByCode = (code: unknown) => {
  const hit = roles.value.find((r) => r.code === String(code ?? ''))
  return hit ? [hit.id] : []
}
const exportColumns = [
  { prop: 'username', label: '用户名' },
  { prop: 'display_name', label: '姓名' },
  { prop: 'phone', label: '手机' },
  { prop: 'department_name', label: '部门' },
  { prop: 'team_name', label: '班组' },
  { prop: 'role_code', label: '关联角色', formatter: (r: any) => roleNameByCode(r.role_code) },
  { prop: 'status', label: '状态', formatter: (r: any) => (r.status === 1 ? '正常' : '禁用') },
  { prop: 'temp_expire_at', label: '临时授权', width: 170, formatter: (r: any) => (r.temp_expire_at ? formatDateTime(r.temp_expire_at, false) : '') },
]

const form = reactive<Record<string, unknown>>({
  id: null,
  username: '',
  password: '',
  display_name: '',
  phone: '',
  department_id: undefined,
  team_id: undefined,
  role_code: 'operator',
  status: 1,
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  username: [{ required: true, message: '请填写用户名', trigger: 'blur' }],
  password: [
    {
      required: false,
      validator: (_r, v, cb) => {
        if (!form.id && !v) return cb(new Error('请填写密码'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  display_name: [{ required: true, message: '请填写姓名', trigger: 'blur' }],
  role_code: [{ required: true, message: '请选择关联角色', trigger: 'change' }],
  // 操作员必须归属班组：巡检任务池/抢单、通知均以班组为数据权限根
  team_id: [
    {
      validator: (_r, _v, cb) => {
        if (form.role_code === 'operator' && !form.team_id) return cb(new Error('操作员必须归属班组'))
        cb()
      },
      trigger: 'change',
    },
  ],
}
const tempFormRef = ref<FormInstance>()
const tempRules: FormRules = {
  temp_expire_at: [{ required: true, message: '请选择有效期至', trigger: 'change' }],
}

async function load() {
  loading.value = true
  try {
    const { data } = await listResource('/system/users', {
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
  if (!hasPerm('sys:user:create')) return
  Object.assign(form, {
    id: null,
    username: '',
    password: '',
    display_name: '',
    phone: '',
    department_id: undefined,
    team_id: undefined,
    role_code: 'operator',
    status: 1,
  })
  visible.value = true
}

function openEdit(row: Record<string, unknown>) {
  if (!hasPerm('sys:user:update')) return
  Object.assign(form, {
    ...row,
    password: '',
  })
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload: Record<string, unknown> = {
    display_name: form.display_name,
    phone: form.phone,
    department_id: form.department_id,
    team_id: form.team_id,
    role_code: form.role_code,
    // 单选「关联角色」→ 由角色代码反查 id，同步维护 user_role 关联（权限采集依赖该关联）
    role_ids: roleIdByCode(form.role_code),
    status: form.status,
  }
  if (form.password) payload.password = form.password
  if (form.id) {
    await updateResource('/system/users', form.id as number, payload)
  } else {
    await createResource('/system/users', {
      ...payload,
      username: form.username,
      password: form.password,
    })
  }
  ElMessage.success('保存成功')
  // 角色变更可能影响当前登录账号的菜单/按钮，触发侧边栏与权限快照实时刷新
  window.dispatchEvent(new CustomEvent('app:menus-changed'))
  visible.value = false
  await load()
}

async function onDelete(row: Record<string, unknown>) {
  if (!hasPerm('sys:user:delete')) return
  await deleteResource('/system/users', row.id as number)
  ElMessage.success('已删除')
  await load()
}

/* 临时授权 */
const tempVisible = ref(false)
const tempForm = reactive({
  id: null as number | null,
  username: '',
  display_name: '',
  temp_expire_at: '' as string | null,
})
function openTempAuth(row: Record<string, unknown>) {
  if (!hasPerm('sys:user:update')) return
  Object.assign(tempForm, {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    temp_expire_at: (row.temp_expire_at as string) || null,
  })
  tempVisible.value = true
}
async function onSaveTempAuth() {
  const valid = await tempFormRef.value?.validate().catch(() => false)
  if (!valid) return
  await updateResource('/system/users', tempForm.id!, {
    temp_expire_at: tempForm.temp_expire_at,
  })
  ElMessage.success('已设置临时授权')
  window.dispatchEvent(new CustomEvent('app:menus-changed'))
  tempVisible.value = false
  await load()
}
async function onClearTempAuth() {
  await ElMessageBox.confirm('取消该用户的临时授权，转为普通账号？', '提示', { type: 'warning' })
  await updateResource('/system/users', tempForm.id!, { temp_expire_at: null })
  ElMessage.success('已取消临时授权')
  window.dispatchEvent(new CustomEvent('app:menus-changed'))
  tempVisible.value = false
  await load()
}
function isTempExpired(t: string): boolean {
  return new Date(t).getTime() <= Date.now()
}

onMounted(async () => {
  const [d, t, r] = await Promise.all([
    optionsResource('/system/departments/options'),
    optionsResource('/system/teams/options'),
    optionsResource('/system/roles/options'),
  ])
  depts.value = d.data.data
  teams.value = t.data.data
  roles.value = r.data.data
  await load()
})
</script>

<style lang="scss" scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.expired {
  color: var(--el-color-danger);
}
</style>

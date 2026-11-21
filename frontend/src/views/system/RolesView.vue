<template>
  <div class="page">
    <ProSearchBar v-model="query" :items="searchItems" :span="8" @search="load" @reset="load" />
    <el-card shadow="never" class="art-table-card">
    <ProTableHeader
      v-model:columns="tableColumns"
      :loading="loading"
      :export-columns="exportColumns"
      :export-data="rows"
      export-filename="角色管理"
      @refresh="load"
    >
      <template #left>
        <el-button v-if="hasPerm('sys:role:assign')" class="btn-gradient" type="primary" @click="openCreate">新增角色</el-button>
      </template>
    </ProTableHeader>
    <ProTable
      :data="rows"
      :loading="loading"
      :columns="tableColumns"
      row-key="id"
    >
      <template #status="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="light">
          {{ row.status === 1 ? '正常' : '禁用' }}
        </el-tag>
      </template>
      <template #operation="{ row }">
        <div class="action-cell">
          <ArtButtonTable v-if="hasPerm('sys:role:assign')" type="edit" title="编辑" @click="openEdit(row)" />
          <DeleteConfirm v-if="hasPerm('sys:role:assign')" text="确认删除该角色？" @confirm="onDelete(row)">
            <ArtButtonTable type="delete" title="删除" />
          </DeleteConfirm>
        </div>
      </template>
    </ProTable>

    <ProDialog v-model="visible" :title="form.id ? '编辑角色' : '新增角色'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="角色名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:shield-user-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="角色编码" prop="code" required>
          <el-input v-model="form.code" :disabled="isBuiltin">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:code-s-slash-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="菜单权限">
          <!-- super_admin 权限由种子基线锁定（仅系统管理域，不再通配放行），隐藏勾选树防止误改 -->
          <el-alert
            v-if="isSuperAdminRole"
            type="info"
            :closable="false"
            show-icon
            title="超级管理员权限已锁定"
            description="super_admin 固定持有「系统管理」域权限（由系统基线保证，不可编辑）；如需自定义按钮/菜单权限，请编辑「领导」或「操作员」角色。"
          />
          <el-tree
            v-else
            ref="treeRef"
            :data="menuTree"
            show-checkbox
            node-key="id"
            default-expand-all
            check-strictly
            :props="{ label: 'name', children: 'children' }"
          >
            <template #default="{ node, data }">
              <span class="tree-node">
                <span v-if="data.menu_type === 'button'" class="btn-badge">按钮</span>
                <span>{{ node.label }}</span>
                <span v-if="data.perms" class="perms-code">{{ data.perms }}</span>
              </span>
            </template>
          </el-tree>
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
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import type { ElTree, FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createResource,
  deleteResource,
  fetchMenuTree,
  listResource,
  updateResource,
} from '@/api/system'
import type { MenuNode } from '@/api/types'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProDialog from '@/components/ProDialog.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()

const loading = ref(false)
const rows = ref<Record<string, unknown>[]>([])
const visible = ref(false)

/* 独立搜索区：单关键词（后端 /system/roles 支持 keyword 模糊匹配） */
const query = ref<Record<string, any>>({ keyword: '' })
const searchItems: SearchFormItem[] = [
  {
    key: 'keyword',
    label: '关键词',
    type: 'input',
    props: { clearable: true, placeholder: '角色名称/编码' },
  },
]
const menuTree = ref<MenuNode[]>([])
const treeRef = ref<InstanceType<typeof ElTree>>()
const form = reactive<Record<string, unknown>>({
  id: null,
  name: '',
  code: '',
  remark: '',
  status: 1,
  menu_ids: [] as number[],
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写角色名称', trigger: 'blur' }],
  code: [{ required: true, message: '请填写角色编码', trigger: 'blur' }],
}

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60 },
  { prop: 'name', label: '角色名称', minWidth: 140 },
  { prop: 'code', label: '角色编码', width: 160 },
  { prop: 'remark', label: '备注', minWidth: 180, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 90, align: 'center' },
  { prop: 'operation', label: '操作', width: 120, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'name', label: '角色名称' },
  { prop: 'code', label: '角色编码' },
  { prop: 'remark', label: '备注' },
  { prop: 'status', label: '状态', formatter: (r: any) => (r.status === 1 ? '正常' : '禁用') },
]

const isBuiltin = computed(() =>
  ['super_admin', 'admin', 'operator'].includes(String(form.code || '')),
)

/** 超管角色固定全权限，权限树不参与编辑（保存时也不回写 menu_ids） */
const isSuperAdminRole = computed(() => String(form.code || '') === 'super_admin')

async function load() {
  loading.value = true
  try {
    const params: Record<string, unknown> = { page: 1, page_size: 100 }
    if (query.value.keyword) params.keyword = query.value.keyword
    const { data } = await listResource('/system/roles', params)
    rows.value = data.data.items as Record<string, unknown>[]
  } finally {
    loading.value = false
  }
}

function openCreate() {
  if (!hasPerm('sys:role:assign')) return
  Object.assign(form, { id: null, name: '', code: '', remark: '', status: 1, menu_ids: [] })
  visible.value = true
  nextTick(() => treeRef.value?.setCheckedKeys([]))
}

function openEdit(row: Record<string, unknown>) {
  if (!hasPerm('sys:role:assign')) return
  Object.assign(form, row)
  visible.value = true
  nextTick(() => {
    const tree = treeRef.value
    if (!tree) return
    tree.setCheckedKeys([])
    nextTick(() => {
      // check-strictly 模式父子互不级联：直接回显全部已授权节点（含页面/目录），
      // 「页面可见但无任何按钮权限」可被精确表达（旧级联模式无法保存这种状态）
      tree.setCheckedKeys(((row.menu_ids as number[]) || []) as number[])
    })
  })
}

/** 扁平化菜单树为 id -> 节点 映射（用于保存前 diff 展示节点名称） */
function flattenNodes(list: MenuNode[], acc = new Map<number, MenuNode>()) {
  for (const n of list) {
    acc.set(n.id, n)
    if (n.children?.length) flattenNodes(n.children, acc)
  }
  return acc
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  )
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  // 全选叶子 + 半选父节点一起保存：半选父节点是「只勾了部分子按钮」的菜单/目录，
  // 若不保存，该页面会从侧边栏消失（按钮权限与菜单可见性共用同一份 menu_ids）
  const payload: Record<string, unknown> = {
    name: form.name,
    code: form.code,
    remark: form.remark,
    status: form.status,
  }
  let nextIds: number[] = []
  if (!isSuperAdminRole.value) {
    const tree = treeRef.value
    // check-strictly：勾选即授权，页面与按钮独立表达；halfChecked 兼容保留（strictly 下恒为空）
    const checked = (tree?.getCheckedKeys(false) as number[]) || []
    const halfChecked = (tree?.getHalfCheckedKeys() as number[]) || []
    nextIds = [...new Set([...checked, ...halfChecked])]
    payload.menu_ids = nextIds
  }

  // 编辑场景：对比保存前的授权集合，勾选项有减少（常因误点父节点复选框导致整组连带取消）时二次确认
  if (form.id && !isSuperAdminRole.value) {
    const nextSet = new Set<number>(nextIds)
    // 「旧有、新无」才是被移除的权限（注意方向：遍历旧集合查新集合）
    const removed = ((form.menu_ids as number[]) || []).filter((id) => !nextSet.has(id))
    if (removed.length) {
      const nodeMap = flattenNodes(menuTree.value)
      const removedMenus = removed.filter(
        (id) => nodeMap.get(id)?.menu_type !== 'button',
      )
      const removedBtns = removed.filter(
        (id) => nodeMap.get(id)?.menu_type === 'button',
      )
      const nameOf = (id: number) => nodeMap.get(id)?.name || `#${id}`
      const lines: string[] = ['<div style="margin-bottom:8px">以下权限将被<b>减少</b>，请确认是否为预期操作（父菜单取消会连带收回其下全部按钮）：</div>']
      if (removedMenus.length) {
        lines.push(
          `<div style="margin:6px 0 2px">菜单/目录 ${removedMenus.length} 个（页面将从侧边栏移除）：</div>` +
            removedMenus.map((id) => `· ${escapeHtml(nameOf(id))}`).join('<br/>'),
        )
      }
      if (removedBtns.length) {
        const shown = removedBtns.slice(0, 10).map((id) => `· ${escapeHtml(nameOf(id))}`)
        if (removedBtns.length > shown.length) shown.push(`· 等共 ${removedBtns.length} 个按钮`)
        lines.push(
          `<div style="margin:6px 0 2px">按钮权限 ${removedBtns.length} 个（收回后用户不可见/不可操作）：</div>` +
            shown.join('<br/>'),
        )
      }
      try {
        await ElMessageBox.confirm(lines.join(''), '保存确认', {
          type: 'warning',
          dangerouslyUseHTMLString: true,
          confirmButtonText: '确认保存',
          cancelButtonText: '返回继续编辑',
        })
      } catch {
        // 用户取消：保留编辑弹窗，不保存
        return
      }
    }
  }

  if (form.id) await updateResource('/system/roles', form.id as number, payload)
  else await createResource('/system/roles', payload)
  ElMessage.success('保存成功，当前账号权限已实时刷新；其他在线用户重新登录后生效')
  // 通知侧边栏与当前登录态实时刷新（本账号角色/菜单被改动时无需重新登录）
  window.dispatchEvent(new CustomEvent('app:menus-changed'))
  visible.value = false
  await load()
}

async function onDelete(row: Record<string, unknown>) {
  if (!hasPerm('sys:role:assign')) return
  await deleteResource('/system/roles', row.id as number)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  const { data } = await fetchMenuTree()
  menuTree.value = data.data
  await load()
})
</script>

<style scoped>
.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-badge {
  display: inline-block;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: #fff;
  background: #909399;
  border-radius: 3px;
}
.perms-code {
  font-size: 12px;
  color: #909399;
  font-family: monospace;
}
</style>

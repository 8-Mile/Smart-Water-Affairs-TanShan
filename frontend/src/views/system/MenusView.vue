<!-- 菜单管理页面（1:1 复原参考项目 art-design-pro /views/system/menu） -->
<template>
  <div class="menu-page page">
    <!-- 查询区：独立 ProSearchBar（与告警中心同布局：查询与表格分区） -->
    <ProSearchBar v-model="query" :items="searchItems" :span="6" @search="onSearch" @reset="onReset" />

    <el-card class="art-table-card" shadow="never">
      <!-- 表格头部工具栏：左侧操作按钮（添加菜单/新增按钮）+ 右侧展开收起与刷新 -->
      <div class="table-header">
        <div class="th-left">
          <template v-if="hasPerm('sys:menu:manage')">
            <el-button class="btn-gradient" type="primary" @click="handleAddMenu">添加菜单</el-button>
            <el-button type="primary" plain @click="handleAddButton">新增按钮</el-button>
          </template>
          <el-button @click="toggleExpand">{{ isExpanded ? '收起' : '展开' }}</el-button>
        </div>
        <div class="th-right">
          <div
            class="ml-2 md:ml-0 md:mr-2.5 size-8 flex items-center justify-center cursor-pointer rounded-md bg-g-300/55 text-g-700 hover:bg-g-300 dark:bg-g-300/40"
            title="刷新"
            @click="handleRefresh"
          >
            <ArtSvgIcon icon="ri:refresh-line" :class="{ 'animate-spin': refreshing }" />
          </div>
        </div>
      </div>

      <!-- 树形表格 -->
      <el-table
        ref="tableRef"
        v-loading="loading"
        class="menu-table"
        row-key="id"
        height="100%"
        :data="filteredTableData"
        :stripe="false"
        :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
        :default-expand-all="false"
      >
        <el-table-column v-if="colVisible('name')" prop="name" label="菜单名称" min-width="120" show-overflow-tooltip />
        <el-table-column v-if="colVisible('menu_type')" prop="menu_type" label="菜单类型">
          <template #default="{ row }">
            <el-tag :type="typeTag(row.menu_type)">{{ typeText(row.menu_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="colVisible('path')" prop="path" label="路由" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.menu_type === 'button' ? '' : row.path || '' }}
          </template>
        </el-table-column>
        <el-table-column v-if="colVisible('perms')" prop="perms" label="权限标识" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.perms || '' }}
          </template>
        </el-table-column>
        <el-table-column v-if="colVisible('date')" prop="date" label="编辑时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column v-if="colVisible('status')" prop="status" label="状态">
          <template #default="{ row }">
            <el-tag v-if="row.visible === 0" type="info">隐藏</el-tag>
            <el-tag v-else type="success">启用</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="colVisible('operation')" prop="operation" label="操作" width="180" align="right">
          <template #default="{ row }">
            <div v-if="hasPerm('sys:menu:manage')" style="text-align: right">
              <ArtButtonTable
                v-if="row.menu_type !== 'button'"
                type="add"
                title="新增子项"
                @click="handleAddChild(row)"
              />
              <ArtButtonTable type="edit" title="编辑" @click="openEdit(row)" />
              <DeleteConfirm
                v-if="hasPerm('sys:menu:manage')"
                text="确定要删除该菜单吗？删除后无法恢复"
                @confirm="onDelete(row)"
              >
                <ArtButtonTable type="delete" title="删除" />
              </DeleteConfirm>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 菜单弹窗（表单字段对接本项目后端） -->
    <ProDialog
      v-model="visible"
      :title="form.id ? '编辑菜单' : '新建菜单'"
      width="520px"
      align-center
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item v-if="form.menu_type === 'button'" label="上级菜单" prop="parent_id">
          <el-select v-model="form.parent_id" filterable placeholder="选择按钮所属页面" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:menu-line" /></span>
            </template>
            <el-option
              v-for="opt in buttonParentOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" :placeholder="form.menu_type === 'button' ? '按钮名称，如：新增设备' : '菜单名称'">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:menu-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="类型" prop="menu_type">
          <el-radio-group v-model="form.menu_type" :disabled="!!form.id">
            <el-radio-button value="dir">目录</el-radio-button>
            <el-radio-button value="menu">菜单</el-radio-button>
            <el-radio-button value="button">按钮</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.menu_type !== 'button'" label="路径" prop="path">
          <el-input v-model="form.path" placeholder="/system/users">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:link" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="form.menu_type === 'menu'" label="组件" prop="component">
          <el-input v-model="form.component" placeholder="system/users">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:code-s-slash-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="form.menu_type !== 'button'" label="图标">
          <el-input
            v-model="form.icon"
            readonly
            placeholder="点击选择图标"
            style="cursor: pointer"
            @click="iconPickerVisible = true"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon :icon="form.icon || 'ri:emotion-line'" /></span>
            </template>
            <template #suffix>
              <el-icon class="icon-clear" @click.stop="form.icon = ''"><Close /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="权限标识" :prop="form.menu_type === 'button' ? 'perms' : ''">
          <el-input v-model="form.perms" :placeholder="form.menu_type === 'button' ? '如 eq:create（按钮权限码，必填）' : 'sys:user:list'">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:key-2-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" :max="999" />
        </el-form-item>
        <!-- 按钮节点不参与侧边栏渲染，无「是否显示」概念（库内恒为 visible=0），不提供开关 -->
        <el-form-item v-if="form.menu_type !== 'button'" label="显示">
          <el-switch v-model="form.visible" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="visible = false">取 消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">确 定</el-button>
        </span>
      </template>
    </ProDialog>

    <!-- 图标库选择器：搜索 + 网格点选（ri: Remix Icon 集） -->
    <el-dialog
      v-model="iconPickerVisible"
      title="选择图标"
      width="680px"
      append-to-body
      destroy-on-close
      class="icon-picker-dialog"
    >
      <el-input
        v-model="iconKeyword"
        clearable
        placeholder="搜索图标名，如 user / alarm / chart"
        style="margin-bottom: 12px"
      >
        <template #prefix>
          <span class="field-badge"><ArtSvgIcon icon="ri:search-line" /></span>
        </template>
      </el-input>
      <div class="icon-grid">
        <div
          v-for="name in filteredIcons"
          :key="name"
          class="icon-cell"
          :class="{ active: form.icon === name }"
          :title="name"
          @click="onPickIcon(name)"
        >
          <ArtSvgIcon :icon="name" :style="{ fontSize: '22px' }" />
          <span class="icon-name">{{ name.replace('ri:', '') }}</span>
        </div>
        <el-empty v-if="!filteredIcons.length" :image-size="80" description="无匹配图标" style="grid-column: 1 / -1" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { formatDateTime } from '@/utils/time'
import { ElMessage } from 'element-plus'
import { Close } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ProDialog from '@/components/ProDialog.vue'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import { createMenu, deleteMenu, fetchMenuTree, updateMenu } from '@/api/system'
import type { MenuNode } from '@/api/types'
import { usePermissions } from '@/utils/permissions'

defineOptions({ name: 'Menus' })

const { hasPerm } = usePermissions()

/* ===== 状态 ===== */
const loading = ref(false)
const refreshing = ref(false)
const isExpanded = ref(false)
const tableRef = ref()
const tree = ref<MenuNode[]>([])

/* ===== 搜索（ProSearchBar 配置驱动；appliedFilters 为已应用筛选，编辑中值在 query） ===== */
const initialSearchState = { name: '', route: '' }
const query = reactive({ ...initialSearchState })
const appliedFilters = reactive({ ...initialSearchState })

const searchItems: SearchFormItem[] = [
  { key: 'name', label: '菜单名称', type: 'input', props: { clearable: true, placeholder: '请输入' } },
  { key: 'route', label: '路由地址', type: 'input', props: { clearable: true, placeholder: '请输入' } },
]

/* ===== 列设置 ===== */
interface ColumnCheck {
  label: string
  prop: string
  visible: boolean
  disabled?: boolean
}
const columnChecks = ref<ColumnCheck[]>([
  { label: '菜单名称', prop: 'name', visible: true },
  { label: '菜单类型', prop: 'menu_type', visible: true },
  { label: '路由', prop: 'path', visible: true },
  { label: '权限标识', prop: 'perms', visible: true },
  { label: '编辑时间', prop: 'date', visible: true },
  { label: '状态', prop: 'status', visible: true },
  { label: '操作', prop: 'operation', visible: true, disabled: true },
])
const colVisible = (prop: string) =>
  columnChecks.value.find((c) => c.prop === prop)?.visible ?? true

/* ===== 数据加载 ===== */
async function load() {
  loading.value = true
  try {
    const { data } = await fetchMenuTree()
    tree.value = data.data
  } finally {
    loading.value = false
  }
}

const handleRefresh = async () => {
  refreshing.value = true
  try {
    await load()
  } finally {
    refreshing.value = false
  }
}

function onReset(): void {
  Object.assign(query, { ...initialSearchState })
  Object.assign(appliedFilters, { ...initialSearchState })
  load()
}

function onSearch(): void {
  Object.assign(appliedFilters, { ...query })
  load()
}

/* 搜索过滤：子项命中则保留父级链（复刻参考 searchMenu） */
const searchMenu = (items: MenuNode[]): MenuNode[] => {
  const searchName = appliedFilters.name?.toLowerCase().trim() || ''
  const searchRoute = appliedFilters.route?.toLowerCase().trim() || ''
  const results: MenuNode[] = []

  for (const item of items) {
    const nameMatch = !searchName || (item.name || '').toLowerCase().includes(searchName)
    const routeMatch = !searchRoute || (item.path || '').toLowerCase().includes(searchRoute)

    if (item.children?.length) {
      const matchedChildren = searchMenu(item.children)
      if (matchedChildren.length > 0) {
        results.push({ ...item, children: matchedChildren })
        continue
      }
    }

    if (nameMatch && routeMatch) {
      results.push({ ...item })
    }
  }

  return results
}

const filteredTableData = computed(() => searchMenu(tree.value))

/* ===== 菜单类型 tag（目录灰 / 菜单蓝 / 按钮红，对齐参考 getMenuTypeTag） ===== */
const typeText = (t?: string) =>
  ({ dir: '目录', directory: '目录', menu: '菜单', button: '按钮' } as Record<string, string>)[t || ''] || t
const typeTag = (t?: string) =>
  ({ dir: 'info', directory: 'info', menu: 'primary', button: 'danger' } as Record<string, any>)[t || ''] || 'info'

/* ===== 展开 / 收起（复刻参考 toggleExpand） ===== */
const toggleExpand = (): void => {
  isExpanded.value = !isExpanded.value
  nextTick(() => {
    const elTable = tableRef.value
    if (!elTable) return
    const processRows = (rows: MenuNode[]) => {
      rows.forEach((row) => {
        if (row.children?.length) {
          elTable.toggleRowExpansion(row, isExpanded.value)
          processRows(row.children)
        }
      })
    }
    processRows(filteredTableData.value)
  })
}

/* ===== 菜单弹窗（对接本项目后端） ===== */
const visible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  id: null as number | null,
  name: '',
  path: '',
  component: '',
  icon: '',
  parent_id: 0,
  sort: 0,
  menu_type: 'menu',
  perms: '',
  visible: 1,
  status: 1,
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  perms: [{ required: true, message: '按钮必须填写权限标识', trigger: 'blur' }],
}

/* ===== 新增按钮：上级菜单候选（全部页面型菜单，标注所属目录） ===== */
const buttonParentOptions = computed(() => {
  const opts: { id: number; label: string }[] = []
  const walk = (nodes: MenuNode[], prefix: string) => {
    for (const n of nodes) {
      if (n.menu_type === 'button') continue
      const label = prefix ? `${prefix} / ${n.name}` : n.name
      if (n.menu_type === 'menu') opts.push({ id: n.id, label })
      if (n.children?.length) walk(n.children, label)
    }
  }
  walk(tree.value, '')
  return opts
})

/* ===== 图标库（Remix Icon ri: 常用集；覆盖项目全部在用图标 + 后台系统高频图标） ===== */
const iconPickerVisible = ref(false)
const iconKeyword = ref('')
const ICON_LIST = [
  // 导航/系统
  'ri:home-smile-2-line', 'ri:dashboard-line', 'ri:menu-line', 'ri:menu-2-fill', 'ri:apps-2-line',
  'ri:settings-3-line', 'ri:settings-4-line', 'ri:list-settings-line', 'ri:folder-line', 'ri:folder-3-line',
  'ri:record-circle-line', 'ri:function-line', 'ri:command-line', 'ri:terminal-box-line',
  // 告警/状态
  'ri:alarm-warning-line', 'ri:error-warning-line', 'ri:alert-line', 'ri:notification-2-line',
  'ri:notification-off-line', 'ri:checkbox-circle-line', 'ri:close-circle-line', 'ri:information-line',
  'ri:question-line', 'ri:shield-check-line', 'ri:shield-user-line', 'ri:fire-line', 'ri:flashlight-line',
  // 设备/工业
  'ri:server-line', 'ri:computer-line', 'ri:cpu-line', 'ri:radar-line', 'ri:tools-line',
  'ri:hammer-line', 'ri:wrench-line', 'ri:truck-line', 'ri:robot-line', 'ri:sensor-line',
  'ri:dashboard-3-line', 'ri:government-line', 'ri:building-2-line', 'ri:building-line', 'ri:factory-line',
  // 水/能源
  'ri:drizzle-line', 'ri:water-flash-line', 'ri:drop-line', 'ri:ripple-line', 'ri:flashlight-fill',
  'ri:lightbulb-line', 'ri:battery-charge-line', 'ri:plug-line', 'ri:temp-hot-line', 'ri:temp-cold-line',
  // 图表/数据
  'ri:pie-chart-2-line', 'ri:line-chart-line', 'ri:bar-chart-box-line', 'ri:bar-chart-2-line',
  'ri:donut-chart-line', 'ri:stock-line', 'ri:fund-line', 'ri:database-2-line', 'ri:cloud-line',
  // 单据/流程
  'ri:coupon-line', 'ri:task-line', 'ri:file-list-3-line', 'ri:file-text-line', 'ri:file-paper-2-line',
  'ri:send-plane-line', 'ri:send-plane-fill', 'ri:list-check-2', 'ri:calendar-check-line', 'ri:calendar-2-line',
  'ri:time-line', 'ri:time-fill', 'ri:history-line', 'ri:archive-drawer-line', 'ri:archive-line',
  // 人员/组织
  'ri:user-line', 'ri:user-3-line', 'ri:team-line', 'ri:user-settings-line', 'ri:shield-user-line',
  'ri:contacts-line', 'ri:id-card-line', 'ri:user-add-line', 'ri:user-star-line',
  // 操作/编辑
  'ri:add-line', 'ri:add-fill', 'ri:pencil-line', 'ri:edit-line', 'ri:delete-bin-5-line', 'ri:eye-line',
  'ri:search-line', 'ri:refresh-line', 'ri:download-2-line', 'ri:upload-2-line', 'ri:upload-cloud-2-line',
  'ri:file-copy-line', 'ri:links-line', 'ri:link', 'ri:share-line', 'ri:printer-line', 'ri:qr-code-line',
  'ri:key-2-line', 'ri:lock-line', 'ri:lock-unlock-line', 'ri:login-circle-line', 'ri:logout-circle-line',
  // 方向/指示
  'ri:arrow-up-line', 'ri:arrow-down-line', 'ri:arrow-left-s-line', 'ri:arrow-right-s-line',
  'ri:arrow-up-s-fill', 'ri:arrow-down-s-fill', 'ri:fullscreen-line', 'ri:fullscreen-exit-line',
  'ri:more-2-fill', 'ri:subtract-line', 'ri:check-line', 'ri:close-line',
  // 其他常用
  'ri:emotion-line', 'ri:star-line', 'ri:heart-line', 'ri:flag-line', 'ri:map-pin-line', 'ri:map-pin-2-line',
  'ri:price-tag-3-line', 'ri:bookmark-line', 'ri:book-2-line', 'ri:book-read-line', 'ri:guide-line',
  'ri:camera-line', 'ri:image-line', 'ri:video-line', 'ri:music-2-line', 'ri:global-line', 'ri:wifi-line',
  'ri:phone-line', 'ri:mail-line', 'ri:message-2-line', 'ri:chat-1-line', 'ri:notification-badge-line',
  'ri:gift-line', 'ri:trophy-line', 'ri:medal-line', 'ri:vip-crown-line', 'ri:money-cny-circle-line',
  'ri:briefcase-fill', 'ri:car-line', 'ri:ship-line', 'ri:train-line', 'ri:plane-line',
]
const filteredIcons = computed(() => {
  const kw = iconKeyword.value.trim().toLowerCase()
  if (!kw) return ICON_LIST
  return ICON_LIST.filter((n) => n.toLowerCase().includes(kw))
})
function onPickIcon(name: string) {
  form.icon = name
  iconPickerVisible.value = false
}

const handleAddMenu = (): void => {
  openCreate(0)
}

/* 新增按钮入口：按钮必须挂在页面型菜单下，默认选中第一个可选父菜单 */
const handleAddButton = (): void => {
  if (!hasPerm('sys:menu:manage')) return
  openCreate(buttonParentOptions.value[0]?.id ?? 0)
  form.menu_type = 'button'
}

const handleAddChild = (row: MenuNode): void => {
  openCreate(row.id)
  form.menu_type = row.menu_type === 'dir' ? 'menu' : 'button'
}

function openCreate(parentId: number) {
  if (!hasPerm('sys:menu:manage')) return
  Object.assign(form, {
    id: null,
    name: '',
    path: '',
    component: '',
    icon: '',
    parent_id: parentId,
    sort: 0,
    menu_type: parentId === 0 ? 'dir' : 'menu',
    perms: '',
    visible: 1,
    status: 1,
  })
  visible.value = true
}

function openEdit(row: MenuNode) {
  if (!hasPerm('sys:menu:manage')) return
  Object.assign(form, {
    id: row.id,
    name: row.name,
    path: row.path || '',
    component: row.component || '',
    icon: row.icon || '',
    parent_id: row.parent_id,
    sort: row.sort,
    menu_type: row.menu_type,
    perms: row.perms || '',
    visible: row.visible ?? 1,
    status: 1,
  })
  visible.value = true
}

async function onSave() {
  await formRef.value?.validate()
  saving.value = true
  try {
    const isButton = form.menu_type === 'button'
    const payload = {
      name: form.name,
      // 按钮节点无路由/组件/图标概念，强制清空避免脏数据
      path: isButton ? undefined : form.path || undefined,
      component: isButton ? undefined : form.component || undefined,
      icon: isButton ? undefined : form.icon || undefined,
      parent_id: form.parent_id,
      sort: form.sort,
      menu_type: form.menu_type,
      perms: form.perms || undefined,
      // 按钮不参与侧边栏渲染，库内恒为隐藏；目录/菜单按开关保存
      visible: isButton ? 0 : form.visible,
      status: form.status,
    }
    if (form.id) {
      await updateMenu(form.id, payload)
      ElMessage.success('已更新')
    } else {
      await createMenu(payload)
      ElMessage.success('已新增')
    }
    // 通知侧边栏实时刷新「是否显示」等菜单变更（无需重新登录）
    window.dispatchEvent(new CustomEvent('app:menus-changed'))
    visible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function onDelete(row: MenuNode) {
  if (!hasPerm('sys:menu:manage')) return
  await deleteMenu(row.id)
  ElMessage.success('删除成功')
  window.dispatchEvent(new CustomEvent('app:menus-changed'))
  await load()
}

/* ===== 生命周期 ===== */
onMounted(() => {
  load()
})
</script>

<style lang="scss" scoped>
/* 表格头部工具栏布局（对齐参考 ArtTableHeader） */
.table-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;

  .th-left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }
  .th-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
}

/* 表格：占满卡片剩余高度，行区内部滚动（对齐参考 art-table 高级表格） */
.menu-table {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 10px;
}

/* 列设置弹层选项 */
.column-option {
  display: flex;
  align-items: center;

  :deep(.el-checkbox) {
    flex: 1;
    min-width: 0;
  }
}

/* 图标输入框清空按钮 */
.icon-clear {
  cursor: pointer;
  color: var(--el-text-color-secondary);
}
.icon-clear:hover {
  color: var(--el-color-primary);
}

/* 图标库选择器网格：auto-fill 自适应列数（窄屏自动降为 3~4 列） */
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
}
.icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px 8px;
  border: 1px solid #e4eefb;
  border-radius: 8px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}
.icon-cell:hover {
  border-color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 6%, #ffffff);
  transform: translateY(-1px);
}
.icon-cell.active {
  border-color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, #ffffff);
  color: var(--el-color-primary);
}
.icon-name {
  max-width: 100%;
  overflow: hidden;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-cell.active .icon-name {
  color: var(--el-color-primary);
}
</style>

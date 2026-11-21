<template>
  <div class="page mod-archive" :class="{ 'is-ready': pageReady }">
    <!-- 页面标题 + 描述（对齐设计稿：运维档案中心） -->
    

    <!-- KPI 磨砂面板：4 张档案统计卡整行铺满（对齐设计稿） -->
    <div class="kpi-panel">
      <div class="kpi-row archive-kpi-row">
        <KpiCard
          v-for="(c, idx) in kpis"
          :key="c.label"
          class="dash-card"
          :style="{ '--i': idx }"
          variant="poster"
          :label="c.label"
          :value="c.value"
          :color="c.color"
          :icon="c.icon"
          :bg-image="c.bg"
          bg-cover
        >
          <template #footer>
            <span class="kpi-trend">
              <template v-if="c.trendLabel">
                <span class="kpi-trend-label">{{ c.trendLabel }}</span>
                <span class="kpi-trend-up" :class="{ 'is-down': !c.up }">{{ c.trend }}<ArtSvgIcon :icon="c.up ? 'ri:arrow-up-line' : 'ri:arrow-down-line'" /></span>
              </template>
              <template v-else-if="c.metrics?.length">
                <span v-for="(m, i) in c.metrics" :key="m.label" class="kpi-metric" :class="{ 'is-next': i > 0 }">
                  <span class="kpi-metric-label">{{ m.label }}</span>
                  <b class="kpi-metric-value">{{ m.value }}</b>
                </span>
              </template>
            </span>
          </template>
        </KpiCard>
      </div>
    </div>

    <div class="archive-body">
      <!-- 左窄栏：档案分类（分类树） -->
      <el-card shadow="never" class="art-table-card doc-type-card">
          <div class="dt-head">
            <span class="dt-title">档案分类</span>
          </div>

          <div class="dt-search">
            <el-input v-model="typeKeyword" placeholder="搜索分类名称" clearable>
              <template #prefix>
                <ArtSvgIcon icon="ri:search-line" class="dt-search-ico" />
              </template>
            </el-input>
          </div>

          <ul class="dt-tree">
            <!-- 全部文件（虚拟根）：hover 出现新增 -->
            <li
              class="dt-node dt-root"
              :class="{ 'is-active': activeNode === 'all' }"
              @click="selectNode('all')"
            >
              <span class="dt-ico"><ArtSvgIcon icon="ri:folder-3-fill" /></span>
              <span class="dt-name">全部档案</span>
              <span class="dt-count">({{ totalCount }})</span>
              <span v-if="hasPerm('archive:category:create')" class="dt-actions">
                <button class="dt-act" title="新增分类" @click.stop="openCreate">
                  <ArtSvgIcon icon="ri:add-line" />
                </button>
              </span>
            </li>

            <template v-for="node in filteredTree" :key="node.id">
              <li
                class="dt-node"
                :class="{ 'is-active': activeNode === node.id }"
                @click="selectNode(node.id)"
              >
                <span
                  v-if="node.children?.length"
                  class="dt-caret"
                  :class="{ 'is-open': expanded.has(node.id) }"
                  @click.stop="toggleNode(node.id)"
                >
                  <ArtSvgIcon icon="ri:arrow-down-s-fill" />
                </span>
                <span class="dt-ico"><ArtSvgIcon icon="ri:folder-3-fill" /></span>
                <span class="dt-name">{{ node.name }}</span>
                <span class="dt-count">({{ node.count }})</span>
                <span class="dt-actions">
                  <button v-if="hasPerm('archive:category:update')" class="dt-act" title="编辑分类" @click.stop="openEdit(node)">
                    <ArtSvgIcon icon="ri:pencil-line" />
                  </button>
                  <DeleteConfirm
                    v-if="hasPerm('archive:category:delete')"
                    :text="`确认删除分类「${node.name}」？`"
                    @confirm="onDeleteCategory(node)"
                  >
                    <button class="dt-act is-danger" title="删除分类">
                      <ArtSvgIcon icon="ri:delete-bin-5-line" />
                    </button>
                  </DeleteConfirm>
                </span>
              </li>
              <li
                v-for="child in expanded.has(node.id) ? node.children : []"
                :key="child.id"
                class="dt-node dt-child"
                :class="{ 'is-active': activeNode === child.id }"
                @click="selectNode(child.id)"
              >
                <span class="dt-ico"><ArtSvgIcon icon="ri:file-line" /></span>
                <span class="dt-name">{{ child.name }}</span>
                <span class="dt-count">({{ child.count }})</span>
                <span class="dt-actions">
                  <button v-if="hasPerm('archive:category:update')" class="dt-act" title="编辑分类" @click.stop="openEdit(child)">
                    <ArtSvgIcon icon="ri:pencil-line" />
                  </button>
                  <DeleteConfirm
                    v-if="hasPerm('archive:category:delete')"
                    :text="`确认删除分类「${child.name}」？`"
                    @confirm="onDeleteCategory(child)"
                  >
                    <button class="dt-act is-danger" title="删除分类">
                      <ArtSvgIcon icon="ri:delete-bin-5-line" />
                    </button>
                  </DeleteConfirm>
                </span>
              </li>
            </template>
          </ul>
      </el-card>

      <!-- 中栏：搜索栏 + 表格（详情展开时表格压缩让位，搜索栏保持不动） -->
      <div class="archive-main">
        <ProSearchBar
          v-model="query"
          :items="searchItems"
          :span="6"
          @search="onSearch"
          @reset="onReset"
        />
        <!-- 表格行：表格 + 详情面板同排同高（搜索栏不受面板展开影响） -->
        <div class="table-row">
          <el-card shadow="never" class="art-table-card doc-table-card">
          <!-- 表头工具条：左侧上传文档，右侧刷新（与全站表格页统一 ProTableHeader） -->
          <ProTableHeader :loading="loading" @refresh="refreshAll">
            <template #left>
              <el-button v-if="hasPerm('archive:upload')" class="btn-create" type="primary" @click="openUpload">
                <ArtSvgIcon icon="ri:upload-cloud-2-line" class="btn-create-icon" />上传文档
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
            <template #name="{ row }">
              <div class="doc-name">
                <span class="ft-chip" :class="`ft-${ftKind(row.file_format)}`">
                  {{ ftLabel(row.file_format) }}
                </span>
                <span class="doc-name-text">{{ row.name }}</span>
              </div>
            </template>
            <template #category_name="{ row }">
              <span class="doc-tag" :class="`cat-${catKind(row.category_code)}`">
                {{ row.category_name }}
              </span>
            </template>
            <template #source="{ row }">
              <span class="src-tag" :class="row.source === '自动关联' ? 'is-auto' : 'is-manual'">
                {{ row.source || '人工上传' }}
              </span>
            </template>
            <template #related_equipment="{ row }">
              <span class="eq-text">{{ row.related_equipment || '—' }}</span>
            </template>
            <template #upload_time="{ row }">{{ fmtTime(row.upload_time) }}</template>
            <template #operation="{ row }">
              <div class="action-cell">
                <ArtButtonTable
                  v-if="hasPerm('archive:download')"
                  icon="ri:download-2-line"
                  icon-class="bg-secondary/12 text-secondary"
                  title="下载"
                  label="下载"
                  @click="onDownload(row)"
                />
                <DeleteConfirm
                  v-if="hasPerm('archive:delete')"
                  :text="`确认删除档案「${row.name}」？删除后不可恢复。`"
                  @confirm="confirmDelete(row)"
                >
                  <ArtButtonTable type="delete" title="删除" label="删除" />
                </DeleteConfirm>
                <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
                <ArtButtonTable type="view" title="详情" label="详情" @click="onView(row)" />
              </div>
            </template>
          </ProTable>
        </el-card>

        <!-- 右：文件详情（与表格卡同高，width 过渡展开/收起） -->
        <DocDetailPanel
          :row="detailRow"
          :visible="detailVisible"
          :category-path="detailCategoryPath"
          @close="detailVisible = false"
        />
        </div>
      </div>
    </div>

    <ProDialog v-model="visible" title="上传文档" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="文档名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:archive-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="文档类型" prop="category_code" required>
          <el-tree-select
            v-model="form.category_code"
            :data="uploadTreeData"
            :props="{ label: 'label', value: 'value', children: 'children', disabled: 'disabled' }"
            node-key="value"
            check-strictly
            default-expand-all
            :render-after-expand="false"
            placeholder="请选择文档类型"
            style="width: 100%"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:price-tag-3-line" /></span>
            </template>
          </el-tree-select>
        </el-form-item>
        <el-form-item label="选择文件" required>
          <input type="file" @change="onFile" />
          <div class="hint">支持 PDF/Word/Excel/图片/CAD 等，单文件 ≤ 50MB</div>
        </el-form-item>
        <el-form-item label="备注">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="form.description" type="textarea" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="onUpload">上传</el-button>
      </template>
    </ProDialog>

    <!-- 分类新增 / 编辑 -->
    <ProDialog v-model="catVisible" :title="catDialogTitle" width="420px">
      <el-form ref="catFormRef" :model="catForm" :rules="catRules" label-width="90px">
        <el-form-item label="分类名称" prop="name" required>
          <el-input v-model="catForm.name" placeholder="请输入分类名称">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:folder-3-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="文档数量">
          <el-input-number
            v-model="catForm.count"
            :min="0"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="catVisible = false">取消</el-button>
        <el-button type="primary" :loading="catSaving" @click="onSaveCategory">保存</el-button>
      </template>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { formatDateTime } from '@/utils/time'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  createArchiveCategory,
  deleteArchive,
  deleteArchiveCategory,
  fetchArchiveStats,
  listArchiveCategories,
  listArchives,
  updateArchiveCategory,
  uploadArchive,
  type ArchiveCategoryNode,
  type ArchiveItem,
  type ArchiveStats,
} from '@/api/archive'
import { useUserStore } from '@/stores/user'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProDialog from '@/components/ProDialog.vue'
import DocDetailPanel from '@/components/DocDetailPanel.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import KpiCard from '@/components/KpiCard.vue'
import kpiBgArchive from '@/assets/img/file/01_archive_blue.webp'
import kpiBgWorkorder from '@/assets/img/file/02_workorder_green.webp'
import kpiBgEquipment from '@/assets/img/file/03_equipment_purple.webp'
import kpiBgTechnical from '@/assets/img/file/04_technical_orange.webp'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()
const user = useUserStore()
const loading = ref(false)
const uploading = ref(false)
const rows = ref<ArchiveItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const visible = ref(false)
const fileObj = ref<File | null>(null)
/* 文档详情内嵌面板（第三栏） */
const detailVisible = ref(false)
const detailRow = ref<ArchiveItem | null>(null)
/* 详情面板所属目录完整路径（如「设备资料 / 设备说明书」） */
const detailCategoryPath = computed(() => {
  const code = detailRow.value?.category_code
  if (!code) return ''
  const walk = (nodes: ArchiveCategoryNode[], trail: string[]): string[] | null => {
    for (const n of nodes) {
      const next = [...trail, n.name]
      if (n.code === code) return next
      const hit = walk(n.children || [], next)
      if (hit) return hit
    }
    return null
  }
  return walk(categoriesTree.value, [])?.join(' / ') || detailRow.value?.category_name || ''
})

/* ---------- KPI（数据源：接口 /archives/stats + 分类树） ---------- */
const archiveStats = ref<ArchiveStats | null>(null)

/** 环比数值 → 展示文本（后端返回 null 表示上期基数为 0，显示占位） */
function fmtTrend(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return `${v >= 0 ? '+' : ''}${v}%`
}
/** 环比方向：正值/无数据显示上箭头，负值显示下箭头 */
function trendUp(v: number | null | undefined) {
  return v === null || v === undefined ? true : v >= 0
}

/** 分类卡配色与图标轮盘（对齐设计稿：蓝/绿/紫/橙） */
const CATEGORY_PALETTE = [
  { color: '#22c55e', icon: 'ri:checkbox-circle-line' },
  { color: '#7c5cff', icon: 'ri:folder-3-fill' },
  { color: '#f59e0b', icon: 'ri:file-text-line' },
  { color: '#06b6d4', icon: 'ri:file-list-3-line' },
]

const kpis = computed(() => {
  const s = archiveStats.value
  // 取顶层分类按数量降序，前 3 个作为分类卡
  const topCats = [...categoriesTree.value]
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 3)

  const cards: {
    label: string
    value: number
    color: string
    icon: string
    bg: string
    trendLabel?: string
    trend?: string
    up?: boolean
    metrics?: { label: string; value: string | number }[]
  }[] = [
    {
      label: '档案总数',
      value: s?.total ?? 0,
      trendLabel: '较上月',
      trend: fmtTrend(s?.trend.total),
      up: trendUp(s?.trend.total),
      color: '#2f7cf6',
      icon: 'ri:archive-line',
      bg: kpiBgArchive,
    },
  ]

  topCats.forEach((cat, i) => {
    const palette = CATEGORY_PALETTE[i] || CATEGORY_PALETTE[CATEGORY_PALETTE.length - 1]
    const bg = [kpiBgWorkorder, kpiBgEquipment, kpiBgTechnical][i] || kpiBgWorkorder
    // 子分类前 2 项作为底部副指标（对齐设计稿：如「待归档 72 | 退档 46」）
    const metrics = (cat.children || []).slice(0, 2).map((c) => ({
      label: c.name,
      value: c.count || 0,
    }))
    cards.push({
      label: cat.name,
      value: cat.count || 0,
      color: palette.color,
      icon: palette.icon,
      bg,
      metrics,
    })
  })

  return cards
})

async function loadStats() {
  const { data } = await fetchArchiveStats()
  archiveStats.value = data.data
}

/* ---------- 文档类型树（后端持久化分类） ---------- */
const categoriesTree = ref<ArchiveCategoryNode[]>([])
const typeKeyword = ref('')
const activeNode = ref<number | 'all'>('all')
const expanded = ref<Set<number>>(new Set())

const totalCount = computed(() =>
  categoriesTree.value.reduce((s, n) => s + (n.count || 0), 0),
)

const filteredTree = computed(() => {
  const kw = typeKeyword.value.trim()
  if (!kw) return categoriesTree.value
  return categoriesTree.value.filter(
    (n) => n.name.includes(kw) || n.children?.some((c) => c.name.includes(kw)),
  )
})

/* 叶子分类（可承载文档），供上传/搜索下拉使用 */
const leafOptions = computed(() => {
  const out: { code: string; name: string }[] = []
  const walk = (nodes: ArchiveCategoryNode[]) => {
    nodes.forEach((n) => {
      if (n.children?.length) walk(n.children)
      else if (n.code) out.push({ code: n.code, name: n.name })
    })
  }
  walk(categoriesTree.value)
  return out
})

/* ---------- 树形下拉数据（档案类型） ---------- */
interface CatTreeOption {
  value: string
  label: string
  disabled?: boolean
  children?: CatTreeOption[]
}
/* 搜索栏：父级仅作分组不可选，叶子分类可选（含运维记录三类工单） */
const categoryTreeData = computed<CatTreeOption[]>(() =>
  categoriesTree.value.map((g) => ({
    value: g.code || `g-${g.id}`,
    label: g.name,
    disabled: true,
    children: (g.children || []).map((c) => ({ value: c.code || '', label: c.name })),
  })),
)
/* 上传弹窗：运维记录整组禁用（工单档案由系统验收后自动归档，不允许人工上传） */
const uploadTreeData = computed<CatTreeOption[]>(() =>
  categoriesTree.value.map((g) => {
    const isOps = (g.children || []).some((c) => c.code?.startsWith('DOC-ORDER'))
    return {
      value: g.code || `g-${g.id}`,
      label: isOps ? `${g.name}（系统自动归档）` : g.name,
      disabled: true,
      children: (g.children || []).map((c) => ({
        value: c.code || '',
        label: c.name,
        disabled: isOps,
      })),
    }
  }),
)

function toggleNode(id: number) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}
function selectNode(id: number | 'all') {
  activeNode.value = id
  // 树点击联动右侧表格：取当前节点的全部子孙叶子分类码过滤
  page.value = 1
  load()
}

/* 收集某节点下所有叶子分类的 code（含自身为叶子时） */
function collectLeafCodes(node: ArchiveCategoryNode): string[] {
  if (!node.children?.length) return node.code ? [node.code] : []
  return node.children.flatMap(collectLeafCodes)
}

/* 当前选中节点对应的过滤分类码；'all' 返回 undefined 表示不过滤 */
const activeCategoryCodes = computed<string | undefined>(() => {
  if (activeNode.value === 'all') return undefined
  const find = (nodes: ArchiveCategoryNode[]): ArchiveCategoryNode | null => {
    for (const n of nodes) {
      if (n.id === activeNode.value) return n
      const r = n.children?.length ? find(n.children) : null
      if (r) return r
    }
    return null
  }
  const node = find(categoriesTree.value)
  if (!node) return undefined
  const codes = collectLeafCodes(node)
  return codes.length ? codes.join(',') : undefined
})

async function loadCategories() {
  const { data } = await listArchiveCategories()
  categoriesTree.value = data.data
  if (!expanded.value.size) {
    expanded.value = new Set(data.data.map((n) => n.id))
  }
}

/* ---------- 分类新增 / 编辑 / 删除 ---------- */
const catVisible = ref(false)
const catDialogTitle = ref('新增分类')
const catEditing = ref<ArchiveCategoryNode | null>(null)
const catSaving = ref(false)
const catForm = reactive({ name: '', count: 0 })

function openCreate() {
  catEditing.value = null
  catDialogTitle.value = '新增分类'
  catForm.name = ''
  catForm.count = 0
  catVisible.value = true
}
function openEdit(node: ArchiveCategoryNode) {
  catEditing.value = node
  catDialogTitle.value = '编辑分类'
  catForm.name = node.name
  catForm.count = node.count
  catVisible.value = true
}
async function onSaveCategory() {
  const valid = await catFormRef.value?.validate().catch(() => false)
  if (!valid) return
  catSaving.value = true
  try {
    if (catEditing.value) {
      await updateArchiveCategory(catEditing.value.id, {
        name: catForm.name.trim(),
        count: catForm.count,
      })
      ElMessage.success('已保存')
    } else {
      await createArchiveCategory({ name: catForm.name.trim(), parent_id: 0, count: catForm.count })
      ElMessage.success('已新增')
    }
    catVisible.value = false
    await loadCategories()
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    catSaving.value = false
  }
}
/** 分类删除：确认弹框由 DeleteConfirm 提供 */
async function onDeleteCategory(node: ArchiveCategoryNode) {
  try {
    await deleteArchiveCategory(node.id)
    ElMessage.success('已删除')
    if (activeNode.value === node.id) activeNode.value = 'all'
    await loadCategories()
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

/* ---------- 查询条件 ---------- */
const query = reactive<{
  keyword: string
  category_code: string | undefined
  related_equipment: string
  date_range: [string, string] | undefined
}>({
  keyword: '',
  category_code: undefined,
  related_equipment: '',
  date_range: undefined,
})

const searchItems = computed<SearchFormItem[]>(() => [
  {
    key: 'keyword',
    label: '档案名称',
    type: 'input',
    props: { clearable: true, placeholder: '请输入档案名称、工单编号、设备名称等关键词' },
  },
  {
    key: 'category_code',
    label: '档案类型',
    type: 'treeselect',
    props: {
      clearable: true,
      placeholder: '全部类型',
      data: categoryTreeData.value,
      props: { label: 'label', value: 'value', children: 'children', disabled: 'disabled' },
      nodeKey: 'value',
      checkStrictly: true,
      defaultExpandAll: true,
      renderAfterExpand: false,
      style: 'width: 100%',
    },
  },
  
  {
    key: 'date_range',
    label: '上传时间',
    type: 'daterange',
    props: {
      type: 'daterange',
      valueFormat: 'YYYY-MM-DD',
      startPlaceholder: '开始日期',
      endPlaceholder: '结束日期',
      style: 'width: 100%',
    },
  },
])

/* ---------- 表格列 ---------- */
const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 56, align: 'center' },
  // 固定列宽合计需小于表格容器宽度，避免固定操作列压住「上传时间」；档案名称用 minWidth 吸收剩余空间
  { prop: 'name', label: '档案名称', minWidth: 120, showOverflowTooltip: true },
  { prop: 'category_name', label: '档案类型', width: 130, align: 'center' },
  { prop: 'source', label: '来源', width: 100, align: 'center' },
  { prop: 'related_equipment', label: '关联设备', width: 110, align: 'center' },
  { prop: 'upload_time', label: '上传时间', width: 150, align: 'center' },
  // 操作列宽按最多 3 个图标按钮（下载/删除/详情）紧凑适配，详情固定排最右
  { prop: 'operation', label: '操作', width: 150, align: 'right', fixed: 'right' },
])

function ftKind(fmt?: string) {
  const f = (fmt || '').toLowerCase()
  if (f === 'pdf') return 'red'
  if (f === 'doc' || f === 'docx') return 'blue'
  if (f === 'xls' || f === 'xlsx') return 'green'
  return 'gray'
}
function ftLabel(fmt?: string) {
  const f = (fmt || '').toLowerCase()
  if (f === 'pdf') return 'PDF'
  if (f === 'doc') return 'DOC'
  if (f === 'docx') return 'DOCX'
  if (f === 'xls') return 'XLS'
  if (f === 'xlsx') return 'XLSX'
  if (f === 'dwg' || f === 'dxf') return 'CAD'
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(f)) return 'IMG'
  return (f || 'FILE').toUpperCase().slice(0, 4)
}
function catKind(code: string) {
  return (
    {
      // 运维记录（工单档案）
      'DOC-ORDER-ALARM': 'red',
      'DOC-ORDER-INSPECTION': 'indigo',
      'DOC-ORDER-MAINTENANCE': 'purple',
      'DOC-ORDER-MANUAL': 'blue',
      // 设备资料
      'DOC-EQ-MANUAL': 'blue',
      'DOC-DRAWING': 'purple',
      'DOC-EQ-SPEC': 'cyan',
      // 技术资料
      'DOC-STANDARD': 'green',
      'DOC-TECH-PLAN': 'amber',
      'DOC-MAINT-MANUAL': 'teal',
      // 合同文件
      'DOC-CONTRACT-PURCHASE': 'amber',
      'DOC-CONTRACT-SERVICE': 'teal',
      // 其他
      'DOC-OTHER': 'gray',
    } as Record<string, string>
  )[code] || 'blue'
}
function fmtTime(t?: string) {
  return formatDateTime(t, false)
}

const form = reactive({
  name: '',
  category_code: 'DOC-DRAWING',
  description: '',
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写文档名称', trigger: 'blur' }],
  category_code: [{ required: true, message: '请选择文档类型', trigger: 'change' }],
}
const catFormRef = ref<FormInstance>()
const catRules: FormRules = {
  name: [{ required: true, message: '请填写分类名称', trigger: 'blur' }],
}

/* ---------- 数据加载 ---------- */
async function load() {
  loading.value = true
  try {
    const { data } = await listArchives({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
      // 搜索栏手动选了类型则以搜索栏为准，否则跟随左侧树选中节点
      category_code: query.category_code,
      category_codes: query.category_code ? undefined : activeCategoryCodes.value,
      related_equipment: query.related_equipment || undefined,
      start_date: query.date_range?.[0],
      end_date: query.date_range?.[1],
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
  query.category_code = undefined
  query.related_equipment = ''
  query.date_range = undefined
  // 重置后回到「全部档案」，解除树过滤
  activeNode.value = 'all'
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

function openUpload() {
  form.name = ''
  // 默认选中第一个可上传叶子分类（排除运维记录下的工单档案分类）
  const firstUploadable = leafOptions.value.find((c) => !c.code.startsWith('DOC-ORDER'))
  form.category_code = firstUploadable?.code || ''
  form.description = ''
  fileObj.value = null
  visible.value = true
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  fileObj.value = input.files?.[0] || null
  if (fileObj.value && !form.name) {
    form.name = fileObj.value.name.replace(/\.[^.]+$/, '')
  }
}

async function onUpload() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (!fileObj.value) {
    ElMessage.warning('请选择文件')
    return
  }
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('name', form.name)
    fd.append('category_code', form.category_code)
    if (form.description) fd.append('description', form.description)
    fd.append('file', fileObj.value)
    await uploadArchive(fd)
    ElMessage.success('上传成功')
    visible.value = false
    await refreshAll()
  } finally {
    uploading.value = false
  }
}

/* 上传/刷新后：同时刷新表格、左侧分类计数与 KPI 统计 */
async function refreshAll() {
  await Promise.all([load(), loadCategories(), loadStats()])
}

async function fetchBlob(row: ArchiveItem) {
  const res = await fetch(`/api/v1/archives/${row.id}/download`, {
    headers: { Authorization: `Bearer ${user.token}` },
  })
  if (!res.ok) return null
  return res.blob()
}

function onView(row: ArchiveItem) {
  /* 同一行再点 → 收起；换行 → 原地刷新内容 */
  if (detailVisible.value && detailRow.value?.id === row.id) {
    detailVisible.value = false
    return
  }
  detailRow.value = row
  detailVisible.value = true
}

async function onDownload(row: ArchiveItem) {
  const blob = await fetchBlob(row)
  if (!blob) {
    ElMessage.error('下载失败')
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = row.file_name || row.name
  a.click()
  URL.revokeObjectURL(url)
  await load()
}

/** 表格行删除：确认后执行软删（弹框由 DeleteConfirm 提供） */
async function confirmDelete(row: ArchiveItem) {
  try {
    await deleteArchive(row.id)
    ElMessage.success('已删除')
    await load()
    await loadStats()
    // 如果删除的是当前展开的详情行，关闭右侧面板
    if (detailVisible.value && detailRow.value?.id === row.id) {
      detailVisible.value = false
      detailRow.value = null
    }
  } catch {
    /* 后端拒绝等 */
  }
}

const pageReady = ref(false)

onMounted(async () => {
  pageReady.value = true
  await loadCategories()
  await Promise.all([load(), loadStats()])
})
</script>

<style lang="scss" scoped>
@use '@styles/core/breakpoints.scss' as bp;
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* KPI 面板与内容区仅保留一层 12px 间距 */
.page .kpi-panel {
  margin-bottom: 0;
}

/* ===== 页面标题 + 描述（对齐设计稿） ===== */
.page-head {
  flex: 0 0 auto;
}
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #1f2d3d;
  letter-spacing: 0.01em;
}
.page-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8a97a8;
  line-height: 1.5;
}

/* ===== 上传文档按钮（与全站表格页统一的渐变蓝风格） ===== */
.btn-create {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px !important;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #fff;
  background: linear-gradient(135deg, #3e9cff 0%, #1673fc 100%);
  box-shadow:
    0 6px 14px -6px rgba(20, 105, 252, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}
.btn-create:hover,
.btn-create:focus {
  color: #fff;
  background: linear-gradient(135deg, #4fa7ff 0%, #2580ff 100%);
  box-shadow:
    0 8px 18px -6px rgba(20, 105, 252, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
  transform: translateY(-1px);
}
.btn-create:active {
  transform: translateY(0);
}
.btn-create-icon {
  font-size: 16px;
  font-weight: 600;
}

/* ===== 内容行：左窄树 + 右宽表格，撑满剩余高度 ===== */
/* ===== 三栏布局：左树（固定比例）+ 中表格（弹性让位）+ 右详情（0 ↔ 324px 过渡） ===== */
.archive-body {
  display: flex;
  flex: 1 1 auto;
  gap: 12px;
  min-height: 0;
}
.archive-body > .doc-type-card {
  flex: 0 0 clamp(240px, 19%, 340px);
}
.archive-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  gap: 12px;
}
/* 表格 + 详情面板同排：面板高度随表格卡拉伸，搜索栏横跨全宽不受影响
   （清掉全局 .art-table-card 的 margin-top，行内间距统一交给 gap） */
.table-row {
  display: flex;
  flex: 1 1 auto;
  gap: 12px;
  min-height: 0;
}
.table-row .art-table-card {
  margin-top: 0;
}
.table-row > .doc-table-card {
  flex: 1 1 auto;
  min-width: 0;
}

/* ===== KPI 卡（设计稿 1:1：白卡 + 圆形渐变徽章 + 环比 + 柱状 sparkline） ===== */
.archive-kpi-row {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.kpi-panel :deep(.kpi-card.is-poster) {
  min-height: 88px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #e8f0fa;
  box-shadow: 0 6px 18px -10px rgba(30, 80, 180, 0.18);
}
/* 去掉 poster 默认左侧色条（设计稿无） */
.kpi-panel :deep(.kpi-card.is-poster)::before {
  display: none;
}
/* 圆形径向渐变图标徽章 */
.kpi-panel :deep(.kpi-card.is-poster .pt-badge) {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  font-size: 22px;
  color: #fff;
  background: radial-gradient(
    circle at 34% 28%,
    color-mix(in srgb, var(--c) 62%, #ffffff) 0%,
    color-mix(in srgb, var(--c) 96%, #0b2a5b) 82%
  );
  box-shadow: 0 8px 16px -8px color-mix(in srgb, var(--c) 70%, transparent);
}
/* 迷你柱状图：随卡片主色，末柱加深 */
.kpi-panel :deep(.kpi-card.is-poster .pt-bars) {
  height: 46px;
  gap: 4px;
}
.kpi-trend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.4;
}
.kpi-trend-label {
  color: #8a97a8;
}
.kpi-trend-up {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: #22a06b;
  font-weight: 600;
}
.kpi-trend-up :deep(.art-svg-icon) {
  font-size: 12px;
}
.kpi-trend-up.is-down {
  color: #e34d59;
}
/* 分类卡底部副指标（如「待归档 72 | 退档 46」） */
.kpi-metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.kpi-metric.is-next {
  margin-left: 10px;
  padding-left: 10px;
  border-left: 1px solid #dbe6f2;
}
.kpi-metric-label {
  font-size: 12px;
  color: #8a97a8;
}
.kpi-metric-value {
  font-size: 12.5px;
  font-weight: 700;
  color: #2b3a4d;
  font-variant-numeric: tabular-nums;
}

/* 窄屏隐藏 KPI 底部副文字（较上月 / 告警关联等），避免拥挤 */
@include bp.respond(wide) {
  .archive-kpi-row :deep(.kpi-card.is-poster .desc) {
    display: none;
  }
}

/* ===== 左栏：文档类型 ===== */
.doc-type-card {
  margin-top: 0;
}
.dt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid #eef3fa;
}
.dt-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2d3d;
  letter-spacing: 0.02em;
}
.dt-search {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.dt-search :deep(.el-input) {
  flex: 1 1 auto;
}
.dt-search-ico {
  color: #9aa7ba;
}
.dt-tree {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}
.dt-node {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 8px;
  font-size: 13.5px;
  color: #4b5b6e;
  cursor: pointer;
  border-radius: 8px;
}
.dt-node:hover {
  background: #f2f7fe;
}
.dt-node.is-active {
  font-weight: 600;
  color: #176bff;
  background: #e8f1ff;
}
.dt-node.is-active .dt-count {
  color: #176bff;
}
/* hover / 选中时浮现的操作按钮 */
.dt-actions {
  display: none;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.dt-node:hover .dt-actions,
.dt-node.is-active .dt-actions {
  display: inline-flex;
}
.dt-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 14px;
  color: #8a97a8;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.dt-act:hover {
  color: #176bff;
  background: #e8f1ff;
}
.dt-act.is-danger:hover {
  color: #f03d45;
  background: #ffecee;
}
.dt-caret {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 14px;
  color: #9aa7ba;
}
.dt-caret :deep(.art-svg-icon) {
  font-size: 14px;
  transition: transform 0.2s ease;
}
.dt-caret:not(.is-open) :deep(.art-svg-icon) {
  transform: rotate(-90deg);
}
.dt-ico {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  font-size: 15px;
  color: #2f7cf6;
}
.dt-child {
  padding-left: 28px;
}
.dt-child .dt-ico {
  color: #9aa7ba;
}
.dt-name {
  white-space: nowrap;
}
.dt-count {
  color: #9aa7ba;
  font-size: 12.5px;
}

/* ===== 右栏：表格 ===== */
.doc-table-card {
  min-height: 0;
}
.doc-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.doc-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 文件类型彩色小图标 */
.ft-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 22px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
  border-radius: 5px;
}
.ft-red {
  background: #f04438;
}
.ft-blue {
  background: #1677ff;
}
.ft-green {
  background: #22a06b;
}
.ft-gray {
  background: #94a3b8;
}
/* 文档类型彩色胶囊标签 */
.doc-tag {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 12px;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 6px;
}
.cat-blue {
  color: #176bff;
  background: #e8f1ff;
}
.cat-red {
  color: #f03d45;
  background: #ffecee;
}
.cat-green {
  color: #16a34a;
  background: #e7f8ed;
}
.cat-amber {
  color: #f59a07;
  background: #fff2db;
}
.cat-purple {
  color: #7c5cff;
  background: #efeaff;
}
.cat-cyan {
  color: #06b6d4;
  background: #e0f7fb;
}
.cat-indigo {
  color: #4f46e5;
  background: #eef0ff;
}
.cat-teal {
  color: #0d9488;
  background: #dcf7f3;
}
.cat-gray {
  color: #64748b;
  background: #f1f5f9;
}
/* 操作列图标按钮使用 ArtButtonTable 组件样式 */
/* 来源标签 */
.src-tag {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}
.src-tag.is-auto {
  color: #16a34a;
  background: #e7f8ed;
}
.src-tag.is-manual {
  color: #176bff;
  background: #e8f1ff;
}
/* 关联设备文本 */
.eq-text {
  font-size: 13px;
  color: #2b3a4d;
}
.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--art-gray-500);
}

@include bp.respond(laptop) {
  .archive-kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ===== 窄屏（≤900px）：左树/表格/详情三栏改纵向堆叠，详情面板全宽 ===== */
@include bp.respond(tablet) {
  .archive-body {
    flex-direction: column;
  }
  .archive-body > .doc-type-card {
    flex: 0 0 auto;
    width: 100%;
    max-height: 260px;
    overflow: auto;
  }
  .table-row {
    flex-direction: column;
  }
  /* 文档详情面板（宽 0↔380px 过渡容器）：窄屏展开时占满整行 */
  .table-row > .ddp.is-open {
    width: 100%;
    margin-left: 0;
  }
  .table-row :deep(.fdp-card) {
    width: 100%;
  }
}
@include bp.respond(mobile) {
  .archive-kpi-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

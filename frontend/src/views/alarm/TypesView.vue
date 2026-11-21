<template>
  <div class="types-panel">
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="onReset"
    />

    <el-card shadow="never" class="art-table-card types-card">
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:price-tag-3-line" />
        </span>
        <span class="head-title">告警类型</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="告警类型"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('alarm:type:create')" type="primary" @click="openCreate">
            <ArtSvgIcon class="btn-icon" icon="ri:add-line" />新增类型
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
        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="light">
            {{ row.status === 1 ? '正常' : '禁用' }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('alarm:type:update')" type="edit" title="编辑" @click="openEdit(row)" />
            <DeleteConfirm v-if="hasPerm('alarm:type:delete')" :text="`确认删除类型「${row.name}」？`" @confirm="onDelete(row)">
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑类型' : '新增类型'" width="520px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="类型名称" required>
          <el-input v-model="form.name" placeholder="请输入类型名称">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:edit-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="类型编码" required>
          <el-input v-model="form.code" placeholder="请输入类型编码">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:code-s-slash-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="说明">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="form.description" type="textarea" placeholder="请输入说明" />
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
        <el-button @click="visible = false">
          <ArtSvgIcon class="btn-icon" icon="ri:close-line" />取消
        </el-button>
        <el-button type="primary" @click="onSave">
          <ArtSvgIcon class="btn-icon" icon="ri:check-line" />保存
        </el-button>
      </template>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  createAlarmType,
  deleteAlarmType,
  listAlarmTypes,
  updateAlarmType,
  type AlarmType,
} from '@/api/alarm'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ProDialog from '@/components/ProDialog.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()
const loading = ref(false)
const rows = ref<AlarmType[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)

const query = reactive<{ keyword: string }>({ keyword: '' })

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '关键字', type: 'input', props: { clearable: true, placeholder: '类型名称/编码' } },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'name', label: '类型名称', minWidth: 140 },
  { prop: 'code', label: '类型编码', width: 140 },
  { prop: 'description', label: '说明', minWidth: 180 },
  { prop: 'status', label: '状态', width: 90, align: 'center' },
  { prop: 'operation', label: '操作', width: 120, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'name', label: '类型名称' },
  { prop: 'code', label: '类型编码' },
  { prop: 'description', label: '说明' },
  { prop: 'status', label: '状态', formatter: (r: any) => (r.status === 1 ? '正常' : '禁用') },
]

const empty = () => ({
  id: null as number | null,
  name: '',
  code: '',
  description: '',
  status: 1,
})
const form = reactive(empty())

async function load() {
  loading.value = true
  try {
    const { data } = await listAlarmTypes({
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

function openEdit(row: AlarmType) {
  Object.assign(form, empty(), row)
  visible.value = true
}

async function onSave() {
  if (!form.name || !form.code) {
    ElMessage.warning('请填写必填项')
    return
  }
  const payload = {
    name: form.name,
    code: form.code,
    description: form.description,
    status: form.status,
  }
  if (form.id) await updateAlarmType(form.id, payload)
  else await createAlarmType(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

async function onDelete(row: AlarmType) {
  await deleteAlarmType(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(load)
</script>

<style lang="scss" scoped>
/* 布局形制与告警规则页（RulesPanel）一致：独立搜索卡 + 磨砂表格卡 + 徽章标题栏 */
.types-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 统一：搜索栏与表格卡片间距 12px（对齐维保计划） */
.types-panel > .art-table-card {
  margin-top: 0;
}

:deep(.pro-search-bar) {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none;
  border-radius: 14px;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}
.types-card {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%) !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none !important;
  border-radius: 14px !important;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08) !important;
}
/* el-card 内部 body 撑满，ProTable 撑满剩余高度、分页贴底 */
.types-card :deep(> .el-card__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.types-card :deep(.pro-table) {
  flex: 1 1 auto;
  min-height: 0;
}
/* 无数据时空态也撑满 */
.types-card :deep(.el-table__empty-block) {
  min-height: 320px;
}

/* 卡片标题栏：图标徽章 + 标题 + 科技线条（与维修工单页一致） */
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 14px;
  margin-bottom: 14px;
}
.head-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 16px;
  color: #2f7cf6;
  background: linear-gradient(135deg, #e3eefe, #eef4ff);
  border: 1px solid #d7e6fd;
}
.head-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2d3d;
  letter-spacing: 0.02em;
}
.head-deco {
  flex: 1 1 auto;
  height: 20px;
  background:
    linear-gradient(90deg, transparent 62%, rgba(47, 124, 246, 0.55) 82%, rgba(47, 124, 246, 0) 100%) right 8px / 100% 1px no-repeat,
    linear-gradient(90deg, transparent 70%, rgba(47, 124, 246, 0.35) 88%, rgba(47, 124, 246, 0) 100%) right 0 / 100% 1px no-repeat;
  opacity: 0.8;
  pointer-events: none;
}

/* 按钮内图标 */
.btn-icon {
  margin-right: 4px;
  font-size: 15px;
  vertical-align: -2px;
}
</style>

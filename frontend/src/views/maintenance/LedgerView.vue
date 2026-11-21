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
        <span class="head-badge"><ArtSvgIcon icon="ri:file-chart-line" /></span>
        <span class="head-title">维保台账汇总</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="维保台账汇总"
        @refresh="load"
      />
      <ProTable
        :data="rows"
        :loading="loading"
        :columns="tableColumns"
        row-key="id"
        :pagination="{ current: page, size: pageSize, total }"
        @page-change="onPage"
        @size-change="onSize"
      >
        <template #operate_type="{ row }">{{ typeLabel(row.operate_type) }}</template>
        <template #operate_time="{ row }">{{ formatDateTime(row.operate_time) }}</template>
        <template #source="{ row }">
          <el-tag :type="row.source === 'repair' ? 'warning' : 'success'" size="small" effect="light">
            {{ row.source === 'repair' ? '维修工单' : '维保' }}
          </el-tag>
        </template>
      </ProTable>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { listLedger, typeLabel, type LedgerItem } from '@/api/maintenance'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import { formatDateTime } from '@/utils/time'

const loading = ref(false)
const rows = ref<LedgerItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const query = reactive<Record<string, any>>({
  keyword: '',
  operate_type: undefined,
})

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '设备', type: 'input', props: { clearable: true, placeholder: '设备名称/编号' } },
  {
    key: 'operate_type',
    label: '操作类型',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '全部',
      options: [
        { label: '检修', value: 'overhaul' },
        { label: '润滑', value: 'lubrication' },
        { label: '维修', value: 'repair' },
      ],
    },
  },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'equipment_code', label: '设备编号', width: 120 },
  { prop: 'equipment_name', label: '设备名称', minWidth: 140, showOverflowTooltip: true },
  { prop: 'operate_type', label: '操作类型', width: 90, align: 'center' },
  { prop: 'source', label: '来源', width: 120, align: 'center' },
  { prop: 'operator_name', label: '操作人员', width: 110 },
  { prop: 'operate_time', label: '操作时间', width: 170 },
  { prop: 'content', label: '操作内容', minWidth: 180, showOverflowTooltip: true },
  { prop: 'remark', label: '备注', minWidth: 120, showOverflowTooltip: true },
])

const exportColumns = [
  { prop: 'equipment_code', label: '设备编号' },
  { prop: 'equipment_name', label: '设备名称' },
  { prop: 'operate_type', label: '操作类型', formatter: (r: LedgerItem) => typeLabel(r.operate_type) },
  { prop: 'operator_name', label: '操作人员' },
  { prop: 'operate_time', label: '操作时间', formatter: (r: LedgerItem) => formatDateTime(r.operate_time) },
  { prop: 'content', label: '操作内容' },
  { prop: 'remark', label: '备注' },
  { prop: 'source', label: '来源', formatter: (r: LedgerItem) => (r.source === 'repair' ? '维修工单' : '维保') },
]

async function load() {
  loading.value = true
  try {
    const { data } = await listLedger({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
      operate_type: query.operate_type,
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
  query.operate_type = undefined
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

onMounted(load)
</script>

<style lang="scss" scoped>
.page {
  gap: 12px;
}
/* 统一：搜索栏与表格卡片间距 12px（对齐维保计划） */
.page > .art-table-card {
  margin-top: 0;
}
</style>

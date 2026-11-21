<template>
  <div class="page">
    <ProSearchBar v-model="query" :items="searchItems" :span="8" :show-search="false" />
    <el-card shadow="never" class="art-table-card">
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:money-cny-circle-line" />
        </span>
        <span class="head-title">电价设置</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="电价设置"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('energy:price:create')" class="btn-gradient" type="primary" @click="openCreate">新增电价</el-button>
        </template>
      </ProTableHeader>
      <ProTable :data="filteredRows" :loading="loading" :columns="tableColumns" row-key="id">
        <template #peak_hours="{ row }">
          <span>{{ formatHoursForDisplay(row.peak_hours) }}</span>
        </template>
        <template #valley_hours="{ row }">
          <span>{{ formatHoursForDisplay(row.valley_hours) }}</span>
        </template>
        <template #normal_hours="{ row }">
          <span>{{ formatNormalHoursForRow(row) }}</span>
        </template>
        <template #status="{ row }">
          <span :class="['status-text', row.status === 1 ? 'on' : 'off']">
            {{ row.status === 1 ? '启用' : '停用' }}
          </span>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('energy:price:update')" type="edit" title="编辑" @click="openEdit(row)" />
            <DeleteConfirm
              v-if="hasPerm('energy:price:delete')"
              text="确认删除该电价？"
              @confirm="onDelete(row)"
            >
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑电价' : '新增电价'" width="600px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:edit-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="峰价(元/kWh)" prop="peak_price" required>
          <el-input-number v-model="form.peak_price" :min="0" :precision="4" :step="0.01" style="width: 100%" />
        </el-form-item>
        <el-form-item label="谷价(元/kWh)" prop="valley_price" required>
          <el-input-number v-model="form.valley_price" :min="0" :precision="4" :step="0.01" style="width: 100%" />
        </el-form-item>
        <el-form-item label="平价(元/kWh)" prop="normal_price" required>
          <el-input-number v-model="form.normal_price" :min="0" :precision="4" :step="0.01" style="width: 100%" />
        </el-form-item>

        <!-- 峰时段：多段时间选择器 -->
        <el-form-item label="峰时段" required>
          <div class="range-group">
            <div v-for="(r, i) in form.peak_ranges" :key="'p'+i" class="range-row">
              <el-time-picker
                v-model="r.start"
                value-format="HH:mm"
                format="HH:mm"
                placeholder="开始"
                class="time-start"
              />
              <span class="sep">~</span>
              <el-time-picker
                v-model="r.end"
                value-format="HH:mm"
                format="HH:mm"
                placeholder="结束"
                class="time-end"
              />
              <el-button
                v-if="form.peak_ranges.length > 1"
                type="danger"
                link
                class="btn-remove"
                @click="form.peak_ranges.splice(i, 1)"
              >
                <ArtSvgIcon icon="ri:close-line" />
              </el-button>
            </div>
            <el-button
              v-if="form.peak_ranges.length < 6"
              type="primary"
              link
              class="btn-add"
              @click="form.peak_ranges.push({ start: '08:00', end: '11:00' })"
            >
              + 添加时段
            </el-button>
          </div>
          <div v-if="peakValleyConflict" class="range-conflict">
            <ArtSvgIcon icon="ri:alert-warning-line" />
            峰时段与谷时段有重叠，请调整
          </div>
        </el-form-item>

        <!-- 谷时段：多段时间选择器 -->
        <el-form-item label="谷时段" required>
          <div class="range-group">
            <div v-for="(r, i) in form.valley_ranges" :key="'v'+i" class="range-row">
              <el-time-picker
                v-model="r.start"
                value-format="HH:mm"
                format="HH:mm"
                placeholder="开始"
                class="time-start"
              />
              <span class="sep">~</span>
              <el-time-picker
                v-model="r.end"
                value-format="HH:mm"
                format="HH:mm"
                placeholder="结束"
                class="time-end"
              />
              <el-button
                v-if="form.valley_ranges.length > 1"
                type="danger"
                link
                class="btn-remove"
                @click="form.valley_ranges.splice(i, 1)"
              >
                <ArtSvgIcon icon="ri:close-line" />
              </el-button>
            </div>
            <el-button
              v-if="form.valley_ranges.length < 6"
              type="primary"
              link
              class="btn-add"
              @click="form.valley_ranges.push({ start: '23:00', end: '07:00' })"
            >
              + 添加时段（如跨零点，结束时间小于开始时间即可）
            </el-button>
          </div>
        </el-form-item>

        <!-- 24 小时预览横条 -->
        <el-form-item label="时段预览" class="preview-form-item">
          <div class="day-preview">
            <div class="preview-bar">
              <div
                v-for="h in 24"
                :key="h"
                :class="['hour-cell', periodClass(h)]"
                :title="periodLabel(h)"
              >
                {{ h }}
              </div>
            </div>
            <div class="preview-legend">
              <span class="legend-item"><i class="dot peak" /> 峰</span>
              <span class="legend-item"><i class="dot valley" /> 谷</span>
              <span class="legend-item"><i class="dot normal" /> 平（自动）</span>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="生效起" prop="effective_from" required>
          <el-date-picker v-model="form.effective_from" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="生效止" prop="effective_to">
          <el-date-picker v-model="form.effective_to" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="peakValleyConflict" @click="onSave">保存</el-button>
      </template>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { createPrice, deletePrice, listPrices, updatePrice, type ElecPrice } from '@/api/energy'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ProDialog from '@/components/ProDialog.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import { usePermissions } from '@/utils/permissions'

/* ---------- 类型 ---------- */
interface TimeRange {
  start: string // "HH:mm"
  end: string   // "HH:mm"
}

interface PriceForm {
  id: number | null
  name: string
  peak_price: number
  valley_price: number
  normal_price: number
  peak_hours: string
  valley_hours: string
  peak_ranges: TimeRange[]   // 前端用
  valley_ranges: TimeRange[] // 前端用
  effective_from: string
  effective_to: string
  status: number
}

/* ---------- 时段工具函数 ---------- */

/** "HH:mm" → 小时数 0-23，24:00 归并为 0（次日零点） */
function toHour(hm: string): number {
  if (!hm) return 0
  const n = parseInt(String(hm).split(':')[0], 10)
  if (isNaN(n)) return 0
  // 24:00 视为次日 0 点；超过也兜底
  return n >= 24 ? 0 : (n < 0 ? 0 : n)
}

/** 单个时间段覆盖的小时集合（支持跨零点，[start, end) 左闭右开——end 小时不归此段） */
function rangeToHoursSet(r: TimeRange): Set<number> {
  const sh = toHour(r.start)
  const eh = toHour(r.end)
  const out = new Set<number>()
  // 先到达 eh 就停止（eh 本身不归属此段），保证无缝衔接不被误判重叠
  let h = sh
  while (true) {
    if (h === eh) break
    out.add(h)
    h = (h + 1) % 24
  }
  return out
}

/** 多段合并成小时集合 */
function rangesToHoursSet(ranges: TimeRange[]): Set<number> {
  const all = new Set<number>()
  for (const r of ranges) rangeToHoursSet(r).forEach((h) => all.add(h))
  return all
}

/** 小时集合 → 后端区间格式字符串，如 "08:00-11:00,18:00-21:00" */
function hoursToRangesString(hours: Set<number>): string {
  if (!hours.size) return ''
  const sorted = [...hours].sort((a, b) => a - b)
  const result: string[] = []
  let segStart = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const cur = i < sorted.length ? sorted[i] : -1
    if (cur === prev + 1) {
      prev = cur
    } else {
      result.push(`${pad2(segStart)}:00-${pad2(prev + 1)}:00`)
      if (i < sorted.length) {
        segStart = cur
        prev = cur
      }
    }
  }
  return result.join(',')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 后端格式字符串 → 小时集合（同时支持 "8,9,10" 数字格式和 "08:00-11:00" 区间格式） */
function parseHoursString(raw: string | null | undefined): Set<number> {
  const out = new Set<number>()
  if (typeof raw !== 'string' || !raw.trim()) return out
  for (const part of raw.split(',')) {
    const p = part?.trim()
    if (!p) continue
    if (p.includes('-')) {
      const [ss, es] = p.split('-')
      if (ss == null || es == null) continue
      const sh = toHour(ss.trim())
      const eh = toHour(es.trim())
      if (sh === eh) continue
      let h = sh
      while (true) {
        out.add(h)
        if (h === eh) break
        h = (h + 1) % 24
      }
    } else {
      const n = parseInt(p, 10)
      if (!isNaN(n) && n >= 0 && n < 24) out.add(n)
    }
  }
  return out
}

/** 小时集合 → 时间段列表（用于 openEdit 反序列化） */
function hoursSetToRanges(hours: Set<number>): TimeRange[] {
  if (!hours.size) return []
  const sorted = [...hours].sort((a, b) => a - b)
  const ranges: TimeRange[] = []
  let segStart = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const cur = i < sorted.length ? sorted[i] : -1
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push({
        start: `${pad2(segStart)}:00`,
        end: `${pad2(prev + 1)}:00`,
      })
      if (i < sorted.length) {
        segStart = cur
        prev = cur
      }
    }
  }
  return ranges
}

/** 小时集合 → 给列表展示的友好文本，如 "08:00-11:00, 18:00-21:00 (共 6h)" */
function formatHoursForDisplay(raw: string | null | undefined): string {
  if (!raw) return '—'
  const hours = parseHoursString(raw)
  if (!hours.size) return '—'
  const ranges = hoursSetToRanges(hours)
  const parts = ranges.map((r) => `${r.start}~${r.end}`)
  return `${parts.join(', ')}（共 ${hours.size}h）`
}

/** 平时段：24h − 峰小时 − 谷小时，自动展示（与弹窗预览逻辑一致） */
function formatNormalHoursForRow(row: ElecPrice): string {
  const peak = parseHoursString(row.peak_hours || '')
  const valley = parseHoursString(row.valley_hours || '')
  const flat = new Set<number>()
  for (let h = 0; h < 24; h++) flat.add(h)
  for (const h of peak) flat.delete(h)
  for (const h of valley) flat.delete(h)
  if (!flat.size) return '—'
  const ranges = hoursSetToRanges(flat)
  const parts = ranges.map((r) => `${r.start}~${r.end}`)
  return `${parts.join(', ')}（共 ${flat.size}h）`
}

/* ---------- 页面状态 ---------- */

const { hasPerm } = usePermissions()

const loading = ref(false)
const rows = ref<ElecPrice[]>([])
const visible = ref(false)

const query = ref<Record<string, any>>({ keyword: '', status: undefined })
const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '名称', type: 'input', props: { clearable: true, placeholder: '电价名称' } },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '状态',
      options: [
        { label: '启用', value: 1 },
        { label: '停用', value: 0 },
      ],
    },
  },
]
const filteredRows = computed(() =>
  rows.value.filter((r) => {
    if (query.value.keyword && !String(r.name || '').includes(query.value.keyword)) return false
    if (query.value.status !== undefined && query.value.status !== null && r.status !== query.value.status)
      return false
    return true
  }),
)

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'name', label: '名称', width: 140 },
  { prop: 'peak_price', label: '峰价(元)', width: 100 },
  { prop: 'valley_price', label: '谷价(元)', width: 100 },
  { prop: 'normal_price', label: '平价(元)', width: 100 },
  { prop: 'peak_hours', label: '峰时段', minWidth: 160, showOverflowTooltip: true },
  { prop: 'valley_hours', label: '谷时段', minWidth: 160, showOverflowTooltip: true },
  { prop: 'normal_hours', label: '平时段', minWidth: 160, showOverflowTooltip: true },
  { prop: 'effective_from', label: '生效起', width: 120 },
  { prop: 'effective_to', label: '生效止', width: 120 },
  { prop: 'status', label: '状态', width: 100, align: 'center' },
  { prop: 'operation', label: '操作', width: 120, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'name', label: '名称' },
  { prop: 'peak_price', label: '峰价(元)' },
  { prop: 'valley_price', label: '谷价(元)' },
  { prop: 'normal_price', label: '平价(元)' },
  { prop: 'peak_hours', label: '峰时段' },
  { prop: 'valley_hours', label: '谷时段' },
  { prop: 'effective_from', label: '生效起' },
  { prop: 'effective_to', label: '生效止' },
  { prop: 'status', label: '状态', formatter: (r: any) => (r.status === 1 ? '启用' : '停用') },
]

/* 默认时段：峰段 8-11 + 18-21，谷段 23-07 */
const DEFAULT_PEAK_RANGES: TimeRange[] = [
  { start: '08:00', end: '11:00' },
  { start: '18:00', end: '21:00' },
]
const DEFAULT_VALLEY_RANGES: TimeRange[] = [{ start: '23:00', end: '07:00' }]

const form = reactive<PriceForm>({
  id: null,
  name: '默认电价',
  peak_price: 1.2,
  valley_price: 0.35,
  normal_price: 0.7,
  peak_hours: '',
  valley_hours: '',
  peak_ranges: JSON.parse(JSON.stringify(DEFAULT_PEAK_RANGES)),
  valley_ranges: JSON.parse(JSON.stringify(DEFAULT_VALLEY_RANGES)),
  effective_from: '',
  effective_to: '',
  status: 1,
})

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
  peak_price: [{ required: true, message: '请填写峰价', trigger: 'blur' }],
  valley_price: [{ required: true, message: '请填写谷价', trigger: 'blur' }],
  normal_price: [{ required: true, message: '请填写平价', trigger: 'blur' }],
  effective_from: [{ required: true, message: '请选择生效起日期', trigger: 'change' }],
}

/* ---------- 预览 & 冲突检测 ---------- */

const peakHours = computed(() => rangesToHoursSet(form.peak_ranges))
const valleyHours = computed(() => rangesToHoursSet(form.valley_ranges))

/** 峰谷重叠检测 */
const peakValleyConflict = computed(() => {
  for (const h of peakHours.value) if (valleyHours.value.has(h)) return true
  return false
})

function periodClass(h: number): string {
  if (peakHours.value.has(h)) return 'peak'
  if (valleyHours.value.has(h)) return 'valley'
  return 'normal'
}

function periodLabel(h: number): string {
  if (peakHours.value.has(h)) return `${h}:00 ~ ${h + 1}:00（峰）`
  if (valleyHours.value.has(h)) return `${h}:00 ~ ${h + 1}:00（谷）`
  return `${h}:00 ~ ${h + 1}:00（平 · 自动）`
}

/* ---------- CRUD ---------- */

async function load() {
  loading.value = true
  try {
    const { data } = await listPrices({ page: 1, page_size: 50 })
    rows.value = data.data.items
  } finally {
    loading.value = false
  }
}

function _resetForm() {
  Object.assign(form, {
    id: null,
    name: '默认电价',
    peak_price: 1.2,
    valley_price: 0.35,
    normal_price: 0.7,
    peak_hours: '',
    valley_hours: '',
    peak_ranges: JSON.parse(JSON.stringify(DEFAULT_PEAK_RANGES)),
    valley_ranges: JSON.parse(JSON.stringify(DEFAULT_VALLEY_RANGES)),
    effective_from: '',
    effective_to: '',
    status: 1,
  })
}

function openCreate() {
  _resetForm()
  visible.value = true
}

function openEdit(row: ElecPrice) {
  const peak = parseHoursString(row.peak_hours || '')
  const valley = parseHoursString(row.valley_hours || '')
  Object.assign(form, {
    id: row.id,
    name: row.name,
    peak_price: row.peak_price,
    valley_price: row.valley_price,
    normal_price: row.normal_price,
    peak_hours: row.peak_hours,
    valley_hours: row.valley_hours,
    peak_ranges: peak.size ? hoursSetToRanges(peak) : JSON.parse(JSON.stringify(DEFAULT_PEAK_RANGES)),
    valley_ranges: valley.size ? hoursSetToRanges(valley) : JSON.parse(JSON.stringify(DEFAULT_VALLEY_RANGES)),
    effective_from: row.effective_from,
    effective_to: row.effective_to || '',
    status: row.status,
  })
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (peakValleyConflict.value) {
    ElMessage.error('峰时段与谷时段存在重叠，请调整')
    return
  }
  if (form.peak_ranges.length === 0 || form.valley_ranges.length === 0) {
    ElMessage.error('峰时段和谷时段至少各保留一段')
    return
  }
  form.peak_hours = hoursToRangesString(peakHours.value)
  form.valley_hours = hoursToRangesString(valleyHours.value)
  const payload: any = {
    name: form.name,
    peak_price: form.peak_price,
    valley_price: form.valley_price,
    normal_price: form.normal_price,
    peak_hours: form.peak_hours,
    valley_hours: form.valley_hours,
    effective_from: form.effective_from,
    effective_to: form.effective_to || null,
    status: form.status,
  }
  if (form.id) await updatePrice(form.id, payload)
  else await createPrice(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

async function onDelete(row: ElecPrice) {
  await deletePrice(row.id)
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
.page > .art-table-card {
  margin-top: 0;
}

/* --- 状态文字（去掉 el-tag 小点，改纯文字色块） --- */
.status-text {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  letter-spacing: 1px;

  &.on {
    color: #2a8840;
    background: rgba(42, 136, 64, 0.08);
    border: 1px solid rgba(42, 136, 64, 0.25);
  }
  &.off {
    color: #909399;
    background: rgba(144, 147, 153, 0.08);
    border: 1px solid rgba(144, 147, 153, 0.25);
  }
}

/* --- 时间段选择器 --- */
.range-group {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.range-row .el-time-picker {
  width: 130px;
}
.range-row .sep {
  color: var(--el-text-color-secondary);
}
.btn-remove {
  padding: 4px;
}
.btn-add {
  justify-content: flex-start;
  margin-top: 2px;
}
.range-conflict {
  margin-top: 6px;
  color: var(--el-color-warning);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* --- 24h 预览 --- */
.preview-form-item :deep(.el-form-item__content) {
  width: 100%;
}
.day-preview {
  width: 100%;
}
.preview-bar {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  gap: 2px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 4px;
  background: var(--el-fill-color-lighter);
}
.hour-cell {
  height: 26px;
  border-radius: 3px;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  transition: background 0.15s;
  cursor: default;

  &.peak {
    background: #fff1d6;
    color: #c77500;
    border: 1px solid #ffc77a;
  }
  &.valley {
    background: #d8e8ff;
    color: #0a4ea8;
    border: 1px solid #89b5ff;
  }
  &.normal {
    background: #f2f3f5;
    color: #909399;
    border: 1px dashed #dcdfe6;
  }
}
.preview-legend {
  margin-top: 8px;
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  &.peak { background: #ffc77a; }
  &.valley { background: #89b5ff; }
  &.normal { background: #dcdfe6; border: 1px dashed #c0c4cc; }
}
</style>

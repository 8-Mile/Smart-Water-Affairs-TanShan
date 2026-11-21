<template>
  <div class="rules-panel">
    <ProSearchBar
      v-model="query"
      :items="searchItems"
      :span="6"
      @search="onSearch"
      @reset="onReset"
    />

    <el-card shadow="never" class="art-table-card rules-card">
      <div class="card-head">
        <span class="head-badge">
          <ArtSvgIcon icon="ri:file-settings-line" />
        </span>
        <span class="head-title">告警规则</span>
        <span class="head-deco" aria-hidden />
      </div>
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="告警规则"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('alarm:rule:create')" type="primary" @click="openCreate">新增规则</el-button>
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
        <template #alarm_level="{ row }">
          <el-tag :type="levelType(row.alarm_level)" size="small" effect="light">
            {{ levelLabel(row.alarm_level) }}
          </el-tag>
        </template>
        <template #alarm_type_code="{ row }">
          {{ typeName(row.alarm_type_code) }}
        </template>
        <template #condition="{ row }">
          {{ compareOpLabel(row.compare_op) }} {{ row.threshold }}
        </template>
        <template #enabled="{ row }">
          <el-tag :type="row.enabled === 1 ? 'success' : 'info'" size="small" effect="light">
            {{ row.enabled === 1 ? '是' : '否' }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <ArtButtonTable v-if="hasPerm('alarm:rule:update')" type="edit" title="编辑" @click="openEdit(row)" />
            <ArtButtonTable v-if="hasPerm('alarm:rule:create')" icon="ri:file-copy-line" icon-class="bg-warning/12 text-warning" title="复制" @click="onCopy(row)" />
            <DeleteConfirm v-if="hasPerm('alarm:rule:delete')" :text="`确认删除规则「${row.name}」？`" @confirm="onDelete(row)">
              <ArtButtonTable type="delete" title="删除" />
            </DeleteConfirm>
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" :title="form.id ? '编辑规则' : '新增规则'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="规则名称" prop="name" required>
          <el-input v-model="form.name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:edit-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="适用设备" prop="equipment_id" required>
          <EquipmentTreeSelect
            v-model="form.equipment_id"
            :options="equipments"
            @update:model-value="(v) => onEqChange(Number(v))"
          />
        </el-form-item>
        <el-form-item label="关联测点" prop="point_refs" required>
          <el-input
            v-model="form.point_refs"
            placeholder="设备变量ID，逗号分隔，如 700,701"
          >
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:gauge-line" /></span>
            </template>
          </el-input>
          <div class="hint" v-if="eqPointsHint">设备已绑定：{{ eqPointsHint }}</div>
        </el-form-item>
        <el-form-item label="告警类型" prop="alarm_type_code" required>
          <el-select v-model="form.alarm_type_code" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:price-tag-3-line" /></span>
            </template>
            <el-option
              v-for="t in types"
              :key="t.code"
              :label="t.name"
              :value="t.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="告警等级" prop="alarm_level" required>
          <el-radio-group v-model="form.alarm_level">
            <el-radio :value="1">一类紧急</el-radio>
            <el-radio :value="2">二类重要</el-radio>
            <el-radio :value="3">三类一般</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="触发逻辑">
          <el-select v-model="form.trigger_logic" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:functions" /></span>
            </template>
            <el-option label="任一满足" value="any" />
            <el-option label="全部满足" value="all" />
          </el-select>
        </el-form-item>
        <el-form-item label="比较符" prop="compare_op" required>
          <el-select v-model="form.compare_op" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:functions" /></span>
            </template>
            <el-option label=">" value="gt" />
            <el-option label=">=" value="gte" />
            <el-option label="<" value="lt" />
            <el-option label="<=" value="lte" />
            <el-option label="=" value="eq" />
            <el-option label="≠" value="neq" />
          </el-select>
        </el-form-item>
        <el-form-item label="阈值" prop="threshold" required>
          <el-input v-model="form.threshold" placeholder="如 90 或 true">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:speed-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="延时触发(秒)">
          <el-input-number v-model="form.delay_sec" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="去重窗口(秒)">
          <el-input-number v-model="form.debounce_sec" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
        </el-form-item>
        <el-form-item label="备注">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="form.remark" type="textarea" />
          </div>
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
import {
  alarmTypeOptions,
  copyAlarmRule,
  createAlarmRule,
  deleteAlarmRule,
  listAlarmRules,
  updateAlarmRule,
  type AlarmRule,
} from '@/api/alarm'
import { optionsResource } from '@/api/system'
import type { OptionItem } from '@/api/types'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import ProDialog from '@/components/ProDialog.vue'
import EquipmentTreeSelect from '@/components/EquipmentTreeSelect.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()
const loading = ref(false)
const rows = ref<AlarmRule[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const types = ref<{ name: string; code: string }[]>([])
const equipments = ref<OptionItem[]>([])
const eqPointsHint = ref('')

const query = reactive<{ keyword: string }>({ keyword: '' })

const searchItems: SearchFormItem[] = [
  { key: 'keyword', label: '关键字', type: 'input', props: { clearable: true, placeholder: '规则名称' } },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'name', label: '规则名称', minWidth: 140 },
  { prop: 'equipment_name', label: '设备', width: 120 },
  { prop: 'point_refs', label: '关联测点', width: 120 },
  { prop: 'alarm_type_code', label: '类型', width: 120 },
  { prop: 'alarm_level', label: '等级', width: 90, align: 'center' },
  { prop: 'condition', label: '条件', minWidth: 120 },
  { prop: 'enabled', label: '启用', width: 80, align: 'center' },
  { prop: 'operation', label: '操作', width: 160, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'name', label: '规则名称' },
  { prop: 'equipment_name', label: '设备' },
  { prop: 'point_refs', label: '关联测点' },
  { prop: 'alarm_type_code', label: '类型', formatter: (r: any) => typeName(r.alarm_type_code) },
  { prop: 'alarm_level', label: '等级', formatter: (r: any) => levelLabel(r.alarm_level) },
  {
    prop: 'condition',
    label: '条件',
    formatter: (r: any) => `${compareOpLabel(r.compare_op)} ${r.threshold}`,
  },
  { prop: 'enabled', label: '启用', formatter: (r: any) => (r.enabled === 1 ? '是' : '否') },
]

const empty = () => ({
  id: null as number | null,
  name: '',
  equipment_id: undefined as number | undefined,
  point_refs: '',
  alarm_type_code: 'TEMP_ALERT',
  alarm_level: 3,
  trigger_logic: 'any',
  compare_op: 'gt',
  threshold: '0',
  delay_sec: 0,
  debounce_sec: 60,
  suppress_push_sec: 300,
  enabled: 1,
  remark: '',
})
const form = reactive(empty())

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写规则名称', trigger: 'blur' }],
  equipment_id: [{ required: true, message: '请选择适用设备', trigger: 'change' }],
  point_refs: [{ required: true, message: '请填写关联测点', trigger: 'blur' }],
  alarm_type_code: [{ required: true, message: '请选择告警类型', trigger: 'change' }],
  alarm_level: [{ required: true, message: '请选择告警等级', trigger: 'change' }],
  compare_op: [{ required: true, message: '请选择比较符', trigger: 'change' }],
  threshold: [{ required: true, message: '请填写阈值', trigger: 'blur' }],
}

function levelLabel(lv: number) {
  return ({ 1: '一类', 2: '二类', 3: '三类' } as Record<number, string>)[lv] || String(lv)
}
function levelType(lv: number) {
  return ({ 1: 'danger', 2: 'warning', 3: 'info' } as Record<number, string>)[lv] || 'info'
}

/** 告警类型编码 → 中文名称（从类型选项映射，未匹配时回退原始编码） */
function typeName(code: string) {
  return types.value.find((t) => t.code === code)?.name || code
}

/** 比较符 → 可理解符号 */
function compareOpLabel(op: string) {
  return (
    ({ gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' } as Record<string, string>)[op] || op
  )
}

function onEqChange(id: number) {
  const eq = equipments.value.find((e) => e.id === id)
  eqPointsHint.value = eq?.scada_point_ids || ''
  if (eq?.scada_point_ids && !form.point_refs) {
    form.point_refs = eq.scada_point_ids
  }
}

async function load() {
  loading.value = true
  try {
    const { data } = await listAlarmRules({
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
  eqPointsHint.value = ''
  visible.value = true
}

function openEdit(row: AlarmRule) {
  Object.assign(form, empty(), row)
  onEqChange(row.equipment_id)
  visible.value = true
}

async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload = { ...form }
  delete (payload as { id?: number | null }).id
  if (form.id) await updateAlarmRule(form.id, payload)
  else await createAlarmRule(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}

async function onCopy(row: AlarmRule) {
  await copyAlarmRule(row.id)
  ElMessage.success('已复制（默认停用）')
  await load()
}

async function onDelete(row: AlarmRule) {
  await deleteAlarmRule(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  const [t, e] = await Promise.all([
    alarmTypeOptions(),
    optionsResource('/equipment/options'),
  ])
  types.value = t.data.data
  equipments.value = e.data.data
  await load()
})
</script>

<style lang="scss" scoped>
.rules-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 统一：搜索栏与表格卡片间距 12px（对齐维保计划） */
.rules-panel > .art-table-card {
  margin-top: 0;
}
.hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--art-gray-600);
}

/* 搜索条/表格卡：白色卡改磨砂（与维修工单页同框架） */
:deep(.pro-search-bar) {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none;
  border-radius: 14px;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}
.rules-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%) !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: none !important;
  border-radius: 14px !important;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08) !important;
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
</style>

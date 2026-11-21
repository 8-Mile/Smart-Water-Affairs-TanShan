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
      <ProTableHeader
        v-model:columns="tableColumns"
        :loading="loading"
        :export-columns="exportColumns"
        :export-data="rows"
        export-filename="巡检记录"
        @refresh="load"
      >
        <template #left>
          <el-button v-if="hasPerm('insp:record:submit')" class="btn-gradient" type="primary" @click="openCreate">
            <ArtSvgIcon icon="ri:add-line" style="margin-right: 4px" />计划补录
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
        <template #has_abnormal="{ row }">
          <el-tag :type="row.has_abnormal ? 'danger' : 'success'" size="small" effect="light">
            {{ row.has_abnormal ? '异常' : '正常' }}
          </el-tag>
        </template>
        <template #source="{ row }">
          <el-tag
            size="small"
            :type="row.task_id ? 'info' : 'warning'"
            effect="light"
          >
            {{ row.task_id ? '计划内' : '人工补录' }}
          </el-tag>
        </template>
        <template #operation="{ row }">
          <div class="action-cell">
            <!-- 已发起过工单：显示「关联工单」跳转定位；未发起：显示「发起工单」 -->
            <ArtButtonTable
              v-if="row.repair_order_no"
              icon="ri:link"
              icon-class="bg-success/12 text-success"
              title="关联工单"
              label="关联工单"
              @click="goRepairOrder(row)"
            />
            <ArtButtonTable
              v-else-if="row.has_abnormal && hasPerm('repair:create')"
              icon="ri:tools-line"
              icon-class="bg-warning/12 text-warning"
              title="发起工单"
              label="发起工单"
              @click="onCreateRepair(row)"
            />
            <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
            <ArtButtonTable type="view" title="详情" label="详情" @click="openDetail(row)" />
          </div>
        </template>
      </ProTable>
    </el-card>

    <ProDialog v-model="visible" title="计划外巡检补录" width="560px">
      <el-form ref="createFormRef" :model="form" :rules="createRules" label-width="90px">
        <el-form-item label="名称" prop="plan_name">
          <el-input v-model="form.plan_name">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:edit-line" /></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="项目结果" prop="raw" required>
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input
              v-model="form.raw"
              type="textarea"
              :rows="4"
              placeholder="每行：项目名,结果(normal/abnormal),备注&#10;例如：泵温,normal,&#10;液位,abnormal,偏高"
            />
          </div>
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
        <el-button type="primary" @click="onCreate">保存</el-button>
      </template>
    </ProDialog>

    <ProDialog v-model="repairVisible" title="巡检异常发起维修工单" width="520px">
      <!-- 曾被驳回：重新发起时给出醒目提示，避免操作员不知情重复提交 -->
      <el-alert
        v-if="repairForm.row?.rejected_order_no"
        type="warning"
        :closable="false"
        show-icon
        class="rejected-alert"
        :title="`此前工单 ${repairForm.row.rejected_order_no} 已被驳回`"
        :description="repairForm.row.rejected_comment ? `驳回理由：${repairForm.row.rejected_comment}` : undefined"
      />
      <el-form ref="repairFormRef" :model="repairForm" :rules="repairRules" label-width="90px">
        <el-form-item label="关联设备" prop="equipment_id" required>
          <EquipmentTreeSelect
            v-model="repairForm.equipment_id"
            :options="repairEquipOptions"
            placeholder="选择异常设备"
          />
        </el-form-item>
        <el-form-item label="故障描述" prop="description" required>
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="repairForm.description" type="textarea" :rows="4" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="repairVisible = false">取消</el-button>
        <el-button type="primary" @click="onSubmitRepair">提交工单</el-button>
      </template>
    </ProDialog>

    <!-- 巡检记录详情（只读，统一 ProDetailDrawer 形制） -->
    <ProDetailDrawer
      v-model="detailVisible"
      title="巡检记录详情"
      subtitle="查看巡检结果与异常明细"
      icon="ri:file-list-3-line"
      :border-tone="recordTone"
    >
      <template v-if="detailData">
        <ProDetailSection flush>
          <ProDetailRow icon="ri:calendar-line" label="记录日期" :value="detailData.record_date" mono />
          <ProDetailRow icon="ri:route-line" label="计划名称" :value="detailData.plan_name || '—'" />
          <ProDetailRow icon="ri:team-line" label="所属班组" :value="detailData.team_name || '—'" />
          <ProDetailRow icon="ri:user-shared-line" label="执行人" :value="detailData.executor_name || '—'" />
          <ProDetailRow icon="ri:folder-shared-line" label="来源">
            <span class="dd-pill" :class="detailData.task_id ? 'is-blue' : 'is-orange'">
              {{ detailData.task_id ? '计划内' : '人工补录' }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:pulse-line" label="异常情况">
            <span class="dd-pill" :class="detailData.has_abnormal ? 'is-red' : 'is-green'">
              {{ detailData.has_abnormal ? '存在异常' : '全部正常' }}
            </span>
          </ProDetailRow>
          <ProDetailRow v-if="detailData.remark" icon="ri:sticky-note-line" label="备注" top :value="detailData.remark" />
        </ProDetailSection>

        <!-- 检查结果：按设备分组 -->
        <ProDetailSection icon="ri:clipboard-line" title="检查项及结果" :count="`${resultCount} 项`">
          <div v-if="groupedResults.length" class="dd-groups">
            <div v-for="(group, gi) in groupedResults" :key="gi" class="dd-group">
              <div class="dd-group-head">
                <ArtSvgIcon icon="ri:server-line" class="dd-group-ico" />
                <span class="dd-group-name">{{ group.equipment_name }}</span>
                <span class="dd-group-count">{{ group.rows.length }} 项</span>
              </div>
              <ul class="dd-timeline">
                <li v-for="(r, i) in group.rows" :key="i" class="dd-tl">
                  <span class="dd-tl-rail" aria-hidden>
                    <i class="dd-tl-dot" :class="r.result === 'abnormal' ? 'dot-red' : 'dot-green'" />
                  </span>
                  <div class="dd-tl-body">
                    <p class="dd-tl-action">{{ r.check_item }}</p>
                    <p v-if="r.remark" class="dd-tl-detail">{{ r.remark }}</p>
                    <!-- 归档的 SCADA 快照：执行人提交时刻的实时值留痕 -->
                    <div v-if="(r as any).scada_snapshot?.length" class="rec-scada">
                      <span
                        v-for="p in (r as any).scada_snapshot"
                        :key="p.point_id ?? p.point_name"
                        class="rec-scada-chip"
                        :class="{ offline: p.offline || p.value === null }"
                      >
                        <span class="rec-scada-name">{{ p.point_name }}</span>
                        <span class="rec-scada-val">
                          {{ p.value === null || p.value === undefined ? '—' : (typeof p.value === 'number' ? p.value.toFixed(p.value % 1 === 0 ? 0 : 2) : String(p.value)) }}
                          <span v-if="p.unit" class="rec-scada-unit">{{ p.unit }}</span>
                        </span>
                      </span>
                    </div>
                    <span class="dd-pill dd-tl-pill" :class="r.result === 'abnormal' ? 'is-red' : 'is-green'">
                      {{ r.result === 'abnormal' ? '异常' : '正常' }}
                    </span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
          <!-- 旧数据兜底：无 results 明细时展示摘要文本 -->
          <div v-else-if="detailData.items_summary" class="dd-legacy-summary">
            {{ detailData.items_summary }}
          </div>
          <el-empty v-else :image-size="80" description="暂无检查结果" />
        </ProDetailSection>
      </template>
    </ProDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  createInspRecord,
  groupByEquipment,
  listInspRecords,
  type InspectionRecord,
} from '@/api/inspection'
import { createRepair } from '@/api/repair'
import { optionsResource } from '@/api/system'
import type { OptionItem } from '@/api/types'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import ProDialog from '@/components/ProDialog.vue'
import EquipmentTreeSelect from '@/components/EquipmentTreeSelect.vue'
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'
import { usePermissions } from '@/utils/permissions'

const { hasPerm } = usePermissions()
const router = useRouter()

const loading = ref(false)
const rows = ref<InspectionRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const visible = ref(false)
const query = reactive<{ keyword: string; has_abnormal: number | undefined }>({
  keyword: '',
  has_abnormal: undefined,
})

const searchItems: SearchFormItem[] = [
  { key: 'keyword', type: 'input', props: { clearable: true, placeholder: '计划/执行人' } },
  {
    key: 'has_abnormal',
    label: '是否异常',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '是否异常',
      options: [
        { label: '正常', value: 0 },
        { label: '异常', value: 1 },
      ],
    },
  },
]

const tableColumns = ref<ProColumn[]>([
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left' },
  { prop: 'record_date', label: '日期', width: 110, align: 'center' },
  { prop: 'plan_name', label: '计划', minWidth: 140, showOverflowTooltip: true },
  { prop: 'team_name', label: '班组', width: 120 },
  { prop: 'items_summary', label: '结果摘要', minWidth: 200, showOverflowTooltip: true },
  { prop: 'has_abnormal', label: '是否异常', width: 90, align: 'center' },
  { prop: 'executor_name', label: '执行人', width: 100 },
  { prop: 'source', label: '来源', width: 110, align: 'center' },
  { prop: 'remark', label: '备注', minWidth: 120, showOverflowTooltip: true },
  // 操作列宽按最多 2 个图标按钮（发起/关联工单互斥 + 详情）紧凑适配，详情固定排最右
  { prop: 'operation', label: '操作', width: 110, fixed: 'right', align: 'right' },
])

const exportColumns = [
  { prop: 'record_date', label: '日期' },
  { prop: 'plan_name', label: '计划' },
  { prop: 'team_name', label: '班组' },
  { prop: 'items_summary', label: '结果摘要' },
  { prop: 'has_abnormal', label: '是否异常', formatter: (r: any) => (r.has_abnormal ? '异常' : '正常') },
  { prop: 'executor_name', label: '执行人' },
  { prop: 'source', label: '来源', formatter: (r: any) => (r.task_id ? '计划内' : '人工补录') },
  { prop: 'remark', label: '备注' },
]

const form = reactive({
  plan_name: '计划外巡检',
  raw: '',
  remark: '',
})

const createFormRef = ref<FormInstance>()
const createRules: FormRules = {
  plan_name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
  raw: [{ required: true, message: '请填写项目结果', trigger: 'blur' }],
}

/* 记录详情抽屉 */
const detailVisible = ref(false)
const detailData = ref<InspectionRecord | null>(null)
// 详情抽屉呼吸边框色：按是否异常——存在异常红 / 全部正常绿
const recordTone = computed(() => {
  const d = detailData.value
  if (!d) return undefined
  return d.has_abnormal ? 'red' : 'green'
})
const groupedResults = computed(() => groupByEquipment(detailData.value?.results))
const resultCount = computed(() => detailData.value?.results?.length || 0)

function openDetail(row: InspectionRecord) {
  detailData.value = row
  detailVisible.value = true
}

async function load() {
  loading.value = true
  try {
    const { data } = await listInspRecords({
      page: page.value,
      page_size: pageSize.value,
      keyword: query.keyword || undefined,
      has_abnormal: query.has_abnormal,
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
  query.has_abnormal = undefined
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

/** 供父级 Tab 切换时调用：清空筛选并按默认条件刷新 */
function resetFilters() {
  query.keyword = ''
  query.has_abnormal = undefined
  page.value = 1
  load()
}
defineExpose({ resetFilters })

function openCreate() {
  form.plan_name = '计划外巡检'
  form.raw = '泵温,normal,\n液位,normal,'
  form.remark = ''
  visible.value = true
}

async function onCreate() {
  const valid = await createFormRef.value?.validate().catch(() => false)
  if (!valid) return
  const results = form.raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [check_item, result, remark] = line.split(',').map((s) => s.trim())
      return { check_item, result: result || 'normal', remark: remark || '' }
    })
    .filter((r) => r.check_item)
  if (!results.length) {
    ElMessage.warning('请填写至少一项结果')
    return
  }
  await createInspRecord({
    plan_name: form.plan_name,
    results,
    remark: form.remark || undefined,
  })
  ElMessage.success('已补录')
  visible.value = false
  await load()
}

/* 巡检异常发起维修工单：设备下拉限定为该记录对应巡检计划所选设备 */
const repairVisible = ref(false)
const equipments = ref<OptionItem[]>([])
const repairEquipOptions = ref<OptionItem[]>([])
const repairForm = reactive({
  row: null as InspectionRecord | null,
  equipment_id: undefined as number | undefined,
  description: '',
})
const repairFormRef = ref<FormInstance>()
const repairRules: FormRules = {
  equipment_id: [{ required: true, message: '请选择关联设备', trigger: 'change' }],
  description: [{ required: true, message: '请填写故障描述', trigger: 'blur' }],
}

function onCreateRepair(row: InspectionRecord) {
  repairForm.row = row
  repairForm.equipment_id = undefined
  // 范围 = 该记录对应巡检计划的所选设备；计划未配置设备时回落全量（兼容历史数据）
  const ids = row.equipment_ids ?? []
  repairEquipOptions.value = ids.length ? equipments.value.filter((e) => ids.includes(e.id)) : equipments.value
  repairForm.description =
    `巡检记录（${row.record_date} · ${row.plan_name}）发现异常，结果摘要：${row.items_summary || ''}；备注：${row.remark || '无'}`
  repairVisible.value = true
}

async function onSubmitRepair() {
  const valid = await repairFormRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    const { data } = await createRepair({
      equipment_id: repairForm.equipment_id!,
      description: repairForm.description,
      repair_type: 'overhaul',
      // 巡检来源：后端据此标记 source=inspection 并建立记录↔工单关联
      source: 'inspection',
      inspection_record_id: repairForm.row!.id,
    })
    // 本地同步关联状态：按钮立即从「发起工单」切换为「关联工单」
    if (repairForm.row) repairForm.row.repair_order_no = data.data?.order_no || null
    ElMessage.success('已发起维修工单')
    repairVisible.value = false
  } catch {
    // 错误已由拦截器提示
  }
}

// 跳转维修工单列表并定位高亮关联工单（与告警页同款交互）
function goRepairOrder(row: InspectionRecord) {
  if (!row.repair_order_no) return
  router.push({ path: '/repair/list', query: { focus: row.repair_order_no } })
}

onMounted(async () => {
  await load()
  const { data } = await optionsResource('/equipment/options')
  equipments.value = data.data
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 驳回警示与表单间距 */
.rejected-alert {
  margin-bottom: 14px;
}
/* 表格卡片与搜索栏间距对齐巡检任务页（全局 .art-table-card 的 margin-top:12px 在此改为由 gap 提供） */
.page > .art-table-card {
  margin-top: 0;
}
/* 旧记录无 results 明细时的摘要兜底 */
.dd-legacy-summary {
  margin-top: 12px;
  padding: 12px 14px;
  font-size: 13.5px;
  line-height: 1.7;
  color: #4a5a7e;
  background: #f6f9fe;
  border-left: 3px solid #2f7cf6;
  border-radius: 4px;
}
/* 巡检详情：归档的 SCADA 实时值快照（完成时刻留痕） */
.rec-scada {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0;
}
.rec-scada-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 1px 8px;
  font-size: 11px;
  background: #f3f7fc;
  border: 1px solid #dbe8f8;
  border-radius: 3px;
  line-height: 1.5;
}
.rec-scada-chip.offline {
  background: #fef0f0;
  border-color: #fde2e2;
}
.rec-scada-name {
  color: #606266;
}
.rec-scada-chip.offline .rec-scada-name {
  color: #f03d45;
}
.rec-scada-val {
  font-weight: 600;
  color: #12234d;
}
.rec-scada-chip.offline .rec-scada-val {
  color: #f03d45;
}
.rec-scada-unit {
  font-weight: 400;
  color: #909399;
  font-size: 10px;
}
</style>

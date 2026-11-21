<template>
  <div class="page mod-repair" :class="{ 'is-ready': pageReady }">
    <!-- 跨页跳转定位提示：命中行高亮，可手动关闭 -->
    <el-alert
      v-if="banner"
      class="focus-banner"
      type="info"
      :title="`已从工作台定位到工单 ${focus}`"
      closable
      @close="dismiss"
    />
    <!-- KPI 状态卡：磨砂面板包裹（还原设计稿），点击卡片快捷筛选对应状态 -->
    <div class="kpi-panel">
      <div class="kpi-row">
        <KpiCard
          v-for="(c, idx) in kpis"
          :key="c.label"
          class="dash-card"
          :style="{ '--i': idx }"
          variant="poster"
          :color="c.color"
          :icon="c.icon"
          :bg-image="c.bg"
          bg-cover
          :side-image="c.side"
          :label="c.label"
          :value="c.value"
          :active="(query.status || '') === c.key"
          :breathing="(query.status || '') === c.key"
          clickable
          @click="onKpiClick(c.key)"
        />
      </div>
    </div>

    <!-- 查询区：独立 ProSearchBar（与告警中心同布局：查询与表格分区） -->
    <ProSearchBar v-model="query" :items="searchItems" :span="6" @search="onSearch" @reset="onReset" />

    <div class="table-section">
      <el-card shadow="never" class="art-table-card table-card">
        <!-- 表头工具条：左侧新增人工报修，右侧下载/刷新（与全站表格页统一 ProTableHeader） -->
        <ProTableHeader
          :loading="loading"
          :export-columns="exportColumns"
          :export-data="rows"
          export-filename="维修工单"
          @refresh="load"
        >
          <template #left>
            <el-button v-if="hasPerm('repair:create')" class="btn-create" type="primary" @click="openCreate">
              <ArtSvgIcon icon="ri:add-line" class="btn-create-icon" />人工报修
            </el-button>
          </template>
        </ProTableHeader>

        <!-- 表格磨砂容器皮肤由 ProTable 组件全局自带，无需页面嵌套 -->
        <RepairTable
            :rows="rows"
            :loading="loading"
            :row-class-name="rowClassName"
            :active-row-id="detailVisible ? detailId : null"
            @detail="onDetail"
          >
            <template #empty>
              <!-- 有激活筛选时给清空引导，无筛选保持"暂无数据" -->
              <div v-if="hasFilter">
                没有符合条件的工单
                <el-button link type="primary" @click="onClearFilters">清除筛选条件</el-button>
              </div>
              <template v-else><el-empty :image-size="110" description="暂无数据" /></template>
            </template>
            <template #actions="{ row }">
              <ArtButtonTable v-if="canDispatch(row)" icon="ri:send-plane-line" icon-class="bg-success/12 text-success" title="派单" label="派单" @click="openDispatch(row)" />
              <ArtButtonTable v-if="canReject(row)" icon="ri:close-circle-line" icon-class="bg-error/12 text-error" title="驳回" label="驳回" @click="onReject(row)" />
              <ArtButtonTable v-if="canComplete(row)" type="edit" title="处理" label="处理" @click="openComplete(row)" />
              <ArtButtonTable v-if="canAccept(row)" icon="ri:checkbox-circle-line" icon-class="bg-warning/12 text-warning" title="验收" label="验收" @click="openAccept(row)" />
            </template>
          </RepairTable>

          <!-- 分页：左侧总数+每页条数，右侧页码（还原设计稿） -->
          <div class="pager">
            <div class="pager-left" style="margin-top:10px">
              <span class="pager-total">共 {{ total }} 条数据</span>
              <span class="pager-size">
                每页
                <el-select v-model="pageSize" style="width: 64px" @change="onSizeChange">
                  <el-option v-for="s in [10, 20, 50]" :key="s" :label="s" :value="s" />
                </el-select>
                条
              </span>
            </div>
            <el-pagination
              background
              layout="prev, pager, next"
              :total="total"
              v-model:current-page="query.page"
              :page-size="pageSize"
              :pager-count="7"
              @current-change="load"
            />
          </div>
      </el-card>
    </div>

    <ProDialog v-model="createVisible" title="人工报修" width="560px">
      <el-form ref="createFormRef" :model="form" :rules="createRules" label-width="100px">
        <el-form-item label="设备" prop="equipment_id" required>
          <EquipmentTreeSelect v-model="form.equipment_id" :options="equipments" />
        </el-form-item>
        <el-form-item label="维修类型" prop="repair_type" required>
          <el-select v-model="form.repair_type" style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:price-tag-3-line" /></span>
            </template>
            <el-option label="检修" value="overhaul" />
          </el-select>
        </el-form-item>
        <el-form-item label="故障分类">
          <el-select v-model="form.fault_category" clearable allow-create filterable style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:price-tag-3-line" /></span>
            </template>
            <el-option label="电气故障" value="电气故障" />
            <el-option label="机械故障" value="机械故障" />
            <el-option label="仪表故障" value="仪表故障" />
            <el-option label="通信故障" value="通信故障" />
          </el-select>
        </el-form-item>
        <el-form-item label="故障时间">
          <el-date-picker
            v-model="form.fault_time"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="情况描述" prop="description" required>
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="form.description" type="textarea" :rows="3" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="onCreate">提交</el-button>
      </template>
    </ProDialog>

    <ProDialog v-model="dispatchVisible" title="审批派单" width="480px">
      <el-form ref="dispatchFormRef" :model="dispatchForm" :rules="dispatchRules" label-width="90px">
        <el-form-item label="工单">{{ current?.order_no }}</el-form-item>
        <el-form-item label="维修人员" prop="worker_id" required>
          <el-select v-model="dispatchForm.worker_id" filterable style="width: 100%">
            <template #prefix>
              <span class="field-badge"><ArtSvgIcon icon="ri:user-line" /></span>
            </template>
            <el-option
              v-for="u in workerOptions"
              :key="u.id"
              :label="u.username"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input v-model="dispatchForm.comment" type="textarea" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" @click="onDispatch">确认派单</el-button>
      </template>
    </ProDialog>

    <!-- 驳回弹窗：与派单/处理同形制（ProDialog 标题带背景色装饰），替代原 ElMessageBox 白底样式 -->
    <ProDialog v-model="rejectVisible" title="审批驳回" width="480px">
      <el-form ref="rejectFormRef" :model="rejectForm" :rules="rejectRules" label-width="90px">
        <el-form-item label="工单">{{ current?.order_no }}</el-form-item>
        <el-form-item label="驳回原因" prop="comment" required>
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input
              v-model="rejectForm.comment"
              type="textarea"
              :rows="3"
              placeholder="必填，请输入驳回原因"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="primary" @click="onRejectSubmit">确定驳回</el-button>
      </template>
    </ProDialog>

    <!-- 处理弹窗：维修人填写处理结果并提交验收 -->
    <ProDialog v-model="completeVisible" title="处理反馈" width="480px">
      <el-form ref="completeFormRef" :model="completeForm" :rules="completeRules" label-width="90px">
        <el-form-item label="工单">{{ current?.order_no }}</el-form-item>
        <el-form-item label="处理结果" prop="feedback" required>
          <div class="field-textarea">
            <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
            <el-input
              v-model="completeForm.feedback"
              type="textarea"
              :rows="4"
              placeholder="请填写处理过程及结果，提交后进入待验收"
            />
          </div>
        </el-form-item>
        <el-form-item label="现场图片">
          <div class="complete-upload">
            <el-upload
              :show-file-list="false"
              accept="image/*"
              :http-request="uploadCompleteImage"
              :disabled="completeUploading"
            >
              <el-button :loading="completeUploading">
                <ArtSvgIcon icon="ri:image-add-line" />添加图片（非必填）
              </el-button>
            </el-upload>
            <div v-if="completeForm.images.length" class="complete-upload-list">
              <div v-for="(url, idx) in completeForm.images" :key="url" class="cul-item">
                <el-image :src="url" fit="cover" :preview-src-list="completeForm.images" preview-teleported />
                <el-icon class="cul-del" @click="removeCompleteImage(idx)"><CircleClose /></el-icon>
              </div>
            </div>
            <div v-else class="cul-empty">可上传现场照片，供验收参考</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="completeVisible = false">取消</el-button>
        <el-button type="primary" @click="onComplete">提交验收</el-button>
      </template>
    </ProDialog>

    <!-- 验收：审阅维修完成情况，必填验收意见后通过/驳回 -->
    <ProDialog v-model="acceptVisible" title="工单验收" width="580px" append-to-body>
      <template v-if="acceptRow">
        <!-- 顶部信息卡：工单名 + 编号/完工人员/设备两列网格 -->
        <div class="accept-info-card">
          <div class="aic-title">{{ acceptRow.name }}</div>
          <div class="aic-grid">
            <div class="aic-item">
              <span>工单编号</span><b>{{ acceptRow.order_no }}</b>
            </div>
            <div class="aic-item">
              <span>完工人员</span><b>{{ acceptRow.worker_username || acceptRow.worker_name || '—' }}</b>
            </div>
            <div class="aic-item">
              <span>设备名称</span><b>{{ acceptRow.equipment_name || '—' }}</b>
            </div>
          </div>
        </div>

        <!-- 维修完成情况：蓝条区块标题 + 描述/反馈/附件 -->
        <div class="accept-section-title">维修完成情况</div>
        <div class="accept-block">
          <div class="ab-label">报修描述</div>
          <div class="ab-content">{{ acceptRow.description || '—' }}</div>
        </div>
        <div class="accept-block">
          <div class="ab-label">完工反馈</div>
          <div class="ab-content">{{ acceptRow.process_feedback || '（维修人员未填写反馈）' }}</div>
        </div>
        <div class="accept-block">
          <div class="ab-label">现场图片</div>
          <div v-if="acceptImages.length" class="accept-images">
            <el-image
              v-for="url in acceptImages"
              :key="url"
              :src="url"
              fit="cover"
              :preview-src-list="acceptImages"
              preview-teleported
            />
          </div>
          <div v-else class="ab-content ab-empty">维修人员未上传现场图片</div>
        </div>
        <!-- 验收意见：必填 + 右侧灰色提示，通过/驳回均需填写 -->
        <el-form ref="acceptFormRef" :model="acceptForm" :rules="acceptRules" class="accept-form" label-width="0">
          <el-form-item prop="comment">
            <div class="accept-comment">
              <div class="ac-head">
                <span class="ac-label"><i class="req">*</i>验收意见</span>
                <span class="ac-hint">通过、驳回均需填写</span>
              </div>
              <el-input
                v-model="acceptForm.comment"
                type="textarea"
                :rows="5"
                maxlength="500"
                show-word-limit
                placeholder="请填写验收结论、试运行情况或需整改的问题"
              />
            </div>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button
          type="danger"
          @click="confirmAccept(false)"
        >
          验收驳回
        </el-button>
        <el-button
          type="success"
          @click="confirmAccept(true)"
        >
          验收通过
        </el-button>
      </template>
    </ProDialog>

    <RepairDetailDrawer v-model="detailVisible" :repair-id="detailId" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ProTableHeader from '@/components/ProTableHeader.vue'
import type { ExportColumn } from '@/utils/exportExcel'
import { formatDateTime } from '@/utils/time'
import {
  acceptRepair,
  completeRepair,
  createRepair,
  dispatchRepair,
  fetchRepairStats,
  getRepair,
  listRepairs,
  rejectRepair,
  sourceLabel,
  type RepairOrder,
  type RepairStats,
} from '@/api/repair'
import type { OptionItem, PageResult } from '@/api/types'
import http from '@/api/http'
import { optionsResource } from '@/api/system'
import { usePermissions } from '@/utils/permissions'
import { useFocusRow } from '@/composables/useFocusRow'
import { useReloadPage } from '@/composables/useReloadPage'
import { useQueryState } from '@/composables/useQueryState'
import { celebrateClosedLoop } from '@/utils/feedback'
import RepairTable from './components/RepairTable.vue'
import KpiCard from '@/components/KpiCard.vue'
import RepairDetailDrawer from './components/RepairDetailDrawer.vue'
import ProDialog from '@/components/ProDialog.vue'
import EquipmentTreeSelect from '@/components/EquipmentTreeSelect.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
// KPI 卡片整卡横幅皮肤（repair 素材：纸飞机/齿轮/时钟/对勾/叉/柱状图，按状态一一对应）
import kpiBgDaiPaiDan from '@/assets/img/repair/1.webp'
import kpiBgYiPaiDan from '@/assets/img/repair/2.webp'
import kpiBgDaiYanShou from '@/assets/img/repair/3.webp'
import kpiBgYiGuiDang from '@/assets/img/repair/4.webp'
import kpiBgYiBoHui from '@/assets/img/repair/5.webp'
import kpiBgAll from '@/assets/img/repair/6.webp'
// KPI 卡片右侧 3D 图标（repair 拼音素材；默认隐藏，仅大视口显示）
import kpiSideDaiPaiDan from '@/assets/img/repair/daipaidan.webp'
import kpiSideYiPaiDan from '@/assets/img/repair/yipaidan.webp'
import kpiSideDaiYanShou from '@/assets/img/repair/daiyanshou.webp'
import kpiSideYiGuiDang from '@/assets/img/repair/yiguidang.webp'
import kpiSideYiBoHui from '@/assets/img/repair/yibohui.webp'
import kpiSideAll from '@/assets/img/repair/all.webp'

const loading = ref(false)
const rows = ref<RepairOrder[]>([])
const total = ref(0)
const pageSize = ref(20)
/** 搜索筛选（单源 reactive）：直接作为 ProSearchBar 的 v-model 保证输入即时响应；page 并入以便统一 URL 同步 */
const query = reactive<{ orderNo: string; eqName: string; status: string | undefined; page: number }>({
  orderNo: '',
  eqName: '',
  status: undefined,
  page: 1,
})
const stats = ref<RepairStats | null>(null)

// 筛选/页码与 URL query 回填（setup 同步执行，保证首次 load 带筛选）
// live=false：输入过程中不写回 URL。否则每次按键都会改写 query → 按 fullPath 重挂载 → 立刻重新查询
useQueryState(query, { live: false })
// 跨页跳转行定位：?focus=工单号 命中行高亮 + 滚动定位
const { focus, banner, rowClassName, locate, dismiss } = useFocusRow('order_no')
useReloadPage(() => load())
const createVisible = ref(false)
const dispatchVisible = ref(false)
/* 驳回弹窗状态：与派单/处理同形制（ProDialog） */
const rejectVisible = ref(false)
const rejectFormRef = ref<FormInstance>()
const rejectForm = reactive<{ comment: string }>({ comment: '' })
const rejectRules: FormRules = {
  comment: [{ required: true, message: '请填写驳回原因', trigger: 'blur' }],
}
const completeVisible = ref(false)
const current = ref<RepairOrder | null>(null)
const dispatchForm = reactive<{ worker_id: number | undefined; comment: string }>({
  worker_id: undefined,
  comment: '',
})
const completeForm = reactive<{ feedback: string; images: string[] }>({ feedback: '', images: [] })
const completeUploading = ref(false)

async function uploadCompleteImage(options: { file: File }) {
  completeUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', options.file)
    const { data } = await http.post('/repairs/upload-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    completeForm.images.push(data.data.url)
  } finally {
    completeUploading.value = false
  }
}

function removeCompleteImage(idx: number) {
  completeForm.images.splice(idx, 1)
}
const detailVisible = ref(false)
const detailId = ref<number | null>(null)
const equipments = ref<OptionItem[]>([])
const users = ref<{ id: number; username: string; display_name: string; role_code: string }[]>([])

const form = reactive({
  equipment_id: undefined as number | undefined,
  description: '',
  repair_type: 'overhaul',
  fault_category: '',
  fault_time: undefined as string | undefined,
})

const createFormRef = ref<FormInstance>()
const createRules: FormRules = {
  equipment_id: [{ required: true, message: '请选择设备', trigger: 'change' }],
  repair_type: [{ required: true, message: '请选择维修类型', trigger: 'change' }],
  description: [{ required: true, message: '请填写情况描述', trigger: 'blur' }],
}
const dispatchFormRef = ref<FormInstance>()
const dispatchRules: FormRules = {
  worker_id: [{ required: true, message: '请选择维修人员', trigger: 'change' }],
}
const completeFormRef = ref<FormInstance>()
const completeRules: FormRules = {
  feedback: [{ required: true, message: '请填写处理结果', trigger: 'blur' }],
}
const acceptFormRef = ref<FormInstance>()
const acceptRules: FormRules = {
  comment: [{ required: true, message: '请填写验收备注', trigger: 'blur' }],
}

const { myId, hasPerm } = usePermissions()
const route = useRoute()
const router = useRouter()

/** 派单候选人：仅操作员（派单只能派给一线操作员） */
const workerOptions = computed(() => users.value.filter((u) => u.role_code === 'operator'))

/** 按钮级权限：与后端校验保持一致 */
function canDispatch(row: RepairOrder) {
  return row.process_status === 'pending_dispatch' && hasPerm('repair:dispatch')
}
function canReject(row: RepairOrder) {
  // 一/二类紧急告警工单不允许驳回（后端同样强制拦截），三类及手动报修单可驳回
  const isUrgentAlarm = row.alarm_level === 1 || row.alarm_level === 2
  return row.process_status === 'pending_dispatch' && hasPerm('repair:reject') && !isUrgentAlarm
}
function canComplete(row: RepairOrder) {
  // 完工提交：仅被指派操作员本人，且需具备处理权限
  return (
    row.process_status === 'processing' &&
    row.worker_id === myId.value &&
    hasPerm('repair:process')
  )
}
function canAccept(row: RepairOrder) {
  return row.process_status === 'pending_accept' && hasPerm('repair:accept')
}

const kpis = computed(() => [
  { label: '待派单', value: stats.value?.pending_dispatch ?? 0, color: '#3b82f6', icon: 'ri:send-plane-fill', bg: kpiBgDaiPaiDan, side: kpiSideDaiPaiDan, key: 'pending_dispatch' },
  { label: '已派发', value: stats.value?.processing ?? 0, color: '#f59e0b', icon: 'ri:settings-3-fill', bg: kpiBgYiPaiDan, side: kpiSideYiPaiDan, key: 'processing' },
  { label: '待验收', value: stats.value?.pending_accept ?? 0, color: '#8b5cf6', icon: 'ri:time-fill', bg: kpiBgDaiYanShou, side: kpiSideDaiYanShou, key: 'pending_accept' },
  { label: '已归档', value: stats.value?.archived ?? 0, color: '#22c55e', icon: 'ri:briefcase-fill', bg: kpiBgYiGuiDang, side: kpiSideYiGuiDang, key: 'archived' },
  { label: '已驳回', value: stats.value?.rejected ?? 0, color: '#94a3b8', icon: 'ri:refresh-fill', bg: kpiBgYiBoHui, side: kpiSideYiBoHui, key: 'rejected' },
  { label: '合计', value: stats.value?.total ?? 0, color: '#2563eb', icon: 'ri:computer-fill', bg: kpiBgAll, side: kpiSideAll, key: '' },
])

/** 点击 KPI 卡快捷筛选对应状态（再次点击同卡取消筛选） */
function onKpiClick(key: string) {
  query.status = key || undefined
  query.page = 1
  load()
}

/** 是否存在激活筛选（空态引导判断用） */
const hasFilter = computed(() => !!(query.orderNo || query.eqName || query.status))

/** 查询项配置：工单号 / 设备名称 / 状态（与告警中心同一搜索形制） */
const searchItems = computed<SearchFormItem[]>(() => [
  {
    key: 'orderNo',
    label: '工单号',
    labelWidth: '80px',
    type: 'input',
    props: { clearable: true, placeholder: '请输入工单号' },
  },
  {
    key: 'eqName',
    label: '设备名称',
    labelWidth: '80px',
    type: 'input',
    props: { clearable: true, placeholder: '请输入设备名称' },
  },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    props: {
      clearable: true,
      placeholder: '全部',
      options: [
        { label: '待派单', value: 'pending_dispatch' },
        { label: '已派发', value: 'processing' },
        { label: '待验收', value: 'pending_accept' },
        { label: '已归档', value: 'archived' },
        { label: '已驳回', value: 'rejected' },
      ],
    },
  },
])

/** 导出列配置：与表格列同构，来源/状态/时间转中文文案 */
const exportColumns: ExportColumn[] = [
  { prop: 'order_no', label: '工单号' },
  { prop: 'name', label: '工单名称' },
  { prop: 'equipment_name', label: '设备' },
  { prop: 'source', label: '来源', formatter: (r: any) => sourceLabel(r.source) },
  {
    prop: 'process_status',
    label: '状态',
    formatter: (r: any) =>
      ((
        {
          pending_dispatch: '待派单',
          processing: '已派发',
          pending_accept: '待验收',
          archived: '已归档',
          rejected: '已驳回',
        } as Record<string, string>
      )[r.process_status as string] ?? r.process_status),
  },
  { prop: 'worker_name', label: '维修人' },
  { prop: 'applicant_name', label: '申请人' },
  { prop: 'apply_time', label: '申请时间', formatter: (r: any) => formatDateTime(r.apply_time) },
]

/** 清空全部筛选并重新查询 */
function onClearFilters() {
  query.orderNo = ''
  query.eqName = ''
  query.status = undefined
  query.page = 1
  load()
}

async function load() {
  loading.value = true
  try {
    // 跨页定位：带 ?focus 进入时目标工单可能不在当前页，先向后端查所在页码并跳页
    if (focus.value && !rows.value.some((r) => r.order_no === focus.value)) {
      const { data: loc } = await listRepairs({
        page: 1,
        page_size: pageSize.value,
        order_no: query.orderNo || undefined,
        equipment_name: query.eqName || undefined,
        process_status: query.status,
        locate_order_no: focus.value,
      })
      const lp = (loc.data as PageResult<RepairOrder> & { located_page?: number | null })
        .located_page
      if (lp && lp > 1) query.page = lp
    }
    const { data } = await listRepairs({
      page: query.page,
      page_size: pageSize.value,
      order_no: query.orderNo || undefined,
      equipment_name: query.eqName || undefined,
      process_status: query.status,
    })
    rows.value = data.data.items
    total.value = data.data.total
    const st = await fetchRepairStats()
    stats.value = st.data.data
    // 数据渲染完成后滚动定位到焦点行（无 focus 参数时内部直接返回）
    await locate()
  } finally {
    loading.value = false
  }
}

function onSearch() {
  query.page = 1
  load()
}

/** ProSearchBar 重置：清空全部筛选并重新查询（复用空态引导的清除逻辑） */
function onReset() {
  onClearFilters()
}

/** 每页条数变化：回到第一页重新加载 */
function onSizeChange() {
  query.page = 1
  load()
}

function openCreate() {
  form.equipment_id = undefined
  form.description = ''
  form.repair_type = 'overhaul'
  form.fault_category = ''
  form.fault_time = undefined
  createVisible.value = true
}

async function onCreate() {
  const valid = await createFormRef.value?.validate().catch(() => false)
  if (!valid) return
  await createRepair({ ...form })
  ElMessage.success('报修已提交')
  createVisible.value = false
  await load()
}

function openDispatch(row: RepairOrder) {
  // 设备级互斥：同设备已有未归档工单时不可再派单（后端同样强制拦截）
  if (row.equipment_blocker) {
    ElMessage.warning(`该设备已有未归档工单 ${row.equipment_blocker}，请先完成其验收归档`)
    return
  }
  current.value = row
  dispatchForm.worker_id = undefined
  dispatchForm.comment = ''
  dispatchVisible.value = true
}

async function onDispatch() {
  const valid = await dispatchFormRef.value?.validate().catch(() => false)
  if (!valid) return
  if (!current.value) return
  await dispatchRepair(current.value.id, {
    worker_id: dispatchForm.worker_id!,
    comment: dispatchForm.comment || undefined,
  })
  ElMessage.success('已派单')
  dispatchVisible.value = false
  await load()
}

async function onReject(row: RepairOrder) {
  current.value = row
  rejectForm.comment = ''
  rejectVisible.value = true
}

/** 驳回理由必填：空值或纯空格不允许提交 */
async function onRejectSubmit() {
  const valid = await rejectFormRef.value?.validate().catch(() => false)
  if (!valid || !current.value) return
  await rejectRepair(current.value.id, rejectForm.comment.trim())
  ElMessage.success('已驳回')
  rejectVisible.value = false
  await load()
}

function openComplete(row: RepairOrder) {
  current.value = row
  completeForm.feedback = ''
  completeForm.images = []
  completeVisible.value = true
}

async function onComplete() {
  const valid = await completeFormRef.value?.validate().catch(() => false)
  if (!valid || !current.value) return
  await completeRepair(current.value.id, {
    feedback: completeForm.feedback,
    images: completeForm.images.length ? JSON.stringify(completeForm.images) : '',
  })
  ElMessage.success('已提交，等待管理员验收')
  completeVisible.value = false
  await load()
}

// ---- 验收弹窗：与告警验收一致 ----
const acceptVisible = ref(false)
const acceptRow = ref<RepairOrder | null>(null)
const acceptForm = reactive<{ comment: string }>({ comment: '' })

const acceptImages = computed<string[]>(() => {
  const raw = acceptRow.value?.process_images
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string') : []
  } catch {
    return []
  }
})

async function openAccept(row: RepairOrder) {
  // 拉取工单完整详情（含完工反馈/附件）
  const { data } = await getRepair(row.id)
  acceptRow.value = data.data
  acceptForm.comment = ''
  acceptVisible.value = true
}
async function confirmAccept(pass: boolean) {
  if (!acceptRow.value) return
  const valid = await acceptFormRef.value?.validate().catch(() => false)
  if (!valid) return
  const comment = acceptForm.comment.trim()
  await acceptRepair(acceptRow.value.id, pass, comment)
  acceptVisible.value = false
  if (pass) {
    // 闭环轻庆祝：归档完成时刻的正向反馈（仅右上角通知，去掉中央 ElMessage）
    celebrateClosedLoop('验收通过', `工单 ${acceptRow.value.order_no} 已归档`)
  } else {
    ElMessage.success('已驳回返工')
  }
  await load()
}

function onDetail(row: RepairOrder) {
  detailId.value = row.id
  detailVisible.value = true
}

const pageReady = ref(false)

onMounted(async () => {
  pageReady.value = true
  const [eqRes, userRes] = await Promise.all([
    optionsResource('/equipment/options'),
    // 人员下拉用轻量选项接口：/system/users 需要 sys:user:list，业务角色无此权限
    optionsResource('/system/users/options'),
  ])
  equipments.value = eqRes.data.data
  users.value = userRes.data.data as unknown as typeof users.value

  // 从台账页跳转过来：带 equipment_id 则筛选列表；带 focus=工单号 由 useFocusRow 自动处理高亮
  const equipmentId = Number(route.query.equipment_id) || undefined
  const autoCreate = route.query.auto_create === '1'
  if (equipmentId) {
    const eq = equipments.value.find((e) => e.id === equipmentId)
    if (eq) query.eqName = eq.name
  }
  if (autoCreate && equipmentId && hasPerm('repair:create')) {
    openCreate()
    form.equipment_id = equipmentId
  }

  await load()
  // load 后调用一次 locate：确保 focus query 存在时即使是首次进页面也能滚动定位
  if (route.query.focus) locate()
})
</script>

<style scoped>
/* 页面高度预算不足时整页纵向滚动，避免 flex 把表格区压缩到 0（对齐 RunLogView ISSUE-013 处理） */
.page.mod-repair {
  overflow-y: auto;
}

/* ===== KPI 磨砂面板：六张状态卡的统一背景容器（还原设计稿） ===== */
.kpi-panel {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}

/* ===== KPI 状态卡（KpiCard poster 变体，此处仅保留栅格） ===== */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
}

/* 面板内子卡：近白磨砂 + 设计稿极淡蓝灰发丝边，去掉悬浮投影（层次由面板承载） */
.kpi-panel :deep(.kpi-card.is-poster) {
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid #e4eefb;
  box-shadow: none;
}
.kpi-panel :deep(.kpi-card.is-poster:hover) {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--c) 30%, #ffffff);
  box-shadow: 0 8px 18px -10px rgba(30, 80, 180, 0.18);
}
/* 选中卡：对齐告警中心——1px 主色边框 + 1px 外环 + 柔和外辉光（不改动 1px 边框宽度，避免卡片抖动） */
.kpi-panel :deep(.kpi-card.is-poster.is-active) {
  border-color: var(--c);
  box-shadow:
    0 0 0 1px var(--c),
    0 8px 20px -8px color-mix(in srgb, var(--c) 35%, transparent);
}

/* 常规卡图标块：淡色底 + 语义色图标；仅选中卡（如合计）使用实色渐变白图标 */
.kpi-panel :deep(.kpi-card.is-poster .pt-badge) {
  color: var(--c);
  background: color-mix(in srgb, var(--c) 12%, #ffffff);
  box-shadow: none;
}
.kpi-panel :deep(.kpi-card.is-poster.is-active .pt-badge) {
  color: #fff;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--c) 58%, #ffffff) 0%,
    color-mix(in srgb, var(--c) 96%, #0b2a5b) 100%
  );
  box-shadow: 0 6px 12px -6px color-mix(in srgb, var(--c) 65%, transparent);
}

/* ===== 人工报修按钮：固定在卡头最右侧 ===== */
.btn-create {
  flex: 0 0 auto;
}

/* 表格磨砂容器皮肤由 ProTable 组件全局自带（index.css .pro-table），此处仅保留分页间距 */
.table-card .pager {
  margin-top: 12px;
}

/* 查询：蓝色渐变按钮（#3b9dff → #1477fd） */
.btn-gradient {
  border: none;
  background: linear-gradient(135deg, #3b9dff 0%, #1477fd 100%);
  box-shadow: 0 4px 10px -4px rgba(20, 119, 253, 0.5);
}
.btn-gradient:hover,
.btn-gradient:focus {
  background: linear-gradient(135deg, #55aaff 0%, #2b83ff 100%);
}

/* 人工报修：常规尺寸蓝色渐变按钮 + 蓝调阴影（设计稿同款质感） */
.btn-create {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  /* 全局 .el-button--default 用 !important 锁定组件高度，此处同权提级覆盖 */
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

/* ===== 表格区（透出全局视口底图，卡片通栏） ===== */

.table-section {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}
.table-section .table-card {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* 表格区保底高度：KPI+筛选在小屏挤压时不再把表体压塌为 0（ISSUE-013） */
  min-height: 380px;
  /* 白色半透明边框 + 蓝色荧光阴影 */
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%) !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.65) !important;
  border-radius: 14px !important;
  box-shadow:
    0 6px 24px rgba(55, 135, 220, 0.08),
    0 0 18px rgba(80, 160, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.85) !important;
}

/* ===== 分页：整体靠右，总数+每页条数紧挨页码按钮 ===== */
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 14px;
}
.pager-left {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  line-height: 32px;
  color: var(--art-gray-600, #7987a1);
}
.pager-size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 32px;
}
.pager-size :deep(.el-select) {
  height: 32px;
}
.pager-size :deep(.el-select__wrapper) {
  min-height: 32px;
  height: 32px;
  font-size: 13px;
}

/* ===== 分页按钮：当前页蓝实心，其余浅蓝白，圆角 8px，与表格一体 ===== */
.pager :deep(.el-pagination) {
  --el-pagination-button-color: var(--repair-text-primary, #264779);
  --el-pagination-hover-color: var(--repair-btn-primary, #166dfe);
  font-weight: 500;
}
.pager :deep(.el-pagination .btn-prev),
.pager :deep(.el-pagination .btn-next),
.pager :deep(.el-pagination .el-pager li) {
  min-width: 32px;
  height: 32px;
  margin: 0 3px;
  border-radius: 8px;
  background: #f2f7fe;
  border: 1px solid transparent;
  color: var(--repair-text-primary, #264779);
  font-size: 13px;
  transition: all 0.15s ease;
}
.pager :deep(.el-pagination .el-pager li:hover),
.pager :deep(.el-pagination .btn-prev:hover),
.pager :deep(.el-pagination .btn-next:hover) {
  color: var(--repair-btn-primary, #166dfe);
  background: #e4efff;
}
.pager :deep(.el-pagination .el-pager li.is-active) {
  background: var(--repair-btn-primary, #166dfe);
  color: #fff;
  border-color: var(--repair-btn-primary, #166dfe);
  box-shadow: 0 4px 10px -3px rgba(22, 109, 254, 0.45);
}
.pager :deep(.el-pagination .el-pager li.is-active:hover) {
  color: #fff;
  background: var(--repair-btn-primary, #166dfe);
}
.pager :deep(.el-pagination button:disabled) {
  background: #f2f7fe;
  opacity: 0.55;
}

@media only screen and (max-width: 1280px) {
  .kpi-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
/* ≤1024 仍保持三列（两列会让 KPI 面板过高、挤压表格区），仅收紧间距 */
@media only screen and (max-width: 1024px) {
  .kpi-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .kpi-panel {
    padding: 10px;
    margin-bottom: 10px;
  }
}
@media only screen and (max-width: 768px) {
  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
}

/* ===== 验收弹窗：顶部信息卡 + 蓝条区块 + 意见区 ===== */
.accept-info-card {
  padding: 16px 18px;
  background: #f4f7fb;
  border-radius: 10px;

  .aic-title {
    margin-bottom: 12px;
    color: #1b2c46;
    font-size: 17px;
    font-weight: 700;
  }
  .aic-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 24px;
  }
  .aic-item {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 13px;

    span {
      flex: none;
      width: 64px;
      color: #8a97a8;
    }
    b {
      color: #1b2c46;
      font-weight: 600;
      word-break: break-all;
    }
  }
}
/* 蓝条区块标题 */
.accept-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 12px;
  color: #1b2c46;
  font-size: 15px;
  font-weight: 700;

  &::before {
    width: 4px;
    height: 16px;
    border-radius: 2px;
    background: #176bff;
    content: '';
  }
}
/* 描述/反馈内容块：小标题 + 浅灰底内容 */
.accept-block {
  margin-bottom: 14px;

  .ab-label {
    margin-bottom: 8px;
    color: #1b2c46;
    font-size: 13px;
    font-weight: 600;
  }
  .ab-content {
    max-height: 160px;
    padding: 12px 14px;
    overflow-y: auto;
    color: #33475e;
    font-size: 13px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-all;
    background: #f5f7fa;
    border-radius: 8px;

    &.ab-empty {
      color: #9aa7b8;
    }
  }

  .accept-images {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    .el-image {
      width: 96px;
      height: 72px;
      border-radius: 8px;
      cursor: zoom-in;
    }
  }
}
/* 完工弹窗图片上传 */
.complete-upload {
  width: 100%;

  .complete-upload-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .cul-item {
    position: relative;

    .el-image {
      width: 72px;
      height: 54px;
      border-radius: 6px;
    }
    .cul-del {
      position: absolute;
      top: -6px;
      right: -6px;
      color: #e34d59;
      font-size: 16px;
      cursor: pointer;
      background: #fff;
      border-radius: 50%;
    }
  }
  .cul-empty {
    margin-top: 6px;
    color: #9aa7b8;
    font-size: 12px;
  }
}
/* 验收意见：必填星号 + 右侧灰色提示 */
.accept-form {
  margin-top: 4px;
}
.accept-comment {
  width: 100%;

  .ac-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;

    .ac-label {
      color: #1b2c46;
      font-size: 14px;
      font-weight: 700;

      .req {
        margin-right: 2px;
        color: #f03d45;
        font-style: normal;
      }
    }
    .ac-hint {
      color: #8a97a8;
      font-size: 12px;
    }
  }
}
:deep(.el-dialog__footer) .el-button + .el-button {
  margin-left: 12px;
}
</style>

<!-- 非 scoped：page-content 是本页祖先元素，scoped 无法命中；
     仅在维修工单页移除 border-mode 给 .page-content 的 1px 描边，其他页面不受影响 -->
<style>
html[data-box-mode] .page-content:has(.mod-repair) {
  border: none !important;
}
</style>

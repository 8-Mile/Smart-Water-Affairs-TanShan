<!--
  DocDetailPanel —— 档案「详情」内嵌右侧栏（按档案类型差异化布局，无 Tab）
  1. 工单档案：展示「基本信息 + 业务流程记录」（彩色时间轴串联工单流转日志，供 AI 文档喂养）
  2. 设备资料 / 图纸 / 其他：展示「基本信息 + 文件预览」
     图片用 el-image 在线查看（支持放大预览）；PDF 用 iframe 在线查看；其余类型提示下载
-->
<template>
  <div class="ddp" :class="{ 'is-open': visible }">
    <el-card shadow="never" class="art-table-card fdp-card">
      <!-- 头部：档案名称 + 状态徽章 + 关闭 -->
      <div class="fdp-head">
        <div class="fdp-title-wrap">
          <span class="fdp-title" :title="row?.name">{{ row?.name || '档案详情' }}</span>
          <el-tag v-if="isWorkOrder" class="fdp-status" type="success" size="small" effect="light">已归档</el-tag>
        </div>
        <button class="fdp-op" title="收起" @click="emit('close')">
          <ArtSvgIcon icon="ri:close-line" />
        </button>
      </div>

      <div class="fdp-body">
        <template v-if="row">
          <!-- ============ 工单档案：无 Tab，基本信息 + 业务流程记录 ============ -->
          <template v-if="isWorkOrder">
            <!-- 基本信息 -->
            <section class="fdp-section">
              <h4 class="fdp-section-title">
                <ArtSvgIcon icon="ri:file-info-line" class="sec-ico" />基本信息
              </h4>
              <ul class="fdp-fields fdp-fields-2col">
                <li v-for="f in workOrderBaseFields" :key="f.label">
                  <span class="fdp-label">{{ f.label }}</span>
                  <span class="fdp-value" :title="f.value || ''">{{ f.value || '—' }}</span>
                </li>
              </ul>
              <div class="fdp-desc-block">
                <span class="fdp-label">档案说明</span>
                <p class="fdp-desc-text">{{ row.description || '—' }}</p>
              </div>
            </section>

            <!-- 业务流程记录 -->
            <section class="fdp-section">
              <h4 class="fdp-section-title">
                <ArtSvgIcon icon="ri:git-branch-line" class="sec-ico" />业务流程记录
              </h4>
              <div v-if="flowLoading" class="fdp-loading">
                <el-icon class="is-loading"><ArtSvgIcon icon="ri:loader-4-line" /></el-icon>
                <span>加载工单流转记录…</span>
              </div>
              <FlowTimeline v-else-if="flowSteps.length" :nodes="flowSteps" />
              <div v-else class="fdp-empty-mini">
                <ArtSvgIcon icon="ri:information-line" />暂无业务流程记录
              </div>
            </section>
          </template>

          <!-- ============ 设备资料 / 图纸 / 其他：基本信息 + 在线预览（无 Tab） ============ -->
          <template v-else>
            <!-- 基本信息 -->
            <section class="fdp-section fdp-section-first">
              <h4 class="fdp-section-title">
                <ArtSvgIcon icon="ri:file-info-line" class="sec-ico" />基本信息
              </h4>
              <ul class="fdp-fields fdp-fields-2col">
                <li v-for="f in docBaseFields" :key="f.label">
                  <span class="fdp-label">{{ f.label }}</span>
                  <span class="fdp-value" :title="f.value || ''">{{ f.value || '—' }}</span>
                </li>
              </ul>
              <div class="fdp-desc-block">
                <span class="fdp-label">资料描述</span>
                <p class="fdp-desc-text">{{ row.description || '—' }}</p>
              </div>
            </section>

            <!-- 文件预览：图片/PDF 在线查看，其余类型提示下载 -->
            <section class="fdp-section">
              <h4 class="fdp-section-title">
                <ArtSvgIcon icon="ri:eye-line" class="sec-ico" />文件预览
              </h4>
              <div class="fdp-preview">
                <div v-if="previewType === 'pdf'" class="preview-box">
                  <iframe :src="previewUrl" class="preview-iframe" />
                </div>
                <div v-else-if="previewType === 'image'" class="preview-box preview-img-box">
                  <el-image
                    :src="previewUrl"
                    :preview-src-list="[previewUrl]"
                    :initial-index="0"
                    fit="contain"
                    class="preview-img"
                    preview-teleported
                  />
                </div>
                <div v-else class="preview-unsupported">
                  <ArtSvgIcon :icon="unsupportedIcon" class="preview-unsupported-ico" />
                  <p class="preview-unsupported-text">
                    {{ unsupportedText }}
                  </p>
                  <el-button type="primary" size="small" @click="downloadRow">
                    <ArtSvgIcon icon="ri:download-2-line" />下载文件
                  </el-button>
                </div>
              </div>
            </section>
          </template>
        </template>

        <div v-else class="fdp-placeholder">
          <ArtSvgIcon icon="ri:file-text-line" class="ph-ico" />
          <p>请选择左侧档案查看详情</p>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import FlowTimeline from '@/components/FlowTimeline.vue'
import { formatSize, type ArchiveItem } from '@/api/archive'
import { getRepairByOrderNo } from '@/api/repair'
import { useUserStore } from '@/stores/user'

const props = defineProps<{
  visible: boolean
  row: ArchiveItem | null
  categoryPath?: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const user = useUserStore()

/* ---------- 判断是否为工单档案 ---------- */
const isWorkOrder = computed(() => {
  const r = props.row
  if (!r) return false
  if (r.related_order) return true
  if (r.category_name?.includes('工单')) return true
  if (r.category_code?.startsWith('DOC-ORDER')) return true
  return false
})

/* ---------- 文件格式辅助 ---------- */
function ftKind(fmt?: string) {
  const f = (fmt || '').toLowerCase()
  if (f === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(f)) return 'image'
  if (['dwg', 'dxf'].includes(f)) return 'cad'
  return 'other'
}
function fmtLabel(fmt?: string) {
  const map: Record<string, string> = {
    pdf: 'PDF', doc: 'DOC', docx: 'DOCX', xls: 'XLS', xlsx: 'XLSX',
    ppt: 'PPT', pptx: 'PPTX', dwg: 'CAD', dxf: 'CAD',
  }
  const f = (fmt || '').toLowerCase()
  if (map[f]) return map[f]
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(f)) return 'IMG'
  return (f || 'FILE').toUpperCase().slice(0, 4)
}

/* ---------- 工单档案：基本信息字段（对齐设计稿双列布局） ---------- */
const workOrderBaseFields = computed(() => {
  const r = props.row
  if (!r) return []
  return [
    { label: '档案名称', value: r.name },
    { label: '档案编号', value: r.archive_no || '' },
    { label: '档案类型', value: r.category_name || props.categoryPath || '' },
    { label: '关联设备', value: r.related_equipment || '' },
    { label: '来源类型', value: r.source || '人工上传' },
    { label: '归档时间', value: r.upload_time ? r.upload_time.slice(0, 16).replace('T', ' ') : '' },
    { label: '关联工单', value: r.related_order || '' },
    { label: '创建人', value: r.uploader_name || '系统' },
  ]
})

/* ---------- 设备资料 / 图纸：基本信息字段 ---------- */
const docBaseFields = computed(() => {
  const r = props.row
  if (!r) return []
  return [
    { label: '资料名称', value: r.name },
    { label: '档案编号', value: r.archive_no || '' },
    { label: '资料类型', value: r.category_name || props.categoryPath || '' },
    { label: '关联设备', value: r.related_equipment || '' },
    { label: '文件格式', value: fmtLabel(r.file_format) },
    { label: '文件大小', value: formatSize(r.file_size || 0) },
    { label: '上传时间', value: r.upload_time ? r.upload_time.slice(0, 16).replace('T', ' ') : '' },
    { label: '上传人', value: r.uploader_name || '' },
  ]
})

/* ---------- 业务流程记录：拉取关联工单流转日志 ---------- */
interface FlowStep {
  name: string
  icon: string
  status: 'pending' | 'doing' | 'done'
  /** 节点主题色（红/蓝/橙/紫/绿） */
  color: 'red' | 'blue' | 'orange' | 'purple' | 'green'
  operator?: string
  desc?: string
  time?: string
}

/* 工单日志 action → 流程节点映射（对齐设计稿：告警触发 → 生成工单 → 指派维修 → 维修处理 → 验收完成 → 工单归档） */
const ACTION_MAP: Record<string, { name: string; icon: string; color: FlowStep['color'] }> = {
  create_from_alarm: { name: '告警触发', icon: 'ri:alarm-warning-line', color: 'red' },
  create: { name: '生成工单', icon: 'ri:file-add-line', color: 'blue' },
  dispatch: { name: '指派维修', icon: 'ri:user-settings-line', color: 'orange' },
  reject_dispatch: { name: '退回派单', icon: 'ri:arrow-go-back-line', color: 'orange' },
  complete: { name: '维修处理', icon: 'ri:tools-line', color: 'purple' },
  accept_pass: { name: '验收完成', icon: 'ri:checkbox-circle-line', color: 'green' },
  accept_reject: { name: '验收驳回', icon: 'ri:close-circle-line', color: 'red' },
}

const flowLoading = ref(false)
const flowSteps = ref<FlowStep[]>([])

watch(
  () => [props.row?.id, props.row?.related_order],
  async () => {
    if (!props.row || !isWorkOrder.value) {
      flowSteps.value = []
      return
    }
    flowLoading.value = true
    try {
      const steps: FlowStep[] = []
      if (props.row.related_order) {
        const order = await getRepairByOrderNo(props.row.related_order)
        if (order?.logs?.length) {
          for (const log of order.logs) {
            const meta = ACTION_MAP[log.action] || { name: log.action, icon: 'ri:record-circle-line', color: 'blue' as const }
            steps.push({
              name: meta.name,
              icon: meta.icon,
              color: meta.color,
              status: 'done',
              operator: log.operator_name || '系统自动',
              desc: log.detail || '',
              time: log.created_at ? log.created_at.slice(0, 16).replace('T', ' ') : '',
            })
          }
        }
      }
      // 末位补充「工单归档」节点（档案自身的归档时间）
      steps.push({
        name: '工单归档',
        icon: 'ri:archive-line',
        color: 'blue',
        status: 'done',
        operator: props.row.uploader_name || '系统',
        desc: props.row.description || '维修过程资料整理归档，生成档案记录',
        time: props.row.upload_time ? props.row.upload_time.slice(0, 16).replace('T', ' ') : '',
      })
      flowSteps.value = steps
    } catch {
      // 拉取失败时仅展示归档节点
      flowSteps.value = [
        {
          name: '工单归档',
          icon: 'ri:archive-line',
          color: 'blue',
          status: 'done',
          operator: props.row.uploader_name || '系统',
          desc: props.row.description || '维修过程资料整理归档',
          time: props.row.upload_time ? props.row.upload_time.slice(0, 16).replace('T', ' ') : '',
        },
      ]
    } finally {
      flowLoading.value = false
    }
  },
  { immediate: true },
)

/* ---------- 文件预览 ---------- */
const previewType = computed(() => ftKind(props.row?.file_format))
// 预览走带 Authorization 头的请求取二进制，再用 blob URL 渲染：
// 不再把 token 拼进 URL（避免进入浏览器历史、代理/访问日志与 Referer）
const previewUrl = ref('')
let previewObjectUrl = ''
function clearPreview() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = ''
  }
  previewUrl.value = ''
}
async function loadPreview() {
  clearPreview()
  const r = props.row
  if (!r) return
  const kind = previewType.value
  if (kind !== 'pdf' && kind !== 'image') return
  try {
    const res = await fetch(`/api/v1/archives/${r.id}/preview`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
    if (!res.ok) return
    const blob = await res.blob()
    previewObjectUrl = URL.createObjectURL(blob)
    previewUrl.value = previewObjectUrl
  } catch {
    // 预览失败时保持空态，用户可改用下载
  }
}
watch(() => props.row?.id, loadPreview, { immediate: true })
onBeforeUnmount(clearPreview)
const unsupportedIcon = computed(() => {
  if (previewType.value === 'cad') return 'ri:pen-nib-line'
  return 'ri:file-unknow-line'
})
const unsupportedText = computed(() => {
  if (previewType.value === 'cad') return 'CAD 图纸文件暂不支持在线预览，请下载后使用 AutoCAD 查看'
  return '该文件类型暂不支持在线预览，请下载后查看'
})

/* ---------- 下载 ---------- */
async function fetchBlob(row: ArchiveItem) {
  const res = await fetch(`/api/v1/archives/${row.id}/download`, {
    headers: { Authorization: `Bearer ${user.token}` },
  })
  if (!res.ok) return null
  return res.blob()
}
async function downloadRow() {
  if (!props.row) return
  const blob = await fetchBlob(props.row)
  if (!blob) {
    ElMessage.error('下载失败')
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = props.row.file_name || props.row.name
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style lang="scss" scoped>
/* ===== 展开容器：宽度 0 ↔ 面板宽 过渡 ===== */
.ddp {
  flex: 0 0 auto;
  width: 0;
  margin-left: -12px;
  overflow: hidden;
  transition:
    width 0.28s ease,
    margin-left 0.28s ease;
}
.ddp.is-open {
  width: 380px;
  margin-left: 0;
}
.fdp-card {
  flex: 0 0 auto;
  width: 380px;
  height: 100%;
  margin-top: 0;
  /* 毛玻璃底色（覆盖全局 .el-card.art-table-card 的 !important 背景，与详情抽屉同质感） */
  background: rgba(255, 255, 255, 0.72) !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
}

/* ===== 头部 ===== */
.fdp-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #eef3fa;
}
.fdp-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}
.fdp-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2d3d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fdp-status {
  flex: 0 0 auto;
  font-size: 11px;
}
.fdp-op {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: 14px;
  color: #8a97a8;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 50%;
  &:hover {
    color: #1477fd;
    background: #e8f1ff;
  }
}

.fdp-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

/* ===== 分区标题 ===== */
.fdp-section {
  margin-top: 14px;
}
/* 非工单档案（无 Tab）：首段与预览段左右留白对齐 */
.fdp-section-first,
.fdp-section-first + .fdp-section {
  padding: 0 14px;
}
.fdp-section-first {
  margin-top: 12px;
}
.fdp-section + .fdp-section {
  margin-top: 18px;
}
.fdp-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #1f2d3d;
}
.sec-ico {
  font-size: 15px;
  color: #2f7cf6;
}

/* ===== 基本信息字段（双列） ===== */
.fdp-fields {
  padding: 0;
  margin: 10px 0 0;
  list-style: none;
}
.fdp-fields-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 16px;
}
.fdp-fields li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}
.fdp-label {
  font-size: 12px;
  color: #8a97a8;
}
.fdp-value {
  font-size: 13px;
  color: #2b3a4d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 档案说明（整块） */
.fdp-desc-block {
  margin-top: 10px;
  padding: 10px 12px;
  background: #f7faff;
  border: 1px solid #e6effb;
  border-radius: 8px;
}
.fdp-desc-block .fdp-label {
  display: block;
  margin-bottom: 4px;
}
.fdp-desc-text {
  margin: 0;
  font-size: 12.5px;
  color: #5e6f8e;
  line-height: 1.7;
}

/* ===== 业务流程时间轴（彩色节点，对齐设计稿） ===== */
.fdp-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 16px;
  font-size: 13px;
  color: #8a97a8;
  .el-icon {
    font-size: 16px;
    color: #2f7cf6;
  }
}
.fdp-flow {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

/* ===== 文件预览（嵌于 section 内，左右留白由 section 承担） ===== */
.fdp-preview {
  margin-top: 10px;
  min-height: 0;
  padding-bottom: 14px;
}
.preview-box {
  width: 100%;
  height: 100%;
  min-height: 300px;
  background: #fff;
  border: 1px solid #e6effb;
  border-radius: 8px;
  overflow: hidden;
}
.preview-iframe {
  width: 100%;
  height: 100%;
  min-height: 400px;
  border: none;
}
.preview-img-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.preview-img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}
.preview-unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  text-align: center;
}
.preview-unsupported-ico {
  font-size: 56px;
  color: #c3cddc;
}
.preview-unsupported-text {
  margin: 0;
  font-size: 13px;
  color: #8a97a8;
  line-height: 1.6;
}

/* ===== 空态 / 占位 ===== */
.fdp-empty-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 20px 0;
  font-size: 12.5px;
  color: #9aa7ba;
  :deep(.art-svg-icon) {
    font-size: 28px;
    color: #c3cddc;
  }
}
.fdp-placeholder {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #9aa7ba;
  .ph-ico {
    font-size: 48px;
    color: #c3cddc;
  }
  p {
    margin: 0;
    font-size: 13px;
  }
}
</style>

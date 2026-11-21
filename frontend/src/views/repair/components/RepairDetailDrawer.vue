<template>
  <!-- 工单详情抽屉（统一 ProDetailDrawer 形制：磨砂壳层 + 信息卡 + 流转日志） -->
  <ProDetailDrawer
    :model-value="modelValue"
    title="工单详情"
    subtitle="查看本次工单的详细信息及处理进度"
    icon="ri:file-text-line"
    body-fill
    :border-tone="statusTone"
    @update:model-value="onDrawerToggle"
  >
    <div v-loading="loading" class="repair-detail-body">
      <template v-if="detail">
        <!-- ===== 信息卡：统一信息行 ===== -->
        <ProDetailSection flush>
          <!-- 工单号（可复制） -->
          <ProDetailRow icon="ri:file-list-line" label="工单号">
            <div class="order-no-cell">
              <span class="order-no">{{ detail.order_no }}</span>
              <button class="copy-btn" type="button" title="复制工单号" @click="copyOrderNo">
                <ArtSvgIcon icon="ri:file-copy-line" />
              </button>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:price-tag-3-line" label="名称" :value="detail.name" />
          <ProDetailRow icon="ri:tools-line" label="设备" :value="equipmentText" />
          <ProDetailRow icon="ri:pulse-line" label="状态">
            <span class="dd-pill" :class="statusPill(detail.process_status)">
              {{ statusLabel(detail.process_status) }}
            </span>
          </ProDetailRow>
          <ProDetailRow icon="ri:share-forward-2-line" label="来源">
            <div class="source-cell">
              <span>{{ sourceText }}</span>
              <!-- 告警来源工单：标注告警级别（一类红 / 二类橙 / 三类蓝，与全站告警等级色一致） -->
              <span v-if="alarmLevelBadge" class="dd-pill" :class="alarmLevelBadge.cls">
                {{ alarmLevelBadge.text }}
              </span>
            </div>
          </ProDetailRow>
          <ProDetailRow
            icon="ri:team-line"
            label="申请人"
            :value="detail.applicant_username || detail.applicant_name || '—'"
          />
          <ProDetailRow
            icon="ri:time-line"
            label="申请时间"
            :value="detail.apply_time ? formatDateTime(detail.apply_time) : '—'"
            mono
          />
          <ProDetailRow icon="ri:file-text-line" label="描述" top>
            <div v-if="detail.description" class="dd-desc">{{ detail.description }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-hint">暂无描述</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:user-line" label="维修人" top>
            <div v-if="detail.worker_username || detail.worker_name" class="dd-desc">
              {{ detail.worker_username || detail.worker_name }}
            </div>
            <div v-else class="dd-empty">
              <span class="dd-empty-hint">暂无指定维修人</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:chat-1-line" label="处理反馈" top>
            <div v-if="detail.process_feedback" class="dd-desc">{{ detail.process_feedback }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-hint">暂无处理反馈</span>
            </div>
          </ProDetailRow>
          <ProDetailRow icon="ri:shield-check-line" label="验收意见" top>
            <div v-if="detail.accept_comment" class="dd-desc">{{ detail.accept_comment }}</div>
            <div v-else class="dd-empty">
              <span class="dd-empty-hint">暂无验收意见</span>
            </div>
          </ProDetailRow>
        </ProDetailSection>

        <!-- ===== 流转日志：纵向时间线（撑满抽屉剩余空间） ===== -->
        <ProDetailSection class="log-section" icon="ri:time-line" title="流转日志" :count="`${logs.length} 条记录`">
          <ul v-if="logs.length" class="timeline">
            <li v-for="(log, i) in logs" :key="i" class="tl-item">
              <span class="tl-rail" aria-hidden>
                <i class="tl-dot" :class="actionDot(log.action)" />
              </span>
              <div class="tl-content">
                <p class="tl-action">{{ actionLabel(log.action) }} · {{ log.operator_name || '系统' }}</p>
                <p v-if="log.detail" class="tl-detail">{{ log.detail }}</p>
                <p class="tl-time">
                  <ArtSvgIcon class="tl-time-icon" icon="ri:time-line" />
                  {{ formatDateTime(log.created_at, false) }}
                </p>
              </div>
            </li>
          </ul>
          <el-empty v-else :image-size="80" description="暂无流转日志" />
        </ProDetailSection>
      </template>
    </div>
  </ProDetailDrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ProDetailDrawer from '@/components/ProDetailDrawer.vue'
import ProDetailRow from '@/components/ProDetailRow.vue'
import ProDetailSection from '@/components/ProDetailSection.vue'
import { getRepair, statusLabel, type RepairOrder } from '@/api/repair'
import { formatDateTime } from '@/utils/time'

const props = defineProps<{
  modelValue: boolean
  repairId: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
}>()

const detail = ref<RepairOrder | null>(null)
const loading = ref(false)

const logs = computed(() => detail.value?.logs ?? [])

/* 流转日志操作项中文映射（后端 action 为英文代码，展示层统一翻译） */
function actionLabel(action: string) {
  return (
    {
      create: '提交报修',
      dispatch: '审批派单',
      reject_dispatch: '审批驳回',
      complete: '完工提交',
      accept_pass: '验收通过',
      accept_reject: '验收驳回',
    } as Record<string, string>
  )[action] || action
}

/* 状态胶囊配色（dd-pill 全局色系，与列表页同规格）：待派单橙/处理中蓝/待验收紫/已归档绿/已驳回灰 */
function statusPill(v: string) {
  return (
    {
      pending_dispatch: 'is-orange',
      processing: 'is-blue',
      pending_accept: 'is-purple',
      archived: 'is-green',
      rejected: 'is-gray',
    } as Record<string, string>
  )[v] || 'is-gray'
}

/* 状态呼吸边框色（与状态胶囊同色系）：待派单橙/处理中蓝/待验收紫/已归档绿/已驳回灰 */
const statusTone = computed(() => {
  const v = detail.value?.process_status
  if (!v) return undefined
  return (
    {
      pending_dispatch: 'orange',
      processing: 'blue',
      pending_accept: 'purple',
      archived: 'green',
      rejected: 'gray',
    } as Record<string, string>
  )[v] || 'gray'
})

/* 流转日志时间轴圆点色：提交/派单蓝、完工紫、验收通过绿、驳回红 */
function actionDot(action: string) {
  return (
    {
      create: 'is-blue',
      dispatch: 'is-blue',
      reject_dispatch: 'is-red',
      complete: 'is-purple',
      accept_pass: 'is-green',
      accept_reject: 'is-red',
    } as Record<string, string>
  )[action] || 'is-blue'
}

const equipmentText = computed(() => {
  const d = detail.value
  if (!d?.equipment_name) return '—'
  return d.equipment_code ? `${d.equipment_name}（${d.equipment_code}）` : d.equipment_name
})

const sourceText = computed(() => {
  const d = detail.value
  if (!d) return '—'
  if (d.source === 'alarm') return d.alarm_id ? `告警 · 告警#${d.alarm_id}` : '告警'
  return ({ inspection: '巡检', manual: '人工', maintenance: '维保' } as Record<string, string>)[d.source] || '人工'
})

/** 告警级别徽章（仅来源告警的工单显示）：一类红 / 二类橙 / 三类蓝 */
const alarmLevelBadge = computed(() => {
  const d = detail.value
  if (!d || d.source !== 'alarm' || !d.alarm_level) return null
  const text =
    ({ 1: '一类告警', 2: '二类告警', 3: '三类告警' } as Record<number, string>)[d.alarm_level] ||
    `${d.alarm_level}类告警`
  const cls =
    ({ 1: 'is-red', 2: 'is-orange', 3: 'is-blue' } as Record<number, string>)[d.alarm_level] ||
    'is-gray'
  return { text, cls }
})

function close() {
  emit('update:modelValue', false)
}
// 抽屉内部（点遮罩 / ESC / 关闭钮）请求关闭时，透传给父级 v-model
function onDrawerToggle(v: boolean) {
  if (!v) close()
}

async function copyOrderNo() {
  const no = detail.value?.order_no
  if (!no) return
  try {
    await navigator.clipboard.writeText(no)
    ElMessage.success('工单号已复制')
  } catch {
    // 非安全上下文兜底
    const ta = document.createElement('textarea')
    ta.value = no
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    ElMessage.success('工单号已复制')
  }
}

watch(
  () => [props.modelValue, props.repairId] as const,
  async ([open, id]) => {
    if (open && id) {
      loading.value = true
      try {
        const { data } = await getRepair(id)
        detail.value = data.data
      } finally {
        loading.value = false
      }
    } else if (!open) {
      detail.value = null
    }
  },
)
</script>

<style scoped>
/* ===== 内容容器：body-fill 下撑满抽屉剩余高度，上下两卡各占 50% 并独立滚动 ===== */
.repair-detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}
/* 上部分：基本信息卡 —— 与流转日志各占一半高度，内容超长时内部滚动 */
.repair-detail-body > .pd-section:first-child {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.repair-detail-body > .pd-section:first-child :deep(.pd-sec-body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* 下部分：流转日志卡 —— 与基本信息各占一半高度，内容超长时内部滚动 */
.log-section {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.log-section :deep(.pd-sec-body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* 无日志时空态占满剩余高度居中 */
.log-section :deep(.el-empty) {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* ===== 工单号 + 复制按钮 ===== */
.order-no-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.order-no {
  font-family: 'DIN Alternate', 'Bahnschrift', 'Rajdhani', 'Helvetica Neue', 'PingFang SC', sans-serif;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  padding: 0;
  font-size: 15px;
  color: #5b83c2;
  cursor: pointer;
  background: #f1f7ff;
  border: 1px solid #dce9fc;
  border-radius: 8px;
  transition: all 0.15s ease;
}
.copy-btn:hover {
  color: #166dfe;
  background: #e4efff;
  border-color: #b9d5ff;
}

/* ===== 来源行：来源文本 + 告警级别徽章 ===== */
.source-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

/* ===== 流转日志时间线 ===== */
.timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}
.tl-item {
  position: relative;
  display: flex;
  gap: 14px;
}
/* 竖向虚线：非末条连接到下一条 */
.tl-rail {
  position: relative;
  flex: 0 0 auto;
  width: 14px;
  padding-top: 18px;
}
.tl-rail::after {
  content: '';
  position: absolute;
  top: 28px;
  bottom: -14px;
  left: 50%;
  border-left: 2px dashed #b9d2f5;
  transform: translateX(-50%);
}
.tl-item:last-child .tl-rail::after {
  display: none;
}
.tl-dot {
  position: relative;
  z-index: 1;
  display: block;
  width: 13px;
  height: 13px;
  background: #1677ff;
  border: 2.5px solid #cfe1ff;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
}
/* 圆点按操作类型着色（与状态色同板） */
.tl-dot.is-blue   { background: #1677ff; border-color: #cfe1ff; box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12); }
.tl-dot.is-green  { background: #16a34a; border-color: #bfe7cd; box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.12); }
.tl-dot.is-red    { background: #f03d45; border-color: #ffd3d6; box-shadow: 0 0 0 2px rgba(240, 61, 69, 0.12); }
.tl-dot.is-purple { background: #8055db; border-color: #ddd1f5; box-shadow: 0 0 0 2px rgba(128, 85, 219, 0.12); }
.tl-content {
  flex: 1 1 auto;
  min-width: 0;
  margin-bottom: 14px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #e7effa;
  border-radius: 10px;
}
.tl-item:last-child .tl-content {
  margin-bottom: 0;
}
.tl-action {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #12234d;
  line-height: 1.5;
  word-break: break-all;
}
.tl-detail {
  margin: 6px 0 0;
  font-size: 13px;
  color: #5e6f8e;
  line-height: 1.6;
  word-break: break-all;
}
.tl-time {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 12px;
  color: #8197b4;
}
.tl-time-icon {
  font-size: 14px;
  color: #9db4d4;
}
</style>

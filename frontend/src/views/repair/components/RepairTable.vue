<template>
  <ProTable
    :data="rows"
    :loading="loading"
    :columns="columns"
    :row-class-name="rowClassFn"
  >
    <template #source="{ row }">
      <!-- 来源标识：告警红 / 巡检蓝 / 人工中性（与状态列「待派单」橙系胶囊区分色系） -->
      <span class="src-pill" :class="sourceClass(row.source)">
        {{ sourceText(row.source) }}
      </span>
    </template>

    <template #worker_name="{ row }">
      <!-- 指派人员：显示账号名，无账号信息时回退维修人姓名 -->
      <span>{{ row.worker_username || row.worker_name || '—' }}</span>
    </template>

    <template #process_status="{ row }">
      <span class="status-pill" :class="`is-${row.process_status || 'unknown'}`">
        {{ statusLabel(row.process_status) || '—' }}
      </span>
    </template>
    <template #apply_time="{ row }">
      {{ formatDateTime(row.apply_time) }}
    </template>
    <template #operation="{ row }">
      <div class="action-cell">
        <slot name="actions" :row="row" />
        <!-- 详情：与业务按钮同一行横向排列、间距一致，右对齐后恒定在最右侧 -->
        <ArtButtonTable type="view" title="详情" label="详情" @click="emit('detail', row)" />
      </div>
    </template>
    <!-- 空态插槽透传给父级：筛选为空时给引导，否则显示暂无数据 -->
    <template #empty>
      <slot name="empty">
        <el-empty :image-size="120" description="暂无数据" />
      </slot>
    </template>
  </ProTable>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { statusLabel, type RepairOrder } from '@/api/repair'
import { formatDateTime } from '@/utils/time'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import ProTable from '@/components/ProTable.vue'
import type { ProColumn } from '@/components/ProTable.vue'

const props = defineProps<{
  rows: RepairOrder[]
  loading?: boolean
  /** 行定位高亮（useFocusRow 输出），匹配命中行加 row-focus 类名 */
  rowClassName?: (params: { row: Record<string, unknown> }) => string
  /** 详情抽屉打开的工单 id：对应行加 row-selected 持续高亮，关闭传 null 即移除 */
  activeRowId?: number | null
}>()

const emit = defineEmits<{
  detail: [row: RepairOrder]
}>()

/** 来源文案：告警 / 巡检 / 人工 / 维保 */
function sourceText(v: string) {
  return (
    ({ alarm: '告警', inspection: '巡检', manual: '人工', maintenance: '维保' } as Record<string, string>)[v] || v
  )
}
/** 来源胶囊色系：与状态列色系错开（状态待派单=橙，来源告警=红/巡检=蓝/维保=紫/人工=中性灰蓝） */
function sourceClass(v: string) {
  return (
    ({
      alarm: 'is-alarm',
      inspection: 'is-inspection',
      manual: 'is-manual',
      maintenance: 'is-maintenance',
    } as Record<string, string>)[v] || 'is-manual'
  )
}

/* 状态胶囊配色由模板类名 is-xxx + scoped CSS 驱动（设计稿精确值） */

/* 合并跨页定位高亮与详情选中态；依赖 activeRowId 重新生成函数引用，
   确保抽屉开关时 el-table 重算行类名 */
const rowClassFn = computed(() => {
  const activeId = props.activeRowId
  const external = props.rowClassName
  return (params: { row: Record<string, unknown> }): string =>
    [
      external?.(params),
      activeId != null && Number(params.row.id) === activeId ? 'row-selected' : '',
    ]
      .filter(Boolean)
      .join(' ')
})

const columns = computed<ProColumn[]>(() => [
  { type: 'globalIndex', label: '序号', width: 60, fixed: 'left', className: 'idx-cell' },
  { prop: 'order_no', label: '工单号', width: 160, className: 'order-no-cell' },
  { prop: 'name', label: '工单名称', minWidth: 150, showOverflowTooltip: true },
  { prop: 'equipment_name', label: '设备', width: 130 },
  { prop: 'source', label: '来源', width: 84, align: 'center' },
  { prop: 'process_status', label: '状态', width: 104, align: 'center' },
  { prop: 'worker_name', label: '维修人', width: 120, showOverflowTooltip: true },
  { prop: 'applicant_name', label: '申请人', width: 110 },
  { prop: 'apply_time', label: '申请时间', width: 170 },
  // 操作列宽按最多 3 个图标按钮（派单/驳回/处理/验收 中最多 2 个 + 详情）紧凑适配，详情固定排最右
  { prop: 'operation', label: '操作', width: 150, fixed: 'right', align: 'right' },
])
</script>

<style scoped>
/* ============================================================
   维修工单 · 业务列特化样式
   表格通用皮肤（表头渐变 / 48px 斑马行 / 无网格线 / hover / 圆角分页）
   已统一下沉到 ProTable 组件，此处仅保留本页特有内容
   ============================================================ */

/* 本页不提供排序入口，隐藏排序图标（其他页面排序列不受影响） */
:deep(.el-table .caret-wrapper) {
  display: none;
}

/* 工单号：深蓝加粗 */
:deep(.order-no-cell .cell) {
  color: #214b83;
  font-weight: 600;
}
/* 序号列：加粗 */
:deep(.idx-cell .cell) {
  font-weight: 600;
  color: #264779;
}

/* 来源列：纯文字标识（无胶囊底），告警红 / 巡检蓝 / 人工深灰蓝 */
.src-pill {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
}
.src-pill.is-alarm {
  color: #f03d45;
}
.src-pill.is-inspection {
  color: #176bff;
}
.src-pill.is-maintenance {
  color: #7c3aed;
}
.src-pill.is-manual {
  color: var(--repair-text-primary, #264779);
}

/* ============================================================
   5. 状态胶囊：8px 圆点 + 浅描边 + 柔和投影 + 顶部高光
   ============================================================ */
.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--pill-bd);
  background: var(--pill-bg);
  color: var(--pill-fg);
  font-size: 12px;
  font-weight: 600;
  line-height: 26px;
  white-space: nowrap;
  box-shadow:
    0 3px 9px rgba(35, 78, 130, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
}
/* 待派单：蓝系（对齐 KPI 卡 #3b82f6） */
.status-pill.is-pending_dispatch {
  --pill-bg: #e8f1ff;
  --pill-fg: #176bff;
  --pill-bd: #c9deff;
}
/* 已派发：橙系（对齐 KPI 卡 #f59e0b） */
.status-pill.is-processing {
  --pill-bg: #fff2db;
  --pill-fg: #f59a07;
  --pill-bd: #ffe1af;
}
/* 待验收 */
.status-pill.is-pending_accept {
  --pill-bg: #f2ecff;
  --pill-fg: #8055db;
  --pill-bd: #e0d1ff;
}
/* 已归档 */
.status-pill.is-archived {
  --pill-bg: #e7f8ed;
  --pill-fg: #16a34a;
  --pill-bd: #c3f0d4;
}
/* 已驳回 */
.status-pill.is-rejected {
  --pill-bg: #edf1f6;
  --pill-fg: #78879c;
  --pill-bd: #d9e1eb;
}
/* 未知/空状态：中性灰兜底，避免透明无样式 */
.status-pill.is-unknown {
  --pill-bg: #edf1f6;
  --pill-fg: #78879c;
  --pill-bd: #d9e1eb;
}
</style>

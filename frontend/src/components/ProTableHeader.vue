<!--
  ProTableHeader —— 对齐 art-design-pro 的 ArtTableHeader
  左侧操作按钮插槽，右侧仅保留：下载 Excel / 刷新
  layout 按需开启："export,refresh"
-->
<template>
  <div class="pro-table-header" id="art-table-header">
    <div class="left-wrap">
      <slot name="left" />
    </div>

    <div class="right-wrap">
      <!-- 下载 Excel -->
      <div
        v-if="shouldShow('export') && exportCols.length"
        class="button btn-export"
        title="下载Excel"
        @click="onExport"
      >
        <ArtSvgIcon icon="ri:download-2-line" :style="{ fontSize: '17px' }" />
      </div>

      <!-- 刷新 -->
      <div
        v-if="shouldShow('refresh')"
        class="button btn-refresh"
        :class="{ loading: loading }"
        title="刷新"
        @click="onRefresh"
      >
        <ArtSvgIcon icon="ri:refresh-line" :class="loading ? 'is-spinning' : ''" :style="{ fontSize: '17px' }" />
      </div>

      <slot name="right" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import type { ProColumn } from '@/components/ProTable.vue'
import { exportExcel, type ExportColumn } from '@/utils/exportExcel'

defineOptions({ name: 'ProTableHeader' })

const props = withDefaults(
  defineProps<{
    /** 右侧组件布局 */
    layout?: string
    /** 加载中（刷新图标旋转） */
    loading?: boolean
    /** 导出列配置（缺省时从列配置自动派生） */
    exportColumns?: ExportColumn[]
    /** 导出数据 */
    exportData?: Record<string, any>[]
    /** 导出文件名 */
    exportFilename?: string
  }>(),
  {
    layout: 'export,refresh',
    loading: false,
    exportColumns: () => [],
    exportData: () => [],
    exportFilename: '导出数据',
  },
)

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const columnsModel = defineModel<ProColumn[]>('columns', { default: () => [] })

/* ---------- layout 解析 ---------- */
function shouldShow(name: string) {
  return props.layout.split(',').map((s) => s.trim()).includes(name)
}

/* ---------- 刷新 / 下载 ---------- */
function onRefresh() {
  emit('refresh')
}

/**
 * 导出列：优先使用页面显式传入的 exportColumns；
 * 未传时从列配置自动派生（剔除选择/序号/展开/操作列与隐藏列）
 */
const exportCols = computed<ExportColumn[]>(() => {
  if (props.exportColumns?.length) return props.exportColumns
  return columnsModel.value
    .filter(
      (col) =>
        !!col.prop &&
        !col.type &&
        col.prop !== 'operation' &&
        !col.prop.startsWith('__') &&
        col.visible !== false &&
        col.checked !== false,
    )
    .map((col) => ({
      prop: col.prop!,
      label: col.label || col.prop!,
      // ProColumn.formatter 为 el-table 签名 (row, column, value, index)，适配为导出签名 (row)
      formatter: col.formatter
        ? (row: Record<string, any>) => col.formatter!(row, null, row[col.prop!], 0)
        : undefined,
    }))
})

function onExport() {
  if (!exportCols.value.length || !props.exportData?.length) {
    ElMessage.warning('暂无可导出数据')
    return
  }
  // exportExcel 已改为动态加载 xlsx，返回 Promise
  void exportExcel(exportCols.value, props.exportData, props.exportFilename)
}
</script>

<style lang="scss" scoped>
@use '@styles/core/breakpoints.scss' as bp;
.pro-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;

  .left-wrap {
    display: flex;
    flex-wrap: wrap;
  }

  .right-wrap {
    display: flex;
    align-items: center;
  }
}

.button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: 10px;
  color: var(--art-gray-700);
  cursor: pointer;
  border-radius: 6px;
  /* 对齐参考 ArtTableHeader：bg-g-300/55（透明度混色），hover 换实色 */
  background: color-mix(in srgb, var(--art-gray-300) 55%, transparent);
  transition: background 0.15s;

  &:last-child {
    margin-right: 0;
  }
  &:hover {
    background: var(--art-gray-300);
  }

  &.loading .is-spinning,
  .is-spinning {
    animation: spin 1s linear infinite;
  }
}

/* 下载 Excel：主题蓝 */
.btn-export {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--el-color-primary) 22%, transparent);
  }
}

/* 刷新：成功绿 */
.btn-refresh {
  color: var(--el-color-success);
  background: color-mix(in srgb, var(--el-color-success) 12%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--el-color-success) 22%, transparent);
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@include bp.respond(mobile) {
  .pro-table-header {
    display: block;

    .right-wrap {
      justify-content: flex-end;
      margin-top: 12px;
    }
  }
}
</style>

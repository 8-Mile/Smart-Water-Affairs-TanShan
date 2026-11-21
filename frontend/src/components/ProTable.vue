<!--
  ProTable —— 对齐 art-design-pro 的 ArtTable
  - 配置驱动列（columns）或默认插槽写 el-table-column 均可
  - 分页固定在最底部
  - 拖拽列宽(resizable)、排序(sortable)、斑马纹、边框、尺寸、高度等 el-table 全部配置透传，按需开启
  @example
  <ProTable :data="rows" :loading="loading" :columns="columns" :pagination="{current:page,size:20,total}"
    @page-change="load" @size-change="onSize" @selection-change="onSel" />
-->
<template>
  <div
    ref="rootRef"
    class="pro-table"
    :class="{
      'is-empty': isEmpty,
      'is-auto': autoHeight && !isCompact && !isShort,
      'is-loaded': isLoaded,
    }"
  >
    <!-- 首屏骨架：加载中且尚无数据时占位（表格/卡片两种形态共用），已有数据刷新仍走 v-loading -->
    <div
      v-if="showSkeleton"
      class="pro-skeleton"
      :class="{ 'is-card': cardActive }"
      aria-busy="true"
    >
      <el-skeleton animated>
        <template #template>
          <div class="sk-head">
            <el-skeleton-item v-for="n in 5" :key="n" variant="text" />
          </div>
          <div v-for="r in SKELETON_ROWS" :key="r" class="sk-row">
            <el-skeleton-item v-for="n in 5" :key="n" variant="text" />
          </div>
        </template>
      </el-skeleton>
    </div>

    <!-- 卡片模式（小屏第二形态）：同一份 columns/插槽渲染为卡片列表 -->
    <div v-else-if="cardActive" v-loading="!!loading" class="pro-card-list">
      <template v-if="data.length">
        <div
          v-for="(row, ri) in data"
          :key="rowKeyOf(row, ri)"
          class="pro-card"
          @click="onCardRowClick(row)"
        >
          <div class="pc-head">
            <div class="pc-title">
              <slot
                v-if="titleCol"
                :name="titleCol.prop!"
                v-bind="{ row, $index: ri, prop: titleCol.prop, value: row[titleCol.prop!] }"
                >{{ fmtCell(titleCol, row, ri) }}</slot
              >
            </div>
            <div v-if="hasCardActions" class="pc-actions" :class="{ 'is-multi': cardActionMulti }" @click.stop>
              <!-- 单操作：直接显示图标；多操作：全部收进 ⋮ 下拉（图标+文字） -->
              <div class="pc-actions-inline">
                <slot
                  v-for="c in cardActionCols"
                  :key="c.prop"
                  :name="c.prop!"
                  v-bind="{ row, $index: ri }"
                />
              </div>
              <el-dropdown v-if="cardActionMulti" trigger="click" placement="bottom-end">
                <span class="pc-more-btn">
                  <ArtSvgIcon icon="ri:more-2-fill" />
                </span>
                <template #dropdown>
                  <el-dropdown-menu class="pc-more-menu">
                    <slot
                      v-for="c in cardActionCols"
                      :key="`more-${c.prop}`"
                      :name="c.prop!"
                      v-bind="{ row, $index: ri }"
                    />
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div class="pc-body">
            <div v-for="col in bodyCols" :key="col.prop" class="pc-field">
              <span class="pc-label">{{ col.label }}</span>
              <span class="pc-value">
                <slot
                  :name="col.prop!"
                  v-bind="{ row, $index: ri, prop: col.prop, value: row[col.prop!] }"
                  >{{ fmtCell(col, row, ri) }}</slot
                >
              </span>
            </div>
          </div>
        </div>
      </template>
      <slot v-else name="empty">
        <EmptyState v-if="!loading" description="暂无数据" hint="试试调整筛选条件后重新查询" />
      </slot>
    </div>

    <el-table v-else
      ref="elTableRef"
      v-loading="!!loading"
      :data="data"
      :height="tableHeight"
      :border="tableStore.isBorder"
      :stripe="tableStore.isZebra"
      :size="tableStore.tableSize"
      :row-key="rowKey"
      :header-cell-style="headerCellStyle"
      v-bind="$attrs"
    >
      <!-- 配置驱动列 -->
      <template v-if="visibleColumns.length">
        <el-table-column
          v-for="col in visibleColumns"
          :key="col.prop || col.type"
          v-bind="resolveColProps(col)"
        >
          <!-- 选择列 -->
          <template v-if="col.type === 'globalIndex'" #default="{ $index }">
            <span>{{ getGlobalIndex($index) }}</span>
          </template>

          <!-- 默认插槽列 -->
          <template v-if="hasDefaultSlot(col)" #default="scope">
            <slot :name="col.prop!" v-bind="scope" :prop="col.prop" :value="scope.row[col.prop!]" />
          </template>

          <!-- 表头插槽 -->
          <template v-if="hasHeaderSlot(col)" #header="scope">
            <slot :name="`${col.prop}-header`" v-bind="scope" />
          </template>

          <!-- 展开列 -->
          <template v-if="col.type === 'expand'" #default="scope">
            <slot :name="col.prop || 'expand'" v-bind="scope" />
          </template>
        </el-table-column>
      </template>

      <!-- 默认插槽：直接写 el-table-column -->
      <slot />

      <template #empty>
        <!-- 空态允许外部自定义（如筛选为空时的清除引导），缺省 Hydro 水滴涟漪空态 -->
        <slot name="empty">
          <EmptyState v-if="!loading" description="暂无数据" hint="试试调整筛选条件后重新查询" />
        </slot>
      </template>
    </el-table>

    <!-- 分页（最底部） -->
    <div v-if="pagination" class="pagination-wrap" :class="paginationAlign">
      <el-pagination
        background
        :current-page="innerCurrent"
        :page-size="innerSize"
        :total="pagination.total"
        :page-sizes="pageSizes"
        :pager-count="isCompact ? 5 : 7"
        layout="total, sizes, prev, pager, next"
        @current-change="onCurrentChange"
        @size-change="onSizeChange"
      />
    </div>
  </div>
</template>

<script lang="ts">
export interface ProColumn {
  /** 列类型 */
  type?: 'selection' | 'index' | 'globalIndex' | 'expand'
  /** 字段名（同时是默认插槽名） */
  prop?: string
  /** 表头文字 */
  label?: string
  /** 列宽 */
  width?: string | number
  /** 最小列宽 */
  minWidth?: string | number
  /** 固定列 */
  fixed?: boolean | 'left' | 'right'
  /** 排序：true 前端排序 / 'custom' 后端排序（监听 sort-change） */
  sortable?: boolean | 'custom'
  /** 列宽可拖拽（默认开启） */
  resizable?: boolean
  /** 对齐 */
  align?: 'left' | 'center' | 'right'
  headerAlign?: 'left' | 'center' | 'right'
  /** 内容超出省略并 tooltip */
  showOverflowTooltip?: boolean
  /** 是否显示（列设置面板控制） */
  visible?: boolean
  /** 列设置面板勾选态 */
  checked?: boolean
  /** 列设置面板禁止取消勾选 */
  disabled?: boolean
  /** 格式化 */
  formatter?: (row: any, column: any, value: any, index: number) => string
  className?: string
  labelClassName?: string
  /** 卡片模式：指定为卡片标题字段（不指定则取首个可见文本列） */
  cardTitle?: boolean
  /** 卡片模式：在卡片中隐藏该字段 */
  cardHidden?: boolean
  [key: string]: any
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { useAttrs } from 'vue'
import { useTableStore } from '@/store/table'
import { useBreakpoint } from '@/composables/useBreakpoint'
import EmptyState from '@/components/EmptyState.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'

defineOptions({ name: 'ProTable', inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    data?: any[]
    loading?: boolean
    columns?: ProColumn[]
    pagination?: { current: number; size: number; total: number } | null
    rowKey?: string | ((row: any) => string)
    pageSizes?: number[]
    paginationAlign?: 'left' | 'center' | 'right'
    /** 高度自适应：表格占满卡片剩余高度、表头固定、行区内部滚动，分页贴卡片底部（对齐参考项目高级表格） */
    autoHeight?: boolean
    /** 卡片模式：true 强制卡片 / false 强制表格 / 'auto' ≤768px 自动切卡片（默认） */
    cardMode?: boolean | 'auto'
  }>(),
  {
    data: () => [],
    loading: false,
    columns: () => [],
    pagination: null,
    pageSizes: () => [10, 20, 30, 50, 100],
    paginationAlign: 'center',
    autoHeight: true,
    cardMode: 'auto',
  },
)

const attrs = useAttrs()

const emit = defineEmits<{
  (e: 'page-change', page: number): void
  (e: 'size-change', size: number): void
}>()

const tableStore = useTableStore()
// ElTable 为泛型函数组件，InstanceType 无法正确推导其实例类型，这里放宽为 any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const elTableRef = ref<any>(null)
const parentSlots = useSlots()

/* ---------- 表头背景（对齐 ArtTable） ---------- */
const headerCellStyle = computed(() => ({
  background: tableStore.isHeaderBackground
    ? 'var(--el-fill-color-lighter)'
    : 'var(--default-box-color)',
}))

/* ---------- 列处理 ---------- */
const visibleColumns = computed(() =>
  props.columns.filter((c) => c.visible !== false && c.checked !== false),
)

const COLUMN_PASS_KEYS = [
  'type',
  'prop',
  'label',
  'width',
  'minWidth',
  'fixed',
  'sortable',
  'resizable',
  'align',
  'headerAlign',
  'showOverflowTooltip',
  'formatter',
  'className',
  'labelClassName',
  'selectable',
]

/* ---------- 操作列自适应宽度：按每行实际渲染的按钮数撑开，不再写死列宽 ---------- */
const actionAutoWidth = ref(0)

function resolveColProps(col: ProColumn) {
  const out: Record<string, any> = {}
  for (const k of COLUMN_PASS_KEYS) {
    if (col[k] !== undefined) out[k] = col[k]
  }
  if (col.type === 'globalIndex') {
    delete out.type
    out.label = col.label || '序号'
    out.width = col.width || 60
    out.align = col.align || 'center'
  }
  // 文本列默认单行省略号 + 悬浮标签（可显式设 showOverflowTooltip: false 关闭）
  const isActionCol = col.prop === 'operation' || col.prop === '__actions'
  if (
    out.showOverflowTooltip === undefined &&
    !hasDefaultSlot(col) &&
    !isActionCol &&
    col.type !== 'selection' &&
    col.type !== 'globalIndex' &&
    col.type !== 'expand'
  ) {
    out.showOverflowTooltip = true
  }
  // 默认列宽可拖拽
  if (col.type !== 'selection' && out.resizable === undefined) out.resizable = true
  // 操作列：单元格内容默认贴右对齐（表头保持居中，避免视觉跳动）
  if (isActionCol) {
    // 实测宽度优先：列宽随该页最多按钮数收紧/撑开
    if (actionAutoWidth.value) out.width = actionAutoWidth.value
    if (out.align === undefined) out.align = 'right'
    if (out.headerAlign === undefined) out.headerAlign = 'center'
  }
  return out
}

function hasDefaultSlot(col: ProColumn) {
  return (
    !!col.prop &&
    col.type !== 'globalIndex' &&
    col.type !== 'expand' &&
    !!parentSlots[col.prop]
  )
}
function hasHeaderSlot(col: ProColumn) {
  return !!col.prop && !!parentSlots[`${col.prop}-header`]
}

/* ---------- 分页 ---------- */
const innerCurrent = ref(props.pagination?.current ?? 1)
const innerSize = ref(props.pagination?.size ?? 20)

watch(
  () => props.pagination?.current,
  (v) => {
    if (v != null) innerCurrent.value = v
  },
)
watch(
  () => props.pagination?.size,
  (v) => {
    if (v != null) innerSize.value = v
  },
)

function onCurrentChange(page: number) {
  innerCurrent.value = page
  emit('page-change', page)
}
function onSizeChange(size: number) {
  innerSize.value = size
  // 改变每页条数时回到第一页
  innerCurrent.value = 1
  emit('size-change', size)
  emit('page-change', 1)
}

/* 全局序号（跨分页） */
function getGlobalIndex(index: number) {
  if (!props.pagination) return index + 1
  return (props.pagination.current - 1) * props.pagination.size + index + 1
}

const isEmpty = computed(() => props.data.length === 0)

/* 首屏骨架：仅在「加载中且当前无任何数据」时出现；已有数据的刷新保留原 v-loading 遮罩 */
const SKELETON_ROWS = 6
const showSkeleton = computed(() => !!props.loading && props.data.length === 0)
/* 数据到位且非加载态：内容淡入（不位移） */
const isLoaded = computed(() => !props.loading && props.data.length > 0)

/* ---------- 卡片模式（小屏第二形态） ---------- */
const { isMobile } = useBreakpoint()
const cardActive = computed(() =>
  props.cardMode === 'auto' ? isMobile.value : props.cardMode === true,
)

function isActionsCol(col: ProColumn) {
  return col.prop === '__actions' || col.prop === 'operation' || col.prop === 'detail'
}
/** 操作列集合（卡片右上角统一渲染：业务操作列 + 最右详情列） */
const cardActionCols = computed(() => visibleColumns.value.filter(isActionsCol))
const hasCardActions = computed(() => cardActionCols.value.length > 0)
/**
 * 卡片操作 >1 时全部收进 ⋮ 下拉。
 * 插槽内容是父级传进来的 VNode，无法在渲染期拿到数量，改为渲染后数探针容器的子节点数。
 */
const rootRef = ref<HTMLElement | null>(null)
const cardActionMulti = ref(false)
function syncCardActions() {
  const probe = rootRef.value?.querySelector('.pc-actions-inline')
  // 统计真正的按钮数（页面可能用 action-cell 包裹多个按钮）
  const count = probe ? probe.querySelectorAll('.inline-flex, .el-button, button').length : 0
  cardActionMulti.value = count > 1
}
watch(
  [() => props.data, () => props.loading, cardActive, () => visibleColumns.value.length],
  () => nextTick(syncCardActions),
  { immediate: true },
)

/**
 * 测算操作列需要的宽度：
 * 取每行实际渲染的按钮（含删除确认弹层触发器的 span）总宽 + 按钮间距 + 单元格内边距，
 * 取全表最大值作为列宽，按钮少则列窄、按钮多则列宽，避免固定列宽留下大片空白。
 */
function measureActionWidth() {
  if (cardActive.value) return
  const cells = rootRef.value?.querySelectorAll<HTMLElement>('.action-cell')
  if (!cells || !cells.length) return
  let maxContent = 0
  let pad = 24
  cells.forEach((cell) => {
    const kids = Array.from(cell.children).filter(
      (el) => el.getBoundingClientRect().width > 0,
    ) as HTMLElement[]
    if (!kids.length) return
    const gap = parseFloat(getComputedStyle(cell).columnGap || '0') || 0
    const content =
      kids.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0) + gap * (kids.length - 1)
    if (content > maxContent) {
      maxContent = content
      const td = cell.closest('td')
      // td 宽 - 内容区宽 = 单元格左右内边距（含边框），换主题后依然准确
      const padNow = td ? td.getBoundingClientRect().width - cell.getBoundingClientRect().width : 24
      if (padNow > 0) pad = padNow
    }
  })
  if (!maxContent) return
  // +2 避免亚像素取整后最后一颗按钮贴边被裁
  const next = Math.ceil(maxContent + pad + 2)
  if (Math.abs(next - actionAutoWidth.value) > 0.5) actionAutoWidth.value = next
}
watch(
  [() => props.data, () => props.loading, cardActive],
  () => nextTick(measureActionWidth),
  { immediate: true, flush: 'post' },
)
/** 标题列：显式 cardTitle 优先，缺省取首个非选择/序号/操作的可见列 */
const titleCol = computed(() => {
  const cols = visibleColumns.value
  return (
    cols.find((c) => c.cardTitle && c.prop) ||
    cols.find(
      (c) =>
        c.prop &&
        !isActionsCol(c) &&
        c.type !== 'selection' &&
        c.type !== 'globalIndex' &&
        c.type !== 'index' &&
        c.type !== 'expand',
    )
  )
})
/** 卡片区字段：排除标题/操作/选择/序号/展开与 cardHidden */
const bodyCols = computed(() =>
  visibleColumns.value.filter(
    (c) =>
      c.prop &&
      c !== titleCol.value &&
      !isActionsCol(c) &&
      !c.cardHidden &&
      c.type !== 'selection' &&
      c.type !== 'globalIndex' &&
      c.type !== 'index' &&
      c.type !== 'expand',
  ),
)

function fmtCell(col: ProColumn, row: any, index: number): string {
  const v = col.prop ? row[col.prop] : undefined
  if (col.formatter) return col.formatter(row, col, v, index)
  return v == null || v === '' ? '—' : String(v)
}

function rowKeyOf(row: any, index: number): string {
  if (typeof props.rowKey === 'function') return props.rowKey(row)
  if (props.rowKey) return String(row[props.rowKey])
  return String(index)
}

/* 卡片点击与 el-table row-click 对齐：父级 @row-click 经 $attrs 透传，卡片模式手动回调 */
function onCardRowClick(row: any) {
  const fn = attrs.onRowClick as ((row: any, column?: any, event?: any) => void) | undefined
  fn?.(row)
}

/* ---------- 高度自适应（对齐参考项目 art-design-pro 高级表格） ---------- */
// 小屏（≤640px）恢复整页滚动，不强制表格内部高度
const isCompact = ref(false)
let compactMq: MediaQueryList | null = null
function syncCompact(e: MediaQueryListEvent | MediaQueryList) {
  isCompact.value = e.matches
}
// 短视口（高度 ≤720px）：固定表头会把剩余高度压成 0，退化为自然高度 + 整页滚动
const isShort = ref(false)
let shortMq: MediaQueryList | null = null
function syncShort(e: MediaQueryListEvent | MediaQueryList) {
  isShort.value = e.matches
}
onMounted(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  compactMq = window.matchMedia('(max-width: 640px)')
  syncCompact(compactMq)
  compactMq.addEventListener('change', syncCompact)
  shortMq = window.matchMedia('(max-height: 720px)')
  syncShort(shortMq)
  shortMq.addEventListener('change', syncShort)
})
onBeforeUnmount(() => {
  compactMq?.removeEventListener('change', syncCompact)
  shortMq?.removeEventListener('change', syncShort)
})
// 显式传入的 height（$attrs）优先级最高；自适应时给 el-table '100%' 启用固定表头+内部滚动
const tableHeight = computed<string | number | undefined>(() => {
  if (attrs.height !== undefined) return attrs.height as string | number
  if (props.autoHeight && !isCompact.value && !isShort.value) return '100%'
  return undefined
})

defineExpose({
  elTableRef,
  clearSelection: () => elTableRef.value?.clearSelection(),
  toggleRowSelection: (row: any, selected?: boolean) =>
    elTableRef.value?.toggleRowSelection(row, selected),
  setScrollTop: (v: number) => elTableRef.value?.setScrollTop(v),
})
</script>

<style lang="scss" scoped>
.pro-table {
  display: flex;
  flex-direction: column;

  /* 自适应模式：占满卡片剩余高度，el-table 内部滚动，分页贴底 */
  &.is-auto {
    flex: 1 1 auto;
    min-height: 0;

    :deep(.el-table) {
      flex: 1 1 auto;
      min-height: 0;
      margin-top: 10px;
    }
  }

  /* 自然高度模式（autoHeight=false 或小屏）：表格随内容撑高，整页滚动 */
  &:not(.is-auto) {
    flex: 0 0 auto;

    :deep(.el-table) {
      margin-top: 10px;
    }
  }

  :deep(.el-loading-mask) {
    z-index: 100;
    background-color: var(--default-box-color);
  }

  /* ===== 首屏骨架：与真实表格同结构（表头 + N 行），高度撑满剩余区域 ===== */
  .pro-skeleton {
    flex: 1 1 auto;
    min-height: 0;
    margin-top: 10px;
    padding: 4px 2px;
    overflow: hidden;

    :deep(.el-skeleton) {
      height: 100%;
    }
    :deep(.el-skeleton__item) {
      height: 14px;
      margin: 0;
      border-radius: 6px;
    }
    .sk-head,
    .sk-row {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
      gap: 12px;
      align-items: center;
      padding: 0 4px;
    }
    .sk-head {
      height: 40px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(55, 135, 220, 0.12);
    }
    .sk-row {
      height: 48px;
    }
    /* 卡片形态（小屏）：堆叠卡片骨架 */
    &.is-card {
      .sk-head {
        display: none;
      }
      .sk-row {
        grid-template-columns: 1fr 1fr;
        height: 84px;
        margin-bottom: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.78) 0%,
          rgba(238, 247, 255, 0.72) 100%
        );
      }
    }
  }

  /* ===== 数据到位：行/卡片逐条错峰入场 =====
     前 12 条按 28ms 递进延迟，第 13 条起统一在 308ms 后出现（避免超长列表拖尾）。
     仅动 opacity/transform；is-loaded 随 loading 重置，每次刷新自然重放。 */
  &.is-loaded :deep(.el-table__body tbody tr),
  &.is-loaded .pro-card-list .pro-card {
    animation: pro-row-in var(--motion-base) var(--ease-standard) both;
  }
  @for $i from 1 through 12 {
    &.is-loaded :deep(.el-table__body tbody tr:nth-child(#{$i})),
    &.is-loaded .pro-card-list .pro-card:nth-child(#{$i}) {
      animation-delay: #{($i - 1) * 28}ms;
    }
  }
  &.is-loaded :deep(.el-table__body tbody tr:nth-child(n + 13)),
  &.is-loaded .pro-card-list .pro-card:nth-child(n + 13) {
    animation-delay: 308ms;
  }
  @media (prefers-reduced-motion: reduce) {
    &.is-loaded :deep(.el-table__body tbody tr),
    &.is-loaded .pro-card-list .pro-card {
      animation: none;
    }
  }

  /* ===== 卡片模式（小屏第二形态）：同框架磨砂卡，字段双列自适应 ===== */
  .pro-card-list {
    flex: 1 1 auto;
    min-height: 0;
    margin-top: 10px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;

    .pro-card {
      flex: 0 0 auto;
      padding: 12px 14px;
      border-radius: 12px;
      background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.78) 0%,
        rgba(238, 247, 255, 0.72) 100%
      );
      -webkit-backdrop-filter: blur(14px) saturate(1.5);
      backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
    }
    .pc-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(55, 135, 220, 0.12);
    }
    .pc-title {
      min-width: 0;
      color: #1b2a3d;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.5;
      word-break: break-all;
    }
    .pc-actions {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
    }
    .pc-actions-inline {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    /* 多操作：内联图标全部隐藏，只留一个 ⋮ 触发下拉 */
    .pc-actions.is-multi .pc-actions-inline {
      display: none;
    }
    .pc-more-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      background: rgb(59 130 246 / 12%);
      color: #3b82f6;
      font-size: 16px;
      cursor: pointer;
      outline: none;
    }
    /* 卡片右上操作：小屏只保留图标形态，收紧尺寸避免一行放不下挤掉标题 */
    .pc-actions :deep(.inline-flex) {
      width: 26px;
      height: 26px;
      min-width: 26px;
      margin-right: 0;
      padding: 0;
      font-size: 14px;
    }
    .pc-body {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 6px 12px;
    }
    .pc-field {
      display: flex;
      min-width: 0;
      font-size: 12px;
      line-height: 1.6;
    }
    .pc-label {
      flex-shrink: 0;
      color: var(--art-gray-500, #8a97ab);

      &::after {
        content: '：';
      }
    }
    .pc-value {
      min-width: 0;
      overflow: hidden;
      color: #264779;
      text-overflow: ellipsis;
    }
  }

  /* 固定列不透明背景已在全局 styles/index.css 中定义 */

  &.is-empty {
    :deep(.el-scrollbar__wrap) {
      display: flex;
    }
  }

  .pagination-wrap {
    display: flex;
    margin-top: 13px;

    &.left {
      justify-content: flex-start;
    }
    &.center {
      justify-content: center;
    }
    &.right {
      justify-content: flex-end;
    }

    :deep(.el-pagination .el-select) {
      width: 110px;
    }

    /* 小屏简易分页（≤768px）：隐藏「每页条数」选择器，总数+翻页允许折行，避免挤兑错乱 */
    @media only screen and (max-width: 768px) {
      :deep(.el-pagination__sizes),
      :deep(.el-pagination .el-select) {
        display: none;
      }
      :deep(.el-pagination) {
        flex-wrap: wrap;
        row-gap: 8px;
        justify-content: center;
      }
    }
  }
}

/* ============================================================
   统一运维风表格皮肤（维修工单设计稿基线，全 ProTable 通用）
   表头蓝渐变 / 48px 圆角斑马行 / 无网格线 / hover 浅蓝 / 8px 圆角分页
   注意：.screen-mode（SCADA 深色大屏）整体避让，保持大屏自有深色皮肤；
        row-focus（跨页定位高亮行）从斑马/hover 规则中排除，交由全局高亮规则；
        排序 caret 不在此隐藏（告警/设备等页面有排序列）。
   ============================================================ */
.pro-table:not(:where(.screen-mode *)) {
  /* 1. 去外边框与单元格分割线，注入统一色板 token */
  :deep(.el-table) {
    --el-table-border-color: transparent;
    --el-table-border: none;
    --el-table-text-color: #264779;
    --el-table-header-text-color: #214b83;
    --el-table-row-hover-bg-color: #e6f2ff;
    background: transparent;
    border: none !important;
  }
  :deep(.el-table::before),
  :deep(.el-table::after),
  :deep(.el-table--border::after),
  :deep(.el-table__inner-wrapper::before) {
    display: none !important;
  }
  :deep(.el-table__inner-wrapper),
  :deep(.el-table__header-wrapper),
  :deep(.el-table__body-wrapper) {
    background: transparent;
  }
  :deep(.el-table th.el-table__cell),
  :deep(.el-table td.el-table__cell) {
    border-right: none !important;
    border-bottom: none !important;
  }
  :deep(.el-table__fixed-right-patch),
  :deep(.el-table td.el-table__cell.is-first-column) {
    box-shadow: none;
  }

  /* 2. 表头：连续渐变挂 tr，th 透明（同时压过 headerCellStyle 内联底色） */
  :deep(.el-table__header-wrapper thead tr) {
    background: linear-gradient(180deg, #edf6fe 0%, #dfeefe 100%);
  }
  :deep(.el-table__header-wrapper th.el-table__cell) {
    height: 48px;
    padding: 0 !important;
    background: transparent !important;
    color: #214b83;
    font-size: 13px;
    font-weight: 600;
    position: relative;
  }
  :deep(.el-table__header-wrapper .cell) {
    line-height: 20px;
  }
  :deep(.el-table__header-wrapper th.el-table__cell:first-child) {
    border-radius: 10px 0 0 10px;
  }
  :deep(.el-table__header-wrapper th.el-table__cell:last-child) {
    border-radius: 0 10px 10px 0;
  }
  /* 首列表头左侧 3px 蓝色强调竖线 */
  :deep(.el-table__header-wrapper th.el-table__cell:first-child)::before {
    content: '';
    position: absolute;
    left: 6px;
    top: 50%;
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: #166dfe;
    transform: translateY(-50%);
  }

  /* 3. 数据行：48px、13px、#264779、斑马纹、行首尾 8px 圆角 */
  :deep(.el-table__body tr) {
    height: 48px;
  }
  :deep(.el-table__body tr:not(.row-focus) > td.el-table__cell) {
    height: 48px;
    padding: 0 !important;
    font-size: 13px;
    color: #264779;
    background: #fbfcfe !important;
  }
  :deep(.el-table__body .cell) {
    line-height: 22px;
  }
  :deep(.el-table__body tr.el-table__row--striped:not(.row-focus) > td.el-table__cell),
  :deep(.el-table__body tr:nth-child(even):not(.row-focus) > td.el-table__cell) {
    background: #f1f7fe !important;
  }
  :deep(.el-table__body tr:hover:not(.row-focus) > td.el-table__cell),
  :deep(.el-table__body tr.hover-row:not(.row-focus) > td.el-table__cell) {
    background: #e6f2ff !important;
  }
  /* 选中行（如详情抽屉打开期间持续高亮，压过斑马纹/hover） */
  :deep(.el-table__body tr.row-selected.row-selected > td.el-table__cell),
  :deep(.el-table__body tr.row-selected.row-selected:hover > td.el-table__cell),
  :deep(.el-table__body tr.row-selected.row-selected.hover-row > td.el-table__cell) {
    background: #dcebff !important;
  }
  :deep(.el-table__body tr.row-selected > td.el-table__cell:first-child) {
    box-shadow: inset 3px 0 0 #166dfe;
  }
  :deep(.el-table__body td.el-table__cell:first-child) {
    border-radius: 8px 0 0 8px;
  }
  :deep(.el-table__body td.el-table__cell:last-child) {
    border-radius: 0 8px 8px 0;
  }

  /* 4. 旧版克隆固定列模式兜底（本项目主要走 sticky） */
  :deep(.el-table__fixed-right-wrapper thead tr),
  :deep(.el-table__fixed-left-wrapper thead tr) {
    background: linear-gradient(180deg, #edf6fe 0%, #dfeefe 100%);
  }
  :deep(.el-table__fixed-right-wrapper th.el-table__cell),
  :deep(.el-table__fixed-left-wrapper th.el-table__cell) {
    background: transparent !important;
  }

  /* 5. 分页：当前页蓝实心，其余浅蓝白，8px 圆角；整体靠右，内容紧挨 */
  .pagination-wrap {
    justify-content: flex-end !important;
    :deep(.el-pagination) {
      --el-pagination-button-color: #264779;
      --el-pagination-hover-color: #166dfe;
      font-weight: 500;
      /* 内容紧挨，整体随容器靠右 */
      display: flex;
      width: auto;
      justify-content: flex-start;
    }
    :deep(.el-pagination .el-pager) {
      margin-left: 12px;
    }
    :deep(.el-pagination__total),
    :deep(.el-pagination__jump) {
      color: #7987a1;
      font-size: 13px;
    }
    :deep(.el-pagination .btn-prev),
    :deep(.el-pagination .btn-next),
    :deep(.el-pagination .el-pager li) {
      min-width: 32px;
      height: 32px;
      margin: 0 3px;
      border-radius: 8px;
      background: #f2f7fe;
      border: 1px solid transparent;
      color: #264779;
      font-size: 13px;
      transition: all 0.15s ease;
    }
    :deep(.el-pagination .el-pager li:hover),
    :deep(.el-pagination .btn-prev:hover),
    :deep(.el-pagination .btn-next:hover) {
      color: #166dfe;
      background: #e4efff;
    }
    :deep(.el-pagination .el-pager li.is-active) {
      background: #166dfe;
      color: #fff;
      border-color: #166dfe;
      box-shadow: 0 4px 10px -3px rgba(22, 109, 254, 0.45);
    }
    :deep(.el-pagination .el-pager li.is-active:hover) {
      color: #fff;
      background: #166dfe;
    }
    :deep(.el-pagination button:disabled) {
      background: #f2f7fe;
      opacity: 0.55;
    }
  }
}

@keyframes pro-row-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

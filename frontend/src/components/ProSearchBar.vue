<!--
  ProSearchBar —— 对齐 art-design-pro 的 ArtSearchBar
  配置驱动的表格筛选区：常用表单组件、render 自定义组件、插槽、校验、收起/展开
  @example
  <ProSearchBar v-model="query" :items="items" @search="load" @reset="load" />
-->
<template>
  <section class="pro-search-bar art-card-xs" :class="{ 'is-expanded': isExpanded }">
    <el-form ref="formRef" :model="modelValue" :label-position="labelPosition" v-bind="formAttrs">
      <el-row :gutter="gutter">
        <el-col
          v-for="item in visibleFormItems"
          :key="item.key"
          :xs="getColSpan(item.span, 'xs')"
          :sm="getColSpan(item.span, 'sm')"
          :md="getColSpan(item.span, 'md')"
          :lg="getColSpan(item.span, 'lg')"
          :xl="getColSpan(item.span, 'xl')"
        >
          <el-form-item :prop="item.key" :label-width="item.label ? item.labelWidth || labelWidth : undefined">
            <template #label v-if="item.label">
              <component v-if="typeof item.label !== 'string'" :is="item.label" />
              <span v-else>{{ item.label }}</span>
            </template>

            <!-- 具名插槽优先级最高 -->
            <slot :name="item.key" :item="item" :modelValue="modelValue">
              <component :is="getComponent(item)" v-model="modelValue[item.key]" v-bind="getProps(item)">
                <!-- 下拉选择 -->
                <template v-if="item.type === 'select' && getProps(item)?.options">
                  <el-option
                    v-for="option in getProps(item).options"
                    v-bind="option"
                    :key="option.value"
                  />
                </template>

                <!-- 复选框组 -->
                <template v-if="item.type === 'checkboxgroup' && getProps(item)?.options">
                  <el-checkbox v-for="option in getProps(item).options" v-bind="option" :key="option.value" />
                </template>

                <!-- 单选框组 -->
                <template v-if="item.type === 'radiogroup' && getProps(item)?.options">
                  <el-radio v-for="option in getProps(item).options" v-bind="option" :key="option.value" />
                </template>

                <!-- 动态插槽 -->
                <template v-for="(slotFn, slotName) in getSlots(item)" :key="slotName" #[slotName]>
                  <component :is="slotFn" />
                </template>
              </component>
            </slot>
          </el-form-item>
        </el-col>

        <!-- 操作按钮列 -->
        <el-col :xs="24" :sm="24" :md="span" :lg="span" :xl="span" class="action-column">
          <div class="action-buttons-wrapper" :style="actionButtonsStyle">
            <div class="form-buttons">
              <el-button v-if="showReset" @click="handleReset">
                <ArtSvgIcon icon="ri:refresh-line" class="btn-icon" />重置
              </el-button>
              <el-button
                v-if="showSearch"
                type="primary"
                :disabled="disabledSearch"
                @click="handleSearch"
              >
                <ArtSvgIcon icon="ri:search-line" class="btn-icon" />查询
              </el-button>
            </div>
            <div v-if="shouldShowExpandToggle" class="filter-toggle" @click="toggleExpand">
              <span>{{ isExpanded ? '收起' : '展开' }}</span>
              <div class="icon-wrapper">
                <ArtSvgIcon
                  :icon="isExpanded ? 'ri:arrow-up-s-fill' : 'ri:arrow-down-s-fill'"
                  :style="{ fontSize: '16px' }"
                />
              </div>
            </div>
          </div>
        </el-col>
      </el-row>
    </el-form>
  </section>
</template>

<script lang="ts">
export interface SearchFormItem {
  /** 字段唯一标识 */
  key: string
  /** 标签文本或自定义渲染 */
  label?: string | (() => any) | any
  /** 标签宽度，覆盖整体 labelWidth */
  labelWidth?: string | number
  /** 组件类型 */
  type?: string
  /** 自定义渲染（优先级高于 type） */
  render?: (() => any) | any
  /** 是否隐藏 */
  hidden?: boolean
  /** 栅格占位（24 制） */
  span?: number
  /** 透传给组件的属性，选项放 props.options */
  props?: Record<string, any>
  /** 组件插槽 */
  slots?: Record<string, (() => any) | undefined>
  placeholder?: string
  [key: string]: any
}
</script>

<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import type { Component, VNode } from 'vue'
import {
  ElCascader,
  ElCheckbox,
  ElCheckboxGroup,
  ElDatePicker,
  ElForm,
  ElInput,
  ElInputNumber,
  ElInputTag,
  ElRadioGroup,
  ElRate,
  ElSelect,
  ElSlider,
  ElSwitch,
  ElTimePicker,
  ElTimeSelect,
  ElTreeSelect,
  type FormInstance,
} from 'element-plus'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'

defineOptions({ name: 'ProSearchBar', inheritAttrs: false })

const componentMap = {
  input: ElInput,
  inputTag: ElInputTag,
  number: ElInputNumber,
  select: ElSelect,
  switch: ElSwitch,
  checkbox: ElCheckbox,
  checkboxgroup: ElCheckboxGroup,
  radiogroup: ElRadioGroup,
  date: ElDatePicker,
  daterange: ElDatePicker,
  datetime: ElDatePicker,
  datetimerange: ElDatePicker,
  rate: ElRate,
  slider: ElSlider,
  cascader: ElCascader,
  timepicker: ElTimePicker,
  timeselect: ElTimeSelect,
  treeselect: ElTreeSelect,
} as const

const props = withDefaults(
  defineProps<{
    items: SearchFormItem[]
    /** 每项默认列宽 */
    span?: number
    gutter?: number
    defaultExpanded?: boolean
    labelPosition?: 'left' | 'right' | 'top'
    labelWidth?: string | number
    showExpand?: boolean
    showReset?: boolean
    showSearch?: boolean
    disabledSearch?: boolean
    /** 项数小于等于该值时按钮靠左 */
    buttonLeftLimit?: number
  }>(),
  {
    span: 6,
    gutter: 12,
    defaultExpanded: false,
    labelPosition: 'right',
    labelWidth: '70px',
    showExpand: true,
    showReset: true,
    showSearch: true,
    disabledSearch: false,
    buttonLeftLimit: 2,
  },
)

const emit = defineEmits<{
  (e: 'search', params: Record<string, any>): void
  (e: 'reset', params: Record<string, any>): void
}>()

const modelValue = defineModel<Record<string, any>>({ default: () => ({}) })
const formRef = ref<FormInstance>()
const attrs = useAttrs()
const formAttrs = computed(() => ({ ...attrs }))

/* ---------- 展开/收起 ---------- */
const isExpanded = ref(props.defaultExpanded)

/* ---------- 属性与插槽 ---------- */
const ROOT_PROP_KEYS = ['label', 'labelWidth', 'key', 'type', 'hidden', 'span', 'slots']

function getProps(item: SearchFormItem) {
  if (item.props) return item.props
  const out = { ...item }
  ROOT_PROP_KEYS.forEach((k) => delete (out as Record<string, any>)[k])
  return out
}

function getSlots(item: SearchFormItem) {
  if (!item.slots) return {}
  const valid: Record<string, () => any> = {}
  Object.entries(item.slots).forEach(([key, fn]) => {
    if (fn) valid[key] = fn
  })
  return valid
}

/* ---------- 响应式 span ---------- */
function getColSpan(itemSpan: number | undefined, bp: 'xs' | 'sm' | 'md' | 'lg' | 'xl'): number {
  const finalSpan = itemSpan ?? props.span
  if (bp === 'xs') return finalSpan >= 12 ? finalSpan : 24
  if (bp === 'sm') return finalSpan >= 12 ? finalSpan : 12
  if (bp === 'md') return finalSpan >= 8 ? finalSpan : 8
  return finalSpan
}

/* ---------- 组件选择 ---------- */
function getComponent(item: SearchFormItem) {
  if (item.render) return item.render
  return componentMap[item.type as keyof typeof componentMap] || componentMap.input
}

/* ---------- 可见项与展开按钮 ---------- */
const allVisibleItems = computed(() => props.items.filter((i) => !i.hidden))

const visibleFormItems = computed(() => {
  if (isExpanded.value) return allVisibleItems.value
  const maxItemsPerRow = Math.floor(24 / props.span) - 1
  return allVisibleItems.value.slice(0, maxItemsPerRow)
})

const shouldShowExpandToggle = computed(
  () =>
    props.showExpand && allVisibleItems.value.length > Math.floor(24 / props.span) - 1,
)

const actionButtonsStyle = computed(() => ({
  justifyContent: allVisibleItems.value.length <= props.buttonLeftLimit ? 'flex-start' : 'flex-end',
}))

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

/* ---------- 重置/查询 ---------- */
function handleReset() {
  formRef.value?.resetFields()
  Object.assign(
    modelValue.value,
    Object.fromEntries(props.items.map(({ key }) => [key, undefined])),
  )
  emit('reset', modelValue.value)
}

function handleSearch() {
  formRef.value?.validate((valid) => {
    if (valid) emit('search', modelValue.value)
  })
}

defineExpose({
  formRef,
  validate: (...args: any[]) => formRef.value?.validate(...args),
  reset: handleReset,
})
</script>

<style lang="scss" scoped>
@use '@styles/core/breakpoints.scss' as bp;
.pro-search-bar {
  padding: 15px 20px 0;

  /* 搜索栏字体：label 文本 + 输入值用黑色（placeholder 保持默认灰） */
  :deep(.el-form-item__label),
  :deep(.el-form-item__label span) {
    color: #000;
  }
  :deep(.el-input__inner) {
    color: #000;
  }

  .action-column {
    flex: 1;
    max-width: 100%;

    .action-buttons-wrapper {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      margin-bottom: 12px;
    }

    .form-buttons {
      display: flex;
      gap: 8px;

      .btn-icon {
        margin-right: 4px;
        font-size: 15px;
        vertical-align: -2px;
      }
    }

    .filter-toggle {
      display: flex;
      align-items: center;
      margin-left: 10px;
      line-height: 32px;
      color: var(--theme-color);
      cursor: pointer;

      span {
        font-size: 14px;
        user-select: none;
      }

      .icon-wrapper {
        display: flex;
        align-items: center;
        margin-left: 4px;
        font-size: 14px;
        transition: transform 0.2s ease;
      }
    }
  }
}

@include bp.respond(mobile) {
  .pro-search-bar {
    padding: 16px 16px 0;

    .action-column {
      .action-buttons-wrapper {
        flex-direction: column;
        gap: 8px;
        align-items: stretch;

        .form-buttons {
          justify-content: center;
        }

        .filter-toggle {
          justify-content: center;
          margin-left: 0;
        }
      }
    }
  }
}
</style>

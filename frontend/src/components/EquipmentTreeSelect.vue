<template>
  <el-tree-select
    v-model="_value"
    :data="treeData"
    :props="treeProps"
    node-key="id"
    :multiple="multiple"
    check-strictly
    :filterable="filterable"
    :clearable="clearable"
    :placeholder="placeholder"
    :disabled="disabled"
    default-expand-all
    :render-after-expand="false"
    style="width: 100%"
  >
    <template #prefix>
      <span class="field-badge"><ArtSvgIcon icon="ri:cpu-line" /></span>
    </template>
  </el-tree-select>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import http from '@/api/http'
import type { ApiResponse } from '@/api/types'

/** 设备下拉项（/equipment/options 返回结构） */
interface EquipmentOption {
  id: number
  name: string
  code?: string
  parent_id?: number | null
  children?: EquipmentOption[]
}

const props = withDefaults(
  defineProps<{
    modelValue?: number | number[] | null
    /** 已加载的扁平设备列表；不传则组件自行拉取完整树 */
    options?: EquipmentOption[]
    multiple?: boolean
    filterable?: boolean
    clearable?: boolean
    disabled?: boolean
    placeholder?: string
  }>(),
  {
    modelValue: null,
    options: undefined,
    multiple: false,
    filterable: true,
    clearable: true,
    disabled: false,
    placeholder: '请选择设备',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number | number[] | null] }>()

const _value = computed({
  get: () => props.modelValue ?? (props.multiple ? [] : undefined),
  set: (v) => emit('update:modelValue', (v ?? null) as number | number[] | null),
})

const remote = ref<EquipmentOption[]>([])
const treeProps = {
  label: (d: EquipmentOption) => (d.code ? `${d.name}（${d.code}）` : d.name),
  children: 'children',
}

/** 扁平列表按 parent_id 组装成树；父节点不在集合内时作为顶级 */
function buildTree(flat: EquipmentOption[]): EquipmentOption[] {
  const byId = new Map<number, EquipmentOption>()
  for (const item of flat) byId.set(item.id, { ...item, children: [] })
  const roots: EquipmentOption[] = []
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    if (parent) parent.children!.push(node)
    else roots.push(node)
  }
  return roots
}

const treeData = computed(() => buildTree(props.options ?? remote.value))

watch(
  () => props.options,
  (v) => {
    if (!v) void load()
  },
)

async function load() {
  try {
    const { data } = await http.get<ApiResponse<EquipmentOption[]>>('/equipment/options')
    remote.value = data.data || []
  } catch {
    remote.value = []
  }
}

onMounted(() => {
  if (!props.options) void load()
})
</script>

<style scoped>
.field-badge {
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-secondary);
}
</style>

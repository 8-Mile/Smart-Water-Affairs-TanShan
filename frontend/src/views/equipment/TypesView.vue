<template>
  <SimpleCrud
    api-path="/equipment-types"
    :columns="columns"
    :fields="fields"
    create-text="新增分类"
    search-placeholder="分类名称"
    search-param="keyword"
    write-role="perm"
    :write-perms="{ create: 'eq:type:create', update: 'eq:type:update', delete: 'eq:type:delete' }"
  />
</template>

<script setup lang="ts">
import SimpleCrud, { type CrudColumn, type CrudField } from '@/components/SimpleCrud.vue'

const columns: CrudColumn[] = [
  { prop: 'name', label: '分类名称' },
  { prop: 'code', label: '分类代码' },
  { prop: 'description', label: '描述' },
  { prop: 'status', label: '状态', width: 90 },
]

const fields: CrudField[] = [
  { prop: 'name', label: '分类名称', required: true, icon: 'ri:price-tag-3-line' },
  { prop: 'code', label: '分类代码', required: true, icon: 'ri:code-s-slash-line' },
  { prop: 'description', label: '描述', type: 'textarea', icon: 'ri:file-text-line' },
  { prop: 'status', label: '状态', type: 'status', required: true },
]
</script>

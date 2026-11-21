<template>
  <SimpleCrud
    api-path="/system/locations"
    :columns="columns"
    :fields="fields"
    search-placeholder="位置名称/编码"
    write-role="perm"
    :write-perms="{ create: 'sys:dept:create', update: 'sys:dept:update', delete: 'sys:dept:delete' }"
  />
</template>

<script setup lang="ts">
import SimpleCrud, { type CrudColumn, type CrudField } from '@/components/SimpleCrud.vue'

const columns: CrudColumn[] = [
  { prop: 'name', label: '位置名称' },
  { prop: 'code', label: '位置编码' },
  { prop: 'remark', label: '备注' },
  { prop: 'status', label: '状态', width: 90 },
]

const fields: CrudField[] = [
  { prop: 'name', label: '位置名称', required: true },
  { prop: 'code', label: '位置编码', required: true },
  { prop: 'remark', label: '备注', type: 'textarea' },
  { prop: 'status', label: '状态', type: 'status', required: true },
]
</script>

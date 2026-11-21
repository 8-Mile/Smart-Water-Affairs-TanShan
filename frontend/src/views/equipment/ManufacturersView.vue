<template>
  <SimpleCrud
    api-path="/manufacturers"
    title="生产厂商"
    :columns="columns"
    :fields="fields"
    :show-count="false"
    search-placeholder="厂商名称"
    write-role="perm"
    :write-perms="{ create: 'eq:mfr:create', update: 'eq:mfr:update', delete: 'eq:mfr:delete' }"
  />
</template>

<script setup lang="ts">
import SimpleCrud, { type CrudColumn, type CrudField } from '@/components/SimpleCrud.vue'

const columns: CrudColumn[] = [
  { prop: 'name', label: '厂商名称' },
  { prop: 'enterprise_code', label: '企业代码' },
  { prop: 'contact_name', label: '联系人' },
  { prop: 'contact_phone', label: '联系电话' },
  { prop: 'address', label: '地址' },
  { prop: 'status', label: '状态', width: 90 },
]

const fields: CrudField[] = [
  { prop: 'name', label: '厂商名称', required: true },
  { prop: 'enterprise_code', label: '企业代码' },
  { prop: 'contact_name', label: '联系人' },
  { prop: 'contact_phone', label: '联系电话' },
  { prop: 'address', label: '地址' },
  { prop: 'remark', label: '备注', type: 'textarea' },
  { prop: 'status', label: '状态', type: 'status', required: true },
]
</script>

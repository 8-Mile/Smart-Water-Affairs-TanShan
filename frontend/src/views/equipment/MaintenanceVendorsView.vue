<template>
  <div class="page mod-asset">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="维保厂商" name="maint">
        <SimpleCrud
          api-path="/maintenance-vendors"
          title="维保厂商"
          :columns="columns"
          :fields="fields"
          :show-count="false"
          search-placeholder="厂商名称"
          write-role="perm"
          :write-perms="{ create: 'eq:maintainer:create', update: 'eq:maintainer:update', delete: 'eq:maintainer:delete' }"
        />
      </el-tab-pane>
      <el-tab-pane label="生产厂商" name="makers" lazy>
        <ManufacturersView />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SimpleCrud, { type CrudColumn, type CrudField } from '@/components/SimpleCrud.vue'
import ManufacturersView from './ManufacturersView.vue'

const activeTab = ref('maint')

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

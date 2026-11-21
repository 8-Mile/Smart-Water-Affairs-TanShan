<template>
  <div class="page mod-system">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="部门管理" name="dept">
  <SimpleCrud
    api-path="/system/departments"
    title="部门管理"
    :columns="columns"
    :fields="fields"
    search-placeholder="部门名称/编码"
    write-role="perm"
    :write-perms="{ create: 'sys:dept:create', update: 'sys:dept:update', delete: 'sys:dept:delete' }"
  />
      </el-tab-pane>
      <el-tab-pane label="班组管理" name="teams" lazy>
        <TeamsView />
      </el-tab-pane>
      <el-tab-pane label="位置管理" name="locations" lazy>
        <LocationsView />
      </el-tab-pane>
      <el-tab-pane label="机组管理" name="units" lazy>
        <UnitsView />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SimpleCrud, { type CrudColumn, type CrudField } from '@/components/SimpleCrud.vue'
import TeamsView from './TeamsView.vue'
import LocationsView from './LocationsView.vue'
import UnitsView from './UnitsView.vue'

const activeTab = ref('dept')

const columns: CrudColumn[] = [
  { prop: 'name', label: '部门名称' },
  { prop: 'code', label: '部门编码' },
  { prop: 'remark', label: '备注' },
  { prop: 'status', label: '状态', width: 90 },
]

const fields: CrudField[] = [
  { prop: 'name', label: '部门名称', required: true },
  { prop: 'code', label: '部门编码', required: true },
  { prop: 'remark', label: '备注', type: 'textarea' },
  { prop: 'status', label: '状态', type: 'status', required: true },
]
</script>

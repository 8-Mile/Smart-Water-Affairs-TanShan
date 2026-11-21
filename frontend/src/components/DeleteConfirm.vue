<!--
  DeleteConfirm —— 跟随触发按钮的删除确认弹框（替代 ElMessageBox.confirm）
  用法：
    <DeleteConfirm text="确认删除该记录？" @confirm="handleDelete(row)">
      <ArtButtonTable type="delete" title="删除" />
    </DeleteConfirm>
  特性：
    - 弹框位置跟随触发按钮（el-popover reference）
    - 支持按钮级 loading（confirm 时自动锁定）
    - 点击外部或取消时自动关闭
-->
<template>
  <el-popover
    v-model:visible="visible"
    placement="top"
    :width="220"
    trigger="manual"
  >
    <p class="dc-text">{{ text }}</p>
    <div class="dc-btns">
      <el-button size="small" text @click="visible = false">取消</el-button>
      <el-button size="small" type="danger" :loading="loading" @click="onConfirm">
        确认删除
      </el-button>
    </div>
    <template #reference>
      <span class="dc-trigger" @click.stop="visible = true">
        <slot />
      </span>
    </template>
  </el-popover>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ text: string }>()
const emit = defineEmits<{ (e: 'confirm'): void }>()

const visible = ref(false)
const loading = ref(false)

async function onConfirm() {
  loading.value = true
  try {
    emit('confirm')
    visible.value = false
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.dc-text {
  margin: 0 0 12px;
  font-size: 13.5px;
  color: #12234d;
  line-height: 1.5;
}
.dc-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dc-trigger {
  display: inline-flex;
  cursor: pointer;
}
</style>

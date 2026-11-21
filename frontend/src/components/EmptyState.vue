<!-- ============================================================
  空状态（暂无数据）：统一的空表/空内容占位组件
  - 居中插图（noData.png）+ 描述 + 提示 + 可选操作按钮（slot）
  - 用于 ProTable 空态与各类列表/卡片空白区域
============================================================ -->
<template>
  <div class="empty-state">
    <!-- 空态插图 -->
    <img class="illus" :src="noDataImg" alt="暂无数据" />

    <!-- 描述与提示文案 -->
    <p class="desc">{{ description }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>

    <!-- 操作区（可选，如“清除筛选条件”） -->
    <div v-if="$slots.default" class="action">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import noDataImg from '@/assets/img/noData.png'

withDefaults(
  defineProps<{
    description?: string
    hint?: string
  }>(),
  {
    description: '暂无数据',
    hint: '',
  },
)
</script>

<style scoped>
.empty-state {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 16px;
}

.illus {
  width: 168px;
  display: block;
}

.desc {
  margin: 10px 0 0;
  font-size: 14px;
  color: #5b6f88;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #94a7bd;
}

.action {
  margin-top: 12px;
}

@media (width <= 768px) {
  .empty-state {
    padding: 20px 12px;
  }

  .illus {
    width: 140px;
  }

  .desc {
    font-size: 13px;
  }
}
</style>

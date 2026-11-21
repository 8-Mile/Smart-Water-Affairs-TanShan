<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{
  markers: boolean
  hasImage: boolean
  busy: boolean
  feedback: string
}>()
const emit = defineEmits<{ markers: [value: boolean]; image: [file: File | null] }>()
const input = ref<HTMLInputElement>()
function selected(e: Event) {
  const element = e.target as HTMLInputElement
  if (element.files?.[0]) emit('image', element.files[0])
  element.value = ''
}
</script>
<template>
  <div class="setting-section">
    <label class="setting-check"
      ><span><strong>显示对象浮签</strong><small>在总览中标出四个可查看的对象。</small></span
      ><input
        type="checkbox"
        :checked="props.markers"
        @change="emit('markers', ($event.target as HTMLInputElement).checked)"
    /></label>
  </div>
  <div class="setting-section">
    <h3>总览底图</h3>
    <p>建议使用 16∶9 的 PNG、JPEG 或 WebP，最大 8 MB。图片按照原比例居中铺放，保存在当前浏览器。</p>
    <input
      ref="input"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      @change="selected"
    />
    <div class="action-row">
      <button class="primary-button" :disabled="busy" @click="input?.click()">
        {{ busy ? '正在处理…' : '选择本地图片' }}</button
      ><button
        v-if="hasImage"
        class="secondary-button"
        :disabled="busy"
        @click="emit('image', null)"
      >
        恢复默认背景
      </button>
    </div>
    <p class="feedback" role="status">{{ feedback }}</p>
  </div>
</template>

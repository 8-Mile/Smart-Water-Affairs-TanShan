<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const now = ref(new Date());
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "short",
});
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const date = computed(() => dateFormatter.format(now.value));
const time = computed(() => timeFormatter.format(now.value));
const sync = () => { now.value = new Date(); };
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  sync();
  timer = setInterval(sync, 1000);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener("visibilitychange", sync);
  window.removeEventListener("focus", sync);
});
</script>

<template>
  <time class="overview-clock" :datetime="now.toISOString()" aria-label="北京时间" aria-live="off" title="北京时间 · 设备时钟，每秒更新">
    <span>{{ date }}</span><strong>{{ time }}</strong>
  </time>
</template>

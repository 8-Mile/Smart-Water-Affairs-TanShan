<!--
  ProDetailDrawer —— 全站详情抽屉统一壳层
  形制对齐告警详情（ad-*），紧凑排版，复用 FlowTimeline 彩色时间轴
  用法（配对标签）：
    ProDetailDrawer：v-model 控制显隐，props 传 title/subtitle/icon/width，
    插槽 #title-extra 放等级胶囊，默认插槽依次放 ProDetailRow / ProDetailSection
-->
<template>
  <el-drawer
    :model-value="modelValue"
    direction="rtl"
    :size="width"
    class="pd-drawer"
    :class="drawerClass"
    :show-close="false"
    append-to-body
    modal-class="pd-modal"
    @close="emit('update:modelValue', false)"
  >
    <template #header>
      <div class="pd-head">
        <span class="pd-badge" :class="badgeClass">
          <ArtSvgIcon :icon="icon" />
        </span>
        <div class="pd-titles">
          <div class="pd-title-row">
            <h2 class="pd-title">{{ title }}</h2>
            <slot name="title-extra" />
          </div>
          <p v-if="subtitle" class="pd-sub">{{ subtitle }}</p>
        </div>
        <button class="pd-close" type="button" aria-label="关闭" @click="emit('update:modelValue', false)">
          <ArtSvgIcon icon="ri:close-line" />
        </button>
      </div>
    </template>

    <div class="pd-body">
      <slot />
    </div>

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ArtSvgIcon from './ArtSvgIcon.vue'

interface Props {
  modelValue: boolean
  title: string
  subtitle?: string
  icon?: string
  width?: string
  badgeClass?: string
  /** 告警等级（1/2/3）：传入后在抽屉左侧渲染对应颜色的 1px 边框 + 呼吸灯，仅历史告警详情使用 */
  borderLevel?: number
  /** 业务状态呼吸边框色（red|orange|blue|purple|green|gray）：工单/设备/维保/巡检等非告警详情使用，与 borderLevel 二选一 */
  borderTone?: string
  /** 是否让内容区撑满抽屉剩余高度（固定高度、内容超长时滚动），仅历史告警详情使用 */
  bodyFill?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'ri:file-list-line',
  /** 全站详情抽屉统一宽度，各页面不再单独传 width，避免宽度不一致 */
  width: '480px',
})

/** 抽屉根节点 class：传 borderLevel（告警）或 borderTone（业务状态）时启用左侧呼吸边框 */
const drawerClass = computed(() => ({
  'pd-drawer--fill': props.bodyFill,
  'pd-drawer--bordered': !!props.borderLevel || !!props.borderTone,
  [`pd-border-lv-${props.borderLevel}`]: !!props.borderLevel,
  [`pd-tone-${props.borderTone}`]: !!props.borderTone,
}))

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<style scoped>
.pd-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pd-badge {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  font-size: 20px;
  color: #176bff;
  background: #e8f1ff;
  border: 1px solid #c9deff;
}
.pd-titles {
  flex: 1;
  min-width: 0;
}
.pd-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.pd-title {
  margin: 0;
  color: #1b2a3d;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  flex: 0 0 auto;
}
.pd-sub {
  margin: 2px 0 0;
  overflow: hidden;
  color: #8a97a8;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-left: 6px;
  border: none;
  border-radius: 8px;
  background: rgb(38 54 77 / 0.06);
  color: var(--art-gray-600);
  font-size: 17px;
  cursor: pointer;
  flex: none;
}
.pd-close:hover {
  background: rgb(38 54 77 / 0.12);
  color: var(--art-gray-900);
}
/* 告警等级徽章变色：一类红 / 二类橙 / 三类蓝（与全局 dd-pill 胶囊同色系） */
.pd-badge.lv-1 {
  color: #f03d45;
  background: #ffecee;
  border-color: #ffd5d9;
}
.pd-badge.lv-2 {
  color: #f59a07;
  background: #fff2db;
  border-color: #ffe1af;
}
.pd-badge.lv-3 {
  color: #176bff;
  background: #e8f1ff;
  border-color: #c9deff;
}
.pd-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 0 auto;
  min-height: 100%;
}
/* body-fill 模式下：内容容器随抽屉剩余高度伸缩，取消最小高度限制，
   使高度固定为抽屉可用空间，内容超出时由 .el-drawer__body 滚动 */
.pd-drawer--fill .pd-body {
  flex: 1 1 auto;
  min-height: 0;
}
</style>

<style>
/* el-drawer 壳层：非 scoped，作用于全局 EP 抽屉内部结构 */
.pd-drawer {
  /* 磨砂半透明底（与实时告警 side-card 同质感），叠加顶部柔光 */
  background:
    radial-gradient(420px 180px at 88% -40px, rgba(120, 180, 255, 0.16), rgba(120, 180, 255, 0) 70%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.82) 0%, rgba(238, 247, 255, 0.76) 100%);
  -webkit-backdrop-filter: blur(16px) saturate(1.5);
  backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: -16px 0 50px -18px rgba(30, 80, 180, 0.25);
  /* 左侧动态边框：颜色/粗细由 CSS 变量驱动，默认 0px 透明，
     仅历史告警详情（传 borderLevel → pd-drawer--bordered）显示 */
  border-left: var(--pd-border-width, 0px) solid var(--pd-border-color, transparent);
  /* EP 的 .el-drawer 带 transition: all：异步注入的 tone/bordered 类会触发
     border 过渡，在渲染时钟被节流的场景（自动化测试/后台标签页）边框会卡在
     0px 透明初值不可见。收窄为仅 transform/opacity（滑入滑出动画仍保留），
     边框立即生效 */
  transition-property: transform, opacity;
}
/* 带边框的抽屉（历史告警详情）：统一 1px 宽 + 左侧呼吸灯，
   颜色由 pd-border-lv-* 按告警等级注入 --pd-border-color */
.pd-drawer--bordered {
  --pd-border-width: 1px;
  animation: pd-breathe 2.4s ease-in-out infinite;
}
.pd-drawer.pd-border-lv-1 { --pd-border-color: #f03d45; }
.pd-drawer.pd-border-lv-2 { --pd-border-color: #f59a07; }
.pd-drawer.pd-border-lv-3 { --pd-border-color: #176bff; }
/* 业务状态呼吸边框色（工单/设备/维保/巡检详情） */
.pd-drawer.pd-tone-red    { --pd-border-color: #f03d45; }
.pd-drawer.pd-tone-orange { --pd-border-color: #f59a07; }
.pd-drawer.pd-tone-blue   { --pd-border-color: #176bff; }
.pd-drawer.pd-tone-purple { --pd-border-color: #8055db; }
.pd-drawer.pd-tone-green  { --pd-border-color: #16a34a; }
.pd-drawer.pd-tone-gray   { --pd-border-color: #97a4b7; }
@keyframes pd-breathe {
  0%,
  100% {
    box-shadow:
      -1px 0 3px 0 var(--pd-border-color, transparent),
      -16px 0 50px -18px rgba(30, 80, 180, 0.25);
  }
  50% {
    box-shadow:
      -2px 0 6px 0 var(--pd-border-color, transparent),
      -16px 0 50px -18px rgba(30, 80, 180, 0.25);
  }
}
.pd-drawer .el-drawer__header {
  flex: 0 0 auto;
  margin: 0;
  padding: 18px 20px 12px;
  border-bottom: none;
}
.pd-drawer .el-drawer__body {
  display: flex;
  flex-direction: column;
  padding: 4px 20px 20px;
  overflow-y: auto;
}
/* body-fill 模式：内容区固定撑满抽屉剩余高度，超长内容滚动，
   高度不随内部内容变化而变化（仅历史告警详情启用） */
.pd-drawer--fill .el-drawer__body {
  flex: 1 1 auto;
  min-height: 0;
}
/* 遮罩：与抽屉同质感的浅磨砂（避免深色压暗破坏统一磨砂氛围） */
.el-overlay.pd-modal {
  background-color: rgba(226, 239, 255, 0.45);
  -webkit-backdrop-filter: blur(6px) saturate(1.2);
  backdrop-filter: blur(6px) saturate(1.2);
}
</style>

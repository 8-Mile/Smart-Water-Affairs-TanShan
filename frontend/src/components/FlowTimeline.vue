<!--
  FlowTimeline —— 通用彩色流程时间轴（档案工单流转 / 告警处理日志共用）
  用法：
    <FlowTimeline :nodes="[
      { name: '告警触发', icon: 'ri:alarm-warning-line', color: 'red', operator: '系统', desc: '规则引擎自动生成', time: '2026-10-13 13:53' },
    ]" />
  node 字段：
    name     节点名称（必填）
    icon     RemixIcon 图标名（可选，默认 ri:record-circle-line）
    color    主题色 red|blue|orange|purple|green（默认 blue）
    operator 操作人（可选）
    desc     描述文本（可选）
    time     时间文本（可选）
  props：
    emptyText 空态文案（可选，默认「暂无记录」）
-->
<template>
  <ul v-if="nodes.length" class="ftl">
    <li v-for="(n, i) in nodes" :key="i" class="ftl-item">
      <span class="ftl-rail" aria-hidden>
        <i class="ftl-dot" :class="`dot-${n.color || 'blue'}`" />
        <i class="ftl-line" />
      </span>
      <div class="ftl-body">
        <div class="ftl-head">
          <span class="ftl-ico" :class="`ico-${n.color || 'blue'}`">
            <ArtSvgIcon :icon="n.icon || 'ri:record-circle-line'" />
          </span>
          <span class="ftl-name">{{ n.name }}</span>
          <span v-if="n.time" class="ftl-time">{{ n.time }}</span>
        </div>
        <p v-if="n.operator" class="ftl-op">操作人：{{ n.operator }}</p>
        <p v-if="n.desc" class="ftl-desc">{{ n.desc }}</p>
      </div>
    </li>
  </ul>
  <el-empty v-else :image-size="80" :description="emptyText" />
</template>

<script setup lang="ts">
import ArtSvgIcon from './ArtSvgIcon.vue'

interface FlowNode {
  name: string
  icon?: string
  color?: 'red' | 'blue' | 'orange' | 'purple' | 'green'
  operator?: string
  desc?: string
  time?: string
}

withDefaults(defineProps<{ nodes: FlowNode[]; emptyText?: string }>(), { emptyText: '暂无记录' })
</script>

<style scoped>
.ftl {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.ftl-item {
  position: relative;
  display: flex;
  gap: 12px;
  padding-left: 2px;
}
.ftl-rail {
  position: relative;
  flex: 0 0 auto;
  width: 14px;
  padding-top: 9px;
}
.ftl-line {
  position: absolute;
  top: 26px;
  bottom: -10px;
  left: 50%;
  border-left: 2px dashed #b9d2f5;
  transform: translateX(-50%);
}
.ftl-item:last-child .ftl-line {
  display: none;
}
.ftl-dot {
  position: relative;
  z-index: 1;
  display: block;
  width: 13px;
  height: 13px;
  border: 2.5px solid #fff;
  border-radius: 50%;
}
.dot-red { background: #f43f4e; box-shadow: 0 0 0 3px rgba(244, 63, 78, 0.15); }
.dot-blue { background: #2f7cf6; box-shadow: 0 0 0 3px rgba(47, 124, 246, 0.15); }
.dot-orange { background: #f58a07; box-shadow: 0 0 0 3px rgba(245, 138, 7, 0.15); }
.dot-purple { background: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15); }
.dot-green { background: #16a34a; box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15); }

.ftl-body {
  flex: 1 1 auto;
  min-width: 0;
  margin-bottom: 14px;
}
.ftl-item:last-child .ftl-body {
  margin-bottom: 0;
}
.ftl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ftl-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 15px;
  flex: 0 0 auto;
}
.ico-red { background: #ffe9ea; color: #f43f4e; }
.ico-blue { background: #e8f1ff; color: #2f7cf6; }
.ico-orange { background: #fff3e6; color: #f58a07; }
.ico-purple { background: #f1eafe; color: #8b5cf6; }
.ico-green { background: #e6f8ef; color: #16a34a; }

.ftl-name {
  font-size: 15px;
  font-weight: 600;
  color: #12234d;
  line-height: 1.5;
  word-break: break-all;
}
.ftl-time {
  margin-left: auto;
  font-size: 12px;
  color: #9aa7ba;
  font-variant-numeric: tabular-nums;
}
.ftl-op {
  margin: 4px 0 0;
  font-size: 12px;
  color: #5e6f8e;
}
.ftl-desc {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: #5e6f8e;
  line-height: 1.5;
}
</style>

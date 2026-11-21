<script setup lang="ts">
import { computed } from 'vue'
import GlassPanel from './GlassPanel.vue'
import TrendChart from './TrendChart.vue'
import Icon, { type IconName } from './Icon.vue'
import { fmt, type Snapshot, type Register, type Activity } from '../data/demo'
const p = defineProps<{ snapshot: Snapshot; change: number | null }>()
const emit = defineEmits<{
  details: [kind: 'operation' | 'schedule' | 'online' | 'throughput' | 'pending' | 'activities']
  navigate: [page: Register]
  event: [item: Activity]
}>()
const rows = computed(() => {
  const s = p.snapshot
  return [
    {
      label: '作业准点率',
      value: ((s.completed / s.scheduled) * 100).toFixed(1),
      unit: '%',
      icon: 'clock',
      tone: 'blue',
      action: () => emit('details', 'schedule'),
    },
    {
      label: '当前库存',
      value: fmt(s.inventory),
      unit: '件',
      icon: 'box',
      tone: 'mint',
      action: () => emit('navigate', 'warehouse'),
    },
    {
      label: '在场车辆',
      value: String(s.fleet.length).padStart(2, '0'),
      unit: '辆',
      icon: 'truck',
      tone: 'lilac',
      action: () => emit('navigate', 'fleet'),
    },
    {
      label: '待跟进事件',
      value: String(s.events.filter((e) => e.pending).length).padStart(2, '0'),
      unit: '条',
      icon: 'layers',
      tone: 'amber',
      action: () => emit('details', 'pending'),
    },
  ] satisfies {
    label: string
    value: string
    unit: string
    icon: IconName
    tone: string
    action: () => void
  }[]
})
const online = computed(() => ((p.snapshot.online / p.snapshot.totalDevices) * 100).toFixed(1))
</script>
<template>
  <div class="cards-grid">
    <GlassPanel title="当日作业量" class="metric-panel">
      <template #action
        ><button class="quiet-link" @click="emit('details', 'operation')">
          统计口径 <Icon name="arrow" /></button
      ></template>
      <p class="big-number">{{ fmt(snapshot.operation) }}<small>件次</small></p>
      <div class="paired-caption">
        <span>入库、出库及场内搬运</span
        ><b v-if="change !== null" class="positive"
          >较前日 {{ change >= 0 ? '+' : '' }}{{ change.toFixed(1) }}%</b
        ><span v-else>基准日</span>
      </div>
      <div class="spark-wrap"><TrendChart kind="spark" :first="snapshot.operationSeries" /></div>
      <div class="axis-ends"><span>09:00</span><span>16:00</span></div>
    </GlassPanel>
    <GlassPanel title="关键指标" class="metrics-panel">
      <template #action><span class="micro">截至 16:00</span></template>
      <div class="metric-rows">
        <button v-for="row in rows" :key="row.label" class="metric-row" @click="row.action">
          <span :class="['metric-icon', row.tone]"><Icon :name="row.icon" /></span
          ><span class="row-label">{{ row.label }}</span
          ><strong
            >{{ row.value }}<small>{{ row.unit }}</small></strong
          >
        </button>
      </div>
    </GlassPanel>
    <GlassPanel title="设备在线率" class="rate-panel">
      <template #action><span class="status-text">监测覆盖</span></template>
      <p class="big-number">{{ online }}<small>%</small></p>
      <div
        class="progress-track"
        role="meter"
        aria-label="设备在线率"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Number(online)"
      >
        <i :style="{ width: online + '%' }"></i>
      </div>
      <p class="micro rate-summary">
        在线设备 {{ snapshot.online }} / {{ snapshot.totalDevices }} 台
      </p>
      <button class="text-link" @click="emit('details', 'online')">
        查看监测明细 <Icon name="arrow" />
      </button>
    </GlassPanel>
    <GlassPanel title="分时吞吐趋势" class="trend-panel">
      <template #action
        ><button class="quiet-link" @click="emit('details', 'throughput')">
          分时明细 <Icon name="arrow" /></button
      ></template>
      <p class="mid-number">{{ fmt(snapshot.inTotal) }}<small>件 / 入库合计</small></p>
      <div class="bars-wrap">
        <TrendChart kind="bars" :first="snapshot.inbound" :second="snapshot.outbound" />
      </div>
      <div class="chart-legend">
        <span><i></i>入库</span><span><i></i>出库</span>
      </div>
    </GlassPanel>
    <GlassPanel title="作业动态" class="events-panel">
      <template #action
        ><button class="quiet-link" @click="emit('details', 'activities')">
          全部动态 <Icon name="arrow" /></button
      ></template>
      <div class="activity-rows">
        <button v-for="e in snapshot.events.slice(0, 3)" :key="e.id" @click="emit('event', e)">
          <time>{{ e.time }}</time
          ><span :class="['event-symbol', e.pending ? 'amber' : 'mint']"
            ><Icon :name="e.pending ? 'clock' : 'check'" /></span
          ><span class="event-copy"
            ><b>{{ e.title }}</b
            ><small>{{ e.detail }}</small></span
          >
        </button>
      </div>
    </GlassPanel>
  </div>
</template>

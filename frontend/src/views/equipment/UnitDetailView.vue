<template>
  <div class="page mod-equipment-detail page-fill">
    <!-- 顶部导航 -->
    <div class="detail-head">
      <el-button text @click="goBack">
        <ArtSvgIcon icon="ri:arrow-left-line" style="margin-right: 4px" />返回设备列表
      </el-button>
      <div class="head-title">
        <span class="title-badge"><ArtSvgIcon icon="ri:server-line" /></span>
        <span class="title-text">{{ equipment?.name || '机组详情' }}</span>
        <el-tag v-if="equipment" size="small" effect="light" :type="runTagType(equipment.running_status)">
          {{ runLabel(equipment.running_status) }}
        </el-tag>
      </div>
    </div>

    <el-skeleton v-if="loading" :rows="6" animated />

    <template v-else-if="equipment">
      <!-- 设备基本信息卡片 -->
      <el-card shadow="never" class="info-card">
        <div class="card-head">
          <span class="head-badge"><ArtSvgIcon icon="ri:information-line" /></span>
          <span class="head-title">设备信息</span>
        </div>
        <el-descriptions :column="4" border size="default">
          <el-descriptions-item label="设备名称">{{ equipment.name }}</el-descriptions-item>
          <el-descriptions-item label="设备编号">{{ equipment.code }}</el-descriptions-item>
          <el-descriptions-item label="设备分类">{{ equipment.type_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="部署位置">{{ equipment.location_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="运行状态">
            <el-tag size="small" effect="light" :type="runTagType(equipment.running_status)">
              {{ runLabel(equipment.running_status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="连续运行">{{ equipment.continuous_run_hours?.toFixed?.(1) ?? 0 }} h</el-descriptions-item>
          <el-descriptions-item label="检修状态">{{ maintainLabel(equipment.maintain_status) }}</el-descriptions-item>
          <el-descriptions-item label="出厂日期">{{ equipment.production_date || '-' }}</el-descriptions-item>
        </el-descriptions>

        <!-- 机组额定参数（仅机组显示） -->
        <div v-if="hasRatedParams" class="rated-section">
          <div class="rated-title">
            <ArtSvgIcon icon="ri:settings-3-line" /> 机组额定参数
          </div>
          <div class="rated-grid">
            <div class="rated-item">
              <div class="rated-label">机组编号</div>
              <div class="rated-value">{{ equipment.unit_no ?? '-' }}</div>
            </div>
            <div class="rated-item">
              <div class="rated-label">泵型</div>
              <div class="rated-value">{{ equipment.pump_type || '-' }}</div>
            </div>
            <div class="rated-item">
              <div class="rated-label">额定功率</div>
              <div class="rated-value">{{ fmt(equipment.rated_power_kw) }} <span class="u">kW</span></div>
            </div>
            <div class="rated-item">
              <div class="rated-label">额定电流</div>
              <div class="rated-value">{{ fmt(equipment.rated_current_a) }} <span class="u">A</span></div>
            </div>
            <div class="rated-item">
              <div class="rated-label">额定电压</div>
              <div class="rated-value">{{ fmt(equipment.rated_voltage_kv) }} <span class="u">kV</span></div>
            </div>
            <div class="rated-item">
              <div class="rated-label">额定扬程</div>
              <div class="rated-value">{{ fmt(equipment.rated_head_m) }} <span class="u">m</span></div>
            </div>
            <div class="rated-item">
              <div class="rated-label">额定流量</div>
              <div class="rated-value">{{ fmt(equipment.rated_flow_m3s) }} <span class="u">m³/s</span></div>
            </div>
            <div class="rated-item">
              <div class="rated-label">叶片角度</div>
              <div class="rated-value">{{ fmt(equipment.blade_angle_min) }} ~ {{ fmt(equipment.blade_angle_max) }} <span class="u">°</span></div>
            </div>
          </div>
        </div>
      </el-card>

      <!-- Tab 区域 -->
      <el-card shadow="never" class="tab-card">
        <el-tabs v-model="activeTab" @tab-change="onTabChange">
          <!-- 实时测点 -->
          <el-tab-pane label="实时测点" name="realtime">
            <div v-loading="realtimeLoading" class="tab-body">
              <el-empty v-if="!realtimePoints.length" description="暂无测点数据" />
              <template v-else>
                <el-radio-group v-model="realtimeView" size="default" class="view-toggle">
                  <el-radio-button label="analog">
                    模拟量 <el-tag size="small" type="info" effect="plain" style="margin-left:4px">{{ analogPoints.length }}</el-tag>
                  </el-radio-button>
                  <el-radio-button label="switch" v-if="switchPoints.length">
                    开关量 <el-tag size="small" type="info" effect="plain" style="margin-left:4px">{{ switchPoints.length }}</el-tag>
                  </el-radio-button>
                </el-radio-group>

                <!-- 模拟量 -->
                <div v-if="realtimeView === 'analog'" class="point-groups">
                  <div v-for="part in parts" :key="part.name" class="part-block">
                    <div v-if="hasMultipleParts" class="part-title">
                      <ArtSvgIcon icon="ri:apps-2-line" />
                      <span>{{ part.shortName }}</span>
                      <el-tag size="small" type="info" effect="plain">{{ part.items.length }}</el-tag>
                    </div>
                    <div v-for="group in part.groups" :key="group.category" class="point-group">
                      <div class="group-title">
                        <ArtSvgIcon :icon="categoryIcon(group.category)" />
                        <span>{{ categoryLabel(group.category) }}</span>
                        <el-tag size="small" type="info" effect="plain">{{ group.items.length }}</el-tag>
                      </div>
                      <div class="point-grid">
                        <div v-for="p in group.items" :key="p.point_id_raw" class="point-item">
                          <div class="point-name" :title="p.description || p.tag_name">
                            {{ p.description || p.tag_name }}
                          </div>
                          <div class="point-value">
                            <span :class="{ 'is-na': !p.found }">{{ p.found ? (p.display_value ?? '--') : '--' }}</span>
                            <span class="point-unit">{{ p.unit || '' }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 开关量 -->
                <div v-else class="switch-list">
                  <el-table
                    :data="switchTableRows"
                    :span-method="switchSpanMethod"
                    :row-class-name="switchRowClass"
                    stripe
                  >
                    <template #empty><el-empty :image-size="80" description="暂无开关量" /></template>
                    <el-table-column label="序号" width="70" align="center" header-align="center">
                      <template #default="{ row }">
                        <template v-if="row.__groupRow">
                          <ArtSvgIcon
                            :icon="switchCollapsed ? 'ri:arrow-right-s-line' : 'ri:arrow-down-s-line'"
                            class="group-toggle"
                            @click="toggleSwitchGroup"
                          />
                        </template>
                        <template v-else>{{ row.__seq }}</template>
                      </template>
                    </el-table-column>

                    <el-table-column label="测点名称" min-width="240" show-overflow-tooltip>
                      <template #default="{ row }">
                        <template v-if="row.__groupRow">
                          <span class="group-title-text">
                            {{ row.__groupLabel }}
                            <span class="group-count"> ({{ row.__total }})</span>
                          </span>
                        </template>
                        <template v-else>{{ row.description || row.tag_name }}</template>
                      </template>
                    </el-table-column>

                    <el-table-column label="实时值" width="120" align="center" header-align="center">
                      <template #default="{ row }">
                        <template v-if="row.__groupRow">—</template>
                        <template v-else>
                          <span v-if="row.found" class="switch-value">{{ row.display_value ?? '--' }}</span>
                          <span v-else class="is-na">—</span>
                        </template>
                      </template>
                    </el-table-column>

                    <el-table-column label="来源" min-width="180" show-overflow-tooltip>
                      <template #default="{ row }">
                        <template v-if="row.__groupRow">—</template>
                        <template v-else>
                          <span class="source-device">{{ formatSourceDevice(row.equipment_name) }}</span>
                        </template>
                      </template>
                    </el-table-column>

                    <el-table-column label="测点标识" min-width="200" show-overflow-tooltip>
                      <template #default="{ row }">
                        <template v-if="row.__groupRow">—</template>
                        <template v-else><span class="point-id">{{ row.tag_name }}</span></template>
                      </template>
                    </el-table-column>

                    <el-table-column label="操作" width="100" align="center">
                      <template #default="{ row }">
                        <template v-if="row.__groupRow">—</template>
                        <template v-else>
                          <el-button link type="primary" size="small" @click="onSwitchDetail(row)">详情</el-button>
                        </template>
                      </template>
                    </el-table-column>
                  </el-table>

                  <!-- 分页 -->
                  <div v-if="switchDataRows.length > switchPageSize" class="switch-pagination">
                    <span class="switch-page-info">
                      共 {{ switchDataRows.length }} 个测点
                      <span v-if="!switchCollapsed">
                        当前展示 {{ (switchPage - 1) * switchPageSize + 1 }}-{{ Math.min(switchPage * switchPageSize, switchDataRows.length) }}
                      </span>
                    </span>
                    <el-pagination
                      v-model:current-page="switchPage"
                      v-model:page-size="switchPageSize"
                      :page-sizes="[10, 20, 50]"
                      :total="switchDataRows.length"
                      :pager-count="7"
                      layout="prev, pager, next, sizes"
                      background
                      small
                    />
                  </div>
                </div>
              </template>
            </div>
          </el-tab-pane>

          <!-- 历史趋势 -->
          <el-tab-pane label="历史趋势" name="trend">
            <div class="tab-body">
              <div class="trend-toolbar">
                <span class="tb-label">测点：</span>
                <el-select v-model="selectedTag" placeholder="选择测点" filterable style="width: 340px" @change="loadHistory">
                  <template v-if="hasMultipleParts">
                    <el-option-group
                      v-for="part in parts"
                      :key="part.name"
                      :label="part.shortName"
                    >
                      <el-option
                        v-for="p in part.allItems.filter((x: any) => ANALOG_CATS.has(x.point_category || 'other'))"
                        :key="p.point_id_raw"
                        :label="p.description || p.tag_name"
                        :value="p.tag_name"
                      />
                    </el-option-group>
                  </template>
                  <template v-else>
                    <el-option-group
                      v-for="group in analogGroups"
                      :key="group.category"
                      :label="categoryLabel(group.category)"
                    >
                      <el-option
                        v-for="p in group.items"
                        :key="p.point_id_raw"
                        :label="p.description || p.tag_name"
                        :value="p.tag_name"
                      />
                    </el-option-group>
                  </template>
                </el-select>
                <el-button type="primary" plain @click="loadHistory">
                  <ArtSvgIcon icon="ri:refresh-line" style="margin-right: 4px" />刷新
                </el-button>
              </div>
              <div ref="trendChartRef" class="trend-chart" />
              <el-empty v-if="!historyItems.length && !historyLoading" description="暂无历史数据" />
            </div>
          </el-tab-pane>

          <!-- 能效指标 -->
          <el-tab-pane label="能效指标" name="efficiency">
            <div v-loading="effLoading" class="tab-body">
              <div class="eff-kpi-row">
                <div v-for="k in effKpi" :key="k.label" class="eff-kpi-card" :style="{ '--c': k.color }">
                  <div class="k-label">{{ k.label }}</div>
                  <div class="k-value">{{ k.value }}<span class="k-unit">{{ k.unit }}</span></div>
                </div>
              </div>
              <el-table :data="efficiencyRows" stripe size="default">
                <template #empty><el-empty :image-size="72" description="暂无能效数据" /></template>
                <el-table-column prop="stat_date" label="统计日期" width="130" />
                <el-table-column prop="electricity_kwh" label="耗电量(kWh)" width="130" align="right">
                  <template #default="{ row }">{{ num(row.electricity_kwh) }}</template>
                </el-table-column>
                <el-table-column prop="run_hours" label="运行时长(h)" width="120" align="right">
                  <template #default="{ row }">{{ num(row.run_hours) }}</template>
                </el-table-column>
                <el-table-column prop="water_m3" label="供水量(m³)" width="130" align="right">
                  <template #default="{ row }">{{ num(row.water_m3) }}</template>
                </el-table-column>
                <el-table-column prop="unit_consumption" label="单耗(kWh/m³)" width="140" align="right">
                  <template #default="{ row }">{{ num(row.unit_consumption, 4) }}</template>
                </el-table-column>
                <el-table-column prop="avg_power_kw" label="平均功率(kW)" width="130" align="right">
                  <template #default="{ row }">{{ num(row.avg_power_kw) }}</template>
                </el-table-column>
                <el-table-column prop="load_rate" label="负荷率(%)" width="110" align="right">
                  <template #default="{ row }">{{ pct(row.load_rate) }}</template>
                </el-table-column>
                <el-table-column prop="efficiency" label="效率(%)" width="110" align="right">
                  <template #default="{ row }">{{ pct(row.efficiency) }}</template>
                </el-table-column>
                <el-table-column prop="sample_count" label="样本数" width="90" align="right" />
              </el-table>
            </div>
          </el-tab-pane>

          <!-- 告警记录 -->
          <el-tab-pane label="告警记录" name="alarm">
            <div v-loading="alarmLoading" class="tab-body">
              <el-table :data="alarmRows" stripe size="default">
                <template #empty><el-empty :image-size="72" description="暂无告警记录" /></template>
                <el-table-column prop="alarm_time" label="告警时间" width="170" />
                <el-table-column prop="equipment_name" label="所属部分" width="150" show-overflow-tooltip>
                  <template #default="{ row }">
                    <el-tag size="small" type="info" effect="plain">{{ shortPartName(row.equipment_name) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="rule_name" label="告警规则" min-width="180" show-overflow-tooltip />
                <el-table-column prop="alarm_type_name" label="类型" width="110" />
                <el-table-column prop="alarm_level" label="级别" width="80" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="levelTag(row.alarm_level)">L{{ row.alarm_level }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="trigger_value" label="触发值" width="120" align="right" />
                <el-table-column prop="alarm_status" label="状态" width="100">
                  <template #default="{ row }">{{ alarmStatusLabel(row.alarm_status) }}</template>
                </el-table-column>
                <el-table-column prop="assignee_name" label="处理人" width="100" />
              </el-table>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>

    <el-empty v-else description="设备不存在" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import echarts from '@/utils/echarts'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import { fetchEquipmentDetail, type EquipmentItem } from '@/api/equipment'
import { fetchEquipmentScadaValues, fetchScadaHistory } from '@/api/scada'
import { fetchEnergyEfficiency, type EnergyEfficiencyItem } from '@/api/energy'
import { listAlarms, type AlarmItem } from '@/api/alarm'
import {
  HYDRO_COLORS,
  hydroCategoryAxis,
  hydroGrid,
  hydroTooltip,
  hydroValueAxis,
} from '@/utils/chartTheme'

const route = useRoute()
const router = useRouter()

const equipmentId = Number(route.params.id)

const loading = ref(true)
const equipment = ref<EquipmentItem | null>(null)

// 实时测点
const realtimeLoading = ref(false)
const realtimePoints = ref<
  {
    point_id_raw: string
    tag_name?: string
    display_value?: unknown
    unit?: string
    value_type?: string
    ts_ms?: number
    point_category?: string
    description?: string
    equipment_name?: string
    equipment_id?: number
    found: boolean
  }[]
>([])

// 历史趋势
const selectedTag = ref('')
const historyLoading = ref(false)
const historyItems = ref<{ ts_ms: number; value_num: number | null; value_str?: string }[]>([])
const trendChartRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null

// 能效
const effLoading = ref(false)
const efficiencyRows = ref<EnergyEfficiencyItem[]>([])

// 告警
const alarmLoading = ref(false)
const alarmRows = ref<AlarmItem[]>([])

const activeTab = ref('realtime')
const realtimeView = ref<'analog' | 'switch'>('analog')

// 模拟量分类：electrical / temperature / hydraulic / other
// 开关量分类：switch
const ANALOG_CATS = new Set(['electrical', 'temperature', 'hydraulic', 'other'])

const analogPoints = computed(() =>
  realtimePoints.value.filter((p) => ANALOG_CATS.has(p.point_category || 'other')),
)
const switchPoints = computed(() =>
  realtimePoints.value.filter((p) => p.point_category === 'switch'),
)

/* ---- 开关量：单一分组 + 分页 ---- */
const switchCollapsed = ref(false)
const switchPage = ref(1)
const switchPageSize = ref(10)

function toggleSwitchGroup() {
  switchCollapsed.value = !switchCollapsed.value
}

watch(
  () => switchPoints.value.length,
  () => { switchPage.value = 1 },
)

/** 全量数据（不包含分组标题行） */
const switchDataRows = computed(() => {
  return switchPoints.value.map((item, idx) => ({
    ...item,
    __seq: String(idx + 1).padStart(2, '0'),
    __seqNum: idx + 1,
  }))
})

/** 当前页的数据切片 */
const switchPagedRows = computed(() => {
  const start = (switchPage.value - 1) * switchPageSize.value
  return switchDataRows.value.slice(start, start + switchPageSize.value)
})

/** 完整表格数据：分组标题行 + 分页数据行 */
const switchTableRows = computed(() => {
  if (switchCollapsed.value) {
    return [{
      __groupRow: true,
      __groupLabel: '开关量',
      __total: switchDataRows.value.length,
    }]
  }
  return [
    { __groupRow: true, __groupLabel: '开关量', __total: switchDataRows.value.length },
    ...switchPagedRows.value,
  ]
})

/** span-method：分组标题行合并显示 */
function switchSpanMethod({ row, columnIndex }: { row: any; columnIndex: number }) {
  if (row.__groupRow) {
    if (columnIndex === 0) return { rowspan: 1, colspan: 1 }
    if (columnIndex === 1) return { rowspan: 1, colspan: 5 }
    return { rowspan: 0, colspan: 0 }
  }
}

function switchRowClass({ row }: { row: any }) {
  return row.__groupRow ? 'switch-group-row' : ''
}

/** 来源设备格式化：父机组 / 子部件 */
function formatSourceDevice(name: unknown): string {
  const s = String(name || '')
  if (!s) return '-'
  // "大张庄1号机组-励磁系统" => "1号机组 / 励磁系统"
  const idx = s.indexOf('-')
  if (idx < 0) return s
  const parent = s.slice(0, idx).replace(/^[^0-9]*?(\d+号机组)$/, '$1')
  const child = s.slice(idx + 1)
  return `${parent} / ${child}`
}

function onSwitchDetail(row: any) {
  // 打开对应子设备详情
  if (row.equipment_id) {
    router.push({ path: `/equipment/${row.equipment_id}` })
  } else {
    ElMessage.info(`测点 ${row.description || row.tag_name}：${formatSourceDevice(row.equipment_name)}`)
  }
}

/* ---- 基本信息 ---- */
async function loadEquipment() {
  loading.value = true
  try {
    const { data } = await fetchEquipmentDetail(equipmentId)
    equipment.value = data.data
  } catch {
    ElMessage.error('加载设备信息失败')
  } finally {
    loading.value = false
  }
}

const hasRatedParams = computed(
  () =>
    equipment.value &&
    (equipment.value.rated_power_kw != null ||
      equipment.value.rated_flow_m3s != null ||
      equipment.value.unit_no != null),
)

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-'
  return String(v)
}
function num(v: unknown, digits = 2): string {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(digits) : '-'
}
function pct(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(1) : '-'
}

function runTagType(s: string) {
  return s === 'running' ? 'success' : s === 'fault' ? 'danger' : s === 'overhaul' ? 'warning' : 'info'
}
function runLabel(s: string) {
  return { running: '运行中', stopped: '停机', fault: '故障', overhaul: '检修中', standby: '备用' }[s] || s
}
function maintainLabel(s: string) {
  return { normal: '正常', pending: '待检修', overdue: '已超期' }[s] || s || '-'
}

/* ---- 实时测点 ---- */
async function loadRealtime() {
  realtimeLoading.value = true
  try {
    const { data } = await fetchEquipmentScadaValues(equipmentId)
    realtimePoints.value = (data.data || []) as typeof realtimePoints.value
  } catch {
    ElMessage.error('加载测点失败')
  } finally {
    realtimeLoading.value = false
  }
}

const categoryMap: Record<string, string> = {
  electrical: '电气量',
  temperature: '温度量',
  hydraulic: '水力量',
  switch: '开关量',
  other: '其他',
}
const categoryIconMap: Record<string, string> = {
  electrical: 'ri:flashlight-line',
  temperature: 'ri:temp-hot-line',
  hydraulic: 'ri:water-line',
  switch: 'ri:toggle-line',
  other: 'ri:apps-line',
}
function categoryLabel(c?: string) {
  return categoryMap[c || 'other'] || '其他'
}
function categoryIcon(c?: string) {
  return categoryIconMap[c || 'other'] || 'ri:apps-line'
}

const analogGroups = computed(() => {
  const map = new Map<string, typeof realtimePoints.value>()
  for (const p of analogPoints.value) {
    const k = p.point_category || 'other'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(p)
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
})

/** 是否来自多个子设备（父机组详情时为 true）。 */
const hasMultipleParts = computed(() => {
  const names = new Set(realtimePoints.value.map((p) => p.equipment_name || ''))
  return names.size > 1
})

/** 按子设备分组，每组内再按测点类别分组。 */
const parts = computed(() => {
  const byPart = new Map<string, typeof realtimePoints.value>()
  for (const p of realtimePoints.value) {
    const name = p.equipment_name || equipment.value?.name || '本设备'
    if (!byPart.has(name)) byPart.set(name, [])
    byPart.get(name)!.push(p)
  }
  return Array.from(byPart.entries()).map(([name, items]) => {
    const catMap = new Map<string, typeof realtimePoints.value>()
    for (const p of items.filter((x) => ANALOG_CATS.has(x.point_category || 'other'))) {
      const k = p.point_category || 'other'
      if (!catMap.has(k)) catMap.set(k, [])
      catMap.get(k)!.push(p)
    }
    return {
      name,
      shortName: shortPartName(name),
      items,
      allItems: items,
      groups: Array.from(catMap.entries()).map(([category, gItems]) => ({ category, items: gItems })),
    }
  })
})

/* ---- 历史趋势 ---- */
async function loadHistory() {
  if (!selectedTag.value) {
    historyItems.value = []
    renderTrend()
    return
  }
  historyLoading.value = true
  try {
    const { data } = await fetchScadaHistory({ tag_name: selectedTag.value, page: 1, page_size: 200 })
    const page = data.data as unknown as { items: { ts_ms: number; value_num: number | null; value_str?: string }[] }
    // 历史按 ts_ms desc 返回，翻转为升序
    historyItems.value = (page.items || []).slice().reverse()
    renderTrend()
  } catch {
    ElMessage.error('加载历史数据失败')
  } finally {
    historyLoading.value = false
  }
}

function renderTrend() {
  nextTick(() => {
    if (!trendChartRef.value) return
    if (!trendChart) trendChart = echarts.init(trendChartRef.value)
    const labels = historyItems.value.map((it) => {
      const d = new Date(it.ts_ms)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    })
    const values = historyItems.value.map((it) => it.value_num)
    trendChart.setOption({
      color: [HYDRO_COLORS.cyan],
      tooltip: { ...hydroTooltip, trigger: 'axis' },
      grid: hydroGrid,
      xAxis: hydroCategoryAxis(labels),
      yAxis: hydroValueAxis(),
      series: [
        {
          name: selectedTag.value,
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: values,
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(34,211,238,0.35)' },
              { offset: 1, color: 'rgba(34,211,238,0.02)' },
            ]),
          },
          lineStyle: { width: 2 },
        },
      ],
    })
  })
}

/* ---- 能效指标 ---- */
async function loadEfficiency() {
  effLoading.value = true
  try {
    const params: Record<string, unknown> = { unit_id: equipmentId }
    const { data } = await fetchEnergyEfficiency(params)
    efficiencyRows.value = data.data || []
  } catch {
    // 能效接口失败不阻断页面
    efficiencyRows.value = []
  } finally {
    effLoading.value = false
  }
}

const effKpi = computed(() => {
  const rows = efficiencyRows.value
  const total = rows.reduce((s, r) => s + (r.electricity_kwh || 0), 0)
  const hours = rows.reduce((s, r) => s + (r.run_hours || 0), 0)
  const water = rows.reduce((s, r) => s + (r.water_m3 || 0), 0)
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const load = avg(rows.map((r) => r.load_rate || 0))
  const eff = avg(rows.map((r) => r.efficiency || 0))
  return [
    { label: '累计耗电量', value: num(total), unit: ' kWh', color: HYDRO_COLORS.blue },
    { label: '累计运行时长', value: num(hours), unit: ' h', color: HYDRO_COLORS.cyan },
    { label: '累计供水量', value: num(water), unit: ' m³', color: HYDRO_COLORS.green },
    { label: '平均负荷率', value: pct(load), unit: ' %', color: HYDRO_COLORS.orange },
    { label: '平均效率', value: pct(eff), unit: ' %', color: HYDRO_COLORS.purple },
  ]
})

/* ---- 告警记录 ---- */
async function loadAlarms() {
  alarmLoading.value = true
  try {
    const { data } = await listAlarms({ equipment_id: equipmentId, page: 1, page_size: 50 })
    alarmRows.value = data.data?.items || []
  } catch {
    alarmRows.value = []
  } finally {
    alarmLoading.value = false
  }
}

function levelTag(level: unknown) {
  const n = Number(level)
  return n >= 3 ? 'danger' : n === 2 ? 'warning' : 'info'
}
function alarmStatusLabel(s: unknown) {
  return (
    {
      pending: '待处理',
      processing: '处理中',
      closed: '已闭环',
      rejected: '已驳回',
      pending_accept: '待接单',
    }[String(s)] || String(s || '-')
  )
}

/** 告警所属部分短名：去掉父机组前缀，只保留子部件名。 */
function shortPartName(name: unknown): string {
  const s = String(name || '')
  if (!s) return '-'
  // "大张庄1号机组-电机" => "电机"
  const idx = s.indexOf('-')
  return idx >= 0 ? s.slice(idx + 1) : s
}

/* ---- Tab 切换懒加载 ---- */
const loaded = new Set<string>(['realtime'])
function onTabChange(name: string) {
  if (loaded.has(name)) return
  loaded.add(name)
  if (name === 'trend') {
    if (!selectedTag.value && analogPoints.value.length) {
      selectedTag.value = analogPoints.value[0].tag_name || ''
    }
    loadHistory()
  } else if (name === 'efficiency') {
    loadEfficiency()
  } else if (name === 'alarm') {
    loadAlarms()
  }
}

function goBack() {
  router.push({ path: '/equipment/list' })
}

/* ---- resize ---- */
let ro: ResizeObserver | null = null
function onResize() {
  trendChart?.resize()
}

onMounted(async () => {
  await loadEquipment()
  await loadRealtime()
  ro = new ResizeObserver(onResize)
  if (trendChartRef.value) ro.observe(trendChartRef.value)
})

onUnmounted(() => {
  ro?.disconnect()
  trendChart?.dispose()
  trendChart = null
})
</script>

<style scoped lang="scss">
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  .head-title {
    display: flex;
    align-items: center;
    gap: 8px;
    .title-badge {
      color: #0e7ff0;
      font-size: 18px;
    }
    .title-text {
      font-size: 16px;
      font-weight: 600;
      color: #0b1e33;
    }
  }
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  .head-badge {
    color: #0e7ff0;
  }
  .head-title {
    font-weight: 600;
    color: #0b1e33;
  }
}
.rated-section {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed #e6edf5;
  .rated-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: #0e7ff0;
    margin-bottom: 12px;
  }
  .rated-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  .rated-item {
    background: #f4f8fc;
    border-radius: 8px;
    padding: 12px 14px;
    .rated-label {
      font-size: 12px;
      color: #8a97a8;
      margin-bottom: 4px;
    }
    .rated-value {
      font-size: 18px;
      font-weight: 600;
      color: #0b1e33;
      .u {
        font-size: 12px;
        font-weight: 400;
        color: #8a97a8;
        margin-left: 2px;
      }
    }
  }
}
.tab-body {
  min-height: 320px;
}
.view-toggle {
  margin-bottom: 16px;
}
.point-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.switch-list {
  margin-top: 4px;

  :deep(.el-table) {
    /* 统一运维风表格皮肤 */
    --el-table-border-color: transparent;
    --el-table-text-color: #264779;
    --el-table-header-text-color: #214b83;
    --el-table-row-hover-bg-color: #e6f2ff;
    background: transparent;
    border: none !important;

    &::before,
    &::after,
    &.el-table--border::after,
    .el-table__inner-wrapper::before {
      display: none !important;
    }

    th.el-table__cell,
    td.el-table__cell {
      border-right: none !important;
      border-bottom: none !important;
    }

    /* 表头 */
    .el-table__header-wrapper thead tr {
      background: linear-gradient(180deg, #edf6fe 0%, #dfeefe 100%);
    }
    .el-table__header-wrapper th.el-table__cell {
      height: 44px;
      padding: 0 !important;
      background: transparent !important;
      color: #214b83;
      font-size: 13px;
      font-weight: 600;
    }
    .el-table__header-wrapper th.el-table__cell:first-child {
      border-radius: 10px 0 0 10px;
      position: relative;
    }
    .el-table__header-wrapper th.el-table__cell:first-child::before {
      content: '';
      position: absolute;
      left: 6px;
      top: 50%;
      width: 3px;
      height: 14px;
      border-radius: 2px;
      background: #166dfe;
      transform: translateY(-50%);
    }
    .el-table__header-wrapper th.el-table__cell:last-child {
      border-radius: 0 10px 10px 0;
    }

    /* 数据行 */
    .el-table__body tr {
      height: 44px;
    }
    .el-table__body td.el-table__cell {
      height: 44px;
      padding: 0 12px !important;
      font-size: 13px;
      color: #264779;
      background: #fbfcfe !important;
    }
    .el-table__body tr.el-table__row--striped td.el-table__cell {
      background: #f1f7fe !important;
    }
    .el-table__body tr:hover > td.el-table__cell {
      background: #e6f2ff !important;
    }

    /* 分组标题行 */
    .el-table__body tr.switch-group-row td.el-table__cell {
      background: linear-gradient(180deg, #f0f6ff 0%, #e4f0ff 100%) !important;
      font-weight: 600;
      color: #166dfe;
      border-top: 1px solid #cce0ff !important;
      border-bottom: 1px solid #cce0ff !important;
    }
    .el-table__body tr.switch-group-row:hover > td.el-table__cell {
      background: linear-gradient(180deg, #e4f0ff 0%, #d6e7ff 100%) !important;
    }

    /* 单元格文字对齐 */
    .cell {
      display: flex;
      align-items: center;
      min-height: 22px;
    }
    th .cell {
      justify-content: center;
    }
  }

  /* 分组折叠/展开图标 */
  .group-toggle {
    font-size: 18px;
    color: #166dfe;
    cursor: pointer;
    transition: transform 0.2s ease;
    margin-right: 4px;
    display: inline-flex;
    vertical-align: middle;

    &:hover {
      color: #0e5bd6;
    }
  }

  /* 分组标题文字：开关量 (50) */
  .group-title-text {
    font-weight: 600;
    font-size: 14px;
    color: #166dfe;
    letter-spacing: 0.5px;
    display: inline-flex;
    align-items: center;
    gap: 2px;

    .group-count {
      font-weight: 500;
      font-size: 13px;
      color: #5b8def;
    }
  }

  /* 实时值 */
  .switch-value {
    font-weight: 500;
    color: #264779;
  }

  /* 来源设备 */
  .source-device {
    color: #4a6a9a;
    font-size: 12px;
  }

  /* 测点标识（mono 风格） */
  .point-id {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    color: #6b7a8f;
    background: #f4f8fc;
    padding: 2px 6px;
    border-radius: 4px;
  }

  /* 分页器 */
  .switch-pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    padding: 0 4px;

    .switch-page-info {
      font-size: 13px;
      color: #7987a1;
    }

    :deep(.el-pagination) {
      --el-pagination-button-color: #264779;
      --el-pagination-hover-color: #166dfe;
      gap: 0;

      .btn-prev,
      .btn-next,
      .el-pager li {
        min-width: 30px;
        height: 30px;
        margin: 0 2px;
        border-radius: 6px;
        background: #f2f7fe;
        border: 1px solid transparent;
        color: #264779;
        font-size: 13px;
        transition: all 0.15s ease;
      }
      .el-pager li:hover,
      .btn-prev:hover,
      .btn-next:hover {
        color: #166dfe;
        background: #e4efff;
      }
      .el-pager li.is-active {
        background: #166dfe;
        color: #fff;
        border-color: #166dfe;
      }
    }
  }
}
.mono {
  font-family: monospace;
  font-size: 12px;
  color: #8a97a8;
}
.point-group {
  margin-bottom: 18px;
  .group-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: #0b1e33;
    margin-bottom: 10px;
  }
  .point-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }
  .point-item {
    background: #f4f8fc;
    border-radius: 8px;
    padding: 10px 12px;
    .point-name {
      font-size: 12px;
      color: #8a97a8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .point-value {
      font-size: 18px;
      font-weight: 600;
      color: #0e7ff0;
      margin: 4px 0;
      .is-na {
        color: #c0c8d4;
      }
      .point-unit {
        font-size: 12px;
        font-weight: 400;
        color: #8a97a8;
        margin-left: 3px;
      }
    }
  }
}
.part-block {
  margin-bottom: 22px;
  padding-bottom: 14px;
  border-bottom: 1px dashed #e6edf5;
  &:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }
  .part-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: #0e7ff0;
    font-size: 15px;
    margin-bottom: 12px;
  }
}
.trend-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  .tb-label {
    color: #64748b;
  }
}
.trend-chart {
  width: 100%;
  height: 360px;
}
.eff-kpi-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 16px;
  .eff-kpi-card {
    background: #f4f8fc;
    border-left: 3px solid var(--c);
    border-radius: 8px;
    padding: 12px 14px;
    .k-label {
      font-size: 12px;
      color: #8a97a8;
    }
    .k-value {
      font-size: 20px;
      font-weight: 700;
      color: #0b1e33;
      margin-top: 4px;
      .k-unit {
        font-size: 12px;
        font-weight: 400;
        color: #8a97a8;
        margin-left: 3px;
      }
    }
  }
}
</style>

<script setup lang="ts">
import { rainStorage } from "../demo/water";
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { NButton, NDataTable, NSelect, NTag } from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import Chart from "../Chart.vue";
import { useDemoStore } from "../demo/store";
import { summarizeLedger, toCsv } from "../demo/water";
import type { LedgerEntry } from "../demo/types";

type WaterMode = "overview" | "ledger" | "rainfall";

const route = useRoute();
const router = useRouter();
const store = useDemoStore();

const mode = computed<WaterMode>(() => {
  if (route.path === "/water/ledger") return "ledger";
  if (route.path === "/water/rainfall") return "rainfall";
  return "overview";
});

const numberFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "缺数";
  return numberFormat.format(value);
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------ 总览 ------------------------------ */

const ledgerEntries = computed<LedgerEntry[]>(() => store.seed.ledger);

function ledgerVolume(sourceType: string, direction: "in" | "out"): number | null {
  const rows = ledgerEntries.value.filter(
    (entry) => entry.sourceType === sourceType && entry.direction === direction,
  );
  if (!rows.length) return null;
  return rows.reduce((sum, entry) => sum + entry.volume, 0);
}

const latestRain = computed(
  () => store.seed.rainEvents[store.seed.rainEvents.length - 1] ?? null,
);

const latestRainStorage = computed(() => rainStorage(latestRain.value).end?.total ?? null);

const rainIn = computed(() => ledgerVolume("雨水", "in"));
const tapIn = computed(() => ledgerVolume("自来水", "in"));
const reuseOut = computed(() => ledgerVolume("中水", "out"));

/* ------------------------------ 账本 ------------------------------ */

const sourceFilter = ref("all");
const directionFilter = ref("all");
const periodFrom = ref("all");
const periodTo = ref("all");

const sourceOptions = computed(() => {
  const types = [...new Set(ledgerEntries.value.map((entry) => entry.sourceType))];
  return [
    { label: "全部来源", value: "all" },
    ...types.map((type) => ({ label: type, value: type })),
  ];
});

const directionOptions = [
  { label: "全部方向", value: "all" },
  { label: "进（入库/取水）", value: "in" },
  { label: "出（回用/外排）", value: "out" },
];

const periodOptions = computed(() => {
  const periods = [...new Set(ledgerEntries.value.map((entry) => entry.period))].sort();
  return [{ label: "全部周期", value: "all" }, ...periods.map((period) => ({ label: period, value: period }))];
});

const filteredLedger = computed(() =>
  ledgerEntries.value
    .filter((entry) => sourceFilter.value === "all" || entry.sourceType === sourceFilter.value)
    .filter(
      (entry) => directionFilter.value === "all" || entry.direction === directionFilter.value,
    )
    .filter(
      (entry) =>
        periodFrom.value === "all" || entry.period.localeCompare(periodFrom.value) >= 0,
    )
    .filter(
      (entry) => periodTo.value === "all" || entry.period.localeCompare(periodTo.value) <= 0,
    )
    .slice()
    .sort((a, b) => a.period.localeCompare(b.period) || a.sourceType.localeCompare(b.sourceType)),
);

interface LedgerTableRow extends LedgerEntry {
  directionLabel: string;
  volumeLabel: string;
  sourceLabel: string;
}

const directionLabels: Record<LedgerEntry["direction"], string> = {
  in: "进",
  out: "出",
};

const ledgerRows = computed<LedgerTableRow[]>(() =>
  filteredLedger.value.map((entry) => ({
    ...entry,
    directionLabel: directionLabels[entry.direction],
    volumeLabel: `${formatVolume(entry.volume)} ${entry.unit}`,
    sourceLabel: entry.source,
  })),
);

const ledgerColumns: DataTableColumns<LedgerTableRow> = [
  { title: "周期", key: "period", width: 100 },
  { title: "来源类型", key: "sourceType", width: 110 },
  { title: "方向", key: "directionLabel", width: 64 },
  { title: "水量", key: "volumeLabel", width: 132, align: "right" },
  { title: "数据来源", key: "sourceLabel", width: 120 },
  { title: "口径说明", key: "note", minWidth: 300, ellipsis: { tooltip: true } },
];

const filteredSummary = computed(() => summarizeLedger(filteredLedger.value));

const trendLabels = computed(() => {
  const periods = [...new Set(filteredLedger.value.map((entry) => entry.period))].sort();
  return periods.length ? periods : ["暂无周期"];
});

const trendSeries = computed(() => {
  const periods = trendLabels.value;
  const groups = new Map<string, { name: string; values: number[]; unit: string }>();
  for (const entry of filteredLedger.value) {
    const name = `${entry.sourceType}（${directionLabels[entry.direction]}）`;
    const group = groups.get(name) ?? { name, values: periods.map(() => 0), unit: entry.unit };
    const index = periods.indexOf(entry.period);
    if (index >= 0) group.values[index] += entry.volume;
    groups.set(name, group);
  }
  return [...groups.values()];
});

function exportLedgerCsv(): void {
  const headers = ["周期", "来源类型", "方向", "水量", "单位", "数据来源", "口径说明"];
  const rows = filteredLedger.value.map((entry) => [
    entry.period,
    entry.sourceType,
    directionLabels[entry.direction],
    entry.volume,
    entry.unit,
    entry.source,
    entry.note,
  ]);
  downloadCsv(`水量账本-${filteredSummary.value.rows.length}组-20261114.csv`, toCsv(headers, rows));
}

/* ------------------------------ 雨次 ------------------------------ */

const rainEvents = computed(() => store.seed.rainEvents);
const selectedRainId = ref("");

if (!selectedRainId.value && rainEvents.value.length) {
  selectedRainId.value = rainEvents.value[rainEvents.value.length - 1].id;
}

watch(
  () => rainEvents.value.map((event) => event.id).join("|"),
  () => {
    if (!rainEvents.value.some((event) => event.id === selectedRainId.value)) {
      selectedRainId.value = rainEvents.value[rainEvents.value.length - 1]?.id ?? "";
    }
  },
);

const selectedRain = computed(
  () => rainEvents.value.find((event) => event.id === selectedRainId.value) ?? null,
);

const rainChartType = ref<"line" | "bar">("line");

const rainLabels = computed(() => {
  if (!selectedRain.value) return [];
  return selectedRain.value.north.map((_, index) => `${index + 1}h`);
});

const rainSeries = computed(() => {
  if (!selectedRain.value) return [];
  return [
    { name: "北区储量", values: selectedRain.value.north, unit: selectedRain.value.unit },
    { name: "南区储量", values: selectedRain.value.south, unit: selectedRain.value.unit },
  ];
});

const rainStats = computed(() => {
  const {end, peak, rise} = rainStorage(selectedRain.value);
  return {endTotal: end?.total ?? null, peak, increment: rise, northEnd: end?.north ?? null, southEnd: end?.south ?? null};
});

interface RainCompareRow {
  id: string;
  name: string;
  rainfall: string;
  northEnd: string;
  southEnd: string;
  endTotal: string;
  peak: string;
  source: string;
}

const rainCompareRows = computed<RainCompareRow[]>(() =>
  rainEvents.value.map((event) => {
    const {end, peak} = rainStorage(event);
    return {
      id: event.id,
      name: event.name,
      rainfall: `${event.rainfallMm} mm`,
      northEnd: formatVolume(end?.north ?? null),
      southEnd: formatVolume(end?.south ?? null),
      endTotal: formatVolume(end?.total ?? null),
      peak: formatVolume(peak),
      source: event.source,
    };
  }),
);

function goFourPre(): void {
  if (!selectedRain.value) return;
  void router.push({
    name: "four-pre",
    query: { rainEventId: selectedRain.value.id },
  });
}

function goAiWorkspace(): void {
  if (!selectedRain.value) return;
  void router.push({
    name: "ai-workspace",
    query: { rainEventIds: selectedRain.value.id },
  });
}
</script>

<template>
  <section class="water-page">
    <!-- 水资源总览 -->
    <template v-if="mode === 'overview'">
      <div class="stat-grid">
        <div class="stat-card storage">
          <span>最近雨次末段储量</span>
          <strong>
            {{ formatVolume(latestRainStorage) }}<small>m³</small>
          </strong>
          <small class="stat-hint">
            最近雨次末段南北分区合计 · {{ latestRain ? latestRain.name : "缺数" }}
          </small>
        </div>
        <div class="stat-card rain">
          <span>最近雨次</span>
          <strong>
            {{ latestRain ? latestRain.rainfallMm : "缺数" }}<small>mm</small>
          </strong>
          <small class="stat-hint">{{ latestRain ? latestRain.name : "种子无雨次" }}</small>
        </div>
        <div class="stat-card reuse">
          <span>回用量</span>
          <strong>{{ formatVolume(reuseOut) }}<small>m³</small></strong>
          <small class="stat-hint">中水外供，单列不重复计入取水</small>
        </div>
        <div class="stat-card supply">
          <span>补水 / 外供</span>
          <div class="split-values">
            <strong>{{ formatVolume(tapIn) }}<small>m³</small></strong>
            <span class="divider">/</span>
            <strong>{{ formatVolume(reuseOut) }}<small>m³</small></strong>
          </div>
          <small class="stat-hint">左：自来水补水 · 右：中水外供</small>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>逻辑水网示意</h2>
            <p>
              按来源与去向展示水量的逻辑关系，不是物理管网拓扑；雨水回用只作为回用量单列。
            </p>
          </div>
          <NTag size="small" :bordered="false" type="info">逻辑视图 · 非物理拓扑</NTag>
        </div>

        <div class="network-wrap">
          <svg viewBox="0 0 1000 360" role="img" aria-label="水资源逻辑水网示意图">
            <defs>
              <marker
                id="water-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="#7fb7d5" />
              </marker>
              <marker
                id="water-arrow-reuse"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="#54a892" />
              </marker>
            </defs>

            <path class="flow" d="M210 88 H280" marker-end="url(#water-arrow)" />
            <path class="flow" d="M460 88 H540" marker-end="url(#water-arrow)" />
            <path class="flow" d="M710 88 H800" marker-end="url(#water-arrow)" />
            <path class="flow" d="M210 268 H280" marker-end="url(#water-arrow)" />
            <path class="flow" d="M460 268 H540" marker-end="url(#water-arrow)" />
            <path
              class="flow reuse"
              d="M370 126 V230"
              marker-end="url(#water-arrow-reuse)"
            />

            <g class="node rain">
              <rect x="40" y="50" width="170" height="76" rx="8" />
              <text class="title" x="58" y="76">雨水收集池</text>
              <text class="value" x="58" y="98">{{ formatVolume(rainIn) }} m³ 进项</text>
              <text class="sub" x="58" y="114">来源：降雨径流</text>
            </g>
            <g class="node treat">
              <rect x="280" y="50" width="180" height="76" rx="8" />
              <text class="title" x="298" y="76">处理 / 回用</text>
              <text class="value" x="298" y="98">去向：中水或水池</text>
              <text class="sub" x="298" y="114">处理能力为演示假设</text>
            </g>
            <g class="node reuse">
              <rect x="540" y="50" width="170" height="76" rx="8" />
              <text class="title" x="558" y="76">中水外供</text>
              <text class="value" x="558" y="98">{{ formatVolume(reuseOut) }} m³ 回用</text>
              <text class="sub" x="558" y="114">不重复计入新增取水</text>
            </g>
            <g class="node process">
              <rect x="800" y="50" width="160" height="76" rx="8" />
              <text class="title" x="818" y="76">工艺用水</text>
              <text class="value" x="818" y="98">去向：除尘 / 生产</text>
              <text class="sub" x="818" y="114">按需水单元分配</text>
            </g>

            <g class="node tap">
              <rect x="40" y="230" width="170" height="76" rx="8" />
              <text class="title" x="58" y="256">市政自来水</text>
              <text class="value" x="58" y="278">{{ formatVolume(tapIn) }} m³ 补水</text>
              <text class="sub" x="58" y="294">来源：外部补水计量</text>
            </g>
            <g class="node pool">
              <rect x="280" y="230" width="180" height="76" rx="8" />
              <text class="title" x="298" y="256">生产水池</text>
              <text class="value" x="298" y="278">有效容量 3,200 m³</text>
              <text class="sub" x="298" y="294">演示参数，非在线液位</text>
            </g>
            <g class="node supply">
              <rect x="540" y="230" width="180" height="76" rx="8" />
              <text class="title" x="558" y="256">生产供水泵组</text>
              <text class="value" x="558" y="278">去向：生产 / 除尘</text>
              <text class="sub" x="558" y="294">运行状态见工艺页</text>
            </g>

            <text class="flow-label" x="232" y="78">收集</text>
            <text class="flow-label" x="482" y="78">处理</text>
            <text class="flow-label" x="732" y="78">外供</text>
            <text class="flow-label" x="232" y="258">补水</text>
            <text class="flow-label" x="482" y="258">供水</text>
            <text class="flow-label reuse-text" x="382" y="180">回用（单列）</text>
          </svg>
        </div>

        <div class="legend-row">
          <span><i class="legend-line" /> 常规水流</span>
          <span><i class="legend-line reuse" /> 雨水回用（不重复计量）</span>
          <NTag size="tiny" :bordered="false">MOCK / REFERENCE / CALCULATED</NTag>
          <span class="muted">口径：账本自然月；未接入电耗、在线液位与地下管网拓扑。</span>
        </div>
      </section>

      <div class="overview-bottom">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>下钻与联动</h2>
              <p>总览只保留关键指标，完整明细在水量账本与雨次分析中查看。</p>
            </div>
          </div>
          <div class="quick-links">
            <RouterLink class="quick-link" to="/water/ledger">
              <strong>水量账本 →</strong>
              <span>按来源类型、方向与周期筛选，支持 CSV 导出。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/water/rainfall">
              <strong>雨次分析 →</strong>
              <span>三次降雨的南北分区储量对比，可进入四预或生成分析图。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/water/dispatch">
              <strong>雨前智能调蓄 →</strong>
              <span>比较维持现状、雨前腾库、处理回用三种方案的风险与增量经济性。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/water/multi-source">
              <strong>多水源协同优化 →</strong>
              <span>按水质、管网和供水能力约束，计算雨水、中水、自来水的用水分配与经济比选。</span>
            </RouterLink>
          </div>
        </section>

        <details class="panel caliber">
          <summary>计量口径说明（点击展开）</summary>
          <dl>
            <div>
              <dt>数据来源</dt>
              <dd>
                本地固定种子 {{ store.seedVersion }}；雨次与账本均为 MOCK / CALCULATED
                演示数据，不请求后端。
              </dd>
            </div>
            <div>
              <dt>统计边界</dt>
              <dd>
                按自然月账本口径，南北分区合并展示。中水外供来自雨水回用，只作为回用量单列，
                不再叠加为新增取水或自来水补水。
              </dd>
            </div>
            <div>
              <dt>缺数指标</dt>
              <dd>
                电耗、实时液位、气象预报与地下管网拓扑未接入，统一显示“缺数”，不生成替代曲线。
              </dd>
            </div>
            <div>
              <dt>模拟声明</dt>
              <dd>
                所有数值为演示假设，不代表真实计量、收费或调度依据；逻辑水网不是物理拓扑。
              </dd>
            </div>
          </dl>
        </details>
      </div>
    </template>

    <!-- 水量账本 -->
    <template v-else-if="mode === 'ledger'">
      <div class="stat-grid">
        <div class="stat-card in">
          <span>筛选范围进水量</span>
          <strong>{{ formatVolume(filteredSummary.totalIn) }}<small>m³</small></strong>
          <small class="stat-hint">雨水 + 自来水等进项合计</small>
        </div>
        <div class="stat-card out">
          <span>筛选范围出水量</span>
          <strong>{{ formatVolume(filteredSummary.totalOut) }}<small>m³</small></strong>
          <small class="stat-hint">回用、外排与处理去向合计</small>
        </div>
        <div class="stat-card reuse">
          <span>其中回用量</span>
          <strong>{{ formatVolume(filteredSummary.reuseVolume) }}<small>m³</small></strong>
          <small class="stat-hint">中水外供，单列不重复计入取水</small>
        </div>
        <div class="stat-card diff">
          <span>账本净差</span>
          <strong>{{ formatVolume(filteredSummary.difference) }}<small>m³</small></strong>
          <small class="stat-hint">账面进−出，不等同储量变化</small>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>水量账本明细</h2>
            <p>数据全部来自同一份 {{ store.seedVersion }} 种子，按来源类型与流向汇总。</p>
          </div>
          <NButton size="small" type="primary" secondary @click="exportLedgerCsv">
            导出 CSV
          </NButton>
        </div>

        <div class="filter-bar">
          <NSelect
            size="small"
            style="width: 150px"
            :value="sourceFilter"
            :options="sourceOptions"
            @update:value="(value: string) => (sourceFilter = value)"
          />
          <NSelect
            size="small"
            style="width: 150px"
            :value="directionFilter"
            :options="directionOptions"
            @update:value="(value: string) => (directionFilter = value)"
          />
          <span class="filter-label">时间范围</span>
          <NSelect
            size="small"
            style="width: 118px"
            :value="periodFrom"
            :options="periodOptions"
            @update:value="(value: string) => (periodFrom = value)"
          />
          <span class="range-sep">至</span>
          <NSelect
            size="small"
            style="width: 118px"
            :value="periodTo"
            :options="periodOptions"
            @update:value="(value: string) => (periodTo = value)"
          />
          <span class="result-count">共 {{ ledgerRows.length }} 条 / {{ filteredSummary.rows.length }} 组口径</span>
        </div>

        <NDataTable
          size="small"
          :columns="ledgerColumns"
          :data="ledgerRows"
          :pagination="false"
          :scroll-x="920"
          :bordered="false"
        />
        <p v-if="!ledgerRows.length" class="empty">
          当前筛选条件下没有账本记录，请调整来源类型、方向或时间范围。
        </p>

        <div class="note-box">{{ filteredSummary.note }}</div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>周期与来源趋势</h2>
            <p>按当前筛选后的周期与来源类型汇总，单位为种子账本单位 m³。</p>
          </div>
          <NTag size="small" :bordered="false">CALCULATED</NTag>
        </div>
        <Chart
          v-if="trendSeries.length"
          :labels="trendLabels"
          :series="trendSeries"
          type="bar"
          :height="260"
        />
        <p v-else class="empty">暂无可绘制的周期数据，不生成空曲线。</p>
      </section>

      <details class="panel caliber" open>
        <summary>账本口径与数据来源</summary>
        <dl>
          <div>
            <dt>数据来源</dt>
            <dd>
              固定种子 {{ store.seedVersion }} 的 ledger 记录，来源标签含 MOCK / REFERENCE /
              CALCULATED；不使用后端接口。
            </dd>
          </div>
          <div>
            <dt>统计边界</dt>
            <dd>
              账本按自然月记录；中水外供为雨水回用，单列为“回用量”，不重复叠加到新增取水。
              生活污水与含矿污水按各自口径单列。
            </dd>
          </div>
          <div>
            <dt>缺数说明</dt>
            <dd>电耗、在线液位与实时流量未接入，相关指标显示“缺数”，不补造曲线。</dd>
          </div>
        </dl>
      </details>
    </template>

    <!-- 雨次与储量分析 -->
    <template v-else>
      <section class="panel rain-selector">
        <div class="panel-head">
          <div>
            <h2>雨次选择</h2>
            <p>选择一次降雨过程，对比南北分区储量；数据来自同一雨次种子。</p>
          </div>
          <NTag size="small" :bordered="false">MOCK 固定种子</NTag>
        </div>
        <div class="rain-chips">
          <button
            v-for="event in rainEvents"
            :key="event.id"
            type="button"
            class="rain-chip"
            :class="{ active: event.id === selectedRainId }"
            @click="selectedRainId = event.id"
          >
            <strong>{{ event.id }}</strong>
            <span>{{ event.occurredAt.slice(0, 10) }} · {{ event.rainfallMm }} mm</span>
          </button>
        </div>
      </section>

      <div v-if="selectedRain" class="stat-grid">
        <div class="stat-card rain">
          <span>场次降雨量</span>
          <strong>{{ selectedRain.rainfallMm }}<small>mm</small></strong>
          <small class="stat-hint">{{ selectedRain.name }}</small>
        </div>
        <div class="stat-card storage">
          <span>末段总储量</span>
          <strong>{{ formatVolume(rainStats.endTotal) }}<small>m³</small></strong>
          <small class="stat-hint">
            北 {{ formatVolume(rainStats.northEnd) }} · 南 {{ formatVolume(rainStats.southEnd) }}
          </small>
        </div>
        <div class="stat-card peak">
          <span>峰值储量</span>
          <strong>{{ formatVolume(rainStats.peak) }}<small>m³</small></strong>
          <small class="stat-hint">南北合计逐时刻最大值</small>
        </div>
        <div class="stat-card reuse">
          <span>相对起始增量</span>
          <strong>{{ formatVolume(rainStats.increment) }}<small>m³</small></strong>
          <small class="stat-hint">峰值 − 首时刻合计</small>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>南北分区储量对比</h2>
            <p v-if="selectedRain">
              {{ selectedRain.id }} · 来源标签 {{ selectedRain.source }} · 单位
              {{ selectedRain.unit }}
            </p>
          </div>
          <div class="chart-mode">
            <NButton
              size="tiny"
              :type="rainChartType === 'line' ? 'primary' : 'default'"
              :secondary="rainChartType !== 'line'"
              @click="rainChartType = 'line'"
            >
              折线
            </NButton>
            <NButton
              size="tiny"
              :type="rainChartType === 'bar' ? 'primary' : 'default'"
              :secondary="rainChartType !== 'bar'"
              @click="rainChartType = 'bar'"
            >
              柱状
            </NButton>
          </div>
        </div>
        <Chart
          v-if="selectedRain"
          :labels="rainLabels"
          :series="rainSeries"
          :type="rainChartType"
          :height="300"
        />
        <p v-else class="empty">种子中没有雨次数据，显示缺数。</p>

        <p v-if="selectedRain?.simulation" class="muted">
          演示假设 · 均匀降雨、分区独立计算。
          累计溢流：北 {{ formatVolume(selectedRain.simulation.northOverflow) }} m³，
          南 {{ formatVolume(selectedRain.simulation.southOverflow) }} m³。
        </p>
        <div class="action-row">
          <NButton type="primary" :disabled="!selectedRain" @click="goFourPre">
            进入四预（携带雨次 ID）
          </NButton>
          <NButton secondary :disabled="!selectedRain" @click="goAiWorkspace">
            生成分析图
          </NButton>
          <span class="muted">
            四预将载入这次降雨的分区演示参数。
          </span>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>三次雨次概览</h2>
            <p>三次雨次使用同一种子系列，可切换上方雨次查看曲线细节。</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>雨次</th>
                <th>发生日期</th>
                <th>降雨量</th>
                <th>北区末段</th>
                <th>南区末段</th>
                <th>末段合计</th>
                <th>峰值合计</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rainCompareRows"
                :key="row.id"
                :class="{ selected: row.id === selectedRainId }"
                @click="selectedRainId = row.id"
              >
                <td>{{ row.id }}</td>
                <td>{{ row.name.replace(' 降雨过程', '') }}</td>
                <td>{{ row.rainfall }}</td>
                <td>{{ row.northEnd }} m³</td>
                <td>{{ row.southEnd }} m³</td>
                <td>{{ row.endTotal }} m³</td>
                <td>{{ row.peak }} m³</td>
                <td>{{ row.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="note-box">
          说明：南北分区采用独立的演示汇水参数，末段合计取最后一个共同有效小时，未假设未证实的地下管网拓扑、分区连通关系或调度规则；
          峰值与增量仅用于演示趋势，不代表真实库容或防洪能力。
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.water-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 16px 18px;
  border-radius: 10px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-left: 3px solid #b3c3cf;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(236, 246, 252, 0.9));
  box-shadow: 0 8px 20px rgba(36, 123, 168, 0.06);
}

.stat-card.storage {
  border-left-color: #247ba8;
}
.stat-card.rain {
  border-left-color: #54a892;
}
.stat-card.reuse {
  border-left-color: #7a9cbf;
}
.stat-card.supply,
.stat-card.diff {
  border-left-color: #e1a249;
}
.stat-card.in {
  border-left-color: #247ba8;
}
.stat-card.out {
  border-left-color: #d0574f;
}
.stat-card.peak {
  border-left-color: #e1a249;
}

.stat-card > span {
  font-size: 12px;
  color: #6a8298;
}
.stat-card strong {
  font-size: 24px;
  color: #1c3e57;
  white-space: nowrap;
}
.stat-card strong small {
  margin-left: 3px;
  font-size: 11px;
  color: #6a8298;
}
.stat-hint {
  font-size: 10.5px;
  color: #8ba0b2;
  line-height: 1.5;
}
.split-values {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.split-values .divider {
  color: #b3c3cf;
  font-size: 15px;
}

.panel {
  min-width: 0;
  padding: 18px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel-head h2 {
  margin: 0;
  font-size: 17px;
  color: #1c3e57;
}
.panel-head p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #748a9d;
  line-height: 1.7;
}

.network-wrap {
  width: 100%;
  overflow: hidden;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(240, 248, 253, 0.9), rgba(248, 252, 255, 0.9)),
    repeating-linear-gradient(90deg, transparent 0 39px, rgba(36, 123, 168, 0.04) 39px 40px),
    repeating-linear-gradient(0deg, transparent 0 39px, rgba(36, 123, 168, 0.04) 39px 40px);
  border: 1px solid #e1eef6;
  padding: 6px;
}
.network-wrap svg {
  display: block;
  width: 100%;
  height: auto;
}
.node rect {
  fill: rgba(255, 255, 255, 0.94);
  stroke: #a8cfe4;
  stroke-width: 1.2;
}
.node.rain rect,
.node.pool rect {
  fill: #f1f9fd;
  stroke: #8fc3de;
}
.node.reuse rect {
  fill: #f0faf6;
  stroke: #9fd3c3;
}
.node.tap rect {
  fill: #fffaf0;
  stroke: #e7c98e;
}
.node .title {
  font-size: 14px;
  font-weight: 600;
  fill: #1c3e57;
}
.node .value {
  font-size: 12px;
  fill: #247ba8;
}
.node .sub {
  font-size: 10px;
  fill: #7c91a4;
}
.flow {
  fill: none;
  stroke: #7fb7d5;
  stroke-width: 1.6;
}
.flow.reuse {
  stroke: #54a892;
  stroke-dasharray: 5 4;
}
.flow-label {
  font-size: 10.5px;
  fill: #5c87a1;
}
.flow-label.reuse-text {
  fill: #3f8d7a;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 11px;
  color: #6b8194;
}
.legend-line {
  display: inline-block;
  width: 22px;
  height: 2px;
  margin-right: 5px;
  vertical-align: middle;
  background: #7fb7d5;
}
.legend-line.reuse {
  background: repeating-linear-gradient(90deg, #54a892 0 4px, transparent 4px 7px);
}

.overview-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.quick-links {
  display: grid;
  gap: 10px;
}
.quick-link {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 9px;
  border: 1px solid #dcebf4;
  background: #f8fcff;
  color: #2a4660;
}
.quick-link:hover {
  background: #eef7fc;
}
.quick-link strong {
  font-size: 13px;
  color: #1c6a99;
}
.quick-link span {
  font-size: 11.5px;
  color: #71869a;
  line-height: 1.6;
}

.caliber summary {
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: #1c3e57;
}
.caliber dl {
  margin: 12px 0 0;
  border-top: 1px solid #e4eef5;
}
.caliber dl > div {
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid #e4eef5;
}
.caliber dt {
  font-size: 12px;
  color: #71869a;
}
.caliber dd {
  margin: 0;
  font-size: 12px;
  color: #3d566c;
  line-height: 1.7;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 12px;
}
.filter-label {
  font-size: 11px;
  color: #71869a;
}
.range-sep {
  font-size: 11px;
  color: #8ba0b2;
}
.result-count {
  margin-left: auto;
  font-size: 11px;
  color: #8296a8;
  white-space: nowrap;
}
.note-box {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f2f7fb;
  font-size: 11px;
  color: #6b8194;
  line-height: 1.75;
}
.empty {
  margin: 10px 0 0;
  font-size: 12px;
  color: #8296a8;
}

.rain-selector {
  padding-bottom: 12px;
}
.rain-chips {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.rain-chip {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 170px;
  padding: 10px 14px;
  border: 1px solid #dcebf4;
  border-radius: 9px;
  background: #f8fcff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s;
}
.rain-chip:hover {
  background: #eef7fc;
}
.rain-chip.active {
  border-color: #247ba8;
  background: #e8f4fb;
  box-shadow: inset 2px 0 0 #247ba8;
}
.rain-chip strong {
  font-size: 12px;
  color: #1c3e57;
}
.rain-chip span {
  font-size: 11px;
  color: #7c91a4;
}

.chart-mode {
  display: flex;
  gap: 6px;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.muted {
  font-size: 11px;
  color: #8296a8;
}

.table-wrap {
  width: 100%;
  overflow-x: auto;
}
.data-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 12px;
}
.data-table th {
  text-align: left;
  padding: 8px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
  white-space: nowrap;
}
.data-table td {
  padding: 9px 8px;
  border-bottom: 1px solid #e6eef4;
  color: #2a4660;
  white-space: nowrap;
}
.data-table tbody tr {
  cursor: pointer;
}
.data-table tbody tr:hover {
  background: #eef7fc;
}
.data-table tbody tr.selected {
  background: #e8f4fb;
}

@media (max-width: 1280px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .overview-bottom {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

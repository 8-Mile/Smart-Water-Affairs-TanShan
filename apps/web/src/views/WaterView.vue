<script setup lang="ts">
import WorkspaceNav from "../components/WorkspaceNav.vue";
import { rainStorage } from "../demo/water";
import { computed, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { NButton, NDataTable, NInput, NSelect, NTag, useMessage } from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import Chart from "../Chart.vue";
import { useDemoStore } from "../demo/store";
import { summarizeLedger, toCsv } from "../demo/water";
import { classifyWaterAccounting, waterAccountingSnapshot } from "../demo/waterAccounting";
import type { LedgerEntry } from "../demo/types";
import {can} from "../demo/permissions";
import {submitWaterTrace,reviewWaterTrace,readWaterTraces,type WaterTraceRecord} from "../demo/waterTrace";

type WaterMode = "overview" | "ledger" | "rainfall";

const route = useRoute();
const router = useRouter();
const store = useDemoStore();
const message=useMessage();
const selectedEntryId=ref(typeof route.query.entryId==="string"?route.query.entryId:"");
const traceRows=ref<WaterTraceRecord[]>(readWaterTraces(localStorage,store.scenarioId));
const selectedEntry=computed(()=>ledgerEntries.value.find(x=>x.id===selectedEntryId.value)??null);
const selectedTrace=computed(()=>traceRows.value.find(x=>x.entryId===selectedEntryId.value));
const canRegister=computed(()=>can(store.role,"engineering:submit"));
const canReview=computed(()=>can(store.role,"engineering:review"));
const traceInput=reactive({pointLabel:"",destination:"",evidenceRef:"",note:"",reviewNote:""});
function refreshTraces(){traceRows.value=readWaterTraces(localStorage,store.scenarioId);}
function chooseLedger(entry:LedgerEntry){
 selectedEntryId.value=entry.id;
 const query={...route.query,entryId:entry.id};
 void router.replace({path:route.path,query});
}
function submitTrace(){
 const item=selectedEntry.value;if(!item)return;
 try{
  submitWaterTrace(localStorage,{
   scenarioId:store.scenarioId,entryId:item.id,actor:store.role,now:new Date().toISOString(),...traceInput,
  });
  refreshTraces();message.success("映射登记已提交待审（用户录入），未标记现场核实");
 }catch(e){message.error((e as Error).message);}
}
function reviewTrace(approved:boolean){
 const item=selectedTrace.value;if(!item)return;
 try{
  reviewWaterTrace(localStorage,item.id,store.role,approved,traceInput.reviewNote,new Date().toISOString());
  refreshTraces();traceInput.reviewNote="";
  message.success("已记录内部审核；未自动确认物理管线连通");
 }catch(e){message.error((e as Error).message);}
}
watch(()=>store.scenarioId,refreshTraces);
watch(()=>route.query.entryId,(id)=>{selectedEntryId.value=typeof id==="string"?id:"";});
const traceLabel=(entry:LedgerEntry)=>classifyWaterAccounting(entry);
const rowProps=(row:LedgerTableRow)=>({onClick:()=>chooseLedger(row),style:"cursor:pointer"});


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


const rainIn = computed(() => ledgerVolume("雨水", "in"));
const tapIn = computed(() => ledgerVolume("自来水", "in"));
const reuseOut = computed(() => ledgerVolume("中水", "out"));
const accounting = computed(() => waterAccountingSnapshot(ledgerEntries.value));
const circulationVolume = computed(() => accounting.value.circulatingM3);

/* ------------------------------ 账本 ------------------------------ */

const sourceFilter = ref("all");
watch(()=>route.query.source,value=>{
 sourceFilter.value=typeof value==="string"&&value.trim()?value:"all";
},{immediate:true});
function changeLedgerSource(value:string){
 sourceFilter.value=value;
 const query={...route.query};if(value==="all")delete query.source;else query.source=value;
 delete query.entryId;selectedEntryId.value="";
 void router.replace({path:route.path,query});
}
const directionFilter = ref("all");
const periodFrom = ref("all");
const periodTo = ref("all");

const sourceOptions = computed(() => {
  const types = [...new Set(ledgerEntries.value.map((entry) => entry.sourceType))];
  return [
    { label: "全部来源", value: "all" },
    ...[...new Set([...types,"循环水"])].map((type) => ({ label: type, value: type })),
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
  categoryLabel: string;
  stageLabel: string;
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
    categoryLabel: classifyWaterAccounting(entry).category,
    stageLabel: classifyWaterAccounting(entry).stage,
  })),
);

const ledgerColumns: DataTableColumns<LedgerTableRow> = [
  { title: "周期", key: "period", width: 100 },
  { title: "来源类型", key: "sourceType", width: 110 },
  { title: "循环利用归属", key: "categoryLabel", width: 135 },
  { title: "水流环节", key: "stageLabel", width: 210 },
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
  const headers = ["周期", "来源类型", "循环利用归属", "水流环节", "方向", "水量", "单位", "数据来源", "口径说明"];
  const rows = filteredLedger.value.map((entry) => [
    entry.period,
    entry.sourceType,
    classifyWaterAccounting(entry).category,
    classifyWaterAccounting(entry).stage,
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
    <WorkspaceNav label="水资源循环利用" :items="[{name:'循环利用总览',to:'/water/overview'},{name:'雨次分析',to:'/water/rainfall'},{name:'水量账本',to:'/water/ledger'}]" />
    <!-- 水资源总览 -->
    <template v-if="mode === 'overview'">
      <div class="stat-grid">
        <RouterLink class="stat-card storage water-drill" to="/water/ledger?source=自来水&returnTo=/water/overview">
          <span>自来水补水量</span>
          <strong>{{ formatVolume(tapIn) }}<small>m³</small></strong>
          <small class="stat-hint">自然月账本进项 · 点击核查明细</small>
        </RouterLink>
        <RouterLink class="stat-card rain water-drill" to="/water/ledger?source=中水&returnTo=/water/overview">
          <span>中水实际外供量</span>
          <strong>{{ formatVolume(reuseOut) }}<small>m³</small></strong>
          <small class="stat-hint">MOCK 外供 · 点击核查 · 不代表末端消耗</small>
        </RouterLink>
        <RouterLink class="stat-card reuse water-drill" to="/water/ledger?source=循环水&returnTo=/water/overview">
          <span>循环水循环量</span>
          <strong>{{ formatVolume(circulationVolume) }}<small>m³</small></strong>
          <small class="stat-hint">缺少洗车台及其他循环回路计量 · 点击核查缺数环节</small>
        </RouterLink>
        <RouterLink class="stat-card supply water-drill" to="/water/ledger?source=雨水&returnTo=/water/overview">
          <span>雨水收集量（循环利用子项）</span>
          <strong>{{ formatVolume(rainIn) }}<small>m³</small></strong>
          <small class="stat-hint">仅雨水入池 · 点击核查来源和环节</small>
        </RouterLink>
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
              <p>自来水、中水、循环水分口径展示；雨水入池与处理后回用不重复累计。</p>
            </div>
          </div>
          <div class="quick-links">
            <RouterLink class="quick-link" to="/water/machine-supply?returnTo=/water/overview">
              <strong>各大机供水保障 →</strong>
              <span>按作业需求和供水能力比较，发现缺口并给出核查方向。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/water/balance?returnTo=/water/overview">
              <strong>供需动态平衡 →</strong>
              <span>同周期分析雨水入池、处理、清水储存、回用消纳及大机需求。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/data/reports?reportId=water-ledger&returnTo=/water/overview">
              <strong>生成水资源账本报表 →</strong>
              <span>直达对应报表，可核对来源口径并导出CSV。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/water/ledger">
              <strong>水量账本 →</strong>
              <span>按来源类型、方向与周期筛选，支持 CSV 导出。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/water/rainfall">
              <strong>雨次分析 →</strong>
              <span>三次降雨的南北分区储量对比，可进入四预或生成分析图。</span>
            </RouterLink>
            <RouterLink class="quick-link" to="/water/dispatch">
              <strong>雨前智能调蓄（专项）→</strong>
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
                以来源、处理环节和终端用途分账：雨水入池是收集量，中水外供是回用量，
                洗车等循环水应按回路循环量另计；相同水量跨工序流转不可相加。
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
          <span>跨环节出项（不可直接累计）</span>
          <strong>{{ formatVolume(filteredSummary.totalOut) }}<small>m³</small></strong>
          <small class="stat-hint">回用、外排与处理去向合计</small>
        </div>
        <div class="stat-card reuse">
          <span>其中回用量</span>
          <strong>{{ formatVolume(filteredSummary.reuseVolume) }}<small>m³</small></strong>
          <small class="stat-hint">仅中水外供已知；洗车及其他循环水缺表</small>
        </div>
        <div class="stat-card diff">
          <span>账面进出差（非漏损）</span>
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
            @update:value="changeLedgerSource"
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
          :scroll-x="1200"
          :bordered="false"
          :row-props="rowProps"
        />
        <p v-if="!ledgerRows.length" class="empty">
          当前筛选条件下没有账本记录，请调整来源类型、方向或时间范围。
        </p>

        <section v-if="selectedEntry" class="ledger-trace">
          <h3>选中水量记录 · {{selectedEntry.id}}</h3>
          <p>当前仅列示固定种子账本，所有现场管网和末端关系需人工确认。点击表格其他行可切换。</p>
          <dl class="trace-facts">
           <div><dt>来源 / 时间</dt><dd>{{selectedEntry.sourceType}} · {{selectedEntry.period}} · {{selectedEntry.source}}</dd></div>
           <div><dt>环节与口径</dt><dd>{{traceLabel(selectedEntry).stage}} / {{traceLabel(selectedEntry).category}}</dd></div>
           <div><dt>方向与水量</dt><dd>{{selectedEntry.direction==='in'?'入账':'出账'}} {{formatVolume(selectedEntry.volume)}} {{selectedEntry.unit}}</dd></div>
           <div><dt>原始口径说明</dt><dd>{{selectedEntry.note}}</dd></div>
           <div><dt>计量点</dt><dd>{{selectedTrace?.pointLabel??'未登记真实点位（缺数）'}}</dd></div>
           <div><dt>回路/实际用途</dt><dd>{{selectedTrace?.destination??'尚未核实实际用水终端或回路（缺数）'}}</dd></div>
          </dl>
          <div v-if="selectedTrace" class="trace-submitted">
            <NTag size="small" :type="selectedTrace.status==='reviewed'?'success':'warning'">{{selectedTrace.status==='reviewed'?'内部资料已审核（非现场验收）':selectedTrace.status==='rejected'?'审核不通过':'待内部资料审核'}}</NTag>
            <p>人工依据：{{selectedTrace.evidenceRef}} · {{selectedTrace.note}}</p>
            <p v-if="selectedTrace.reviewNote">复核说明：{{selectedTrace.reviewNote}}（仍需现场核实管线与计量）</p>
          </div>
          <div v-if="canRegister&&selectedTrace?.status!=='reviewed'" class="trace-form">
            <h4>登记计量点与去向（USER_ENTRY / 待审核）</h4>
            <NInput v-model:value="traceInput.pointLabel" size="small" placeholder="计量点编号/名称（需真实依据）"/>
            <NInput v-model:value="traceInput.destination" size="small" placeholder="终端/处理环节名称（未核实不得写已接通）"/>
            <NInput v-model:value="traceInput.evidenceRef" size="small" placeholder="图纸或测点资料编号"/>
            <NInput v-model:value="traceInput.note" size="small" placeholder="人工记录说明及待核条件"/>
            <NButton size="small" type="primary" @click="submitTrace">提交计量映射待审</NButton>
          </div>
          <div v-if="canReview&&selectedTrace?.status==='pending'" class="trace-form">
            <NInput v-model:value="traceInput.reviewNote" type="textarea" :rows="2" placeholder="内部资料复核说明（不等于现场验证）"/>
            <NButton size="small" type="primary" @click="reviewTrace(true)">审核资料引用</NButton>
            <NButton size="small" @click="reviewTrace(false)">退回核查</NButton>
          </div>
          <RouterLink :to="{path:'/engineering/registry',query:{focus:'topology',returnTo:route.fullPath}}">查看水路工程核查底账 →</RouterLink>
        </section>
        <p v-else-if="sourceFilter==='循环水'" class="ledger-trace">
          当前没有独立循环回路的流经量计量记录。不能用雨水入池量、中水外供量或处理量替代循环水循环量；
          应补齐洗车回路等计量点及实际用途后再统计。
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
.water-drill{color:inherit;text-decoration:none;cursor:pointer}
.water-drill:hover{outline:2px solid #92c9e3;outline-offset:2px}
.ledger-trace{padding:14px;border:1px solid #d7e7f1;border-radius:8px;background:#f7fcff;display:grid;gap:10px;color:#3a637b;font-size:12px}
.ledger-trace h3{margin:0;font-size:15px}.ledger-trace p{margin:0;line-height:1.6}
.trace-facts{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.trace-facts>div{padding:9px;background:white;border:1px solid #e3eef4;border-radius:7px;display:grid;gap:4px}
.trace-facts dt{font-size:11px;color:#8097a7}.trace-facts dd{margin:0;overflow-wrap:anywhere}
.trace-form{display:grid;gap:8px;border-top:1px solid #d7e7f1;padding-top:10px}
.trace-form h4{margin:0}
@media(max-width:650px){.trace-facts{grid-template-columns:1fr}}

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

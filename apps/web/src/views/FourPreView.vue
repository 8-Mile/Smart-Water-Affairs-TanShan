<script setup lang="ts">
import WorkspaceNav from "../components/WorkspaceNav.vue";
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { NButton, NInputNumber, NSelect, NTag } from "naive-ui";
import Chart from "../Chart.vue";
import { useDemoStore } from "../demo/store";
import { runRain } from "../demo/water";
import type { RainRunParams, RainRunResult } from "../demo/water";

const route = useRoute();
const store = useDemoStore();
const incomingRain=computed(()=>{
 if(route.query.source!=="dispatch")return null;
 const raw=route.query.rainMm;
 if(typeof raw!=="string"||!raw.trim())return null;
 const n=Number(raw);
 return Number.isFinite(n)&&n>=0&&n<=500?n:null;
});
function importRainFromDispatch(){
 if(incomingRain.value===null)return;
 form.rainMm=incomingRain.value;
 recalculate();
}

const queryRain = computed(() => {
  const id = route.query.rainEventId;
  if (typeof id !== "string") return null;
  return store.seed.rainEvents.find((event) => event.id === id) ?? null;
});

const region = ref<"north" | "south">("north");
const form = reactive<RainRunParams>({
  rainMm: queryRain.value?.rainfallMm ?? 41,
  areaM2: 180000,
  runoffCoefficient: 0.65,
  hours: 12,
  capacityM3: 6000,
  initialStorageM3: 4200,
  outflowM3h: 300,
  ...queryRain.value?.simulation?.north,
});

const applied = ref<RainRunParams>({ ...form });
const errorText = ref("");

const result = computed<RainRunResult | null>(() => {
  try {
    return runRain(applied.value);
  } catch {
    return null;
  }
});

const improved = computed<RainRunResult | null>(() => {
  try {
    return runRain({
      ...applied.value,
      outflowM3h: applied.value.outflowM3h * 1.5,
    });
  } catch {
    return null;
  }
});

const dirty = computed(() => {
  const keys = Object.keys(form) as (keyof RainRunParams)[];
  return keys.some((key) => form[key] !== applied.value[key]);
});

const labels = computed(() => {
  if (!result.value) return [];
  return result.value.hour.map((hour) => `${hour}h`);
});

const series = computed(() => {
  if (!result.value) return [];
  return [
    { name: "现状处理能力", values: result.value.volume, unit: "m³" },
    {
      name: "处理能力 +50%",
      values: improved.value?.volume ?? [],
      unit: "m³",
    },
    {
      name: "有效容量",
      values: result.value.hour.map(() => applied.value.capacityM3),
      unit: "m³",
    },
  ];
});

const firstRiskText = computed(() => {
  if (!result.value) return "缺数";
  if (result.value.firstRiskHour === null) return "未达到（<85% 容量）";
  if (result.value.firstRiskHour === 0) return "初始即达 85% 风险水位";
  return `第 ${result.value.firstRiskHour} 小时`;
});

const riskTag = computed<{ label: string; type: "success" | "warning" | "error" | "default" }>(
  () => {
    if (!result.value) return { label: "缺数", type: "default" };
    if (result.value.overflow > 0) return { label: "已发生溢出", type: "error" };
    if (result.value.firstRiskHour !== null) return { label: "风险水位关注", type: "warning" };
    return { label: "当前参数可控", type: "success" };
  },
);

const suggestions = computed<string[]>(() => {
  const current = result.value;
  if (!current) return ["参数无效，暂不生成建议草案。"];
  const items: string[] = [];
  if (current.firstRiskHour === 0) {
    items.push("初始储量已接近满库，应立即核实在线液位并安排外排或错峰调蓄。");
  } else if (current.firstRiskHour !== null) {
    items.push(
      `建议在第 ${current.firstRiskHour} 小时前完成一次外排或错峰供水，避免达到 85% 风险水位。`,
    );
  } else {
    items.push("按当前参数未达到 85% 风险水位，维持常规调度并持续观察后续降雨。");
  }
  if (current.overflow > 0) {
    items.push(
      `累计溢出 ${current.overflow.toFixed(1)} m³，建议提前启用备用提升泵并核对溢流通道。`,
    );
  }
  if (improved.value) {
    items.push(
      `处理能力提高 50% 后，累计溢出由 ${current.overflow.toFixed(1)} m³ 变为 ${improved.value.overflow.toFixed(1)} m³，峰值由 ${current.peak.toFixed(1)} m³ 变为 ${improved.value.peak.toFixed(1)} m³。`,
    );
  }
  items.push("本建议为演示草案，需值班人员确认后执行，不自动下发调度命令。");
  return items;
});

const conservationOk = computed(
  () => result.value !== null && Math.abs(result.value.conservationGap) < 0.01,
);

function setField(key: keyof RainRunParams, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return;
  form[key] = value;
}

function recalculate(): void {
  errorText.value = "";
  try {
    runRain({ ...form });
    applied.value = { ...form };
  } catch (error) {
    errorText.value = (error as Error).message;
  }
}

watch([queryRain, region], ([event, area]) => {
  if (!event) return;
  Object.assign(form, event.simulation?.[area] ?? { rainMm: event.rainfallMm });
  recalculate();
});
</script>

<template>
  <section class="four-pre">
    <WorkspaceNav label="调蓄与四预" :items="[{name:'调蓄方案',to:'/water/dispatch'},{name:'风险预演',to:'/decision/four-pre'}]" />
    <div v-if="route.query.source==='dispatch'" class="rain-handoff" aria-label="调蓄参数传递">
      <div><strong>来自调蓄方案的降雨量</strong>
       <p v-if="incomingRain!==null">{{ incomingRain }} mm · 仅共享降雨输入，四预分区、汇水面积与水池参数仍独立。</p>
       <p v-else>传入雨量无效，请返回调蓄页面确认。</p>
      </div>
      <NButton size="small" type="primary" :disabled="incomingRain===null" @click="importRainFromDispatch">确认采用此雨量并重算</NButton>
    </div>
    <div class="four-pre-grid">
      <aside class="panel param-panel">
        <div class="panel-head">
          <div>
            <h2>计算参数</h2>
            <p>参数为演示假设，修改后需点击“重新计算”才更新曲线。</p>
          </div>
        </div>

        <div v-if="queryRain" class="prefill-note">
          雨次 {{ queryRain.id }} · 分区演示基线
          <NSelect v-if="queryRain.simulation" v-model:value="region"
            :options="[{ label: '北区', value: 'north' }, { label: '南区', value: 'south' }]" />
          当前计算以左侧输入参数为准，修改后需点击“重新计算”。
        </div>

        <label class="field">
          <span>降雨量（mm）</span>
          <NInputNumber
            size="small"
            :value="form.rainMm"
            :min="0"
            :max="500"
            :step="1"
            @update:value="(value: number | null) => setField('rainMm', value)"
          />
        </label>
        <label class="field">
          <span>汇水面积（m²）</span>
          <NInputNumber
            size="small"
            :value="form.areaM2"
            :min="1"
            :step="1000"
            @update:value="(value: number | null) => setField('areaM2', value)"
          />
        </label>
        <label class="field">
          <span>径流系数（0~1）</span>
          <NInputNumber
            size="small"
            :value="form.runoffCoefficient"
            :min="0"
            :max="1"
            :step="0.05"
            :precision="2"
            @update:value="(value: number | null) => setField('runoffCoefficient', value)"
          />
        </label>
        <label class="field">
          <span>初始储量（m³）</span>
          <NInputNumber
            size="small"
            :value="form.initialStorageM3"
            :min="0"
            :step="100"
            @update:value="(value: number | null) => setField('initialStorageM3', value)"
          />
        </label>
        <label class="field">
          <span>有效容量（m³）</span>
          <NInputNumber
            size="small"
            :value="form.capacityM3"
            :min="1"
            :step="100"
            @update:value="(value: number | null) => setField('capacityM3', value)"
          />
        </label>
        <label class="field">
          <span>基线处理能力（m³/h）</span>
          <NInputNumber
            size="small"
            :value="form.outflowM3h"
            :min="0"
            :step="10"
            @update:value="(value: number | null) => setField('outflowM3h', value)"
          />
        </label>
        <label class="field">
          <span>时长（小时）</span>
          <NInputNumber
            size="small"
            :value="form.hours"
            :min="1"
            :max="72"
            :step="1"
            :precision="0"
            @update:value="(value: number | null) => setField('hours', value)"
          />
        </label>

        <NButton type="primary" size="small" class="calc-button" @click="recalculate">
          重新计算
        </NButton>
        <p v-if="dirty" class="dirty-hint">参数已修改，当前图表仍为上次结果。</p>
        <p v-if="errorText" class="error-text">{{ errorText }}</p>

        <div class="param-note">
          计算基准：单个模拟调蓄单元、均匀降雨、恒定处理能力；未假设未证实的地下管网拓扑。
        </div>
      </aside>

      <section class="panel chart-panel">
        <div class="panel-head">
          <div>
            <h2>库容变化预演</h2>
            <p>现状处理能力与处理能力提高 50% 的对比，单位 m³。</p>
          </div>
          <NTag size="small" :bordered="false" :type="riskTag.type">
            {{ riskTag.label }}
          </NTag>
        </div>

        <div v-if="dirty" class="stale-note">
          参数已修改 · 当前曲线为上次结果（点击左侧“重新计算”更新）
        </div>

        <Chart v-if="result" :labels="labels" :series="series" type="line" :height="320" />
        <p v-else class="empty">当前参数无效或缺少数据，未生成曲线。</p>

        <div class="conservation" :class="{ ok: conservationOk }">
          <strong>守恒核对</strong>
          <span v-if="result">
            入水 {{ result.totalInflow.toFixed(1) }} − 出水
            {{ result.totalOutflow.toFixed(1) }} − 溢出
            {{ result.overflow.toFixed(1) }} = 储量变化
            {{ result.storageChange.toFixed(1) }} m³；核对差
            {{ result.conservationGap.toFixed(3) }} m³
            <em>{{ conservationOk ? "通过" : "需复核" }}</em>
          </span>
          <span v-else>缺数</span>
        </div>

        <div class="formula-box">
          <strong>公式</strong>
          <code>{{ result?.formula ?? "缺数" }}</code>
        </div>

        <div class="missing-note">
          缺数警示：电耗、在线液位、实时流量与气象预报未接入；本页仅使用人工参数计算，
          不生成缺数指标曲线。
        </div>
      </section>

      <aside class="panel risk-panel">
        <div class="panel-head">
          <div>
            <h2>风险与方案</h2>
            <p>基于当前已计算参数，给出演示级风险提示。</p>
          </div>
        </div>

        <dl v-if="result" class="risk-list">
          <div>
            <dt>峰值储量</dt>
            <dd>{{ result.peak.toFixed(1) }} m³</dd>
          </div>
          <div>
            <dt>峰值时刻</dt>
            <dd>{{ result.peakHour === 0 ? "初始时刻" : `第 ${result.peakHour} 小时` }}</dd>
          </div>
          <div>
            <dt>累计溢出</dt>
            <dd :class="{ danger: result.overflow > 0 }">{{ result.overflow.toFixed(1) }} m³</dd>
          </div>
          <div>
            <dt>首次风险时刻</dt>
            <dd>{{ firstRiskText }}</dd>
          </div>
          <div>
            <dt>末段储量</dt>
            <dd>{{ result.finalVolume.toFixed(1) }} m³</dd>
          </div>
          <div>
            <dt>风险水位阈值</dt>
            <dd>有效容量 × 85% = {{ (applied.capacityM3 * 0.85).toFixed(1) }} m³</dd>
          </div>
        </dl>
        <p v-else class="empty">缺数</p>

        <h3>建议草案</h3>
        <ul class="suggestion-list">
          <li v-for="item in suggestions" :key="item">{{ item }}</li>
        </ul>

        <h3>假设与边界</h3>
        <ul class="assumption-list">
          <li v-for="item in result?.assumptions ?? ['缺数']" :key="item">{{ item }}</li>
        </ul>

        <p class="disclaimer">
          模拟声明：四预结果为本地参数化演示，未接入真实气象预报、调度规则与工程参数，
          不构成防洪调度或库容设计依据。
        </p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.four-pre {
  min-width: 0;
}
.four-pre-grid {
  display: grid;
  grid-template-columns: minmax(238px, 280px) minmax(0, 1fr) minmax(248px, 300px);
  gap: 14px;
  align-items: start;
}
.panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.panel-head h2 {
  margin: 0;
  font-size: 16px;
  color: #1c3e57;
}
.panel-head p {
  margin: 5px 0 0;
  font-size: 11.5px;
  color: #748a9d;
  line-height: 1.65;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #60788e;
}
.calc-button {
  width: 100%;
  margin-top: 4px;
}
.dirty-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: #a06a1f;
  line-height: 1.6;
}
.error-text {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: #c0473f;
  line-height: 1.6;
}
.prefill-note {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #eef7fc;
  border: 1px solid #cbe4f2;
  font-size: 11px;
  color: #2b6d90;
  line-height: 1.65;
}
.param-note {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #dbe8f1;
  font-size: 10.5px;
  color: #8ba0b2;
  line-height: 1.7;
}

.stale-note {
  margin-bottom: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  background: #fdf5e7;
  border: 1px solid #f0d6a4;
  font-size: 11px;
  color: #a06a1f;
}
.conservation {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding: 9px 11px;
  border-radius: 8px;
  background: #fbf3f2;
  border: 1px solid #f0d1cc;
  font-size: 11px;
  color: #8d4a43;
  line-height: 1.7;
}
.conservation.ok {
  background: #f1faf6;
  border-color: #cfe9dd;
  color: #2f7460;
}
.conservation strong {
  font-size: 11.5px;
}
.conservation em {
  font-style: normal;
  font-weight: 600;
}
.formula-box {
  margin-top: 10px;
  padding: 9px 11px;
  border-radius: 8px;
  background: #f4f9fc;
  border: 1px solid #e1eef6;
  font-size: 11px;
  color: #5d7387;
}
.formula-box strong {
  display: block;
  margin-bottom: 3px;
  color: #3d566c;
}
.formula-box code {
  font-family: inherit;
  line-height: 1.7;
  word-break: break-word;
}
.missing-note {
  margin-top: 10px;
  font-size: 10.5px;
  color: #a06a1f;
  line-height: 1.7;
}
.empty {
  margin: 10px 0;
  font-size: 12px;
  color: #8296a8;
}

.risk-list {
  margin: 0;
  border-top: 1px solid #e4eef5;
}
.risk-list > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #e4eef5;
}
.risk-list dt {
  font-size: 11.5px;
  color: #71869a;
}
.risk-list dd {
  margin: 0;
  font-size: 12.5px;
  color: #20384e;
  text-align: right;
}
.risk-list dd.danger {
  color: #c0473f;
  font-weight: 600;
}
.risk-panel h3 {
  margin: 14px 0 6px;
  font-size: 12.5px;
  color: #1c3e57;
}
.suggestion-list,
.assumption-list {
  margin: 0;
  padding-left: 16px;
  font-size: 11px;
  color: #5d7387;
  line-height: 1.75;
}
.assumption-list {
  color: #7c91a4;
}
.disclaimer {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px dashed #dbe8f1;
  font-size: 10.5px;
  color: #8ba0b2;
  line-height: 1.7;
}

@media (max-width: 1280px) {
  .four-pre-grid {
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
  }
  .risk-panel {
    grid-column: 1 / -1;
  }
}
@media (max-width: 900px) {
  .four-pre-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.rain-handoff{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;border:1px solid #bcdfea;background:#f0f9fd;border-radius:8px;padding:12px 14px;margin-bottom:12px}
.rain-handoff strong{font-size:12px;color:#2f7391}.rain-handoff p{color:#809faf;font-size:11px;line-height:1.6;margin:5px 0 0}
</style>

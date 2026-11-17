<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { NButton, NCheckbox, NInputNumber, NTag, useMessage } from "naive-ui";
import { useDemoStore } from "../demo/store";
import { DISPATCH_DRAFT_KEY, readDrafts, saveDispatchDraft, type DispatchDraft } from "../demo/proposalDrafts";
import { can } from "../demo/permissions";
import {
  DEFAULT_DISPATCH, evaluateDispatch,
  type DispatchAssessment, type DispatchInputs, type DispatchKind, type DispatchOption,
} from "../demo/dispatch";

const message = useMessage();
const demo = useDemoStore();
const route = useRoute();
const queryRain = typeof route.query.rainMm === "string" ? Number(route.query.rainMm) : NaN;
const initialRain = Number.isFinite(queryRain) && queryRain >= 0 && queryRain <= 500
  ? queryRain : DEFAULT_DISPATCH.rainMm;
const form = reactive<DispatchInputs>({ ...DEFAULT_DISPATCH, rainMm: initialRain });
const applied = ref<DispatchInputs>({ ...DEFAULT_DISPATCH, rainMm: initialRain });
const error = ref("");
const advanced = ref(false);
const detail = ref(false);
const showDrafts = ref(route.query.source === "ai");
// AI从当前页面发起时同一路由会复用组件；必须主动同步最新草稿和参数。
watch(() => route.fullPath, () => {
  if (route.query.source !== "ai") return;
  drafts.value = readDrafts<DispatchDraft>(DISPATCH_DRAFT_KEY, localStorage);
  showDrafts.value = true;
  const rain = typeof route.query.rainMm === "string" ? Number(route.query.rainMm) : NaN;
  if (Number.isFinite(rain) && rain >= 0 && rain <= 500) {
    const next: DispatchInputs = { ...DEFAULT_DISPATCH, rainMm: rain };
    Object.assign(form, next);
    applied.value = next;
  }
});

const drafts = ref<DispatchDraft[]>(readDrafts<DispatchDraft>(DISPATCH_DRAFT_KEY, localStorage));

const calculation = computed<DispatchAssessment | null>(() => {
  try { return evaluateDispatch(applied.value); } catch { return null; }
});
const comparison = computed(() => calculation.value?.options ?? []);
const chosen = computed(() => comparison.value.find(x => x.kind === calculation.value?.recommended) ?? null);
const baseline = computed(() => comparison.value.find(x => x.kind === "baseline") ?? null);
const hasChanges = computed(() => Object.keys(DEFAULT_DISPATCH).some(k => {
  const key = k as keyof DispatchInputs;
  return form[key] !== applied.value[key];
}));

function useRain(rain: number): void {
  form.rainMm = rain;
  calculate();
}
function calculate(): void {
  error.value = "";
  try {
    const updated = { ...form };
    evaluateDispatch(updated);
    applied.value = updated;
    message.success("已根据当前参数完成三方案比选（MOCK）");
  } catch (e) { error.value = (e as Error).message; message.error(error.value); }
}
const formatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
function num(value: number | undefined): string { return value === undefined ? "—" : formatter.format(value); }
function yuan(value: number): string { return (value > 0 ? "+" : value < 0 ? "−" : "") + "¥" + num(Math.abs(value)); }
function riskText(option: DispatchOption): string {
  if (!option.feasible) return "不可执行";
  if (option.overflowM3 > 0.01) return "预计溢流";
  if (option.firstRiskHour !== null) return "触及风险水位";
  return "未触及风险水位";
}
function line(option: DispatchOption): string {
  const source = [{ hour: 0, storageM3: option.initialRainStorageM3 }, ...option.curve];
  const n = Math.max(1, applied.value.hours);
  return source.map(p => {
    const x = 45 + p.hour / n * 800;
    const y = 222 - p.storageM3 / applied.value.capacityM3 * 188;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
}
const plotted = computed(() => comparison.value.filter(o => o.feasible));
const riskY = computed(() => 222 - 0.85 * 188);
const horizon = computed(() => applied.value.hours);
const tickHours = computed(() => [0, .25, .5, .75, 1].map(f => Math.round(horizon.value * f)));
const leftTick = computed(() => [0, .25, .5, .75, 1].map(f => ({ y: 222 - f * 188, label: num(applied.value.capacityM3 * f) })));
const graphColors: Record<DispatchKind,string> = { baseline: "#8aa3b4", pre_release: "#328bd3", reuse: "#19a5a0" };
const allHaveOverflow = computed(() => comparison.value.filter(o => o.feasible).every(o => o.overflowM3 > 0.01));
const allowedSave = computed(() => can(demo.role, "water:proposal"));
function saveDraft(): void {
  if (!calculation.value) return;
  try {
    const saved = saveDispatchDraft(calculation.value, demo.role, localStorage);
    drafts.value = readDrafts<DispatchDraft>(DISPATCH_DRAFT_KEY, localStorage);
    showDrafts.value = true;
    message.success("已保存待人工复核的调蓄草稿 " + saved.id + "，未下发设备控制");
  } catch (err) { message.error((err as Error).message); }
}

function reset(): void {
  Object.assign(form, DEFAULT_DISPATCH);
  applied.value = { ...DEFAULT_DISPATCH };
  error.value = "";
  message.info("已恢复演示默认参数");
}
function exportCsv(): void {
  if (!calculation.value) return;
  const rows = [
    ["方案","可执行","阻断条件","预计溢流m³","峰值储量m³","雨前额外腾库m³","额外合格回用m³","相对现状净费用元","水量平衡偏差m³"],
    ...comparison.value.map(o => [
      o.title, o.feasible ? "是" : "否", o.blockers.join("；"), o.overflowM3,
      o.peakM3,o.preReleaseM3,o.extraReuseM3,o.incrementalNetCostYuan,o.balanceGapM3,
    ]),
  ];
  const csv = "\uFEFF" + rows.map(row => row.map(value => '"' + String(value).replace(/"/g,'""') + '"').join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "雨前调蓄三方案对比-MOCK.csv"; anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="dispatch-view">
    <div class="dispatch-intro">
      <div>
        <div class="eyebrow">水资源管理 · 雨前主动决策</div>
        <h2>雨前智能调蓄 <span>决策演示 V1</span></h2>
        <p>未来有降雨，当前水池需要提前腾库吗？哪种方案风险更低、成本更合理？</p>
      </div>
      <div class="top-actions">
        <NTag type="warning" size="small">MOCK / 单池演示计算</NTag>
        <NButton secondary size="small" @click="exportCsv">导出方案对比</NButton>
      </div>
    </div>

    <section class="rain-select" aria-label="降雨情景">
      <div><strong>选择预报降雨情景</strong><span>演示数据，改变雨量后自动重新计算</span></div>
      <div class="rain-actions">
        <NButton :type="applied.rainMm === 30 ? 'primary' : 'default'" secondary @click="useRain(30)">小雨情景 · 30mm</NButton>
        <NButton :type="applied.rainMm === 60 ? 'primary' : 'default'" secondary @click="useRain(60)">中等降雨 · 60mm</NButton>
        <NButton :type="applied.rainMm === 80 ? 'primary' : 'default'" secondary @click="useRain(80)">强降雨 · 80mm</NButton>
        <NButton :type="applied.rainMm === 120 ? 'primary' : 'default'" secondary @click="useRain(120)">极端演示 · 120mm</NButton>
      </div>
    </section>

    <template v-if="calculation && chosen && baseline">
      <section class="metrics">
        <div class="metric"><span>当前假设库容占比</span><strong>{{ num(applied.initialStorageM3 / applied.capacityM3 * 100) }}<em>%</em></strong><small>{{ num(applied.initialStorageM3) }} / {{ num(applied.capacityM3) }} m³</small></div>
        <div class="metric"><span>预计降雨总来水</span><strong>{{ num(chosen.totalInflowM3) }}<em>m³</em></strong><small>{{ applied.hours }}小时均匀降雨 · 计算估计</small></div>
        <div class="metric"><span>维持现状时预计溢流</span><strong :class="{ danger: baseline.overflowM3 > 0 }">{{ num(baseline.overflowM3) }}<em>m³</em></strong><small>仅模拟现有 {{ num(applied.outflowM3h) }} m³/h基础出流</small></div>
        <div class="metric"><span>推荐方案预计溢流</span><strong :class="{ danger: chosen.overflowM3 > 0 }">{{ num(chosen.overflowM3) }}<em>m³</em></strong><small>较现状减少 {{ num(baseline.overflowM3 - chosen.overflowM3) }} m³</small></div>
      </section>

      <section class="result-grid">
        <div class="panel chart-panel">
          <div class="panel-heading"><div><h3>未来 {{ applied.hours }} 小时储量预测</h3><p>对比现状与可执行方案，水位按库容折算；虚线为85%容量预警阈值</p></div><NTag size="small" :type="allHaveOverflow ? 'error':'info'">{{ allHaveOverflow ? '仍有剩余溢流风险':'方案比选' }}</NTag></div>
          <div class="chart-wrap">
            <svg viewBox="0 0 875 264" role="img" aria-label="不同方案的储量预测变化曲线" preserveAspectRatio="xMidYMid meet">
              <g v-for="tick in leftTick" :key="tick.y">
                <line x1="45" :y1="tick.y" x2="845" :y2="tick.y" stroke="#e8f1f7" stroke-width="1"/>
                <text x="35" :y="tick.y+4" text-anchor="end" fill="#91a6b5" font-size="11">{{ tick.label }}</text>
              </g>
              <line x1="45" :y1="riskY" x2="845" :y2="riskY" stroke="#e5b76f" stroke-width="1.7" stroke-dasharray="5 6"/>
              <text x="834" :y="riskY-7" text-anchor="end" fill="#b38c52" font-size="11">85% 风险水位</text>
              <g v-for="(tick, i) in tickHours" :key="i"><text :x="45 + i*200" y="246" text-anchor="middle" fill="#91a6b5" font-size="11">{{ tick }}h</text></g>
              <polyline v-for="option in plotted" :key="option.kind" :points="line(option)" :stroke="graphColors[option.kind]" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" fill="none" :opacity="option.kind === calculation.recommended ? 1 : .8"/>
            </svg>
          </div>
          <div class="chart-legend">
            <span v-for="option in comparison" :key="option.kind" :class="{ unavailable: !option.feasible }"><i :style="{background:graphColors[option.kind]}"></i>{{ option.title }}{{ option.feasible ? '' : '（不可执行）' }}</span>
          </div>
          <p class="chart-foot">曲线从“雨前方案执行完毕”时刻开始；雨前额外排放量另行计量，不与降雨期基础出流重复计算。</p>
        </div>
        <div class="panel recommended">
          <div class="panel-heading"><div><h3>本次建议</h3><p>计算结果不自动下发工艺命令</p></div><NTag type="success" size="small">演示推荐</NTag></div>
          <h2>{{ chosen.title }}</h2>
          <p class="rec-reason">{{ calculation.recommendationReason }}</p>
          <div class="recommend-stats"><span>预计峰值储量</span><strong>{{ num(chosen.peakM3) }} m³</strong></div>
          <div class="recommend-stats"><span>额外回用量</span><strong>{{ num(chosen.extraReuseM3) }} m³</strong></div>
          <div class="recommend-stats"><span>雨前腾库量</span><strong>{{ num(chosen.preReleaseM3) }} m³</strong></div>
          <div class="recommend-stats"><span>相对现状的增量净费用</span><strong :class="{ saving: chosen.incrementalNetCostYuan < 0 }">{{ yuan(chosen.incrementalNetCostYuan) }}</strong></div>
          <div v-if="chosen.overflowM3 > 0.01" class="critical-note">当前方案仍预测溢流 {{ num(chosen.overflowM3) }} m³，需工程复核与应急准备。</div>
          <div class="rec-buttons">
            <NButton type="primary" block :disabled="!allowedSave" @click="saveDraft">保存待复核建议草稿</NButton>
            <small>不发出设备控制指令。保存的是MOCK计算方案，由人员核实工程条件后才能决策。</small>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading"><div><h3>三个方案，一眼比较</h3><p>先看能否执行与预测风险，再看运行经济性；不把未批准路径纳入推荐</p></div><NButton size="small" secondary @click="detail = !detail">{{ detail ? '收起计算明细':'展开计算明细' }}</NButton></div>
        <div class="plan-table-wrap">
          <table class="plan-table">
            <thead><tr><th>运行方案</th><th>可执行性</th><th>预计溢流</th><th>最高储量</th><th>腾库 / 增量回用</th><th>增量净费用</th><th>决策结果</th></tr></thead>
            <tbody><tr v-for="option in comparison" :key="option.kind" :class="{ best: option.kind === calculation.recommended, blocked: !option.feasible }">
              <td><strong>{{ option.title }}</strong><small>{{ option.subtitle }}</small></td>
              <td><NTag size="small" :type="option.feasible ? 'success' : 'default'">{{ option.feasible ? '条件可用（演示）' : '条件不足' }}</NTag></td>
              <td><strong :class="{ danger: option.overflowM3 > 0 }">{{ num(option.overflowM3) }} m³</strong><small>{{ riskText(option) }}</small></td>
              <td>{{ num(option.peakM3) }} m³</td>
              <td>{{ num(option.preReleaseM3) }} / {{ num(option.extraReuseM3) }} m³</td>
              <td><span :class="{ saving: option.incrementalNetCostYuan < 0 }">{{ yuan(option.incrementalNetCostYuan) }}</span></td>
              <td><NTag v-if="option.kind === calculation.recommended" type="info">当前推荐</NTag><span v-else>—</span></td>
            </tr></tbody>
          </table>
        </div>
        <div v-if="detail" class="details">
          <div v-for="option in comparison" :key="option.kind" class="detail-card">
            <strong>{{ option.title }} · {{ riskText(option) }}</strong>
            <p v-if="option.blockers.length">阻断条件：{{ option.blockers.join('；') }}</p>
            <p>降雨总入库 {{ num(option.totalInflowM3) }} m³；基础出流 {{ num(option.totalBaseOutM3) }} m³；雨前额外腾库 {{ num(option.preReleaseM3) }} m³；新增合格回用 {{ num(option.extraReuseM3) }} m³。</p>
            <p>溢流 {{ num(option.overflowM3) }} m³；末储量 {{ num(option.finalStorageM3) }} m³；水量平衡误差 {{ num(option.balanceGapM3) }} m³。</p>
          </div>
        </div>
      </section>

      <section class="panel" aria-label="方案假设配置">
        <div class="panel-heading"><div><h3>参数与约束条件</h3><p>默认使用演示假设。真实池容、泵组能力、排放和回用路径必须由工程资料确认。</p></div><NButton size="small" secondary @click="advanced = !advanced">{{ advanced ? '收起参数':'修改计算条件' }}</NButton></div>
        <div v-if="advanced" class="form-block">
          <div class="field-grid">
            <label><span>降雨量（mm）</span><NInputNumber v-model:value="form.rainMm" :min="0" :precision="1" /></label>
            <label><span>降雨历时（小时）</span><NInputNumber v-model:value="form.hours" :min="1" :max="720" :precision="0" /></label>
            <label><span>汇水面积（m²）</span><NInputNumber v-model:value="form.areaM2" :min="1" :precision="0" /></label>
            <label><span>径流系数</span><NInputNumber v-model:value="form.runoffCoefficient" :min="0" :max="1" :step=".05" :precision="2" /></label>
            <label><span>水池有效容量（m³）</span><NInputNumber v-model:value="form.capacityM3" :min="1" :precision="0" /></label>
            <label><span>当前储量（m³）</span><NInputNumber v-model:value="form.initialStorageM3" :min="0" :precision="0" /></label>
            <label><span>现有基础处理出流（m³/h）</span><NInputNumber v-model:value="form.outflowM3h" :min="0" :precision="0" /></label>
            <label><span>最低运行保底储量（m³）</span><NInputNumber v-model:value="form.reserveM3" :min="0" :precision="0" /></label>
          </div>
          <div class="constraint-block">
            <div class="constraint-head"><strong>方案B · 雨前腾库条件</strong><NCheckbox v-model:checked="form.dischargeAllowed">演示假设：已确认合法排放去向</NCheckbox></div>
            <div class="field-grid">
              <label><span>提前腾库时间（小时）</span><NInputNumber v-model:value="form.leadHours" :min="0" :max="168" :precision="0"/></label>
              <label><span>额外腾库能力（m³/h）</span><NInputNumber v-model:value="form.preReleaseCapacityM3h" :min="0" :precision="0"/></label>
              <label><span>增量排放成本（元/m³）</span><NInputNumber v-model:value="form.preReleaseCostYuanM3" :min="0" :step=".05" :precision="2"/></label>
            </div>
          </div>
          <div class="constraint-block">
            <div class="constraint-head"><strong>方案C · 处理回用条件</strong><NCheckbox v-model:checked="form.reuseAllowed">演示假设：已确认水质、管网与回用用途</NCheckbox></div>
            <div class="field-grid">
              <label><span>额外回用能力（m³/h）</span><NInputNumber v-model:value="form.reuseCapacityM3h" :min="0" :precision="0"/></label>
              <label><span>同期实际回用需求（m³/h）</span><NInputNumber v-model:value="form.reuseDemandM3h" :min="0" :precision="0"/></label>
              <label><span>回用增量成本（元/m³）</span><NInputNumber v-model:value="form.reuseTreatmentCostYuanM3" :min="0" :step=".05" :precision="2"/></label>
              <label><span>可替代外购水单价（元/m³）</span><NInputNumber v-model:value="form.avoidedTapPriceYuanM3" :min="0" :step=".1" :precision="2"/></label>
            </div>
          </div>
          <p v-if="error" class="error-msg">{{ error }}</p>
          <div class="form-actions"><span v-if="hasChanges">参数已变更，点击重新计算才生效。</span><NButton secondary @click="reset">恢复演示值</NButton><NButton type="primary" @click="calculate">重新计算三方案</NButton></div>
        </div>
      </section>

      <section class="panel" v-if="showDrafts || drafts.length">
        <div class="panel-heading"><div><h3>待人工复核的调蓄建议</h3><p>本地保存的MOCK草稿，不作为值守通知和自动设备控制命令</p></div><NButton secondary size="small" @click="showDrafts = !showDrafts">{{ showDrafts ? '收起草稿' : '查看草稿（'+ drafts.length +'）' }}</NButton></div>
        <div v-if="showDrafts" class="draft-list">
          <div v-if="!drafts.length" class="empty">暂无已保存的调蓄建议。</div>
          <div v-for="draft in drafts.slice(0, 10)" :key="draft.id" class="draft"><strong>{{ draft.id }} · {{ draft.name }}</strong><small>{{ new Date(draft.createdAt).toLocaleString('zh-CN',{hour12:false}) }} · {{ draft.createdBy }} · 待复核</small><span>降雨 {{ draft.parameters.rainMm }}mm / 预计溢流 {{ num(draft.result.overflowM3) }}m³ / 增量净费用 {{ yuan(draft.result.incrementalNetCostYuan) }}</span></div>
        </div>
      </section>
      <p class="disclaimer">工程边界：预测使用均匀降雨、单独库容、固定基础出流及明确配置的额外腾库/回用能力；不代表真实管网水动力模型。比较结果与价格均为示例，必须经业主核实水质、环保排放许可、供水需求及设备能力后才能执行。</p>
    </template>
    <div v-else class="panel error-msg">当前参数无法计算，请恢复演示参数或重新输入。</div>
  </div>
</template>

<style scoped>
.dispatch-view{display:grid;gap:14px;color:#244967;padding-bottom:24px}
.dispatch-intro{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:19px 23px;background:linear-gradient(106deg,#e8f5fc,#fff 60%,#e7f4ff);border:1px solid #d6e6f1;border-radius:12px}
.eyebrow{font-size:12px;color:#4f86a8;margin-bottom:6px}.dispatch-intro h2{margin:0;font-size:23px;color:#1a4562}.dispatch-intro h2 span{font-size:12px;font-weight:500;color:#7296ad}.dispatch-intro p{font-size:12px;color:#7895a8;line-height:1.6;margin:7px 0 0}.top-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rain-select{border:1px solid #d7e9f4;border-radius:10px;background:#f8fcff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.rain-select>div:first-child{display:grid;gap:5px}.rain-select strong{font-size:13px}.rain-select span{font-size:11px;color:#92a8b5}.rain-actions{display:flex;gap:7px;flex-wrap:wrap}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.metric,.panel{background:#fff;border:1px solid #dceaf3;border-radius:10px;box-shadow:0 6px 18px #336c8b09;min-width:0}
.metric{padding:17px 18px;display:grid;gap:5px}.metric>span{font-size:11px;color:#809baa}.metric strong{font-size:27px;color:#1a698f;font-weight:720;line-height:1.5}.metric strong.danger{color:#cc6055}.metric em{font-size:12px;font-style:normal;color:#9baeba;font-weight:500;margin-left:5px}.metric small{font-size:11px;color:#91a8b7}
.result-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(285px,.9fr);gap:13px;align-items:stretch}.panel{padding:18px}.panel-heading{display:flex;justify-content:space-between;align-items:center;gap:9px;margin-bottom:16px}.panel-heading h3{font-size:16px;color:#2a5979;margin:0}.panel-heading p{font-size:11px;color:#94a8b7;margin:5px 0 0;line-height:1.6}
.chart-wrap{width:100%;min-height:220px;display:flex;align-items:center}.chart-wrap svg{width:100%;height:auto}.chart-legend{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}.chart-legend span{font-size:11px;color:#66849a;display:flex;gap:6px;align-items:center}.chart-legend .unavailable{opacity:.5}.chart-legend i{display:inline-block;width:18px;height:3px;border-radius:3px}.chart-foot{color:#98a8b6;font-size:10px;line-height:1.7;margin:11px 0 0}
.recommended{background:linear-gradient(170deg,#f1f9ff,#fff 43%);display:flex;flex-direction:column}.recommended h2{font-size:20px;color:#176e9c;margin:10px 0 8px}.rec-reason{font-size:12px;line-height:1.8;color:#708ca0;margin:2px 0 13px}.recommend-stats{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #e5edf4;font-size:12px}.recommend-stats span{color:#8099aa}.recommend-stats strong{color:#235e81;white-space:nowrap}.saving{color:#1a9a79!important}.critical-note{margin-top:12px;color:#b45e40;background:#fff4e5;padding:9px 10px;border-radius:7px;font-size:11px}.rec-buttons{margin-top:auto;padding-top:18px}.rec-buttons small{display:block;margin-top:10px;line-height:1.7;color:#95aab7;font-size:10px}
.plan-table-wrap{overflow-x:auto}.plan-table{width:100%;border-collapse:collapse;min-width:880px}.plan-table th{font-weight:600;font-size:11px;color:#7791a3;background:#f4f9fd;text-align:left;padding:12px 11px;white-space:nowrap}.plan-table td{font-size:12px;border-bottom:1px solid #e9eff4;padding:13px 11px;color:#52758b;white-space:nowrap}.plan-table td strong{color:#315f80;font-weight:650}.plan-table td strong.danger{color:#cf5f54}.plan-table td small{display:block;margin-top:6px;color:#93aabb;font-size:10px}.plan-table tr.best{background:#f0f9ff}.plan-table tr.blocked{opacity:.55}
.details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:14px}.detail-card{background:#f7fafc;border:1px solid #e4edf3;padding:12px;border-radius:8px}.detail-card strong{font-size:12px}.detail-card p{font-size:11px;color:#7b94a5;line-height:1.65;margin-bottom:0}
.field-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.field-grid label{min-width:0;display:grid;gap:6px}.field-grid label span{font-size:11px;color:#607f94}.field-grid :deep(.n-input-number){width:100%}.constraint-block{background:#f8fbfd;border:1px solid #e0edf4;border-radius:9px;padding:14px;margin-top:14px}.constraint-head{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:13px}.constraint-head strong{font-size:12px}.form-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:17px}.form-actions span{margin-right:auto;font-size:11px;color:#bf8b3e}.error-msg{font-size:12px;color:#b74d4d;margin-top:12px}.draft-list{display:grid;gap:8px}.draft{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px;background:#f6fafc;border-radius:7px;font-size:12px}.draft small{color:#92a5b4}.draft span{color:#63849a}.empty{font-size:12px;color:#899fac;padding:16px}.disclaimer{font-size:11px;color:#8da4b3;line-height:1.8;margin:0}
@media(max-width:1250px){.result-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.field-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:780px){.details{grid-template-columns:1fr}.field-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dispatch-intro{align-items:flex-start;flex-direction:column}}@media(max-width:520px){.metrics,.field-grid{grid-template-columns:1fr}.rain-actions{display:grid;grid-template-columns:1fr 1fr}.chart-wrap{min-height:155px}.chart-legend{gap:8px}.form-actions{flex-wrap:wrap}}
</style>

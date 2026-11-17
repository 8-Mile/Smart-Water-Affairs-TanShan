<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { NButton, NInput, NTag, useMessage } from "naive-ui";
import { can } from "../demo/permissions";
import { readHandoverReports, reviewHandoverReport, type HandoverReport } from "../demo/handover";
import { useDemoStore } from "../demo/store";
import { summarizeLedger, toCsv } from "../demo/water";
import type { WorkOrderStatus } from "../demo/types";
import {
  alarmLevelLabels,
  formatDateTime,
  workOrderStatusLabels,
} from "../demo/workorderMeta";

const store = useDemoStore();
const route = useRoute();
const message = useMessage();
const handovers = ref<HandoverReport[]>(readHandoverReports(localStorage));
const handoverId = ref(typeof route.query.handoverId === "string"
  ? route.query.handoverId : handovers.value[0]?.id ?? "");
const handover = computed(() => handovers.value.find(x=>x.id===handoverId.value)??null);
const reviewNote = ref("");
const canReview = computed(()=>can(store.role,"handover:review"));
function refreshHandovers():void {
  handovers.value=readHandoverReports(localStorage);
  const requested=typeof route.query.handoverId === "string" ? route.query.handoverId : "";
  if(requested && handovers.value.some(x=>x.id===requested))handoverId.value=requested;
  else if(!handovers.value.some(x=>x.id===handoverId.value))handoverId.value=handovers.value[0]?.id??"";
}
watch(()=>route.fullPath,refreshHandovers);
function reviewSelected():void {
  const current=handover.value;
  if(!current)return;
  try{
    const updated=reviewHandoverReport(current.id,store.role,reviewNote.value,localStorage,new Date().toISOString());
    refreshHandovers();
    handoverId.value=updated.id;
    reviewNote.value="";
    message.success("已完成DEMO审核归档，未提交到正式生产系统");
  }catch(e){message.error((e as Error).message);}
}
function exportHandover(report:HandoverReport):void {
  const url=URL.createObjectURL(new Blob([report.text],{type:"text/markdown;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=report.id+"-交接班报告-MOCK.md";
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}


const numberFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});
const metricFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "缺数";
  return numberFormat.format(value);
}

function formatMetric(value: number): string {
  return metricFormat.format(value);
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

interface ReportColumn {
  key: string;
  title: string;
}

type ReportRow = Record<string, string | number>;

interface ReportDef {
  id: string;
  title: string;
  description: string;
  source: string;
  caliber: string;
  missing: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

const generatedAt = computed(() => formatDateTime(store.seed.referenceTime));

const processRows = computed<ReportRow[]>(() =>
  store.subsystems.map((subsystem) => {
    const assets = store.assets.filter(
      (asset) => asset.subsystemId === subsystem.id && !asset.archived,
    );
    const running = assets.filter((asset) => asset.status === "running").length;
    const alarms = store.alarms.filter(
      (alarm) =>
        alarm.subsystemId === subsystem.id &&
        alarm.status === "active" &&
        alarm.kind === "production",
    ).length;
    return {
      工艺: subsystem.name,
      监测指标: `${subsystem.metric} / ${subsystem.unit}`,
      指标基准值: `${formatMetric(subsystem.base)} ${subsystem.unit}`,
      设备数: assets.length,
      运行: running,
      非运行: assets.length - running,
      活动生产告警: alarms,
    };
  }),
);

const healthRows = computed<ReportRow[]>(() => {
  const rows = store.subsystems.map((subsystem) => {
    const assets = store.assets.filter(
      (asset) => asset.subsystemId === subsystem.id && !asset.archived,
    );
    const running = assets.filter((asset) => asset.status === "running").length;
    const faults = assets.filter((asset) => asset.status === "fault").length;
    const alarms = store.alarms.filter(
      (alarm) =>
        alarm.subsystemId === subsystem.id &&
        alarm.status === "active" &&
        alarm.kind === "production",
    ).length;
    const stopped = assets.length - running - faults;
    const score = Math.max(
      0,
      Math.min(100, 100 - faults * 40 - alarms * 15 - Math.max(0, stopped) * 5),
    );
    return {
      工艺: subsystem.name,
      设备数: assets.length,
      运行: running,
      故障: faults,
      非运行: Math.max(0, stopped),
      活动生产告警: alarms,
      规则评分: score,
      评分说明: "100−故障×40−活动告警×15−非运行×5（演示规则）",
    };
  });
  const assets = store.assets.filter((asset) => !asset.archived);
  const running = assets.filter((asset) => asset.status === "running").length;
  const faults = assets.filter((asset) => asset.status === "fault").length;
  const alarms = store.alarms.filter(
    (alarm) => alarm.status === "active" && alarm.kind === "production",
  ).length;
  const stopped = assets.length - running - faults;
  const score = Math.max(
    0,
    Math.min(100, 100 - faults * 40 - alarms * 15 - Math.max(0, stopped) * 5),
  );
  rows.unshift({
    工艺: "全厂汇总",
    设备数: assets.length,
    运行: running,
    故障: faults,
    非运行: Math.max(0, stopped),
    活动生产告警: alarms,
    规则评分: score,
    评分说明: "规则汇总，不等同于单设备健康分或 RUL",
  });
  return rows;
});

const alarmOrderRows = computed<ReportRow[]>(() => {
  const rows: ReportRow[] = [];
  for (const level of ["critical", "warning", "info"] as const) {
    const production = store.alarms.filter(
      (alarm) => alarm.kind === "production" && alarm.level === level,
    );
    rows.push({
      类别: "生产告警",
      项目: alarmLevelLabels[level],
      数量: production.length,
      说明: `活动 ${production.filter((alarm) => alarm.status === "active").length} 条`,
    });
  }
  const business = store.alarms.filter((alarm) => alarm.kind === "business");
  rows.push({
    类别: "业务提醒",
    项目: "成本 / 保养提醒",
    数量: business.length,
    说明: `活动 ${business.filter((alarm) => alarm.status === "active").length} 条，不计入生产告警分级`,
  });

  const statuses: WorkOrderStatus[] = [
    "draft",
    "pending_dispatch",
    "in_progress",
    "pending_acceptance",
    "archived",
    "cancelled",
  ];
  for (const status of statuses) {
    rows.push({
      类别: "工单",
      项目: workOrderStatusLabels[status],
      数量: store.workorders.filter((order) => order.status === status).length,
      说明: status === "archived" ? "验收归档" : "按当前状态统计",
    });
  }
  return rows;
});

const waterRows = computed<ReportRow[]>(() => {
  const summary = summarizeLedger(store.seed.ledger);
  return store.seed.ledger.map((entry) => ({
    周期: entry.period,
    来源类型: entry.sourceType,
    方向: entry.direction === "in" ? "进" : "出",
    水量: entry.volume,
    单位: entry.unit,
    数据来源: entry.source,
    口径说明: entry.note,
    回用标记:
      entry.direction === "out" && entry.sourceType.includes("中水")
        ? `回用 ${formatNumber(summary.reuseVolume)}（不重复计量）`
        : "—",
  }));
});

const reports = computed<ReportDef[]>(() => [
  {
    id: "process-summary",
    title: "六工艺运行摘要",
    description: "按六个工艺子系统汇总设备数量、运行状态与活动生产告警。",
    source: "固定种子 assets / alarms；来源 MOCK",
    caliber: "设备按 subsystemId 归属；活动生产告警仅统计 production 且 status=active。",
    missing: "电耗、处理水量实测：种子无对应测点，显示缺数，不生成能效曲线。",
    columns: [
      { key: "工艺", title: "工艺" },
      { key: "监测指标", title: "监测指标" },
      { key: "指标基准值", title: "指标基准值" },
      { key: "设备数", title: "设备数" },
      { key: "运行", title: "运行" },
      { key: "非运行", title: "非运行" },
      { key: "活动生产告警", title: "活动生产告警" },
    ],
    rows: processRows.value,
  },
  {
    id: "health-summary",
    title: "设备健康摘要",
    description: "按工艺汇总设备状态与活动告警，给出演示用规则评分。",
    source: "固定种子 assets / alarms；规则评分 CALCULATED",
    caliber: "规则评分 = 100 − 故障×40 − 活动告警×15 − 非运行×5，仅用于演示排序。",
    missing: "振动/温度实时评分：仅 P-002 有序列，其余设备缺数；不输出 RUL 或故障概率。",
    columns: [
      { key: "工艺", title: "工艺" },
      { key: "设备数", title: "设备数" },
      { key: "运行", title: "运行" },
      { key: "故障", title: "故障" },
      { key: "非运行", title: "非运行" },
      { key: "活动生产告警", title: "活动生产告警" },
      { key: "规则评分", title: "规则评分" },
      { key: "评分说明", title: "评分说明" },
    ],
    rows: healthRows.value,
  },
  {
    id: "alarm-workorder",
    title: "告警工单统计",
    description: "按告警级别、业务提醒与工单状态统计数量，用于值班交接。",
    source: "固定种子 alarms / workorders；来源 MOCK",
    caliber: "告警按 kind + level 分组；工单按状态机当前状态分组，取消与归档单列。",
    missing: "告警响应时长、MTTR、重复告警率：缺数（种子未记录成对时间戳）。",
    columns: [
      { key: "类别", title: "类别" },
      { key: "项目", title: "项目" },
      { key: "数量", title: "数量" },
      { key: "说明", title: "说明" },
    ],
    rows: alarmOrderRows.value,
  },
  {
    id: "water-ledger",
    title: "水量账本",
    description: "按周期、来源类型与流向导出水量账本，并标注回用口径。",
    source: "固定种子 ledger；来源 MOCK / REFERENCE / CALCULATED",
    caliber:
      "中水外供来自雨水回用，单列为回用量，不重复计入新增取水；账本净差不等同储量变化。",
    missing: "电耗、在线液位、实时流量：种子未接入，统一显示缺数。",
    columns: [
      { key: "周期", title: "周期" },
      { key: "来源类型", title: "来源类型" },
      { key: "方向", title: "方向" },
      { key: "水量", title: "水量" },
      { key: "单位", title: "单位" },
      { key: "数据来源", title: "数据来源" },
      { key: "回用标记", title: "回用标记" },
      { key: "口径说明", title: "口径说明" },
    ],
    rows: waterRows.value,
  },
]);

const openIds = ref<string[]>([]);
watch(()=>route.query.reportId,(value)=>{
 if(typeof value!=="string"||!reports.value.some(x=>x.id===value))return;
 if(!openIds.value.includes(value))openIds.value=[...openIds.value,value];
 // 下钻优先显示目标报表，避免用户从水量账本跳转后还需寻找报表卡片。
 void Promise.resolve().then(()=>document.getElementById("report-"+value)?.scrollIntoView({block:"start",behavior:"auto"}));
},{immediate:true});

function isOpen(id: string): boolean {
  return openIds.value.includes(id);
}

function toggle(id: string): void {
  openIds.value = isOpen(id)
    ? openIds.value.filter((item) => item !== id)
    : [...openIds.value, id];
}

function exportReport(report: ReportDef): void {
  const headers = report.columns.map((column) => column.title);
  const rows = report.rows.map((row) =>
    report.columns.map((column) => row[column.key] ?? ""),
  );
  downloadCsv(
    `${report.title}-${store.seed.referenceTime.slice(0, 10)}.csv`,
    toCsv(headers, rows),
  );
}

const missingIndicators = [
  { label: "电耗 / 单位水量能耗", reason: "种子无电耗测点" },
  { label: "在线液位 / 实时流量", reason: "未接入实时监测" },
  { label: "地下管网拓扑", reason: "未证实物理连接" },
  { label: "降雨气象预报", reason: "未接入外部预报" },
];
</script>

<template>
  <section class="reports-page">
    <div class="report-meta-bar">
      <div>
        <strong>常用报表</strong>
        <span>
          共 {{ reports.length }} 张 · 生成时间 {{ generatedAt }} · 固定参考时刻，刷新不漂移
        </span>
      </div>
      <NTag size="small" :bordered="false" type="info">本地 Mock · 不接后端</NTag>
    </div>

    <section class="panel handover-panel" aria-label="AI交接班报告">
      <div class="panel-head handover-head">
        <div><h2>交接班报告 · AI多步骤办事</h2>
          <p>从现有智能值守、活动告警、工单与设备健康汇总生成。需人工复核；本地MOCK审核不等于正式生产归档。</p>
        </div>
        <NTag type="info" size="small">{{ handovers.length }} 份演示记录</NTag>
      </div>
      <div v-if="!handovers.length" class="handover-empty">
        还没有交接班报告。点击页面右上角「问 AI」，输入“帮我完成今天的运行检查，整理异常情况，生成交班报告”，再确认保存草稿。
      </div>
      <template v-else>
        <div class="handover-list">
          <button v-for="item in handovers.slice(0, 12)" :key="item.id" type="button"
            :class="{selected:handoverId===item.id}" @click="handoverId=item.id">
            <strong>{{ item.id }}</strong>
            <span>{{ new Date(item.preparedAt).toLocaleString('zh-CN',{hour12:false}) }}</span>
            <NTag size="small" :type="item.status==='reviewed'?'success':'warning'">
              {{ item.status==='reviewed'?'DEMO已审核':'待审核' }}
            </NTag>
          </button>
        </div>
        <div v-if="handover" class="handover-detail">
          <div class="handover-detail-head">
            <div><strong>{{ handover.title }}</strong><small>编号 {{ handover.id }} · 来源 {{ handover.source }} · 生成角色 {{ handover.preparedBy }}</small></div>
            <NButton size="small" secondary @click="exportHandover(handover)">导出 Markdown</NButton>
          </div>
          <div class="handover-metrics">
            <div><span>已配置巡查</span><strong>{{ handover.coverage.configured }}/{{ handover.coverage.total }} 工艺</strong></div>
            <div><span>值守未关闭事件</span><strong>{{ handover.openDutyCount }}</strong></div>
            <div><span>当前活动生产告警</span><strong>{{ handover.activeProductionAlarmCount }}</strong></div>
            <div><span>未完工单（含草稿）</span><strong>{{ handover.outstandingOrderCount }}</strong></div>
          </div>
          <div class="handover-alerts">
            <p v-for="(warn,i) in handover.warnings" :key="i">{{ warn }}</p>
          </div>
          <details class="handover-full">
            <summary>查看报告全文、事件编号、巡查项和审核记录</summary>
            <pre>{{ handover.text }}</pre>
          </details>
          <div v-if="handover.status==='pending_review'" class="handover-review">
            <div><strong>管理人员审核（DEMO）</strong><p>请核查来源、监护范围、未完工单与资料缺失后填写意见。此操作只更改本地演示报告状态。</p></div>
            <NInput v-model:value="reviewNote" type="textarea" :rows="2"
              :disabled="!canReview" placeholder="填写审核意见，建议明确未覆盖的五套工艺和需现场确认事项" />
            <NButton type="primary" :disabled="!canReview || !reviewNote.trim()" @click="reviewSelected">
              确认演示审核归档
            </NButton>
            <p v-if="!canReview" class="handover-muted">当前角色没有审核权限，需由管理者或系统管理员进行演示审核。</p>
          </div>
          <p v-else class="handover-reviewed">DEMO审核记录：{{ handover.reviewedBy }} · {{ handover.reviewedAt ? new Date(handover.reviewedAt).toLocaleString('zh-CN',{hour12:false}) : '' }} · {{ handover.reviewNote }}</p>
        </div>
      </template>
    </section>

    <section class="panel missing-panel">
      <div class="panel-head">
        <div>
          <h2>缺数指标</h2>
          <p>以下指标在种子中没有可用数据，统一显示“缺数”，不生成替代曲线。</p>
        </div>
      </div>
      <div class="missing-grid">
        <div v-for="item in missingIndicators" :key="item.label" class="missing-item">
          <span>{{ item.label }}</span>
          <strong>缺数</strong>
          <small>{{ item.reason }}</small>
        </div>
      </div>
    </section>

    <div class="report-grid">
      <section v-for="report in reports" :id="'report-'+report.id" :key="report.id"
        class="panel report-card" :class="{'report-highlight':route.query.reportId===report.id}">
        <div class="report-head">
          <div>
            <h2>{{ report.title }}</h2>
            <p>{{ report.description }}</p>
          </div>
          <NTag size="small" :bordered="false">{{ report.rows.length }} 行</NTag>
        </div>

        <dl class="report-meta">
          <div>
            <dt>数据来源</dt>
            <dd>{{ report.source }}</dd>
          </div>
          <div>
            <dt>统计口径</dt>
            <dd>{{ report.caliber }}</dd>
          </div>
          <div>
            <dt>生成时间</dt>
            <dd>{{ generatedAt }}（固定参考时刻）</dd>
          </div>
        </dl>

        <p class="missing-line">缺数提示：{{ report.missing }}</p>

        <div class="report-actions">
          <NButton size="small" secondary @click="toggle(report.id)">
            {{ isOpen(report.id) ? "收起表格" : "展开表格" }}
          </NButton>
          <NButton size="small" type="primary" secondary @click="exportReport(report)">
            导出 CSV
          </NButton>
        </div>

        <div v-if="isOpen(report.id)" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th v-for="column in report.columns" :key="column.key">
                  {{ column.title }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in report.rows" :key="index">
                <td v-for="column in report.columns" :key="column.key">
                  {{ row[column.key] ?? "缺数" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <p class="footer-note">
      模拟声明：上述报表均由本地固定种子与规则计算生成，用于演示数据口径与 CSV 导出流程，
      不代表真实生产统计、考核或结算依据。
    </p>
  </section>
</template>

<style scoped>
/* 本地交班报告保留在既有常用报表，默认先看状态与遗留风险 */
.handover-panel{padding:19px}
.handover-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.handover-head p{font-size:12px;color:#8ba2b1;line-height:1.7}
.handover-empty{padding:24px;background:#f7fbfe;border-radius:8px;font-size:12px;line-height:1.8;color:#7b93a5}
.handover-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.handover-list button{display:flex;gap:9px;align-items:center;padding:9px 10px;border-radius:8px;border:1px solid #d9e8f1;background:#f8fbfd;cursor:pointer;text-align:left}
.handover-list button.selected{background:#eaf7ff;border-color:#8bc4e7}
.handover-list strong{font-size:11px;color:#24618a}.handover-list span{font-size:11px;color:#8ca3b0}
.handover-detail{border:1px solid #dcebf4;border-radius:9px;padding:15px}
.handover-detail-head{display:flex;justify-content:space-between;gap:8px;align-items:center}
.handover-detail-head>div{display:grid;gap:6px}
.handover-detail-head strong{font-size:15px;color:#316280}
.handover-detail-head small{font-size:11px;color:#91a8b6}
.handover-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:15px}
.handover-metrics>div{padding:11px;background:#eff8fd;border-radius:7px;display:grid;gap:7px}
.handover-metrics span{font-size:11px;color:#7795aa}
.handover-metrics strong{font-size:15px;color:#285d7f}
.handover-alerts{margin:12px 0;padding:8px 12px;background:#fffaf3;border:1px solid #f2e5d1;border-radius:8px}
.handover-alerts p{font-size:11px;line-height:1.7;color:#906f48;margin:4px 0}
.handover-full{padding:10px;background:#f8fbfe;border:1px solid #e3edf4;border-radius:8px}
.handover-full summary{font-size:12px;cursor:pointer;color:#2e80a8}
.handover-full pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:370px;overflow:auto;color:#52748a;font:11px/1.9 ui-monospace,monospace}
.handover-review{margin-top:14px;display:grid;gap:10px}
.handover-review strong{font-size:13px}
.handover-review p,.handover-muted{font-size:11px;color:#7e9bad;line-height:1.7;margin:4px 0}
.handover-review .n-button{justify-self:start}
.handover-reviewed{font-size:12px;color:#23916d;background:#eaf9f3;padding:12px;border-radius:6px}
@media(max-width:950px){.handover-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.handover-metrics{grid-template-columns:1fr}.handover-detail-head{align-items:flex-start;flex-direction:column}}
.reports-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.report-meta-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(236, 246, 252, 0.9));
}
.report-meta-bar strong {
  font-size: 14px;
  color: #1c3e57;
}
.report-meta-bar span {
  margin-left: 10px;
  font-size: 11px;
  color: #7c91a4;
}
.panel {
  min-width: 0;
  padding: 16px 18px;
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}
.panel-head h2 {
  margin: 0;
  font-size: 16px;
  color: #1c3e57;
}
.panel-head p {
  margin: 5px 0 0;
  font-size: 12px;
  color: #748a9d;
  line-height: 1.7;
}
.missing-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.missing-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #f0d6a4;
  background: #fffaf0;
}
.missing-item span {
  font-size: 11px;
  color: #8a7446;
}
.missing-item strong {
  font-size: 16px;
  color: #a06a1f;
}
.missing-item small {
  font-size: 10px;
  color: #a8946a;
}
.report-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.report-card.report-highlight{outline:2px solid #7bb8d3;outline-offset:2px;scroll-margin-top:20px}
.report-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.report-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.report-head h2 {
  margin: 0;
  font-size: 16px;
  color: #1c3e57;
}
.report-head p {
  margin: 5px 0 0;
  font-size: 12px;
  color: #748a9d;
  line-height: 1.7;
}
.report-meta {
  margin: 0;
  border-top: 1px solid #e4eef5;
}
.report-meta > div {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #eef4f8;
}
.report-meta dt {
  font-size: 11px;
  color: #8296a8;
}
.report-meta dd {
  margin: 0;
  font-size: 11.5px;
  color: #3d566c;
  line-height: 1.6;
}
.missing-line {
  margin: 0;
  padding: 7px 10px;
  border-radius: 7px;
  background: #fffaf0;
  border: 1px solid #f0d6a4;
  font-size: 10.5px;
  color: #8a7446;
  line-height: 1.6;
}
.report-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.table-wrap {
  width: 100%;
  overflow-x: auto;
  border-top: 1px solid #e4eef5;
  padding-top: 8px;
}
.data-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  font-size: 11.5px;
}
.data-table th {
  text-align: left;
  padding: 7px 8px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
  white-space: nowrap;
}
.data-table td {
  padding: 8px;
  border-bottom: 1px solid #e6eef4;
  color: #2a4660;
  vertical-align: top;
}
.footer-note {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f2f7fb;
  font-size: 11px;
  color: #6b8194;
  line-height: 1.7;
}
@media (max-width: 1360px) {
  .missing-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 1180px) {
  .report-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

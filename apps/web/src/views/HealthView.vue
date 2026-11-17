<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { NButton, NSelect, NTag, useMessage } from "naive-ui";
import PumpEnergyOptimizer from "../components/PumpEnergyOptimizer.vue";
import AssetJourney from "../components/AssetJourney.vue";
import { can } from "../demo/permissions";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import {
  DEFAULT_HEALTH_PROFILE,
  isPumpAsset,
  scorePumpHealth,
  THRESHOLD_SOURCE,
} from "../demo/health";
import type { HealthBand } from "../demo/health";
import { estimateThresholdCrossing } from "../demo/trend";
import type { ThresholdTrend, TrendStatus } from "../demo/trend";
import { buildAdvice, findReviewedEvidence, verifyAdvice } from "../demo/evidence";
import type { AdviceItem } from "../demo/evidence";
import type {
  EvidenceRef,
  MeasurePoint,
  TelemetrySample,
} from "../demo/types";

const DAY = 86_400_000;
const THRESHOLD = DEFAULT_HEALTH_PROFILE.vibration.critical;
const CHART_WIDTH = 640;
const CHART_HEIGHT = 260;
const PAD = { left: 48, right: 16, top: 18, bottom: 34 };

const route = useRoute();
const router = useRouter();
const store = useDemoStore();
const ui = useUiStore();
const message = useMessage();
const activeTab = ref<"health" | "energy">(route.query.tab === "energy" ? "energy" : "health");
watch(() => route.query.tab, value => {
  activeTab.value = value === "energy" ? "energy" : "health";
});


const referenceTime = computed(() => store.seed.referenceTime);
const referenceMs = computed(() => Date.parse(referenceTime.value));

const pumps = computed(() =>
  store.assets.filter((item) => !item.archived && isPumpAsset(item)),
);
const queryAssetId = computed(() =>
  typeof route.query.assetId === "string" ? route.query.assetId : "",
);
const defaultAssetId = computed(
  () => pumps.value.find((item) => item.code === "P-002")?.id ?? pumps.value[0]?.id ?? "",
);
const selectedId = ref(queryAssetId.value || defaultAssetId.value);
const asset = computed(() => store.getAsset(selectedId.value));

const assetOptions = computed(() => {
  const options = pumps.value.map((item) => ({
    value: item.id,
    label: `${item.code} · ${item.name}`,
  }));
  if (asset.value && !options.some((item) => item.value === asset.value?.id)) {
    options.unshift({
      value: asset.value.id,
      label: `${asset.value.code} · ${asset.value.name}（非泵类）`,
    });
  }
  return options;
});

const rangeDays = ref<14 | 7>(14);
const rangeOptions = [
  { value: 14, label: "近 14 日" },
  { value: 7, label: "近 7 日" },
];

watch(
  () => route.query.assetId,
  (value) => {
    if (typeof value === "string" && store.getAsset(value)) selectedId.value = value;
  },
);
watch(selectedId, id=>{
 if(!id || route.query.assetId===id)return;
 void router.replace({path:route.path,query:{...route.query,assetId:id}});
});
watch(
  () => store.assets.map((item) => item.id).join("|"),
  () => {
    if (!store.getAsset(selectedId.value)) selectedId.value = defaultAssetId.value;
  },
);

function findPoint(assetId: string, key: string, keyword: string): MeasurePoint | undefined {
  const points = store.getPoints(assetId);
  return (
    points.find((point) => point.id.endsWith(`-${key}`)) ??
    points.find((point) => point.kind === "number" && point.label.includes(keyword))
  );
}

function latestValue(assetId: string, key: string, keyword: string): number | null {
  const point = findPoint(assetId, key, keyword);
  if (!point) return null;
  const sample = store.latest(point.id);
  return sample && sample.quality === "valid" && typeof sample.value === "number"
    ? sample.value
    : null;
}

function subsystemLabel(id: string): string {
  return store.subsystems.find((item) => item.id === id)?.name ?? id;
}

const vibrationPoint = computed(() =>
  asset.value ? findPoint(asset.value.id, "vibration", "振动") : undefined,
);

const readings = computed(() => ({
  vibration: asset.value
    ? latestValue(asset.value.id, "vibration", "振动")
    : null,
  temperature: asset.value
    ? latestValue(asset.value.id, "temperature", "温度")
    : null,
  current: asset.value ? latestValue(asset.value.id, "current", "电流") : null,
}));

const health = computed(() => {
  const current = asset.value;
  if (!current) return null;
  return scorePumpHealth({
    asset: current,
    readings: readings.value,
    runtimeHours: current.runtimeHours,
    startCount: current.startCount,
    asOf: referenceTime.value,
  });
});

const trendFrom = computed(() =>
  new Date(referenceMs.value - 14 * DAY).toISOString(),
);
const allSeries = computed<TelemetrySample[]>(() =>
  vibrationPoint.value
    ? store.series(vibrationPoint.value.id, trendFrom.value, referenceTime.value)
    : [],
);
const trend = computed<ThresholdTrend | null>(() =>
  vibrationPoint.value
    ? estimateThresholdCrossing(allSeries.value, THRESHOLD, { horizonDays: 14 })
    : null,
);

const activeAlarms = computed(() =>
  asset.value
    ? store.alarms.filter(
        (alarm) => alarm.assetId === asset.value?.id && alarm.status === "active",
      )
    : [],
);

const evidence = computed<EvidenceRef[]>(() =>
  asset.value
    ? findReviewedEvidence(store.seed, store.userState, asset.value.id)
    : [],
);

const advice = computed(() => {
  if (!asset.value || !health.value) return null;
  return buildAdvice({
    asset: asset.value,
    health: health.value,
    trend: trend.value,
    trendPointId: vibrationPoint.value?.id,
    trendPointLabel: vibrationPoint.value?.label ?? "振动速度",
    evidence: evidence.value,
    documents: store.documents,
    activeAlarms: activeAlarms.value,
  });
});

const verification = computed(() =>
  advice.value ? verifyAdvice(advice.value, advice.value.evidenceIds) : null,
);
const verifiedAdvice = computed(() => verification.value?.advice ?? null);
const blockedClaims = computed(() => verification.value?.blockedClaims ?? []);

const assetCards = computed(() =>
  pumps.value.map((item) => {
    const result = scorePumpHealth({
      asset: item,
      readings: {
        vibration: latestValue(item.id, "vibration", "振动"),
        temperature: latestValue(item.id, "temperature", "温度"),
        current: latestValue(item.id, "current", "电流"),
      },
      runtimeHours: item.runtimeHours,
      startCount: item.startCount,
      asOf: referenceTime.value,
    });
    return { asset: item, band: result.band, score: result.score };
  }),
);

interface ChartModel {
  width: number;
  height: number;
  observedPath: string;
  projectedPath: string;
  thresholdY: number | null;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  observedCount: number;
  hasProjected: boolean;
}

function formatDay(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

const chart = computed<ChartModel | null>(() => {
  if (!asset.value || health.value?.modelUnavailable) return null;
  const cutoff = referenceMs.value - rangeDays.value * DAY;
  const observed = allSeries.value
    .filter(
      (sample) =>
        typeof sample.value === "number" &&
        sample.quality === "valid" &&
        Date.parse(sample.at) >= cutoff,
    )
    .map((sample) => ({
      at: Date.parse(sample.at),
      value: sample.value as number,
    }));

  const projected =
    trend.value?.status === "estimated"
      ? trend.value.projected.map((point) => ({
          at: Date.parse(point.at),
          value: point.value,
        }))
      : [];

  const allTimes = [...observed, ...projected].map((point) => point.at);
  const allValues = [...observed, ...projected].map((point) => point.value);
  allValues.push(THRESHOLD);

  const xMin = observed.length > 0 ? Math.min(cutoff, observed[0].at) : cutoff;
  let xMax = allTimes.length > 0 ? Math.max(...allTimes) : referenceMs.value;
  if (xMax <= xMin) xMax = xMin + DAY;

  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  const span = Math.max(0.2, yMax - yMin);
  yMin -= span * 0.12;
  yMax += span * 0.12;

  const innerWidth = CHART_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const sx = (ms: number) =>
    PAD.left + ((ms - xMin) / (xMax - xMin)) * innerWidth;
  const sy = (value: number) =>
    PAD.top + (1 - (value - yMin) / (yMax - yMin)) * innerHeight;

  const pathOf = (points: { at: number; value: number }[]) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${sx(point.at).toFixed(2)} ${sy(point.value).toFixed(2)}`,
      )
      .join(" ");

  const yTicks = [yMin, (yMin + yMax) / 2, yMax].map((value) => ({
    y: sy(value),
    label: value.toFixed(2),
  }));

  const xTicks = [xMin, (xMin + xMax) / 2, xMax].map((ms) => ({
    x: sx(ms),
    label: formatDay(ms),
  }));

  return {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    observedPath: pathOf(observed),
    projectedPath: pathOf(projected),
    thresholdY: sy(THRESHOLD),
    yTicks,
    xTicks,
    observedCount: observed.length,
    hasProjected: projected.length > 0,
  };
});

const TREND_LABELS: Record<TrendStatus, string> = {
  estimated: "预计触阈",
  already_exceeded: "已触阈",
  insufficient: "样本不足",
  not_rising: "无上升趋势",
  low_fit: "波动过大",
  out_of_horizon: "超出窗口",
};

const TREND_TAG_TYPES: Record<
  TrendStatus,
  "success" | "warning" | "error" | "info" | "default"
> = {
  estimated: "warning",
  already_exceeded: "error",
  insufficient: "info",
  not_rising: "default",
  low_fit: "info",
  out_of_horizon: "default",
};

const BAND_TAG_TYPES: Record<
  HealthBand,
  "success" | "warning" | "error" | "info" | "default"
> = {
  健康: "success",
  关注: "warning",
  预警: "warning",
  危险: "error",
  资料不足: "info",
  无适配模型: "default",
};

const BAND_CLASSES: Record<HealthBand, string> = {
  健康: "ok",
  关注: "warn",
  预警: "alert",
  危险: "danger",
  资料不足: "muted",
  无适配模型: "muted",
};

function bandClass(band: HealthBand | undefined): string {
  return band ? BAND_CLASSES[band] : "muted";
}

const converged = computed(() =>
  health.value && health.value.coverage === 1 ? "4/4 因子有效" : `${Math.round((health.value?.coverage ?? 0) * 4)}/4 因子有效`,
);

const ASSET_STATUS_LABELS: Record<string, string> = {
  running: "运行",
  stopped: "停机",
  fault: "故障",
  unknown: "未知",
};

const WORK_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_dispatch: "待派单",
  in_progress: "维修中",
  pending_acceptance: "待验收",
  archived: "已归档",
  cancelled: "已取消",
};

const EVIDENCE_KIND_LABELS: Record<EvidenceRef["kind"], string> = {
  telemetry: "遥测",
  alarm: "告警",
  workorder: "工单",
  document: "档案",
  inspection: "巡检",
  asset: "设备",
};

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  manual: "使用说明",
  procedure: "操作规程",
  "inspection-standard": "巡检标准",
  drawing: "图纸",
  certificate: "合格证",
  case: "维修案例",
  other: "其他资料",
};

function evidenceKindLabel(kind: EvidenceRef["kind"]): string {
  return EVIDENCE_KIND_LABELS[kind] ?? kind;
}

const selectedEvidence = ref<EvidenceRef | null>(null);

function openEvidence(refId: string): void {
  const found = evidence.value.find((item) => item.refId === refId);
  if (found) {
    selectedEvidence.value = found;
    evidenceOpen.value = true;
    return;
  }
  const point = vibrationPoint.value;
  if (point && refId === point.id) {
    selectedEvidence.value = {
      kind: "telemetry",
      refId: point.id,
      label: `${point.label} 近 14 日序列`,
      detail: "来自本地 Mock 遥测序列，趋势与评分使用同一测点。",
      source: point.source,
    };
    evidenceOpen.value = true;
  }
}

function evidenceChipLabel(refId: string): string {
  const item = evidence.value.find((entry) => entry.refId === refId);
  if (item) return item.label;
  if (refId === vibrationPoint.value?.id) {
    return `遥测 · ${vibrationPoint.value?.label ?? "振动速度"}`;
  }
  return refId;
}

interface EvidenceDetail {
  title: string;
  meta: string[];
  body: string[];
}

const evidenceDetail = computed<EvidenceDetail | null>(() => {
  const ref = selectedEvidence.value;
  if (!ref) return null;
  const targetAsset = asset.value;

  if (ref.kind === "document") {
    const document = store.documents.find((item) => item.id === ref.refId);
    if (!document) {
      return {
        title: ref.label,
        meta: [`类型：${DOCUMENT_KIND_LABELS[ref.kind] ?? "档案"}`, "状态：原文不可用"],
        body: ["该档案已被移除或不可用，建议不再引用其条款。"],
      };
    }
    return {
      title: document.title,
      meta: [
        `类型：${DOCUMENT_KIND_LABELS[document.kind] ?? document.kind}`,
        `版本：${document.version}`,
        `审核：${document.reviewed ? "已审核" : "未审核"}`,
        `更新：${formatDate(document.updatedAt)}`,
        document.lineOrSection ?? "",
        `来源：${document.sourceLabel}`,
      ].filter(Boolean),
      body: [document.summary ?? "", document.contentExcerpt ?? ""].filter(Boolean),
    };
  }

  if (ref.kind === "workorder") {
    const order = store.workorders.find((item) => item.id === ref.refId);
    if (!order) {
      return {
        title: ref.label,
        meta: [`类型：工单`, "状态：未找到"],
        body: [],
      };
    }
    return {
      title: `${order.code} ${order.title}`,
      meta: [
        "类型：工单",
        `状态：${WORK_ORDER_STATUS_LABELS[order.status] ?? order.status}`,
        `创建：${formatDate(order.createdAt)}`,
        order.acceptance ? `验收：${formatDate(order.acceptance.at)}` : "验收：未归档",
      ],
      body: [
        `症状：${order.symptom}`,
        `建议：${order.suggestion}`,
        order.result ? `原因：${order.result.cause}` : "",
        order.result ? `措施：${order.result.measures}` : "",
      ].filter(Boolean),
    };
  }

  if (ref.kind === "inspection") {
    const record = store.inspections.find((item) => item.id === ref.refId);
    if (!record) {
      return {
        title: ref.label,
        meta: [`类型：巡检`, "状态：未找到"],
        body: [],
      };
    }
    return {
      title: `巡检 ${record.id}`,
      meta: [
        "类型：巡检",
        `时间：${formatDate(record.inspectedAt)}`,
        `巡检人：${record.inspector}`,
        `结果：${record.result === "normal" ? "正常" : "发现异常"}`,
      ],
      body: [
        ...record.items.map(
          (item) => `${item.label}：${item.value}${item.abnormal ? "（异常）" : ""}`,
        ),
        record.note ?? "",
      ].filter(Boolean),
    };
  }

  if (ref.kind === "alarm") {
    const alarm = store.alarms.find((item) => item.id === ref.refId);
    if (!alarm) {
      return {
        title: ref.label,
        meta: [`类型：告警`, "状态：未找到"],
        body: [],
      };
    }
    return {
      title: alarm.title,
      meta: [
        "类型：告警",
        `级别：${alarm.level}`,
        `状态：${alarm.status}`,
        `发生：${formatDateTime(alarm.occurredAt)}`,
      ],
      body: [alarm.detail],
    };
  }

  if (ref.kind === "telemetry" && targetAsset) {
    const point = vibrationPoint.value;
    return {
      title: ref.label,
      meta: [
        "类型：遥测序列",
        `测点：${point?.id ?? "—"}`,
        `最新值：${latestValue(targetAsset.id, "vibration", "振动") ?? "—"} ${point?.unit ?? ""}`,
        `质量：${point?.quality ?? "—"}`,
        "来源：MOCK",
      ],
      body: [
        trend.value?.reason ?? "趋势不可估计。",
        "评分与趋势共用同一测点序列，未另造随机曲线。",
      ],
    };
  }

  return {
    title: ref.label,
    meta: [`类型：${evidenceKindLabel(ref.kind)}`],
    body: [ref.detail ?? ""].filter(Boolean),
  };
});

const evidenceOpen = ref(false);
const lastOrderId = ref<string | null>(null);

const linkedAlarm = computed(() =>
  store.alarms.find(item => item.id === route.query.alarmId && item.assetId === asset.value?.id),
);
const relatedOrdersLink = computed(() => ({
  name: "workorders",
  query: linkedAlarm.value?.workOrderId
    ? { workOrderId: linkedAlarm.value.workOrderId }
    : { assetId: asset.value?.id },
}));
const canCreateOrder = computed(() => can(store.role, "workorder:create"));
const canCreateReason = computed(() =>
  canCreateOrder.value
    ? "按权限 workorder:create 生成草稿，不自动派单。"
    : "当前角色无工单创建权限（需 workorder:create），按钮已禁用。",
);

function arrangeCheck(): void {
  if (linkedAlarm.value?.workOrderId) return;
  const current = asset.value;
  const point = vibrationPoint.value;
  const snapshot = trend.value;
  if (!current || !point || !snapshot) {
    message.warning("缺少可用的趋势快照，暂不能生成工单草稿");
    return;
  }
  const observations = verifiedAdvice.value?.observations
    .map((item) => item.text)
    .join("；");
  const checks = verifiedAdvice.value?.checks.map((item) => item.text).join(" ");
  try {
    const order = store.createWorkOrder({
      title: `${current.code} ${point.label}趋势检查（演示草稿）`,
      assetId: current.id,
      source: "health_trend",
      alarmId: linkedAlarm.value?.id,
      symptom: observations || snapshot.reason,
      suggestion:
        checks || "现场复测振动、温度与电流，记录工况并对照近 14 日序列。",
      priority:
        health.value?.score !== null &&
        health.value?.score !== undefined &&
        health.value.score < 40
          ? "high"
          : "medium",
      evidenceIds: verifiedAdvice.value?.evidenceIds ?? [],
      triggerSnapshot: {
        rangeFrom: trendFrom.value,
        rangeTo: referenceTime.value,
        pointId: point.id,
        threshold: snapshot.threshold,
      },
    });
    lastOrderId.value = order.id;
    message.success("已生成草稿，未派单");
  } catch (error) {
    message.error((error as Error).message);
  }
}

const workOrderLink = computed(() =>
  lastOrderId.value
    ? `/operations/workorders?workOrderId=${lastOrderId.value}`
    : "",
);

function adviceList(items: AdviceItem[] | undefined): AdviceItem[] {
  return items ?? [];
}
</script>

<template>
  <section class="health-page">
    <AssetJourney v-if="asset" :asset-id="asset.id" />
    <nav class="health-work-tabs" aria-label="健康能效业务切换">
      <button type="button" :class="{selected:activeTab==='health'}" @click="activeTab='health'">设备健康诊断</button>
      <button type="button" :class="{selected:activeTab==='energy'}" @click="activeTab='energy'">泵组能效匹配与运行优化</button>
      <span>同一设备管理模块 · 两类独立专业能力</span>
    </nav>
    <PumpEnergyOptimizer v-if="activeTab === 'energy'" />
    <div v-if="activeTab === 'health'" class="knowledge-entry panel">
      <div><strong>需要追溯诊断依据？</strong><span>依据必须能定位到原始设备档案、版本、章节以及可查看的原文片段。</span></div>
      <router-link :to="{path:'/decision/knowledge',query:{assetId:asset?.id??'asset-p002',symptom:'振动异常'}}">查看证据知识与诊断</router-link>
    </div>
    <div v-if="activeTab === 'health'" class="toolbar panel">
      <div class="toolbar-main">
        <div class="field">
          <span class="field-label">设备</span>
          <NSelect
            v-model:value="selectedId"
            :options="assetOptions"
            style="width: 250px"
            aria-label="选择设备"
          />
        </div>
        <div class="field">
          <span class="field-label">时间范围</span>
          <NSelect
            v-model:value="rangeDays"
            :options="rangeOptions"
            style="width: 120px"
            aria-label="时间范围"
          />
        </div>
        <span class="toolbar-hint">
          图表可切 7 日，趋势门槛仍按近 14 日同一测点序列计算
        </span>
      </div>
      <div class="toolbar-actions">
        <NTag size="small" :bordered="false">MOCK</NTag>
        <NTag size="small" :bordered="false" type="info">CALCULATED</NTag>
        <NButton
          v-if="asset"
          size="small"
          secondary
          @click="ui.openAsset(asset.id)"
        >
          设备详情
        </NButton>
        <NButton
          class="drawer-only"
          size="small"
          type="primary"
          @click="evidenceOpen = true"
        >
          查看证据与建议
        </NButton>
      </div>
    </div>

    <template v-if="activeTab === 'health'">
    <div v-if="!asset" class="panel empty-state">
      <h2>未找到设备</h2>
      <p>请从左侧设备列表选择一台泵类设备。</p>
    </div>

    <div v-else class="health-grid">
      <aside class="panel asset-col">
        <div class="col-head">
          <h2>泵类设备</h2>
          <span class="caption">{{ assetCards.length }} 台</span>
        </div>
        <button
          v-for="card in assetCards"
          :key="card.asset.id"
          type="button"
          class="asset-item"
          :class="{ active: card.asset.id === selectedId }"
          @click="selectedId = card.asset.id"
        >
          <span class="asset-item-main">
            <strong>{{ card.asset.code }}</strong>
            <span>{{ card.asset.name }}</span>
            <small>
              {{ subsystemLabel(card.asset.subsystemId) }} ·
              {{ ASSET_STATUS_LABELS[card.asset.status] ?? card.asset.status }}
            </small>
          </span>
          <span class="band-badge" :class="bandClass(card.band)">
            {{ card.band }}
          </span>
        </button>
      </aside>

      <div class="center-col">
        <section v-if="health" class="panel score-card">
          <div class="score-head">
            <div>
              <span class="eyebrow">当前健康评分 · CALCULATED</span>
              <h2>
                {{ asset.name }}
                <small>{{ asset.code }}</small>
              </h2>
              <p class="score-sub">
                {{ asset.type }} ·
                {{ ASSET_STATUS_LABELS[asset.status] ?? asset.status }} ·
                规则版本 {{ health.ruleVersion }}
              </p>
            </div>
            <NTag :type="BAND_TAG_TYPES[health.band]" :bordered="false">
              {{ health.band }}
            </NTag>
          </div>

          <div v-if="health.modelUnavailable" class="notice warn">
            <strong>无适配评分模型</strong>
            <p>{{ health.missingReasons.join("；") }}。本演示仅对泵类设备套用主泵评分，不套用振动/温度/电流阈值。</p>
          </div>

          <template v-else>
            <div class="score-main">
              <div class="score-number">
                <strong>{{ health.score === null ? "—" : health.score.toFixed(1) }}</strong>
                <span>/ 100</span>
              </div>
              <div class="score-side">
                <div class="coverage">
                  <span>因子覆盖率</span>
                  <strong>{{ Math.round(health.coverage * 100) }}%</strong>
                  <small>{{ converged }}</small>
                </div>
                <div class="coverage-bar">
                  <i :style="{ width: `${health.coverage * 100}%` }"></i>
                </div>
                <p class="score-caption">
                  计算时刻 {{ formatDateTime(health.calculatedAt) }} ·
                  Profile {{ health.profileVersion }} ·
                  阈值来源 {{ THRESHOLD_SOURCE }}
                </p>
              </div>
            </div>

            <div v-if="health.score === null" class="notice">
              <strong>资料不足，未给出完整健康分</strong>
              <p v-for="reason in health.missingReasons" :key="reason">{{ reason }}</p>
              <p>缺测不按 0 风险处理，也不自动重加权成 100 分。</p>
            </div>

            <p v-if="trend">{{ trend.reason }}</p>
            <details>
              <summary>计算依据</summary>
              <p class="formula">{{ health.formulaSummary }}</p>
              <p class="limits">{{ health.limits }}</p>
            </details>
          </template>
        </section>

        <section v-if="health && !health.modelUnavailable" class="panel factor-card">
          <div class="col-head">
            <h2>因子明细</h2>
            <span class="caption">原值 / 警戒 / 危险 / 风险 / 扣分 / 来源</span>
          </div>
          <div class="table-wrap">
            <table class="factor-table">
              <thead>
                <tr>
                  <th>因子</th>
                  <th>原值</th>
                  <th>警戒</th>
                  <th>危险</th>
                  <th>风险</th>
                  <th>扣分</th>
                  <th>来源</th>
                  <th>有效性</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="factor in health.factors"
                  :key="factor.key"
                  :class="{ invalid: !factor.valid }"
                >
                  <td>
                    <strong>{{ factor.label }}</strong>
                    <small v-if="factor.detail">{{ factor.detail }}</small>
                    <small v-if="!factor.valid && factor.missingReason" class="missing">
                      {{ factor.missingReason }}
                    </small>
                  </td>
                  <td>{{ factor.value === null ? "缺测" : `${factor.value} ${factor.unit}` }}</td>
                  <td>{{ factor.warning }} {{ factor.unit }}</td>
                  <td>{{ factor.critical }} {{ factor.unit }}</td>
                  <td>{{ factor.risk === null ? "—" : `${(factor.risk * 100).toFixed(0)}%` }}</td>
                  <td>{{ factor.deduction === null ? "—" : factor.deduction.toFixed(2) }}</td>
                  <td>{{ factor.source }}</td>
                  <td>
                    <NTag size="tiny" :bordered="false" :type="factor.valid ? 'success' : 'error'">
                      {{ factor.valid ? "有效" : "无效" }}
                    </NTag>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="chart" class="panel chart-card">
          <div class="col-head">
            <div>
              <h2>14 日观测与触阈外推</h2>
              <p class="chart-sub">
                {{ vibrationPoint?.label ?? "振动速度" }} · 阈值
                {{ THRESHOLD }} mm/s（{{ THRESHOLD_SOURCE }}）
                · 当前展示 {{ rangeDays }} 日
              </p>
            </div>
            <div class="chart-legend">
              <span><i class="line solid"></i>观测</span>
              <span><i class="line dashed"></i>模拟预测</span>
              <NTag size="tiny" type="warning" :bordered="false">模拟预测</NTag>
            </div>
          </div>

          <div v-if="chart.observedCount === 0" class="empty-state small">
            <p>该测点没有有效观测序列，无法绘制趋势；不生成虚构曲线。</p>
          </div>
          <div v-else class="chart-body">
            <svg
              :viewBox="`0 0 ${chart.width} ${chart.height}`"
              class="chart-svg"
              role="img"
              :aria-label="`${vibrationPoint?.label ?? '振动速度'} 观测与外推趋势图`"
            >
              <line
                v-for="tick in chart.yTicks"
                :key="`y-${tick.label}`"
                :x1="PAD.left"
                :x2="chart.width - PAD.right"
                :y1="tick.y"
                :y2="tick.y"
                class="grid-line"
              />
              <text
                v-for="tick in chart.yTicks"
                :key="`yt-${tick.label}`"
                :x="PAD.left - 8"
                :y="tick.y + 4"
                class="axis-label"
                text-anchor="end"
              >
                {{ tick.label }}
              </text>
              <text
                v-for="tick in chart.xTicks"
                :key="`xt-${tick.label}-${tick.x}`"
                :x="tick.x"
                :y="chart.height - 12"
                class="axis-label"
                text-anchor="middle"
              >
                {{ tick.label }}
              </text>
              <line
                v-if="chart.thresholdY !== null"
                :x1="PAD.left"
                :x2="chart.width - PAD.right"
                :y1="chart.thresholdY"
                :y2="chart.thresholdY"
                class="threshold-line"
              />
              <path :d="chart.observedPath" class="observed-line" />
              <path
                v-if="chart.hasProjected"
                :d="chart.projectedPath"
                class="projected-line"
              />
            </svg>
            <p v-if="chart.hasProjected" class="chart-note">
              虚线为按近 14 日线性拟合的外推结果（9 点，含起点与预测点），仅用于提示检查时机，不是故障发生时间；外推越长误差可能越大。
            </p>
            <p v-else class="chart-note">
              当前不满足外推门槛，不绘制预测虚线；原因见下方预测状态。
            </p>
          </div>
        </section>

        <section v-if="trend" class="panel trend-card">
          <div class="col-head">
            <div>
              <h2>预测状态</h2>
              <p class="chart-sub">门槛：≥10 样本、跨度 ≥48h、斜率 &gt;0、R²≥0.55、窗口 ≤14 天</p>
            </div>
            <NTag :type="TREND_TAG_TYPES[trend.status]" :bordered="false">
              {{ TREND_LABELS[trend.status] }}
            </NTag>
          </div>
          <p class="trend-reason">{{ trend.reason }}</p>
          <div class="metric-grid">
            <div><span>有效样本</span><strong>{{ trend.sampleCount }}</strong></div>
            <div><span>覆盖跨度</span><strong>{{ trend.spanDays }} 天</strong></div>
            <div><span>日斜率</span><strong>{{ trend.slopePerDay ?? "—" }}</strong></div>
            <div><span>R²</span><strong>{{ trend.rSquared ?? "—" }}</strong></div>
            <div><span>演示阈值</span><strong>{{ trend.threshold }} mm/s</strong></div>
            <div><span>预测窗口</span><strong>{{ trend.horizonDays }} 天</strong></div>
            <div>
              <span>预计触阈日期</span>
              <strong>{{ trend.status === "estimated" ? formatDate(trend.predictedAt) : "不给出" }}</strong>
            </div>
          </div>
          <p class="limits">
            预测值不是故障发生时间，也不代表故障概率；请以现场复测数据为准。
          </p>
        </section>

        <section class="panel order-card">
          <div class="col-head">
            <div>
              <h2>安排检查</h2>
              <p class="chart-sub">根据当前设备趋势和已核验的证据创建检查草稿。</p>
            </div>
            <NButton
              type="primary"
              size="small"
              v-if="canCreateOrder && !linkedAlarm?.workOrderId"
              :title="canCreateReason"
              @click="arrangeCheck"
            >
              安排检查
            </NButton>
          </div>
          <RouterLink v-if="!canCreateOrder || linkedAlarm?.workOrderId" :to="relatedOrdersLink">
            查看关联工单 →
          </RouterLink>
          <RouterLink v-if="linkedAlarm" :to="{ name: 'alarms', query: { alarmId: linkedAlarm.id } }">
            返回告警 →
          </RouterLink>
          <p v-if="workOrderLink" class="order-success">
            已生成草稿，未派单。
            <RouterLink :to="workOrderLink">打开工单 {{ lastOrderId }}</RouterLink>
          </p>
          <p class="limits">
            工单验收后只写入设备履历，不自动恢复健康分，也不改写历史监测。
          </p>
        </section>
      </div>

      <aside class="panel evidence-col" :class="{ open: evidenceOpen }">
        <div class="col-head evidence-head">
          <div>
            <h2>证据与建议</h2>
            <span class="caption">
              {{ verifiedAdvice?.degraded ? "资料缺失，已降级" : "引用已审核档案与历史记录" }}
            </span>
          </div>
          <button
            type="button"
            class="drawer-close"
            aria-label="关闭证据与建议"
            @click="evidenceOpen = false"
          >
            ×
          </button>
        </div>

        <p v-if="blockedClaims.length > 0" class="verify-note">
          已核验：拦截 {{ blockedClaims.length }} 条无证据或含结论性表述的判断。
        </p>

        <section class="advice-block">
          <h3>观察事实</h3>
          <div
            v-for="item in adviceList(verifiedAdvice?.observations)"
            :key="item.id"
            class="advice-item"
          >
            <p>{{ item.text }}</p>
            <div v-if="item.supportingEvidenceIds.length" class="chips">
              <button
                v-for="refId in item.supportingEvidenceIds"
                :key="refId"
                type="button"
                class="chip"
                @click="openEvidence(refId)"
              >
                {{ evidenceChipLabel(refId) }}
              </button>
            </div>
          </div>
        </section>

        <section class="advice-block">
          <h3>可能原因</h3>
          <p v-if="!adviceList(verifiedAdvice?.hypotheses).length" class="empty-line">
            缺少可引用的档案证据，不输出原因判断。
          </p>
          <div
            v-for="item in adviceList(verifiedAdvice?.hypotheses)"
            :key="item.id"
            class="advice-item"
          >
            <p>{{ item.text }}</p>
            <div class="chips">
              <button
                v-for="refId in item.supportingEvidenceIds"
                :key="refId"
                type="button"
                class="chip"
                @click="openEvidence(refId)"
              >
                {{ evidenceChipLabel(refId) }}
              </button>
            </div>
          </div>
        </section>

        <section class="advice-block">
          <h3>建议核查</h3>
          <p v-if="!adviceList(verifiedAdvice?.checks).length" class="empty-line">
            暂无可引用的检查建议。
          </p>
          <div
            v-for="item in adviceList(verifiedAdvice?.checks)"
            :key="item.id"
            class="advice-item"
          >
            <p>
              {{ item.text }}
              <span v-if="item.generic" class="generic-tag">通用检查</span>
            </p>
            <div v-if="item.supportingEvidenceIds.length" class="chips">
              <button
                v-for="refId in item.supportingEvidenceIds"
                :key="refId"
                type="button"
                class="chip"
                @click="openEvidence(refId)"
              >
                {{ evidenceChipLabel(refId) }}
              </button>
            </div>
          </div>
        </section>

        <section class="advice-block">
          <h3>不能判断 / 局限</h3>
          <div
            v-for="item in adviceList(verifiedAdvice?.limitations)"
            :key="item.id"
            class="advice-item"
          >
            <p>{{ item.text }}</p>
          </div>
        </section>

        <section class="advice-block">
          <h3>证据库（{{ evidence.length }}）</h3>
          <p v-if="!evidence.length" class="empty-line">
            该设备暂无已审核文档、巡检、已验收工单或告警证据。
          </p>
          <button
            v-for="item in evidence"
            :key="`${item.kind}-${item.refId}`"
            type="button"
            class="evidence-item"
            @click="openEvidence(item.refId)"
          >
            <span class="evidence-kind">{{ evidenceKindLabel(item.kind) }}</span>
            <span class="evidence-main">
              <strong>{{ item.label }}</strong>
              <small>{{ item.detail }}</small>
            </span>
            <span class="evidence-source">{{ item.source }}</span>
          </button>
        </section>

        <section v-if="evidenceDetail" class="evidence-detail">
          <div class="evidence-detail-head">
            <strong>{{ evidenceDetail.title }}</strong>
            <button type="button" aria-label="关闭详情" @click="selectedEvidence = null">
              ×
            </button>
          </div>
          <p v-for="meta in evidenceDetail.meta" :key="meta" class="meta">{{ meta }}</p>
          <p v-for="line in evidenceDetail.body" :key="line" class="detail-body">{{ line }}</p>
          <RouterLink v-if="selectedEvidence?.kind === 'document'"
            :to="{ name: 'archives', query: { docId: selectedEvidence.refId } }">
            打开资料原文 →
          </RouterLink>
          <NButton
            v-if="asset"
            size="tiny"
            secondary
            @click="ui.openAsset(asset.id)"
          >
            打开设备详情
          </NButton>
        </section>
      </aside>

      <div
        v-if="evidenceOpen"
        class="drawer-mask drawer-only"
        @click="evidenceOpen = false"
      ></div>
    </div>
    </template>
  </section>
</template>

<style scoped>
/* 既有健康页不改计算口径，能效作为独立工作视图切换 */
/* 从已有健康诊断直接进入原设备的资料核验 */
.knowledge-entry{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;margin-bottom:12px}
.knowledge-entry>div{display:grid;gap:5px}
.knowledge-entry strong{font-size:12px;color:#317390}
.knowledge-entry span{font-size:11px;color:#8ba8b9}
.knowledge-entry a{font-size:12px;color:#267ca4;text-decoration:none;white-space:nowrap}
@media(max-width:700px){.knowledge-entry{align-items:flex-start;flex-direction:column}}
.health-work-tabs{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 8px;background:#f4f9fc;border:1px solid #dce9f2;border-radius:9px;margin-bottom:12px}
.health-work-tabs button{border:0;background:transparent;font-size:13px;font-weight:600;color:#718fa4;padding:11px 15px;border-radius:7px;cursor:pointer}
.health-work-tabs button.selected{background:#fff;box-shadow:0 3px 10px #3a7b9c12;color:#126ca0;border:1px solid #dbeaf3}
.health-work-tabs span{margin-left:auto;font-size:11px;color:#9ab0c1}
@media(max-width:700px){.health-work-tabs span{display:none}.health-work-tabs button{flex:1;font-size:12px;padding:9px 7px}}
.health-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 16px;
  min-width: 0;
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
}
.toolbar-main {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  min-width: 0;
}
.field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.field-label {
  font-size: 12px;
  color: #6a8298;
  white-space: nowrap;
}
.toolbar-hint {
  font-size: 11px;
  color: #8ba0b2;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.drawer-only,
.drawer-close {
  display: none;
}
.health-grid {
  display: grid;
  grid-template-columns: minmax(190px, 22fr) minmax(0, 48fr) minmax(300px, 30fr);
  gap: 14px;
  align-items: start;
}
.center-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.col-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.col-head h2 {
  margin: 0;
  font-size: 16px;
  color: #1c3e57;
}
.col-head p {
  margin: 4px 0 0;
}
.caption {
  font-size: 11px;
  color: #8ba0b2;
}
.eyebrow {
  font-size: 10px;
  letter-spacing: 1px;
  color: #8ba0b2;
}
.score-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.score-head h2 {
  margin: 6px 0 4px;
  font-size: 19px;
  color: #17364d;
}
.score-head h2 small {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #6a8298;
}
.score-sub {
  margin: 0;
  font-size: 11.5px;
  color: #7c90a2;
}
.score-main {
  display: flex;
  align-items: center;
  gap: 24px;
  margin: 16px 0 12px;
  flex-wrap: wrap;
}
.score-number {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.score-number strong {
  font-size: 46px;
  line-height: 1;
  letter-spacing: 1px;
  color: #17628f;
}
.score-number span {
  font-size: 12px;
  color: #8ba0b2;
}
.score-side {
  flex: 1;
  min-width: 190px;
}
.coverage {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: #6a8298;
}
.coverage strong {
  font-size: 15px;
  color: #2f7a63;
}
.coverage small {
  margin-left: auto;
  color: #8ba0b2;
}
.coverage-bar {
  height: 6px;
  margin: 7px 0 8px;
  border-radius: 999px;
  background: #e8f1f7;
  overflow: hidden;
}
.coverage-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #54a892, #247ba8);
}
.score-caption {
  margin: 0;
  font-size: 11px;
  color: #8ba0b2;
  line-height: 1.7;
}
.notice {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f2f8fc;
  border: 1px solid #dbe8f2;
  font-size: 12px;
  color: #3d5a72;
}
.notice.warn {
  background: #fdf4e4;
  border-color: #f0d9ae;
  color: #8a5a14;
}
.notice strong {
  display: block;
  margin-bottom: 4px;
}
.notice p {
  margin: 2px 0;
}
.formula {
  margin: 8px 0 4px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #f5f9fc;
  font-size: 11px;
  color: #5d7387;
  line-height: 1.7;
  word-break: break-word;
}
.limits {
  margin: 6px 0 0;
  font-size: 11px;
  color: #8ba0b2;
  line-height: 1.7;
}
.asset-col {
  padding: 14px 12px;
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}
.asset-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  margin-bottom: 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #2d4d66;
  transition: background 0.16s, border-color 0.16s;
}
.asset-item:hover {
  background: #eef7fc;
}
.asset-item.active {
  background: linear-gradient(135deg, #e4f2fb, #e9f7f2);
  border-color: #b8dceb;
}
.asset-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.asset-item-main strong {
  font-size: 12.5px;
}
.asset-item-main span {
  font-size: 11.5px;
  color: #4a657c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-item-main small {
  font-size: 10px;
  color: #8ba0b2;
}
.band-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  white-space: nowrap;
}
.band-badge.ok {
  color: #2f7a63;
  background: #e3f4ed;
}
.band-badge.warn {
  color: #96651f;
  background: #fdf0d8;
}
.band-badge.alert {
  color: #a05a1c;
  background: #fbe4cc;
}
.band-badge.danger {
  color: #a63c35;
  background: #fbe1df;
}
.band-badge.muted {
  color: #6d7f8f;
  background: #edf2f6;
}
.table-wrap {
  overflow-x: auto;
}
.factor-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
.factor-table th {
  text-align: left;
  font-weight: 500;
  color: #8ba0b2;
  padding: 6px 8px;
  border-bottom: 1px solid #e6eef5;
  white-space: nowrap;
}
.factor-table td {
  padding: 7px 8px;
  border-bottom: 1px dashed #edf3f8;
  color: #3d566c;
  vertical-align: top;
}
.factor-table tr.invalid td {
  background: #fdf7ec;
}
.factor-table td strong {
  display: block;
  font-size: 12px;
  color: #2d4d66;
}
.factor-table td small {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: #8ba0b2;
  line-height: 1.5;
}
.factor-table td small.missing {
  color: #a05a1c;
}
.chart-sub {
  margin: 4px 0 0;
  font-size: 11px;
  color: #8ba0b2;
}
.chart-legend {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10.5px;
  color: #6a8298;
  flex-wrap: wrap;
}
.chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.line {
  display: inline-block;
  width: 16px;
  height: 0;
  border-top: 2px solid #247ba8;
}
.line.dashed {
  border-top: 2px dashed #e1a249;
}
.chart-svg {
  width: 100%;
  height: auto;
  display: block;
}
.grid-line {
  stroke: #e6eef5;
  stroke-width: 1;
}
.axis-label {
  font-size: 9px;
  fill: #8ba0b2;
}
.threshold-line {
  stroke: #d08a2f;
  stroke-width: 1.2;
  stroke-dasharray: 3 4;
}
.observed-line {
  fill: none;
  stroke: #247ba8;
  stroke-width: 2;
}
.projected-line {
  fill: none;
  stroke: #e1a249;
  stroke-width: 2;
  stroke-dasharray: 6 4;
}
.chart-note {
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #8ba0b2;
  line-height: 1.7;
}
.trend-reason {
  margin: 0 0 10px;
  font-size: 12px;
  color: #3d5a72;
  line-height: 1.75;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.metric-grid div {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f4f9fc;
  border: 1px solid #e6eef5;
  min-width: 0;
}
.metric-grid span {
  display: block;
  font-size: 10px;
  color: #8ba0b2;
}
.metric-grid strong {
  display: block;
  margin-top: 3px;
  font-size: 13px;
  color: #1c3e57;
  overflow: hidden;
  text-overflow: ellipsis;
}
.order-hint {
  margin: 0;
  font-size: 11.5px;
  color: #5d7387;
}
.order-hint.muted {
  color: #a05a1c;
}
.order-success {
  margin: 8px 0 0;
  font-size: 12px;
  color: #2f7a63;
}
.evidence-col {
  padding: 14px;
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}
.evidence-head {
  position: sticky;
  top: -14px;
  z-index: 1;
  margin: -14px -14px 10px;
  padding: 14px 14px 10px;
  background: rgba(255, 255, 255, 0.97);
  border-bottom: 1px solid #eaf1f7;
}
.drawer-close {
  border: 0;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: #8296a8;
  cursor: pointer;
}
.verify-note {
  margin: 0 0 10px;
  padding: 7px 9px;
  border-radius: 7px;
  background: #fdf4e4;
  font-size: 10.5px;
  color: #8a5a14;
}
.advice-block {
  margin-bottom: 14px;
}
.advice-block h3 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #35566f;
  letter-spacing: 0.3px;
}
.advice-item {
  padding: 8px 0;
  border-bottom: 1px dashed #edf3f8;
}
.advice-item:last-child {
  border-bottom: 0;
}
.advice-item p {
  margin: 0;
  font-size: 11.5px;
  color: #3d566c;
  line-height: 1.78;
}
.generic-tag {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #edf2f6;
  font-size: 9.5px;
  color: #6d7f8f;
  white-space: nowrap;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
.chip {
  max-width: 220px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #cfe3ee;
  background: #f2f9fd;
  color: #247ba8;
  font-size: 10px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip:hover {
  background: #e4f2fb;
}
.empty-line {
  margin: 0;
  font-size: 11px;
  color: #8ba0b2;
}
.evidence-item {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  width: 100%;
  padding: 7px 0;
  border: 0;
  border-bottom: 1px dashed #edf3f8;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.evidence-item:hover .evidence-main strong {
  color: #247ba8;
}
.evidence-kind {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: #eef7fc;
  color: #247ba8;
  font-size: 9.5px;
}
.evidence-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.evidence-main strong {
  font-size: 11px;
  color: #2d4d66;
  line-height: 1.5;
}
.evidence-main small {
  font-size: 10px;
  color: #8ba0b2;
  line-height: 1.5;
}
.evidence-source {
  flex-shrink: 0;
  font-size: 9px;
  color: #a5b6c4;
}
.evidence-detail {
  margin-top: 8px;
  padding: 10px;
  border-radius: 8px;
  background: #f7fbfe;
  border: 1px solid #e1ecf5;
}
.evidence-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.evidence-detail-head strong {
  font-size: 12px;
  color: #1c3e57;
}
.evidence-detail-head button {
  border: 0;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  color: #8ba0b2;
  cursor: pointer;
}
.evidence-detail .meta {
  margin: 4px 0 0;
  font-size: 10px;
  color: #7c90a2;
}
.evidence-detail .detail-body {
  margin: 6px 0 0;
  font-size: 11px;
  color: #3d566c;
  line-height: 1.75;
}
.empty-state {
  text-align: center;
  color: #6a8298;
}
.empty-state.small {
  padding: 18px 0;
  font-size: 12px;
}
.empty-state h2 {
  margin: 0 0 6px;
  font-size: 16px;
  color: #1c3e57;
}
@media (max-width: 1500px) {
  .health-grid {
    grid-template-columns: minmax(180px, 23fr) minmax(0, 47fr) minmax(280px, 30fr);
  }
}
@media (max-width: 1366px) {
  .health-grid {
    grid-template-columns: minmax(180px, 26fr) minmax(0, 74fr);
  }
  .drawer-only {
    display: inline-flex;
  }
  .drawer-close {
    display: inline-flex;
  }
  .evidence-col {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(440px, 92vw);
    max-height: none;
    z-index: 61;
    border-radius: 0;
    background: #fff;
    transform: translateX(100%);
    transition: transform 0.22s ease;
    box-shadow: -12px 0 32px rgba(20, 40, 56, 0.18);
  }
  .evidence-col.open {
    transform: translateX(0);
  }
  .drawer-mask {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(20, 40, 56, 0.36);
  }
}
@media (max-width: 1180px) {
  .health-grid {
    grid-template-columns: 1fr;
  }
  .asset-col {
    max-height: 260px;
  }
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

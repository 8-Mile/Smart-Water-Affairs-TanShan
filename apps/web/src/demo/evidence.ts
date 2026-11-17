import type {
  Alarm,
  Asset,
  DocumentRef,
  EvidenceRef,
  ScenarioSeed,
  UserState,
} from "./types";
import type { HealthScoreResult } from "./health";
import type { ThresholdTrend } from "./trend";

const DOCUMENT_KINDS = new Set<DocumentRef["kind"]>([
  "manual",
  "procedure",
  "inspection-standard",
  "case",
]);

const KIND_LABELS: Record<DocumentRef["kind"], string> = {
  manual: "使用说明",
  procedure: "操作规程",
  "inspection-standard": "巡检标准",
  drawing: "图纸",
  certificate: "合格证",
  case: "维修案例",
  other: "其他资料",
};

const ALARM_LEVEL_LABELS: Record<Alarm["level"], string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

const ALARM_STATUS_LABELS: Record<Alarm["status"], string> = {
  active: "活动",
  acknowledged: "已确认",
  closed: "已关闭",
};

function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of base) merged.set(item.id, item);
  for (const item of extra) merged.set(item.id, item);
  return [...merged.values()];
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * 汇总同一设备可被建议引用的证据：已审核文档、巡检、
 * 已验收工单与告警。已被移除的文档不再返回。
 */
export function findReviewedEvidence(
  seed: ScenarioSeed,
  state: UserState,
  assetId: string,
  topic?: string,
): EvidenceRef[] {
  const removed = new Set(state.removedDocumentIds);
  const evidence: EvidenceRef[] = [];

  const documents = mergeById(seed.documents, state.documents).filter(
    (document) =>
      document.assetIds.includes(assetId) &&
      document.reviewed &&
      !document.unavailable &&
      DOCUMENT_KINDS.has(document.kind) &&
      !removed.has(document.id),
  );
  for (const document of documents) {
    evidence.push({
      kind: "document",
      refId: document.id,
      label: `${document.title}（${document.version}）`,
      detail: [
        KIND_LABELS[document.kind],
        document.sourceLabel,
        `更新于 ${shortDate(document.updatedAt)}`,
        document.lineOrSection,
      ]
        .filter(Boolean)
        .join(" · "),
      source: document.source === "demo" ? "REFERENCE" : "USER_ENTRY",
    });
  }

  const inspections = mergeById(seed.inspections, state.inspections)
    .filter((record) => record.assetId === assetId)
    .sort((a, b) => Date.parse(b.inspectedAt) - Date.parse(a.inspectedAt));
  const seedInspectionIds = new Set(seed.inspections.map((item) => item.id));
  for (const record of inspections) {
    evidence.push({
      kind: "inspection",
      refId: record.id,
      label: `巡检 ${record.id} · ${record.result === "normal" ? "正常" : "异常"}`,
      detail: `${record.inspector} · ${shortDate(record.inspectedAt)}${record.note ? ` · ${record.note}` : ""}`,
      source: seedInspectionIds.has(record.id) ? "MOCK" : "USER_ENTRY",
    });
  }

  const seedWorkOrderIds = new Set(seed.workorders.map((item) => item.id));
  const acceptedOrders = mergeById(seed.workorders, state.workorders).filter(
    (order) =>
      order.assetId === assetId &&
      (order.status === "archived" || order.acceptance?.accepted === true),
  );
  for (const order of acceptedOrders) {
    evidence.push({
      kind: "workorder",
      refId: order.id,
      label: `${order.code} ${order.title}（已验收）`,
      detail: [
        order.acceptance?.at ? `验收于 ${shortDate(order.acceptance.at)}` : "已归档",
        order.result?.measures,
      ]
        .filter(Boolean)
        .join(" · "),
      source: seedWorkOrderIds.has(order.id) ? "MOCK" : "USER_ENTRY",
    });
  }

  const seedAlarmIds = new Set(seed.alarms.map((item) => item.id));
  const alarms = mergeById(seed.alarms, state.alarms)
    .filter((alarm) => alarm.assetId === assetId)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  for (const alarm of alarms) {
    evidence.push({
      kind: "alarm",
      refId: alarm.id,
      label: `${alarm.title}（${ALARM_STATUS_LABELS[alarm.status]}）`,
      detail: `${ALARM_LEVEL_LABELS[alarm.level]} · ${shortDate(alarm.occurredAt)} · ${alarm.detail}`,
      source: seedAlarmIds.has(alarm.id) ? "MOCK" : "USER_ENTRY",
    });
  }

  if (!topic) return evidence;
  const query = topic.trim().toLowerCase();
  if (!query) return evidence;
  return evidence.filter(
    (item) =>
      item.label.toLowerCase().includes(query) ||
      (item.detail ?? "").toLowerCase().includes(query),
  );
}

export interface AdviceItem {
  id: string;
  text: string;
  supportingEvidenceIds: string[];
  generic?: boolean;
}

export interface HealthAdvice {
  observations: AdviceItem[];
  hypotheses: AdviceItem[];
  checks: AdviceItem[];
  limitations: AdviceItem[];
  evidenceIds: string[];
  degraded: boolean;
}

export interface AdviceContext {
  asset: Asset;
  health: HealthScoreResult;
  trend: ThresholdTrend | null;
  trendPointId?: string;
  trendPointLabel?: string;
  evidence: EvidenceRef[];
  documents?: DocumentRef[];
  activeAlarms?: Alarm[];
}

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bRUL\b/i,
  /剩余寿命/,
  /寿命预测/,
  /故障概率/,
  /停机结论/,
  /设备将于.{0,16}(故障|失效)/,
  /故障发生时间/,
  /已确认故障原因/,
];

/** lint：返回 true 表示文本不含被禁止的寿命/概率/停机结论表述。 */
export function ensureNoForbiddenClaims(text: string): boolean {
  return !FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
}

function idsOfKind(evidence: EvidenceRef[], kind: EvidenceRef["kind"]): string[] {
  return evidence.filter((item) => item.kind === kind).map((item) => item.refId);
}

function documentIdsByKind(
  evidence: EvidenceRef[],
  documents: DocumentRef[] | undefined,
  kinds: DocumentRef["kind"][],
): string[] {
  if (!documents?.length) return [];
  const allowed = new Set(kinds);
  const ids = new Set(
    documents
      .filter((document) => allowed.has(document.kind))
      .map((document) => document.id),
  );
  return evidence
    .filter((item) => item.kind === "document" && ids.has(item.refId))
    .map((item) => item.refId);
}

function trendObservation(
  context: AdviceContext,
  trendPointLabel: string,
): AdviceItem | null {
  const { trend, trendPointId } = context;
  if (!trend) return null;
  const support = trendPointId ? [trendPointId] : [];
  if (trend.status === "estimated") {
    const predicted = trend.predictedAt
      ? trend.predictedAt.slice(0, 10)
      : "窗口内";
    return {
      id: "obs-trend-estimated",
      text: `近14日${trendPointLabel}呈上升趋势，日斜率 ${trend.slopePerDay}（R²=${trend.rSquared}，样本 ${trend.sampleCount} 个，跨度 ${trend.spanDays} 天）；按线性外推预计 ${predicted} 前后触及演示阈值 ${trend.threshold}。`,
      supportingEvidenceIds: support,
    };
  }
  return {
    id: `obs-trend-${trend.status}`,
    text: `趋势判定：${trend.reason}`,
    supportingEvidenceIds: support,
  };
}

/**
 * 依据评分、趋势、告警与已审核证据生成建议。
 * 观察事实可引用遥测/告警；可能原因与检查建议必须引用可定位证据。
 */
export function buildAdvice(context: AdviceContext): HealthAdvice {
  const { asset, health, trend, evidence } = context;
  const trendPointLabel = context.trendPointLabel ?? "振动速度";
  const evidenceIds = [...new Set(evidence.map((item) => item.refId))];
  const hasReviewedDocs = evidence.some((item) => item.kind === "document");
  const degraded = !hasReviewedDocs;
  const supportIds = (ids: string[]): string[] => [...new Set(ids)];

  const observations: AdviceItem[] = [];

  if (health.score !== null) {
    observations.push({
      id: "obs-health",
      text: `当前健康评分 ${health.score}（${health.band}），规则版本 ${health.ruleVersion}，因子覆盖率 ${(health.coverage * 100).toFixed(0)}%；评分只用当前读数与累计工况计算。`,
      supportingEvidenceIds: [],
    });
  } else if (health.modelUnavailable) {
    observations.push({
      id: "obs-unavailable",
      text: `该设备类型为「${asset.type}」，未套用主泵评分模型，不能给出健康分。`,
      supportingEvidenceIds: [],
    });
  } else {
    observations.push({
      id: "obs-insufficient",
      text: `资料不足，未给出完整健康分（${health.missingReasons.join("；")}），不把缺测当作 0 风险。`,
      supportingEvidenceIds: [],
    });
  }

  const trendItem = trendObservation(context, trendPointLabel);
  if (trendItem) observations.push(trendItem);

  for (const alarm of context.activeAlarms ?? []) {
    observations.push({
      id: `obs-alarm-${alarm.id}`,
      text: `活动告警：${alarm.title}（${ALARM_LEVEL_LABELS[alarm.level]}，${shortDate(alarm.occurredAt)}）——${alarm.detail}`,
      supportingEvidenceIds: [alarm.id],
    });
  }

  const rising =
    trend?.status === "estimated" || trend?.status === "already_exceeded";
  const manualIds = documentIdsByKind(evidence, context.documents, [
    "manual",
    "procedure",
  ]);
  const standardIds = documentIdsByKind(evidence, context.documents, [
    "inspection-standard",
  ]);
  const caseIds = documentIdsByKind(evidence, context.documents, ["case"]);
  const acceptedOrderIds = idsOfKind(evidence, "workorder");
  const inspectionIds = idsOfKind(evidence, "inspection");
  const alarmIds = idsOfKind(evidence, "alarm");

  const hypotheses: AdviceItem[] = [];
  if (!degraded) {
    if (rising && manualIds.length + standardIds.length > 0) {
      hypotheses.push({
        id: "hyp-vibration",
        text: `可能原因方向：联轴器对中状态、轴承润滑或地脚紧固状态发生变化（仅为待核查方向，不是故障结论）。`,
        supportingEvidenceIds: supportIds([...manualIds, ...standardIds]),
      });
    }
    if (rising && caseIds.length > 0) {
      hypotheses.push({
        id: "hyp-case",
        text: "历史类似案例显示，振动升高后曾通过复测与对中检查处理；本案例仅用于提示核查方向。",
        supportingEvidenceIds: caseIds,
      });
    }
    if (health.factors.some((factor) => factor.key === "current" && (factor.risk ?? 0) > 0)) {
      hypotheses.push({
        id: "hyp-current",
        text: "可能原因方向：负载变化、对中偏差或转动部件摩擦增大，导致电流同步抬升（需现场核查）。",
        supportingEvidenceIds: supportIds([...manualIds, ...standardIds]),
      });
    }
  }

  const checks: AdviceItem[] = [];
  if (!degraded) {
    if (standardIds.length > 0) {
      checks.push({
        id: "check-standard",
        text: `按巡检标准复测${trendPointLabel}、轴承温度与电流，并记录负荷工况，与近 14 日序列对照。`,
        supportingEvidenceIds: standardIds,
      });
    }
    if (manualIds.length > 0) {
      checks.push({
        id: "check-manual",
        text: "按使用说明中的运行检查项核对联轴器对中、地脚螺栓与轴承润滑状态，处理前后各留一组数据。",
        supportingEvidenceIds: manualIds,
      });
    }
    if (caseIds.length > 0) {
      checks.push({
        id: "check-case",
        text: "参考历史案例的复测步骤，先做对中复测与紧固检查，再决定是否停机处理。",
        supportingEvidenceIds: caseIds,
      });
    }
    if (acceptedOrderIds.length > 0) {
      checks.push({
        id: "check-workorder",
        text: "调阅已验收工单的处理与复测记录，确认同类问题是否复发。",
        supportingEvidenceIds: acceptedOrderIds,
      });
    }
  } else {
    const genericSupport = supportIds([...inspectionIds, ...acceptedOrderIds, ...alarmIds]);
    checks.push({
      id: "check-generic",
      text: "通用检查项：现场复测振动、轴承温度与电流，记录工况与负荷，并与近 14 日序列对照；必要时安排停机检查。",
      supportingEvidenceIds: genericSupport,
      generic: true,
    });
    if (inspectionIds.length > 0) {
      checks.push({
        id: "check-generic-inspection",
        text: "复核最近一次巡检记录中的异常项，按巡检表逐项确认当前状态。",
        supportingEvidenceIds: inspectionIds,
        generic: true,
      });
    }
  }

  const limitations: AdviceItem[] = [
    {
      id: "limit-scope",
      text: "本页仅提供规则评分与趋势估计，用于安排检查；不预测部件寿命或未来故障可能性，也不替代现场停机决定，阈值仅为演示参考值。",
      supportingEvidenceIds: [],
    },
  ];
  if (degraded) {
    limitations.push({
      id: "limit-evidence",
      text: "缺少可引用资料：未找到已审核说明书、规程、巡检标准或案例，建议已降级为通用检查项，不引用厂家条款。",
      supportingEvidenceIds: [],
    });
  }
  if (trend && trend.status !== "estimated" && trend.status !== "already_exceeded") {
    limitations.push({
      id: "limit-trend",
      text: "趋势未满足演示门槛，不显示未来触阈日期；请以现场复测数据为准。",
      supportingEvidenceIds: [],
    });
  }
  if (health.score === null && !health.modelUnavailable) {
    limitations.push({
      id: "limit-coverage",
      text: "测点缺测导致健康分未给出，未自动重加权成看似完整的分数。",
      supportingEvidenceIds: [],
    });
  }

  return {
    observations,
    hypotheses,
    checks,
    limitations,
    evidenceIds,
    degraded,
  };
}

export interface BlockedClaim {
  section: "hypotheses" | "checks";
  text: string;
  reason: string;
}

export interface AdviceVerification {
  advice: HealthAdvice;
  blockedClaims: BlockedClaim[];
  passed: boolean;
}

/**
 * 核验建议：删除没有可定位证据的可能原因与检查建议，
 * 并拦截包含寿命/概率/停机结论的表述。
 */
export function verifyAdvice(
  advice: HealthAdvice,
  evidenceIds: string[],
): AdviceVerification {
  const allowed = new Set(evidenceIds);
  const blockedClaims: BlockedClaim[] = [];

  function filterSection(
    section: "hypotheses" | "checks",
    items: AdviceItem[],
  ): AdviceItem[] {
    return items.filter((item) => {
      const unsupported =
        item.supportingEvidenceIds.length === 0 ||
        item.supportingEvidenceIds.some((id) => !allowed.has(id));
      if (unsupported) {
        blockedClaims.push({
          section,
          text: item.text,
          reason: "未找到支持该判断的可定位证据引用",
        });
        return false;
      }
      if (!ensureNoForbiddenClaims(item.text)) {
        blockedClaims.push({
          section,
          text: item.text,
          reason: "包含不被允许的寿命、概率或停机结论表述",
        });
        return false;
      }
      return true;
    });
  }

  const filtered: HealthAdvice = {
    ...advice,
    hypotheses: filterSection("hypotheses", advice.hypotheses),
    checks: filterSection("checks", advice.checks),
  };

  return {
    advice: filtered,
    blockedClaims,
    passed: blockedClaims.length === 0,
  };
}

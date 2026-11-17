import { createAgentRun, makeStep, patchStep, setRunStatus } from "./agentBasics";
import type { StepInput } from "./agentBasics";
import { buildAdvice, findReviewedEvidence, verifyAdvice } from "./evidence";
import type { AdviceVerification, HealthAdvice } from "./evidence";
import { DEFAULT_HEALTH_PROFILE, scorePumpHealth } from "./health";
import type { HealthReadings, HealthScoreResult } from "./health";
import { KIND_LABELS } from "./intent";
import type { ParsedIntent } from "./intent";
import { can, roleNames } from "./permissions";
import { getLatestSample, getPointSeries } from "./series";
import { estimateThresholdCrossing } from "./trend";
import type { ThresholdTrend, TrendStatus } from "./trend";
import type { WorkOrderInput } from "./commands";
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentStepStatus,
  Alarm,
  Asset,
  DocumentRef,
  EvidenceRef,
  InspectionRecord,
  MeasurePoint,
  Role,
  ScenarioSeed,
  TelemetrySample,
  UserState,
  WorkOrder,
} from "./types";

const DAY_MS = 86_400_000;
const TREND_WINDOW_DAYS = 14;
const VIBRATION_THRESHOLD = DEFAULT_HEALTH_PROFILE.vibration.critical;
const DEFAULT_ASSET_CODE = "P-002";

const TREND_LABELS: Record<TrendStatus, string> = {
  estimated: "预计触阈",
  already_exceeded: "已触阈",
  insufficient: "样本不足",
  not_rising: "无上升趋势",
  low_fit: "波动过大",
  out_of_horizon: "超出窗口",
};

export function trendStatusLabel(status: TrendStatus): string {
  return TREND_LABELS[status];
}

export type AgentErrorCode =
  | "NO_DATA"
  | "NO_EVIDENCE"
  | "FORBIDDEN"
  | "TOOL_FAILED"
  | "UNSUPPORTED"
  | "VALIDATION_FAILED";

export type ToolName =
  | "coordinator.plan"
  | "asset.validate"
  | "data.analyze"
  | "doc.search"
  | "diagnose.score"
  | "workflow.draft"
  | "ui.compose"
  | "verifier.check";

function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of base) merged.set(item.id, item);
  for (const item of extra) merged.set(item.id, item);
  return [...merged.values()];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildStep(
  at: string,
  input: StepInput,
  evidence?: EvidenceRef[],
): AgentStep {
  const built = makeStep(input, at);
  return evidence && evidence.length > 0 ? { ...built, evidence } : built;
}

interface RuntimeSnapshot {
  seed: ScenarioSeed;
  state: UserState;
  assets: Asset[];
  points: MeasurePoint[];
  documents: DocumentRef[];
  alarms: Alarm[];
  workorders: WorkOrder[];
  inspections: InspectionRecord[];
}

function snapshot(input: DiagnoseRunInput): RuntimeSnapshot {
  const { seed, state } = input;
  return {
    seed,
    state,
    assets: mergeById(seed.assets, state.assets),
    points: input.points ?? mergeById(seed.points, state.points),
    documents: mergeById(seed.documents, state.documents),
    alarms: mergeById(seed.alarms, state.alarms),
    workorders: mergeById(seed.workorders, state.workorders),
    inspections: mergeById(seed.inspections, state.inspections),
  };
}

export interface ReadingSlot {
  key: "vibration" | "temperature" | "current";
  label: string;
  keyword: string;
  pointId?: string;
  unit?: string;
  latest: number | null;
  latestAt?: string;
  sampleCount: number;
  samples: TelemetrySample[];
}

const READING_SLOTS: { key: ReadingSlot["key"]; keyword: string; label: string }[] = [
  { key: "vibration", keyword: "振动", label: "振动速度" },
  { key: "temperature", keyword: "温度", label: "轴承温度" },
  { key: "current", keyword: "电流", label: "电机电流" },
];

export interface DataAnalysis {
  assetId: string;
  readings: HealthReadings;
  slots: ReadingSlot[];
  vibrationPointId?: string;
  vibrationPointLabel: string;
  trend: ThresholdTrend | null;
  trendRangeFrom: string;
  trendRangeTo: string;
  validSampleCount: number;
  hasAnyReading: boolean;
}

function analyzeData(data: RuntimeSnapshot, asset: Asset): DataAnalysis {
  const referenceMs = Date.parse(data.seed.referenceTime);
  const trendRangeFrom = new Date(referenceMs - TREND_WINDOW_DAYS * DAY_MS).toISOString();
  const trendRangeTo = data.seed.referenceTime;
  const assetPoints = data.points.filter((point) => point.assetId === asset.id);
  const pointsSeed: ScenarioSeed = { ...data.seed, points: data.points };

  const slots: ReadingSlot[] = READING_SLOTS.map((spec) => {
    const point =
      assetPoints.find((item) => item.kind === "number" && item.id.endsWith(`-${spec.key}`)) ??
      assetPoints.find((item) => item.kind === "number" && item.label.includes(spec.keyword));
    if (!point) {
      return {
        key: spec.key,
        label: spec.label,
        keyword: spec.keyword,
        latest: null,
        sampleCount: 0,
        samples: [],
      };
    }
    const samples = getPointSeries(pointsSeed, point.id, trendRangeFrom, trendRangeTo);
    const latestSample = getLatestSample(pointsSeed, point.id);
    const latest =
      latestSample && latestSample.quality === "valid" && typeof latestSample.value === "number"
        ? latestSample.value
        : null;
    return {
      key: spec.key,
      label: point.label || spec.label,
      keyword: spec.keyword,
      pointId: point.id,
      unit: point.unit,
      latest,
      latestAt: latest !== null && latestSample ? latestSample.at : undefined,
      sampleCount: samples.filter(
        (sample) => sample.quality === "valid" && typeof sample.value === "number",
      ).length,
      samples,
    };
  });

  const vibration = slots[0];
  const trend =
    vibration.pointId !== undefined
      ? estimateThresholdCrossing(vibration.samples, VIBRATION_THRESHOLD, { horizonDays: 14 })
      : null;

  return {
    assetId: asset.id,
    readings: {
      vibration: slots[0].latest,
      temperature: slots[1].latest,
      current: slots[2].latest,
    },
    slots,
    vibrationPointId: vibration.pointId,
    vibrationPointLabel: vibration.label,
    trend,
    trendRangeFrom,
    trendRangeTo,
    validSampleCount: slots.reduce((sum, slot) => sum + slot.sampleCount, 0),
    hasAnyReading: slots.some((slot) => slot.latest !== null),
  };
}

function resolveAsset(assets: Asset[], intent: ParsedIntent): { asset?: Asset; note: string } {
  if (intent.targetAssetId) {
    const byId = assets.find((asset) => asset.id === intent.targetAssetId);
    if (byId) return { asset: byId, note: "指令指定" };
  }
  const code = intent.targetAssetCode?.trim().toUpperCase();
  if (code) {
    const byCode = assets.find((asset) => asset.code.trim().toUpperCase() === code);
    if (byCode) return { asset: byCode, note: "指令指定" };
  }
  const fallback = assets.find(
    (asset) => asset.code.trim().toUpperCase() === DEFAULT_ASSET_CODE,
  );
  if (fallback) {
    return {
      asset: fallback,
      note: `指令未指定设备，沿用健康页默认对象 ${DEFAULT_ASSET_CODE}`,
    };
  }
  return { note: "未找到可诊断设备" };
}

function readingText(analysis: DataAnalysis): string {
  return analysis.slots
    .map((slot) =>
      slot.latest === null
        ? `${slot.label} 缺测`
        : `${slot.label} ${slot.latest}${slot.unit ? ` ${slot.unit}` : ""}`,
    )
    .join("、");
}

function telemetryEvidence(analysis: DataAnalysis): EvidenceRef[] {
  return analysis.slots
    .filter(
      (slot): slot is ReadingSlot & { pointId: string; latest: number } =>
        Boolean(slot.pointId) && slot.latest !== null,
    )
    .map((slot) => ({
      kind: "telemetry",
      refId: slot.pointId,
      label: `${slot.label} 最新 ${slot.latest}${slot.unit ? ` ${slot.unit}` : ""}`,
      detail: `近 14 日有效样本 ${slot.sampleCount} 个；来源 MOCK 模拟遥测`,
      source: "MOCK",
    }));
}

function buildDraft(
  asset: Asset,
  analysis: DataAnalysis,
  advice: HealthAdvice,
  health: HealthScoreResult,
): WorkOrderInput | null {
  const pointId = analysis.vibrationPointId;
  const trend = analysis.trend;
  if (!pointId || !trend) return null;
  const observations = advice.observations.map((item) => item.text).join("；");
  const checks = advice.checks.map((item) => item.text).join(" ");
  return {
    title: `${asset.code} ${analysis.vibrationPointLabel}趋势检查（AI 演示草稿）`,
    assetId: asset.id,
    source: "health_trend",
    symptom: observations || trend.reason,
    suggestion:
      checks || "现场复测振动、温度与电流，记录工况并对照近 14 日序列。",
    priority: health.score !== null && health.score < 40 ? "high" : "medium",
    evidenceIds: [...advice.evidenceIds],
    triggerSnapshot: {
      rangeFrom: analysis.trendRangeFrom,
      rangeTo: analysis.trendRangeTo,
      pointId,
      threshold: trend.threshold,
    },
  };
}

export interface DiagnoseRunInput {
  intent: ParsedIntent;
  seed: ScenarioSeed;
  state: UserState;
  role: Role;
  /** 覆盖合并后的测点列表，便于与页面展示使用同一份数据。 */
  points?: MeasurePoint[];
}

export interface DiagnoseResult {
  run: AgentRun;
  asset?: Asset;
  analysis: DataAnalysis | null;
  health: HealthScoreResult | null;
  trend: ThresholdTrend | null;
  evidence: EvidenceRef[];
  advice: HealthAdvice | null;
  verification: AdviceVerification | null;
  draft: WorkOrderInput | null;
}

export function resolveDiagnoseStatus(steps: AgentStep[]): AgentRunStatus {
  if (steps.some((step) => step.status === "failed")) return "failed";
  const confirm = steps.find((step) => step.id === "confirm");
  if (!confirm) return "failed";
  if (confirm.status === "done") return "done";
  if (confirm.status === "blocked") {
    return confirm.errorCode === "FORBIDDEN" ? "awaiting_confirmation" : "failed";
  }
  if (confirm.status === "cancelled") return "cancelled";
  if (confirm.status === "pending") {
    const draft = steps.find((step) => step.id === "draft");
    return draft && draft.status === "done" ? "awaiting_confirmation" : "failed";
  }
  return "failed";
}

/**
 * Case B：诊断类指令的可观察编排。
 * 仅输出工具名与输入/输出摘要，不包含任何推理过程文案。
 */
export function computeDiagnose(input: DiagnoseRunInput): DiagnoseResult {
  const at = input.seed.referenceTime;
  const data = snapshot(input);
  const resolved = resolveAsset(data.assets, input.intent);
  const title = `${KIND_LABELS.diagnose_asset}：${truncate(input.intent.prompt, 28)}`;
  const base = {
    taskType: "diagnose" as const,
    title,
    prompt: input.intent.prompt,
    at,
  };

  if (!resolved.asset) {
    const run = createAgentRun({
      ...base,
      status: "failed",
      context: {},
      steps: [
        buildStep(at, {
          id: "plan",
          agentName: "总控 · Coordinator",
          action: "编排诊断任务",
          tool: "coordinator.plan",
          inputSummary: input.intent.prompt,
          outputSummary: `未找到可诊断设备：${resolved.note}`,
          status: "blocked",
          errorCode: "NO_DATA",
          retryable: true,
        }),
      ],
    });
    return {
      run,
      asset: undefined,
      analysis: null,
      health: null,
      trend: null,
      evidence: [],
      advice: null,
      verification: null,
      draft: null,
    };
  }

  const asset = resolved.asset;
  const analysis = analyzeData(data, asset);
  const health = scorePumpHealth({
    asset,
    readings: analysis.readings,
    runtimeHours: asset.runtimeHours,
    startCount: asset.startCount,
    asOf: at,
  });
  const evidence = findReviewedEvidence(input.seed, input.state, asset.id);
  const activeAlarms = data.alarms.filter(
    (alarm) => alarm.assetId === asset.id && alarm.status === "active",
  );
  const advice = buildAdvice({
    asset,
    health,
    trend: analysis.trend,
    trendPointId: analysis.vibrationPointId,
    trendPointLabel: analysis.vibrationPointLabel,
    evidence,
    documents: data.documents,
    activeAlarms,
  });
  const verification = verifyAdvice(advice, advice.evidenceIds);
  const verified = verification.advice;
  const draft = buildDraft(asset, analysis, verified, health);
  const telemetry = telemetryEvidence(analysis);
  const evidenceById = new Map(evidence.map((item) => [item.refId, item]));
  const verifiedEvidence = verified.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is EvidenceRef => Boolean(item));
  const documentEvidence = evidence.filter((item) => item.kind === "document");

  const planStep = buildStep(at, {
    id: "plan",
    agentName: "总控 · Coordinator",
    action: "编排诊断任务",
    tool: "coordinator.plan",
    inputSummary: input.intent.prompt,
    outputSummary: `诊断对象 ${asset.code} · ${asset.name}（${resolved.note}）；编排：数据取数 → 档案检索 → 规则评分 → 证据核验 → 界面预览 → 工单草稿 → 人工确认`,
    status: "done",
  });

  const dataStep = buildStep(
    at,
    {
      id: "data",
      agentName: "数据 · DataAnalyst",
      action: "读取最新值与 14 日序列",
      tool: "data.analyze",
      inputSummary: `assetId=${asset.id}；测点 ${analysis.slots
        .map((slot) => `${slot.key}=${slot.pointId ?? "缺失"}`)
        .join("、")}；窗口 近 ${TREND_WINDOW_DAYS} 日`,
      outputSummary: analysis.hasAnyReading
        ? `${readingText(analysis)}；有效样本 ${analysis.validSampleCount} 个；趋势 ${
            analysis.trend
              ? `${TREND_LABELS[analysis.trend.status]}：${analysis.trend.reason}`
              : "无可用振动测点"
          }`
        : "未取得振动/温度/电流有效读数，未生成评分与趋势",
      status: analysis.hasAnyReading ? "done" : "failed",
      errorCode: analysis.hasAnyReading ? undefined : "NO_DATA",
      retryable: true,
    },
    telemetry,
  );

  if (!analysis.hasAnyReading) {
    const pendingTail: AgentStep[] = [
      ["doc", "档案 · DocKnowledge", "检索已审核证据", "doc.search"],
      ["score", "诊断 · Diagnoser", "计算健康评分与建议", "diagnose.score"],
      ["verify", "核验 · Verifier", "核验建议与证据引用", "verifier.check"],
      ["ui", "界面 · UIComposer", "生成界面预览摘要", "ui.compose"],
      ["draft", "工作流 · Workflow", "生成工单草稿预览", "workflow.draft"],
    ].map(([id, agentName, action, tool]) =>
      buildStep(at, {
        id,
        agentName,
        action,
        tool,
        inputSummary: "等待数据步骤成功",
        outputSummary: "未执行：缺少有效读数",
        status: "pending",
      }),
    );
    const steps = [
      planStep,
      dataStep,
      ...pendingTail,
      buildStep(at, {
        id: "confirm",
        agentName: "人工确认",
        action: "等待人工确认",
        inputSummary: "确认生成工单草稿",
        outputSummary: "未执行：前置步骤未完成",
        status: "pending",
      }),
    ];
    const run = createAgentRun({
      ...base,
      status: "failed",
      context: { assetId: asset.id, assetCode: asset.code, note: resolved.note },
      steps,
    });
    return {
      run,
      asset,
      analysis,
      health: null,
      trend: null,
      evidence: [],
      advice: null,
      verification: null,
      draft: null,
    };
  }

  const docStep = buildStep(
    at,
    {
      id: "doc",
      agentName: "档案 · DocKnowledge",
      action: "检索已审核证据",
      tool: "doc.search",
      inputSummary: `assetId=${asset.id}；范围 已审核说明书/规程/巡检标准/案例、巡检、已验收工单与告警`,
      outputSummary:
        documentEvidence.length > 0
          ? `命中 ${evidence.length} 条证据（档案 ${documentEvidence.length}、巡检 ${
              evidence.filter((item) => item.kind === "inspection").length
            }、工单 ${evidence.filter((item) => item.kind === "workorder").length}、告警 ${
              evidence.filter((item) => item.kind === "alarm").length
            }）`
          : `未检索到已审核档案；其余证据 ${evidence.length} 条仍可用，可能原因不输出，建议降级为通用检查项`,
      status: documentEvidence.length > 0 ? "done" : "blocked",
      errorCode: documentEvidence.length > 0 ? undefined : "NO_EVIDENCE",
      retryable: true,
    },
    evidence,
  );

  let scoreStatus: AgentStepStatus = "done";
  let scoreError: AgentErrorCode | undefined;
  let scoreOutput = "";
  if (health.modelUnavailable) {
    scoreStatus = "blocked";
    scoreError = "TOOL_FAILED";
    scoreOutput = `该设备类型「${asset.type}」未套用主泵评分模型，仅展示趋势与通用检查方向`;
  } else if (health.score === null) {
    scoreStatus = "blocked";
    scoreError = "NO_DATA";
    scoreOutput = `资料不足，未给出完整健康分：${health.missingReasons.join("；")}；未按 0 风险计分`;
  } else {
    scoreOutput = `健康评分 ${health.score}（${health.band}），因子覆盖率 ${Math.round(
      health.coverage * 100,
    )}%，规则版本 ${health.ruleVersion}；观察 ${advice.observations.length} 条、可能原因 ${
      advice.hypotheses.length
    } 条、检查建议 ${advice.checks.length} 条`;
  }
  const scoreStep = buildStep(
    at,
    {
      id: "score",
      agentName: "诊断 · Diagnoser",
      action: "计算健康评分与建议",
      tool: "diagnose.score",
      inputSummary: `asset=${asset.code}；readings ${readingText(analysis)}；runtimeHours=${
        asset.runtimeHours
      }、startCount=${asset.startCount}`,
      outputSummary: scoreOutput,
      status: scoreStatus,
      errorCode: scoreError,
      retryable: scoreStatus !== "done",
    },
    telemetry,
  );

  const verifyStep = buildStep(
    at,
    {
      id: "verify",
      agentName: "核验 · Verifier",
      action: "核验建议与证据引用",
      tool: "verifier.check",
      inputSummary: `建议 可能原因 ${advice.hypotheses.length} 条 / 检查 ${advice.checks.length} 条；证据 ID ${advice.evidenceIds.length} 个`,
      outputSummary: verification.passed
        ? `核验通过，${verified.hypotheses.length + verified.checks.length} 条判断均引用可定位证据${
            verified.degraded ? "；未找到已审核文档，已标记降级" : ""
          }`
        : `拦截 ${verification.blockedClaims.length} 条无证据或含结论性表述的判断；保留可能原因 ${
            verified.hypotheses.length
          } 条、检查建议 ${verified.checks.length} 条${
            verified.degraded ? "；已标记降级" : ""
          }`,
      status: "done",
    },
    verifiedEvidence,
  );

  const uiStep = buildStep(
    at,
    {
      id: "ui",
      agentName: "界面 · UIComposer",
      action: "生成界面预览摘要",
      tool: "ui.compose",
      inputSummary: `评分 ${health.score ?? health.band}；趋势 ${
        analysis.trend ? TREND_LABELS[analysis.trend.status] : "不可估计"
      }；证据 ${verified.evidenceIds.length} 项`,
      outputSummary: `预览：评分卡（${
        health.score === null ? health.band : `${health.score} ${health.band}`
      }）、14 日趋势（${
        analysis.trend ? TREND_LABELS[analysis.trend.status] : "不可估计"
      }）、证据 chips ${verified.evidenceIds.length} 项、工单草稿入口（需人工确认）${
        verified.degraded ? "；建议区展示通用检查项" : ""
      }`,
      status: "done",
    },
    verifiedEvidence,
  );

  const draftStep = buildStep(
    at,
    {
      id: "draft",
      agentName: "工作流 · Workflow",
      action: "生成工单草稿预览",
      tool: "workflow.draft",
      inputSummary: draft
        ? `assetId=${asset.id}；source=health_trend；pointId=${draft.triggerSnapshot?.pointId ?? ""}；证据 ${
            draft.evidenceIds?.length ?? 0
          } 项`
        : `assetId=${asset.id}；缺少振动趋势快照`,
      outputSummary: draft
        ? `草稿预览（未写入 workorders）：${draft.title}；症状 ${verified.observations.length} 条、建议 ${verified.checks.length} 条；等待人工确认后写入`
        : "缺少可用的振动趋势快照，未生成工单草稿",
      status: draft ? "done" : "blocked",
      errorCode: draft ? undefined : "NO_DATA",
      retryable: !draft,
    },
    draft ? verifiedEvidence : undefined,
  );

  const canCreateOrder = can(input.role, "workorder:create");
  const confirmStep = buildStep(at, {
    id: "confirm",
    agentName: "人工确认",
    action: "等待人工确认",
    inputSummary: draft ? `确认草稿：${draft.title}` : "确认生成工单草稿",
    outputSummary: !draft
      ? "未执行：缺少草稿输入，无法进入人工确认"
      : canCreateOrder
        ? "等待人工确认：确认后调用 workflow.draft 生成工单草稿，不自动派单"
        : `FORBIDDEN：角色「${roleNames[input.role]}」无 workorder:create 权限，按钮不可用`,
    status: !draft ? "blocked" : canCreateOrder ? "pending" : "blocked",
    errorCode: !draft ? "NO_DATA" : canCreateOrder ? undefined : "FORBIDDEN",
    retryable: false,
  });

  const steps = [
    planStep,
    dataStep,
    docStep,
    scoreStep,
    verifyStep,
    uiStep,
    draftStep,
    confirmStep,
  ];

  const run = createAgentRun({
    ...base,
    status: resolveDiagnoseStatus(steps),
    context: {
      assetId: asset.id,
      assetCode: asset.code,
      subsystemId: asset.subsystemId,
      trendPointId: analysis.vibrationPointId ?? "",
      degraded: String(verified.degraded),
      draftTitle: draft?.title ?? "",
    },
    steps,
  });

  return {
    run,
    asset,
    analysis,
    health,
    trend: analysis.trend,
    evidence,
    advice,
    verification,
    draft,
  };
}

export function buildDiagnoseRun(input: DiagnoseRunInput): AgentRun {
  return computeDiagnose(input).run;
}

/**
 * 按步重试：只重新执行目标步骤；已完成的步骤保持不变，
 * 其后仍处于 pending 的步骤按新结果刷新，不触发任何写入。
 */
export function retryDiagnoseStep(
  current: AgentRun,
  stepId: string,
  fresh: AgentRun,
  at: string,
): AgentRun {
  const index = current.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return current;
  const freshStep = fresh.steps.find((step) => step.id === stepId);
  if (!freshStep) return current;
  const steps = current.steps.map((step, position) => {
    if (position === index) return { ...freshStep };
    if (position > index && step.status === "pending") {
      const replacement = fresh.steps.find((item) => item.id === step.id);
      return replacement ? { ...replacement } : step;
    }
    return step;
  });
  return setRunStatus(
    { ...current, steps, updatedAt: at },
    resolveDiagnoseStatus(steps),
    at,
  );
}

export function cancelPendingSteps(run: AgentRun, at: string, note: string): AgentRun {
  let updated = run;
  for (const item of updated.steps) {
    if (item.status === "pending" || item.status === "running") {
      updated = patchStep(
        updated,
        item.id,
        { status: "cancelled", outputSummary: note },
        at,
      );
    }
  }
  return setRunStatus(updated, "cancelled", at);
}

export function markDiagnoseConfirmed(
  run: AgentRun,
  order: WorkOrder,
  at: string,
): AgentRun {
  let updated = patchStep(
    run,
    "draft",
    {
      status: "done",
      errorCode: undefined,
      outputSummary: `已写入工单草稿 ${order.code}（未派单，source=health_trend）`,
    },
    at,
  );
  updated = patchStep(
    updated,
    "confirm",
    {
      status: "done",
      errorCode: undefined,
      outputSummary: `人工确认通过：${order.code} ${order.title}`,
    },
    at,
  );
  return setRunStatus(updated, "done", at);
}

export function markDiagnoseForbidden(
  run: AgentRun,
  message: string,
  at: string,
): AgentRun {
  const updated = patchStep(
    run,
    "confirm",
    { status: "failed", errorCode: "FORBIDDEN", outputSummary: message },
    at,
  );
  return setRunStatus(updated, "failed", at);
}

export interface HealthDraftDescriptor {
  assetId: string;
  title: string;
  evidenceIds: string[];
}

/** 同一设备、同一来源的相同标题或相同证据集视为同一张草稿。 */
export function findExistingHealthDraft(
  workorders: WorkOrder[],
  draft: HealthDraftDescriptor,
): WorkOrder | undefined {
  return workorders.find((order) => {
    if (order.assetId !== draft.assetId) return false;
    if (order.source !== "health_trend") return false;
    if (order.status === "cancelled") return false;
    if (order.title === draft.title) return true;
    return (
      draft.evidenceIds.length > 0 &&
      draft.evidenceIds.every((id) => order.evidenceIds.includes(id))
    );
  });
}

export interface WorkOrderDraftService {
  workorders: WorkOrder[];
  createWorkOrder: (input: WorkOrderInput) => WorkOrder;
}

export function createHealthWorkOrder(
  service: WorkOrderDraftService,
  draft: WorkOrderInput,
): { order: WorkOrder; duplicated: boolean } {
  const existing = findExistingHealthDraft(service.workorders, {
    assetId: draft.assetId,
    title: draft.title,
    evidenceIds: draft.evidenceIds ?? [],
  });
  if (existing) return { order: existing, duplicated: true };
  return { order: service.createWorkOrder(draft), duplicated: false };
}

export interface CreateAssetRunInput {
  intent: ParsedIntent;
  at: string;
  canCreateAsset: boolean;
}

/**
 * Case A：新增设备/追加测点的步骤链。只生成任务记录，
 * 真正的写入仍由五步向导与命令层唯一性校验完成。
 */
export function buildCreateAssetRun(input: CreateAssetRunInput): AgentRun {
  const { intent, at } = input;
  if (intent.kind !== "create_asset" && intent.kind !== "add_measure_point") {
    throw new Error("buildCreateAssetRun 仅处理新增设备与追加测点意图");
  }
  const taskType = intent.kind === "create_asset" ? "create_asset" : "other";
  const title = `${KIND_LABELS[intent.kind]}：${intent.prompt.slice(0, 28)}${
    intent.prompt.length > 28 ? "…" : ""
  }`;
  const parseOutput =
    intent.kind === "create_asset"
      ? `新增设备 ${intent.asset?.code ?? "编号未识别"} · ${
          intent.asset?.name ?? "名称未识别"
        }，测点 ${intent.points.length} 个`
      : `目标设备 ${intent.targetAssetCode ?? "未识别"}，追加测点 ${intent.points.length} 个`;
  const draftOutput =
    intent.kind === "create_asset"
      ? `草稿：1 台设备 / ${intent.points.length} 个测点 / ${
          intent.subsystemId ?? "子系统未识别"
        }${intent.asset?.wantsBinding ? " / 申请工艺点位" : " / 未要求点位"}`
      : `变更预览：复用 ${intent.targetAssetCode ?? "目标设备"}，不创建第二台设备`;
  const validateSummary = intent.errors.length
    ? intent.errors.map((issue) => issue.message).join("；")
    : intent.kind === "create_asset"
      ? `编号唯一、必填、单位与量程校验通过（${intent.points.length} 个测点）`
      : "目标设备存在，测点名称不重复";
  const previewOutput =
    intent.kind === "create_asset"
      ? "已生成五步向导：解析预览 / 测点配置 / 绑定工艺 / 最终确认 / 创建成功"
      : "已生成测点变更预览，等待人工确认";
  const needsConfirm = intent.errors.length === 0;
  const status: AgentRunStatus = needsConfirm ? "awaiting_confirmation" : "failed";

  const steps: AgentStep[] = [
    buildStep(at, {
      id: "parse",
      agentName: "总控 · Coordinator",
      action: "解析意图",
      tool: "intent.parse",
      inputSummary: intent.prompt,
      outputSummary: parseOutput,
      status: "done",
    }),
    buildStep(at, {
      id: "draft",
      agentName: "配置 · AssetConfig",
      action: "生成配置草稿",
      tool: "intent.draft",
      inputSummary: parseOutput,
      outputSummary: draftOutput,
      status: "done",
    }),
    buildStep(at, {
      id: "validate",
      agentName: "核验 · Verifier",
      action: "字段与权限核验",
      tool: "asset.validate",
      inputSummary: draftOutput,
      outputSummary: validateSummary,
      status: intent.errors.length ? "blocked" : "done",
      errorCode: intent.errors.length ? "VALIDATION_FAILED" : undefined,
    }),
    buildStep(at, {
      id: "preview",
      agentName: "界面 · UIComposer",
      action: "生成确认界面",
      tool: "ui.preview",
      inputSummary: validateSummary,
      outputSummary: previewOutput,
      status: intent.errors.length ? "blocked" : "done",
      errorCode: intent.errors.length ? "VALIDATION_FAILED" : undefined,
    }),
    buildStep(at, {
      id: "confirm",
      agentName: "人工确认",
      action: "等待人工确认",
      inputSummary: "确认创建/追加",
      outputSummary: needsConfirm
        ? `等待${input.canCreateAsset ? "管理员" : "具备权限的角色"}确认`
        : "校验未通过，确认按钮不可用",
      status: "pending",
    }),
    buildStep(at, {
      id: "commit",
      agentName: "命令层 · CommandBus",
      action: "事务提交",
      tool: "command.commit",
      inputSummary: "人工确认后提交",
      outputSummary: "尚未提交",
      status: "pending",
    }),
    buildStep(at, {
      id: "sync",
      agentName: "查询服务 · Query",
      action: "页面同步核验",
      tool: "query.sync",
      inputSummary: "提交结果",
      outputSummary: "提交后同步台账/热点/抽屉/趋势/搜索",
      status: "pending",
    }),
  ];

  return createAgentRun({
    taskType,
    title,
    prompt: intent.prompt,
    at,
    status,
    context: {
      subsystemId: intent.subsystemId ?? "",
      assetId: intent.targetAssetId ?? "",
    },
    steps,
  });
}

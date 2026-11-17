import { rainStorage, runRain } from "./water";
import test from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import {
  createAssetChangeSet,
  deriveTimeline,
  emptyUserState,
  validateAssetDraft,
} from "./commands";
import type { AssetDraft, PointDraft } from "./commands";
import {
  applyMessages,
  composeEnergySurface,
  composeRainSurface,
  isEnergyQuery,
  surfaceToWidgets,
} from "./a2ui";
import type { Surface } from "./a2ui";
import { buildCreateAssetRun, cancelPendingSteps } from "./agentRuntime";
import { buildAdvice, findReviewedEvidence, verifyAdvice } from "./evidence";
import {
  DEFAULT_HEALTH_PROFILE,
  scorePumpHealth,
} from "./health";
import { parseIntent } from "./intent";
import { assertCan, can } from "./permissions";
import { buildSeed, REFERENCE_TIME } from "./seed";
import { getPointSeries } from "./series";
import { useDemoStore } from "./store";
import { estimateThresholdCrossing } from "./trend";
import type { Asset, Dashboard, TelemetrySample } from "./types";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function freshStore() {
  setActivePinia(createPinia());
  return useDemoStore();
}

function pointDraft(label: string, unit = "MPa", baseline = 1): PointDraft {
  return {
    label,
    kind: "number",
    unit,
    range: [0, 10],
    source: "USER_ENTRY",
    quality: "estimated",
    samplePeriodMinutes: 30,
    baseline,
    volatility: 0.1,
  };
}

function assetDraft(code: string, binding?: { xPct: number; yPct: number }): AssetDraft {
  return {
    code,
    name: `演示设备 ${code}`,
    subsystemId: "spray",
    type: "供水泵",
    rated: { powerKw: 45, flowM3h: 120, headM: 60 },
    points: [pointDraft("出口压力"), pointDraft("电机电流", "A", 30)],
    binding,
  };
}

function basePump(): Asset {
  const seed = buildSeed("SCN-NORMAL");
  const asset = seed.assets.find((item) => item.id === "asset-p002");
  assert.ok(asset);
  return asset;
}

function fullHealth(asset: Asset) {
  return scorePumpHealth({
    asset,
    readings: { vibration: 2.6, temperature: 61, current: 108 },
    runtimeHours: 10_840,
    startCount: 782,
    asOf: REFERENCE_TIME,
  });
}

function samples(values: number[], stepHours = 6): TelemetrySample[] {
  const end = Date.parse(REFERENCE_TIME);
  return values.map((value, index) => ({
    pointId: "demo-point",
    at: new Date(end - (values.length - 1 - index) * stepHours * HOUR_MS).toISOString(),
    value,
    quality: "valid",
    source: "MOCK",
  }));
}

function createOrderInput(assetId = "asset-mp001") {
  return {
    title: "验收测试工单",
    assetId,
    source: "manual" as const,
    symptom: "模拟症状：振动略有上升。",
    suggestion: "模拟建议：复测振动并记录。",
    priority: "medium" as const,
    createdBy: "验收测试（模拟）",
  };
}

function advanceToPendingAcceptance(
  store: ReturnType<typeof useDemoStore>,
  id: string,
): void {
  store.setRole("engineer");
  store.workOrderAction(id, "start", { by: "运维人员（模拟）", assignee: "王工" });
  store.workOrderAction(id, "complete", {
    by: "运维人员（模拟）",
    result: {
      cause: "联轴器对中偏差（演示）",
      measures: "重新对中并复测振动（演示）",
    },
  });
}

// ---------------------------------------------------------------- H-01 ~ H-09

test("H-01 健康评分四因子可复现：仅改设备编码，分数与扣分明细一致", () => {
  const asset = basePump();
  const first = fullHealth({ ...asset, id: "asset-probe-a", code: "T-001" });
  const second = fullHealth({ ...asset, id: "asset-probe-b", code: "T-002" });

  assert.notEqual(first.score, null);
  assert.equal(first.score, second.score);
  assert.equal(first.band, second.band);
  assert.deepEqual(first.factors, second.factors);
  assert.equal(first.factors.length, 4);
  assert.deepEqual(
    first.factors.map((factor) => factor.deduction),
    second.factors.map((factor) => factor.deduction),
  );
});

test("H-02 振动缺测降级：不输出 100 分，说明覆盖率与资料不足", () => {
  const result = scorePumpHealth({
    asset: basePump(),
    readings: { vibration: null, temperature: 61, current: 108 },
    runtimeHours: 10_840,
    startCount: 782,
    asOf: REFERENCE_TIME,
  });

  assert.equal(result.score, null);
  assert.notEqual(result.score, 100);
  assert.equal(result.band, "资料不足");
  assert.equal(result.coverage, 0.75);
  assert.match(result.missingReasons.join("；"), /振动速度缺测/);
  assert.match(result.limits, /未自动重加权成 100 分/);
});

test("H-03 因子明细含原值、阈值、风险值、扣分、来源与有效性", () => {
  const result = fullHealth(basePump());
  assert.equal(result.factors.length, 4);
  for (const factor of result.factors) {
    assert.equal(factor.valid, true);
    assert.equal(typeof factor.warning, "number");
    assert.equal(typeof factor.critical, "number");
    assert.ok(factor.critical > factor.warning);
    assert.equal(typeof factor.risk, "number");
    assert.equal(typeof factor.deduction, "number");
    assert.ok(factor.source === "MOCK" || factor.source === "CALCULATED");
  }
  const vibration = result.factors.find((factor) => factor.key === "vibration");
  assert.ok(vibration);
  assert.equal(vibration.value, 2.6);
  assert.equal(vibration.warning, DEFAULT_HEALTH_PROFILE.vibration.warning);
  assert.equal(vibration.critical, DEFAULT_HEALTH_PROFILE.vibration.critical);
  assert.equal(vibration.unit, "mm/s");
  const aging = result.factors.find((factor) => factor.key === "aging");
  assert.ok(aging);
  assert.equal(aging.source, "CALCULATED");
});

test("H-04 趋势满足门槛时输出样本、跨度、斜率、R²、预测窗口与触阈时间", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const end = Date.parse(seed.referenceTime);
  const series = getPointSeries(
    seed,
    "asset-p002-vibration",
    new Date(end - 14 * DAY_MS).toISOString(),
    new Date(end).toISOString(),
  );
  const trend = estimateThresholdCrossing(series, 4.5);

  assert.equal(trend.status, "estimated");
  assert.ok(trend.sampleCount >= 10);
  assert.ok(trend.spanDays > 13 && trend.spanDays <= 14.0001);
  assert.ok((trend.slopePerDay ?? 0) > 0);
  assert.ok((trend.rSquared ?? 0) >= 0.55);
  assert.equal(trend.horizonDays, 14);
  assert.ok(trend.predictedAt);
  assert.ok((trend.predictedDays ?? 0) > 0 && (trend.predictedDays ?? 0) <= 14);
  assert.ok(trend.projected.length > 0);
  assert.match(trend.reason, /满足样本、跨度、斜率、R²/);
});

test("H-05 趋势不满足门槛返回不可估计及具体原因，无虚构日期", () => {
  const trend = estimateThresholdCrossing(samples([2.1, 2.2, 2.3, 2.4, 2.5]), 4.5);
  assert.equal(trend.status, "insufficient");
  assert.equal(trend.predictedAt, undefined);
  assert.equal(trend.predictedDays, undefined);
  assert.match(trend.reason, /少于演示门槛/);
  assert.doesNotMatch(trend.reason, /\d{4}-\d{2}-\d{2}/);
});

test("H-06 已触阈返回 already_exceeded 及原因", () => {
  const values = [2.1, 2.4, 2.8, 3.2, 3.6, 4.0, 4.3, 4.6, 4.8, 5.0, 5.2, 5.4];
  const trend = estimateThresholdCrossing(samples(values), 4.5);
  assert.equal(trend.status, "already_exceeded");
  assert.equal(trend.predictedAt, undefined);
  assert.match(trend.reason, /已不低于演示阈值/);
  assert.equal(trend.latestValue, 5.4);
});

test("H-07 已审核规程/巡检/已验收工单可被作为证据引用", () => {
  const seed = buildSeed("SCN-NORMAL");
  const evidence = findReviewedEvidence(seed, emptyUserState(), "asset-p002");
  const refs = new Set(evidence.map((item) => item.refId));

  assert.ok(refs.has("DOC-P002-INSPECT"));
  assert.ok(refs.has("DOC-P002-MANUAL"));
  assert.ok(refs.has("INS-P002-02"));
  assert.ok(refs.has("wo-2026-011"));
  assert.ok(!refs.has("DOC-P002-DRAWING"));
  const inspected = evidence.find((item) => item.refId === "DOC-P002-INSPECT");
  assert.ok(inspected);
  assert.match(inspected.label, /巡检清单/);
});

test("H-08 无证据判断被 verifyAdvice 删除，degraded=true 并提示缺少可引用资料", () => {
  const health = fullHealth(basePump());
  const advice = buildAdvice({
    asset: basePump(),
    health,
    trend: null,
    evidence: [],
  });
  const verified = verifyAdvice(advice, advice.evidenceIds);

  assert.equal(advice.degraded, true);
  assert.equal(advice.hypotheses.length, 0);
  assert.equal(verified.advice.hypotheses.length, 0);
  assert.equal(verified.advice.checks.length, 0);
  assert.ok(verified.blockedClaims.some((claim) => claim.section === "checks"));
  assert.match(
    advice.limitations.map((item) => item.text).join("；"),
    /缺少可引用资料/,
  );
});

test("H-09 删除档案后 findReviewedEvidence 不再返回该档案证据", () => {
  const store = freshStore();
  store.setRole("admin");
  const seed = buildSeed(store.scenarioId);
  assert.ok(
    findReviewedEvidence(seed, store.userState, "asset-p002").some(
      (item) => item.refId === "DOC-P002-MANUAL",
    ),
  );

  store.deleteDocument("DOC-P002-MANUAL");

  assert.ok(!store.documents.some((item) => item.id === "DOC-P002-MANUAL"));
  assert.ok(
    !findReviewedEvidence(seed, store.userState, "asset-p002").some(
      (item) => item.refId === "DOC-P002-MANUAL",
    ),
  );
});

// ---------------------------------------------------------------- T-01 ~ T-20

test("T-01 新增设备成功：唯一 assetId、测点与可选绑定", () => {
  const store = freshStore();
  store.setRole("admin");
  store.commitAssetDraft(assetDraft("P-003", { xPct: 0.4, yPct: 0.35 }));

  const asset = store.getAsset("asset-p003");
  assert.ok(asset);
  assert.equal(asset.code, "P-003");
  assert.equal(asset.subsystemId, "spray");
  const points = store.getPoints("asset-p003");
  assert.equal(points.length, 2);
  for (const point of points) assert.equal(point.assetId, "asset-p003");
  const binding = store.bindings.find((item) => item.assetId === "asset-p003");
  assert.ok(binding);
  assert.equal(binding.xPct, 0.4);
  assert.equal(binding.yPct, 0.35);
});

test("T-02 重复编号被 validateAssetDraft/createAssetChangeSet 阻止且无残留", () => {
  const store = freshStore();
  store.setRole("admin");
  const seed = buildSeed(store.scenarioId);
  const duplicate = { ...assetDraft("P-002"), subsystemId: "medium-pressure" };

  const validation = validateAssetDraft(seed, store.userState, duplicate);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((issue) => issue.field === "code"));

  const assetCount = store.assets.length;
  const pointCount = store.points.length;
  const auditCount = store.userState.audits.length;
  assert.throws(
    () => createAssetChangeSet(seed, store.userState, duplicate, "admin"),
    /已存在/,
  );
  assert.throws(
    () => store.commitAssetDraft(duplicate),
    /已存在/,
  );
  assert.equal(store.assets.length, assetCount);
  assert.equal(store.points.length, pointCount);
  assert.equal(store.userState.audits.length, auditCount);
});

test("T-03 跳过点位保存为未布置：无 ProcessBinding", () => {
  const store = freshStore();
  store.setRole("admin");
  store.commitAssetDraft(assetDraft("P-003"));

  assert.ok(store.getAsset("asset-p003"));
  assert.equal(
    store.bindings.some((item) => item.assetId === "asset-p003"),
    false,
  );
});

test("T-04 取消任务不产生设备/测点/绑定", () => {
  const seed = buildSeed("SCN-NORMAL");
  const prompt =
    "在射雾器除尘系统新增一台5号供水泵，编号P-006，额定功率45kW、流量120m³/h、扬程60m。增加出口压力、电流两个测点。";
  const intent = parseIntent(prompt, {}, seed, seed.assets, seed.points);
  assert.equal(intent.kind, "create_asset");

  const run = buildCreateAssetRun({
    intent,
    at: seed.referenceTime,
    canCreateAsset: true,
  });
  assert.equal(run.status, "awaiting_confirmation");
  const cancelled = cancelPendingSteps(run, seed.referenceTime, "用户取消，未执行");
  assert.equal(cancelled.status, "cancelled");

  const state = emptyUserState();
  assert.equal(state.assets.length, 0);
  assert.equal(state.points.length, 0);
  assert.equal(state.bindings.length, 0);
});

test("T-05 追加测点复用 assetId，不新增设备", () => {
  const store = freshStore();
  store.setRole("engineer");
  const assetCount = store.assets.length;
  const pointCount = store.getPoints("asset-p002").length;

  store.addPoint(
    "asset-p002",
    pointDraft("液位", "m", 2.5),
  );

  assert.equal(store.assets.length, assetCount);
  assert.equal(store.getPoints("asset-p002").length, pointCount + 1);
  const added = store.getPoints("asset-p002").find((point) => point.label === "液位");
  assert.ok(added);
  assert.equal(added.assetId, "asset-p002");
});

test("T-06 只读角色写入被 assertCan/命令层拒绝（FORBIDDEN）", () => {
  assert.equal(can("viewer", "asset:create"), false);
  assert.throws(
    () => assertCan("viewer", "asset:create"),
    (error: unknown) => (error as { code?: string }).code === "FORBIDDEN",
  );

  const store = freshStore();
  store.setRole("viewer");
  assert.throws(
    () => store.commitAssetDraft(assetDraft("P-003")),
    (error: unknown) => (error as { code?: string }).code === "FORBIDDEN",
  );
  assert.equal(store.userState.assets.length, 0);
  assert.equal(store.userState.points.length, 0);
});

test("T-07 工单状态机：草稿→待派单→维修中→待验收→已归档", () => {
  const store = freshStore();
  store.setRole("duty");
  const draft = store.createWorkOrder(createOrderInput());
  assert.equal(draft.status, "draft");

  store.workOrderAction(draft.id, "submit", { by: "值班运行员（模拟）" });
  assert.equal(store.workorders.find((item) => item.id === draft.id)?.status, "pending_dispatch");

  store.setRole("engineer");
  store.workOrderAction(draft.id, "start", { by: "运维人员（模拟）", assignee: "王工" });
  assert.equal(store.workorders.find((item) => item.id === draft.id)?.status, "in_progress");

  store.workOrderAction(draft.id, "complete", {
    by: "运维人员（模拟）",
    result: { cause: "演示原因", measures: "演示措施" },
  });
  assert.equal(
    store.workorders.find((item) => item.id === draft.id)?.status,
    "pending_acceptance",
  );

  store.setRole("manager");
  store.workOrderAction(draft.id, "accept", {
    by: "管理者（模拟）",
    acceptance: { by: "管理者（模拟）", note: "演示验收通过" },
  });
  assert.equal(store.workorders.find((item) => item.id === draft.id)?.status, "archived");
});

test("T-08 验收退回回到维修中", () => {
  const store = freshStore();
  store.setRole("duty");
  const draft = store.createWorkOrder(createOrderInput());
  store.workOrderAction(draft.id, "submit", { by: "值班运行员（模拟）" });
  advanceToPendingAcceptance(store, draft.id);

  store.setRole("manager");
  store.workOrderAction(draft.id, "reject", {
    by: "管理者（模拟）",
    note: "复测记录不完整，退回补充",
    acceptance: { by: "管理者（模拟）", note: "退回补充" },
  });

  const order = store.workorders.find((item) => item.id === draft.id);
  assert.ok(order);
  assert.equal(order.status, "in_progress");
  assert.equal(order.acceptance?.accepted, false);
  assert.ok(order.history.some((entry) => entry.action === "reject"));
});

test("T-09 取消工单有审计", () => {
  const store = freshStore();
  store.setRole("duty");
  const draft = store.createWorkOrder(createOrderInput());
  store.workOrderAction(draft.id, "cancel", {
    by: "值班运行员（模拟）",
    note: "重复建单，取消",
  });

  const order = store.workorders.find((item) => item.id === draft.id);
  assert.ok(order);
  assert.equal(order.status, "cancelled");
  assert.ok(order.history.some((entry) => entry.action === "cancel"));
  assert.ok(
    store.userState.audits.some(
      (audit) => audit.action === "workorder:cancel" && audit.objectId === draft.id,
    ),
  );
});

test("T-10 验收归档派生 maintenance 与设备履历", () => {
  const store = freshStore();
  store.setRole("duty");
  const draft = store.createWorkOrder(createOrderInput());
  store.workOrderAction(draft.id, "submit", { by: "值班运行员（模拟）" });
  advanceToPendingAcceptance(store, draft.id);

  store.setRole("manager");
  store.workOrderAction(draft.id, "accept", {
    by: "管理者（模拟）",
    acceptance: { by: "管理者（模拟）", note: "演示验收通过" },
  });

  const maintenanceId = `MNT-${draft.code}-ACCEPT`;
  const record = store.maintenance.find((item) => item.id === maintenanceId);
  assert.ok(record);
  assert.equal(record.assetId, draft.assetId);
  assert.equal(record.workOrderId, draft.id);

  const timeline = store.timeline(draft.assetId);
  assert.ok(
    timeline.some(
      (event) => event.type === "maintenance" && event.sourceId === maintenanceId,
    ),
  );
  assert.ok(
    timeline.some(
      (event) => event.type === "workorder" && event.sourceId === draft.id,
    ),
  );
});

test("T-11 告警转工单双向关联（alarm.workOrderId）", () => {
  const store = freshStore();
  store.setRole("duty");
  const draft = store.createWorkOrder({
    ...createOrderInput("asset-mp001"),
    source: "alarm",
    alarmId: "ALM-MINING-01",
    evidenceIds: ["ALM-MINING-01"],
  });

  const alarm = store.alarms.find((item) => item.id === "ALM-MINING-01");
  assert.ok(alarm);
  assert.equal(alarm.workOrderId, draft.id);
  assert.equal(draft.alarmId, "ALM-MINING-01");
  assert.equal(store.workorders.find((item) => item.id === draft.id)?.alarmId, "ALM-MINING-01");
});

test("T-12 告警确认写入审计", () => {
  const store = freshStore();
  store.setRole("duty");
  store.ackAlarm("ALM-MINING-01");

  const alarm = store.alarms.find((item) => item.id === "ALM-MINING-01");
  assert.ok(alarm);
  assert.equal(alarm.status, "acknowledged");
  assert.ok(
    store.userState.audits.some(
      (audit) => audit.action === "alarm:ack" && audit.objectId === "ALM-MINING-01",
    ),
  );
});

test("T-13 deriveTimeline 多源派生且按时间倒序", () => {
  const seed = buildSeed("SCN-NORMAL");
  const timeline = deriveTimeline(seed, emptyUserState(), "asset-p002");
  const types = new Set(timeline.map((event) => event.type));

  for (const type of [
    "config",
    "alarm",
    "workorder",
    "inspection",
    "maintenance",
    "document",
  ] as const) {
    assert.ok(types.has(type), `缺少履历类型 ${type}`);
  }
  const times = timeline.map((event) => Date.parse(event.at));
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(times[index - 1] >= times[index]);
  }
});

test("T-14 A2UI 生成/改图型/改范围/加平均值参数生效", () => {
  const seed = buildSeed("SCN-NORMAL");
  const initial = composeRainSurface(seed, { chartType: "line", rangeCount: 3, showAverage: false });
  assert.equal(initial.rejected, false);
  const first = applyMessages(null, initial.messages, "manager");
  assert.equal(first.rejected, false);
  assert.ok(first.surface);
  assert.equal(first.surface.root, "rain-compare");

  const changed = composeRainSurface(seed, { chartType: "bar", rangeCount: 2, showAverage: true });
  const result = applyMessages(first.surface, changed.messages, "manager");
  assert.equal(result.rejected, false);
  assert.ok(result.surface);
  const compare = result.surface.components.find((item) => item.id === "rain-compare");
  assert.ok(compare);
  assert.equal(compare.props?.chartType, "bar");
  assert.equal(compare.props?.showAverage, true);
  assert.equal((compare.props?.labels as string[]).length, 2);
  assert.equal((compare.props?.series as unknown[]).length, 3);
  const dataParams = result.surface.dataModel.params as Record<string, unknown>;
  assert.equal(dataParams.chartType, "bar");
  assert.equal(dataParams.rangeCount, 2);
  assert.equal(dataParams.showAverage, true);
  const widgets = surfaceToWidgets(result.surface);
  assert.equal(widgets[0].props.rangeCount, 2);
  assert.equal(widgets[0].props.showAverage, true);
});

test("T-15 看板保存版本递增并可回滚恢复", () => {
  const store = freshStore();
  store.setRole("admin");
  const surface = (() => {
    const composed = composeRainSurface(store.seed, { chartType: "line", rangeCount: 3, showAverage: false });
    const applied = applyMessages(null, composed.messages, "admin");
    assert.ok(applied.surface);
    return applied.surface;
  })();
  const widgets = surfaceToWidgets(surface);
  const base: Dashboard = {
    id: "dash-acceptance",
    name: "验收看板",
    ownerId: "demo-user",
    ownerRole: "admin",
    scope: "personal",
    widgets,
    version: 1,
    createdAt: REFERENCE_TIME,
    updatedAt: REFERENCE_TIME,
    history: [],
  };

  const v1 = store.saveDashboard(base);
  assert.equal(v1.version, 1);
  const v2 = store.saveDashboard({
    ...v1,
    widgets: v1.widgets.map((widget) => ({ ...widget, title: `${widget.title}（改）` })),
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.history?.length, 1);

  const restored = store.restoreDashboard(v2.id, 1);
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.widgets, v1.widgets);
  assert.equal(store.dashboards.find((item) => item.id === v2.id)?.version, 3);
});

test("T-16 A2UI 未知组件/非法属性/越权动作被拒且保留最近合法 Surface", () => {
  const seed = buildSeed("SCN-NORMAL");
  const composed = composeRainSurface(seed, { chartType: "line", rangeCount: 3, showAverage: false });
  const legal = applyMessages(null, composed.messages, "manager");
  assert.ok(legal.surface);
  const previous: Surface = legal.surface;

  const unknown = applyMessages(
    previous,
    [
      {
        type: "updateComponents",
        surfaceId: previous.surfaceId,
        components: [{ id: "bad", component: "DangerChart" }],
      },
    ],
    "manager",
  );
  assert.equal(unknown.rejected, true);
  assert.equal(unknown.errors[0]?.code, "UNKNOWN_COMPONENT");
  assert.deepEqual(unknown.surface, previous);
  assert.equal(unknown.surface?.surfaceId, previous.surfaceId);

  const invalid = applyMessages(
    previous,
    [
      {
        type: "updateComponents",
        surfaceId: previous.surfaceId,
        components: [
          { id: "bad", component: "MetricCard", props: { label: "测试", value: {} } },
        ],
      },
    ],
    "manager",
  );
  assert.equal(invalid.rejected, true);
  assert.equal(invalid.errors[0]?.code, "INVALID_PROPS");
  assert.deepEqual(invalid.surface, previous);

  const forbidden = applyMessages(
    previous,
    [
      {
        type: "updateComponents",
        surfaceId: previous.surfaceId,
        components: [
          {
            id: "bad",
            component: "MetricCard",
            props: {
              label: "越权动作",
              value: 1,
              action: { kind: "saveDashboard" },
            },
          },
        ],
      },
    ],
    "viewer",
  );
  assert.equal(forbidden.rejected, true);
  assert.ok(forbidden.errors.some((error) => error.code === "FORBIDDEN_ACTION"));
  assert.deepEqual(forbidden.surface, previous);
  assert.equal(previous.components.length, 2);
});

test("T-17 缺电耗数据时拒绝生成用电量曲线（MISSING_DATA）", () => {
  const seed = buildSeed("SCN-NORMAL");
  assert.equal(isEnergyQuery("生成最近七天的用电量曲线"), true);
  const result = composeEnergySurface(seed.points);
  assert.equal(result.rejected, true);
  assert.equal(result.messages.length, 0);
  assert.equal(result.errors[0]?.code, "MISSING_DATA");
  assert.match(result.errors[0]?.message ?? "", /电耗/);
});

test("T-18 场景切换/复位保留用户新增资产", () => {
  const store = freshStore();
  store.setRole("admin");
  store.commitAssetDraft(assetDraft("P-003"));
  assert.ok(store.getAsset("asset-p003"));
  const baselineCount = buildSeed("SCN-NORMAL").assets.length;

  store.setScenario("SCN-RAIN");
  assert.equal(store.scenarioId, "SCN-RAIN");
  assert.ok(store.getAsset("asset-p003"));
  assert.equal(store.assets.length, buildSeed("SCN-RAIN").assets.length + 1);

  store.setScenario("SCN-NORMAL");
  assert.ok(store.getAsset("asset-p003"));

  store.resetScenario();
  assert.equal(store.scenarioId, "SCN-NORMAL");
  assert.equal(store.userState.assets.length, 1);
  assert.equal(store.userState.audits.length, 0);
  assert.equal(store.assets.length, baselineCount + 1);
});

test("场景切换与复位保留已导入档案及其设备关联，不恢复已删除资料", () => {
  const store = freshStore();
  store.setRole("admin");
  const original = store.documents[0];
  const imported = { ...original, id: "DOC-USER-RESET", title: "用户导入规程" };
  store.importDocument(imported);
  store.deleteDocument(original.id);
  store.setScenario("SCN-RAIN");
  assert.ok(!store.documents.some(doc => doc.id === imported.id));
  store.setScenario("SCN-NORMAL");
  store.resetScenario();

  const retained = store.documents.find(doc => doc.id === imported.id);
  assert.deepEqual(retained?.assetIds, imported.assetIds);
  assert.equal(retained?.title, imported.title);
  assert.equal(retained?.source, "user-upload");
  assert.ok(!store.documents.some(doc => doc.id === original.id));
});

test("T-19 审计事件 requestId 非空且随记录递增/唯一", () => {
  const store = freshStore();
  store.setRole("duty");
  store.ackAlarm("ALM-P002-01");
  store.ackAlarm("ALM-MINING-01");

  const audits = store.userState.audits;
  assert.equal(audits.length, 2);
  assert.deepEqual(
    audits.map((audit) => audit.id),
    ["AUD-000001", "AUD-000002"],
  );
  for (const audit of audits) {
    assert.ok(audit.requestId.trim().length > 0);
    assert.match(audit.requestId, /^REQ-\d{6}$/);
  }
  assert.equal(new Set(audits.map((audit) => audit.requestId)).size, audits.length);
  assert.equal(audits[0].requestId, "REQ-000001");
  assert.equal(audits[1].requestId, "REQ-000002");
});

test("T-20 雨次数据同源一致：rainEvents、ledger 与图表生成共用同一 seed", () => {
  const normal = buildSeed("SCN-NORMAL");
  const rain = buildSeed("SCN-RAIN");
  assert.deepEqual(
    normal.rainEvents.map((event) => event.id),
    rain.rainEvents.map((event) => event.id),
  );

  const normalLedgerRain = normal.ledger.find((entry) => entry.sourceType === "雨水");
  const rainLedgerRain = rain.ledger.find((entry) => entry.sourceType === "雨水");
  assert.ok(normalLedgerRain);
  assert.ok(rainLedgerRain);
  const ledgerFactor = rainLedgerRain.volume / normalLedgerRain.volume;
  assert.ok(Math.abs(ledgerFactor - 1.24) < 0.0001);

  assert.equal(rainStorage(normal.rainEvents.at(-1)).end?.total, 2556);
  for (const event of rain.rainEvents) {
    const inputs = event.simulation!;
    const expected = runRain(inputs.north);
    assert.equal(inputs.north.rainMm, event.rainfallMm);
    assert.deepEqual(expected.volume, event.north);
    assert.equal(expected.conservationGap, 0);
    assert.equal(runRain(inputs.south).conservationGap, 0);
  }

  const composed = composeRainSurface(rain, { chartType: "line", rangeCount: 3, showAverage: false });
  const applied = applyMessages(null, composed.messages, "manager");
  assert.ok(applied.surface);
  assert.deepEqual(
    applied.surface.dataModel.rainEventIds,
    rain.rainEvents.slice(-3).map((event) => event.id),
  );
  const widgets = surfaceToWidgets(applied.surface);
  assert.deepEqual(
    widgets[0].props.rainEventIds,
    rain.rainEvents.slice(-3).map((event) => event.id),
  );
});

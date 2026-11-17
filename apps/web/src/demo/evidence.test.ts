import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdvice,
  ensureNoForbiddenClaims,
  findReviewedEvidence,
  verifyAdvice,
} from "./evidence";
import type { HealthAdvice } from "./evidence";
import { scorePumpHealth } from "./health";
import { buildSeed, REFERENCE_TIME } from "./seed";
import { getPointSeries } from "./series";
import { estimateThresholdCrossing } from "./trend";
import type { Asset, UserState } from "./types";

const DAY = 86_400_000;

function p002(seed = buildSeed("SCN-PUMP-FAULT")): Asset {
  const asset = seed.assets.find((item) => item.id === "asset-p002");
  assert.ok(asset);
  return asset;
}

function trendOf(seed = buildSeed("SCN-PUMP-FAULT")) {
  const from = new Date(Date.parse(REFERENCE_TIME) - 14 * DAY).toISOString();
  return estimateThresholdCrossing(
    getPointSeries(seed, "asset-p002-vibration", from, REFERENCE_TIME),
    4.5,
  );
}

function healthOf(seed = buildSeed("SCN-PUMP-FAULT")) {
  const asset = p002(seed);
  return scorePumpHealth({
    asset,
    readings: { vibration: 4.3, temperature: 71, current: 128 },
    runtimeHours: asset.runtimeHours,
    startCount: asset.startCount,
    asOf: REFERENCE_TIME,
  });
}

test("仅返回已审核且未被移除的档案、巡检、已验收工单与告警", () => {
  const seed = buildSeed("SCN-NORMAL");
  const state: UserState = {
    assets: [],
    points: [],
    bindings: [],
    documents: [],
    removedDocumentIds: [],
    alarms: [],
    workorders: [],
    inspections: [],
    maintenance: [],
    dashboards: [],
    audits: [],
    agentRuns: [],
  };
  const evidence = findReviewedEvidence(seed, state, "asset-p002");
  const documentIds = evidence
    .filter((item) => item.kind === "document")
    .map((item) => item.refId);
  assert.ok(documentIds.includes("DOC-P002-MANUAL"));
  assert.ok(documentIds.includes("DOC-P002-INSPECT"));
  assert.ok(documentIds.includes("DOC-P002-CASE"));
  assert.ok(!documentIds.includes("DOC-P002-DRAWING"));
  assert.ok(evidence.some((item) => item.kind === "inspection"));
  assert.ok(evidence.some((item) => item.kind === "workorder"));
  assert.ok(evidence.some((item) => item.kind === "alarm"));
});

test("H-05 档案删除/未审核时无文档证据，建议降级并说明缺少可引用资料", () => {
  const seed = buildSeed("SCN-NORMAL");
  const removed = seed.documents
    .filter((document) => document.assetIds.includes("asset-p002"))
    .map((document) => document.id);
  const state: UserState = {
    assets: [],
    points: [],
    bindings: [],
    documents: [],
    removedDocumentIds: removed,
    alarms: [],
    workorders: [],
    inspections: [],
    maintenance: [],
    dashboards: [],
    audits: [],
    agentRuns: [],
  };

  const evidence = findReviewedEvidence(seed, state, "asset-p002");
  assert.equal(evidence.filter((item) => item.kind === "document").length, 0);

  const asset = p002(seed);
  const advice = buildAdvice({
    asset,
    health: healthOf(seed),
    trend: trendOf(seed),
    trendPointId: "asset-p002-vibration",
    trendPointLabel: "振动速度",
    evidence,
    documents: seed.documents,
    activeAlarms: seed.alarms.filter(
      (alarm) => alarm.assetId === "asset-p002" && alarm.status === "active",
    ),
  });

  assert.equal(advice.degraded, true);
  assert.ok(
    advice.limitations.some((item) => item.text.includes("缺少可引用资料")),
  );
  assert.ok(advice.checks.length > 0);
  assert.ok(advice.checks.every((item) => item.generic === true));
});

test("证据充分时可能原因与检查建议均引用可定位证据", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const asset = p002(seed);
  const evidence = findReviewedEvidence(seed, { ...emptyState() }, "asset-p002");
  const advice = buildAdvice({
    asset,
    health: healthOf(seed),
    trend: trendOf(seed),
    trendPointId: "asset-p002-vibration",
    trendPointLabel: "振动速度",
    evidence,
    documents: seed.documents,
    activeAlarms: seed.alarms.filter(
      (alarm) => alarm.assetId === "asset-p002" && alarm.status === "active",
    ),
  });

  assert.equal(advice.degraded, false);
  assert.ok(advice.observations.length > 0);
  assert.ok(advice.hypotheses.length > 0);
  assert.ok(advice.checks.length > 0);
  const evidenceIds = new Set(evidence.map((item) => item.refId));
  for (const item of [...advice.hypotheses, ...advice.checks]) {
    assert.ok(item.supportingEvidenceIds.length > 0);
    for (const id of item.supportingEvidenceIds) {
      assert.ok(evidenceIds.has(id), `证据 ${id} 不在证据库中`);
    }
    assert.equal(ensureNoForbiddenClaims(item.text), true);
  }
  for (const item of [...advice.observations, ...advice.limitations]) {
    assert.equal(ensureNoForbiddenClaims(item.text), true);
  }

  const verification = verifyAdvice(advice, [...evidenceIds]);
  assert.equal(verification.passed, true);
  assert.equal(verification.blockedClaims.length, 0);
  assert.equal(verification.advice.hypotheses.length, advice.hypotheses.length);
});

test("verifyAdvice 删除无证据与含被禁止表述的判断", () => {
  const advice: HealthAdvice = {
    observations: [],
    hypotheses: [
      { id: "h1", text: "可能原因方向：联轴器状态变化", supportingEvidenceIds: ["DOC-P002-MANUAL"] },
      { id: "h2", text: "可能原因方向：轴承磨损", supportingEvidenceIds: ["DOC-MISSING"] },
      { id: "h3", text: "可能原因方向：未提供证据", supportingEvidenceIds: [] },
    ],
    checks: [
      { id: "c1", text: "复测振动与温度", supportingEvidenceIds: ["DOC-P002-MANUAL"] },
      { id: "c2", text: "该设备故障概率92%", supportingEvidenceIds: ["DOC-P002-MANUAL"] },
    ],
    limitations: [],
    evidenceIds: ["DOC-P002-MANUAL"],
    degraded: false,
  };

  const result = verifyAdvice(advice, ["DOC-P002-MANUAL"]);
  assert.equal(result.passed, false);
  assert.equal(result.advice.hypotheses.length, 1);
  assert.equal(result.advice.hypotheses[0].id, "h1");
  assert.equal(result.advice.checks.length, 1);
  assert.equal(result.advice.checks[0].id, "c1");
  assert.ok(result.blockedClaims.length >= 3);
  assert.ok(result.blockedClaims.some((item) => item.section === "hypotheses"));
  assert.ok(result.blockedClaims.some((item) => item.section === "checks"));
});

test("ensureNoForbiddenClaims 拦截寿命、概率与停机结论表述", () => {
  assert.equal(ensureNoForbiddenClaims("预计 14 天后触及演示阈值"), true);
  assert.equal(ensureNoForbiddenClaims("设备剩余寿命还有 30 天"), false);
  assert.equal(ensureNoForbiddenClaims("经模型验证故障概率 92%"), false);
  assert.equal(ensureNoForbiddenClaims("输出停机结论"), false);
  assert.equal(ensureNoForbiddenClaims("RUL 估算为 20 天"), false);
});

function emptyState(): UserState {
  return {
    assets: [],
    points: [],
    bindings: [],
    documents: [],
    removedDocumentIds: [],
    alarms: [],
    workorders: [],
    inspections: [],
    maintenance: [],
    dashboards: [],
    audits: [],
    agentRuns: [],
  };
}

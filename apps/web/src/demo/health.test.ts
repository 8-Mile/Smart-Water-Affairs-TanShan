import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HEALTH_PROFILE,
  scorePumpHealth,
} from "./health";
import { estimateThresholdCrossing } from "./trend";
import { createWorkOrderDraft, emptyUserState, transitionWorkOrder } from "./commands";
import { buildSeed, REFERENCE_TIME } from "./seed";
import type { Asset } from "./types";

function pumpAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-p002",
    code: "P-002",
    name: "中压供水2号泵",
    subsystemId: "medium-pressure",
    type: "离心泵",
    status: "running",
    source: "MOCK",
    area: "north",
    runtimeHours: 10840,
    startCount: 782,
    archived: false,
    ...overrides,
  };
}

const READINGS = { vibration: 3.2, temperature: 66, current: 112 };

test("H-01 同读数不同设备 ID/编码时分数与扣分完全一致", () => {
  const first = scorePumpHealth({
    asset: pumpAsset(),
    readings: READINGS,
    runtimeHours: 10840,
    startCount: 782,
    asOf: REFERENCE_TIME,
  });
  const second = scorePumpHealth({
    asset: pumpAsset({ id: "asset-other-999", code: "X-999", name: "任意设备" }),
    readings: READINGS,
    runtimeHours: 10840,
    startCount: 782,
    asOf: REFERENCE_TIME,
  });

  assert.equal(typeof first.score, "number");
  assert.equal(first.score, second.score);
  assert.deepEqual(
    first.factors.map((factor) => factor.deduction),
    second.factors.map((factor) => factor.deduction),
  );
  assert.equal(first.factors.length, 4);
  assert.equal(first.coverage, 1);
  for (const factor of first.factors) {
    assert.ok(factor.valid);
    assert.ok(factor.risk !== null);
    assert.ok(factor.deduction !== null);
  }
});

test("H-02 振动缺测时不按 0 风险出分，趋势为 insufficient", () => {
  const result = scorePumpHealth({
    asset: pumpAsset(),
    readings: { temperature: 66, current: 112 },
    runtimeHours: 10840,
    startCount: 782,
    asOf: REFERENCE_TIME,
  });
  assert.equal(result.score, null);
  assert.equal(result.band, "资料不足");
  assert.ok(result.coverage < 1);
  assert.equal(result.coverage, 0.75);
  assert.ok(result.missingReasons.some((reason) => reason.includes("振动")));

  const trend = estimateThresholdCrossing([], 4.5);
  assert.equal(trend.status, "insufficient");
  assert.equal(trend.predictedAt, undefined);
});

test("H-06 工单验收不参与评分，评分仅由输入读数与工况决定", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const asset = seed.assets.find((item) => item.id === "asset-p002");
  assert.ok(asset);
  const readings = { vibration: 4.3, temperature: 71, current: 128 };
  const before = scorePumpHealth({
    asset,
    readings,
    runtimeHours: asset.runtimeHours,
    startCount: asset.startCount,
    asOf: REFERENCE_TIME,
  });

  let state = emptyUserState();
  state = createWorkOrderDraft(
    seed,
    state,
    {
      title: "趋势触阈检查",
      assetId: asset.id,
      source: "health_trend",
      symptom: "振动上升",
      suggestion: "复测振动",
      evidenceIds: ["DOC-P002-MANUAL"],
    },
    "duty",
  ).state;
  const orderId = state.workorders[0].id;
  state = transitionWorkOrder(seed, state, orderId, "submit", "duty");
  state = transitionWorkOrder(seed, state, orderId, "start", "engineer");
  state = transitionWorkOrder(seed, state, orderId, "complete", "engineer", {
    result: { cause: "联轴器对中偏差", measures: "重新对中并复测" },
  });
  state = transitionWorkOrder(seed, state, orderId, "accept", "manager");
  assert.equal(state.workorders.find((item) => item.id === orderId)?.status, "archived");

  const after = scorePumpHealth({
    asset,
    readings,
    runtimeHours: asset.runtimeHours,
    startCount: asset.startCount,
    asOf: REFERENCE_TIME,
  });
  assert.equal(after.score, before.score);
  assert.deepEqual(
    after.factors.map((factor) => factor.deduction),
    before.factors.map((factor) => factor.deduction),
  );
});

test("critical <= warning 时直接拒绝评分 Profile", () => {
  const broken = {
    ...DEFAULT_HEALTH_PROFILE,
    vibration: { warning: 4.5, critical: 4.5, unit: "mm/s" },
  };
  assert.throws(() =>
    scorePumpHealth({
      asset: pumpAsset(),
      readings: READINGS,
      runtimeHours: 10840,
      startCount: 782,
      profile: broken,
      asOf: REFERENCE_TIME,
    }),
  );
});

test("非泵类设备返回无适配模型，故障状态分数不高于 35", () => {
  const fan = scorePumpHealth({
    asset: pumpAsset({ id: "asset-dw001", code: "DW-001", type: "罗茨风机" }),
    readings: READINGS,
    runtimeHours: 8120,
    startCount: 188,
    asOf: REFERENCE_TIME,
  });
  assert.equal(fan.modelUnavailable, true);
  assert.equal(fan.score, null);
  assert.equal(fan.band, "无适配模型");

  const fault = scorePumpHealth({
    asset: pumpAsset({ status: "fault" }),
    readings: READINGS,
    runtimeHours: 10840,
    startCount: 782,
    asOf: REFERENCE_TIME,
  });
  assert.equal(typeof fault.score, "number");
  assert.ok((fault.score ?? 100) <= 35);
  assert.equal(fault.band, "危险");
});

import test from "node:test";
import assert from "node:assert/strict";
import { estimateThresholdCrossing } from "./trend";
import { buildSeed, REFERENCE_TIME } from "./seed";
import { getPointSeries } from "./series";
import type { Quality, TelemetrySample } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function series(
  values: number[],
  stepHours = 12,
  quality: Quality = "valid",
): TelemetrySample[] {
  const end = Date.parse(REFERENCE_TIME);
  return values.map((value, index) => ({
    pointId: "asset-p002-vibration",
    at: new Date(
      end - (values.length - 1 - index) * stepHours * HOUR,
    ).toISOString(),
    value,
    quality,
    source: "MOCK",
  }));
}

test("H-03 上升且满足门槛时给出 estimated、预测时间与 9 点外推序列", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const from = new Date(Date.parse(REFERENCE_TIME) - 14 * DAY).toISOString();
  const samples = getPointSeries(seed, "asset-p002-vibration", from, REFERENCE_TIME);
  assert.ok(samples.length >= 10);

  const trend = estimateThresholdCrossing(samples, 4.5, { horizonDays: 14 });
  assert.equal(trend.status, "estimated");
  assert.ok(trend.predictedAt);
  assert.ok((trend.predictedDays ?? 0) > 0);
  assert.ok((trend.predictedDays ?? 0) <= 14);
  assert.equal(trend.projected.length, 9);
  assert.ok(trend.projected.length > 0);
  assert.ok(trend.sampleCount >= 10);
  assert.ok(trend.spanDays >= 2);
  assert.ok((trend.slopePerDay ?? 0) > 0);
  assert.ok((trend.rSquared ?? 0) >= 0.55);
  assert.equal(trend.projected[0].value, trend.latestValue);
  assert.ok(
    (trend.projected[trend.projected.length - 1].value ?? 0) >=
      (trend.observed[trend.observed.length - 1].value ?? 0),
  );
  const last = trend.projected[trend.projected.length - 1];
  assert.ok(Math.abs(last.value - 4.5) < 0.05);
});

test("H-04 下降序列为 not_rising，高波动序列为 low_fit 或 not_rising，均无预测日期", () => {
  const descending = estimateThresholdCrossing(
    series([5, 4.7, 4.4, 4.1, 3.8, 3.5, 3.2, 2.9, 2.6, 2.3, 2, 1.7]),
    6,
  );
  assert.equal(descending.status, "not_rising");
  assert.equal(descending.predictedAt, undefined);

  const volatile = estimateThresholdCrossing(
    series([1, 4, 1.2, 3.8, 1.1, 4.1, 1.3, 3.9, 1, 4.2, 1.2, 3.7, 1.1, 4]),
    5,
  );
  assert.ok(
    volatile.status === "low_fit" || volatile.status === "not_rising",
    `unexpected ${volatile.status}`,
  );
  assert.equal(volatile.predictedAt, undefined);

  const insufficient = estimateThresholdCrossing(series([1, 2, 3, 4, 5]), 6);
  assert.equal(insufficient.status, "insufficient");
  assert.equal(insufficient.predictedAt, undefined);
});

test("已超过阈值返回 already_exceeded，超出窗口返回 out_of_horizon 且不给日期", () => {
  const exceeded = estimateThresholdCrossing(series([1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 3]), 2.5);
  assert.equal(exceeded.status, "already_exceeded");
  assert.equal(exceeded.predictedAt, undefined);

  const slow = estimateThresholdCrossing(series([1, 1.02, 1.04, 1.06, 1.08, 1.1, 1.12, 1.14, 1.16, 1.18, 1.2, 1.22]), 5);
  assert.equal(slow.status, "out_of_horizon");
  assert.equal(slow.predictedAt, undefined);
  assert.ok((slow.predictedDays ?? 0) > 14);
});

test("过滤无效质量、非数值与重复时间戳样本", () => {
  const valid = series([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5], 12);
  const dirty: TelemetrySample[] = [
    ...valid,
    { ...valid[0] },
    { ...valid[1], quality: "invalid", value: 99 },
    { ...valid[2], value: null },
  ];
  const trend = estimateThresholdCrossing(dirty, 6);
  assert.equal(trend.sampleCount, valid.length);
  assert.equal(trend.observed.length, valid.length);
});

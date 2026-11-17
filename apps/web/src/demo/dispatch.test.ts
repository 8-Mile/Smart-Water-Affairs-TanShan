import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DISPATCH, evaluateDispatch, type DispatchInputs } from "./dispatch";
import { runRain } from "./water";

const base = (): DispatchInputs => ({ ...DEFAULT_DISPATCH });
const close = (a: number, b: number, tolerance = 0.01) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);

test("保持现状复用同一雨洪口径，且三方案守恒", () => {
  for (const rainMm of [0, 30, 60, 80, 120]) {
    const result = evaluateDispatch({ ...base(), rainMm });
    const baseline = result.options[0];
    const known = runRain({ ...base(), rainMm });
    close(baseline.overflowM3, known.overflow);
    close(baseline.finalStorageM3, known.finalVolume);
    close(baseline.totalBaseOutM3, known.totalOutflow);
    for (const option of result.options) {
      close(option.balanceGapM3, 0, 0.0001);
      assert.ok(option.curve.every(p => p.storageM3 >= 0 && p.storageM3 <= base().capacityM3));
      assert.equal(option.curve.length, base().hours);
    }
  }
});
test("默认60mm场景：方案B腾库受最低储量和时间能力限制，C减少溢流", () => {
  const result = evaluateDispatch(base());
  const [a, b, c] = result.options;
  assert.ok(a.overflowM3 > 0);
  assert.equal(b.preReleaseM3, 1200);
  assert.equal(b.initialRainStorageM3, 3000);
  assert.ok(b.overflowM3 < a.overflowM3);
  assert.ok(c.overflowM3 <= b.overflowM3);
  assert.ok(c.extraReuseM3 <= 300 * 12);
  assert.equal(result.recommended, "reuse");
});
test("未获排放许可，B不可执行且不参与推荐", () => {
  const result = evaluateDispatch({ ...base(), dischargeAllowed: false });
  assert.equal(result.options[1].feasible, false);
  assert.match(result.options[1].blockers.join(""), /批准/);
  assert.notEqual(result.recommended, "pre_release");
  assert.equal(result.options[1].preReleaseM3, 0);
});
test("没有合格回用去向或同期需求，C不可执行", () => {
  for (const props of [{ reuseAllowed: false }, { reuseDemandM3h: 0 }, { reuseCapacityM3h: 0 }]) {
    const result = evaluateDispatch({ ...base(), ...props });
    assert.equal(result.options[2].feasible, false);
    assert.equal(result.options[2].extraReuseM3, 0);
    assert.notEqual(result.recommended, "reuse");
  }
});
test("只能推荐获准可执行方案；所有受阻必须回退保持现状", () => {
  const result = evaluateDispatch({ ...base(), dischargeAllowed: false, reuseAllowed: false });
  assert.equal(result.recommended, "baseline");
  assert.equal(result.options.filter(o => o.feasible).length, 1);
});
test("雨前腾库不能触碰保底储量，也不能超过额外泵能力×时长", () => {
  const x = { ...base(), rainMm: 80, initialStorageM3: 2200, reserveM3: 2000, leadHours: 2, preReleaseCapacityM3h: 300 };
  const result = evaluateDispatch(x);
  assert.equal(result.options[1].preReleaseM3, 200);
  assert.equal(result.options[1].initialRainStorageM3, 2000);
});
test("额外回用不超过同期需求、回用能力与可用水量", () => {
  const result = evaluateDispatch({ ...base(), reuseCapacityM3h: 500, reuseDemandM3h: 35 });
  const c = result.options[2];
  assert.ok(c.extraReuseM3 <= 35 * base().hours + 1e-6);
  assert.ok(c.curve.every(hour => hour.extraReuseM3 <= 35 + 1e-6));
  assert.ok(c.curve.every(hour => hour.storageM3 >= 0));
});
test("回用经济收益不应伪造：增量成本由假定价格相减，不计现有出流为新增回用", () => {
  const result = evaluateDispatch(base());
  const [a,b,c] = result.options;
  assert.equal(a.incrementalNetCostYuan, 0);
  close(b.incrementalNetCostYuan, b.preReleaseM3 * base().preReleaseCostYuanM3);
  close(c.incrementalNetCostYuan, c.extraReuseM3 * (base().reuseTreatmentCostYuanM3 - base().avoidedTapPriceYuanM3));
  assert.ok(c.incrementalNetCostYuan < 0);
});
test("无新增安全效益时不会为降低峰值盲目采用成本更高的方案", () => {
  const result = evaluateDispatch({
    ...base(), rainMm: 0, initialStorageM3: 2400, outflowM3h: 300,
    reuseTreatmentCostYuanM3: 4, avoidedTapPriceYuanM3: 2,
  });
  assert.equal(result.recommended, "baseline");
});
test("无效工艺条件必须拒绝；不允许负值、超过库容与非整数时长", () => {
  assert.throws(() => evaluateDispatch({ ...base(), initialStorageM3: 7000 }), /初始储量/);
  assert.throws(() => evaluateDispatch({ ...base(), reserveM3: 7000 }), /最低运行储量/);
  assert.throws(() => evaluateDispatch({ ...base(), reuseDemandM3h: -1 }), /回用需求/);
  assert.throws(() => evaluateDispatch({ ...base(), leadHours: 1.5 }), /雨前时长/);
  assert.throws(() => evaluateDispatch({ ...base(), rainMm: Number.NaN }), /降雨量/);
});
test("极端暴雨全部方案均溢流时必须发出工程复核警告", () => {
  const result = evaluateDispatch({ ...base(), rainMm: 120 });
  assert.ok(result.options.every(o => o.overflowM3 > 0));
  assert.ok(result.warnings.some(x => x.includes("所有可执行方案仍有预测溢流")));
});

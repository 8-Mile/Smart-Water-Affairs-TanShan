import { test } from "node:test";
import assert from "node:assert/strict";
import { runRain, health, supplyHours } from "@water/domain";
import { seed } from "./seed";
import { allowed } from "./domain";
test("水量守恒，包括溢出与低水量出流限制", () => {
  for (const rainMm of [0, 40, 200])
    for (const initial of [0, 4200, 9900]) {
      const p = {
        rainMm,
        initial,
        areaM2: 200000,
        coefficient: 0.75,
        capacity: 10000,
        outflow: 120,
        hours: 24,
      };
      const r = runRain(p);
      assert.ok(
        Math.abs(
          initial +
            r.totalInflow -
            r.totalOutflow -
            r.overflow -
            r.points.at(-1)!.volume,
        ) < 1e-7,
      );
      assert.ok(r.points.every((p) => p.volume >= 0 && p.volume <= 10000));
    }
  const a = runRain({
      rainMm: 40,
      initial: 4200,
      areaM2: 200000,
      coefficient: 0.75,
      capacity: 10000,
      outflow: 120,
      hours: 24,
    }),
    b = runRain({
      rainMm: 100,
      initial: 4200,
      areaM2: 200000,
      coefficient: 0.75,
      capacity: 10000,
      outflow: 120,
      hours: 24,
    });
  assert.notDeepEqual(a.points, b.points);
  assert.ok(b.overflow > 0);
});
test("计算拒绝不合法输入", () => {
  assert.throws(() =>
    runRain({
      rainMm: 10,
      initial: 200,
      capacity: 100,
      areaM2: 10,
      coefficient: 0.8,
      outflow: 0,
      hours: 24,
    }),
  );
});
test("泵能耗与健康评分分别计算，缺失与零分母不计算", () => {
  const s = seed("SCN-BASE");
  const a = s.assets.find((a) => a.id === "medium-pressure-1")!,
    b = s.assets.find((a) => a.id === "medium-pressure-2n")!;
  assert.equal(health(a).specificEnergy, 0.25);
  assert.equal(health(b).specificEnergy, 0.2);
  assert.equal(health({ ...b, volume: 0 }).specificEnergy, null);
  assert.equal(health({ ...b, energy: null }).specificEnergy, null);
  assert.equal(health({ ...b, energy: 1000 }).score, health(b).score);
});
test("职责与动作权限分离", () => {
  assert.equal(allowed("manager", "alarm:ack"), false);
  assert.equal(allowed("admin", "workorder:review"), false);
  assert.equal(allowed("viewer", "workorder:create"), false);
  assert.equal(allowed("duty", "alarm:ack"), true);
});

test("保障估算保护保留水量并随需求变化", () => {
  assert.equal(supplyHours(2800, 500, 100), 23);
  assert.equal(supplyHours(2800, 500, 200), 11.5);
  assert.throws(() => supplyHours(2800, 500, 0));
  assert.throws(() => supplyHours(100, 200, 50));
});

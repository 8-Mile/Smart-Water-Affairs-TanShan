import test from "node:test";
import assert from "node:assert/strict";
import {
  runRain,
  supplyDays,
  summarizeLedger,
  toCsv,
} from "./water";
import { buildSeed } from "./seed";
import type { LedgerEntry } from "./types";

const BASE = {
  rainMm: 41,
  areaM2: 18000,
  runoffCoefficient: 0.65,
  hours: 12,
  capacityM3: 9000,
  initialStorageM3: 5200,
  outflowM3h: 420,
};

test("守恒核对：逐小时 入−出−溢=储量变化", () => {
  const result = runRain(BASE);
  assert.equal(result.points.length, 12);
  assert.equal(result.hour[0], 1);
  assert.equal(result.hour[11], 12);
  assert.equal(result.volume.length, 12);

  let previous = BASE.initialStorageM3;
  for (const point of result.points) {
    const step = previous + point.inflow - point.outflow - point.overflow;
    assert.ok(
      Math.abs(step - point.volume) < 1e-6,
      `第 ${point.hour} 小时不守恒：${step} vs ${point.volume}`,
    );
    previous = point.volume;
  }

  assert.ok(Math.abs(result.storageChange - (result.totalInflow - result.totalOutflow - result.overflow)) < 1e-6);
  assert.ok(Math.abs(result.conservationGap) < 1e-6);
  assert.equal(result.totalInflow, 479.7);
  assert.equal(result.firstRiskHour, null);
  // 出库能力大于入库能力，储量首小时即下降，峰值取初始储量。
  assert.equal(result.peakHour, 0);
  assert.equal(result.peak, 5200);
});

test("容量边界：超容量记录溢出且峰值等于有效容量，无来水时触底为 0", () => {
  const overflowed = runRain({
    ...BASE,
    rainMm: 100,
    areaM2: 10000,
    runoffCoefficient: 1,
    hours: 10,
    capacityM3: 1000,
    initialStorageM3: 900,
    outflowM3h: 0,
  });
  assert.equal(overflowed.peak, 1000);
  assert.equal(overflowed.overflow, 900);
  assert.equal(overflowed.finalVolume, 1000);
  // 初始 900/1000 已超过 85% 风险水位，首次风险时刻记为 0。
  assert.equal(overflowed.firstRiskHour, 0);
  assert.ok(
    overflowed.points.every((point) => point.volume <= 1000 + 1e-9),
  );

  const rising = runRain({
    ...BASE,
    rainMm: 60,
    areaM2: 10000,
    runoffCoefficient: 1,
    hours: 6,
    capacityM3: 1000,
    initialStorageM3: 500,
    outflowM3h: 0,
  });
  assert.equal(rising.firstRiskHour, 4);

  const drained = runRain({
    ...BASE,
    rainMm: 0,
    hours: 4,
    capacityM3: 1000,
    initialStorageM3: 10,
    outflowM3h: 100,
  });
  assert.equal(drained.finalVolume, 0);
  assert.equal(drained.outflow[0], 10);
  assert.equal(drained.outflow[1], 0);
  assert.equal(drained.totalOutflow, 10);
  assert.equal(drained.overflow, 0);
});

test("非法参数抛错", () => {
  assert.throws(() => runRain({ ...BASE, rainMm: -1 }), /降雨量/);
  assert.throws(() => runRain({ ...BASE, areaM2: 0 }), /汇水面积/);
  assert.throws(() => runRain({ ...BASE, runoffCoefficient: 1.5 }), /径流系数/);
  assert.throws(() => runRain({ ...BASE, hours: 0 }), /时长/);
  assert.throws(() => runRain({ ...BASE, hours: 1.5 }), /时长/);
  assert.throws(() => runRain({ ...BASE, capacityM3: 0 }), /有效容量/);
  assert.throws(
    () => runRain({ ...BASE, initialStorageM3: 9500 }),
    /初始储量/,
  );
  assert.throws(() => runRain({ ...BASE, outflowM3h: -1 }), /处理\/外排能力/);

  assert.throws(() => supplyDays(-1, 0, 100), /当前储量/);
  assert.throws(() => supplyDays(100, 200, 100), /死库容/);
  assert.throws(() => supplyDays(100, 0, 0), /日均需水量/);
  assert.equal(supplyDays(5000, 1000, 800), 5);
  assert.equal(supplyDays(1000, 1000, 800), 0);
});

test("账本汇总不重复计量：中水回用单列、同源同向合并", () => {
  const seed = buildSeed("SCN-NORMAL");
  const summary = summarizeLedger(seed.ledger);
  const reuseRow = summary.rows.find((row) => row.sourceType === "中水");
  assert.ok(reuseRow);
  assert.equal(reuseRow?.direction, "out");
  assert.equal(reuseRow?.reuse, true);
  assert.equal(summary.reuseVolume, 8400);
  assert.equal(summary.totalIn, 15700);
  assert.equal(summary.totalOut, 19700);
  assert.equal(summary.externalIn, 3100);
  assert.equal(summary.externalOut, 11300);
  assert.equal(
    new Set(summary.rows.map((row) => row.key)).size,
    summary.rows.length,
  );
  assert.match(summary.note, /不重复/);

  const extra: LedgerEntry = {
    id: "LED-TEST",
    period: "2026-11",
    sourceType: "自来水",
    direction: "in",
    volume: 500,
    unit: "m³",
    note: "测试补录",
    source: "USER_ENTRY",
  };
  const merged = summarizeLedger([...seed.ledger, extra]);
  const tap = merged.rows.find(
    (row) => row.sourceType === "自来水" && row.direction === "in",
  );
  assert.equal(tap?.volume, 3600);
  assert.equal(tap?.entryCount, 2);
  assert.equal(merged.reuseVolume, 8400);
  assert.equal(merged.totalIn, 16200);
  assert.equal(merged.difference, -3500);
});

test("CSV 输出转义引号、逗号与换行", () => {
  const csv = toCsv(
    ["来源", "口径"],
    [
      ["雨水", "含,逗号"],
      ["中水", '含"引号"'],
      ["备注", "换\n行"],
    ],
  );
  const lines = csv.split("\n");
  assert.equal(lines[0], "来源,口径");
  assert.equal(lines[1], '雨水,"含,逗号"');
  assert.equal(lines[2], '中水,"含""引号"""');
  assert.ok(csv.includes('"换\n行"'));
});

test("末段储量使用最后共同有效小时，缺测不会补零或跨小时相加", async () => {
  const { rainStorage } = await import("./water");
  assert.deepEqual(rainStorage({ north: [4, 7, NaN, 99], south: [6, 0, 10] }).end,
    { hour: 2, north: 7, south: 0, total: 7 });
  assert.equal(rainStorage({north: [], south: [1]}).end, null);
  assert.equal(rainStorage({north: [-1, 5], south: [1, null]}).end, null);
});

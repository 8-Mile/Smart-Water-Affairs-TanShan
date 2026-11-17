import test from "node:test";
import assert from "node:assert/strict";
import { createAssetChangeSet, emptyUserState, validateAssetDraft } from "./commands";
import { intentToAssetDraft, parseIntent } from "./intent";
import { buildSeed } from "./seed";

const SEED = buildSeed("SCN-NORMAL");
const ASSETS = SEED.assets;
const POINTS = SEED.points;

const CREATE_PROMPT =
  "在射雾器除尘系统新增一台3号供水泵，编号P-003，额定功率45kW、流量120m³/h、扬程60m。增加出口压力、电流、流量和运行状态四个测点，先用模拟数据。把它显示在除尘工艺图上。";

test("解析新增设备示例指令：编号、子系统、额定参数与四个测点", () => {
  const intent = parseIntent(CREATE_PROMPT, { subsystemId: "spray" }, SEED, ASSETS, POINTS);
  assert.equal(intent.kind, "create_asset");
  assert.equal(intent.asset?.code, "P-003");
  assert.equal(intent.asset?.name, "3号供水泵");
  assert.equal(intent.subsystemId, "spray");
  assert.equal(intent.points.length, 4);
  assert.deepEqual(
    intent.points.map((point) => point.label),
    ["出口压力", "电机电流", "流量", "运行状态"],
  );
  const statusPoint = intent.points.find((point) => point.label === "运行状态");
  assert.equal(statusPoint?.kind, "enum");
  assert.deepEqual(statusPoint?.enumStates, ["运行", "停机", "故障", "未知"]);
  assert.equal(statusPoint?.baseline, 0);
  assert.equal(intent.asset?.rated.powerKw, 45);
  assert.equal(intent.asset?.rated.flowM3h, 120);
  assert.equal(intent.asset?.rated.headM, 60);
  assert.equal(intent.asset?.wantsBinding, true);
  assert.equal(intent.errors.length, 0);
  assert.deepEqual(intent.missingFields, []);

  const draft = intentToAssetDraft(intent);
  assert.ok(draft);
  assert.equal(draft?.binding, undefined);
  assert.equal(validateAssetDraft(SEED, emptyUserState(), draft!).ok, true);
});

test("子系统关键词按最早出现位置判定，明确工艺覆盖页面上下文", () => {
  const keyword = parseIntent(CREATE_PROMPT, {}, SEED, ASSETS, POINTS);
  assert.equal(keyword.subsystemId, "spray");

  const contextual = parseIntent(
    CREATE_PROMPT,
    { subsystemId: "medium-pressure" },
    SEED,
    ASSETS,
    POINTS,
  );
  assert.equal(contextual.subsystemId, "spray");
});

test("重复编号由 validateAssetDraft 与解析器双重拦截", () => {
  const intent = parseIntent(CREATE_PROMPT, { subsystemId: "spray" }, SEED, ASSETS, POINTS);
  const draft = intentToAssetDraft(intent);
  assert.ok(draft);

  const created = createAssetChangeSet(SEED, emptyUserState(), draft!, "admin");
  const duplicated = validateAssetDraft(SEED, created, draft!);
  assert.equal(duplicated.ok, false);
  assert.ok(duplicated.errors.some((issue) => issue.field === "code"));

  const again = parseIntent(
    CREATE_PROMPT,
    { subsystemId: "spray" },
    SEED,
    [...SEED.assets, ...created.assets],
    [...SEED.points, ...created.points],
  );
  assert.ok(again.errors.some((issue) => issue.field === "code"));
});

test("追加测点复用已有设备，不产生 create_asset", () => {
  const intent = parseIntent("给P-002增加轴承温度测点", {}, SEED, ASSETS, POINTS);
  assert.equal(intent.kind, "add_measure_point");
  assert.equal(intent.targetAssetId, "asset-p002");
  assert.equal(intent.targetAssetCode, "P-002");
  assert.equal(intent.points.length, 1);
  assert.equal(intent.points[0].label, "轴承温度");
  assert.equal(intent.points[0].unit, "℃");
  assert.equal(intent.asset, undefined);
  assert.equal(intentToAssetDraft(intent), null);

  const byContext = parseIntent("增加轴承温度测点", { assetId: "asset-p001" }, SEED, ASSETS, POINTS);
  assert.equal(byContext.kind, "add_measure_point");
  assert.equal(byContext.targetAssetId, "asset-p001");
  assert.equal(byContext.errors.length, 0);
});

test("生产控制类指令返回 unsupported 并说明能力边界", () => {
  const intent = parseIntent("启动P-002水泵", {}, SEED, ASSETS, POINTS);
  assert.equal(intent.kind, "unsupported");
  assert.match(intent.reason ?? "", /生产控制/);
  assert.equal(intent.points.length, 0);
  assert.equal(intent.targetAssetId, undefined);
  assert.ok(intent.examples.length >= 6);
  assert.ok(intent.examples.some(x => x.includes("雨前调蓄")));
  assert.ok(intent.capabilities.length >= 3);
});

test("空指令与歧义指令不猜测设备", () => {
  const empty = parseIntent("   ", {}, SEED, ASSETS, POINTS);
  assert.equal(empty.kind, "unsupported");
  assert.equal(empty.targetAssetId, undefined);

  const vague = parseIntent("帮我看看这个", {}, SEED, ASSETS, POINTS);
  assert.ok(vague.kind === "unsupported" || vague.kind === "query");
  assert.equal(vague.targetAssetId, undefined);
});

test("工艺点位移动要求人工点选，诊断与图表指令转入对应入口", () => {
  const move = parseIntent("把P-002挪到左上角", {}, SEED, ASSETS, POINTS);
  assert.equal(move.kind, "move_process_binding");
  assert.equal(move.targetAssetId, "asset-p002");
  assert.equal(move.requiresPick, true);
  assert.match(move.reason ?? "", /点选/);

  const diagnose = parseIntent("诊断P-002的健康趋势", {}, SEED, ASSETS, POINTS);
  assert.equal(diagnose.kind, "diagnose_asset");
  assert.equal(diagnose.route, "/decision/health?assetId=asset-p002");

  const compose = parseIntent("对比最近三次降雨南北储量并做成折线图", {}, SEED, ASSETS, POINTS);
  assert.equal(compose.kind, "compose_ui");
  assert.equal(compose.route, "/data/ai-workspace");
});

test("缺少编号时不猜测，返回 missingFields", () => {
  const intent = parseIntent("在除尘系统新增一台供水泵，额定功率45kW", {}, SEED, ASSETS, POINTS);
  assert.equal(intent.kind, "create_asset");
  assert.equal(intent.asset?.code, undefined);
  assert.ok(intent.missingFields.includes("code"));
  assert.ok(intent.errors.some((issue) => issue.field === "code"));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateAssetRun,
  buildDiagnoseRun,
  cancelPendingSteps,
  computeDiagnose,
  createHealthWorkOrder,
  findExistingHealthDraft,
  retryDiagnoseStep,
} from "./agentRuntime";
import type { DiagnoseRunInput } from "./agentRuntime";
import { createWorkOrderDraft } from "./commands";
import type { WorkOrderInput } from "./commands";
import { parseIntent } from "./intent";
import type { ParsedIntent } from "./intent";
import { buildSeed, REFERENCE_TIME } from "./seed";
import type { ScenarioSeed, UserState, WorkOrder } from "./types";

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

function diagnoseIntent(seed: ScenarioSeed): ParsedIntent {
  const intent = parseIntent(
    "分析中压供水2号泵健康度下降的原因，结合巡检和维修记录给我建议。",
    {},
    seed,
    seed.assets,
    seed.points,
  );
  assert.equal(intent.kind, "diagnose_asset");
  return intent;
}

function diagnoseInput(
  seed: ScenarioSeed,
  state: UserState,
  points?: DiagnoseRunInput["points"],
): DiagnoseRunInput {
  return {
    intent: diagnoseIntent(seed),
    seed,
    state,
    role: "duty",
    points,
  };
}

function stepOf(run: { steps: { id: string }[] }, id: string) {
  const found = run.steps.find((step) => step.id === id);
  assert.ok(found, `缺少步骤 ${id}`);
  return found as ReturnType<typeof buildDiagnoseRun>["steps"][number];
}

test("Case B 生成含工具、输入输出与可定位证据的完整步骤链", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const state = emptyState();
  const input = diagnoseInput(seed, state);
  const result = computeDiagnose(input);
  const run = result.run;

  assert.ok(run.id.startsWith("run-diagnose-"));
  assert.equal(run.taskType, "diagnose");
  assert.deepEqual(
    run.steps.map((step) => step.id),
    ["plan", "data", "doc", "score", "verify", "ui", "draft", "confirm"],
  );
  for (const step of run.steps) {
    assert.ok(step.agentName.length > 0);
    assert.ok(step.action.length > 0);
    assert.ok(step.inputSummary.length > 0);
    assert.ok(step.outputSummary.length > 0);
    if (step.id !== "confirm") assert.ok(step.tool, `步骤 ${step.id} 缺少工具名`);
  }

  assert.equal(run.status, "awaiting_confirmation");
  assert.equal(stepOf(run, "confirm").status, "pending");

  const dataEvidence = stepOf(run, "data").evidence ?? [];
  assert.ok(dataEvidence.some((item) => item.kind === "telemetry"));
  const docEvidence = stepOf(run, "doc").evidence ?? [];
  assert.ok(
    docEvidence.some(
      (item) => item.kind === "document" && item.refId === "DOC-P002-MANUAL",
    ),
  );
  assert.ok((stepOf(run, "verify").evidence ?? []).length > 0);
  assert.ok((stepOf(run, "ui").evidence ?? []).length > 0);

  assert.ok(result.asset);
  assert.equal(result.asset?.code, "P-002");
  assert.equal(result.advice?.degraded, false);
  assert.equal(result.verification?.passed, true);
  assert.ok((result.trend?.sampleCount ?? 0) >= 10);
  assert.ok(result.draft);
  assert.equal(result.draft?.source, "health_trend");
  assert.equal(result.draft?.assetId, "asset-p002");
  assert.ok((result.draft?.evidenceIds ?? []).includes("DOC-P002-MANUAL"));
  assert.equal(result.draft?.triggerSnapshot?.pointId, "asset-p002-vibration");

  assert.equal(buildDiagnoseRun(input).id, run.id);
});

test("无已审核档案时建议被核验删除并标记降级，仍不写入工单", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const removed = seed.documents
    .filter((document) => document.assetIds.includes("asset-p002"))
    .map((document) => document.id);
  const state: UserState = { ...emptyState(), removedDocumentIds: removed };
  const result = computeDiagnose(diagnoseInput(seed, state));

  const docStep = stepOf(result.run, "doc");
  assert.equal(docStep.status, "blocked");
  assert.equal(docStep.errorCode, "NO_EVIDENCE");

  assert.equal(result.advice?.degraded, true);
  assert.equal(result.verification?.advice.hypotheses.length, 0);
  assert.ok(
    (result.verification?.advice.checks ?? []).every((item) => item.generic === true),
  );
  assert.equal(stepOf(result.run, "verify").status, "done");
  assert.ok(stepOf(result.run, "verify").outputSummary.includes("降级"));
  assert.equal(result.run.status, "awaiting_confirmation");
  assert.equal(state.workorders.length, 0);
});

test("失败步骤可重试且重复确认不会创建第二张工单草稿", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const state = emptyState();
  const failed = computeDiagnose(diagnoseInput(seed, state, []));

  const dataStep = stepOf(failed.run, "data");
  assert.equal(dataStep.status, "failed");
  assert.equal(dataStep.errorCode, "NO_DATA");
  assert.equal(dataStep.retryable, true);
  assert.equal(failed.run.status, "failed");
  assert.equal(failed.draft, null);
  assert.equal(state.workorders.length, 0);

  const fresh = computeDiagnose(diagnoseInput(seed, state));
  const retried = retryDiagnoseStep(
    failed.run,
    "data",
    fresh.run,
    REFERENCE_TIME,
  );
  assert.equal(stepOf(retried, "data").status, "done");
  assert.equal(stepOf(retried, "confirm").status, "pending");
  assert.equal(state.workorders.length, 0);

  let workorders: WorkOrder[] = [];
  const service = {
    get workorders(): WorkOrder[] {
      return workorders;
    },
    createWorkOrder(input: WorkOrderInput): WorkOrder {
      const created = createWorkOrderDraft(seed, state, input, "duty");
      workorders = created.state.workorders;
      return created.draft;
    },
  };
  const draft = fresh.draft;
  assert.ok(draft);

  const first = createHealthWorkOrder(service, draft);
  const second = createHealthWorkOrder(service, draft);
  assert.equal(first.duplicated, false);
  assert.equal(second.duplicated, true);
  assert.equal(first.order.id, second.order.id);
  assert.equal(service.workorders.length, 1);
  assert.ok(
    findExistingHealthDraft(service.workorders, {
      assetId: draft.assetId,
      title: draft.title,
      evidenceIds: draft.evidenceIds ?? [],
    }),
  );
});

test("Case A 重复编号在向导前拦截，运行不写主数据", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const prompt =
    "在中压供水系统新增一台供水泵，编号P-002，额定功率45kW、流量120m³/h、扬程60m，增加出口压力测点";
  const intent = parseIntent(
    prompt,
    { subsystemId: "medium-pressure" },
    seed,
    seed.assets,
    seed.points,
  );
  assert.equal(intent.kind, "create_asset");
  assert.ok(intent.errors.some((issue) => issue.message.includes("已存在")));

  const assetsBefore = seed.assets.length;
  const run = buildCreateAssetRun({
    intent,
    at: REFERENCE_TIME,
    canCreateAsset: true,
  });
  const validate = stepOf(run, "validate");
  assert.equal(validate.status, "blocked");
  assert.equal(validate.errorCode, "VALIDATION_FAILED");
  assert.equal(run.status, "failed");
  assert.equal(seed.assets.length, assetsBefore);
});

test("取消诊断任务后无 pending/running 残留，也不写工单或设备", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const state = emptyState();
  const result = computeDiagnose(diagnoseInput(seed, state));

  const cancelled = cancelPendingSteps(result.run, REFERENCE_TIME, "用户取消，未执行");
  assert.equal(cancelled.status, "cancelled");
  assert.ok(
    cancelled.steps.every(
      (step) => step.status !== "pending" && step.status !== "running",
    ),
  );
  assert.equal(stepOf(cancelled, "confirm").status, "cancelled");
  assert.equal(state.workorders.length, 0);
  assert.equal(state.assets.length, 0);
});

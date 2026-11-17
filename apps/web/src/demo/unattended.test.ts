import assert from "node:assert/strict";
import test from "node:test";
import { assessPatrol, DEMO_PRESSURE_MIN_MPA, eventActive, mayClose, type DutyEvent, type DutySnapshot } from "./unattended";

const base: DutySnapshot = {
  mode: "normal", pressureMpa: 1.2, flowM3h: 320, pressureQuality: "valid",
  ocrStatus: "available", assetCode: "P-002", sampleTime: "DEMO模拟时间",
};
test("有效遥测且压力满足阈值：检查正常，未生成异常分类", () => {
  const result = assessPatrol(base);
  assert.equal(result.result, "normal");
  assert.equal(result.kind, undefined);
  assert.equal(result.checks.length, 4);
});
test("低压应形成专业异常并保留阈值依据", () => {
  const result = assessPatrol({ ...base, pressureMpa: DEMO_PRESSURE_MIN_MPA - 0.2, mode: "pressure" });
  assert.equal(result.result, "abnormal");
  assert.equal(result.kind, "low_pressure");
  assert.match(result.checks[1].note, /演示参考阈值/);
});
test("缺数与失效数据永远不当作0或正常", () => {
  for (const quality of ["missing", "invalid", "stale"] as const) {
    const result = assessPatrol({ ...base, mode: "signal", pressureMpa: null, pressureQuality: quality });
    assert.equal(result.result, "unknown");
    assert.equal(result.kind, "telemetry_missing");
    assert.equal(result.checks[1].value, "缺数");
  }
});
test("视频识表失败不误判为水泵故障", () => {
  const result = assessPatrol({ ...base, mode: "ocr", ocrStatus: "failed" });
  assert.equal(result.result, "unknown");
  assert.equal(result.kind, "ocr_unavailable");
  assert.match(result.detail ?? "", /辅助监护通道/);
});
test("设备数字测点故障优先于OCR失败，且不可宣称真实OCR", () => {
  const result = assessPatrol({ ...base, pressureMpa: null, pressureQuality: "missing", ocrStatus: "failed" });
  assert.equal(result.kind, "telemetry_missing");
  assert.match(result.evidence.join(" "), /MOCK/);
});
test("只有两次有效恢复检查后才具备人工关闭条件", () => {
  const event: DutyEvent = {
    id: "UT-00001", subsystemId: "medium-pressure", assetId: "asset-p002", kind: "low_pressure",
    title: "供水压力异常", level: "warning", status: "pending_recovery",
    firstSeen: "2026-11-16T00:00:00Z", lastSeen: "2026-11-16T00:00:00Z",
    occurrences: 2, validRecoveryChecks: 1, detail: "", evidence: [], history: [],
  };
  assert.equal(eventActive(event.status), true);
  assert.equal(mayClose(event), false);
  event.validRecoveryChecks = 2;
  event.status = "ready_to_close";
  assert.equal(mayClose(event), true);
  event.status = "closed";
  assert.equal(eventActive(event.status), false);
  assert.equal(mayClose(event), false);
});

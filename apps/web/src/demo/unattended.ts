/**
 * 智能值守第一期：确定性业务规则。只使用经过显式标注的DEMO模拟输入，
 * 不驱动现场设备、不承诺24小时后台巡查。
 */
export type PatrolMode = "normal" | "pressure" | "signal" | "ocr";
export type EventKind = "low_pressure" | "telemetry_missing" | "ocr_unavailable";
export type EventStatus = "pending_verification" | "acknowledged" | "processing" | "pending_recovery" | "ready_to_close" | "closed" | "dismissed";
export type CheckResult = "normal" | "abnormal" | "unknown";

export interface PatrolCheck {
  id: string;
  name: string;
  result: CheckResult;
  value: string;
  note: string;
  source: "MOCK";
}
export interface PatrolRecord {
  id: string;
  at: string;
  subsystemId: string;
  mode: PatrolMode;
  result: CheckResult;
  checks: PatrolCheck[];
  eventId?: string;
}
export interface EventAction {
  at: string;
  action: string;
  by: string;
  detail: string;
}
export interface DutyEvent {
  id: string;
  subsystemId: string;
  assetId: string;
  kind: EventKind;
  title: string;
  level: "warning" | "critical";
  status: EventStatus;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  validRecoveryChecks: number;
  workOrderId?: string;
  detail: string;
  evidence: string[];
  history: EventAction[];
}
export interface DutySnapshot {
  mode: PatrolMode;
  pressureMpa: number | null;
  flowM3h: number | null;
  pressureQuality: "valid" | "missing" | "invalid" | "stale";
  ocrStatus: "available" | "failed";
  assetCode: string;
  sampleTime: string;
}
export interface PatrolEvaluation {
  result: CheckResult;
  kind?: EventKind;
  title?: string;
  detail?: string;
  checks: PatrolCheck[];
  evidence: string[];
}

/** 1.15MPa是演示阈值，不是唐港设备定值；现场定值需要审核。 */
export const DEMO_PRESSURE_MIN_MPA = 1.15;
export const DUTY_MODE_NAMES: Record<PatrolMode, string> = {
  normal: "正常运行",
  pressure: "模拟压力异常",
  signal: "模拟通信失效",
  ocr: "模拟视频识别失败",
};
export const EVENT_STATUS_NAMES: Record<EventStatus, string> = {
  pending_verification: "待复核",
  acknowledged: "已确认",
  processing: "处理中",
  pending_recovery: "待恢复验证",
  ready_to_close: "待人工关闭",
  closed: "已闭环",
  dismissed: "误报归档",
};
export const EVENT_KIND_NAMES: Record<EventKind, string> = {
  low_pressure: "供水压力异常",
  telemetry_missing: "压力测点失去监护",
  ocr_unavailable: "视频识表不可用",
};

export function assessPatrol(input: DutySnapshot): PatrolEvaluation {
  const readingValid = input.pressureQuality === "valid" && input.pressureMpa !== null && Number.isFinite(input.pressureMpa);
  const pressureLow = readingValid && input.pressureMpa! < DEMO_PRESSURE_MIN_MPA;
  const checks: PatrolCheck[] = [
    {
      id: "telemetry", name: "压力数据质量", result: readingValid ? "normal" : "unknown",
      value: readingValid ? "有效 · " + input.sampleTime : input.pressureQuality === "stale" ? "数据超时" : "缺测 / 无效",
      note: readingValid ? "已检查采样状态；演示数据源" : "监护能力异常，不能把缺失值按0或正常处理", source: "MOCK",
    },
    {
      id: "pressure", name: "2号泵出口压力", result: !readingValid ? "unknown" : pressureLow ? "abnormal" : "normal",
      value: readingValid ? input.pressureMpa!.toFixed(2) + " MPa" : "缺数",
      note: "演示参考阈值 " + DEMO_PRESSURE_MIN_MPA.toFixed(2) + " MPa；真实定值须经业主审核", source: "MOCK",
    },
    {
      id: "flow", name: "出口流量参考", result: input.flowM3h === null ? "unknown" : "normal",
      value: input.flowM3h === null ? "缺数" : input.flowM3h.toFixed(1) + " m³/h",
      note: "流量仅用于辅助排查；当前未配置流量故障规则", source: "MOCK",
    },
    {
      id: "ocr", name: "视频识表通道", result: input.ocrStatus === "failed" ? "unknown" : "normal",
      value: input.ocrStatus === "failed" ? "模拟识别失败" : "模拟通道可用",
      note: "尚未接入真实视频OCR；不可据此声称已完成AI读表", source: "MOCK",
    },
  ];
  const evidence = [
    "设备：" + input.assetCode + "（中压供水）",
    "数据源：MOCK（非真实PLC）",
    "采样时间：" + input.sampleTime,
    "压力：" + (readingValid ? input.pressureMpa!.toFixed(2) + " MPa" : "缺测 / 不可信"),
    "流量：" + (input.flowM3h === null ? "缺测" : input.flowM3h.toFixed(1) + " m³/h"),
  ];
  if (!readingValid) return {
    result: "unknown", kind: "telemetry_missing", title: EVENT_KIND_NAMES.telemetry_missing,
    detail: "压力测点失去有效数据，无法判断供水工况。应检查采集链路和传感器。",
    checks, evidence,
  };
  if (pressureLow) return {
    result: "abnormal", kind: "low_pressure", title: EVENT_KIND_NAMES.low_pressure,
    detail: "P-002出口压力低于演示关注阈值。需结合其他工艺测点、泵组状态及现场核实，不能直接认定设备故障。",
    checks, evidence,
  };
  if (input.ocrStatus === "failed") return {
    result: "unknown", kind: "ocr_unavailable", title: EVENT_KIND_NAMES.ocr_unavailable,
    detail: "模拟视频识表失败，但数字压力测点仍可用；记录为辅助监护通道降级，而非泵组故障。",
    checks, evidence: [...evidence, "视频识表：模拟失败（无真实OCR）"],
  };
  return { result: "normal", checks, evidence };
}

export function eventActive(status: EventStatus): boolean {
  return status !== "closed" && status !== "dismissed";
}

export function mayClose(event: DutyEvent): boolean {
  return event.status === "ready_to_close" && event.validRecoveryChecks >= 2;
}

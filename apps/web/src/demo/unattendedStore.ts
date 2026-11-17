import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { assertCan } from "./permissions";
import { useDemoStore } from "./store";
import {
  assessPatrol, eventActive, mayClose,
  type DutyEvent, type DutySnapshot, type EventStatus,
  type PatrolMode, type PatrolRecord,
} from "./unattended";

const KEY = "tanggang-unattended-demo-v1";
const SYSTEM = "medium-pressure";
const ASSET = "asset-p002";

interface DutyState {
  version: 1;
  mode: PatrolMode;
  autoEnabled: boolean;
  nextPatrol: number;
  nextEvent: number;
  streaks: Record<string, number>;
  records: PatrolRecord[];
  events: DutyEvent[];
}
const initial = (): DutyState => ({
  version: 1, mode: "normal", autoEnabled: false,
  nextPatrol: 1, nextEvent: 1, streaks: {}, records: [], events: [],
});
function load(): DutyState {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DutyState> | null;
    if (value?.version === 1 && Array.isArray(value.events) && Array.isArray(value.records) &&
        typeof value.nextPatrol === "number" && typeof value.nextEvent === "number") {
      return { ...initial(), ...value, autoEnabled: false };
    }
  } catch { /* 无本地存储时继续使用内存 */ }
  return initial();
}
function persist(value: DutyState): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* 仅内存演示 */ }
}
function action(event: DutyEvent, name: string, by: string, detail: string, at: string): void {
  event.history.push({ at, action: name, by, detail });
}

export const useUnattendedStore = defineStore("unattended", () => {
  const demo = useDemoStore();
  const state = ref<DutyState>(load());
  const mode = computed(() => state.value.mode);
  const records = computed(() => state.value.records.slice().reverse());
  const events = computed(() => state.value.events.slice().reverse());
  const openEvents = computed(() => events.value.filter(e => eventActive(e.status)));
  const autoEnabled = computed(() => state.value.autoEnabled);

  function snapshot(): DutySnapshot {
    const pressure = demo.latest("asset-p002-pressure");
    const flow = demo.latest("asset-p002-flow");
    const current = state.value.mode;
    const pressureValue = typeof pressure?.value === "number" ? pressure.value : null;
    const flowValue = typeof flow?.value === "number" ? flow.value : null;
    return {
      mode: current,
      pressureMpa: current === "signal" ? null : current === "pressure" ? 0.92 : pressureValue,
      flowM3h: current === "signal" ? null : current === "pressure" ? 286 : flowValue,
      pressureQuality: current === "signal" ? "missing" : (pressure?.quality === "estimated" ? "invalid" : (pressure?.quality ?? "missing")),
      ocrStatus: current === "ocr" ? "failed" : "available",
      assetCode: "P-002",
      sampleTime: current === "normal" ? (pressure?.at ?? "无采样") : "演示输入 · MOCK",
    };
  }
  function commit(): void {
    persist(state.value);
  }
  function runPatrol(): PatrolRecord {
    assertCan(demo.role, "unattended:execute");
    const now = new Date().toISOString();
    const snap = snapshot();
    const evaluation = assessPatrol(snap);
    const current = state.value;
    const record: PatrolRecord = {
      id: `PAT-${String(current.nextPatrol++).padStart(5, "0")}`,
      at: now, subsystemId: SYSTEM, mode: current.mode,
      result: evaluation.result, checks: evaluation.checks,
    };
    if (evaluation.kind) {
      const kind = evaluation.kind;
      const key = `${ASSET}:${kind}`;
      current.streaks[key] = (current.streaks[key] ?? 0) + 1;
      // 连续两轮才新建事件（两轮均为MOCK样本，并不冒充真实时长）。
      const existing = current.events.find(e => e.kind === kind && e.assetId === ASSET && eventActive(e.status));
      if (!existing && current.streaks[key] >= 2) {
        const id = `UT-${String(current.nextEvent++).padStart(5, "0")}`;
        const newEvent: DutyEvent = {
          id, subsystemId: SYSTEM, assetId: ASSET, kind,
          title: evaluation.title ?? "待核查事件",
          level: kind === "low_pressure" ? "warning" : "critical",
          status: "pending_verification", firstSeen: now, lastSeen: now,
          occurrences: 2, validRecoveryChecks: 0,
          detail: evaluation.detail ?? "", evidence: evaluation.evidence,
          history: [{ at: now, action: "自动发现", by: "值守规则引擎（MOCK）", detail: "连续2次巡查异常；演示阈值与规则" }],
        };
        current.events.push(newEvent);
        record.eventId = id;
      } else if (existing) {
        existing.lastSeen = now;
        existing.occurrences++;
        existing.evidence = evaluation.evidence;
        record.eventId = existing.id;
        if (existing.status === "pending_recovery" || existing.status === "ready_to_close") {
          existing.validRecoveryChecks = 0;
          existing.status = "processing";
          action(existing, "恢复验证失败", "值守规则引擎", "异常仍然存在，退回处理中", now);
        }
      }
    } else {
      current.streaks = {};
    }
    for (const event of current.events) {
      if (!eventActive(event.status) || event.status !== "pending_recovery") continue;
      const recovered = event.kind === "low_pressure"
        ? evaluation.result === "normal"
        : event.kind === "telemetry_missing"
          ? snap.pressureQuality === "valid" && snap.pressureMpa !== null
          : snap.ocrStatus === "available";
      if (recovered) {
        event.validRecoveryChecks++;
        if (event.validRecoveryChecks >= 2) {
          event.status = "ready_to_close";
          action(event, "恢复复核通过", "值守规则引擎", "连续2轮有效巡查，待人员关闭", now);
        }
      } else if (event.validRecoveryChecks > 0) {
        event.validRecoveryChecks = 0;
        action(event, "恢复计数清零", "值守规则引擎", "本轮不满足恢复条件", now);
      }
    }
    // 保留最近120轮供浏览器DEMO展示；真实项目需服务端审计与归档。
    current.records = [...current.records, record].slice(-120);
    commit();
    return record;
  }
  function selectMode(value: PatrolMode): void {
    assertCan(demo.role, "unattended:execute");
    state.value.mode = value;
    state.value.streaks = {};
    commit();
  }
  function simulate(value: PatrolMode): PatrolRecord {
    selectMode(value);
    runPatrol();
    return runPatrol();
  }
  function toggleAuto(): void {
    assertCan(demo.role, "unattended:execute");
    state.value.autoEnabled = !state.value.autoEnabled;
    commit();
  }
  function updateEvent(id: string, target: EventStatus, detail = ""): DutyEvent {
    assertCan(demo.role, "unattended:confirm");
    const event = state.value.events.find(item => item.id === id);
    if (!event) throw new Error("事件不存在");
    const allowed: Partial<Record<EventStatus, EventStatus[]>> = {
      pending_verification: ["acknowledged", "dismissed"],
      acknowledged: ["processing", "dismissed"],
      processing: ["pending_recovery"],
      ready_to_close: ["closed"],
    };
    if (!(allowed[event.status] ?? []).includes(target)) throw new Error("事件状态不允许此操作");
    if (target === "dismissed" && !detail.trim()) throw new Error("误报归档必须填写核实依据");
    if (target === "closed") {
      if (!mayClose(event)) throw new Error("尚未通过连续两轮有效恢复验证");
      if (event.kind === "low_pressure" && (!event.workOrderId ||
          demo.workorders.find(w => w.id === event.workOrderId)?.status !== "archived")) {
        throw new Error("压力异常需要关联已验收归档的工单才能关闭");
      }
    }
    event.status = target;
    if (target === "pending_recovery") event.validRecoveryChecks = 0;
    const now = new Date().toISOString();
    action(event, target === "dismissed" ? "误报归档" : target === "closed" ? "人工关闭" : target === "pending_recovery" ? "申请恢复验证" : target === "acknowledged" ? "人工确认" : "开始处置", demo.role, detail.trim() || "人工业务操作", now);
    commit();
    return event;
  }
  function createEventOrder(id: string): string {
    assertCan(demo.role, "workorder:create");
    const event = state.value.events.find(item => item.id === id);
    if (!event || !eventActive(event.status)) throw new Error("没有可处理事件");
    if (event.status === "pending_verification") throw new Error("请先人工确认事件");
    if (event.workOrderId) return event.workOrderId;
    const order = demo.createWorkOrder({
      title: `[值守${event.id}] ${event.title}检查`,
      assetId: event.assetId, source: "inspection",
      symptom: event.detail,
      suggestion: "由值班人员现场核实压力、泵组、仪表与采集链路；操作须按审批制度实施。",
      priority: event.kind === "low_pressure" ? "high" : "medium",
      evidenceIds: [event.id, "asset-p002-pressure"],
      createdBy: demo.role,
    });
    event.workOrderId = order.id;
    action(event, "建立检查工单", demo.role, `关联现有工单 ${order.code}`, new Date().toISOString());
    commit();
    return order.id;
  }
  function resetDemo(): void {
    assertCan(demo.role, "unattended:execute");
    // 仅清空值守DEMO记录，已生成的正式演示工单留在工单模块，不静默删除。
    state.value = initial();
    commit();
  }
  return { mode, records, events, openEvents, autoEnabled, snapshot, runPatrol, selectMode, simulate, toggleAuto, updateEvent, createEventOrder, resetDemo };
});

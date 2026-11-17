import type {
  Asset,
  AuditEvent,
  MeasurePoint,
  ProcessBinding,
  Role,
  ScenarioSeed,
  TimelineEvent,
  UserState,
  WorkOrder,
} from "./types";

export type PointDraft = Omit<MeasurePoint, "id" | "assetId">;

export interface BindingDraft {
  xPct: number;
  yPct: number;
  nodeId?: string;
}

export interface AssetDraft {
  code: string;
  name: string;
  subsystemId: string;
  type: string;
  rated?: { powerKw?: number; flowM3h?: number; headM?: number };
  points: PointDraft[];
  binding?: BindingDraft;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}

export type WorkOrderAction =
  | "submit"
  | "start"
  | "complete"
  | "accept"
  | "reject"
  | "cancel";

export interface WorkOrderInput {
  title: string;
  assetId: string;
  source?: WorkOrder["source"];
  alarmId?: string;
  symptom: string;
  suggestion: string;
  priority?: WorkOrder["priority"];
  evidenceIds?: string[];
  triggerSnapshot?: WorkOrder["triggerSnapshot"];
  createdBy?: string;
}

export interface WorkOrderTransitionPayload {
  note?: string;
  assignee?: string;
  by?: string;
  result?: {
    cause: string;
    measures: string;
    materials?: string;
    note?: string;
  };
  acceptance?: { note?: string; by?: string };
}

const ALLOWED_UNITS = new Set([
  "MPa",
  "mm/s",
  "℃",
  "A",
  "m³/h",
  "m³/min",
  "m³",
  "%",
  "bar",
  "rpm",
  "kW",
  "V",
  "pH",
  "NTU",
  "m",
]);

export function emptyUserState(): UserState {
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

function cloneState(state: UserState): UserState {
  return JSON.parse(JSON.stringify(state)) as UserState;
}

function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of base) merged.set(item.id, item);
  for (const item of extra) merged.set(item.id, item);
  return [...merged.values()];
}

function allAssets(seed: ScenarioSeed, state: UserState): Asset[] {
  return mergeById(seed.assets, state.assets);
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "point";
}

function nextAuditId(state: UserState): string {
  let max = 0;
  for (const audit of state.audits) {
    const match = /AUD-(\d+)/.exec(audit.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `AUD-${String(max + 1).padStart(6, "0")}`;
}

function makeAudit(
  seed: ScenarioSeed,
  state: UserState,
  actorRole: Role,
  action: string,
  objectType: string,
  objectId: string,
  summary: string,
  before?: string,
  after?: string,
): AuditEvent {
  const id = nextAuditId(state);
  return {
    id,
    at: seed.referenceTime,
    actorRole,
    action,
    objectType,
    objectId,
    summary,
    before,
    after,
    requestId: `REQ-${id.slice(4)}`,
  };
}

function positive(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0);
}

function inUnit(value: number): boolean {
  return value >= 0 && value <= 1;
}

export function validateAssetDraft(
  seed: ScenarioSeed,
  state: UserState,
  draft: AssetDraft,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const code = draft.code.trim();
  const name = draft.name.trim();

  if (!code) errors.push({ field: "code", message: "设备编号不能为空" });
  if (!name) errors.push({ field: "name", message: "设备名称不能为空" });
  if (!draft.type.trim()) errors.push({ field: "type", message: "设备类型不能为空" });

  const subsystem = seed.subsystems.find((item) => item.id === draft.subsystemId);
  if (!subsystem) {
    errors.push({ field: "subsystemId", message: "所选工艺子系统不存在" });
  } else if (code) {
    const duplicated = allAssets(seed, state).some(
      (asset) =>
        asset.subsystemId === draft.subsystemId &&
        asset.code.trim().toLowerCase() === code.toLowerCase(),
    );
    if (duplicated) {
      errors.push({
        field: "code",
        message: `编号 ${code} 在「${subsystem.name}」中已存在`,
      });
    }
  }

  for (const key of ["powerKw", "flowM3h", "headM"] as const) {
    if (!positive(draft.rated?.[key])) {
      errors.push({ field: `rated.${key}`, message: "额定值必须为正数" });
    }
  }

  if (draft.points.length < 1) {
    errors.push({ field: "points", message: "至少需要配置 1 个测点" });
  }
  const labels = new Set<string>();
  draft.points.forEach((point, index) => {
    const label = point.label.trim();
    if (!label) {
      errors.push({ field: `points.${index}.label`, message: "测点名称不能为空" });
    } else if (labels.has(label.toLowerCase())) {
      errors.push({
        field: `points.${index}.label`,
        message: `测点名称「${label}」重复`,
      });
    } else {
      labels.add(label.toLowerCase());
    }
    if (point.kind === "number" && point.unit && !ALLOWED_UNITS.has(point.unit)) {
      errors.push({
        field: `points.${index}.unit`,
        message: `单位「${point.unit}」不在允许范围内`,
      });
    }
    if (point.range && point.range[0] >= point.range[1]) {
      errors.push({
        field: `points.${index}.range`,
        message: "量程下限必须小于上限",
      });
    }
    if (
      !positive(point.baseline) &&
      point.baseline !== 0 &&
      point.baseline !== undefined
    ) {
      errors.push({
        field: `points.${index}.baseline`,
        message: "基准值不能为负数",
      });
    }
    if (
      point.volatility !== undefined &&
      (!Number.isFinite(point.volatility) || point.volatility < 0)
    ) {
      errors.push({
        field: `points.${index}.volatility`,
        message: "波动幅度不能为负数",
      });
    }
  });

  if (draft.binding) {
    if (!inUnit(draft.binding.xPct) || !inUnit(draft.binding.yPct)) {
      errors.push({
        field: "binding",
        message: "工艺点位坐标必须位于 0~1 之间",
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

export function createAssetChangeSet(
  seed: ScenarioSeed,
  state: UserState,
  draft: AssetDraft,
  actorRole: Role,
): UserState {
  const result = validateAssetDraft(seed, state, draft);
  if (!result.ok) {
    throw new Error(result.errors.map((item) => item.message).join("；"));
  }

  const next = cloneState(state);
  const code = draft.code.trim();
  const assetId = `asset-${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  if (allAssets(seed, state).some((asset) => asset.id === assetId)) {
    throw new Error(`设备 ${code} 已存在，不能重复创建`);
  }

  const subsystemId = draft.subsystemId;
  const asset: Asset = {
    id: assetId,
    code,
    name: draft.name.trim(),
    subsystemId,
    type: draft.type.trim(),
    rated: draft.rated ? { ...draft.rated } : undefined,
    status: "stopped",
    source: "USER_ENTRY",
    area: draft.binding?.yPct !== undefined && draft.binding.yPct >= 0.5 ? "south" : "north",
    runtimeHours: 0,
    startCount: 0,
    manufacturer: "DEMO 模拟设备厂商",
    owner: "演示用户（模拟）",
    installedAt: seed.referenceTime.slice(0, 10),
    archived: false,
    condition: "新建设备待投运",
  };

  const points: MeasurePoint[] = draft.points.map((point) => ({
    ...point,
    id: `${assetId}-${slugify(point.label)}`,
    assetId,
    source: point.source,
    quality: point.quality ?? "estimated",
  }));

  const binding: ProcessBinding | undefined = draft.binding
    ? {
        id: `bind-${code.toLowerCase()}`,
        subsystemId,
        assetId,
        backgroundId: `bg-${subsystemId}`,
        xPct: draft.binding.xPct,
        yPct: draft.binding.yPct,
        nodeId: draft.binding.nodeId,
        label: asset.name,
        verifiedPhysicalLink: false,
      }
    : undefined;

  next.assets = [...next.assets, asset];
  next.points = [...next.points, ...points];
  if (binding) next.bindings = [...next.bindings, binding];
  next.audits = [
    ...next.audits,
    makeAudit(
      seed,
      next,
      actorRole,
      "asset:create",
      "asset",
      assetId,
      `创建资产 ${code} ${asset.name}，新增 ${points.length} 个测点${binding ? "并绑定工艺点位" : ""}`,
      undefined,
      JSON.stringify({
        id: assetId,
        code,
        subsystemId,
        points: points.map((point) => point.id),
        binding: binding ? { xPct: binding.xPct, yPct: binding.yPct } : null,
      }),
    ),
  ];

  return next;
}

export function addPointChangeSet(
  seed: ScenarioSeed,
  state: UserState,
  assetId: string,
  pointDraft: PointDraft,
  actorRole: Role,
): UserState {
  const asset = allAssets(seed, state).find((item) => item.id === assetId);
  if (!asset) throw new Error(`设备 ${assetId} 不存在`);

  const label = pointDraft.label.trim();
  if (!label) throw new Error("测点名称不能为空");
  if (pointDraft.kind === "number" && pointDraft.unit && !ALLOWED_UNITS.has(pointDraft.unit)) {
    throw new Error(`单位「${pointDraft.unit}」不在允许范围内`);
  }

  const points = mergeById(seed.points, state.points);
  if (
    points.some(
      (point) =>
        point.assetId === assetId &&
        point.label.trim().toLowerCase() === label.toLowerCase(),
    )
  ) {
    throw new Error(`设备 ${asset.code} 已存在测点「${label}」`);
  }

  const pointId = `${assetId}-${slugify(label)}`;
  if (points.some((point) => point.id === pointId)) {
    throw new Error(`测点编号 ${pointId} 已存在`);
  }

  const next = cloneState(state);
  const point: MeasurePoint = {
    ...pointDraft,
    id: pointId,
    assetId,
    source: pointDraft.source,
    quality: pointDraft.quality ?? "estimated",
  };
  next.points = [...next.points, point];
  next.audits = [
    ...next.audits,
    makeAudit(
      seed,
      next,
      actorRole,
      "point:add",
      "measurePoint",
      pointId,
      `为 ${asset.code} 追加测点「${label}」`,
      undefined,
      JSON.stringify({ pointId, label, unit: point.unit, kind: point.kind }),
    ),
  ];
  return next;
}

export function moveBindingChangeSet(
  seed: ScenarioSeed,
  state: UserState,
  assetId: string,
  binding: BindingDraft,
  actorRole: Role,
): UserState {
  const asset = allAssets(seed, state).find((item) => item.id === assetId);
  if (!asset) throw new Error(`设备 ${assetId} 不存在`);
  if (!inUnit(binding.xPct) || !inUnit(binding.yPct)) {
    throw new Error("工艺点位坐标必须位于 0~1 之间");
  }

  const next = cloneState(state);
  const existing = mergeById(seed.bindings, state.bindings).find(
    (item) => item.assetId === assetId,
  );
  const base: ProcessBinding = existing ?? {
    id: `bind-${asset.code.toLowerCase()}`,
    subsystemId: asset.subsystemId,
    assetId,
    backgroundId: `bg-${asset.subsystemId}`,
    xPct: binding.xPct,
    yPct: binding.yPct,
    nodeId: binding.nodeId,
    label: asset.name,
    verifiedPhysicalLink: false,
  };
  const updated: ProcessBinding = {
    ...base,
    xPct: binding.xPct,
    yPct: binding.yPct,
    nodeId: binding.nodeId ?? base.nodeId,
  };

  next.bindings = [
    ...next.bindings.filter((item) => item.assetId !== assetId),
    updated,
  ];
  next.audits = [
    ...next.audits,
    makeAudit(
      seed,
      next,
      actorRole,
      "binding:write",
      "processBinding",
      updated.id,
      `调整 ${asset.code} 的工艺点位`,
      existing ? JSON.stringify({ xPct: existing.xPct, yPct: existing.yPct }) : undefined,
      JSON.stringify({ xPct: updated.xPct, yPct: updated.yPct }),
    ),
  ];
  return next;
}

function nextWorkOrderCode(seed: ScenarioSeed, state: UserState): string {
  const year = seed.referenceTime.slice(0, 4);
  let max = 0;
  for (const order of mergeById(seed.workorders, state.workorders)) {
    const match = new RegExp(`^WO-${year}-(\\d+)$`).exec(order.code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `WO-${year}-${String(max + 1).padStart(3, "0")}`;
}

export function createWorkOrderDraft(
  seed: ScenarioSeed,
  state: UserState,
  input: WorkOrderInput,
  actorRole: Role = "duty",
): { state: UserState; draft: WorkOrder } {
  const asset = allAssets(seed, state).find((item) => item.id === input.assetId);
  if (!asset) throw new Error(`设备 ${input.assetId} 不存在`);
  if (!input.title.trim()) throw new Error("工单标题不能为空");
  if (!input.symptom.trim()) throw new Error("工单症状不能为空");

  const next = cloneState(state);
  const code = nextWorkOrderCode(seed, next);
  const by = input.createdBy ?? "当前用户（模拟）";
  const alarm = input.alarmId
    ? mergeById(seed.alarms, state.alarms).find((item) => item.id === input.alarmId)
    : undefined;
  if (input.alarmId && !alarm) throw new Error(`告警 ${input.alarmId} 不存在`);

  const draft: WorkOrder = {
    id: code.toLowerCase(),
    code,
    title: input.title.trim(),
    assetId: asset.id,
    source: input.source ?? "manual",
    alarmId: input.alarmId,
    triggerSnapshot: input.triggerSnapshot,
    evidenceIds: input.evidenceIds ? [...input.evidenceIds] : [],
    symptom: input.symptom.trim(),
    suggestion: input.suggestion.trim(),
    status: "draft",
    priority: input.priority ?? "medium",
    createdBy: by,
    createdAt: seed.referenceTime,
    history: [{ at: seed.referenceTime, action: "create", by, note: "创建工单草稿。" }],
  };

  next.workorders = [...next.workorders, draft];
  if (alarm) {
    next.alarms = [
      ...next.alarms.filter((item) => item.id !== alarm.id),
      { ...alarm, workOrderId: draft.id },
    ];
  }
  next.audits = [
    ...next.audits,
    makeAudit(
      seed,
      next,
      actorRole,
      "workorder:create",
      "workOrder",
      draft.id,
      `创建工单草稿 ${code}：${draft.title}`,
      undefined,
      JSON.stringify({ code, assetId: asset.id, source: draft.source }),
    ),
  ];
  return { state: next, draft };
}

const TRANSITIONS: Record<
  WorkOrderAction,
  { from: WorkOrder["status"]; to: WorkOrder["status"] }
> = {
  submit: { from: "draft", to: "pending_dispatch" },
  start: { from: "pending_dispatch", to: "in_progress" },
  complete: { from: "in_progress", to: "pending_acceptance" },
  accept: { from: "pending_acceptance", to: "archived" },
  reject: { from: "pending_acceptance", to: "in_progress" },
  cancel: { from: "draft", to: "cancelled" },
};

function isTerminal(status: WorkOrder["status"]): boolean {
  return status === "archived" || status === "cancelled";
}

export function transitionWorkOrder(
  seed: ScenarioSeed,
  state: UserState,
  workOrderId: string,
  action: WorkOrderAction,
  actorRole: Role,
  payload?: WorkOrderTransitionPayload,
): UserState {
  const orders = mergeById(seed.workorders, state.workorders);
  const order = orders.find((item) => item.id === workOrderId);
  if (!order) throw new Error(`工单 ${workOrderId} 不存在`);

  const canCancel = action === "cancel" && !isTerminal(order.status);
  const rule = TRANSITIONS[action];
  const allowed = canCancel || order.status === rule.from;
  if (!allowed) {
    throw new Error(
      `工单 ${order.code} 当前状态 ${order.status} 不能执行 ${action}`,
    );
  }

  const next = cloneState(state);
  const target = next.workorders.find((item) => item.id === workOrderId) ?? {
    ...order,
    history: [...order.history],
  };
  const by = payload?.by ?? "当前用户（模拟）";
  const now = seed.referenceTime;
  const note = payload?.note;

  const updated: WorkOrder = {
    ...target,
    status: canCancel ? "cancelled" : rule.to,
    assignee: payload?.assignee ?? target.assignee,
    history: [
      ...target.history,
      {
        at: now,
        action: canCancel ? "cancel" : action,
        by,
        note: note ?? actionNote(action),
      },
    ],
  };

  if (action === "complete") {
    const source = payload?.result ?? target.result;
    if (!source?.cause || !source?.measures) {
      throw new Error("提交维修结果需要填写原因与处理措施");
    }
    updated.result = {
      cause: source.cause,
      measures: source.measures,
      materials: source.materials,
      note: source.note,
      submittedAt: now,
      submittedBy: by,
    };
  }

  if (action === "accept") {
    updated.acceptance = {
      accepted: true,
      at: now,
      by: payload?.acceptance?.by ?? by,
      note: payload?.acceptance?.note ?? note,
    };
    const maintenance = {
      id: `MNT-${order.code}-ACCEPT`,
      assetId: order.assetId,
      kind: "repair" as const,
      at: now,
      summary: `${order.title} 验收通过：${updated.result?.measures ?? "按工单处理"}`,
      materials: updated.result?.materials,
      workOrderId: order.id,
    };
    if (!next.maintenance.some((item) => item.id === maintenance.id)) {
      next.maintenance = [...next.maintenance, maintenance];
    }
    // Crucial separation: work order acceptance records maintenance, but does
    // not prove physical alarm recovery. Alarm closure is a separate human,
    // evidence-annotated command with its own role and audit.
  }

  if (action === "reject") {
    updated.acceptance = {
      accepted: false,
      at: now,
      by: payload?.acceptance?.by ?? by,
      note: payload?.acceptance?.note ?? note,
    };
  }

  next.workorders = [
    ...next.workorders.filter((item) => item.id !== workOrderId),
    updated,
  ];
  next.audits = [
    ...next.audits,
    makeAudit(
      seed,
      next,
      actorRole,
      `workorder:${action}`,
      "workOrder",
      order.id,
      `${order.code} 状态 ${order.status} → ${updated.status}`,
      JSON.stringify({ status: order.status }),
      JSON.stringify({ status: updated.status }),
    ),
  ];
  return next;
}

function actionNote(action: WorkOrderAction): string {
  switch (action) {
    case "submit":
      return "提交待派单。";
    case "start":
      return "接单开始处理。";
    case "complete":
      return "提交处理结果，待验收。";
    case "accept":
      return "验收通过并归档。";
    case "reject":
      return "验收不通过，退回维修中。";
    case "cancel":
      return "工单取消。";
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case "MOCK":
      return "模拟数据";
    case "REFERENCE":
      return "资料引用";
    case "USER_ENTRY":
      return "人工录入";
    case "CALCULATED":
      return "规则计算";
    default:
      return "未知来源";
  }
}

export function deriveTimeline(
  seed: ScenarioSeed,
  state: UserState,
  assetId: string,
): TimelineEvent[] {
  const asset = allAssets(seed, state).find((item) => item.id === assetId);
  if (!asset) return [];

  const events: Omit<TimelineEvent, "id">[] = [];
  const seedWorkOrderHistory = new Map(
    seed.workorders.map((item) => [item.id, item.history.length]),
  );
  const seedMaintenanceIds = new Set(seed.maintenance.map((item) => item.id));

  events.push({
    assetId,
    at: asset.installedAt
      ? `${asset.installedAt}T00:00:00+08:00`
      : seed.referenceTime,
    type: "config",
    summary: `设备建档：${asset.name}（${asset.code}）`,
    source: asset.source,
    dataLabel: sourceLabel(asset.source),
  });

  for (const alarm of mergeById(seed.alarms, state.alarms)) {
    if (alarm.assetId !== assetId) continue;
    events.push({
      assetId,
      at: alarm.occurredAt,
      type: "alarm",
      summary: `告警：${alarm.title}`,
      sourceId: alarm.id,
      source: "MOCK",
      dataLabel: "模拟告警",
    });
  }

  for (const order of mergeById(seed.workorders, state.workorders)) {
    if (order.assetId !== assetId) continue;
    const seedHistoryLength = seedWorkOrderHistory.get(order.id);
    order.history.forEach((entry, index) => {
      const fromSeed = seedHistoryLength !== undefined && index < seedHistoryLength;
      const source = fromSeed ? "MOCK" : "USER_ENTRY";
      events.push({
        assetId,
        at: entry.at,
        type: "workorder",
        summary: `${order.code} ${entry.action}${entry.note ? `：${entry.note}` : ""}`,
        actor: entry.by,
        sourceId: order.id,
        source,
        dataLabel: sourceLabel(source),
      });
    });
  }

  for (const record of mergeById(seed.inspections, state.inspections)) {
    if (record.assetId !== assetId) continue;
    events.push({
      assetId,
      at: record.inspectedAt,
      type: "inspection",
      summary: `巡检记录：${record.result === "normal" ? "正常" : "发现异常"}（${record.inspector}）`,
      actor: record.inspector,
      sourceId: record.id,
      source: "MOCK",
      dataLabel: "模拟巡检",
    });
  }

  for (const record of mergeById(seed.maintenance, state.maintenance)) {
    if (record.assetId !== assetId) continue;
    const source = seedMaintenanceIds.has(record.id) ? "MOCK" : "USER_ENTRY";
    events.push({
      assetId,
      at: record.at,
      type: "maintenance",
      summary: `维保：${record.summary}`,
      sourceId: record.id,
      source,
      dataLabel: sourceLabel(source),
    });
  }

  for (const doc of mergeById(seed.documents, state.documents)) {
    if (!doc.assetIds.includes(assetId)) continue;
    events.push({
      assetId,
      at: doc.updatedAt,
      type: "document",
      summary: `档案：${doc.title}（${doc.reviewed ? "已审核" : "未审核"}）`,
      sourceId: doc.id,
      source: doc.source === "demo" ? "REFERENCE" : "USER_ENTRY",
      dataLabel: doc.source === "demo" ? "模拟档案" : "人工上传",
    });
  }

  const removed = new Set(state.removedDocumentIds);
  return events
    .filter((event) => !(event.type === "document" && event.sourceId && removed.has(event.sourceId)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((event, index) => ({
      ...event,
      id: `tl-${assetId}-${event.type}-${index}`,
    }));
}

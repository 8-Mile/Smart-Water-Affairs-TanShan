import { rainStorage } from "./water";
import { cloneDiagram, defaultSprayDiagram, migrateSprayEquipment, nextSprayPosition, validateDiagram } from "./diagram";
import type { ProcessDiagram, SceneHotspot } from "./diagram";
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  addPointChangeSet,
  createAssetChangeSet,
  createWorkOrderDraft,
  deriveTimeline,
  emptyUserState,
  moveBindingChangeSet,
  transitionWorkOrder,
} from "./commands";
import type {
  AssetDraft,
  BindingDraft,
  PointDraft,
  WorkOrderAction,
  WorkOrderInput,
  WorkOrderTransitionPayload,
} from "./commands";
import { assertCan } from "./permissions";
import { buildSeed, SEED_VERSION } from "./seed";
import { getLatestSample, getPointSeries } from "./series";
import type {
  AgentRun,
  Alarm,
  Asset,
  AuditEvent,
  Dashboard,
  DocumentRef,
  InspectionRecord,
  Kpi,
  MaintenanceRecord,
  MeasurePoint,
  ProcessBinding,
  Role,
  ScenarioId,
  ScenarioSeed,
  UserState,
  WorkOrder,
} from "./types";

const STORAGE_KEY = "tanggang-demo-state-v1";
const ROLE_KEY = "tanggang-demo-role";
const DIAGRAM_KEY = "tanggang-process-diagrams-v1";
const HOTSPOT_KEY = "tanggang-scene-hotspots-v1";
const USER_ID = "demo-user";

const SCENARIOS: ScenarioId[] = [
  "SCN-NORMAL",
  "SCN-PUMP-FAULT",
  "SCN-RAIN",
  "SCN-MINING",
  "SCN-YARD-STOP",
];

interface PersistedState {
  version: 1;
  scenarioId: ScenarioId;
  globalDashboards: Dashboard[];
  scenarios: Partial<Record<ScenarioId, UserState>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && SCENARIOS.includes(value as ScenarioId);
}

function isRole(value: unknown): value is Role {
  return (
    value === "manager" ||
    value === "duty" ||
    value === "engineer" ||
    value === "water" ||
    value === "admin" ||
    value === "viewer"
  );
}

function isUserState(value: unknown): value is UserState {
  return (
    isRecord(value) &&
    Array.isArray(value.assets) &&
    Array.isArray(value.points) &&
    Array.isArray(value.bindings) &&
    Array.isArray(value.documents) &&
    Array.isArray(value.removedDocumentIds) &&
    Array.isArray(value.alarms) &&
    Array.isArray(value.workorders) &&
    Array.isArray(value.inspections) &&
    Array.isArray(value.maintenance) &&
    Array.isArray(value.dashboards) &&
    Array.isArray(value.audits) &&
    Array.isArray(value.agentRuns)
  );
}

function isPersistedState(value: unknown): value is PersistedState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isScenarioId(value.scenarioId) &&
    Array.isArray(value.globalDashboards) &&
    isRecord(value.scenarios)
  );
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // 本地存储不可用时保持内存态，演示不中断。
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of base) merged.set(item.id, item);
  for (const item of extra) merged.set(item.id, item);
  return [...merged.values()];
}

function auditId(state: UserState): string {
  let max = 0;
  for (const audit of state.audits) {
    const match = /AUD-(\d+)/.exec(audit.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `AUD-${String(max + 1).padStart(6, "0")}`;
}

function pushAudit(
  state: UserState,
  actorRole: Role,
  action: string,
  objectType: string,
  objectId: string,
  summary: string,
  at: string,
): void {
  const id = auditId(state);
  const event: AuditEvent = {
    id,
    at,
    actorRole,
    action,
    objectType,
    objectId,
    summary,
    requestId: `REQ-${id.slice(4)}`,
  };
  state.audits = [...state.audits, event];
}

export const useDemoStore = defineStore("demo", () => {
  const role = ref<Role>("manager");
  const scenarioId = ref<ScenarioId>("SCN-NORMAL");
  const seedVersion = ref(SEED_VERSION);
  const userState = ref<UserState>(emptyUserState());
  const hydrated = ref(false);
  const buckets = ref<Partial<Record<ScenarioId, UserState>>>({});
  const diagrams = ref<Record<string, { published: ProcessDiagram; draft?: ProcessDiagram; history: ProcessDiagram[] }>>({});
  const sceneHotspots = ref<SceneHotspot[]>([]);
  try {
    const raw = readStorage(DIAGRAM_KEY);
    if (raw) diagrams.value = JSON.parse(raw);
  } catch { diagrams.value = {}; }
  try { sceneHotspots.value = JSON.parse(readStorage(HOTSPOT_KEY) ?? '[]'); } catch { sceneHotspots.value = []; }
  let globalDashboards: Dashboard[] = [];

  function emptyForCurrent(): UserState {
    const state = emptyUserState();
    state.dashboards = clone(globalDashboards);
    return state;
  }

  function hydrate(): void {
    const storedRole = readStorage(ROLE_KEY);
    if (isRole(storedRole)) role.value = storedRole;

    const raw = readStorage(STORAGE_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isPersistedState(parsed)) {
          scenarioId.value = parsed.scenarioId;
          globalDashboards = parsed.globalDashboards;
          const restored: Partial<Record<ScenarioId, UserState>> = {};
          for (const id of SCENARIOS) {
            const bucket = parsed.scenarios[id];
            if (isUserState(bucket)) restored[id] = bucket;
          }
          buckets.value = restored;
          const current = restored[scenarioId.value];
          userState.value = current
            ? { ...clone(current), dashboards: clone(globalDashboards) }
            : emptyForCurrent();
        }
      } catch {
        userState.value = emptyUserState();
      }
    }
    seedVersion.value = buildSeed(scenarioId.value).seedVersion;
    hydrated.value = true;
  }

  function save(): void {
    buckets.value = { ...buckets.value, [scenarioId.value]: clone(userState.value) };
    globalDashboards = clone(userState.value.dashboards);
    const payload: PersistedState = {
      version: 1,
      scenarioId: scenarioId.value,
      globalDashboards,
      scenarios: buckets.value,
    };
    writeStorage(STORAGE_KEY, JSON.stringify(payload));
    writeStorage(ROLE_KEY, role.value);
  }

  function applyScenario(id: ScenarioId): void {
    if (id === scenarioId.value) return;
    buckets.value = { ...buckets.value, [scenarioId.value]: clone(userState.value) };
    scenarioId.value = id;
    const bucket = buckets.value[id];
    const previous = userState.value;
    userState.value = bucket
      ? { ...clone(bucket), dashboards: clone(globalDashboards) }
      : emptyForCurrent();
    userState.value.assets = mergeById(userState.value.assets, previous.assets);
    userState.value.points = mergeById(userState.value.points, previous.points);
    userState.value.bindings = mergeById(userState.value.bindings, previous.bindings);
    seedVersion.value = buildSeed(id).seedVersion;
    save();
  }

  const seed = computed<ScenarioSeed>(() => buildSeed(scenarioId.value));
  const assets = computed<Asset[]>(() =>
    mergeById(seed.value.assets, userState.value.assets),
  );
  const points = computed<MeasurePoint[]>(() =>
    mergeById(seed.value.points, userState.value.points),
  );
  const bindings = computed<ProcessBinding[]>(() =>
    mergeById(seed.value.bindings, userState.value.bindings),
  );
  function persistDiagrams(): void { writeStorage(DIAGRAM_KEY, JSON.stringify(diagrams.value)); }
  function sprayDiagram(): ProcessDiagram {
    const record = diagrams.value.spray;
    return migrateSprayEquipment(cloneDiagram(record?.published ?? defaultSprayDiagram(assets.value)));
  }
  function sprayDraft(): ProcessDiagram {
    const record = diagrams.value.spray;
    return migrateSprayEquipment(cloneDiagram(record?.draft ?? record?.published ?? defaultSprayDiagram(assets.value)));
  }
  function saveSprayDraft(next: ProcessDiagram): void {
    assertCan(role.value, "binding:write");
    const published = diagrams.value.spray?.published ?? defaultSprayDiagram(assets.value);
    diagrams.value = { ...diagrams.value, spray: { published, history: diagrams.value.spray?.history ?? [cloneDiagram(published)], draft: { ...cloneDiagram(next), status: "draft" } } };
    persistDiagrams();
  }
  function publishSprayDiagram(): void {
    assertCan(role.value, "diagram:publish");
    const draft = diagrams.value.spray?.draft;
    if (!draft) throw new Error("请先保存草稿");
    const errors = validateDiagram(draft, assets.value, points.value);
    if (errors.length) throw new Error(errors.join("；"));
    const previous = diagrams.value.spray.published;
    const published = { ...cloneDiagram(draft), version: previous.version + 1, status: "published" as const };
    diagrams.value = { ...diagrams.value, spray: { published, history: [...diagrams.value.spray.history, cloneDiagram(published)] } };
    persistDiagrams();
    pushAudit(userState.value, role.value, "diagram:publish", "diagram", "diagram-spray", `发布射雾器组态 v${published.version}`, new Date().toISOString());
    save();
  }
  function discardSprayDraft(): void {
    assertCan(role.value, "binding:write");
    if (diagrams.value.spray) {
      const { published, history } = diagrams.value.spray;
      diagrams.value = { ...diagrams.value, spray: { published, history } };
      persistDiagrams();
    }
  }
  function restoreSprayVersion(version: number): void {
    assertCan(role.value, "diagram:publish");
    const found = diagrams.value.spray?.history.find(item => item.version === version);
    if (!found) throw new Error("历史版本不存在");
    saveSprayDraft(migrateSprayEquipment(found));
  }
  function upsertSceneHotspot(hotspot: SceneHotspot): void {
    assertCan(role.value, "scene:write");
    if (!assets.value.some(asset => asset.id === hotspot.assetId && !asset.archived)) throw new Error('绑定设备不存在');
    if (![hotspot.xPct, hotspot.yPct].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('热点坐标越界');
    sceneHotspots.value = [...sceneHotspots.value.filter(item => item.id !== hotspot.id), hotspot];
    writeStorage(HOTSPOT_KEY, JSON.stringify(sceneHotspots.value));
    pushAudit(userState.value, role.value, "scene:write", "hotspot", hotspot.id, `保存场景热点 ${hotspot.label ?? hotspot.assetId}`, new Date().toISOString());
    save();
  }
  function removeSceneHotspot(id: string): void {
    assertCan(role.value, "scene:write");
    sceneHotspots.value = sceneHotspots.value.filter(item => item.id !== id);
    writeStorage(HOTSPOT_KEY, JSON.stringify(sceneHotspots.value));
    pushAudit(userState.value, role.value, "scene:write", "hotspot", id, '删除场景热点', new Date().toISOString());
    save();
  }
  const documents = computed<DocumentRef[]>(() => {
    const removed = new Set(userState.value.removedDocumentIds);
    return mergeById(seed.value.documents, userState.value.documents).filter(
      (document) => !removed.has(document.id),
    );
  });
  const alarms = computed<Alarm[]>(() =>
    mergeById(seed.value.alarms, userState.value.alarms),
  );
  const workorders = computed<WorkOrder[]>(() =>
    mergeById(seed.value.workorders, userState.value.workorders),
  );
  const inspections = computed<InspectionRecord[]>(() =>
    mergeById(seed.value.inspections, userState.value.inspections),
  );
  const maintenance = computed<MaintenanceRecord[]>(() =>
    mergeById(seed.value.maintenance, userState.value.maintenance),
  );
  const dashboards = computed<Dashboard[]>(() =>
    userState.value.dashboards.filter(
      (dashboard) =>
        dashboard.scope === "position" || dashboard.ownerRole === role.value,
    ),
  );
  const audits = computed<AuditEvent[]>(() =>
    [...userState.value.audits].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  );
  const agentRuns = computed<AgentRun[]>(() =>
    [...userState.value.agentRuns].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    ),
  );
  const subsystems = computed(() => seed.value.subsystems);

  const kpis = computed<Kpi[]>(() => {
    const running = assets.value.filter((asset) => asset.status === "running").length;
    const activeAlarms = alarms.value.filter((alarm) => alarm.status === "active").length;
    const openOrders = workorders.value.filter(
      (order) => order.status !== "archived" && order.status !== "cancelled",
    ).length;
    const latestRain = seed.value.rainEvents[seed.value.rainEvents.length - 1];
    const storage = rainStorage(latestRain).end?.total ?? null;
    return [
      {
        label: "运行设备",
        value: running,
        unit: "台",
        formula: "status=running 的资产数量",
        source: "CALCULATED",
      },
      {
        label: "活动告警",
        value: activeAlarms,
        unit: "条",
        formula: "status=active 的告警数量",
        source: "CALCULATED",
      },
      {
        label: "待办工单",
        value: openOrders,
        unit: "单",
        formula: "status 不属于 archived/cancelled 的工单数量",
        source: "CALCULATED",
      },
      {
        label: "最近雨次末段储量",
        value: storage,
        unit: "m³",
        formula: "南北分区最后一个共同有效小时的储量合计",
        source: "CALCULATED",
      },
    ];
  });

  const attention = computed(() => ({
    alarms: alarms.value.filter((alarm) => alarm.status === "active").slice(0, 3),
    workorders: workorders.value
      .filter((order) => order.status !== "archived" && order.status !== "cancelled")
      .slice(0, 3),
    documents: documents.value.filter((doc) => !doc.reviewed).slice(0, 3),
  }));

  function setRole(next: Role): void {
    role.value = next;
    writeStorage(ROLE_KEY, next);
  }

  function switchScenario(id: ScenarioId): void {
    assertCan(role.value, "scenario:write");
    applyScenario(id);
  }

  function setScenario(id: ScenarioId): void {
    assertCan(role.value, "scenario:write");
    applyScenario(id);
  }

  function resetScenario(): void {
    assertCan(role.value, "scenario:write");
    const { documents, removedDocumentIds, assets, points, bindings } = userState.value;
    userState.value = {
      ...emptyForCurrent(),
      documents: clone(documents),
      removedDocumentIds: [...removedDocumentIds],
      assets: clone(assets),
      points: clone(points),
      bindings: clone(bindings),
    };
    seedVersion.value = buildSeed(scenarioId.value).seedVersion;
    save();
  }

  function commitAssetDraft(draft: AssetDraft): UserState {
    assertCan(role.value, "asset:create");
    const next = createAssetChangeSet(seed.value, userState.value, draft, role.value);
    userState.value = next;
    save();
    if (draft.subsystemId === "spray" && draft.binding) {
      const asset = next.assets.find(item => item.code === draft.code.trim());
      if (asset) {
        const diagram = sprayDraft();
        const zone = draft.binding.yPct >= 0.5 ? "B" : "A";
        const position = nextSprayPosition(diagram.nodes, zone);
        diagram.viewBox.width = Math.max(diagram.viewBox.width, position.x + 130);
        diagram.nodes.push({ id: `node-${asset.id}`, assetId: asset.id, symbolId: "fog_cannon", position, size: { width: 91, height: 98 }, pointBindings: next.points.filter(point => point.assetId === asset.id).map(point => ({ pointId: point.id, displayRole: "detail" })), label: asset.code, visible: true });
        saveSprayDraft(diagram);
      }
    }
    return next;
  }

  function addPoint(assetId: string, draft: PointDraft): UserState {
    assertCan(role.value, "point:add");
    const next = addPointChangeSet(seed.value, userState.value, assetId, draft, role.value);
    userState.value = next;
    save();
    return next;
  }

  function bindAsset(assetId: string, binding: BindingDraft): UserState {
    assertCan(role.value, "binding:write");
    const next = moveBindingChangeSet(seed.value, userState.value, assetId, binding, role.value);
    userState.value = next;
    save();
    return next;
  }

  function createWorkOrder(input: WorkOrderInput): WorkOrder {
    assertCan(role.value, "workorder:create");
    const result = createWorkOrderDraft(seed.value, userState.value, input, role.value);
    userState.value = result.state;
    save();
    return result.draft;
  }

  function workOrderAction(
    id: string,
    action: WorkOrderAction,
    payload?: WorkOrderTransitionPayload,
  ): UserState {
    const required =
      action === "accept" || action === "reject"
        ? "workorder:accept"
        : action === "submit" || action === "cancel"
          ? "workorder:create"
          : "workorder:handle";
    assertCan(role.value, required);
    const next = transitionWorkOrder(
      seed.value,
      userState.value,
      id,
      action,
      role.value,
      payload,
    );
    userState.value = next;
    save();
    return next;
  }

  function ackAlarm(id: string): UserState {
    assertCan(role.value, "alarm:ack");
    const alarm = alarms.value.find((item) => item.id === id);
    if (!alarm) throw new Error(`告警 ${id} 不存在`);
    if (alarm.status !== "active") throw new Error("该告警不是活动状态，不可重复确认或复活。");
    const next = clone(userState.value);
    next.alarms = [
      ...next.alarms.filter((item) => item.id !== id),
      { ...alarm, status: "acknowledged" },
    ];
    pushAudit(
      next,
      role.value,
      "alarm:ack",
      "alarm",
      id,
      `确认告警 ${alarm.code}：${alarm.title}`,
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  /**
   * A work order can be archived without proving alarm recovery.
   * Only a separate manager/admin action may close a previously acknowledged
   * simulated alarm, with explicit manual evidence reference and audit note.
   */
  function closeAlarmWithReview(
    id: string,
    payload: { evidenceRef: string; note: string },
  ): UserState {
    assertCan(role.value, "alarm:close");
    const alarm = alarms.value.find((item) => item.id === id);
    if (!alarm) throw new Error("原始告警不存在，不能关闭。");
    if (alarm.status !== "acknowledged") {
      throw new Error("请先由值班人员确认告警，已关闭告警不可重复操作。");
    }
    const evidenceRef = payload.evidenceRef.trim();
    const note = payload.note.trim();
    if (evidenceRef.length < 3 || note.length < 5) {
      throw new Error("请输入核查依据编号（至少3字）和核查情况（至少5字）。");
    }
    if (evidenceRef.length > 160 || note.length > 800) {
      throw new Error("核查编号或说明过长，请整理为简明的有效引用与情况描述。");
    }
    if (alarm.workOrderId) {
      const related = workorders.value.find((item) => item.id === alarm.workOrderId);
      if (!related) throw new Error("原关联工单不存在，不允许绕过失效引用关闭告警。");
      if (related.assetId !== alarm.assetId) throw new Error("原工单关联的设备不一致，禁止关闭。");
      if (related.status !== "archived") throw new Error("原关联工单未验收归档，不能关闭告警。");
    }
    const next = clone(userState.value);
    next.alarms = [
      ...next.alarms.filter((item) => item.id !== id),
      { ...alarm, status: "closed" as const },
    ];
    pushAudit(
      next, role.value, "alarm:close", "alarm", id,
      "人工核查关闭告警（DEMO，非现场恢复认证）：依据 "+evidenceRef+"；情况 "+note,
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  function recordAgentRun(run: AgentRun): UserState {
    assertCan(role.value, "ai:ask");
    const next = clone(userState.value);
    next.agentRuns = [...next.agentRuns.filter((item) => item.id !== run.id), run];
    pushAudit(
      next,
      role.value,
      "ai:run",
      "agentRun",
      run.id,
      `记录 Agent 任务：${run.title}`,
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  function saveDashboard(dashboard: Dashboard): Dashboard {
    assertCan(role.value, "dashboard:edit:self");
    const next = clone(userState.value);
    const existing = next.dashboards.find((item) => item.id === dashboard.id);
    if (existing && existing.ownerRole !== role.value && role.value !== "admin") {
      throw new Error("只能修改本人保存的看板");
    }
    const now = seed.value.referenceTime;
    const history = existing ? [...(existing.history ?? [])] : [...(dashboard.history ?? [])];
    if (existing) {
      history.push({
        version: existing.version,
        savedAt: existing.updatedAt,
        widgets: clone(existing.widgets),
      });
    }
    const saved: Dashboard = {
      ...clone(dashboard),
      ownerId: existing?.ownerId ?? dashboard.ownerId ?? USER_ID,
      ownerRole: existing?.ownerRole ?? role.value,
      version: existing ? existing.version + 1 : dashboard.version,
      createdAt: existing?.createdAt ?? dashboard.createdAt,
      updatedAt: now,
      history,
    };
    next.dashboards = [...next.dashboards.filter((item) => item.id !== saved.id), saved];
    pushAudit(
      next,
      role.value,
      "dashboard:save",
      "dashboard",
      saved.id,
      `保存个人看板「${saved.name}」v${saved.version}`,
      now,
    );
    userState.value = next;
    save();
    return saved;
  }

  function deleteDashboard(id: string): UserState {
    assertCan(role.value, "dashboard:edit:self");
    const dashboard = userState.value.dashboards.find((item) => item.id === id);
    if (!dashboard) throw new Error(`看板 ${id} 不存在`);
    if (dashboard.ownerRole !== role.value && role.value !== "admin") {
      throw new Error("只能删除本人保存的看板");
    }
    const next = clone(userState.value);
    next.dashboards = next.dashboards.filter((item) => item.id !== id);
    pushAudit(
      next,
      role.value,
      "dashboard:delete",
      "dashboard",
      id,
      `删除个人看板「${dashboard.name}」`,
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  function restoreDashboard(id: string, version: number): Dashboard {
    assertCan(role.value, "dashboard:edit:self");
    const dashboard = userState.value.dashboards.find((item) => item.id === id);
    if (!dashboard) throw new Error(`看板 ${id} 不存在`);
    if (dashboard.ownerRole !== role.value && role.value !== "admin") {
      throw new Error("只能恢复本人保存的看板");
    }
    const target = (dashboard.history ?? []).find((item) => item.version === version);
    if (!target) throw new Error(`看板 ${id} 不存在版本 ${version}`);
    const now = seed.value.referenceTime;
    const next = clone(userState.value);
    const history = [...(dashboard.history ?? []), {
      version: dashboard.version,
      savedAt: dashboard.updatedAt,
      widgets: clone(dashboard.widgets),
    }];
    const restored: Dashboard = {
      ...dashboard,
      widgets: clone(target.widgets),
      version: dashboard.version + 1,
      updatedAt: now,
      history,
    };
    next.dashboards = [...next.dashboards.filter((item) => item.id !== id), restored];
    pushAudit(
      next,
      role.value,
      "dashboard:restore",
      "dashboard",
      id,
      `恢复看板「${dashboard.name}」至 v${version}`,
      now,
    );
    userState.value = next;
    save();
    return restored;
  }

  function importDocument(doc: DocumentRef): UserState {
    assertCan(role.value, "document:attach");
    const next = clone(userState.value);
    const imported: DocumentRef = {
      ...clone(doc),
      source: "user-upload",
      sourceLabel: doc.sourceLabel || "用户导入",
      unavailable: false,
    };
    next.documents = [...next.documents.filter((item) => item.id !== imported.id), imported];
    next.removedDocumentIds = next.removedDocumentIds.filter((item) => item !== imported.id);
    pushAudit(
      next,
      role.value,
      "document:attach",
      "document",
      imported.id,
      `导入档案「${imported.title}」`,
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  /** 对用户导入摘录做演示业务审核；不能批准种子图纸或不可核实全文的文件。 */
  function reviewImportedDocument(
    id: string, version: string, section: string, note: string,
  ): DocumentRef {
    assertCan(role.value, "document:review");
    const source = documents.value.find(doc => doc.id === id);
    if (!source || source.source !== "user-upload") throw new Error("仅支持审核用户自主导入的资料摘录");
    if (source.reviewed) throw new Error("资料已经演示审核，后续修订请作为新版本导入");
    if (source.unavailable || !source.contentExcerpt?.trim()) throw new Error("缺少可检查的原文摘录；超限或无文本文件不能审核");
    const v=version.trim(), sec=section.trim(), reason=note.trim();
    if (v.length < 2 || v.length > 60 || v === "导入-1") throw new Error("请填写来源文件的实际版号，不能沿用默认导入标识");
    if (sec.length < 4 || sec.length > 160 || sec.includes("未解析")) throw new Error("请填写实际可定位的原始章节/条款位置");
    if (reason.length < 8 || reason.length > 300) throw new Error("请填写至少8字的审核意见及设备适用条件");
    const reviewed:DocumentRef={
      ...source,version:v,lineOrSection:sec,
      reviewed:true,reviewedBy:role.value,reviewedAt:new Date().toISOString(),reviewNote:reason,
    };
    const next=clone(userState.value);
    next.documents=[...next.documents.filter(x=>x.id!==id),reviewed];
    pushAudit(next,role.value,"document:review","document",id,
      `演示审核摘录 ${id}（${v} / ${sec}），不代表厂家或正式工程审核：${reason}`,new Date().toISOString());
    userState.value=next;save();
    return reviewed;
  }
  function deleteDocument(id: string): UserState {
    assertCan(role.value, "document:attach");
    if (!documents.value.some((doc) => doc.id === id)) {
      throw new Error(`档案 ${id} 不存在`);
    }
    const next = clone(userState.value);
    next.documents = next.documents.filter((item) => item.id !== id);
    if (!next.removedDocumentIds.includes(id)) next.removedDocumentIds.push(id);
    pushAudit(
      next,
      role.value,
      "document:delete",
      "document",
      id,
      `删除档案引用 ${id}`,
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  function addInspection(record: InspectionRecord): UserState {
    assertCan(role.value, "workorder:handle");
    const next = clone(userState.value);
    next.inspections = [...next.inspections.filter((item) => item.id !== record.id), record];
    pushAudit(
      next,
      role.value,
      "inspection:create",
      "inspection",
      record.id,
      `新增巡检记录 ${record.id}`,
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  function exportUserState(): string {
    return JSON.stringify(userState.value, null, 2);
  }

  function importUserState(json: string): UserState {
    assertCan(role.value, "admin:write");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("导入内容不是合法 JSON");
    }
    if (!isUserState(parsed)) throw new Error("导入内容缺少必需的数据字段");
    const next: UserState = { ...clone(parsed), dashboards: clone(parsed.dashboards) };
    pushAudit(
      next,
      role.value,
      "admin:write",
      "userState",
      USER_ID,
      "导入本地演示配置",
      seed.value.referenceTime,
    );
    userState.value = next;
    save();
    return next;
  }

  function timeline(assetId: string) {
    return deriveTimeline(seed.value, userState.value, assetId);
  }

  function series(pointId: string, from: string, to: string) {
    return getPointSeries(
      { ...seed.value, points: points.value },
      pointId,
      from,
      to,
    );
  }

  function latest(pointId: string) {
    return getLatestSample({ ...seed.value, points: points.value }, pointId);
  }

  function getAsset(id: string): Asset | undefined {
    return assets.value.find((asset) => asset.id === id);
  }

  function getPoints(assetId: string): MeasurePoint[] {
    return points.value.filter((point) => point.assetId === assetId);
  }

  hydrate();

  return {
    role,
    scenarioId,
    seedVersion,
    userState,
    hydrated,
    seed,
    assets,
    points,
    bindings,
    documents,
    alarms,
    workorders,
    inspections,
    maintenance,
    dashboards,
    audits,
    agentRuns,
    subsystems,
    kpis,
    attention,
    setRole,
    switchScenario,
    setScenario,
    resetScenario,
    commitAssetDraft,
    addPoint,
    bindAsset,
    createWorkOrder,
    workOrderAction,
    ackAlarm,
    closeAlarmWithReview,
    recordAgentRun,
    saveDashboard,
    deleteDashboard,
    restoreDashboard,
    importDocument,
    reviewImportedDocument,
    deleteDocument,
    addInspection,
    exportUserState,
    importUserState,
    timeline,
    series,
    latest,
    getAsset,
    getPoints,
    diagrams,
    sprayDiagram,
    sprayDraft,
    saveSprayDraft,
    publishSprayDiagram,
    discardSprayDraft,
    restoreSprayVersion,
    sceneHotspots,
    upsertSceneHotspot,
    removeSceneHotspot,
  };
});

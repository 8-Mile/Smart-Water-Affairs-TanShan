import type { RainRunParams } from "./water";
export type DataSource = "MOCK" | "REFERENCE" | "USER_ENTRY" | "CALCULATED";

export type Quality = "valid" | "missing" | "estimated" | "invalid";

export type Role = "manager" | "duty" | "engineer" | "water" | "admin" | "viewer";

export type ScenarioId = "SCN-NORMAL" | "SCN-PUMP-FAULT" | "SCN-RAIN" | "SCN-MINING" | "SCN-YARD-STOP";

export type AssetStatus = "running" | "stopped" | "fault" | "unknown";

export interface Asset {
  id: string;
  code: string;
  name: string;
  subsystemId: string;
  processNodeId?: string;
  type: string;
  rated?: { powerKw?: number; flowM3h?: number; headM?: number };
  status: AssetStatus;
  source: DataSource;
  area: "north" | "south";
  runtimeHours: number;
  startCount: number;
  manufacturer?: string;
  model?: string;
  owner?: string;
  installedAt?: string;
  archived: boolean;
  condition?: string;
}

export interface MeasurePoint {
  id: string;
  assetId: string;
  label: string;
  kind: "number" | "enum";
  unit?: string;
  range?: [number, number];
  source: DataSource;
  quality: Quality;
  samplePeriodMinutes: number;
  baseline?: number;
  volatility?: number;
  enumStates?: string[];
}

export interface TelemetrySample {
  pointId: string;
  at: string;
  value: number | string | null;
  quality: Quality;
  source: DataSource;
}

export interface ProcessBinding {
  id: string;
  subsystemId: string;
  assetId: string;
  backgroundId: string;
  xPct: number;
  yPct: number;
  nodeId?: string;
  label?: string;
  verifiedPhysicalLink: false;
}

export interface DocumentRef {
  id: string;
  title: string;
  version: string;
  assetIds: string[];
  kind:
    | "manual"
    | "procedure"
    | "inspection-standard"
    | "drawing"
    | "certificate"
    | "case"
    | "other";
  reviewed: boolean;
  source: "demo" | "user-upload";
  sourceLabel: string;
  updatedAt: string;
  summary?: string;
  contentExcerpt?: string;
  lineOrSection?: string;
  reviewedBy?: Role;
  reviewedAt?: string;
  reviewNote?: string;
  fileType?: string;
  unavailable?: boolean;
}

export type AlarmLevel = "critical" | "warning" | "info";

export interface Alarm {
  id: string;
  code: string;
  assetId: string;
  pointId?: string;
  subsystemId: string;
  level: AlarmLevel;
  kind: "production" | "business";
  title: string;
  detail: string;
  occurredAt: string;
  status: "active" | "acknowledged" | "closed";
  workOrderId?: string;
  recoveryReview?: {
    evidenceRef:string;note:string;metric:string;before:string;after:string;
    unit:string;recordedAt:string;source:"USER_ENTRY";status:"reported-recovered";
    reviewer:Role;
  };
}

export interface InspectionRecord {
  id: string;
  assetId: string;
  inspectedAt: string;
  inspector: string;
  items: { label: string; value: string; abnormal: boolean }[];
  result: "normal" | "abnormal";
  note?: string;
  attachmentRefs?: string[];
}

export interface MaintenanceRecord {
  id: string;
  assetId: string;
  kind: "maintenance" | "repair";
  at: string;
  summary: string;
  materials?: string;
  workOrderId?: string;
}

export type WorkOrderStatus =
  | "draft"
  | "pending_dispatch"
  | "in_progress"
  | "pending_acceptance"
  | "archived"
  | "cancelled";

export type WorkOrderPriority = "low" | "medium" | "high" | "urgent";

export interface WorkOrder {
  id: string;
  code: string;
  title: string;
  assetId: string;
  source: "alarm" | "inspection" | "manual" | "health_trend";
  alarmId?: string;
  triggerSnapshot?: {
    rangeFrom: string;
    rangeTo: string;
    pointId: string;
    threshold: number;
  };
  evidenceIds: string[];
  symptom: string;
  suggestion: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  createdBy: string;
  createdAt: string;
  assignee?: string;
  result?: {
    cause: string;
    measures: string;
    materials?: string;
    note?: string;
    submittedAt: string;
    submittedBy: string;
  };
  acceptance?: { accepted: boolean; at: string; by: string; note?: string };
  history: { at: string; action: string; by: string; note?: string }[];
}

export interface TimelineEvent {
  id: string;
  assetId: string;
  at: string;
  type:
    | "operation"
    | "alarm"
    | "workorder"
    | "inspection"
    | "maintenance"
    | "document"
    | "config";
  summary: string;
  actor?: string;
  sourceId?: string;
  source: DataSource;
  dataLabel: string;
}

export interface EvidenceRef {
  kind: "telemetry" | "alarm" | "workorder" | "document" | "inspection" | "asset";
  refId: string;
  label: string;
  detail?: string;
  source: DataSource;
}

export type AgentStepStatus =
  | "pending"
  | "running"
  | "done"
  | "blocked"
  | "failed"
  | "cancelled";

export interface AgentStep {
  id: string;
  agentName: string;
  action: string;
  tool?: string;
  inputSummary: string;
  outputSummary: string;
  status: AgentStepStatus;
  errorCode?: string;
  startedAt?: string;
  endedAt?: string;
  retryable?: boolean;
  /** 该步骤引用的可定位证据，界面据此提供跳转，不展示虚构思维链。 */
  evidence?: EvidenceRef[];
}

export type AgentTaskType = "create_asset" | "diagnose" | "compose_ui" | "other";

export type AgentRunStatus =
  | "running"
  | "awaiting_confirmation"
  | "done"
  | "failed"
  | "cancelled";

export interface AgentRun {
  id: string;
  taskType: AgentTaskType;
  title: string;
  prompt: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  context: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWidget {
  id: string;
  component: string;
  title: string;
  props: Record<string, unknown>;
  layout: { x: number; y: number; w: number; h: number };
  dataBinding?: {
    metricIds?: string[];
    rainEventIds?: string[];
    assetIds?: string[];
  };
}

export interface Dashboard {
  id: string;
  name: string;
  ownerId: string;
  ownerRole: Role;
  scope: "personal" | "position";
  widgets: DashboardWidget[];
  version: number;
  createdAt: string;
  updatedAt: string;
  history?: { version: number; savedAt: string; widgets: DashboardWidget[] }[];
}

export interface AuditEvent {
  id: string;
  at: string;
  actorRole: Role;
  action: string;
  objectType: string;
  objectId: string;
  summary: string;
  before?: string;
  after?: string;
  requestId: string;
}

export interface UserState {
  assets: Asset[];
  points: MeasurePoint[];
  bindings: ProcessBinding[];
  documents: DocumentRef[];
  removedDocumentIds: string[];
  alarms: Alarm[];
  workorders: WorkOrder[];
  inspections: InspectionRecord[];
  maintenance: MaintenanceRecord[];
  dashboards: Dashboard[];
  audits: AuditEvent[];
  agentRuns: AgentRun[];
}

export interface SubsystemSummary {
  id: string;
  name: string;
  description: string;
  metric: string;
  unit: string;
  base: number;
}

export interface RainEvent {
  id: string;
  name: string;
  occurredAt: string;
  rainfallMm: number;
  simulation?: { north: RainRunParams; south: RainRunParams; northOverflow: number; southOverflow: number };
  north: number[];
  south: number[];
  unit: string;
  source: DataSource;
}

export interface LedgerEntry {
  id: string;
  period: string;
  sourceType: string;
  direction: "in" | "out";
  volume: number;
  unit: string;
  note: string;
  source: DataSource;
}

export interface Kpi {
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  source: DataSource;
}

export interface ScenarioSeed {
  seedVersion: string;
  scenarioId: ScenarioId;
  referenceTime: string;
  subsystems: SubsystemSummary[];
  assets: Asset[];
  points: MeasurePoint[];
  bindings: ProcessBinding[];
  documents: DocumentRef[];
  alarms: Alarm[];
  workorders: WorkOrder[];
  inspections: InspectionRecord[];
  maintenance: MaintenanceRecord[];
  rainEvents: RainEvent[];
  ledger: LedgerEntry[];
  /** 首页日用水演示计量；与按月的进出水账本分别统计，不混加。 */
  dailyWater: DailyWaterRecord[];
}

export interface DailyWaterRecord {
  date: string;
  consumed: number;
  reused: number;
  supply: { rain: number; reclaimed: number; tap: number };
  source: "MOCK";
}

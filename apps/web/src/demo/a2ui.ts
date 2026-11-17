import { rainStorage } from "./water";
import { can, roleNames } from "./permissions";
import type { Action } from "./permissions";
import type {
  Dashboard,
  DashboardWidget,
  DataSource,
  MeasurePoint,
  Role,
  ScenarioSeed,
} from "./types";

/**
 * A2UI 演示消息层：本地生成、本地校验、本地渲染。
 * 不执行任意模板/HTML，不调用后端或大模型；所有组件与动作必须命中白名单。
 */

export const A2UI_CATALOG_ID = "water-dashboard-catalog-v1";
export const RAIN_SURFACE_ID = "surface-rain-storage";

export const A2UI_COMPONENTS = [
  "MetricCard",
  "TrendChart",
  "CompareChart",
  "DataTable",
  "AssetInfo",
  "HealthFactorCard",
  "EvidenceList",
  "WorkOrderReview",
  "ProcessPointPicker",
  "EmptyState",
] as const;

export type A2uiComponentName = (typeof A2UI_COMPONENTS)[number];

export const A2UI_COMPONENT_LABELS: Record<A2uiComponentName, string> = {
  MetricCard: "指标卡",
  TrendChart: "趋势图",
  CompareChart: "对比图",
  DataTable: "数据表",
  AssetInfo: "设备信息",
  HealthFactorCard: "健康因子",
  EvidenceList: "证据清单",
  WorkOrderReview: "工单复核",
  ProcessPointPicker: "测点选择",
  EmptyState: "空状态",
};

const COMPONENT_SET = new Set<string>(A2UI_COMPONENTS);

export function isA2uiComponentName(value: string): value is A2uiComponentName {
  return COMPONENT_SET.has(value);
}

export type A2uiErrorCode =
  | "INVALID_MESSAGE"
  | "UNKNOWN_COMPONENT"
  | "INVALID_PROPS"
  | "FORBIDDEN_ACTION"
  | "MISSING_DATA";

export interface A2uiError {
  code: A2uiErrorCode;
  message: string;
  path?: string;
}

export const A2UI_ACTIONS = [
  "openAsset",
  "openDocument",
  "openWorkOrder",
  "askAi",
  "saveDashboard",
] as const;

export type A2uiActionName = (typeof A2UI_ACTIONS)[number];

const ACTION_SET = new Set<string>(A2UI_ACTIONS);

export function isA2uiActionName(value: unknown): value is A2uiActionName {
  return typeof value === "string" && ACTION_SET.has(value);
}

export interface A2uiAction {
  kind: A2uiActionName;
  label?: string;
  payload?: Record<string, string>;
}

export interface A2uiComponent {
  id: string;
  component: string;
  props?: Record<string, unknown>;
  children?: string[];
}

export interface Surface {
  surfaceId: string;
  root: string;
  catalogId: string;
  components: A2uiComponent[];
  dataModel: Record<string, unknown>;
}

export type A2uiMessage =
  | {
      type: "createSurface";
      surface: {
        surfaceId: string;
        root: string;
        catalogId: string;
        dataModel?: Record<string, unknown>;
      };
    }
  | {
      type: "updateComponents";
      surfaceId: string;
      components: A2uiComponent[];
    }
  | {
      type: "updateDataModel";
      surfaceId: string;
      dataModel: Record<string, unknown>;
    }
  | { type: "deleteSurface"; surfaceId: string };

export interface A2uiResult {
  surface: Surface | null;
  errors: A2uiError[];
  rejected: boolean;
}

/* ------------------------------ 动作白名单 ------------------------------ */

const ACTION_PERMISSIONS: Record<A2uiActionName, Action> = {
  openAsset: "process:read",
  openDocument: "process:read",
  openWorkOrder: "process:read",
  askAi: "ai:ask",
  saveDashboard: "dashboard:edit:self",
};

const ACTION_PAYLOAD_KEYS: Record<A2uiActionName, string[]> = {
  openAsset: ["assetId"],
  openDocument: ["documentId"],
  openWorkOrder: ["workOrderId"],
  askAi: [],
  saveDashboard: [],
};

/* ------------------------------ 校验工具 ------------------------------ */

type PropCheck = (value: unknown, path: string) => A2uiError | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(path: string, message: string): A2uiError {
  return { code: "INVALID_PROPS", message, path };
}

function required(check: PropCheck): PropCheck {
  return (value, path) =>
    value === undefined ? fail(path, "缺少必填属性") : check(value, path);
}

function optional(check: PropCheck): PropCheck {
  return (value, path) => (value === undefined ? null : check(value, path));
}

const stringCheck: PropCheck = (value, path) =>
  typeof value === "string" && value.trim().length > 0
    ? null
    : fail(path, "应为非空字符串");

const numberCheck: PropCheck = (value, path) =>
  typeof value === "number" && Number.isFinite(value)
    ? null
    : fail(path, "应为有限数值");

const numberOrNullCheck: PropCheck = (value, path) =>
  value === null ? null : numberCheck(value, path);

const numberOrStringCheck: PropCheck = (value, path) =>
  (typeof value === "number" && Number.isFinite(value)) || typeof value === "string"
    ? null
    : fail(path, "应为数值或字符串");

const booleanCheck: PropCheck = (value, path) =>
  typeof value === "boolean" ? null : fail(path, "应为布尔值");

function enumCheck(values: readonly string[]): PropCheck {
  return (value, path) =>
    typeof value === "string" && values.includes(value)
      ? null
      : fail(path, `应为 ${values.join(" / ")} 之一`);
}

const stringArrayCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "应为字符串数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    if (typeof item !== "string") return fail(`${path}[${index}]`, "应为字符串");
  }
  return null;
};

const chartSeriesCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "应为系列数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) return fail(itemPath, "系列应为对象");
    if (typeof item.name !== "string" || !item.name.trim()) {
      return fail(`${itemPath}.name`, "系列名称应为非空字符串");
    }
    if (typeof item.unit !== "string") {
      return fail(`${itemPath}.unit`, "系列单位应为字符串");
    }
    if (!Array.isArray(item.values)) {
      return fail(`${itemPath}.values`, "系列数据应为数组");
    }
    const values: unknown[] = item.values;
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      const point: unknown = values[valueIndex];
      if (point !== null && (typeof point !== "number" || !Number.isFinite(point))) {
        return fail(`${itemPath}.values[${valueIndex}]`, "数值应为 number 或 null");
      }
    }
  }
  return null;
};

const tableColumnsCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "列定义应为数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) return fail(itemPath, "列定义应为对象");
    if (typeof item.key !== "string" || !item.key.trim()) {
      return fail(`${itemPath}.key`, "列 key 应为非空字符串");
    }
    if (typeof item.title !== "string" || !item.title.trim()) {
      return fail(`${itemPath}.title`, "列标题应为非空字符串");
    }
  }
  return null;
};

const tableRowsCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "行数据应为数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) return fail(itemPath, "行数据应为对象");
    for (const [key, cell] of Object.entries(item)) {
      if (cell !== null && typeof cell !== "string" && typeof cell !== "number") {
        return fail(`${itemPath}.${key}`, "单元格应为字符串、数值或 null");
      }
    }
  }
  return null;
};

const fieldsCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "字段列表应为数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) return fail(itemPath, "字段应为对象");
    if (typeof item.label !== "string" || !item.label.trim()) {
      return fail(`${itemPath}.label`, "字段名称应为非空字符串");
    }
    if (
      typeof item.value !== "string" &&
      typeof item.value !== "number" &&
      item.value !== null
    ) {
      return fail(`${itemPath}.value`, "字段值应为字符串、数值或 null");
    }
  }
  return null;
};

const healthFactorsCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "健康因子应为数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) return fail(itemPath, "健康因子应为对象");
    if (typeof item.label !== "string" || !item.label.trim()) {
      return fail(`${itemPath}.label`, "因子名称应为非空字符串");
    }
    if (item.value !== null && typeof item.value !== "number") {
      return fail(`${itemPath}.value`, "因子值应为数值或 null");
    }
    if (item.unit !== undefined && typeof item.unit !== "string") {
      return fail(`${itemPath}.unit`, "因子单位应为字符串");
    }
    if (item.note !== undefined && typeof item.note !== "string") {
      return fail(`${itemPath}.note`, "因子说明应为字符串");
    }
  }
  return null;
};

const DATA_SOURCES: DataSource[] = ["MOCK", "REFERENCE", "USER_ENTRY", "CALCULATED"];
const EVIDENCE_KINDS = [
  "telemetry",
  "alarm",
  "workorder",
  "document",
  "inspection",
  "asset",
] as const;

const evidenceItemsCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "证据应为数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) return fail(itemPath, "证据应为对象");
    if (typeof item.kind !== "string" || !EVIDENCE_KINDS.includes(item.kind as never)) {
      return fail(`${itemPath}.kind`, "证据类型不在白名单内");
    }
    if (typeof item.refId !== "string" || !item.refId.trim()) {
      return fail(`${itemPath}.refId`, "证据引用应为非空字符串");
    }
    if (typeof item.label !== "string" || !item.label.trim()) {
      return fail(`${itemPath}.label`, "证据名称应为非空字符串");
    }
    if (item.detail !== undefined && typeof item.detail !== "string") {
      return fail(`${itemPath}.detail`, "证据说明应为字符串");
    }
    if (typeof item.source !== "string" || !DATA_SOURCES.includes(item.source as DataSource)) {
      return fail(`${itemPath}.source`, "证据来源标签不在白名单内");
    }
  }
  return null;
};

const pointsCheck: PropCheck = (value, path) => {
  if (!Array.isArray(value)) return fail(path, "测点列表应为数组");
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) return fail(itemPath, "测点应为对象");
    if (typeof item.id !== "string" || !item.id.trim()) {
      return fail(`${itemPath}.id`, "测点 id 应为非空字符串");
    }
    if (typeof item.label !== "string" || !item.label.trim()) {
      return fail(`${itemPath}.label`, "测点名称应为非空字符串");
    }
    if (item.unit !== undefined && typeof item.unit !== "string") {
      return fail(`${itemPath}.unit`, "测点单位应为字符串");
    }
    if (item.selected !== undefined && typeof item.selected !== "boolean") {
      return fail(`${itemPath}.selected`, "选中标记应为布尔值");
    }
  }
  return null;
};

const layoutCheck: PropCheck = (value, path) => {
  if (!isRecord(value)) return fail(path, "layout 应为对象");
  for (const key of ["x", "y", "w", "h"]) {
    const item = value[key];
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return fail(`${path}.${key}`, "layout 字段应为数值");
    }
  }
  const x = value.x as number;
  const y = value.y as number;
  const w = value.w as number;
  const h = value.h as number;
  if (x < 0 || x > 11) return fail(`${path}.x`, "x 应在 0~11 之间");
  if (y < 0) return fail(`${path}.y`, "y 不能为负");
  if (w < 1 || w > 12) return fail(`${path}.w`, "w 应在 1~12 之间");
  if (h < 1) return fail(`${path}.h`, "h 应大于等于 1");
  return null;
};

const actionCheck: PropCheck = (value, path) => {
  if (!isRecord(value)) return fail(path, "动作应为对象");
  if (!isA2uiActionName(value.kind)) {
    return fail(`${path}.kind`, "动作不在白名单内");
  }
  if (value.label !== undefined && typeof value.label !== "string") {
    return fail(`${path}.label`, "动作文案应为字符串");
  }
  if (value.payload !== undefined) {
    if (!isRecord(value.payload)) return fail(`${path}.payload`, "动作参数应为对象");
    for (const [key, item] of Object.entries(value.payload)) {
      if (typeof item !== "string") {
        return fail(`${path}.payload.${key}`, "动作参数值应为字符串");
      }
    }
  }
  return null;
};

const rangeCountCheck: PropCheck = (value, path) =>
  value === 1 || value === 2 || value === 3
    ? null
    : fail(path, "应为 1 / 2 / 3 之一");

const actionProp = optional(actionCheck);
const layoutProp = optional(layoutCheck);
const titleProp = optional(stringCheck);
const heightProp = optional(numberCheck);

/**
 * 生成参数随组件 props 一起保存到看板，回转为消息时仍属于合法属性；
 * 非图型组件忽略这些字段，仅用于刷新恢复时的参数还原。
 */
const GENERATION_PROPS: Record<string, PropCheck> = {
  chartType: optional(enumCheck(["line", "bar"])),
  rangeCount: optional(rangeCountCheck),
  showAverage: optional(booleanCheck),
  rainEventIds: optional(stringArrayCheck),
};

interface ComponentSchema {
  props: Record<string, PropCheck>;
}

const COMPONENT_SCHEMAS: Record<A2uiComponentName, ComponentSchema> = {
  MetricCard: {
    props: {
      label: required(stringCheck),
      value: required(numberOrStringCheck),
      unit: optional(stringCheck),
      hint: optional(stringCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  TrendChart: {
    props: {
      title: titleProp,
      labels: required(stringArrayCheck),
      series: required(chartSeriesCheck),
      chartType: optional(enumCheck(["line", "bar"])),
      height: heightProp,
      unit: optional(stringCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  CompareChart: {
    props: {
      title: titleProp,
      labels: required(stringArrayCheck),
      series: required(chartSeriesCheck),
      chartType: optional(enumCheck(["line", "bar"])),
      showAverage: optional(booleanCheck),
      height: heightProp,
      unit: optional(stringCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  DataTable: {
    props: {
      title: titleProp,
      columns: required(tableColumnsCheck),
      rows: required(tableRowsCheck),
      scoreWarningBelow: optional(numberCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  AssetInfo: {
    props: {
      title: titleProp,
      assetId: required(stringCheck),
      fields: required(fieldsCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  HealthFactorCard: {
    props: {
      title: titleProp,
      score: optional(numberOrNullCheck),
      band: optional(stringCheck),
      factors: required(healthFactorsCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  EvidenceList: {
    props: {
      title: titleProp,
      items: required(evidenceItemsCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  WorkOrderReview: {
    props: {
      title: titleProp,
      workOrderId: optional(stringCheck),
      status: optional(stringCheck),
      rows: required(fieldsCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  ProcessPointPicker: {
    props: {
      title: titleProp,
      assetId: required(stringCheck),
      points: required(pointsCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
  EmptyState: {
    props: {
      title: required(stringCheck),
      description: optional(stringCheck),
      reason: optional(stringCheck),
      action: actionProp,
      layout: layoutProp,
      ...GENERATION_PROPS,
    },
  },
};

/* ------------------------------ 动作鉴权 ------------------------------ */

export function authorizeAction(role: Role, action: A2uiAction): A2uiError | null {
  const shape = actionCheck(action, "action");
  if (shape) return shape;
  const requiredAction = ACTION_PERMISSIONS[action.kind];
  if (!can(role, requiredAction)) {
    return {
      code: "FORBIDDEN_ACTION",
      message: `角色「${roleNames[role]}」无权执行动作 ${action.kind}（需要 ${requiredAction}）`,
      path: "action",
    };
  }
  for (const key of ACTION_PAYLOAD_KEYS[action.kind]) {
    const value = action.payload?.[key];
    if (typeof value !== "string" || !value.trim()) {
      return {
        code: "INVALID_PROPS",
        message: `动作 ${action.kind} 缺少参数 payload.${key}`,
        path: `action.payload.${key}`,
      };
    }
  }
  return null;
}

/* ------------------------------ 组件校验 ------------------------------ */

function validateComponent(
  raw: unknown,
  path: string,
  role: Role,
): { component: A2uiComponent | null; errors: A2uiError[] } {
  const errors: A2uiError[] = [];
  if (!isRecord(raw)) {
    return {
      component: null,
      errors: [{ code: "INVALID_MESSAGE", message: "组件应为对象", path }],
    };
  }
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.component === "string" ? raw.component : "";
  if (!id.trim()) {
    errors.push({ code: "INVALID_MESSAGE", message: "组件 id 应为非空字符串", path: `${path}.id` });
  }
  if (!name.trim()) {
    errors.push({
      code: "INVALID_MESSAGE",
      message: "组件名应为非空字符串",
      path: `${path}.component`,
    });
  }
  if (errors.length) return { component: null, errors };
  if (!isA2uiComponentName(name)) {
    return {
      component: null,
      errors: [
        {
          code: "UNKNOWN_COMPONENT",
          message: `组件「${name}」不在白名单内`,
          path: `${path}.component`,
        },
      ],
    };
  }

  let props: Record<string, unknown> = {};
  if (raw.props !== undefined) {
    if (!isRecord(raw.props)) {
      errors.push({ code: "INVALID_PROPS", message: "props 应为对象", path: `${path}.props` });
    } else {
      props = raw.props;
    }
  }
  if (errors.length) return { component: null, errors };

  const schema = COMPONENT_SCHEMAS[name];
  for (const key of Object.keys(props)) {
    if (!(key in schema.props)) {
      errors.push({
        code: "INVALID_PROPS",
        message: `组件 ${name} 不支持属性 ${key}`,
        path: `${path}.props.${key}`,
      });
    }
  }
  for (const [key, check] of Object.entries(schema.props)) {
    const checkError = check(props[key], `${path}.props.${key}`);
    if (checkError) errors.push(checkError);
  }
  const actionPath = `${path}.props.action`;
  const actionShapeValid = !errors.some((item) => item.path?.startsWith(actionPath));
  if (props.action !== undefined && actionShapeValid) {
    const authError = authorizeAction(role, props.action as A2uiAction);
    if (authError) {
      errors.push({
        ...authError,
        path: authError.path ? `${actionPath}.${authError.path}` : actionPath,
      });
    }
  }

  let children: string[] | undefined;
  if (raw.children !== undefined) {
    if (!Array.isArray(raw.children) || raw.children.some((item) => typeof item !== "string")) {
      errors.push({
        code: "INVALID_MESSAGE",
        message: "children 应为组件 id 字符串数组",
        path: `${path}.children`,
      });
    } else {
      children = raw.children as string[];
    }
  }
  if (errors.length) return { component: null, errors };

  const component: A2uiComponent = {
    id,
    component: name,
    props: Object.keys(props).length ? clone(props) : undefined,
  };
  if (children) component.children = children;
  return { component, errors: [] };
}

/* ------------------------------ 消息应用 ------------------------------ */

interface StepResult {
  surface: Surface | null;
  errors: A2uiError[];
}

function messagePath(index: number): string {
  return `messages[${index}]`;
}

function checkSurfaceId(
  surface: Surface | null,
  value: unknown,
  path: string,
): A2uiError | null {
  if (!surface) {
    return { code: "INVALID_MESSAGE", message: "Surface 不存在，请先 createSurface", path };
  }
  if (typeof value !== "string" || value !== surface.surfaceId) {
    return { code: "INVALID_MESSAGE", message: "surfaceId 与当前 Surface 不一致", path };
  }
  return null;
}

function applyCreateSurface(raw: Record<string, unknown>, path: string): StepResult {
  const source = raw.surface;
  if (!isRecord(source)) {
    return {
      surface: null,
      errors: [{ code: "INVALID_MESSAGE", message: "createSurface 缺少 surface 对象", path }],
    };
  }
  const surfaceId = typeof source.surfaceId === "string" ? source.surfaceId.trim() : "";
  const root = typeof source.root === "string" ? source.root.trim() : "";
  const catalogId = typeof source.catalogId === "string" ? source.catalogId : "";
  const errors: A2uiError[] = [];
  if (!surfaceId) {
    errors.push({
      code: "INVALID_MESSAGE",
      message: "surfaceId 应为非空字符串",
      path: `${path}.surface.surfaceId`,
    });
  }
  if (!root) {
    errors.push({
      code: "INVALID_MESSAGE",
      message: "root 应为非空字符串",
      path: `${path}.surface.root`,
    });
  }
  if (catalogId !== A2UI_CATALOG_ID) {
    errors.push({
      code: "INVALID_MESSAGE",
      message: `未授权的 Catalog：${catalogId || "空"}`,
      path: `${path}.surface.catalogId`,
    });
  }
  let dataModel: Record<string, unknown> = {};
  if (source.dataModel !== undefined) {
    if (!isRecord(source.dataModel)) {
      errors.push({
        code: "INVALID_MESSAGE",
        message: "dataModel 应为对象",
        path: `${path}.surface.dataModel`,
      });
    } else {
      dataModel = clone(source.dataModel);
    }
  }
  if (errors.length) return { surface: null, errors };
  return {
    surface: {
      surfaceId,
      root,
      catalogId: A2UI_CATALOG_ID,
      components: [],
      dataModel,
    },
    errors: [],
  };
}

function applyUpdateComponents(
  surface: Surface | null,
  raw: Record<string, unknown>,
  path: string,
  role: Role,
): StepResult {
  const surfaceError = checkSurfaceId(surface, raw.surfaceId, `${path}.surfaceId`);
  if (surfaceError || !surface) return { surface, errors: [surfaceError ?? {
    code: "INVALID_MESSAGE",
    message: "Surface 不存在",
    path,
  }] };
  const rawComponents = raw.components;
  if (!Array.isArray(rawComponents)) {
    return {
      surface,
      errors: [
        { code: "INVALID_MESSAGE", message: "components 应为数组", path: `${path}.components` },
      ],
    };
  }
  const errors: A2uiError[] = [];
  const incoming: A2uiComponent[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawComponents.length; index += 1) {
    const { component, errors: itemErrors } = validateComponent(
      rawComponents[index],
      `${path}.components[${index}]`,
      role,
    );
    errors.push(...itemErrors);
    if (!component) continue;
    if (seen.has(component.id)) {
      errors.push({
        code: "INVALID_MESSAGE",
        message: `组件 id 重复：${component.id}`,
        path: `${path}.components[${index}].id`,
      });
      continue;
    }
    seen.add(component.id);
    incoming.push(component);
  }
  if (errors.length) return { surface, errors };

  const merged = new Map<string, A2uiComponent>();
  for (const component of surface.components) merged.set(component.id, component);
  for (const component of incoming) merged.set(component.id, component);
  if (!merged.has(surface.root)) {
    return {
      surface,
      errors: [
        {
          code: "INVALID_MESSAGE",
          message: `根组件 ${surface.root} 不存在`,
          path: `${path}.components`,
        },
      ],
    };
  }
  for (const component of merged.values()) {
    for (const child of component.children ?? []) {
      if (!merged.has(child)) {
        return {
          surface,
          errors: [
            {
              code: "INVALID_MESSAGE",
              message: `组件 ${component.id} 引用了不存在的子组件 ${child}`,
              path: `${path}.components`,
            },
          ],
        };
      }
    }
  }
  return {
    surface: { ...surface, components: [...merged.values()] },
    errors: [],
  };
}

function applyUpdateDataModel(
  surface: Surface | null,
  raw: Record<string, unknown>,
  path: string,
): StepResult {
  const surfaceError = checkSurfaceId(surface, raw.surfaceId, `${path}.surfaceId`);
  if (surfaceError || !surface) {
    return {
      surface,
      errors: [
        surfaceError ?? { code: "INVALID_MESSAGE", message: "Surface 不存在", path },
      ],
    };
  }
  if (!isRecord(raw.dataModel)) {
    return {
      surface,
      errors: [
        { code: "INVALID_MESSAGE", message: "dataModel 应为对象", path: `${path}.dataModel` },
      ],
    };
  }
  return {
    surface: { ...surface, dataModel: { ...surface.dataModel, ...clone(raw.dataModel) } },
    errors: [],
  };
}

function applyOne(
  surface: Surface | null,
  raw: unknown,
  role: Role,
  index: number,
): StepResult {
  const path = messagePath(index);
  if (!isRecord(raw)) {
    return {
      surface,
      errors: [{ code: "INVALID_MESSAGE", message: "消息应为对象", path }],
    };
  }
  const type = raw.type;
  switch (type) {
    case "createSurface":
      return applyCreateSurface(raw, path);
    case "updateComponents":
      return applyUpdateComponents(surface, raw, path, role);
    case "updateDataModel":
      return applyUpdateDataModel(surface, raw, path);
    case "deleteSurface": {
      const surfaceError = checkSurfaceId(surface, raw.surfaceId, `${path}.surfaceId`);
      if (surfaceError) return { surface, errors: [surfaceError] };
      return { surface: null, errors: [] };
    }
    default:
      return {
        surface,
        errors: [
          {
            code: "INVALID_MESSAGE",
            message: `未知消息类型：${String(type)}`,
            path: `${path}.type`,
          },
        ],
      };
  }
}

/**
 * 纯函数消息应用：整批消息事务化处理，任一消息非法则不产生部分更新，
 * 保留调用方传入的最近一次合法 Surface。
 */
export function applyMessages(
  previous: Surface | null,
  messages: readonly A2uiMessage[],
  role: Role = "manager",
): A2uiResult {
  let working = previous ? clone(previous) : null;
  const errors: A2uiError[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const result = applyOne(working, messages[index], role, index);
    errors.push(...result.errors);
    if (!result.errors.length) working = result.surface;
  }
  if (errors.length) {
    return {
      surface: previous ? clone(previous) : null,
      errors,
      rejected: true,
    };
  }
  return { surface: working, errors: [], rejected: false };
}

/* ------------------------------ 本地生成器 ------------------------------ */

export interface RainSurfaceParams {
  chartType: "line" | "bar";
  rangeCount: 1 | 2 | 3;
  showAverage: boolean;
}

export const DEFAULT_RAIN_PARAMS: RainSurfaceParams = {
  chartType: "line",
  rangeCount: 3,
  showAverage: false,
};

export interface SurfaceComposeResult {
  messages: A2uiMessage[];
  errors: A2uiError[];
  rejected: boolean;
  params?: RainSurfaceParams;
}

function normalizeRainParams(params: Partial<RainSurfaceParams>): {
  params?: RainSurfaceParams;
  errors: A2uiError[];
} {
  const chartType = params.chartType ?? DEFAULT_RAIN_PARAMS.chartType;
  const rangeCount = params.rangeCount ?? DEFAULT_RAIN_PARAMS.rangeCount;
  const showAverage = params.showAverage ?? DEFAULT_RAIN_PARAMS.showAverage;
  const errors: A2uiError[] = [];
  if (chartType !== "line" && chartType !== "bar") {
    errors.push({
      code: "INVALID_PROPS",
      message: "图型仅支持 line / bar",
      path: "params.chartType",
    });
  }
  if (rangeCount !== 1 && rangeCount !== 2 && rangeCount !== 3) {
    errors.push({
      code: "INVALID_PROPS",
      message: "时间范围仅支持最近 1 / 2 / 3 次",
      path: "params.rangeCount",
    });
  }
  if (typeof showAverage !== "boolean") {
    errors.push({
      code: "INVALID_PROPS",
      message: "平均值开关应为布尔值",
      path: "params.showAverage",
    });
  }
  if (errors.length) return { errors };
  return { params: { chartType, rangeCount, showAverage }, errors: [] };
}

interface ChartSeries {
  name: string;
  values: number[];
  unit: string;
}

/**
 * 基于本地雨次种子生成「南北储量对比」。x 轴为雨次名称，y 轴为末段储量；
 * 平均值辅助线作为额外 series，参数同时写入 dataModel 与组件 props。
 */
export function composeRainSurface(
  seed: ScenarioSeed,
  input: Partial<RainSurfaceParams> = {},
  rainEventId?: string,
): SurfaceComposeResult {
  const normalized = normalizeRainParams(input);
  if (normalized.errors.length || !normalized.params) {
    return { messages: [], errors: normalized.errors, rejected: true };
  }
  const params = normalized.params;
  const events = rainEventId && params.rangeCount === 1
    ? seed.rainEvents.filter(event => event.id === rainEventId)
    : seed.rainEvents.slice(-params.rangeCount);
  if (!events.length) {
    return {
      messages: [],
      errors: [
        {
          code: "MISSING_DATA",
          message: "本地种子没有雨次数据，无法生成南北储量对比。",
          path: "seed.rainEvents",
        },
      ],
      rejected: true,
    };
  }

  const ends = events.flatMap(event => {
    const end = rainStorage(event).end;
    return end ? [end] : [];
  });
  if (ends.length !== events.length) return {
    messages: [], rejected: true,
    errors: [{ code: "MISSING_DATA", message: "雨次缺少南北同一小时的有效储量", path: "seed.rainEvents" }],
  };

  const labels = events.map((event) => event.name.replace(" 降雨过程", ""));
  const north: ChartSeries = {
    name: "北区储量",
    values: ends.map(end => end.north),
    unit: events[0].unit,
  };
  const south: ChartSeries = {
    name: "南区储量",
    values: ends.map(end => end.south),
    unit: events[0].unit,
  };
  const series: ChartSeries[] = [north, south];
  if (params.showAverage) {
    series.push({
      name: "南北均值",
      values: labels.map(
        (_, index) => Math.round((north.values[index] + south.values[index]) / 2),
      ),
      unit: events[0].unit,
    });
  }

  const latest = events.at(-1)!;
  const latestTotal = ends.at(-1)!.total;
  const chartLabel = params.chartType === "bar" ? "柱状" : "折线";
  const compareComponent: A2uiComponent = {
    id: "rain-compare",
    component: "CompareChart",
    props: {
      title: `南北储量对比（最近 ${params.rangeCount} 次 · ${chartLabel}）`,
      labels,
      series,
      chartType: params.chartType,
      showAverage: params.showAverage,
      height: 300,
      unit: events[0].unit,
      layout: { x: 0, y: 0, w: 8, h: 6 },
    },
  };
  const metricComponent: A2uiComponent = {
    id: "rain-metric",
    component: "MetricCard",
    props: {
      label: "最近雨次末段总储量",
      value: latestTotal,
      unit: latest.unit,
      hint: `${latest.id} · 第 ${ends.at(-1)!.hour} 小时 · 北区 + 南区合计`,
      layout: { x: 8, y: 0, w: 4, h: 6 },
    },
  };

  const messages: A2uiMessage[] = [
    {
      type: "createSurface",
      surface: {
        surfaceId: RAIN_SURFACE_ID,
        root: compareComponent.id,
        catalogId: A2UI_CATALOG_ID,
        dataModel: {
          params: { ...params },
          rainEventIds: events.map((event) => event.id),
          generatedBy: "local-rule-generator",
        },
      },
    },
    {
      type: "updateComponents",
      surfaceId: RAIN_SURFACE_ID,
      components: [compareComponent, metricComponent],
    },
  ];

  return { messages, errors: [], rejected: false, params };
}

/* ------------------------------ 电耗缺数 ------------------------------ */

const ENERGY_PATTERN = /(用电|电耗|能耗|电能|功率|kWh|kW)/i;

export function isEnergyQuery(text: string): boolean {
  return ENERGY_PATTERN.test(text);
}

export function findEnergyPoints(points: MeasurePoint[]): MeasurePoint[] {
  return points.filter(
    (point) =>
      /(电耗|能耗|用电|电能|功率)/.test(point.label) ||
      point.unit === "kW" ||
      point.unit === "kWh" ||
      point.unit === "kW·h",
  );
}

/**
 * 电耗曲线生成请求：本地没有电耗测点，一律拒绝并返回缺数提示，
 * 不生成替代曲线，也不做单位换算。
 */
export function composeEnergySurface(points: MeasurePoint[]): SurfaceComposeResult {
  const candidates = findEnergyPoints(points);
  return {
    messages: [],
    errors: [
      {
        code: "MISSING_DATA",
        message: candidates.length
          ? "电耗类测点存在但缺少可用时序，无法生成用电量曲线。"
          : "本地种子没有电耗/能耗测点（kW / kWh），无法生成用电量曲线；请接入电表数据后重试。",
        path: "prompt",
      },
    ],
    rejected: true,
  };
}

/* ------------------------------ 看板互转 ------------------------------ */

const DEFAULT_LAYOUT_HEIGHT: Record<string, number> = {
  MetricCard: 3,
  TrendChart: 5,
  CompareChart: 5,
  DataTable: 4,
  AssetInfo: 4,
  HealthFactorCard: 4,
  EvidenceList: 4,
  WorkOrderReview: 4,
  ProcessPointPicker: 4,
  EmptyState: 3,
};

function layoutValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function widgetTitle(component: A2uiComponent): string {
  const props = component.props ?? {};
  if (typeof props.title === "string" && props.title.trim()) return props.title;
  if (typeof props.label === "string" && props.label.trim()) return props.label;
  return isA2uiComponentName(component.component)
    ? A2UI_COMPONENT_LABELS[component.component]
    : component.component;
}

function generationParams(surface: Surface): Record<string, unknown> {
  const params = isRecord(surface.dataModel.params) ? surface.dataModel.params : {};
  const rainEventIds = Array.isArray(surface.dataModel.rainEventIds)
    ? surface.dataModel.rainEventIds.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const result: Record<string, unknown> = {};
  if (params.chartType === "line" || params.chartType === "bar") {
    result.chartType = params.chartType;
  }
  if (
    params.rangeCount === 1 ||
    params.rangeCount === 2 ||
    params.rangeCount === 3
  ) {
    result.rangeCount = params.rangeCount;
  }
  if (typeof params.showAverage === "boolean") {
    result.showAverage = params.showAverage;
  }
  if (rainEventIds.length) result.rainEventIds = rainEventIds;
  return result;
}

/** Surface → DashboardWidget：props 保留组件属性并补入生成参数。 */
export function surfaceToWidgets(surface: Surface): DashboardWidget[] {
  const childIds = new Set<string>();
  for (const component of surface.components) {
    for (const child of component.children ?? []) childIds.add(child);
  }
  const params = generationParams(surface);
  const topLevel = surface.components.filter(
    (component) => !childIds.has(component.id),
  );
  return topLevel.map((component, index) => {
    const props = clone(component.props ?? {});
    const rawLayout = isRecord(props.layout) ? props.layout : {};
    const fallbackHeight = isA2uiComponentName(component.component)
      ? DEFAULT_LAYOUT_HEIGHT[component.component] ?? 4
      : 4;
    return {
      id: component.id,
      component: component.component,
      title: widgetTitle(component),
      props: { ...props, ...params },
      layout: {
        x: Math.round(layoutValue(rawLayout.x, 0)),
        y: Math.round(layoutValue(rawLayout.y, index * 4)),
        w: Math.round(layoutValue(rawLayout.w, 12)),
        h: Math.round(layoutValue(rawLayout.h, fallbackHeight)),
      },
    };
  });
}

/** Dashboard → A2UI 消息：用于刷新后按 dashboard 参数恢复同一 Surface。 */
export function dashboardToMessages(dashboard: Dashboard): A2uiMessage[] {
  const surfaceId = `surface-${dashboard.id}`;
  const components: A2uiComponent[] = dashboard.widgets.map((widget, index) => ({
    id: widget.id || `widget-${index}`,
    component: widget.component,
    props: clone(widget.props),
  }));
  if (!components.length) {
    components.push({
      id: "dashboard-empty",
      component: "EmptyState",
      props: {
        title: "空看板",
        description: "该看板没有组件，可在工作台重新生成图表后保存。",
        layout: { x: 0, y: 0, w: 12, h: 3 },
      },
    });
  }

  const params: Record<string, unknown> = {};
  const rainEventIds: string[] = [];
  for (const widget of dashboard.widgets) {
    const props = widget.props;
    if (params.chartType === undefined && (props.chartType === "line" || props.chartType === "bar")) {
      params.chartType = props.chartType;
    }
    if (
      params.rangeCount === undefined &&
      (props.rangeCount === 1 || props.rangeCount === 2 || props.rangeCount === 3)
    ) {
      params.rangeCount = props.rangeCount;
    }
    if (params.showAverage === undefined && typeof props.showAverage === "boolean") {
      params.showAverage = props.showAverage;
    }
    if (Array.isArray(props.rainEventIds)) {
      for (const item of props.rainEventIds) {
        if (typeof item === "string" && !rainEventIds.includes(item)) {
          rainEventIds.push(item);
        }
      }
    }
  }

  return [
    {
      type: "createSurface",
      surface: {
        surfaceId,
        root: components[0].id,
        catalogId: A2UI_CATALOG_ID,
        dataModel: { dashboardId: dashboard.id, params, rainEventIds },
      },
    },
    { type: "updateComponents", surfaceId, components },
  ];
}

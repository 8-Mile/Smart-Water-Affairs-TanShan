import {
  A2UI_CATALOG_ID,
  applyMessages,
  authorizeAction,
  isA2uiActionName,
  type A2uiAction,
  type A2uiComponent,
  type Surface,
} from "./a2ui";
import type { Role } from "./types";

type JsonObject = Record<string, unknown>;
export interface OfficialSurface {
  surface: Surface;
  definitions: JsonObject[];
}

const safeKey = /^[A-Za-z0-9_-]{1,80}$/;
const reserved = new Set(["__proto__", "prototype", "constructor"]);
function reject(message: string): never {
  throw new Error(message);
}
function object(value: unknown): JsonObject {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    reject("应为 JSON 对象");
  return value as JsonObject;
}

function fields(value: JsonObject, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    reject("存在不支持的协议字段");
}

function json(value: unknown, depth = 0): unknown {
  if (depth > 16) reject("JSON 嵌套过深");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => json(item, depth + 1));
  return Object.fromEntries(
    Object.entries(object(value)).map(([key, item]) => {
      if (reserved.has(key) || (key.startsWith("@") && key !== "@path"))
        reject("不支持的 JSON 键");
      return [key, json(item, depth + 1)];
    }),
  );
}

function keyOf(path: unknown): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    !safeKey.test(path.slice(1)) ||
    reserved.has(path.slice(1))
  )
    reject("仅支持单层绝对绑定路径");
  return path.slice(1);
}

function resolve(value: unknown, model: JsonObject): unknown {
  if (Array.isArray(value)) return value.map((item) => resolve(item, model));
  if (value === null || typeof value !== "object") return value;
  const record = object(value);
  if (Object.hasOwn(record, "@path")) {
    fields(record, ["@path"]);
    const key = keyOf(record["@path"]);
    if (!Object.hasOwn(model, key) || model[key] === null)
      reject("绑定指标缺失");
    return model[key];
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, resolve(item, model)]),
  );
}

function component(definition: JsonObject, model: JsonObject): A2uiComponent {
  const { id, component: name, children, action, ...rawProps } = definition;
  if (typeof id !== "string" || typeof name !== "string")
    reject("组件缺少 id 或名称");
  const props = object(resolve(rawProps, model));
  if (action !== undefined) {
    const envelope = object(action);
    fields(envelope, ["event"]);
    const event = object(envelope.event);
    fields(event, ["name", "context", "userMessage"]);
    if (!isA2uiActionName(event.name)) reject("动作未注册");
    props.action = {
      kind: event.name,
      label: resolve(event.userMessage ?? event.name, model),
      payload: resolve(object(event.context ?? {}), model),
    };
  }
  return {
    id,
    component: name,
    props,
    children: children as string[] | undefined,
  };
}

function definitions(value: unknown): JsonObject[] {
  if (!Array.isArray(value) || !value.length)
    reject("components 必须为非空数组");
  const objects = value.map((item) => object(json(item)));
  if (new Set(objects.map((item) => item.id)).size !== objects.length)
    reject("组件编号重复");
  return objects;
}

/** Official v1.0 envelope subset for the registered water catalog; apply a batch atomically. */
export function applyOfficialMessages(
  previous: OfficialSurface | null,
  messages: readonly unknown[],
  role: Role,
) {
  let current = previous;
  try {
    for (const message of messages) {
      const raw = object(message);
      const [kind, extra] = Object.keys(raw).filter((key) => key !== "version");
      if (raw.version !== "1.0" || !kind || extra)
        reject("需要单一 1.0 消息信封");
      const body = object(raw[kind]);
      const id = body.surfaceId;
      if (typeof id !== "string" || !safeKey.test(id))
        reject("Surface ID 无效");
      let model = current?.surface.dataModel ?? {};
      let comps = current?.definitions ?? [];
      if (kind === "createSurface") {
        fields(body, [
          "surfaceId",
          "catalogId",
          "components",
          "dataModel",
          "sendDataModel",
        ]);
        if (
          current ||
          body.catalogId !== A2UI_CATALOG_ID ||
          (body.sendDataModel !== undefined && body.sendDataModel !== false)
        )
          reject("Surface 已存在或目录不受支持");
        model =
          body.dataModel === undefined ? {} : object(json(body.dataModel));
        comps =
          body.components === undefined ? [] : definitions(body.components);
      } else {
        if (current?.surface.surfaceId !== id) reject("Surface 不存在");
        if (kind === "deleteSurface") {
          fields(body, ["surfaceId"]);
          current = null;
          continue;
        }
        if (kind === "updateComponents") {
          fields(body, ["surfaceId", "components"]);
          const merged = new Map(comps.map((item) => [item.id, item]));
          for (const item of definitions(body.components))
            merged.set(item.id, item);
          comps = [...merged.values()];
        } else if (kind === "updateDataModel") {
          fields(body, ["surfaceId", "path", "value"]);
          const value = json(body.value);
          if (body.path === undefined || body.path === "/")
            model = value === null ? {} : object(value);
          else {
            const key = keyOf(body.path);
            model = { ...model };
            if (value === null) delete model[key];
            else model[key] = value;
          }
        } else reject("当前适配层不支持该消息");
      }
      const result = applyMessages(
        null,
        [
          {
            type: "createSurface",
            surface: {
              surfaceId: id,
              catalogId: A2UI_CATALOG_ID,
              root: "root",
              dataModel: model,
            },
          },
          ...(comps.length
            ? [
                {
                  type: "updateComponents" as const,
                  surfaceId: id,
                  components: comps.map((item) => component(item, model)),
                },
              ]
            : []),
        ],
        role,
      );
      if (result.rejected || !result.surface)
        reject(result.errors[0]?.message ?? "Surface 校验失败");
      current = { surface: result.surface, definitions: comps };
    }
    return { current, error: null };
  } catch (error) {
    return { current: previous, error: (error as Error).message };
  }
}

/** Emit only actions that exist on the validated component and are allowed for the current role. */
export function officialAction(
  surface: Surface,
  componentId: string,
  role: Role,
  at: Date,
) {
  const action = surface.components.find((item) => item.id === componentId)
    ?.props?.action as A2uiAction | undefined;
  if (!action || authorizeAction(role, action)) return null;
  return {
    version: "1.0",
    action: {
      name: action.kind,
      surfaceId: surface.surfaceId,
      sourceComponentId: componentId,
      timestamp: at.toISOString(),
      context: { ...action.payload },
    },
  };
}

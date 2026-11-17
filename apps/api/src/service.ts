import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  processes,
  permissions,
  roleScopes,
  roleNames,
  asOf,
  DashboardSchema,
  defaultLayout,
  type Role,
  type User,
  type Permission,
  type Asset,
  type ScenarioState,
  type AppData,
  type DashboardLayout,
  type WorkOrder,
  type ScenarioId,
  type ProcessSummary,
} from "@water/contracts";
import { Database, type Stored } from "./db";
import { seed, rainRows } from "./seed";
import { health } from "@water/domain";
export const now = () => new Date().toISOString();
export function user(role: Role): User {
  return {
    id: `demo-${role}`,
    role,
    name: roleNames[role],
    scopes: roleScopes[role],
    permissions: permissions[role],
  };
}
export function permit(u: User, p: Permission) {
  if (!u.permissions.includes(p))
    throw new ForbiddenException("当前角色没有此操作权限");
}
export function audit(
  s: Stored,
  u: User,
  action: string,
  resource: string,
  detail: string,
) {
  s.audits.push({
    id: randomUUID(),
    at: now(),
    actor: u.name,
    action,
    resource,
    detail,
  });
}
export function visible(u: User, a: Asset) {
  return u.scopes.includes(a.area);
}
export function assetFor(s: ScenarioState, u: User, id: string) {
  const a = s.assets.find((a) => a.id === id && visible(u, a));
  if (!a) throw new NotFoundException("设备不存在或不在授权范围");
  return a;
}
export function active(s: Stored, epoch?: number) {
  if (epoch !== undefined && epoch !== s.epoch)
    throw new ConflictException("场景已切换，请刷新后重试");
  return s.states[s.scenarioId]!;
}
export function validateLayout(raw: unknown, u: User): DashboardLayout {
  const parsed = DashboardSchema.safeParse(raw);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues.map((x) => x.message).join("；"),
    );
  const layout = parsed.data;
  if (layout.areas.some((a) => !u.scopes.includes(a)))
    throw new ForbiddenException("看板包含未授权区域");
  const safety = layout.widgets.find((w) => w.id === "safety");
  if (
    !safety ||
    !safety.locked ||
    safety.type !== "AlertList" ||
    safety.dataset !== "alarms" ||
    safety.x !== 0 ||
    safety.y !== 0 ||
    safety.w !== 12 ||
    safety.h !== 2
  )
    throw new BadRequestException("关键告警组件不可删除或替换");
  if (layout.widgets.some((w) => w.id !== "safety" && w.locked))
    throw new BadRequestException("不支持新增锁定组件");
  return layout;
}
export class Service {
  constructor(public db: Database) {}
  async snapshot(u: User): Promise<AppData> {
    const s = await this.db.read(),
      sc = active(s);
    const assets = sc.assets.filter((a) => visible(u, a));
    const ids = new Set(assets.map((a) => a.id));
    const alarms = sc.alarms.filter((a) => ids.has(a.assetId));
    const workorders = sc.workorders.filter(
      (w) =>
        ids.has(w.assetId) && (u.role !== "engineer" || w.assignee === u.id),
    );
    const subsystems = this.summaries(sc, u);
    const ledger = u.scopes.map((area, i) => ({
      id: area,
      source: area === "north" ? "北区" : "南区",
      inflow: s.scenarioId === "SCN-RAIN" ? 1800 + i * 200 : 1200 + i * 100,
      consumption: 900 + i * 100,
      tap:
        (s.scenarioId === "SCN-RAIN" ? 1800 + i * 200 : 1200 + i * 100) *
        (s.scenarioId === "SCN-RAIN" ? 0.2 : 0.5),
      rainwater:
        (s.scenarioId === "SCN-RAIN" ? 1800 + i * 200 : 1200 + i * 100) *
        (s.scenarioId === "SCN-RAIN" ? 0.5 : 0.2),
      reclaimed:
        (s.scenarioId === "SCN-RAIN" ? 1800 + i * 200 : 1200 + i * 100) * 0.3,
      storageChange:
        (s.scenarioId === "SCN-RAIN" ? 1800 + i * 200 : 1200 + i * 100) -
        (900 + i * 100),
      note: "模拟日水量；流入=自来水+雨水+外部回用水；内部处理流转不重复计入",
    }));
    const consumption = ledger.reduce((n, r) => n + r.consumption, 0);
    const reuse = consumption * 0.3;
    return {
      user: u,
      scenarioId: s.scenarioId,
      epoch: s.epoch,
      features: s.features,
      assets,
      alarms,
      workorders,
      subsystems,
      ledger,
      rain: rainRows(s.scenarioId).filter((r) => u.scopes.includes(r.area)),
      health: s.features.health
        ? assets.filter((a) => a.type === "pump").map(health)
        : [],
      kpis: [
        {
          label: "总用水量",
          value: `${consumption} m³`,
          formula: "当前授权区域当日终端消耗合计；不累加内部流转量",
        },
        {
          label: "再生水利用比例",
          value: `${((reuse / consumption) * 100).toFixed(1)}%`,
          formula: `SIM 回用水终端消耗 ${reuse} / 全部终端消耗 ${consumption}`,
        },
        {
          label: "六系统运行状态",
          value: `${subsystems.filter((p) => p.status === "正常").length} / 6 正常`,
          formula: "授权设备存在警告时该系统计为关注；无异常为正常",
        },
        {
          label: "待处置事件",
          value: String(alarms.filter((a) => a.status !== "closed").length),
          formula: "当前场景授权范围内所有未关闭事件（含已恢复未关闭）",
        },
      ],
      templates: [
        {
          id: "rain",
          title: "雨水分析岗位模板",
          layout: defaultLayout(u.scopes),
        },
        {
          id: "energy",
          title: "设备运维岗位模板",
          layout: {
            ...defaultLayout(u.scopes),
            title: "设备运维分析",
            widgets: defaultLayout(u.scopes).widgets.map((w) =>
              w.id === "safety"
                ? w
                : { ...w, dataset: "energy", title: "同类泵能耗比较" },
            ),
          },
        },
      ],
      modelConfigured: !!process.env.AI_GATEWAY_URL,
    };
  }
  summaries(sc: ScenarioState, u: User): ProcessSummary[] {
    return processes.map((p) => {
      const list = sc.assets.filter(
        (a) => a.subsystemId === p.id && visible(u, a),
      );
      const status = list.some((a) => a.status === "警告") ? "关注" : "正常";
      const value =
        p.id === "medium-pressure"
          ? list.reduce((n, a) => n + (a.pressure ?? 0), 0) / list.length
          : sc.id === "SCN-RAIN" && p.id === "rainwater"
            ? 7200
            : sc.id === "SCN-MINE" && p.id === "mining"
              ? 460
              : p.base;
      return {
        ...p,
        value: Number(value.toFixed(2)),
        dataMode: "SIM",
        scenarioId: sc.id,
        asOf,
        quality: "simulated",
        status,
        metrics: [
          { label: p.metric, value: Number(value.toFixed(2)), unit: p.unit },
          { label: "授权监测单元", value: list.length, unit: "个" },
          {
            label: p.id === "domestic" ? "水质监测值" : "关联异常",
            value:
              p.id === "domestic"
                ? null
                : sc.alarms.filter(
                    (a) =>
                      list.some((x) => x.id === a.assetId) &&
                      a.status !== "closed",
                  ).length,
            unit: p.id === "domestic" ? "未提供" : "条",
          },
        ],
      };
    });
  }
  async asset(u: User, id: string) {
    const s = await this.db.read(),
      sc = active(s),
      a = assetFor(sc, u, id);
    return {
      asset: a,
      health: health(a),
      trend: Array.from({ length: 24 }, (_, h) => ({
        time: `${String(h).padStart(2, "0")}:00`,
        pressure:
          a.pressure === null
            ? null
            : Number(
                (a.pressure + (h === 23 ? 0 : ((h % 4) - 2) * 0.015)).toFixed(
                  3,
                ),
              ),
        volume:
          a.volume === null
            ? null
            : (a.volume / 24) * (1 + ((h % 3) - 1) * 0.1),
        energy:
          a.energy === null
            ? null
            : (a.energy / 24) * (1 + ((h % 3) - 1) * 0.1),
      })),
      alarms: sc.alarms.filter((x) => x.assetId === id),
      workorders: sc.workorders.filter(
        (x) =>
          x.assetId === id && (u.role !== "engineer" || x.assignee === u.id),
      ),
    };
  }
  async alarm(
    u: User,
    id: string,
    action: "acknowledge" | "recover" | "close",
    note: string,
    epoch: number,
  ) {
    permit(u, "alarm:ack");
    return this.db.mutate((s) => {
      const sc = active(s, epoch),
        a = sc.alarms.find((a) => a.id === id);
      if (!a) throw new NotFoundException();
      assetFor(sc, u, a.assetId);
      const next = {
        acknowledge: "acknowledged",
        recover: "recovered",
        close: "closed",
      } as const;
      if (
        (action === "acknowledge" && a.status !== "new") ||
        (action === "recover" &&
          !["handling", "acknowledged"].includes(a.status)) ||
        (action === "close" && a.status !== "recovered")
      )
        throw new ConflictException("不合法的告警状态迁移");
      if (
        action === "close" &&
        sc.workorders.some(
          (w) =>
            w.eventId === id && !["closed", "cancelled"].includes(w.status),
        )
      )
        throw new ConflictException("关联工单尚未完成");
      a.status = next[action];
      a.history.push({ at: now(), actor: u.name, action: a.status, note });
      audit(s, u, "alarm.transition", id, action);
      return a;
    });
  }
  createWork(
    s: Stored,
    u: User,
    input: {
      assetId: string;
      eventId?: string | null;
      title: string;
      description: string;
    },
    epoch: number,
  ): WorkOrder {
    permit(u, "workorder:create");
    const sc = active(s, epoch);
    assetFor(sc, u, input.assetId);
    if (
      input.eventId &&
      !sc.alarms.some(
        (a) => a.id === input.eventId && a.assetId === input.assetId,
      )
    )
      throw new BadRequestException("事件与设备不匹配");
    const w: WorkOrder = {
      id: `WO-${randomUUID().slice(0, 8)}`,
      assetId: input.assetId,
      eventId: input.eventId ?? null,
      title: input.title,
      description: input.description,
      assignee: null,
      createdBy: u.id,
      status: "draft",
      history: [
        { at: now(), actor: u.name, action: "draft", note: input.description },
      ],
      version: 1,
    };
    sc.workorders.push(w);
    audit(s, u, "workorder.draft", w.id, input.title);
    return w;
  }
  async work(
    u: User,
    id: string,
    action: string,
    note: string,
    epoch: number,
    version: number,
  ) {
    return this.db.mutate((s) => {
      const sc = active(s, epoch),
        w = sc.workorders.find((w) => w.id === id);
      if (!w) throw new NotFoundException();
      const asset = assetFor(sc, u, w.assetId);
      if (w.version !== version)
        throw new ConflictException("工单已更新，请刷新");
      const transitions: Record<
        string,
        { from: string; to: WorkOrder["status"]; permission: Permission }
      > = {
        submit: {
          from: "draft",
          to: "submitted",
          permission: "workorder:create",
        },
        assign: {
          from: "submitted",
          to: "assigned",
          permission: "workorder:review",
        },
        start: {
          from: "assigned",
          to: "in_progress",
          permission: "workorder:handle",
        },
        review: {
          from: "in_progress",
          to: "pending_review",
          permission: "workorder:handle",
        },
        close: {
          from: "pending_review",
          to: "closed",
          permission: "workorder:review",
        },
      };
      if (action === "cancel") {
        permit(u, "workorder:create");
        if (w.createdBy !== u.id || !["draft", "submitted"].includes(w.status))
          throw new ForbiddenException("仅能取消本人未派发工单");
        w.status = "cancelled";
      } else {
        const t = transitions[action];
        if (!t) throw new BadRequestException("未知动作");
        permit(u, t.permission);
        if (w.status !== t.from)
          throw new ConflictException("不合法的工单状态迁移");
        if (action === "submit" && w.createdBy !== u.id)
          throw new ForbiddenException("只能提交本人草稿");
        if (["start", "review"].includes(action) && w.assignee !== u.id)
          throw new ForbiddenException("只能办理本人任务");
        if (action === "assign") {
          if (!roleScopes.engineer.includes(asset.area))
            throw new BadRequestException("该区域暂无授权运维人员");
          w.assignee = "demo-engineer";
        }
        w.status = t.to;
      }
      w.version++;
      w.history.push({ at: now(), actor: u.name, action: w.status, note });
      const alarm = sc.alarms.find((a) => a.id === w.eventId);
      if (alarm && action === "submit" && alarm.status === "acknowledged") {
        alarm.status = "handling";
        alarm.history.push({
          at: now(),
          actor: u.name,
          action: "handling",
          note: `关联工单 ${id}`,
        });
      }
      audit(s, u, "workorder.transition", id, action);
      return w;
    });
  }
  async scenario(u: User, id: ScenarioId, reset: boolean, keep: boolean) {
    permit(u, "scenario:write");
    return this.db.mutate((s) => {
      s.epoch++;
      s.scenarioId = id;
      if (reset) s.states[id] = seed(id, s.epoch);
      s.tasks
        .filter((t) => ["running", "awaiting_approval"].includes(t.status))
        .forEach((t) => {
          t.status = "cancelled";
          t.output = "场景切换，任务已取消";
        });
      if (!keep) s.dashboards = [];
      audit(
        s,
        u,
        reset ? "scenario.reset" : "scenario.activate",
        id,
        `保留看板=${keep}；epoch=${s.epoch}`,
      );
      return { scenarioId: id, epoch: s.epoch };
    });
  }
  saveInto(
    s: Stored,
    u: User,
    raw: unknown,
    id?: string,
    expectedVersion?: number,
  ) {
    permit(u, "dashboard:write");
    const layout = validateLayout(raw, u);
    let d = s.dashboards.find((d) => d.id === id && d.ownerId === u.id);
    if (id && !d) throw new NotFoundException("看板不存在");
    if (d) {
      if (expectedVersion !== d.version)
        throw new ConflictException("看板版本已更新，请重开");
      d.version++;
      d.layout = layout;
      d.history.push({
        version: d.version,
        layout: structuredClone(layout),
        at: now(),
      });
    } else {
      d = {
        id: randomUUID(),
        ownerId: u.id,
        version: 1,
        layout,
        history: [{ version: 1, layout: structuredClone(layout), at: now() }],
      };
      s.dashboards.push(d);
    }
    audit(
      s,
      u,
      "dashboard.save",
      d.id,
      `oldVersion=${d.version - 1};newVersion=${d.version};validation=passed`,
    );
    return d;
  }
  async saveDashboard(
    u: User,
    raw: unknown,
    id?: string,
    expectedVersion?: number,
  ) {
    return this.db.mutate((s) => this.saveInto(s, u, raw, id, expectedVersion));
  }
  async approveTask(
    u: User,
    id: string,
    dashboardId?: string,
    version?: number,
  ) {
    return this.db.mutate((s) => {
      const t = s.tasks.find((t) => t.id === id && t.ownerId === u.id);
      if (!t) throw new NotFoundException();
      const sc = active(s, t.epoch);
      if (t.status !== "awaiting_approval")
        throw new ConflictException("任务已处理或不可确认");
      let result: unknown;
      if (t.layout)
        result = this.saveInto(s, u, t.layout, dashboardId, version);
      if (t.workorderId) {
        permit(u, "workorder:create");
        const w = sc.workorders.find((w) => w.id === t.workorderId);
        if (!w) throw new NotFoundException();
        assetFor(sc, u, w.assetId);
        if (w.status !== "draft" || w.createdBy !== u.id)
          throw new ConflictException("草稿已变更");
        w.status = "submitted";
        w.version++;
        w.history.push({
          at: now(),
          actor: u.name,
          action: "submitted",
          note: "人工确认 AI 检查工单",
        });
        const alarm = sc.alarms.find((a) => a.id === w.eventId);
        if (alarm?.status === "acknowledged") {
          alarm.status = "handling";
          alarm.history.push({
            at: now(),
            actor: u.name,
            action: "handling",
            note: w.id,
          });
        }
        audit(s, u, "workorder.transition", w.id, "submit");
        result = w;
      }
      t.status = "completed";
      t.steps.push({
        tool: "humanApproval",
        status: "completed",
        detail: u.name,
      });
      audit(s, u, "ai.approve", id, "人工确认");
      return result;
    });
  }
  async restoreDashboard(u: User, id: string, target: number, version: number) {
    permit(u, "dashboard:write");
    const s = await this.db.read();
    const d = s.dashboards.find((d) => d.id === id && d.ownerId === u.id);
    if (!d) throw new NotFoundException();
    const old = d.history.find((h) => h.version === target);
    if (!old) throw new NotFoundException("版本不存在");
    return this.saveDashboard(u, old.layout, id, version);
  }
  async datasets(u: User, layout: DashboardLayout) {
    validateLayout(layout, u);
    const app = await this.snapshot(u);
    if (
      !app.features.health &&
      layout.widgets.some((w) => w.dataset === "energy")
    )
      throw new ForbiddenException("健康分析模块已停用");
    return Object.fromEntries(
      layout.widgets.map((w) => {
        let rows =
          w.dataset === "rain"
            ? app.rain.filter((r) =>
                layout.areas.includes(r.area as "north" | "south"),
              )
            : w.dataset === "energy"
              ? app.assets
                  .filter(
                    (a) =>
                      a.type === "pump" &&
                      layout.areas.includes(a.area as "north" | "south"),
                  )
                  .map((a) => ({
                    label: a.name,
                    area: a.area,
                    value: health(a).specificEnergy,
                    energy: a.energy,
                  }))
              : app.alarms
                  .filter((a) => a.status !== "closed")
                  .map((a) => ({
                    label: a.title,
                    area: app.assets.find((x) => x.id === a.assetId)!.area,
                    value: 1,
                    energy: null,
                  }));
        if (w.dataset === "rain" && layout.range === "latest2")
          rows = rows.filter((r) => r.label !== "雨次 1");
        if (w.sort !== "default")
          rows.sort(
            (a, b) =>
              ((a.value ?? 0) - (b.value ?? 0)) * (w.sort === "asc" ? 1 : -1),
          );
        return [
          w.id,
          rows.map((row) => ({
            ...row,
            dataMode: w.dataset === "energy" ? "CALC" : "SIM",
            scenarioId: app.scenarioId,
            asOf,
            metricCode:
              w.dataset === "rain"
                ? "rain.collected_m3"
                : w.dataset === "energy"
                  ? "pump.specific_kwh_m3"
                  : "alarm.open_count",
            unit:
              w.dataset === "rain"
                ? "m³"
                : w.dataset === "energy"
                  ? "kWh/m³"
                  : "条",
            quality: row.value === null ? "missing" : "simulated",
            ...(w.dataset === "energy"
              ? {
                  formulaVersion: "specific-energy-1.0",
                  assumptions: ["同类型、同边界、标准模拟负荷"],
                  inputRefs: ["asset.energy", "asset.volume"],
                }
              : {}),
          })),
        ];
      }),
    );
  }
}

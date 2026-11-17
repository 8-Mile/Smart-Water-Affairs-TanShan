import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  defaultLayout,
  type DashboardLayout,
  type User,
  type AiTask,
} from "@water/contracts";
import { Service, permit, audit, now, validateLayout } from "./service";
export class AiService {
  constructor(private service: Service) {}
  async run(
    u: User,
    prompt: string,
    layout?: DashboardLayout,
    assetId?: string,
  ) {
    const app = await this.service.snapshot(u);
    const task: AiTask = {
      id: randomUUID(),
      ownerId: u.id,
      scenarioId: app.scenarioId,
      epoch: app.epoch,
      status: "running",
      mode: "规则/预置模板",
      prompt,
      modelVersion: "rules-1.0",
      steps: [],
      output: "",
      createdAt: now(),
    };
    await this.service.db.mutate((s) => {
      s.tasks.push(task);
      audit(s, u, "ai.start", task.id, prompt);
    });
    try {
      if (/PLC|联锁|启动.*泵|启停|修改运行状态|控制指令/i.test(prompt))
        throw new ForbiddenException("DEMO 不提供真实生产控制通路");
      if (/无权|其他区域|南区/.test(prompt) && !u.scopes.includes("south"))
        throw new ForbiddenException("请求涉及未授权区域");
      if (/粉尘|寿命|不存在|虚构/.test(prompt))
        throw new BadRequestException("缺少注册指标，不能生成该分析");
      task.steps.push({
        tool: "validatePermission",
        status: "completed",
        detail: `用户 ${u.name}；区域 ${u.scopes.join("/")}`,
      });
      if (/泵|能耗|健康/.test(prompt) && !/图|表|看板/.test(prompt)) {
        if (!app.features.health)
          throw new BadRequestException("健康分析模块已停用");
        const target = assetId ?? "medium-pressure-2n";
        const asset = app.assets.find((a) => a.id === target);
        if (!asset) throw new BadRequestException("设备不存在或无权访问");
        const h = app.health.find((h) => h.assetId === target);
        if (!h) throw new BadRequestException("所选对象不支持泵组能效分析");
        task.steps.push({
          tool: "queryAsset + compareEnergy",
          status: "completed",
          detail: `${asset.id}；能耗 ${asset.energy} kWh / 水量 ${asset.volume} m³`,
        });
        task.output = `${asset.name}：单位水电耗 ${h.specificEnergy === null ? "不可计算" : h.specificEnergy.toFixed(3) + " kWh/m³"}；规则健康分 ${h.score ?? "不可计算"}。依据：${h.reasons.join("；")}。建议核查过滤器、轴承与计量数据，尚不能据此确定故障原因。SIM 演示数据。`;
        if (/工单|检查任务/.test(prompt)) {
          permit(u, "workorder:create");
          const w = await this.service.db.mutate((s) =>
            this.service.createWork(
              s,
              u,
              {
                assetId: asset.id,
                eventId: app.alarms.find((a) => a.assetId === asset.id)?.id,
                title: `${asset.name}检查`,
                description: task.output,
              },
              app.epoch,
            ),
          );
          task.workorderId = w.id;
          task.status = "awaiting_approval";
          task.steps.push({
            tool: "draftWorkOrder",
            status: "completed",
            detail: w.id,
          });
        } else task.status = "completed";
      } else {
        permit(u, "dashboard:write");
        let next = structuredClone(layout ?? defaultLayout(u.scopes));
        if (
          process.env.AI_GATEWAY_URL &&
          process.env.AI_FORCE_OFFLINE !== "1"
        ) {
          try {
            const response = await fetch(process.env.AI_GATEWAY_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(process.env.AI_API_KEY
                  ? { Authorization: `Bearer ${process.env.AI_API_KEY}` }
                  : {}),
              },
              body: JSON.stringify({
                prompt,
                layout: next,
                context: { scenarioId: app.scenarioId, areas: u.scopes },
                contract: "water-dashboard-1.0",
                allowedDatasets: ["rain", "energy", "alarms"],
                allowedComponents: [
                  "KpiCard",
                  "LineChart",
                  "BarChart",
                  "DualAxisChart",
                  "DataTable",
                  "TextSummary",
                  "AlertList",
                ],
              }),
              signal: AbortSignal.timeout(12000),
            });
            if (!response.ok)
              throw new Error(`模型网关 HTTP ${response.status}`);
            const output = (await response.json()) as { layout: unknown };
            next = validateLayout(output.layout, u);
            task.mode = "模型";
            task.modelVersion = process.env.AI_MODEL ?? "gateway";
          } catch (e) {
            task.steps.push({
              tool: "modelGateway",
              status: "failed",
              detail: e instanceof Error ? e.message : "模型失败",
            });
            throw new BadRequestException(
              "模型服务超时或返回无效页面；旧版本已保留，可选择离线模板重试",
            );
          }
        } else {
          task.steps.push({
            tool: "templateEngine",
            status: "completed",
            detail: "明确的离线模板解析，不代表实时大模型理解",
          });
          if (
            !/雨|柱|折线|表|图|总量|平均|降序|升序|移|隐藏|删除|能耗|电耗|保存|撤销/.test(
              prompt,
            )
          )
            throw new BadRequestException(
              "离线模式仅支持页面列出的分析模板与修改指令",
            );
          const target =
            next.widgets.find((w) =>
              ["BarChart", "LineChart", "DualAxisChart"].includes(w.type),
            ) ?? next.widgets.find((w) => !w.locked);
          if (!target)
            throw new BadRequestException("没有可修改的图表，请恢复默认模板");
          if (/泵|能耗/.test(prompt)) {
            target.dataset = "energy";
            target.title = "同类泵单位水电耗";
          }
          if (/折线/.test(prompt) && !/电量|电耗折线/.test(prompt))
            target.type = "LineChart";
          else if (/柱/.test(prompt)) target.type = "BarChart";
          if (/电量|电耗折线/.test(prompt)) {
            const rows =
              target.dataset === "rain"
                ? app.rain
                : app.assets.filter((a) => a.type === "pump");
            if (rows.some((r) => r.energy === null)) {
              task.output =
                "电耗缺少归属或采样，不能生成组合图；保留原有收水量图。";
            } else target.type = "DualAxisChart";
          }
          if (
            /汇总表|统计表|加.*表/.test(prompt) &&
            !next.widgets.some((w) => w.id === "summary-table")
          )
            next.widgets.push({
              ...target,
              id: "summary-table",
              type: "DataTable",
              title: "统计明细",
              x: 0,
              y: 6,
              w: 12,
              h: 4,
              locked: false,
            });
          if (/总量|平均/.test(prompt)) {
            if (/平均/.test(prompt)) target.average = true;
            if (
              /总量/.test(prompt) &&
              !next.widgets.some((w) => w.id === "total")
            )
              next.widgets.push({
                ...target,
                id: "total",
                type: "KpiCard",
                title: "合计",
                x: 8,
                y: 2,
                w: 4,
                h: 3,
                locked: false,
              });
          }
          if (/降序/.test(prompt))
            next.widgets.forEach((w) => {
              if (!w.locked) w.sort = "desc";
            });
          if (/升序/.test(prompt))
            next.widgets.forEach((w) => {
              if (!w.locked) w.sort = "asc";
            });
          if (/左上/.test(prompt)) {
            target.x = 0;
            target.y = 2;
          }
          if (/隐藏|删除/.test(prompt)) {
            if (/告警|安全/.test(prompt))
              throw new BadRequestException("关键告警组件不可删除");
            next.widgets = next.widgets.filter((w) => w.id !== target.id);
          }
        }
        next = validateLayout(next, u);
        task.layout = next;
        task.output ||=
          "页面差异草案已生成。请检查预览后确认保存；旧看板尚未变更。";
        task.status = "awaiting_approval";
        task.steps.push({
          tool: "queryMetrics + validateSchema",
          status: "completed",
          detail: "指标白名单、区域范围、锁定组件检查通过",
        });
      }
    } catch (e) {
      task.status = "failed";
      task.output = e instanceof Error ? e.message : "AI 任务失败";
      task.steps.push({
        tool: "validation",
        status: "failed",
        detail: task.output,
      });
    }
    await this.service.db.mutate((s) => {
      const current = s.tasks.find((t) => t.id === task.id)!;
      if (s.epoch !== task.epoch) {
        current.status = "cancelled";
        current.output = "场景已切换，结果已作废";
        return;
      }
      Object.assign(current, task);
      audit(s, u, "ai.result", task.id, task.status);
    });
    return (await this.service.db.read()).tasks.find((t) => t.id === task.id)!;
  }
}

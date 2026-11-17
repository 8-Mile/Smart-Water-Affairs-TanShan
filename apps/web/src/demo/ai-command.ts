import type { RouteLocationRaw } from "vue-router";
import type { Action } from "./permissions";
import type { ParsedIntent } from "./intent";
import type { Asset, MeasurePoint, Alarm, WorkOrder } from "./types";

export type CommandCategory = "navigation" | "query" | "analysis" | "customization" |
  "configuration" | "operations" | "report" | "decision";

export interface AiCommand {
  intent: CommandCategory;
  target: { assetId?: string; subsystemId?: string; alarmId?: string; workOrderId?: string };
  parameters: { pointId?: string; range?: string; status?: string; prompt: string };
  context: { scenarioId: string; role: string; returnTo: string };
  permission: Action;
  execution: { tool: string; status: "ready" | "blocked" | "done"; result?: string };
  navigation?: RouteLocationRaw;
}

interface CommandInputs {
  asset?: Asset;
  points: MeasurePoint[];
  alarm?: Alarm;
  order?: WorkOrder;
  context: AiCommand["context"];
  explicitSubsystem?: string;
  currentWorkspace?: boolean;
  currentTrend?: { pointId?: string; range?: string };
}

export function planCommand(parsed: ParsedIntent, input: CommandInputs): AiCommand {
  const { asset, alarm, order, context } = input;
  const text = parsed.prompt;
  const target = { assetId: asset?.id, subsystemId: asset?.subsystemId ?? parsed.subsystemId,
    alarmId: alarm?.id, workOrderId: order?.id };
  const command: AiCommand = {
    intent: "query", target, parameters: { prompt: text }, context, permission: "ai:ask",
    execution: { tool: "intent.resolve", status: "ready" },
  };
  function go(intent: CommandCategory, name: string, query: Record<string, string> = {}, subsystemId?: string) {
    command.intent = intent;
    command.execution.tool = "navigation.open";
    command.navigation = { name, params: subsystemId ? { subsystemId } : {},
      query: { ...query, returnTo: context.returnTo.split("?")[0] } };
  }
  function block(reason: string) {
    command.execution.status = "blocked";
    command.execution.result = reason;
  }
  if (["create_asset", "add_measure_point", "move_process_binding"].includes(parsed.kind)) {
    command.intent = "configuration";
    command.permission = parsed.kind === "create_asset" ? "asset:create" :
      parsed.kind === "add_measure_point" ? "point:add" : "binding:write";
    command.execution.tool = parsed.kind;
    return command;
  }
  if (parsed.kind === "knowledge_query") {
    command.intent = "query";
    command.permission = "ai:ask";
    command.execution.tool = "knowledge.search";
    if(parsed.errors.length)block(parsed.errors.map(e=>e.message).join("；"));
    return command;
  }
  if (parsed.kind === "handover_workflow") {
    command.intent = "report";
    command.permission = "ai:ask";
    command.execution.tool = "handover.workflow";
    return command;
  }
  if (parsed.kind === "water_workflow") {
    command.intent = "decision";
    command.permission = "ai:ask";
    command.execution.tool = "water.workflow";
    if (parsed.errors.length) block(parsed.errors.map(e=>e.message).join("；"));
    return command;
  }
  if (parsed.kind === "query" && /(中水|自来水|循环水|雨水|水资源|回用水)/.test(text)
    && /(用了多少|使用了多少|用水量|用量|补水量|回用量|循环量|多少水|水量多少|今天|今日|本月|本周)/.test(text)) {
    command.intent="query";
    command.execution.tool="water.ledger.read";
    return command;
  }
  if (parsed.kind === "query" && parsed.topic) {
    // 射雾器查询由本地规则计算，保留在 AI 抽屉内展示，不做跳转。
    command.intent = "query";
    command.execution.tool = "spray.local";
    return command;
  }
  if (parsed.kind === "compose_ui" && parsed.subsystemId === "spray") {
    command.intent = "report";
    command.execution.tool = "navigation.open";
    command.navigation = { name: "ai-workspace", query: { prompt: text } };
    return command;
  }
  if (parsed.reason?.startsWith("DEMO 无")) { block(parsed.reason); return command; }
  if (/(打开|查看).*(工单)/.test(text)) {
    if (order) go("operations", "workorders", { workOrderId: order.id });
    else if (/刚才|这张|此/.test(text)) block("当前任务没有可打开的工单");
    else go("operations", "workorders", asset ? { assetId: asset.id } : {});
  } else if (/(处理|查看|查询|打开).*(告警)/.test(text)) {
    if (/这条|当前|此条/.test(text) && !alarm) block("请先选择一条告警");
    else go("operations", "alarms", alarm ? { alarmId: alarm.id } :
      /未处理|未确认|活动/.test(text) ? { status: "active" } : {});
  } else if (parsed.kind === "diagnose_asset" || /结合.*(档案|维修)|生成.*检查工单|创建.*检查工单/.test(text)) {
    command.intent = "decision";
    command.execution.tool = "diagnose";
    if (!asset) block(parsed.errors[0]?.message ?? "请先明确诊断设备");
  } else if (/比较|对比|更节能/.test(text) && /能耗|能效|节能/.test(text)) {
    command.intent = "analysis";
    block("现有测点缺少可比的电耗数据，无法比较能效");
  } else if (/(库容|储量).*(应对|降雨|风险)/.test(text) && /下一|能否|风险/.test(text)) {
    go("decision", "four-pre");
  } else if (/维修记录|巡检记录|技术档案|设备档案/.test(text)) {
    go("operations", /档案/.test(text) ? "archives" : "assets", {
      ...(asset ? { assetId: asset.id } : {}), tab: /档案/.test(text) ? "documents" : "records",
    });
  } else if (asset && input.currentTrend && /改成|换成/.test(text) && /柱状|折线/.test(text)) {
    const { pointId, range } = input.currentTrend;
    go("customization", "process", { assetId: asset.id, tab: "trend",
      ...(pointId ? { pointId } : {}), ...(range ? { range } : {}),
      chartType: /柱状/.test(text) ? "bar" : "line" }, asset.subsystemId);
  } else if (/趋势|振动|历史/.test(text) && asset && (parsed.kind !== "compose_ui" || /改成/.test(text))) {
    const metric = /振动|温度|电流|压力|流量/.exec(text)?.[0];
    const point = metric ? input.points.find(item => item.label.includes(metric)) : undefined;
    if (metric && !point) block("该设备未配置所请求的测点");
    else {
      const days = /(?:近|过去)\s*(\d+)\s*[天日]/.exec(text)?.[1];
      if (days && days !== "7" && days !== "14") block("趋势时间范围支持近 24 小时、7 天和 14 天");
      else {
        command.parameters = { ...command.parameters, pointId: point?.id, range: days ? days + "d" : undefined };
        go("query", "process", { assetId: asset.id, tab: "trend",
          ...(point ? { pointId: point.id } : {}), ...(days ? { range: days + "d" } : {}) }, asset.subsystemId);
      }
    }
  } else if (parsed.kind === "compose_ui" || /分析.*降雨|比较.*雨次|保存|删除.*组件/.test(text)) {
    command.intent = /首页|当前页面/.test(text) ? "customization" : "report";
    if (input.currentWorkspace) go("customization", "ai-workspace", { prompt: text });
    else if (command.intent === "customization" || !/雨|降雨/.test(text)) block("当前可从全局 AI 生成雨次分析；组件编辑请在个人工作台操作");
    else go("report", "ai-workspace", { prompt: text });
  } else if (/打开|进入|查看|查询|看一下/.test(text)) {
    if (asset && parsed.targetAssetCode && text.toUpperCase().includes(parsed.targetAssetCode.toUpperCase())) go("navigation", "assets", { assetId: asset.id });
    else if (input.explicitSubsystem) go("navigation", "process", {}, input.explicitSubsystem);
    else if (asset) go("navigation", "assets", { assetId: asset.id });
    else block(parsed.errors[0]?.message ?? "请指定可识别的工艺或设备");
  } else block(parsed.reason ?? "该指令暂未注册可执行工具");
  return command;
}

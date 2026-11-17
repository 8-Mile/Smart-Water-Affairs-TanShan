import type { AssetDraft, PointDraft } from "./commands";
import { parseWaterWorkflow, type WaterWorkflowRequest } from "./waterAiWorkflow";
import { isHandoverRequest } from "./handover";
import { parseKnowledgeRequest, type KnowledgeQuery } from "./knowledge";
import type { Asset, MeasurePoint, ScenarioSeed } from "./types";

export type IntentKind =
  | "create_asset"
  | "add_measure_point"
  | "move_process_binding"
  | "diagnose_asset"
  | "compose_ui"
  | "knowledge_query"
  | "handover_workflow"
  | "water_workflow"
  | "query"
  | "unsupported";

/** 射雾器页面的只读查询主题，由本地规则计算回答，不做模型推理。 */
export type QueryTopic =
  | "spray-runtime"
  | "spray-pressure"
  | "spray-area"
  | "spray-water"
  | "spray-check";

export interface IntentContext {
  subsystemId?: string;
  assetId?: string;
}

export interface IntentIssue {
  field: string;
  message: string;
}

/** 解析出的测点草稿，额外记录命中的关键词，便于向导标注来源。 */
export interface IntentPointSpec extends PointDraft {
  parsedFrom?: string;
}

export interface ParsedAssetInfo {
  code?: string;
  name?: string;
  type?: string;
  typeSource: "parsed" | "default";
  rated: { powerKw?: number; flowM3h?: number; headM?: number };
  ratedSource: Record<"powerKw" | "flowM3h" | "headM", "parsed" | "missing">;
  /** 指令是否要求在工艺图上显示，坐标一律交给人工点选。 */
  wantsBinding: boolean;
}

export interface ParsedIntent {
  kind: IntentKind;
  prompt: string;
  subsystemId?: string;
  asset?: ParsedAssetInfo;
  points: IntentPointSpec[];
  targetAssetId?: string;
  targetAssetCode?: string;
  requiresPick: boolean;
  errors: IntentIssue[];
  missingFields: string[];
  capabilities: string[];
  examples: string[];
  route?: string;
  /** 仅水务AI工具使用：明确的业务、参数和拒绝原因。 */
  waterWorkflow?: WaterWorkflowRequest;
  /** 只读的设备原文摘录查询，不自动生成故障根因。 */
  knowledgeQuery?: KnowledgeQuery;
  /** 仅 query 使用：射雾器本地可计算主题。 */
  topic?: QueryTopic;
  reason?: string;
}

export const SUPPORTED_CAPABILITIES = [
  "新增设备：识别编号、名称、额定功率/流量/扬程与目标子系统，生成五步确认向导",
  "追加测点：为已有设备增加数值或状态测点，不创建第二台设备",
  "健康诊断：跳转健康与能效页，按同一 assetId 查看评分、趋势与证据",
  "通用查询：读取本地 Mock 设备、测点与告警统计，不编造结论",
  "水务自动办事：解析雨前调蓄、三水源分配和集中值守事件查询；计算后可经人工确认保存方案草稿",
  "多步骤运行交班：调用本次巡查、值守事件、告警、工单及健康模型，生成有覆盖边界的待审核交班报告",
  "知识库证据核验：按设备检索已审核原文、版本章节及维修履历；缺失资料时拒绝推断根因",
];

export const SUPPORTED_EXAMPLES = [
  "在射雾器除尘系统新增一台3号供水泵，编号P-003，额定功率45kW、流量120m³/h、扬程60m。增加出口压力、电流、流量和运行状态四个测点。",
  "给P-002增加轴承温度测点",
  "诊断P-002的健康趋势",
  "分析未来80毫米降雨并比较雨前调蓄方案",
  "比较雨水、中水、自来水的供水经济方案",
  "查询当前无人值守待处理事件",
  "帮我完成今天的运行检查，整理异常情况，生成交班报告",
  "查找P-002振动异常的诊断依据",
];

export const COMMAND_CATALOG = [
  {
    id: "create_asset",
    label: "新增设备",
    example:
      "在射雾器除尘系统新增一台3号供水泵，编号P-003，额定功率45kW、流量120m³/h、扬程60m。增加出口压力、电流、流量和运行状态四个测点。",
    supported: true,
  },
  {
    id: "add_measure_point",
    label: "追加测点",
    example: "给P-002增加轴承温度测点",
    supported: true,
  },
  {
    id: "diagnose_asset",
    label: "健康诊断",
    example: "诊断P-002的健康趋势",
    supported: true,
  },
  {
    id: "compose_ui",
    label: "生成图表",
    example: "对比最近三次降雨南北储量并做成折线图",
    supported: true,
  },
  {
    id: "water_dispatch",
    label: "雨前方案分析",
    example: "分析未来80毫米降雨并比较雨前调蓄方案",
    supported: true,
  },
  {
    id: "multi_source",
    label: "三水源优化",
    example: "比较雨水、中水、自来水的供水经济方案",
    supported: true,
  },
  {
    id: "handover_workflow",
    label: "多步骤交班报告",
    example: "帮我完成今天的运行检查，整理异常情况，生成交班报告",
    supported: true,
  },
  {
    id: "knowledge_query",
    label: "知识证据核验",
    example: "查找P-002振动异常的诊断依据",
    supported: true,
  },
  {
    id: "duty_events",
    label: "值守事件查询",
    example: "查询当前无人值守待处理事件",
    supported: true,
  },
  {
    id: "control",
    label: "不受支持：生产控制",
    example: "启动P-002水泵",
    supported: false,
  },
];

const SUBSYSTEM_KEYWORDS: { id: string; words: string[] }[] = [
  { id: "spray", words: ["射雾", "除尘"] },
  { id: "mining", words: ["含矿"] },
  { id: "rainwater", words: ["雨水"] },
  { id: "pool", words: ["水池"] },
  { id: "domestic", words: ["生活污水"] },
  { id: "medium-pressure", words: ["中压", "供水泵", "供水"] },
];

const CONTROL_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "启停设备", regex: /(启动|开机|开启|停泵|停机|停止运行|关闭设备)/ },
  { label: "阀门/参数调节", regex: /(调节|调整|开度|阀门|设定值|改阈值|阈值调整|调高|调低)/ },
  { label: "远程控制", regex: /(下发|控制指令|远程控制|联锁)/ },
];

const QUESTION_WORDS = /(为什么|原因|是否|如何|怎么|吗|[?？])/;

function readNumber(prompt: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function detectSubsystem(
  prompt: string,
  context: IntentContext,
  seed: ScenarioSeed,
): string | undefined {
  let best: { id: string; index: number } | undefined;
  for (const group of SUBSYSTEM_KEYWORDS) {
    for (const word of group.words) {
      const index = prompt.indexOf(word);
      if (index < 0) continue;
      if (!best || index < best.index) best = { id: group.id, index };
    }
  }
  return best?.id ?? seed.subsystems.find(item => item.id === context.subsystemId)?.id;
}

function detectCode(prompt: string): string | undefined {
  const match = /(?:^|[^A-Z0-9])([A-Z]{1,3}-\d{3})(?!\d)/i.exec(prompt);
  return match ? match[1].toUpperCase() : undefined;
}

function detectName(prompt: string): string | undefined {
  const match = /(?:新增(?:一台|一个|1台|一套)?|增加(?:一台|一个|1台|一套))\s*([^，。,；;\s]{1,24})/.exec(prompt);
  if (!match) return undefined;
  const name = match[1].replace(/^(?:设备|一台)/, "").trim();
  if (!name || /^(?:编号|P-\d{3})/i.test(name)) return undefined;
  return name;
}

const TYPE_SUFFIXES = [
  "射雾器",
  "罗茨风机",
  "供水泵",
  "提升泵",
  "补水泵",
  "回用泵",
  "离心泵",
  "潜水泵",
  "螺杆泵",
  "计量泵",
  "风机",
];

function detectType(name: string | undefined): { type: string; source: "parsed" | "default" } {
  if (name) {
    for (const suffix of TYPE_SUFFIXES) {
      if (name.includes(suffix)) return { type: suffix, source: "parsed" };
    }
    if (name.includes("泵")) return { type: "泵类设备", source: "parsed" };
    if (name.includes("风机")) return { type: "风机", source: "parsed" };
  }
  return { type: "工艺设备", source: "default" };
}

interface PointRule {
  keys: string[];
  label: string;
  kind: "number" | "enum";
  unit?: string;
  baseline: number;
  volatility?: number;
  range?: [number, number];
  enumStates?: string[];
  skip?: (prompt: string) => boolean;
}

const POINT_RULES: PointRule[] = [
  {
    keys: ["出口压力"],
    label: "出口压力",
    kind: "number",
    unit: "MPa",
    baseline: 0.6,
    volatility: 0.03,
    range: [0, 2],
  },
  {
    keys: ["轴承温度"],
    label: "轴承温度",
    kind: "number",
    unit: "℃",
    baseline: 62,
    volatility: 1.2,
    range: [0, 120],
  },
  {
    keys: ["温度"],
    label: "温度",
    kind: "number",
    unit: "℃",
    baseline: 60,
    volatility: 1.2,
    range: [0, 120],
    skip: (prompt) => prompt.includes("轴承温度"),
  },
  {
    keys: ["振动", "震动"],
    label: "振动速度",
    kind: "number",
    unit: "mm/s",
    baseline: 2.1,
    volatility: 0.15,
    range: [0, 10],
  },
  {
    keys: ["液位", "水位"],
    label: "液位",
    kind: "number",
    unit: "m",
    baseline: 2.5,
    volatility: 0.1,
    range: [0, 10],
  },
  {
    keys: ["电流"],
    label: "电机电流",
    kind: "number",
    unit: "A",
    baseline: 30,
    volatility: 1,
    range: [0, 200],
  },
  {
    keys: ["流量"],
    label: "流量",
    kind: "number",
    unit: "m³/h",
    baseline: 100,
    volatility: 2,
    range: [0, 300],
  },
  {
    keys: ["运行状态", "状态"],
    label: "运行状态",
    kind: "enum",
    baseline: 0,
    enumStates: ["运行", "停机", "故障", "未知"],
  },
  {
    keys: ["压力"],
    label: "压力",
    kind: "number",
    unit: "MPa",
    baseline: 0.6,
    volatility: 0.03,
    range: [0, 2],
    skip: (prompt) => prompt.includes("出口压力"),
  },
];

function pointsFromPrompt(
  prompt: string,
  rated: { powerKw?: number; flowM3h?: number },
  deviceType?: string,
): IntentPointSpec[] {
  const points: IntentPointSpec[] = [];
  const labels = new Set<string>();
  for (const rule of POINT_RULES) {
    if (rule.skip?.(prompt)) continue;
    const key = rule.keys.find((item) => prompt.includes(item));
    if (!key || labels.has(rule.label)) continue;

    let baseline = rule.baseline;
    let range = rule.range;
    if (rule.label === "电机电流" && rated.powerKw) {
      baseline = Math.round(rated.powerKw * 1.9 * 10) / 10;
      range = [0, Math.round(rated.powerKw * 4)];
    }
    if (rule.label === "流量" && rated.flowM3h) {
      baseline = Math.round(rated.flowM3h * 0.92);
      range = [0, Math.max(Math.round(rated.flowM3h * 1.5), 200)];
    }

    const label = deviceType === '射雾器' && rule.label === '压力' ? '末端压力' : deviceType === '射雾器' && rule.label === '流量' ? '喷射流量' : rule.label;
    labels.add(rule.label);
    points.push({
      label,
      kind: rule.kind,
      unit: rule.kind === "number" ? rule.unit : undefined,
      range: rule.kind === "number" ? range : undefined,
      source: "MOCK",
      quality: "estimated",
      samplePeriodMinutes: 30,
      baseline,
      volatility: rule.kind === "number" ? rule.volatility : undefined,
      enumStates: rule.kind === "enum" ? [...(rule.enumStates ?? [])] : undefined,
      parsedFrom: key,
    });
  }
  return points;
}

function detectExplicitAsset(
  prompt: string,
  assets: Asset[],
): { asset?: Asset; code?: string } {
  const match = /([A-Z]{1,3}-\d{3})/i.exec(prompt);
  if (!match) return {};
  const code = match[1].toUpperCase();
  return {
    code,
    asset: assets.filter(item => !item.archived && item.code.trim().toUpperCase() === code).length === 1
      ? assets.find(item => !item.archived && item.code.trim().toUpperCase() === code) : undefined,
  };
}

function resolveTarget(
  prompt: string,
  context: IntentContext,
  assets: Asset[],
): { asset?: Asset; code?: string; error?: IntentIssue; missing?: string } {
  const explicit = detectExplicitAsset(prompt, assets);
  if (explicit.code) {
    if (!explicit.asset) {
      return {
        code: explicit.code,
        error: {
          field: "assetId",
          message: `未找到编号为 ${explicit.code} 的设备，请先确认设备台账`,
        },
      };
    }
    return { asset: explicit.asset, code: explicit.code };
  }
  const shortName = /\d+号[^\s，。]{0,4}泵/.exec(prompt)?.[0];
  const fullMatches = assets.filter(item => !item.archived && prompt.includes(item.name));
  const named = fullMatches.length ? fullMatches : assets.filter(item => !item.archived && shortName && item.name.includes(shortName));
  if (named.length === 1) return { asset: named[0], code: named[0].code };
  if (named.length > 1) return { error: { field: "assetId", message: "匹配到多台设备，请输入完整编号" } };
  if (context.assetId) {
    const asset = assets.find((item) => item.id === context.assetId && !item.archived);
    if (asset) return { asset, code: asset.code };
  }
  return {
    missing: "assetId",
    error: { field: "assetId", message: "未识别到目标设备，请补充设备编号（如 P-002）" },
  };
}

function wantsBinding(prompt: string): boolean {
  return /(工艺图|工艺底图|图上|图中)/.test(prompt) && /(显示|布置|绑定|标|放|加入|挂)/.test(prompt);
}

function isSupportedQuery(prompt: string): boolean {
  return /(哪些|什么|多少|状态|趋势|查询|查看|情况|列表|测点|告警|设备|振动|温度|电流|压力|流量|维修|工单)/.test(prompt);
}

/** 射雾器页面可本地计算的查询主题；无法归类时不返回主题，按原有逻辑处理。 */
function detectSprayTopic(
  prompt: string,
  context: IntentContext,
): QueryTopic | undefined {
  const mentionsSpray =
    /(射雾器|射雾|喷雾|除尘|堆场)/.test(prompt) || context.subsystemId === "spray";
  if (!mentionsSpray) return undefined;
  if (/(检查任务|检查工单|工单草稿|生成.*检查)/.test(prompt)) return "spray-check";
  if (/(用水量|用水|节水|运行方案|运行计划)/.test(prompt)) return "spray-water";
  if (/(区域|堆场|A区|B区).*(作业|状态)|作业状态|生产状态/.test(prompt)) return "spray-area";
  if (/压力/.test(prompt)) return "spray-pressure";
  if (/(运行设备|哪些.*(运行|停机)|异常|告警)/.test(prompt)) return "spray-runtime";
  return undefined;
}

function resultBase(
  kind: IntentKind,
  prompt: string,
): Pick<ParsedIntent, "kind" | "prompt" | "capabilities" | "examples"> {
  return {
    kind,
    prompt,
    capabilities: [...SUPPORTED_CAPABILITIES],
    examples: [...SUPPORTED_EXAMPLES],
  };
}

/**
 * 本地规则意图解析。不调用模型、不猜测编号与坐标：
 * 缺字段返回 errors/missingFields，由向导让用户补齐。
 */
export function parseIntent(
  prompt: string,
  context: IntentContext,
  seed: ScenarioSeed,
  assets: Asset[],
  points: MeasurePoint[],
): ParsedIntent {
  const text = prompt.trim();
  const base = resultBase("unsupported", text);
  if (!text) {
    return {
      ...base,
      errors: [{ field: "prompt", message: "请输入指令" }],
      missingFields: ["prompt"],
      requiresPick: false,
      points: [],
      reason: "空指令不执行任何操作，也不会猜测设备或测点。",
    };
  }

  const isQuestion = QUESTION_WORDS.test(text);
  const control = CONTROL_PATTERNS.find((item) => item.regex.test(text));
  if (control && !isQuestion) {
    return {
      ...base,
      errors: [],
      missingFields: [],
      requiresPick: false,
      points: [],
      reason: `DEMO 无生产控制能力：不会对真实设备执行「${control.label}」，也不会修改生产阈值或下发控制指令。`,
    };
  }

  // 水量问数应先归入只读水务查询；否则泛用知识检索会把“用了多少”误判为设备诊断。
  const waterUsageQuestion=/(中水|自来水|循环水|雨水|水资源|回用水)/.test(text)
    && /(用了多少|使用了多少|用水量|用量|补水量|回用量|循环量|多少水|水量多少|今天|今日|本月|本周)/.test(text)
    && !/(方案|优化|调度|调蓄|模拟|预测|启动|下发|控制设备)/.test(text);
  if(waterUsageQuestion){
    return {...resultBase("query",text),points:[],requiresPick:false,errors:[],missingFields:[],
      reason:"从已登记水量账本查找统计数据；不支持的时间粒度会明确提示缺数。"};
  }

  const knowledge=parseKnowledgeRequest(text,assets,context.assetId);
  if(knowledge){
    return {
      ...resultBase("knowledge_query",text),
      knowledgeQuery:knowledge.query??undefined,
      targetAssetId:knowledge.query?.assetId,
      points:[],requiresPick:false,missingFields:[],
      errors:knowledge.issue?[{field:"assetId",message:knowledge.issue}]:[],
      reason:knowledge.issue??"仅在当前设备已登记的档案摘录和历史记录中检索，不编造故障原因。",
    };
  }

  if (isHandoverRequest(text)) {
    return {
      ...resultBase("handover_workflow", text),
      points: [], requiresPick: false, errors: [], missingFields: [],
      reason: "执行已配置工艺的本地巡查，关联现有事件、告警、工单和健康规则；生成报告预览，确认后保存草稿。",
    };
  }

  const waterWorkflow = parseWaterWorkflow(text);
  if (waterWorkflow) {
    return {
      ...resultBase("water_workflow", text),
      subsystemId: waterWorkflow.kind === "dispatch" ? "rainwater" : undefined,
      waterWorkflow,
      points: [], requiresPick: false,
      errors: waterWorkflow.issue ? [{ field: "workflow", message: waterWorkflow.issue }] : [],
      missingFields: [],
      reason: waterWorkflow.issue ?? "将调用已实现的本地业务计算引擎；只读分析，不会执行现场控制。",
    };
  }

  const createLike =
    /(新增|新建|创建|增加(?:一台|一个|1台|一套))/.test(text) &&
    (/(设备|泵|射雾器|风机|装置|机组)/.test(text) || /(?:新增|增加)(?:一台|一个|1台|一套)/.test(text));

  if (createLike) {
    const errors: IntentIssue[] = [];
    const missingFields: string[] = [];
    const code = detectCode(text);
    const name = detectName(text);
    const type = detectType(name);
    const subsystemId = detectSubsystem(text, context, seed);
    const powerKw = readNumber(text, [/(?:额定功率|功率)\s*(?:为|是)?\s*([\d.]+)\s*kW/i]);
    const flowM3h = readNumber(text, [/流量\s*(?:为|是)?\s*([\d.]+)\s*m³\s*\/\s*h/i]);
    const headM = readNumber(text, [/扬程\s*(?:为|是)?\s*([\d.]+)\s*m(?![³3])/i]);
    const pointSpecs = pointsFromPrompt(text, { powerKw, flowM3h }, type.type);

    if (!code) {
      missingFields.push("code");
      errors.push({ field: "code", message: "未识别到设备编号，请补充形如 P-003 的编号" });
    }
    if (!name) {
      missingFields.push("name");
      errors.push({ field: "name", message: "未识别到设备名称，请补充设备名称" });
    }
    if (!subsystemId) {
      missingFields.push("subsystemId");
      errors.push({ field: "subsystemId", message: "未识别到目标工艺子系统，请选择" });
    }
    if (!pointSpecs.length) {
      missingFields.push("points");
      errors.push({ field: "points", message: "未识别到测点，请至少保留 1 个测点" });
    }

    if (code && subsystemId) {
      const duplicated = assets.find(
        (item) =>
          item.subsystemId === subsystemId && item.code.trim().toLowerCase() === code.toLowerCase(),
      );
      if (duplicated) {
        const subsystemName =
          seed.subsystems.find((item) => item.id === subsystemId)?.name ?? subsystemId;
        errors.push({
          field: "code",
          message: `编号 ${code} 在「${subsystemName}」中已存在（${duplicated.name}），不能重复创建`,
        });
      }
    }

    return {
      ...resultBase("create_asset", text),
      subsystemId,
      asset: {
        code,
        name,
        type: type.type,
        typeSource: type.source,
        rated: { powerKw, flowM3h, headM },
        ratedSource: {
          powerKw: powerKw === undefined ? "missing" : "parsed",
          flowM3h: flowM3h === undefined ? "missing" : "parsed",
          headM: headM === undefined ? "missing" : "parsed",
        },
        wantsBinding: wantsBinding(text),
      },
      points: pointSpecs,
      requiresPick: false,
      errors,
      missingFields,
    };
  }

  const addPointLike =
    /(增加|新增|追加|添加|补).*(测点|监测点|轴承温度)/.test(text) ||
    /(测点|监测点).*(增加|新增|追加|添加)/.test(text);
  if (addPointLike) {
    const errors: IntentIssue[] = [];
    const missingFields: string[] = [];
    const target = resolveTarget(text, context, assets);
    if (target.error) {
      errors.push(target.error);
      if (target.missing) missingFields.push(target.missing);
    }

    const pointSpecs = pointsFromPrompt(text, {
      powerKw: target.asset?.rated?.powerKw,
      flowM3h: target.asset?.rated?.flowM3h,
    }, target.asset?.type);
    if (!pointSpecs.length) {
      missingFields.push("points");
      errors.push({ field: "points", message: "未识别到要追加的测点，请补充测点名称" });
    }
    if (target.asset) {
      for (const spec of pointSpecs) {
        const existed = points.some(
          (point) =>
            point.assetId === target.asset?.id &&
            point.label.trim().toLowerCase() === spec.label.toLowerCase(),
        );
        if (existed) {
          errors.push({
            field: `point.${spec.label}`,
            message: `设备 ${target.asset.code} 已存在测点「${spec.label}」`,
          });
        }
      }
    }

    return {
      ...resultBase("add_measure_point", text),
      subsystemId: target.asset?.subsystemId ?? context.subsystemId,
      points: pointSpecs,
      targetAssetId: target.asset?.id,
      targetAssetCode: target.asset?.code ?? target.code,
      requiresPick: false,
      errors,
      missingFields,
    };
  }

  const moveLike =
    /(移动|挪|移到|放到|放在|布置|调整|修改|改)/.test(text) &&
    /(工艺图|图上|图中|位置|点位|热点|左上|右上|左下|右下|中间)/.test(text);
  if (moveLike) {
    const target = resolveTarget(text, context, assets);
    const errors: IntentIssue[] = [];
    const missingFields: string[] = [];
    if (target.error) {
      errors.push(target.error);
      if (target.missing) missingFields.push(target.missing);
    }
    return {
      ...resultBase("move_process_binding", text),
      subsystemId: target.asset?.subsystemId ?? context.subsystemId,
      points: [],
      targetAssetId: target.asset?.id,
      targetAssetCode: target.asset?.code ?? target.code,
      requiresPick: true,
      errors,
      missingFields,
      reason:
        "「左上/右上/中间」等文字位置不能可靠换算为 0~1 归一化坐标，请在工艺图上人工点选；该操作仅调整可视化绑定，不代表真实管网连接。",
    };
  }

  const sprayTopic = detectSprayTopic(text, context);
  if (sprayTopic && !/(诊断|健康评分)/.test(text)) {
    const wantsChart =
      /(图表|折线图|柱状图|看板|工作台|生成.*图|做成.*图|可视化)/.test(text) ||
      (/(趋势图|曲线)/.test(text) && /(生成|做成|打开|进入)/.test(text));
    if (wantsChart) {
      return {
        ...resultBase("compose_ui", text),
        subsystemId: "spray",
        points: [],
        requiresPick: false,
        errors: [],
        missingFields: [],
        route: "/data/ai-workspace",
        reason:
          "射雾器趋势图由本地分析工作台按同一测点数据生成；不具备数据的指标会明确提示缺数。",
      };
    }
    return {
      ...resultBase("query", text),
      topic: sprayTopic,
      subsystemId: "spray",
      points: [],
      requiresPick: false,
      errors: [],
      missingFields: [],
    };
  }

  if (/(诊断|健康|异常原因|健康趋势|健康评分)/.test(text) || (isQuestion && /(原因|趋势)/.test(text))) {
    const target = resolveTarget(text, context, assets);
    return {
      ...resultBase("diagnose_asset", text),
      subsystemId: target.asset?.subsystemId ?? context.subsystemId,
      points: [],
      targetAssetId: target.asset?.id,
      targetAssetCode: target.asset?.code ?? target.code,
      requiresPick: false,
      errors: target.error ? [target.error] : [],
      missingFields: [],
      route: target.asset ? `/decision/health?assetId=${target.asset.id}` : "/decision/health",
    };
  }

  if (/(图表|折线图|柱状图|看板|工作台|生成.*图|做成.*图|可视化)/.test(text)) {
    return {
      ...resultBase("compose_ui", text),
      subsystemId: context.subsystemId,
      points: [],
      requiresPick: false,
      errors: [],
      missingFields: [],
      route: "/data/ai-workspace",
    };
  }

  if (isSupportedQuery(text)) {
    const target = resolveTarget(text, context, assets);
    return {
      ...resultBase("query", text),
      subsystemId: target.asset?.subsystemId ?? context.subsystemId,
      points: [],
      targetAssetId: target.asset?.id,
      targetAssetCode: target.asset?.code ?? target.code,
      requiresPick: false,
      errors: target.error ? [target.error] : [],
      missingFields: [],
    };
  }

  return {
    ...base,
    errors: [],
    missingFields: [],
    requiresPick: false,
    points: [],
    reason:
      "未匹配到可执行指令。本地 DEMO 只支持新增设备、追加测点、健康诊断、生成图表与只读查询，不返回预制分析结论。",
  };
}

/** 将解析出的测点规格转为命令层草稿，去掉界面来源字段。 */
export function toPointDraft(spec: IntentPointSpec): PointDraft {
  const { parsedFrom: _parsedFrom, ...rest } = spec;
  return rest;
}

/** 将新增设备意图转为命令层草稿，未选择点位时 binding 为空（未布置）。 */
export function intentToAssetDraft(intent: ParsedIntent): AssetDraft | null {
  if (intent.kind !== "create_asset" || !intent.asset) return null;
  return {
    code: intent.asset.code ?? "",
    name: intent.asset.name ?? "",
    subsystemId: intent.subsystemId ?? "",
    type: intent.asset.type ?? "工艺设备",
    rated: intent.asset.rated,
    points: intent.points.map(toPointDraft),
  };
}

export const KIND_LABELS: Record<IntentKind, string> = {
  create_asset: "新增设备",
  add_measure_point: "追加测点",
  move_process_binding: "调整工艺点位",
  diagnose_asset: "健康诊断",
  compose_ui: "生成图表",
  water_workflow: "水务业务自动办事",
  knowledge_query: "专业知识检索",
  handover_workflow: "多步骤运行交班",
  query: "只读查询",
  unsupported: "不受支持",
};



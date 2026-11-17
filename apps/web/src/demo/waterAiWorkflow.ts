/**
 * AI助手的水务业务工具：确定性中文指令识别 + 已验证计算引擎调用。
 * 此文件不调用大模型；支持明确有限的查询与草稿建议，不支持现场控制。
 */
import { DEFAULT_DISPATCH, evaluateDispatch, type DispatchAssessment } from "./dispatch";
import { cloneMultiSource, evaluateMultiSource, type WaterSupplyResult, type MultiSourceInputs } from "./multisource";
import type { DutyEvent } from "./unattended";

export type WaterWorkflowKind = "dispatch" | "supply" | "duty";
export type SupplyScenario = "normal" | "quality" | "shortage";
export interface WaterWorkflowRequest {
  kind: WaterWorkflowKind;
  rainMm?: number;
  supplyScenario?: SupplyScenario;
  issue?: string;
}
export interface WorkflowMetric { label: string; value: string; }
export interface WaterWorkflowAnswer {
  kind: WaterWorkflowKind;
  title: string;
  resultLines: string[];
  metrics: WorkflowMetric[];
  caveat: string;
  route: string;
  request: WaterWorkflowRequest;
  dispatch?: DispatchAssessment;
  supply?: { inputs: MultiSourceInputs; result: WaterSupplyResult };
}

const cn = new Intl.NumberFormat("zh-CN",{ maximumFractionDigits: 1 });
const m3 = (n: number) => cn.format(n) + " m³";
const yuan = (n: number | null) => n === null ? "不可比较" : (n < 0 ? "−" : "") + "¥" + cn.format(Math.abs(n));
const numericRain = /(?:降雨|降雨量|雨量|雨前|雨情|未来)?\s*(\d+(?:\.\d+)?)\s*(?:毫米|mm)(?![a-z])/gi;

// 禁止伪装为查询的现场操作。parseIntent()另有控制保护，此处二次保证。
const UNSAFE = /(启动|停泵|停机|开机|远程控制|开阀|关阀|阀门开度|执行调度|下发|自动操控|自动切换|更改设定值|修改阈值)/;

export function parseWaterWorkflow(text: string): WaterWorkflowRequest | null {
  const prompt = text.trim();
  if (!prompt || UNSAFE.test(prompt)) return null;

  if (/(集中值守|智能值守|无人值守|值守事件)/.test(prompt)
    && /(查询|查看|总结|汇总|多少|有哪些|当前|待处理|异常|未关闭|状态)/.test(prompt)) {
    return { kind: "duty" };
  }

  const waterSupply = /(多水源|三水源|水源分配|雨水.*中水.*自来水|自来水.*中水.*雨水|水源协同|供水经济优化|供需匹配)/.test(prompt)
    && /(比较|对比|优化|分析|评估|计算|方案|分配|查询|查看|模拟)/.test(prompt);
  if (waterSupply) {
    const quality = /中水.{0,14}(?:水质不达标|不达标|不合格|水质异常)|(?:不达标|不合格).{0,8}中水/.test(prompt);
    const shortage = /(?:供水|水源|供水能力).{0,8}(?:不足|短缺|缺口)/.test(prompt);
    if (quality && shortage) return {
      kind: "supply", issue: "每次只支持一个供水演示情景；请分别查询中水水质不达标或供水能力不足",
    };
    return { kind: "supply", supplyScenario: quality ? "quality" : shortage ? "shortage" : "normal" };
  }

  const rainTask = /(雨前调蓄|雨前腾库|雨水调蓄|降雨预测|降雨风险|降雨方案|库容风险|调蓄方案|降雨.{0,12}(?:调蓄|方案|溢流|库容)|(?:毫米|mm).{0,5}(?:降雨|雨量|暴雨))/.test(prompt)
    && /(分析|计算|比较|对比|预测|评估|方案|调蓄|腾库|模拟|查看|看看)/.test(prompt);
  if (rainTask) {
    const values = [...prompt.matchAll(numericRain)].map(m => Number(m[1]));
    if (values.length > 1) return {kind:"dispatch",issue:"一次只支持一个降雨量；请分别计算不同情景"};
    const rainMm = values.length ? values[0] : DEFAULT_DISPATCH.rainMm;
    if (!Number.isFinite(rainMm) || rainMm < 0 || rainMm > 500) {
      return {kind:"dispatch",issue:"降雨量必须为0至500毫米的有效数值"};
    }
    return { kind: "dispatch", rainMm };
  }
  return null;
}

export function executeWaterWorkflow(request: WaterWorkflowRequest, events: DutyEvent[] = []): WaterWorkflowAnswer {
  if (request.issue) throw new Error(request.issue);
  if (request.kind === "dispatch") {
    const rainMm=request.rainMm??DEFAULT_DISPATCH.rainMm;
    const dispatch=evaluateDispatch({...DEFAULT_DISPATCH,rainMm});
    const baseline=dispatch.options.find(o=>o.kind==="baseline")!;
    const chosen=dispatch.options.find(o=>o.kind===dispatch.recommended)!;
    return {
      kind:"dispatch",title:`雨前调蓄 · ${rainMm}毫米情景`,
      request, dispatch, route:"/water/dispatch",
      metrics:[
        {label:"预计雨水来水",value:m3(chosen.totalInflowM3)},
        {label:"保持现状溢流",value:m3(baseline.overflowM3)},
        {label:"推荐方案溢流",value:m3(chosen.overflowM3)},
        {label:"增量净费用",value:yuan(chosen.incrementalNetCostYuan)},
      ],
      resultLines:[
        `推荐：${chosen.title}。 ${dispatch.recommendationReason}`,
        ...dispatch.options.map(o=>`${o.title}：${o.feasible?"可参与比较":"不可执行（"+o.blockers.join("；")+"）"}；预测溢流${m3(o.overflowM3)}，雨前腾库${m3(o.preReleaseM3)}，增量回用${m3(o.extraReuseM3)}。`),
        `输入口径：降雨${rainMm}mm，其余采用现有页面固定MOCK演示参数（池容${DEFAULT_DISPATCH.capacityM3}m³，时长${DEFAULT_DISPATCH.hours}h）。`,
      ],
      caveat:"由本地水量平衡模型计算；非真实气象预报。排放许可、设备能力、水质和费用均为演示假设；不下发泵阀控制。",
    };
  }
  if (request.kind === "supply") {
    const inputs=cloneMultiSource();
    const scenario=request.supplyScenario??"normal";
    if(scenario==="quality") for(const route of inputs.routes)if(route.sourceId==="reclaimed")route.qualityAccepted=false;
    if(scenario==="shortage"){
      const tap=inputs.sources.find(s=>s.id==="tap")!;
      tap.availableM3=450;tap.deliverableM3=450;
      inputs.sources.find(s=>s.id==="rain")!.availableM3=100;
      inputs.sources.find(s=>s.id==="reclaimed")!.availableM3=100;
    }
    const result=evaluateMultiSource(inputs);
    return {
      kind:"supply",request,route:"/water/multi-source",
      title:scenario==="quality"?"三水源优化 · 中水水质异常模拟":
        scenario==="shortage"?"三水源优化 · 供水不足模拟":"三水源优化 · 常规演示",
      supply:{inputs,result},
      metrics:[
        {label:"本期需水",value:m3(result.requestedM3)},
        {label:"匹配供水",value:m3(result.suppliedM3)},
        {label:"未满足需求",value:m3(result.unmetM3)},
        {label:"假设节约",value:yuan(result.savingVsTapYuan)},
      ],
      resultLines:[
        result.feasible?"本期演示需求全部满足。":"存在供水缺口；关键生产用水优先保障，禁止作为完整运行方案。",
        ...result.uses.map(u=>`${u.label}：需求${m3(u.neededM3)}，可供${m3(u.suppliedM3)}，缺口${m3(u.unmetM3)}。`),
        `雨水${m3(result.sources[0].usedM3)}；中水${m3(result.sources[1].usedM3)}；自来水${m3(result.sources[2].usedM3)}。`,
        result.savingVsTapYuan===null?"全自来水比较不可执行或存在供水缺口，不给出节约金额。":
          `与可行的全自来水比较情景相比，示例增量费用差为${yuan(result.savingVsTapYuan)}。`,
      ],
      caveat:"全部来自本地MOCK供需和路径矩阵；未接入真实水质与管线。雨水、中水按互不重复的独立库存计量，结果不代表实际节约收益。",
    };
  }
  const open=events.filter(e=>e.status!=="closed"&&e.status!=="dismissed");
  return {
    kind:"duty",request,title:"集中值守 · 当前待处理事件",
    route:"/intelligent/unattended",
    metrics:[{label:"当前未关闭事件",value:String(open.length)},{label:"已纳入模拟巡查",value:"中压供水1/6"}],
    resultLines:open.length?
      open.slice(0,8).map(e=>`${e.id} · ${e.title} · ${e.status} · 设备P-002 · 来源MOCK`) :
      ["当前本地值守DEMO没有未关闭事件；这不代表全港六套系统均无异常。"],
    caveat:"查询本地值守事件，不进行设备控制。只有中压供水配置了演示专业巡查，其他五套工艺尚未形成真实监护覆盖。",
  };
}

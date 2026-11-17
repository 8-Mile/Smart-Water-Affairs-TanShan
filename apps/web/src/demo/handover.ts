/**
 * AI多步骤运行检查与交班报告 V1。
 * 输入是已有智能值守、告警、工单、设备及遥测快照；不推断未接入工艺为正常，
 * 不把当前快照写成全天已完成的巡视。所有数据仍为本地模拟/参考。
 */
import { scorePumpHealth, type HealthReadings } from "./health";
import { assertCan } from "./permissions";
import type { Alarm, Asset, Role, WorkOrder } from "./types";
import type { DutyEvent, PatrolRecord } from "./unattended";

export const HANDOVER_STORAGE_KEY = "tanggang-handover-reports-v1";
const LIMIT = 30;

export type HandoverStatus = "pending_review" | "reviewed";
export type TaskStepState = "done" | "blocked";
export interface HandoverStep {
  id: string;
  title: string;
  tool: string;
  status: TaskStepState;
  summary: string;
  evidenceIds: string[];
}
export interface HandoverIssue {
  id: string;
  kind: "duty" | "alarm" | "workorder" | "coverage" | "health";
  title: string;
  detail: string;
  source: "MOCK" | "CALCULATED";
  href: string;
}
export interface HandoverHealth {
  assetId: string;
  code: string;
  score: number | null;
  band: string;
  coverage: number;
  missing: string[];
  sourceTime: string;
}
export interface HandoverReport {
  id: string;
  title: string;
  status: HandoverStatus;
  scenarioId: string;
  preparedAt: string;
  preparedBy: Role;
  referenceTime: string;
  reviewedAt?: string;
  reviewedBy?: Role;
  reviewNote?: string;
  source: "MOCK";
  scope: string;
  patrol: {
    id: string | null;
    at: string | null;
    result: "normal" | "abnormal" | "unknown" | "not_run";
    details: string[];
  };
  coverage: { configured: number; total: number };
  openDutyCount: number;
  activeProductionAlarmCount: number;
  outstandingOrderCount: number;
  health: HandoverHealth | null;
  issues: HandoverIssue[];
  warnings: string[];
  steps: HandoverStep[];
  text: string;
}
export interface HandoverInput {
  scenarioId: string;
  referenceTime: string;
  preparedAt: string;
  preparedBy: Role;
  patrol: PatrolRecord | null;
  activeEvents: DutyEvent[];
  alarms: Alarm[];
  workorders: WorkOrder[];
  healthAsset: Asset | null;
  healthReadings: HealthReadings;
  healthSourceTime?: string;
  /** V1只有中压供水具有演示规则，其他五套不自动纳入健康状态判断 */
  totalSubsystems: number;
}

export function isHandoverRequest(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || /(下发|启动|停泵|自动派单|自动操作|自动控制|关阀|开阀)/.test(text)) return false;
  return /(交班报告|交接班报告|值班报告|值守报告|交班总结|交接班简报|交班记录)/.test(text)
    && /(生成|整理|完成|编写|制作|形成|做一份|帮我)/.test(text);
}
function makeId(date: string): string {
  return "HND-" + date.replace(/[^0-9]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}
function safe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 240);
}

export function buildHandoverReport(input: HandoverInput): HandoverReport {
  if (!Number.isFinite(Date.parse(input.preparedAt))) throw new Error("交班报告生成时间无效");
  if (!Number.isInteger(input.totalSubsystems) || input.totalSubsystems < 1) throw new Error("工艺监护范围配置无效");
  const activeEvents = input.activeEvents.filter(e => !["closed", "dismissed"].includes(e.status));
  const activeAlarms = input.alarms.filter(a => a.kind === "production" && a.status === "active");
  const outstanding = input.workorders.filter(w => !["archived", "cancelled"].includes(w.status));
  const coverage = { configured: 1, total: input.totalSubsystems };
  const issues: HandoverIssue[] = [];
  const warnings: string[] = [
    "本报告是生成时刻的本地DEMO快照，不代表当天24小时连续监护或完成了六套系统现场巡检。",
    "当前只有中压供水已配置演示自动巡查；其他工艺尚无可靠监护规则，不得判断为正常。",
    "告警、工单及健康数据来自本地MOCK种子或用户在DEMO中的记录，统计为当前状态，不是完整当日发生量。",
  ];
  if (coverage.configured < coverage.total) {
    issues.push({
      id: "coverage", kind: "coverage", title: "监护覆盖不完整",
      detail: `目前仅${coverage.configured}/${coverage.total}套工艺配置演示巡查，其他工艺状态未知。`,
      source: "MOCK", href: "/intelligent/unattended",
    });
  }
  const patrol = input.patrol ? {
    id: input.patrol.id, at: input.patrol.at, result: input.patrol.result,
    details: input.patrol.checks.map(c => `${c.name}：${c.value}（${c.result === "normal" ? "正常" : c.result === "abnormal" ? "异常" : "待核实"}；${c.note}）`),
  } as HandoverReport["patrol"] : {
    id: null, at: null, result: "not_run", details: ["没有本次有效巡查结果；不能写成已完成自动巡查。"],
  } as HandoverReport["patrol"];
  if (!input.patrol) {
    warnings.push("本次未执行巡查：可能是权限不足或巡查服务未就绪，报告仅汇总已有业务状态。");
    issues.push({ id: "patrol-missing", kind: "coverage", title: "本次巡查未执行",
      detail: "需要授权值班人员补充巡查，或核查自动调度服务。", source: "MOCK", href: "/intelligent/unattended" });
  } else if (input.patrol.result !== "normal") {
    issues.push({ id: input.patrol.id, kind: "duty", title: "本轮巡查存在异常或不确定结果",
      detail: `巡查${input.patrol.id}结果：${input.patrol.result === "abnormal" ? "异常" : "数据待核实"}。`,
      source: "MOCK", href: "/intelligent/unattended" });
  }
  for (const e of activeEvents) issues.push({
    id: e.id, kind: "duty", title: safe(e.title),
    detail: `${e.id} · ${e.status} · ${safe(e.detail)}`, source: "MOCK", href: "/intelligent/unattended",
  });
  for (const a of activeAlarms) issues.push({
    id: a.id, kind: "alarm", title: safe(a.title),
    detail: `${a.code} · ${a.level} · ${safe(a.detail)}`, source: "MOCK", href: "/operations/alarms",
  });
  for (const o of outstanding) issues.push({
    id: o.id, kind: "workorder", title: safe(o.title),
    detail: `${o.code} · ${o.status} · 责任人：${o.assignee ? safe(o.assignee) : "待分配"}`,
    source: "MOCK", href: "/operations/workorders?workOrderId=" + encodeURIComponent(o.id),
  });
  let health: HandoverHealth | null = null;
  if (input.healthAsset) {
    const result = scorePumpHealth({
      asset: input.healthAsset,
      readings: input.healthReadings,
      runtimeHours: input.healthAsset.runtimeHours,
      startCount: input.healthAsset.startCount,
      asOf: input.referenceTime,
    });
    health = {
      assetId: input.healthAsset.id, code: input.healthAsset.code,
      score: result.score, band: result.band, coverage: result.coverage,
      missing: result.missingReasons, sourceTime: input.healthSourceTime ?? input.referenceTime,
    };
    if (result.score === null) {
      warnings.push(`${input.healthAsset.code}健康评分资料不足，不能用缺失测点推算健康分。`);
      issues.push({id: "health-" + input.healthAsset.id, kind: "health",
        title: `${input.healthAsset.code}健康资料不完整`,
        detail: result.missingReasons.join("；"), source: "CALCULATED",
        href: "/decision/health?assetId=" + encodeURIComponent(input.healthAsset.id),
      });
    } else if (result.band === "危险" || result.band === "预警") {
      issues.push({id: "health-" + input.healthAsset.id, kind: "health",
        title: `${input.healthAsset.code}健康规则评分：${result.band}`,
        detail: `演示分数${result.score}，基于参考阈值，不等于真实故障预测。`,
        source: "CALCULATED", href: "/decision/health?assetId=" + encodeURIComponent(input.healthAsset.id),
      });
    }
  } else {
    warnings.push("P-002泵档案缺失，无法执行健康评分。");
    issues.push({id:"health-no-asset",kind:"health",title:"缺少P-002设备档案",
      detail:"无法完成当前演示泵组健康核验。",source:"MOCK",href:"/operations/assets"});
  }
  const steps: HandoverStep[] = [
    { id:"patrol", title:"执行运行检查", tool:"unattended.runPatrol",
      status:input.patrol ? "done" : "blocked",
      summary:input.patrol ? `执行${input.patrol.id}，结果${input.patrol.result}，检查${input.patrol.checks.length}项` : "没有完成新的巡查",
      evidenceIds:input.patrol ? [input.patrol.id] : [] },
    { id:"duty", title:"汇总值守事件", tool:"unattended.events",
      status:"done", summary:`当前未关闭${activeEvents.length}项（仅已接入工艺）`,
      evidenceIds:activeEvents.map(x=>x.id) },
    { id:"alarms", title:"汇总生产告警", tool:"demo.alarms",
      status:"done", summary:`当前活动生产告警${activeAlarms.length}项`,
      evidenceIds:activeAlarms.map(x=>x.id) },
    { id:"workorders", title:"关联未完工单", tool:"demo.workorders",
      status:"done", summary:`待办工单${outstanding.length}项（含草稿）`,
      evidenceIds:outstanding.map(x=>x.id) },
    { id:"health", title:"核验P-002设备健康", tool:"health.scorePumpHealth",
      status:health && health.score !== null ? "done" : "blocked",
      summary:health ? `${health.code}：${health.score === null ? "资料不足" : health.band + " / "+health.score+"分"}` : "设备档案缺失",
      evidenceIds:health ? [health.assetId] : [] },
    { id:"report", title:"编写交接班报告草稿", tool:"handover.compile",
      status:"done", summary:"待人工核查；未派工、未发布、未进行现场设备操作",
      evidenceIds:issues.map(i=>i.id) },
  ];
  const report: HandoverReport = {
    id:makeId(input.preparedAt),
    title:"运行检查与交接班报告（DEMO）",
    status:"pending_review",
    scenarioId:input.scenarioId,
    preparedAt:input.preparedAt,
    preparedBy:input.preparedBy,
    referenceTime:input.referenceTime,
    source:"MOCK",scope:`已配置专业监护${coverage.configured}/${coverage.total}套工艺；其余状态未知`,
    patrol,coverage,
    openDutyCount:activeEvents.length,
    activeProductionAlarmCount:activeAlarms.length,
    outstandingOrderCount:outstanding.length,
    health,issues,warnings,steps,
    text:"",
  };
  report.text = reportToMarkdown(report);
  return report;
}
export function reportToMarkdown(report: HandoverReport): string {
  const lines=[
    `# ${report.title}`,
    "",
    `- 报告编号：${report.id}`,
    `- 生成时刻：${report.preparedAt}（UTC，具体本地日期以界面显示为准）`,
    `- 数据种子参考时刻：${report.referenceTime}`,
    `- 场景：${report.scenarioId}；制表角色：${report.preparedBy}`,
    `- 状态：${report.status==="reviewed"?"DEMO已审核归档":"待人工审核草稿"}`,
    `- 数据来源：MOCK（不是现场生产记录）`,
    "",
    "## 一、巡查与监护范围",
    `- ${report.scope}`,
    `- 本轮巡查：${report.patrol.id??"未执行"}；结果：${report.patrol.result}；时间：${report.patrol.at??"缺失"}`,
    ...report.patrol.details.map(x=>"- "+safe(x)),
    "",
    "## 二、异常与业务状态（当前快照，不代表当日发生量）",
    `- 未关闭值守事件：${report.openDutyCount}项`,
    `- 活动生产告警：${report.activeProductionAlarmCount}项`,
    `- 未完工单（含草稿）：${report.outstandingOrderCount}项`,
    ...report.issues.map(i=>`- [${i.kind}/${i.id}] ${safe(i.title)}：${safe(i.detail)}`),
    "",
    "## 三、设备健康检查",
    report.health
      ? `- ${report.health.code}：${report.health.score===null?"资料不足":report.health.score+"分（"+report.health.band+"）"}；测点覆盖${Math.round(report.health.coverage*100)}%；参考数据时间${report.health.sourceTime}`
      : "- 无法评估：P-002档案缺失。",
    ...(report.health?.missing.map(x=>"- 缺数："+safe(x))??[]),
    "",
    "## 四、下一班重点事项",
    ...report.issues.slice(0,20).map(x=>`- 待核查：${safe(x.title)}（${x.id}，${x.href}）`),
    ...(report.issues.length===0 ? ["- 无已知待办；但未覆盖的工艺必须按现场制度继续巡查。"] : []),
    "",
    "## 五、资料边界与审核",
    ...report.warnings.map(x=>"- "+x),
    `- 审核：${report.reviewedBy??"待人工审核"}；时间：${report.reviewedAt??"未审核"}`,
    `- 审核意见：${report.reviewNote??"无"}`,
    "- 本报告不替代真实值班交接制度、现场控制或安全审批。",
  ];
  return lines.join("\n");
}
export interface HandoverStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function readHandoverReports(storage:HandoverStorage):HandoverReport[] {
  try{
    const value:unknown=JSON.parse(storage.getItem(HANDOVER_STORAGE_KEY)??"[]");
    return Array.isArray(value) ? (value as HandoverReport[]).filter(x=>x&&typeof x.id==="string"&&["pending_review","reviewed"].includes(x.status)) : [];
  }catch {return [];}
}
export function saveHandoverDraft(report:HandoverReport,role:Role,storage:HandoverStorage):HandoverReport {
  assertCan(role,"handover:save");
  if(report.status!=="pending_review")throw new Error("只能保存待审核草稿");
  if(role!==report.preparedBy)throw new Error("报告的当前操作角色已变化，请重新生成报告");
  const drafts=readHandoverReports(storage);
  const existing=drafts.find(x=>x.id===report.id);
  if(existing)return existing; // idempotent, repeated click cannot create duplicates
  storage.setItem(HANDOVER_STORAGE_KEY,JSON.stringify([report,...drafts].slice(0,LIMIT)));
  return report;
}
export function reviewHandoverReport(
  id:string,role:Role,note:string,storage:HandoverStorage,at:string,
):HandoverReport {
  assertCan(role,"handover:review");
  if(!note.trim())throw new Error("审核意见不能为空");
  if(!Number.isFinite(Date.parse(at)))throw new Error("审核时间无效");
  const docs=readHandoverReports(storage);
  const index=docs.findIndex(x=>x.id===id);
  if(index<0)throw new Error("未找到交班报告草稿");
  const target=docs[index];
  if(target.status!=="pending_review")throw new Error("报告已审核，不得重复归档");
  const updated:HandoverReport={
    ...target,status:"reviewed",reviewedAt:at,reviewedBy:role,reviewNote:note.trim(),
  };
  updated.text=reportToMarkdown(updated);
  docs[index]=updated;
  storage.setItem(HANDOVER_STORAGE_KEY,JSON.stringify(docs));
  return updated;
}

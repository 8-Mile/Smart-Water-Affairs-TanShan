<script setup lang="ts">
import { planCommand } from "../demo/ai-command";
import { executeWaterWorkflow, type WaterWorkflowAnswer } from "../demo/waterAiWorkflow";
import { saveDispatchDraft, saveSupplyDraft } from "../demo/proposalDrafts";
import { evaluateKnowledge, type KnowledgeResult } from "../demo/knowledge";
import { buildHandoverReport, saveHandoverDraft, type HandoverReport } from "../demo/handover";
import { useUnattendedStore } from "../demo/unattendedStore";
import {answerWaterUsageQuery} from "../demo/waterQuery";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NButton, NInput, NModal, NTag, useMessage } from "naive-ui";
import AssetCreateWizard from "./AssetCreateWizard.vue";
import DocumentDetail from "./DocumentDetail.vue";
import WorkOrderDrawer from "./WorkOrderDrawer.vue";
import {
  buildCreateAssetRun,
  cancelPendingSteps,
  computeDiagnose,
  createHealthWorkOrder,
  findExistingHealthDraft,
  markDiagnoseConfirmed,
  markDiagnoseForbidden,
  retryDiagnoseStep,
  trendStatusLabel,
} from "../demo/agentRuntime";
import type { DiagnoseResult, DiagnoseRunInput } from "../demo/agentRuntime";
import {
  createAgentRun,
  makeStep,
  patchStep,
  runStatusLabel,
  setRunStatus,
  stepStatusLabel,
} from "../demo/agentBasics";
import {
  COMMAND_CATALOG,
  KIND_LABELS,
  parseIntent,
  detectSubsystem,
  toPointDraft,
} from "../demo/intent";
import type { IntentContext, ParsedIntent } from "../demo/intent";
import { can, roleNames } from "../demo/permissions";
import {
  analyzeSprayScene,
  buildSprayContext,
  compareSprayPlans,
  summarizeSpray,
  toSpraySnapshots,
} from "../demo/spray";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import type {
  AgentRun,
  AgentRunStatus,
  AgentStepStatus,
  EvidenceRef,
  WorkOrder,
} from "../demo/types";

const store = useDemoStore();
const unattended = useUnattendedStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();
const message = useMessage();

interface CreatedPayload {
  assetId: string;
  code: string;
  name: string;
  pointIds: string[];
  hotspot: boolean;
  subsystemId: string;
}

const catalogOpen = ref(false);
const parsed = ref<ParsedIntent | null>(null);
const run = ref<AgentRun | null>(null);
const wizardOpen = ref(false);
const wizardIntent = ref<ParsedIntent | null>(null);
const runLogError = ref("");
const rejectMessage = ref("");
const lastCreated = ref<CreatedPayload | null>(null);
const addDone = ref<{ assetId: string; assetCode: string; labels: string[] } | null>(null);
const diagnosis = ref<DiagnoseResult | null>(null);
const confirmOrderOpen = ref(false);
const lastDraftOrderId = ref("");
const documentOpen = ref(false);
const evidenceDocId = ref<string | null>(null);
const evidenceOrderId = ref<string | null>(null);
const sprayDraftMessage = ref("");
const waterAnswer = ref<WaterWorkflowAnswer | null>(null);
const waterSavedId = ref("");
const handoverPreview = ref<HandoverReport | null>(null);
const handoverSavedId = ref("");
const knowledgeAnswer = ref<KnowledgeResult | null>(null);

const context = computed<IntentContext>(() => {
  const routeSubsystem =
    route.name === "process" && typeof route.params.subsystemId === "string"
      ? route.params.subsystemId
      : route.name === "process-spray"
        ? "spray"
        : undefined;
  const subsystemId = routeSubsystem ?? ui.aiContext.subsystemId;
  const assetId =
    ui.drawerAssetId ??
    ui.aiContext.assetId ??
    (typeof route.query.assetId === "string" ? route.query.assetId : undefined);
  const last = ui.lastTask;
  const remembered = last && last.scenarioId === store.scenarioId && last.role === store.role
    ? store.getAsset(last.assetId ?? "") : undefined;
  return { subsystemId: subsystemId ?? remembered?.subsystemId,
    assetId: assetId ?? (remembered?.archived ? undefined : remembered?.id) };
});

const contextLabel = computed(() => {
  const parts: string[] = [];
  if (context.value.subsystemId) {
    const name =
      store.subsystems.find((item) => item.id === context.value.subsystemId)?.name ??
      context.value.subsystemId;
    parts.push(`子系统 ${name}`);
  }
  if (context.value.assetId) {
    const asset = store.getAsset(context.value.assetId);
    parts.push(`设备 ${asset ? `${asset.code} · ${asset.name}` : context.value.assetId}`);
  }
  return parts.length ? parts.join(" · ") : "未携带设备或子系统上下文";
});

const canAsk = computed(() => can(store.role, "ai:ask"));
const canCreate = computed(() => can(store.role, "asset:create"));
const canCreateOrder = computed(() => can(store.role, "workorder:create"));
const canSaveWater = computed(() => can(store.role, "water:proposal"));
const canSaveHandover = computed(() => can(store.role, "handover:save"));
const catalog = COMMAND_CATALOG;

const EVIDENCE_KIND_LABELS: Record<EvidenceRef["kind"], string> = {
  telemetry: "遥测",
  alarm: "告警",
  workorder: "工单",
  document: "档案",
  inspection: "巡检",
  asset: "设备",
};

function evidenceKindLabel(kind: EvidenceRef["kind"]): string {
  return EVIDENCE_KIND_LABELS[kind] ?? kind;
}

const diagnoseTrendLabel = computed(() =>
  diagnosis.value?.trend ? trendStatusLabel(diagnosis.value.trend.status) : "不可估计",
);

const existingDraft = computed<WorkOrder | undefined>(() => {
  const draft = diagnosis.value?.draft;
  if (!draft) return undefined;
  return findExistingHealthDraft(store.workorders, {
    assetId: draft.assetId,
    title: draft.title,
    evidenceIds: draft.evidenceIds ?? [],
  });
});

const createOrderReason = computed(() =>
  canCreateOrder.value
    ? "按权限 workorder:create 生成草稿，不自动派单。"
    : `FORBIDDEN：角色「${roleNames[store.role]}」无 workorder:create 权限，按钮已禁用。`,
);

function formatAt(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

function kindTagType(kind: ParsedIntent["kind"]): "default" | "success" | "warning" | "error" | "info" {
  if (kind === "unsupported") return "error";
  if (kind === "create_asset" || kind === "add_measure_point") return "warning";
  if (kind === "diagnose_asset") return "info";
  if (kind === "compose_ui" || kind === "water_workflow" || kind === "handover_workflow" || kind === "knowledge_query") return "success";
  return "default";
}

function statusTagType(
  status: AgentRunStatus,
): "default" | "success" | "warning" | "error" | "info" {
  if (status === "done") return "success";
  if (status === "failed") return "error";
  if (status === "awaiting_confirmation") return "warning";
  if (status === "running") return "info";
  return "default";
}

function stepTagType(
  status: AgentStepStatus,
): "default" | "success" | "warning" | "error" | "info" {
  if (status === "done") return "success";
  if (status === "failed") return "error";
  if (status === "blocked") return "warning";
  if (status === "running") return "info";
  return "default";
}

function step(
  id: string,
  agentName: string,
  action: string,
  tool: string | undefined,
  inputSummary: string,
  outputSummary: string,
  status: AgentStepStatus,
  errorCode?: string,
) {
  return makeStep(
    { id, agentName, action, tool, inputSummary, outputSummary, status, errorCode },
    store.seed.referenceTime,
  );
}

function buildRun(intent: ParsedIntent): AgentRun {
  const at = store.seed.referenceTime;

  if (intent.kind === "create_asset" || intent.kind === "add_measure_point") {
    return buildCreateAssetRun({
      intent,
      at,
      canCreateAsset: canCreate.value,
    });
  }
  if (intent.kind === "diagnose_asset") {
    return buildDiagnoseRunFor(intent);
  }

  const taskType: AgentRun["taskType"] = intent.kind === "compose_ui" ? "compose_ui" : "other";
  const title = `${KIND_LABELS[intent.kind]}：${intent.prompt.slice(0, 28)}${
    intent.prompt.length > 28 ? "…" : ""
  }`;

  if (intent.kind === "unsupported") {
    return createAgentRun({
      taskType: "other",
      title,
      prompt: intent.prompt,
      at,
      status: "failed",
      context: { subsystemId: intent.subsystemId ?? "" },
      steps: [
        step(
          "parse",
          "总控 · Coordinator",
          "解析意图",
          "intent.parse",
          intent.prompt,
          intent.reason ?? "本地 DEMO 不支持该指令",
          "blocked",
          "UNSUPPORTED",
        ),
      ],
    });
  }

  const noWrite = intent.kind === "compose_ui" || intent.kind === "query";
  const parseOutput =
    intent.kind === "compose_ui"
      ? "生成式工作台请求"
      : intent.kind === "query"
        ? `只读查询 ${intent.targetAssetCode ?? "全局概览"}`
        : `调整工艺点位 ${intent.targetAssetCode ?? "未指定设备"}`;
  const draftOutput = noWrite
    ? "确定工作台目标页面与数据源"
    : "确定待调整点位与目标设备";
  const previewOutput = noWrite
    ? "将跳转 AI 分析工作台"
    : "需在工艺图上人工点选位置";
  const status: AgentRunStatus = noWrite ? "done" : "failed";

  return createAgentRun({
    taskType,
    title,
    prompt: intent.prompt,
    at,
    status,
    context: {
      subsystemId: intent.subsystemId ?? "",
      assetId: intent.targetAssetId ?? "",
    },
    steps: [
      step("parse", "总控 · Coordinator", "解析意图", "intent.parse", intent.prompt, parseOutput, "done"),
      step("draft", "配置 · AssetConfig", "生成配置草稿", "intent.draft", parseOutput, draftOutput, "done"),
      step("validate", "核验 · Verifier", "字段与权限核验", "asset.validate", draftOutput, "无需写入校验", "done"),
      step("preview", "界面 · UIComposer", "生成确认界面", "ui.preview", "无需写入校验", previewOutput, "done"),
      step(
        "confirm",
        "人工确认",
        "等待人工确认",
        undefined,
        "确认执行",
        noWrite ? "只读操作，无需人工确认" : "需人工点选位置",
        noWrite ? "done" : "pending",
      ),
      step(
        "commit",
        "命令层 · CommandBus",
        "事务提交",
        "command.commit",
        "人工确认后提交",
        noWrite ? "只读操作，未写入主数据" : "尚未提交",
        noWrite ? "done" : "pending",
      ),
      step(
        "sync",
        "查询服务 · Query",
        "页面同步核验",
        "query.sync",
        "提交结果",
        noWrite ? "无需同步" : "提交后同步可视化绑定",
        noWrite ? "done" : "pending",
      ),
    ],
  });
}

function diagnoseInput(intent: ParsedIntent): DiagnoseRunInput {
  return {
    intent,
    seed: store.seed,
    state: store.userState,
    role: store.role,
  };
}

function buildDiagnoseRunFor(intent: ParsedIntent): AgentRun {
  return computeDiagnose(diagnoseInput(intent)).run;
}

function persistRun(): void {
  if (!run.value) return;
  try {
    store.recordAgentRun(run.value);
    runLogError.value = "";
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    runLogError.value =
      failure.code === "FORBIDDEN"
        ? `FORBIDDEN：${failure.message ?? "当前角色无 ai:ask 权限"}，任务未写入操作日志。`
        : (failure.message ?? "任务日志写入失败");
  }
}

function submit(text?: string): void {
  const prompt = (text ?? ui.aiPrompt).trim();
  if (text !== undefined) ui.aiPrompt = text;
  if (!canAsk.value) {
    message.warning(`角色「${roleNames[store.role]}」无 AI 询问权限`);
    return;
  }
  if (!prompt) {
    message.warning("请输入指令");
    return;
  }
  // 纯导航指令优先于子系统关键字匹配。否则“大机供水”容易被泛化为中压泵监控。
  const navigationRequest = /^(?:查看|打开|进入|前往|显示|跳转到|看看)\s*/.test(prompt);
  if (navigationRequest) {
    const destination = /大机/.test(prompt) && /(供水|用水|保障)/.test(prompt)
      ? "/water/machine-supply"
      : /(动态平衡|供需平衡)/.test(prompt)
        ? "/water/balance"
        : /(循环水|循环利用|水量账本)/.test(prompt)
          ? (/水量账本/.test(prompt) ? "/water/ledger" : "/water/overview")
          : "";
    if (destination) {
      message.info("已打开对应的本地模拟业务页面");
      void ui.navigate(router, destination);
      return;
    }
  }

  lastCreated.value = null;
  addDone.value = null;
  rejectMessage.value = "";
  runLogError.value = "";
  diagnosis.value = null;
  confirmOrderOpen.value = false;
  lastDraftOrderId.value = "";
  sprayDraftMessage.value = "";
  waterAnswer.value = null;
  waterSavedId.value = "";
  handoverPreview.value = null;
  handoverSavedId.value = "";
  knowledgeAnswer.value = null;

  const intent = parseIntent(prompt, context.value, store.seed, store.assets, store.points);
  const asset = intent.targetAssetId ? store.getAsset(intent.targetAssetId) :
    intent.kind === "compose_ui" && context.value.assetId ? store.getAsset(context.value.assetId) : undefined;
  const last = ui.lastTask;
  const orderId = /刚才|这张/.test(prompt) ? last?.workOrderId : route.query.workOrderId;
  const command = planCommand(intent, {
    asset, points: asset ? store.getPoints(asset.id) : [],
    alarm: store.alarms.find(item => item.id === route.query.alarmId),
    order: store.workorders.find(item => item.id === orderId),
    currentWorkspace: route.name === "ai-workspace",
    currentTrend: route.name === "process" && route.query.tab === "trend" ? {
      pointId: typeof route.query.pointId === "string" ? route.query.pointId : undefined,
      range: typeof route.query.range === "string" ? route.query.range : undefined,
    } : undefined,
    explicitSubsystem: detectSubsystem(prompt, {}, store.seed),
    context: { scenarioId: store.scenarioId, role: store.role, returnTo: route.fullPath },
  });
  parsed.value = intent;
  if (!can(store.role, command.permission) || command.execution.status === "blocked") {
    parsed.value = { ...intent, kind: "unsupported",
      reason: !can(store.role, command.permission) ? "当前角色没有此操作权限" : command.execution.result };
    run.value = buildRun(parsed.value);
    persistRun();
    return;
  }
  if (asset && !intent.errors.length) ui.lastTask = { assetId: asset.id, scenarioId: store.scenarioId, role: store.role,
    workOrderId: last?.assetId === asset.id ? last.workOrderId : undefined };
  if(command.execution.tool === "knowledge.search" && intent.knowledgeQuery){
    const result=evaluateKnowledge({
      query:intent.knowledgeQuery,assets:store.assets,documents:store.documents,
      removedDocumentIds:store.userState.removedDocumentIds,
      inspections:store.inspections,maintenance:store.maintenance,
      workorders:store.workorders,alarms:store.alarms,
      seedInspectionIds:store.seed.inspections.map(x=>x.id),
      seedMaintenanceIds:store.seed.maintenance.map(x=>x.id),
      seedWorkorderIds:store.seed.workorders.map(x=>x.id),
      seedAlarmIds:store.seed.alarms.map(x=>x.id),
    });
    knowledgeAnswer.value=result;
    const at=new Date().toISOString();
    const references:EvidenceRef[]=result.documents.map(x=>({
      kind:"document",refId:x.id,label:x.citation,
      detail:x.sourceLabel,source:x.isDemo?"REFERENCE":"USER_ENTRY",
    }));
    run.value=createAgentRun({
      taskType:"other",title:"专业知识核验 · "+(result.asset?.code??"设备缺失"),
      prompt,at,status:"done",
      context:{assetId:result.query.assetId,scenarioId:store.scenarioId},
      steps:[
        makeStep({id:"scope",agentName:"资料核查",action:"限定设备与主题",
          tool:"knowledge.asset-scope",inputSummary:prompt,
          outputSummary:result.asset?.code+" / "+result.category+" / 当前场景" ,
          status:"done"},at),
        {...makeStep({id:"documents",agentName:"知识检索",action:"检索已审核有出处的档案摘录",
          tool:"knowledge.search",inputSummary:"仅当前设备绑定的可用摘录",
          outputSummary:result.documents.length+"份可引用资料；"+result.excluded.length+"份被排除",
          status:"done"},at),evidence:references},
        makeStep({id:"verify",agentName:"证据核验",action:"核实版本章节和业务边界",
          tool:"knowledge.citation-check",inputSummary:"来源与MOCK可信度检查",
          outputSummary:result.confidence==="reference_only"
            ?"仅形成有出处的人工检查建议，不是故障根因": "证据不足，拒绝故障结论",
          status:"done"},at),
      ],
    });
    persistRun();
    return;
  }
  if (command.execution.tool === "handover.workflow") {
    try {
      // 真正执行一个本地巡查步骤；无权限时不代替他人执行，报告明确标记未巡查。
      const patrol = can(store.role, "unattended:execute")
        ? unattended.runPatrol() : null;
      const pump = store.assets.find(a => !a.archived && a.code === "P-002") ?? null;
      function reading(key: string): number | null {
        if (!pump) return null;
        const point = store.getPoints(pump.id).find(p => p.id.endsWith("-" + key));
        if (!point) return null;
        const current = store.latest(point.id);
        return current?.quality === "valid" && typeof current.value === "number"
          ? current.value : null;
      }
      const healthSample = pump ? store.latest(store.getPoints(pump.id).find(p => p.id.endsWith("-vibration"))?.id ?? "") : undefined;
      const report = buildHandoverReport({
        scenarioId: store.scenarioId,
        referenceTime: store.seed.referenceTime,
        preparedAt: new Date().toISOString(),
        preparedBy: store.role,
        patrol,
        activeEvents: unattended.events,
        alarms: store.alarms,
        workorders: store.workorders,
        healthAsset: pump,
        healthReadings: { vibration: reading("vibration"), temperature: reading("temperature"), current: reading("current") },
        healthSourceTime: healthSample?.at ?? store.seed.referenceTime,
        totalSubsystems: store.subsystems.length,
      });
      handoverPreview.value = report;
      const at = report.preparedAt;
      run.value = {
        ...createAgentRun({
          taskType: "other", title: "多步骤运行检查 · 交班报告",
          prompt, at, status: "awaiting_confirmation",
          context: { reportId: report.id, scenarioId: store.scenarioId },
          steps: [
            makeStep({ id: "parse", agentName: "任务编排器", action: "识别运行检查与交班任务",
              tool: "handover.intent", inputSummary: prompt, outputSummary: "任务解析完成；仅调用已存在的只读业务模块",
              status: "done" }, at),
            ...report.steps.map(item => makeStep({
              id: item.id, agentName: "业务工具执行",
              action: item.title, tool: item.tool,
              inputSummary: "本地数据 / MOCK", outputSummary: item.summary,
              status: item.status,
            }, at)),
            makeStep({ id: "review", agentName: "人员审核", action: "人工确认并保存报告草稿",
              tool: "handover.draft.save", inputSummary: "需再次确认业务数据和缺数说明",
              outputSummary: "等待值班员确认，不进行正式审批或设备控制", status: "pending" }, at),
          ],
        }),
        id: "run-" + report.id,
      };
      persistRun();
    } catch (err) {
      rejectMessage.value = (err as Error).message;
      parsed.value = { ...intent, kind: "unsupported", reason: rejectMessage.value };
      run.value = buildRun(parsed.value);
      persistRun();
    }
    return;
  }
  if (command.execution.tool === "water.workflow" && intent.waterWorkflow) {
    try {
      const answer = executeWaterWorkflow(intent.waterWorkflow, unattended.events);
      waterAnswer.value = answer;
      run.value = createAgentRun({
        taskType: "other", title: "水务业务执行 · " + answer.title,
        prompt, at: store.seed.referenceTime, status: "done",
        context: { subsystemId: answer.kind === "dispatch" ? "rainwater" : "" },
        steps: [
          step("parse", "总控 · Coordinator", "识别业务指令", "intent.parse", prompt,
            "已解析 " + answer.kind + (answer.request.rainMm !== undefined ? " / 降雨 " + answer.request.rainMm + "mm" : ""), "done"),
          step("calculate", "水务专业计算", "执行已验证业务模型", answer.kind === "dispatch" ? "water.dispatch" :
            answer.kind === "supply" ? "water.multisource" : "unattended.events",
            "MOCK参数 / 现有只读数据", answer.resultLines[0] ?? "暂无结果", "done"),
          step("verify", "核验 · Verifier", "检查模拟口径与安全边界", "water.readonly.verify",
            "水量/管网/数据质量", answer.caveat, "done"),
        ],
      });
      persistRun();
    } catch (err) {
      rejectMessage.value = (err as Error).message;
      parsed.value = { ...intent, kind: "unsupported", reason: rejectMessage.value };
      run.value = buildRun(parsed.value);
      persistRun();
    }
    return;
  }
  if (command.navigation) {
    if (route.name === "ai-workspace" && typeof command.navigation === "object" && "name" in command.navigation && command.navigation.name === "ai-workspace") {
      command.navigation.query = { ...route.query, ...command.navigation.query };
    }
    command.execution.status = "done";
    command.execution.result = router.resolve(command.navigation).fullPath;
    run.value = createAgentRun({ taskType: "other", title: "打开业务结果", prompt,
      at: store.seed.referenceTime, status: "done", context: command.target,
      steps: [step("navigate", "总控 · Coordinator", "定位业务结果", command.execution.tool, prompt,
        command.execution.result, "done")] });
    persistRun();
    void ui.navigate(router, command.navigation);
    return;
  }
  if (command.execution.tool === "diagnose") {
    const result = computeDiagnose(diagnoseInput({ ...intent, kind: "diagnose_asset" }));
    parsed.value = { ...intent, kind: "diagnose_asset" };
    diagnosis.value = result;
    run.value = result.run;
    if (/工单/.test(prompt)) requestCreateDraft();
  } else {
    run.value = buildRun(intent);
  }
  if (intent.kind === "create_asset") {
    wizardIntent.value = intent;
    wizardOpen.value = true;
  }
  persistRun();
}

function openHandoverReport(): void {
  if (!handoverSavedId.value) return;
  const destination = "/data/reports?handoverId=" + encodeURIComponent(handoverSavedId.value);
  ui.closeAi(); // 让业务报告占满主工作区，而不是被抽屉遮挡
  void router.push(destination);
}
function confirmHandoverDraft(): void {
  const report = handoverPreview.value;
  if (!report || handoverSavedId.value) return;
  try {
    const saved = saveHandoverDraft(report, store.role, localStorage);
    handoverSavedId.value = saved.id;
    if (run.value) {
      run.value = setRunStatus(patchStep(run.value, "review", {
        status: "done",
        outputSummary: "已保存待审核MOCK交班报告 " + saved.id + "；未派单、未控制现场设备",
      }, new Date().toISOString()), "done", new Date().toISOString());
      persistRun();
    }
    message.success("交班报告草稿已保存，可在「常用报表」查看与演示审核");
  } catch (err) { message.error((err as Error).message); }
}
function confirmWaterProposal(): void {
  const answer = waterAnswer.value;
  if (!answer || answer.kind === "duty" || waterSavedId.value) return;
  if (!canSaveWater.value) {
    message.error("当前角色没有水资源方案草稿写入权限");
    return;
  }
  try {
    const saved = answer.kind === "dispatch" && answer.dispatch
      ? saveDispatchDraft(answer.dispatch, store.role, localStorage)
      : answer.kind === "supply" && answer.supply
        ? saveSupplyDraft(answer.supply.inputs, answer.supply.result, store.role, localStorage)
        : null;
    if (!saved) throw new Error("缺少有效计算结果，不能保存建议");
    waterSavedId.value = saved.id;
    if (run.value) {
      run.value = {
        ...run.value,
        steps: [...run.value.steps, step("save-proposal", "命令层 · CommandBus",
          "用户确认并保存待审核草稿", "water.proposal.save",
          answer.title, "已写入原业务模块草稿 " + saved.id + "；未下发现场控制", "done")],
      };
      persistRun();
    }
    message.success("已保存待审核草稿 " + saved.id + "，请到原业务页面查看");
  } catch(err) {
    rejectMessage.value = (err as Error).message;
    message.error(rejectMessage.value);
  }
}
function waterResultRoute(): string {
  const answer = waterAnswer.value;
  if (!answer) return "/water/overview";
  if (answer.kind === "dispatch") return answer.route +
    "?rainMm=" + encodeURIComponent(String(answer.request.rainMm ?? 60)) + "&source=ai";
  if (answer.kind === "supply") return answer.route +
    "?scenario=" + encodeURIComponent(answer.request.supplyScenario ?? "normal") + "&source=ai";
  return answer.route;
}

function useExample(text: string): void {
  ui.aiPrompt = text;
}

function cancelRun(): void {
  if (!run.value) return;
  const at = store.seed.referenceTime;
  run.value = cancelPendingSteps(run.value, at, "用户取消，未执行");
  wizardOpen.value = false;
  wizardIntent.value = null;
  parsed.value = null;
  handoverPreview.value = null;
  handoverSavedId.value = "";
  addDone.value = null;
  confirmOrderOpen.value = false;
  persistRun();
  message.info(
    diagnosis.value
      ? "已取消，未创建工单或修改设备数据"
      : "已取消，未创建或修改任何设备与测点",
  );
}

function retryStep(stepId: string): void {
  const intent = parsed.value;
  if (!intent || !run.value) return;
  const at = store.seed.referenceTime;

  if (intent.kind === "diagnose_asset") {
    if (stepId === "confirm") {
      requestCreateDraft();
      return;
    }
    const fresh = computeDiagnose(diagnoseInput(intent));
    run.value = retryDiagnoseStep(run.value, stepId, fresh.run, at);
    diagnosis.value = { ...fresh, run: run.value };
    persistRun();
    message.info("已重试该步骤，未重复写入工单或设备");
    return;
  }

  if (stepId === "commit" && intent.kind === "create_asset") {
    const code = intent.asset?.code?.toLowerCase();
    const existing = code
      ? store.assets.find(
          (asset) =>
            asset.subsystemId === intent.subsystemId &&
            asset.code.trim().toLowerCase() === code,
        )
      : undefined;
    if (existing) {
      let updated = patchStep(
        run.value,
        "commit",
        {
          status: "done",
          errorCode: undefined,
          outputSummary: `设备 ${existing.code} 已存在，本次跳过重复创建`,
        },
        at,
      );
      updated = patchStep(
        updated,
        "sync",
        { status: "done", outputSummary: "已核验台账、搜索与设备抽屉可命中该设备" },
        at,
      );
      run.value = setRunStatus(updated, "done", at);
      persistRun();
      message.info("该编号设备已存在，已跳过重复创建");
      return;
    }
    if (!canCreate.value) {
      run.value = setRunStatus(
        patchStep(
          run.value,
          "commit",
          {
            status: "failed",
            errorCode: "FORBIDDEN",
            outputSummary: `FORBIDDEN：角色「${roleNames[store.role]}」无 asset:create 权限`,
          },
          at,
        ),
        "failed",
        at,
      );
      persistRun();
      return;
    }
    wizardIntent.value = intent;
    wizardOpen.value = true;
    message.info("已重新打开向导，确认后才会写入");
    return;
  }

  if (stepId === "commit" && intent.kind === "add_measure_point") {
    confirmAddPoints();
    return;
  }

  submit(intent.prompt);
}

function requestCreateDraft(): void {
  const draft = diagnosis.value?.draft;
  if (!draft) {
    message.warning("缺少可用的振动趋势快照，暂不能生成工单草稿");
    return;
  }
  if (!canCreateOrder.value) {
    const text = `FORBIDDEN：角色「${roleNames[store.role]}」无 workorder:create 权限，不能生成工单草稿`;
    rejectMessage.value = text;
    if (run.value) {
      run.value = markDiagnoseForbidden(run.value, text, store.seed.referenceTime);
      persistRun();
    }
    message.error(text);
    return;
  }
  confirmOrderOpen.value = true;
}

function confirmCreateDraft(): void {
  const draft = diagnosis.value?.draft;
  if (!draft) {
    rejectMessage.value = "缺少草稿输入，本次未写入";
    return;
  }
  const at = store.seed.referenceTime;
  try {
    const result = createHealthWorkOrder(
      {
        workorders: store.workorders,
        createWorkOrder: store.createWorkOrder,
      },
      draft,
    );
    lastDraftOrderId.value = result.order.id;
    ui.lastTask = { assetId: result.order.assetId, workOrderId: result.order.id,
      scenarioId: store.scenarioId, role: store.role };
    confirmOrderOpen.value = false;
    rejectMessage.value = "";
    if (run.value) {
      run.value = markDiagnoseConfirmed(run.value, result.order, at);
      persistRun();
    }
    if (result.duplicated) {
      message.info(`已存在相同草稿 ${result.order.code}，未重复创建`);
    } else {
      message.success(`已生成草稿 ${result.order.code}，未派单`);
    }
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const text =
      failure.code === "FORBIDDEN"
        ? `FORBIDDEN：${failure.message ?? "当前角色无 workorder:create 权限"}`
        : (failure.message ?? "生成工单草稿失败");
    rejectMessage.value = text;
    if (run.value) {
      run.value = markDiagnoseForbidden(run.value, text, at);
      persistRun();
    }
    message.error(text);
  }
}

function resolveEvidenceAssetId(evidence: EvidenceRef): string | undefined {
  switch (evidence.kind) {
    case "asset":
      return evidence.refId;
    case "alarm":
      return store.alarms.find((item) => item.id === evidence.refId)?.assetId;
    case "telemetry":
      return store.points.find((item) => item.id === evidence.refId)?.assetId;
    case "inspection":
      return store.inspections.find((item) => item.id === evidence.refId)?.assetId;
    default:
      return undefined;
  }
}

function openEvidence(evidence: EvidenceRef): void {
  if (evidence.kind === "document") {
    evidenceDocId.value = evidence.refId;
    documentOpen.value = true;
    return;
  }
  if (evidence.kind === "workorder") {
    evidenceOrderId.value = evidence.refId;
    return;
  }
  const assetId = resolveEvidenceAssetId(evidence);
  const asset = assetId ? store.getAsset(assetId) : undefined;
  if (asset) {
    ui.openAsset(asset.id);
    message.info(`已在设备抽屉定位 ${asset.code} · ${asset.name}`);
    return;
  }
  message.warning("该证据关联对象不可用，未打开新页面");
}

const addPreview = computed(() => {
  const intent = parsed.value;
  if (!intent || intent.kind !== "add_measure_point") return null;
  const target = intent.targetAssetId ? store.getAsset(intent.targetAssetId) : undefined;
  return { intent, target };
});

const addBlockedReason = computed(() => {
  const intent = parsed.value;
  if (!intent || intent.kind !== "add_measure_point") return "";
  if (intent.errors.length) return intent.errors.map((issue) => issue.message).join("；");
  if (!can(store.role, "point:add")) {
    return `FORBIDDEN：角色「${roleNames[store.role]}」无 point:add 权限，不能追加测点`;
  }
  return "";
});

function confirmAddPoints(): void {
  const intent = parsed.value;
  if (!intent || intent.kind !== "add_measure_point") return;
  if (!intent.targetAssetId) {
    rejectMessage.value = "未找到目标设备，本次操作未写入";
    return;
  }
  if (addBlockedReason.value) {
    rejectMessage.value = addBlockedReason.value;
    return;
  }
  const at = store.seed.referenceTime;
  try {
    const labels: string[] = [];
    for (const spec of intent.points) {
      store.addPoint(intent.targetAssetId, toPointDraft(spec));
      labels.push(spec.label);
    }
    const asset = store.getAsset(intent.targetAssetId);
    addDone.value = {
      assetId: intent.targetAssetId,
      assetCode: asset?.code ?? intent.targetAssetCode ?? intent.targetAssetId,
      labels,
    };
    if (run.value) {
      let updated = patchStep(
        run.value,
        "confirm",
        { status: "done", outputSummary: `确认追加测点：${labels.join("、")}` },
        at,
      );
      updated = patchStep(
        updated,
        "commit",
        {
          status: "done",
          outputSummary: `assetId=${intent.targetAssetId} 新增 ${labels.length} 个测点，未创建新设备`,
        },
        at,
      );
      updated = patchStep(
        updated,
        "sync",
        { status: "done", outputSummary: "设备抽屉、监测列表与 AI 查询已同步" },
        at,
      );
      run.value = setRunStatus(updated, "done", at);
      persistRun();
    }
    message.success(`已追加 ${labels.length} 个测点，已同步设备抽屉/监测列表/AI 查询`);
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    rejectMessage.value =
      failure.code === "FORBIDDEN"
        ? `FORBIDDEN：${failure.message ?? "当前角色无追加测点权限"}`
        : (failure.message ?? "追加测点失败，未创建新设备");
    if (run.value) {
      run.value = setRunStatus(
        patchStep(
          run.value,
          "commit",
          {
            status: "failed",
            errorCode: failure.code ?? "COMMIT_FAILED",
            outputSummary: rejectMessage.value,
          },
          at,
        ),
        "failed",
        at,
      );
      persistRun();
    }
  }
}

function spraySnapshots() {
  const sprayAssets = store.assets.filter(
    (asset) =>
      asset.subsystemId === "spray" &&
      !asset.archived &&
      asset.type.includes("射雾"),
  );
  return toSpraySnapshots(sprayAssets, (assetId, keyword) => {
    const point = store
      .getPoints(assetId)
      .find((item) => item.kind === "number" && item.label.includes(keyword));
    if (!point) return null;
    const sample = store.latest(point.id);
    return sample && typeof sample.value === "number" ? sample.value : null;
  });
}

/** 射雾器主题的本地规则回答：只陈述可计算的数据，不做模型推理。 */
function sprayAnswer(topic: NonNullable<ParsedIntent["topic"]>) {
  const snapshots = spraySnapshots();
  const summary = summarizeSpray(snapshots);
  const sprayContext = buildSprayContext(store.scenarioId);
  const activeAlarms = store.alarms.filter(
    (alarm) => alarm.subsystemId === "spray" && alarm.status === "active",
  );
  const suggestions = analyzeSprayScene({
    context: sprayContext,
    snapshots,
    summary,
    alarms: activeAlarms,
  });
  if (topic === "spray-runtime") {
    return {
      title: "射雾器运行设备与异常（本地规则）",
      lines: [
        `运行 ${summary.runningCount} 台：${
          snapshots
            .filter((item) => item.status === "running")
            .map(
              (item) =>
                `${item.code}（${
                  item.pressureMpa === null ? "压力缺数" : `${item.pressureMpa.toFixed(2)} MPa`
                }，${item.flowM3h === null ? "流量缺数" : `${item.flowM3h.toFixed(1)} m³/h`}）`,
            )
            .join("；") || "无"
        }`,
        `活动告警 ${activeAlarms.length} 条：${
          activeAlarms.map((alarm) => alarm.title).join("；") || "无"
        }`,
        `规则建议 ${suggestions.filter((item) => item.level !== "info").length} 条：${
          suggestions
            .filter((item) => item.level !== "info")
            .map((item) => item.title)
            .join("；") || "无"
        }`,
        "数据口径：MOCK 模拟遥测 + 本地规则计算。",
      ],
    };
  }
  if (topic === "spray-pressure") {
    const to = store.seed.referenceTime;
    const from = new Date(Date.parse(to) - 24 * 3_600_000).toISOString();
    const stats = snapshots.map((item) => {
      const point = store
        .getPoints(item.assetId)
        .find((entry) => entry.kind === "number" && entry.label.includes("压力"));
      const samples = point ? store.series(point.id, from, to) : [];
      const values = samples
        .map((sample) => (typeof sample.value === "number" ? sample.value : null))
        .filter((value): value is number => value !== null);
      return {
        code: item.code,
        mean: values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        valid: values.length,
        total: samples.length,
      };
    });
    const usable = stats.filter((item) => item.mean !== null);
    return {
      title: "最近 24 小时末端压力趋势",
      lines: usable.length
        ? [
            ...stats.map((item) =>
              item.mean === null
                ? `${item.code}：无有效压力样本（缺数）`
                : `${item.code}：均值 ${item.mean.toFixed(2)} MPa，区间 ${item.min?.toFixed(
                    2,
                  )}~${item.max?.toFixed(2)} MPa，有效 ${item.valid}/${item.total}`,
            ),
            "演示关注阈值 0.45 MPa 为可配置参数，不是厂家规定值；缺数不参与均值。",
          ]
        : ["所选设备均无有效末端压力样本，不生成趋势结论。"],
    };
  }
  if (topic === "spray-area") {
    return {
      title: "堆场作业与环境状态（MOCK 演示）",
      lines: [
        ...sprayContext.areas.map((area) =>
          area.working
            ? `${area.name}：作业中（${area.task}）`
            : `${area.name}：已停止作业 ${area.stoppedMinutesAgo} 分钟（${area.task}），演示计划${
                area.plannedSpray ? "仍保留喷雾" : "不安排喷雾"
              }`,
        ),
        `风速 ${sprayContext.environment.windSpeedMs} m/s，${sprayContext.environment.windDirection}；粉尘 ${
          sprayContext.environment.dustMgM3 === null
            ? "缺数"
            : `${sprayContext.environment.dustMgM3} mg/m³`
        }`,
        "不是现场生产系统或环保监测实测数据。",
      ],
    };
  }
  if (topic === "spray-water") {
    const basis = summary.flowTotalM3h === null ? "rated" : "measured";
    const flows = snapshots
      .filter((item) => item.status === "running")
      .map(
        (item) => item.flowM3h ?? store.getAsset(item.assetId)?.rated?.flowM3h ?? null,
      );
    const comparison = compareSprayPlans(flows, basis);
    return {
      title: "运行方案理论用水对比",
      lines: [
        `现行计划：${
          comparison.current.volumeM3 === null ? "缺数" : `${comparison.current.volumeM3.toFixed(0)} m³`
        }`,
        `调整后计划：${
          comparison.reduced.volumeM3 === null ? "缺数" : `${comparison.reduced.volumeM3.toFixed(0)} m³`
        }`,
        `理论差异：${
          comparison.diffM3 === null ? "缺数，无法对比" : `${comparison.diffM3.toFixed(0)} m³`
        }`,
        `${basis === "measured" ? "口径：MOCK 模拟遥测流量" : "口径：设备额定流量（额定参数）"}。${comparison.note}`,
      ],
    };
  }
  const pressure = suggestions.find((item) => item.id === "pressure-low");
  return {
    title: "根据异常生成检查任务",
    lines: pressure
      ? [
          `触发规则：${pressure.title}`,
          `${pressure.finding}`,
          `检查方向：${pressure.action}`,
          canCreateOrder.value
            ? "可点击下方按钮生成检查工单草稿，仅写入草稿、不派单。"
            : `FORBIDDEN：角色「${roleNames[store.role]}」无 workorder:create 权限，不能生成工单草稿。`,
        ]
      : ["当前场景未触发末端压力异常规则，没有可生成的检查任务。"],
  };
}

function createSprayCheckDraft(): void {
  sprayDraftMessage.value = "";
  const snapshots = spraySnapshots();
  const summary = summarizeSpray(snapshots);
  const activeAlarms = store.alarms.filter(
    (alarm) => alarm.subsystemId === "spray" && alarm.status === "active",
  );
  const suggestions = analyzeSprayScene({
    context: buildSprayContext(store.scenarioId),
    snapshots,
    summary,
    alarms: activeAlarms,
  });
  const target = suggestions.find((item) => item.id === "pressure-low");
  if (!target) {
    sprayDraftMessage.value = "当前场景未触发末端压力异常规则，未生成检查任务。";
    return;
  }
  if (!canCreateOrder.value) {
    sprayDraftMessage.value = `FORBIDDEN：角色「${roleNames[store.role]}」无 workorder:create 权限，不能生成工单草稿。`;
    return;
  }
  const assetId = target.relatedAssetIds[0] ?? snapshots[0]?.assetId;
  if (!assetId) {
    sprayDraftMessage.value = "缺少关联设备，未生成检查任务。";
    return;
  }
  const alarm = activeAlarms.find((item) => item.assetId === assetId);
  const title = "射雾器末端压力异常检查（待确认）";
  const existing = store.workorders.find(
    (order) => order.status !== "cancelled" && order.title === title,
  );
  if (existing) {
    sprayDraftMessage.value = `已存在任务 ${existing.code}，未重复创建。`;
    return;
  }
  try {
    const order = store.createWorkOrder({
      title,
      assetId,
      source: alarm ? "alarm" : "manual",
      alarmId: alarm?.id,
      symptom: target.finding,
      suggestion: target.action,
      priority: "high",
      evidenceIds: [
        ...(alarm ? [alarm.id] : []),
        ...target.relatedAssetIds.map((id) => `${id}-pressure`),
      ],
    });
    sprayDraftMessage.value = `已生成工单草稿 ${order.code}（关联告警 ${
      alarm?.code ?? "无"
    }，未派单）。`;
    message.success(`已生成工单草稿 ${order.code}，未派单`);
  } catch (error) {
    sprayDraftMessage.value = (error as Error).message;
  }
}

const suggestedWaterPage=computed(()=>{
  const prompt=parsed.value?.prompt??"";
  if(!/(循环水|循环利用|水量账本|大机供水|大机用水|动态平衡|供需平衡|中水|自来水|雨水|回用水|水资源)/.test(prompt))return null;
  if(/大机/.test(prompt))return {path:"/water/machine-supply",label:"各大机供水保障"};
  if(/动态平衡|供需平衡/.test(prompt))return {path:"/water/balance",label:"供需动态平衡"};
  return {path:"/water/overview",label:"水资源循环利用"};
});
const queryAnswer = computed(() => {
  const intent = parsed.value;
  if (!intent || intent.kind !== "query") return null;
  const water=answerWaterUsageQuery(intent.prompt,store.seed.ledger);
  if(water)return {title:water.title,lines:water.lines};
  if (intent.topic) return sprayAnswer(intent.topic);
  if (intent.targetAssetId) {
    const asset = store.getAsset(intent.targetAssetId);
    if (!asset) return null;
    const points = store.getPoints(asset.id);
    const subsystemName =
      store.subsystems.find((item) => item.id === asset.subsystemId)?.name ?? asset.subsystemId;
    return {
      title: `${asset.code} · ${asset.name}`,
      lines: [
        `状态：${asset.status}｜所属：${subsystemName}｜区域：${
          asset.area === "north" ? "北区" : "南区"
        }`,
        `测点（${points.length}）：${points.map((point) => point.label).join("、") || "无"}`,
        `数据标签：模拟数据｜参考时刻 ${formatAt(store.seed.referenceTime)}`,
      ],
    };
  }
  const activeAlarms = store.alarms.filter((alarm) => alarm.status === "active").length;
  return {
    title: "本地演示数据概览",
    lines: [
      `设备 ${store.assets.length} 台｜测点 ${store.points.length} 个｜活动告警 ${activeAlarms} 条`,
      `子系统 ${store.subsystems.length} 个｜场景 ${store.scenarioId}｜seed ${store.seedVersion}`,
      "只读统计，不包含推断或生产控制结论。",
    ],
  };
});

const targetSubsystemName = computed(() =>
  parsed.value?.subsystemId
    ? store.subsystems.find((item) => item.id === parsed.value?.subsystemId)?.name ?? ""
    : "",
);

function goRoute(path: string): void {
  void ui.navigate(router, path);
}

function openCreatedDrawer(): void {
  if (!lastCreated.value) return;
  ui.openAsset(lastCreated.value.assetId);
  ui.closeAi();
}

function onWizardCreated(payload: CreatedPayload): void {
  lastCreated.value = payload;
  ui.lastTask = { assetId: payload.assetId, scenarioId: store.scenarioId, role: store.role };
  if (!run.value) return;
  const at = store.seed.referenceTime;
  let updated = patchStep(
    run.value,
    "confirm",
    { status: "done", outputSummary: `管理员确认创建 ${payload.code}` },
    at,
  );
  updated = patchStep(
    updated,
    "commit",
    {
      status: "done",
      outputSummary: `写入 assetId=${payload.assetId}，新增 ${payload.pointIds.length} 个测点${
        payload.hotspot ? "与 1 个热点" : "，未布置工艺点位"
      }`,
    },
    at,
  );
  updated = patchStep(
    updated,
    "sync",
    {
      status: "done",
      outputSummary: "设备台账、工艺热点、设备抽屉、趋势与搜索已同步",
    },
    at,
  );
  run.value = setRunStatus(updated, "done", at);
  persistRun();
  const showOnMap = payload.hotspot && /查看|显示|定位/.test(wizardIntent.value?.prompt ?? "") && /工艺图/.test(wizardIntent.value?.prompt ?? "");
  void router.push(showOnMap ? { name: "process", params: { subsystemId: payload.subsystemId },
    query: { assetId: payload.assetId } } : { name: "assets", query: { assetId: payload.assetId } });
}

function onWizardCancelled(): void {
  wizardOpen.value = false;
  wizardIntent.value = null;
  parsed.value = null;
  lastCreated.value = null;
  if (run.value) {
    const at = store.seed.referenceTime;
    let updated = run.value;
    for (const item of updated.steps) {
      if (item.status === "pending" || item.status === "running") {
        updated = patchStep(
          updated,
          item.id,
          { status: "cancelled", outputSummary: "用户取消，未写入" },
          at,
        );
      }
    }
    run.value = setRunStatus(updated, "cancelled", at);
    persistRun();
  }
  message.info("已取消，未产生设备、测点或绑定残留");
}

function onWizardClose(): void {
  wizardOpen.value = false;
  wizardIntent.value = null;
}

watch(() => [store.scenarioId, store.role], () => {
  ui.lastTask = null;
  ui.closeAsset();
  ui.closeAi();
  parsed.value = null;
  diagnosis.value = null;
  waterAnswer.value = null;
  waterSavedId.value = "";
  handoverPreview.value = null;
  handoverSavedId.value = "";
  knowledgeAnswer.value = null;
  confirmOrderOpen.value = false;
});
watch(
  () => ui.aiOpen,
  (open) => {
    if (open || !wizardOpen.value) return;
    if (lastCreated.value) {
      // 已提交成功，关闭抽屉只收起向导，不回滚任务记录。
      wizardOpen.value = false;
      wizardIntent.value = null;
      return;
    }
    onWizardCancelled();
  },
);
</script>

<template>
  <div class="ai-panel">
    <p class="context">{{ contextLabel }}</p>

    <section class="catalog">
      <button type="button" class="catalog-toggle" @click="catalogOpen = !catalogOpen">
        <span>支持指令</span>
        <span>{{ catalogOpen ? "−" : "+" }}</span>
      </button>
      <ul v-if="catalogOpen" class="catalog-list">
        <li v-for="item in catalog" :key="item.id" :class="{ unsupported: !item.supported }">
          <div>
            <strong>{{ item.label }}</strong>
            <span>{{ item.supported ? "可用" : "不受支持" }}</span>
          </div>
          <button type="button" class="catalog-example" @click="useExample(item.example)">
            {{ item.example }}
          </button>
        </li>
      </ul>
    </section>

    <NInput
      v-model:value="ui.aiPrompt"
      type="textarea"
      placeholder="例如：分析未来80毫米降雨并比较雨前调蓄方案。也支持新增设备、测点、图表及工单等操作。"
      :autosize="{ minRows: 3, maxRows: 7 }"
      @keydown.ctrl.enter="submit()"
      @keydown.meta.enter="submit()"
    />

    <div class="quick">
      <button
        v-for="item in catalog.slice(0, 4)"
        :key="`quick-${item.id}`"
        type="button"
        class="quick-btn"
        @click="useExample(item.example)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="water-ai-quick">
      <span>水务自动办事示例</span>
      <button type="button" @click="useExample('分析未来80毫米降雨并比较雨前调蓄方案')">80mm雨前调蓄</button>
      <button type="button" @click="useExample('比较雨水、中水、自来水的供水经济方案')">三水源优化</button>
      <button type="button" @click="useExample('查询当前无人值守待处理事件')">值守事件查询</button>
      <button type="button" @click="useExample('帮我完成今天的运行检查，整理异常情况，生成交班报告')">一键交班报告</button>
      <button type="button" @click="useExample('查找P-002振动异常的诊断依据')">知识证据核查</button>
      <button type="button" @click="goRoute('/water/overview')">循环利用管理</button>
      <button type="button" @click="goRoute('/water/machine-supply')">大机供水保障</button>
      <button type="button" @click="goRoute('/water/balance')">动态平衡分析</button>
    </div>
    <div class="submit-row">
      <NTag size="tiny" :bordered="false" type="warning">本地规则解析 · 不调用大模型</NTag>
      <NButton type="primary" :disabled="!canAsk" @click="submit()">解析指令</NButton>
    </div>
    <p v-if="!canAsk" class="warn">
      角色「{{ roleNames[store.role] }}」无 AI 询问权限，无法提交指令。
    </p>

    <section v-if="parsed" class="intent-card">
      <header>
        <div>
          <span class="eyebrow">意图识别</span>
          <strong>{{ KIND_LABELS[parsed.kind] }}</strong>
        </div>
        <NTag size="tiny" :bordered="false" :type="kindTagType(parsed.kind)">
          {{ parsed.kind }}
        </NTag>
      </header>
      <p v-if="targetSubsystemName" class="meta">目标子系统：{{ targetSubsystemName }}</p>
      <p v-if="parsed.targetAssetCode" class="meta">目标设备：{{ parsed.targetAssetCode }}</p>
      <p v-if="parsed.reason" class="reason">{{ parsed.reason }}</p>

      <ul v-if="parsed.errors.length" class="issues">
        <li v-for="issue in parsed.errors" :key="issue.field">{{ issue.message }}</li>
      </ul>

      <template v-if="parsed.kind === 'create_asset'">
        <div class="diff-lines">
          <span>设备：{{ parsed.asset?.code ?? "编号未识别" }} · {{ parsed.asset?.name ?? "名称未识别" }}</span>
          <span>
            额定：{{ parsed.asset?.rated.powerKw ?? "缺" }} kW /
            {{ parsed.asset?.rated.flowM3h ?? "缺" }} m³/h /
            {{ parsed.asset?.rated.headM ?? "缺" }} m
          </span>
          <span>测点：{{ parsed.points.map((point) => point.label).join("、") || "未识别" }}</span>
          <span>工艺点位：{{ parsed.asset?.wantsBinding ? "指令要求上图，需人工点选" : "未指定，可保存为未布置" }}</span>
        </div>
        <NButton type="primary" secondary @click="wizardOpen = true; wizardIntent = parsed">
          打开五步向导
        </NButton>
        <p v-if="!canCreate" class="warn">
          当前角色可预览但不可提交；确认按钮需系统管理员角色。
        </p>
        <div v-if="lastCreated" class="created-card">
          <strong>已创建 {{ lastCreated.code }} · {{ lastCreated.name }}</strong>
          <span>assetId：{{ lastCreated.assetId }}</span>
          <span>测点 {{ lastCreated.pointIds.length }} 个｜{{ lastCreated.hotspot ? "已布置热点" : "未布置热点" }}</span>
          <div class="created-actions">
            <NButton size="tiny" secondary @click="openCreatedDrawer">打开设备抽屉</NButton>
            <NButton size="tiny" quaternary @click="goRoute(`/process/${lastCreated.subsystemId}`)">
              查看工艺图
            </NButton>
            <NButton size="tiny" quaternary @click="goRoute(`/operations/assets?assetId=${lastCreated.assetId}`)">
              设备台账
            </NButton>
          </div>
        </div>
      </template>

      <template v-else-if="parsed.kind === 'add_measure_point' && addPreview">
        <div class="diff-lines">
          <span>
            目标设备：
            {{ addPreview.target ? `${addPreview.target.code} · ${addPreview.target.name}` : "未识别" }}
          </span>
          <span>将新增测点：{{ parsed.points.map((point) => `${point.label}${point.unit ? `（${point.unit}）` : ""}`).join("、") }}</span>
          <span>不会创建第二台设备；确认后设备抽屉、监测列表与 AI 查询同步更新。</span>
        </div>
        <p v-if="addBlockedReason" class="warn">{{ addBlockedReason }}</p>
        <p v-if="rejectMessage" class="warn">{{ rejectMessage }}</p>
        <div v-if="addDone" class="created-card">
          <strong>已为 {{ addDone.assetCode }} 追加 {{ addDone.labels.length }} 个测点</strong>
          <span>{{ addDone.labels.join("、") }}</span>
          <span>已同步设备抽屉 / 监测列表 / AI 查询，未创建新设备。</span>
          <div class="created-actions">
            <NButton size="tiny" secondary @click="ui.openAsset(addDone.assetId)">打开设备抽屉</NButton>
          </div>
        </div>
        <NButton
          v-else
          type="primary"
          secondary
          :disabled="Boolean(addBlockedReason)"
          @click="confirmAddPoints"
        >
          确认追加测点
        </NButton>
      </template>

      <template v-else-if="parsed.kind === 'move_process_binding'">
        <p class="warn">需要人工点选：文字位置无法可靠换算为归一化坐标。</p>
        <NButton
          v-if="parsed.targetAssetId"
          type="primary"
          secondary
          @click="goRoute(`/process/${parsed.subsystemId}?assetId=${parsed.targetAssetId}&tab=overview&mode=bind`)"
        >
          去工艺图点选位置
        </NButton>
      </template>

      <template v-else-if="parsed.kind === 'diagnose_asset'">
        <div class="diff-lines">
          <span>
            诊断对象：
            {{
              diagnosis?.asset
                ? `${diagnosis.asset.code} · ${diagnosis.asset.name}`
                : "未找到设备"
            }}
          </span>
          <span v-if="diagnosis?.health">
            健康评分：{{
              diagnosis.health.score === null
                ? diagnosis.health.band
                : `${diagnosis.health.score}（${diagnosis.health.band}）`
            }} · 因子覆盖率 {{ Math.round(diagnosis.health.coverage * 100) }}%
          </span>
          <span v-if="diagnosis?.trend">
            14 日趋势：{{ diagnoseTrendLabel }} · 有效样本 {{ diagnosis.trend.sampleCount }} 个
          </span>
          <span>
            证据 {{ diagnosis?.evidence.length ?? 0 }} 项 ·
            {{
              diagnosis?.advice?.degraded
                ? "缺少已审核档案，建议已降级为通用检查项"
                : "引用已审核档案与历史记录"
            }}
          </span>
          <span>仅展示规则评分、趋势与可定位证据，不输出 RUL 或故障概率。</span>
        </div>
        <div class="diagnose-actions">
          <NButton size="small" secondary @click="goRoute(parsed.route ?? '/decision/health')">
            去健康页查看
          </NButton>
          <NButton v-if="diagnosis?.asset" size="small" secondary
            @click="goRoute('/decision/knowledge?assetId='+encodeURIComponent(diagnosis.asset.id)+'&symptom='+encodeURIComponent('振动异常'))">
            查找知识依据
          </NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!canCreateOrder || !diagnosis?.draft"
            :title="createOrderReason"
            @click="requestCreateDraft"
          >
            生成工单草稿
          </NButton>
        </div>
        <p v-if="!canCreateOrder" class="warn">{{ createOrderReason }}</p>
        <p v-else-if="!diagnosis?.draft" class="warn">
          缺少可用的振动趋势快照，暂不能生成工单草稿。
        </p>
        <div v-if="existingDraft" class="created-card">
          <strong>已存在相同草稿 {{ existingDraft.code }}</strong>
          <span>{{ existingDraft.title }} · 未派单</span>
          <div class="created-actions">
            <NButton size="tiny" secondary @click="evidenceOrderId = existingDraft.id">
              打开工单
            </NButton>
          </div>
        </div>
        <div v-if="confirmOrderOpen && diagnosis?.draft" class="confirm-card">
          <strong>人工确认：生成工单草稿</strong>
          <span>标题：{{ diagnosis.draft.title }}</span>
          <span>来源 health_trend · 仅生成草稿，不派单、不修改设备数据。</span>
          <span>证据：{{ diagnosis.draft.evidenceIds?.length ?? 0 }} 项</span>
          <div class="confirm-actions">
            <NButton size="small" type="primary" @click="confirmCreateDraft">
              确认生成（仅草稿）
            </NButton>
            <NButton size="small" quaternary @click="confirmOrderOpen = false">取消</NButton>
          </div>
        </div>
        <p v-if="rejectMessage" class="warn">{{ rejectMessage }}</p>
        <div v-if="lastDraftOrderId" class="created-card">
          <strong>已生成工单草稿 {{ lastDraftOrderId }}</strong>
          <span>未派单；可在工单页继续提交或归档。</span>
          <div class="created-actions">
            <NButton size="tiny" secondary @click="evidenceOrderId = lastDraftOrderId">
              打开工单
            </NButton>
          </div>
        </div>
      </template>

      <template v-else-if="parsed.kind === 'compose_ui'">
        <p class="meta">生成式图表由本地 A2UI 工作台承接；当前一期仅提供入口说明。</p>
        <NButton type="primary" secondary @click="goRoute(parsed.route ?? '/data/ai-workspace')">
          打开 AI 分析工作台
        </NButton>
      </template>

      <template v-else-if="parsed.kind === 'knowledge_query' && knowledgeAnswer">
        <div class="knowledge-ai-result">
          <div class="water-ai-title">
            <strong>{{ knowledgeAnswer.asset?.code }} · 知识证据核查</strong>
            <NTag size="tiny" type="warning">本地规则 · MOCK</NTag>
          </div>
          <p class="knowledge-ai-context">
            只查当前设备绑定资料：{{ knowledgeAnswer.query.symptom }}。
            {{ knowledgeAnswer.documents.length }}份原文可引用，{{ knowledgeAnswer.excluded.length }}份因审核或原文问题被排除。
          </p>
          <div v-if="knowledgeAnswer.documents.length" class="knowledge-ai-hits">
            <div v-for="hit in knowledgeAnswer.documents.slice(0,4)" :key="hit.id">
              <strong>{{ hit.title }}</strong>
              <small>{{ hit.citation }}</small>
              <p>{{ hit.excerpt }}</p>
              <NButton size="tiny" secondary @click="goRoute(hit.path)">核对原档案</NButton>
            </div>
          </div>
          <p v-else class="warn">没有适用设备、已审核且可定位原文的资料，不能凭空给出故障原因。</p>
          <p class="warn">{{ knowledgeAnswer.warnings[0] }}</p>
          <div class="water-ai-actions">
            <NButton type="primary" secondary size="small"
              @click="goRoute('/decision/knowledge?assetId='+encodeURIComponent(knowledgeAnswer.query.assetId)+'&symptom='+encodeURIComponent(knowledgeAnswer.query.symptom))">
              打开完整知识核验工作台
            </NButton>
          </div>
        </div>
      </template>

      <template v-else-if="parsed.kind === 'handover_workflow' && handoverPreview">
        <div class="handover-ai-result">
          <div class="water-ai-title">
            <strong>运行检查与交班报告 · 待审核</strong>
            <NTag size="tiny" type="warning">MOCK · 当前快照</NTag>
          </div>
          <p class="handover-context">本次实际执行 {{ handoverPreview.patrol.id ?? "未巡查" }}；
            仅 {{ handoverPreview.coverage.configured }}/{{ handoverPreview.coverage.total }} 套工艺具备演示巡查。
            不代表全天、全港完成巡检。
          </p>
          <div class="water-ai-metrics">
            <div><span>未关闭值守事件</span><strong>{{ handoverPreview.openDutyCount }}</strong></div>
            <div><span>活动生产告警</span><strong>{{ handoverPreview.activeProductionAlarmCount }}</strong></div>
            <div><span>未完工单（含草稿）</span><strong>{{ handoverPreview.outstandingOrderCount }}</strong></div>
            <div><span>P-002健康核验</span><strong>{{ handoverPreview.health?.score == null ? "资料不足" : handoverPreview.health.band }}</strong></div>
          </div>
          <div class="handover-steps">
            <div v-for="item in handoverPreview.steps" :key="item.id">
              <NTag size="tiny" :type="item.status === 'done' ? 'success' : 'warning'">{{ item.status === 'done' ? '完成' : '受阻' }}</NTag>
              <span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span>
            </div>
          </div>
          <div class="handover-issues">
            <strong>下一班需关注 · {{ handoverPreview.issues.length }}项</strong>
            <div v-for="item in handoverPreview.issues.slice(0, 8)" :key="item.kind+item.id">
              <span>{{ item.title }}</span>
              <button type="button" @click="goRoute(item.href)">查看依据</button>
            </div>
            <p v-if="handoverPreview.issues.length > 8">其余事项请在常用报表草稿中查看。</p>
          </div>
          <details class="handover-preview"><summary>展开交班报告全文和数据边界</summary>
            <pre>{{ handoverPreview.text }}</pre>
          </details>
          <p class="warn">{{ handoverPreview.warnings[0] }}</p>
          <div class="water-ai-actions">
            <NButton type="primary" size="small" :disabled="!canSaveHandover || Boolean(handoverSavedId)"
              @click="confirmHandoverDraft">
              {{ handoverSavedId ? '已保存待审核报告' : '确认保存交班报告草稿' }}
            </NButton>
            <NButton v-if="handoverSavedId" secondary size="small"
              @click="openHandoverReport">
              在常用报表查看草稿
            </NButton>
          </div>
          <p v-if="!canSaveHandover" class="warn">当前角色允许生成只读预览，但无权保存交班草稿。</p>
          <p v-if="handoverSavedId" class="water-ai-saved">报告 {{ handoverSavedId }} 已写入原报表中心的待审核记录，不是正式生产记录。</p>
        </div>
      </template>

      <template v-else-if="parsed.kind === 'water_workflow' && waterAnswer">
        <div class="water-ai-result">
          <div class="water-ai-title">
            <strong>{{ waterAnswer.title }}</strong>
            <NTag size="tiny" type="warning">MOCK · 规则计算</NTag>
          </div>
          <div class="water-ai-metrics">
            <div v-for="item in waterAnswer.metrics" :key="item.label">
              <span>{{ item.label }}</span><strong>{{ item.value }}</strong>
            </div>
          </div>
          <div class="water-ai-report">
            <p v-for="(line, index) in waterAnswer.resultLines" :key="index">{{ line }}</p>
          </div>
          <p class="warn">{{ waterAnswer.caveat }}</p>
          <p v-if="rejectMessage" class="warn">{{ rejectMessage }}</p>
          <div class="water-ai-actions">
            <NButton size="small" secondary @click="goRoute(waterResultRoute())">打开完整业务计算页面</NButton>
            <NButton v-if="waterAnswer.kind !== 'duty'" size="small" type="primary"
              :disabled="!canSaveWater || Boolean(waterSavedId) || (waterAnswer.kind === 'supply' && !waterAnswer.supply?.result.feasible)"
              @click="confirmWaterProposal">
              {{ waterSavedId ? '已保存草稿' : '确认保存待审核草稿' }}
            </NButton>
          </div>
          <p v-if="waterAnswer.kind === 'supply' && !waterAnswer.supply?.result.feasible" class="warn">
            当前存在供水缺口，不能作为完整供水建议保存。请先核实现场供水保障。
          </p>
          <p v-if="!canSaveWater && waterAnswer.kind !== 'duty'" class="warn">
            当前角色只允许分析，不允许写入水资源建议草稿。
          </p>
          <p v-if="waterSavedId" class="water-ai-saved">
            已同步原业务草稿：{{ waterSavedId }}，可在业务计算页面查看。未经现场核实不得执行。
          </p>
        </div>
      </template>

      <template v-else-if="parsed.kind === 'query'">
        <div v-if="suggestedWaterPage" class="created-actions">
          <NButton size="small" type="primary" @click="goRoute(suggestedWaterPage.path)">
            打开{{ suggestedWaterPage.label }}（本地业务页面）
          </NButton>
        </div>
        <div v-if="queryAnswer" class="diff-lines">
          <strong>{{ queryAnswer.title }}</strong>
          <span v-for="line in queryAnswer.lines" :key="line">{{ line }}</span>
        </div>
        <div v-if="parsed.topic === 'spray-check'" class="created-actions">
          <NButton
            size="small"
            type="primary"
            :disabled="!canCreateOrder"
            @click="createSprayCheckDraft"
          >
            生成检查工单草稿
          </NButton>
        </div>
        <p v-if="sprayDraftMessage" class="warn">{{ sprayDraftMessage }}</p>
      </template>

      <template v-else>
        <p class="warn">能力边界：本地 DEMO 不会启动设备、调节阀门、改阈值或下发控制指令。</p>
        <div class="examples">
          <span>可尝试：</span>
          <button
            v-for="example in parsed.examples"
            :key="example"
            type="button"
            class="example-btn"
            @click="useExample(example)"
          >
            {{ example }}
          </button>
        </div>
      </template>
    </section>

    <section v-if="run" class="run-card">
      <header class="run-head">
        <div>
          <span class="eyebrow">任务时间线</span>
          <strong>{{ run.title }}</strong>
        </div>
        <NTag size="tiny" :bordered="false" :type="statusTagType(run.status)">
          {{ runStatusLabel(run.status) }}
        </NTag>
      </header>

      <p class="run-id">任务 ID：{{ run.id }} · 状态：{{ runStatusLabel(run.status) }}</p>

      <ol class="timeline">
        <li v-for="(item, index) in run.steps" :key="item.id" :class="item.status">
          <span class="tl-index">{{ index + 1 }}</span>
          <div class="tl-body">
            <div class="tl-head">
              <strong>{{ item.action }}</strong>
              <NTag size="tiny" :bordered="false" :type="stepTagType(item.status)">
                {{ stepStatusLabel(item.status) }}
              </NTag>
            </div>
            <p class="tl-agent">
              {{ item.agentName }}<span v-if="item.tool"> · 工具 {{ item.tool }}</span>
            </p>
            <p class="tl-line"><b>输入</b>{{ item.inputSummary }}</p>
            <p class="tl-line"><b>输出</b>{{ item.outputSummary }}</p>
            <p v-if="item.errorCode" class="tl-error">错误码：{{ item.errorCode }}</p>
            <div v-if="item.evidence?.length" class="tl-evidence">
              <button
                v-for="ref in item.evidence"
                :key="`${item.id}-${ref.kind}-${ref.refId}`"
                type="button"
                class="evidence-chip"
                :title="ref.detail ?? ref.label"
                @click="openEvidence(ref)"
              >
                <span class="chip-kind">{{ evidenceKindLabel(ref.kind) }}</span>
                {{ ref.label }}
              </button>
            </div>
            <NButton
              v-if="
                (item.status === 'failed' || item.status === 'blocked') && item.retryable
              "
              size="tiny"
              secondary
              @click="retryStep(item.id)"
            >
              重试此步
            </NButton>
          </div>
        </li>
      </ol>

      <p v-if="runLogError" class="log-error">{{ runLogError }}</p>
      <div class="run-foot">
        <NButton
          v-if="run.status === 'awaiting_confirmation' || run.status === 'running'"
          size="small"
          quaternary
          @click="cancelRun"
        >
          取消任务
        </NButton>
        <span>仅展示步骤、工具与输入输出摘要，不展示思维链；id 稳定，可重试且不会重复创建。</span>
      </div>
    </section>

    <AssetCreateWizard
      v-if="wizardOpen && wizardIntent"
      :intent="wizardIntent"
      @created="onWizardCreated"
      @cancelled="onWizardCancelled"
      @close="onWizardClose"
    />

    <NModal
      v-model:show="documentOpen"
      preset="card"
      title="档案证据详情"
      style="width: min(680px, 92vw)"
    >
      <DocumentDetail :doc-id="evidenceDocId" @deleted="documentOpen = false" />
    </NModal>

    <WorkOrderDrawer
      :work-order-id="evidenceOrderId"
      @close="evidenceOrderId = null"
    />
  </div>
</template>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.context {
  margin: 0;
  padding: 9px 11px;
  border-radius: 8px;
  background: #f0f7fb;
  font-size: 11.5px;
  color: #3d5a72;
  line-height: 1.6;
}
.catalog {
  border: 1px solid #e2edf4;
  border-radius: 8px;
  background: #fbfdff;
  overflow: hidden;
}
.catalog-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 11px;
  border: 0;
  background: transparent;
  font-size: 12px;
  color: #2a4660;
  cursor: pointer;
}
.catalog-list {
  margin: 0;
  padding: 0 11px 10px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.catalog-list li > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: #1c3e57;
}
.catalog-list li > div span {
  font-size: 10px;
  color: #2f7a63;
}
.catalog-list li.unsupported > div span {
  color: #b0453d;
}
.catalog-example {
  margin-top: 3px;
  width: 100%;
  padding: 6px 8px;
  border: 1px dashed #dbe8f1;
  border-radius: 6px;
  background: #f7fbfe;
  font-size: 10.5px;
  color: #5d7387;
  text-align: left;
  line-height: 1.5;
  cursor: pointer;
}
.catalog-example:hover {
  border-color: #7fb4cd;
  color: #247ba8;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.quick-btn {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid #d8e8f2;
  background: #f6fbfe;
  font-size: 10.5px;
  color: #2a4660;
  cursor: pointer;
}
.quick-btn:hover {
  border-color: #7fb4cd;
  background: #eef7fc;
}
.submit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.warn {
  margin: 0;
  padding: 7px 9px;
  border-radius: 7px;
  background: #fdf7ec;
  border: 1px solid #f0d6a4;
  font-size: 11px;
  color: #8a5c15;
  line-height: 1.6;
}
.log-error {
  margin: 0;
  font-size: 10.5px;
  color: #b0453d;
  line-height: 1.6;
}
.intent-card,
.run-card {
  border: 1px solid #e2edf4;
  border-radius: 9px;
  padding: 11px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.intent-card > header,
.run-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.intent-card > header > div,
.run-head > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.eyebrow {
  font-size: 9.5px;
  letter-spacing: 0.4px;
  color: #93a7b7;
  text-transform: uppercase;
}
.intent-card strong,
.run-head strong {
  font-size: 12.5px;
  color: #1c3e57;
  line-height: 1.4;
}
.meta,
.reason {
  margin: 0;
  font-size: 11px;
  color: #5d7387;
  line-height: 1.65;
}
.reason {
  color: #8a5c15;
  background: #fdf7ec;
  padding: 7px 9px;
  border-radius: 6px;
}
.issues {
  margin: 0;
  padding: 8px 10px 8px 24px;
  border-radius: 7px;
  background: #fdf1f0;
  color: #a33f37;
  font-size: 11px;
  line-height: 1.8;
}
.diff-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: #2a4660;
  line-height: 1.6;
}
.diff-lines span {
  color: #5d7387;
}
.created-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 10px;
  border-radius: 7px;
  background: #f1faf7;
  border: 1px solid #bfe0d4;
  font-size: 11px;
  color: #3d6f66;
}
.created-card strong {
  color: #2f7a63;
  font-size: 12px;
}
.created-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.examples {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11px;
  color: #5d7387;
}
.example-btn {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px dashed #d8e8f2;
  background: #f7fbfe;
  font-size: 10.5px;
  color: #2a4660;
  text-align: left;
  cursor: pointer;
}
.example-btn:hover {
  border-color: #7fb4cd;
  color: #247ba8;
}
.timeline {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.timeline li {
  display: flex;
  gap: 8px;
  padding-left: 2px;
}
.tl-index {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  background: #e8f0f6;
  font-size: 10px;
  color: #6c8296;
}
.timeline li.done .tl-index {
  background: #d9f0e7;
  color: #2f7a63;
}
.timeline li.blocked .tl-index,
.timeline li.failed .tl-index {
  background: #fbe8e6;
  color: #b0453d;
}
.tl-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.tl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.tl-head strong {
  font-size: 11.5px;
  color: #1c3e57;
}
.tl-agent {
  margin: 0;
  font-size: 10px;
  color: #93a7b7;
}
.tl-line {
  margin: 0;
  font-size: 10.5px;
  color: #5d7387;
  line-height: 1.55;
  word-break: break-word;
}
.tl-line b {
  margin-right: 4px;
  color: #8296a8;
  font-weight: 500;
}
.tl-error {
  margin: 0;
  font-size: 10px;
  color: #b0453d;
}
.run-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed #eef5fa;
}
.run-foot span {
  font-size: 10px;
  color: #93a7b7;
  line-height: 1.6;
}
.run-id {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  color: #93a7b7;
  word-break: break-all;
}
.diagnose-actions,
.confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.confirm-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 10px;
  border-radius: 7px;
  background: #fdf7ec;
  border: 1px solid #f0d6a4;
  font-size: 11px;
  color: #8a5c15;
  line-height: 1.6;
}
.confirm-card strong {
  font-size: 12px;
}
.tl-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}
.evidence-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #cfe3ee;
  background: #f2f9fd;
  color: #247ba8;
  font-size: 10px;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evidence-chip:hover {
  background: #e4f2fb;
}
.chip-kind {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 4px;
  background: #e3f0f9;
  color: #247ba8;
  font-size: 9px;
}
/* AI检索只显示原文摘录、可点击ID、版本章节，不生成无来源叙事 */
.knowledge-ai-result{display:grid;gap:10px}
.knowledge-ai-context{font-size:11px;line-height:1.7;color:#6c90a3;background:#f4f9fc;padding:9px;border-radius:7px;margin:0}
.knowledge-ai-hits{display:grid;gap:8px}
.knowledge-ai-hits>div{display:grid;gap:5px;padding:10px;background:#f8fcfe;border:1px solid #deedf5;border-radius:7px}
.knowledge-ai-hits strong{font-size:11px;color:#2c789b}
.knowledge-ai-hits small{font-size:10px;color:#87a2b3}
.knowledge-ai-hits p{font-size:11px;line-height:1.7;color:#628396;margin:0}
.knowledge-ai-hits .n-button{justify-self:start}
/* 多步骤交班任务预览：异常优先，专业明细按需展开 */
.handover-ai-result{display:grid;gap:10px}
.handover-context{font-size:11px;line-height:1.7;color:#628294;background:#eff7fc;border-radius:6px;padding:9px;margin:0}
.handover-steps{display:grid;gap:5px}
.handover-steps>div{display:flex;gap:8px;align-items:flex-start;border-bottom:1px solid #e7eff5;padding:7px 2px}
.handover-steps>div>span{display:grid;gap:4px;flex:1}
.handover-steps strong{font-size:11px;color:#32617b}
.handover-steps small{font-size:10px;line-height:1.5;color:#92a7b6}
.handover-issues{display:grid;gap:6px;padding:10px;background:#fffaf4;border:1px solid #f1e2cb;border-radius:8px}
.handover-issues>strong{font-size:12px;color:#936e44}
.handover-issues>div{display:flex;align-items:center;justify-content:space-between;gap:7px}
.handover-issues span,.handover-issues p{font-size:11px;color:#796c5b}
.handover-issues button{border:0;background:transparent;color:#267c9f;font-size:11px;cursor:pointer;white-space:nowrap}
.handover-preview{border:1px solid #e3edf3;border-radius:7px;padding:9px;font-size:11px}
.handover-preview summary{cursor:pointer;color:#287ba2}
.handover-preview pre{max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.8 ui-monospace,SFMono-Regular,monospace;color:#597485}
/* 三个可执行入口置于AI输入框附近，避免用户记忆复杂指令 */
.water-ai-quick{display:flex;flex-wrap:wrap;align-items:center;gap:6px;background:#f2f8fc;border:1px solid #dfeef5;padding:8px;border-radius:7px}
.water-ai-quick>span{font-size:10px;color:#718b9e;margin-right:3px}
.water-ai-quick button{font-size:10px;color:#24789d;border:1px solid #c7e0f0;background:white;border-radius:5px;padding:5px 7px;cursor:pointer}
.water-ai-quick button:hover{background:#e9f7ff}
/* 水务业务结果使用统一AI抽屉卡片，而非新的独立聊天系统 */
.water-ai-result{display:grid;gap:10px}
.water-ai-title{display:flex;justify-content:space-between;gap:9px;align-items:center}
.water-ai-title strong{font-size:13px;color:#214d67}
.water-ai-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.water-ai-metrics>div{display:grid;gap:5px;background:#f1f8fc;border:1px solid #e1eff6;border-radius:7px;padding:10px;min-width:0}
.water-ai-metrics span{font-size:10px;color:#829dac}
.water-ai-metrics strong{font-size:15px;color:#2673a0;overflow-wrap:anywhere}
.water-ai-report{background:#f8fbfd;padding:10px;border-radius:7px;border:1px solid #e7eff4}
.water-ai-report p{font-size:11px;line-height:1.8;color:#4e7287;margin:0 0 8px}
.water-ai-report p:last-child{margin-bottom:0}
.water-ai-actions{display:flex;flex-wrap:wrap;gap:7px}
.water-ai-saved{font-size:11px;color:#188761;background:#e7f8f1;border-radius:7px;padding:9px;margin:0}
</style>

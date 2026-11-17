import { hashString } from "./random";
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentStepStatus,
  AgentTaskType,
} from "./types";

export interface StepInput {
  id: string;
  agentName: string;
  action: string;
  tool?: string;
  inputSummary: string;
  outputSummary: string;
  status?: AgentStepStatus;
  errorCode?: string;
  retryable?: boolean;
}

/** 由任务类型与指令内容派生稳定 id，重试或重复提交不会产生新记录。 */
export function stableRunId(taskType: AgentTaskType, prompt: string): string {
  return `run-${taskType}-${hashString(prompt.trim()).toString(16)}`;
}

export function makeStep(input: StepInput, at?: string): AgentStep {
  const status = input.status ?? "pending";
  const finished = status === "done" || status === "blocked" || status === "failed";
  return {
    id: input.id,
    agentName: input.agentName,
    action: input.action,
    tool: input.tool,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
    status,
    errorCode: input.errorCode,
    startedAt: status === "pending" ? undefined : at,
    endedAt: finished ? at : undefined,
    retryable: input.retryable ?? status === "failed",
  };
}

export interface CreateRunInput {
  taskType: AgentTaskType;
  title: string;
  prompt: string;
  at: string;
  steps: AgentStep[];
  status?: AgentRunStatus;
  context?: Record<string, string>;
}

export function createAgentRun(input: CreateRunInput): AgentRun {
  return {
    id: stableRunId(input.taskType, input.prompt),
    taskType: input.taskType,
    title: input.title,
    prompt: input.prompt,
    status: input.status ?? "running",
    steps: input.steps,
    context: input.context ?? {},
    createdAt: input.at,
    updatedAt: input.at,
  };
}

export function patchStep(
  run: AgentRun,
  stepId: string,
  patch: Partial<AgentStep>,
  at: string,
): AgentRun {
  return {
    ...run,
    steps: run.steps.map((step) =>
      step.id === stepId ? { ...step, ...patch, endedAt: patch.endedAt ?? at } : step,
    ),
    updatedAt: at,
  };
}

export function setRunStatus(run: AgentRun, status: AgentRunStatus, at: string): AgentRun {
  return { ...run, status, updatedAt: at };
}

export function stepStatusLabel(status: AgentStepStatus): string {
  switch (status) {
    case "pending":
      return "待执行";
    case "running":
      return "执行中";
    case "done":
      return "完成";
    case "blocked":
      return "受阻";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

export function runStatusLabel(status: AgentRunStatus): string {
  switch (status) {
    case "running":
      return "执行中";
    case "awaiting_confirmation":
      return "等待人工确认";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

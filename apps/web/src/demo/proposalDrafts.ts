/**
 * 雨前调蓄与多水源供水共用的本地草稿保存接口。
 * 复用现有 localStorage 业务key和schema，避免AI另建孤岛。
 * 第一阶段只保存 MOCK 草稿，不下发控制、不提交正式审批或工单。
 */
import { assertCan } from "./permissions";
import type { Role } from "./types";
import type { DispatchAssessment, DispatchInputs, DispatchKind } from "./dispatch";
import type { MultiSourceInputs, WaterSupplyResult } from "./multisource";
import { cloneMultiSource, evaluateMultiSource } from "./multisource";

export const DISPATCH_DRAFT_KEY = "tanggang-water-dispatch-drafts-v1";
export const MULTI_SOURCE_DRAFT_KEY = "tanggang-multisource-drafts-v1";

export interface DispatchDraft {
  id: string;
  createdAt: string;
  createdBy: string;
  kind: DispatchKind;
  name: string;
  dataSource: "MOCK";
  state: "draft";
  parameters: DispatchInputs;
  result: {
    overflowM3: number;
    peakM3: number;
    extraReuseM3: number;
    preReleaseM3: number;
    incrementalNetCostYuan: number;
  };
}
export interface SupplyDraft {
  id: string; createdAt: string; createdBy: string; state: "draft"; source: "MOCK";
  name: string; inputs: MultiSourceInputs;
  result: {
    suppliedM3: number; unmetM3: number; totalCostYuan: number;
    allTapBaselineYuan: number | null; savingVsTapYuan: number | null; nonTapSuppliedM3: number;
  };
}
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function generateId(prefix: string): string {
  // 加随机后缀，防同毫秒重复提交；重复确认仍由UI禁用按钮拦截。
  return prefix + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}
export function readDrafts<T>(key: string, storage: DraftStorage): T[] {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
}
function persistOne<T>(key: string, draft: T, storage: DraftStorage): T {
  const all = readDrafts<T>(key, storage);
  storage.setItem(key, JSON.stringify([draft, ...all].slice(0, 30)));
  return draft;
}
export function saveDispatchDraft(
  assessment: DispatchAssessment, role: Role, storage: DraftStorage,
): DispatchDraft {
  assertCan(role, "water:proposal");
  const chosen = assessment.options.find(o => o.kind === assessment.recommended);
  if (!chosen || !chosen.feasible) throw new Error("不存在满足约束条件的推荐调蓄方案");
  const draft: DispatchDraft = {
    id: generateId("DSP-"), createdAt: new Date().toISOString(), createdBy: role,
    kind: chosen.kind, name: chosen.title, dataSource: "MOCK", state: "draft",
    parameters: { ...assessment.inputs },
    result: {
      overflowM3: chosen.overflowM3, peakM3: chosen.peakM3,
      extraReuseM3: chosen.extraReuseM3, preReleaseM3: chosen.preReleaseM3,
      incrementalNetCostYuan: chosen.incrementalNetCostYuan,
    },
  };
  return persistOne(DISPATCH_DRAFT_KEY, draft, storage);
}
export function saveSupplyDraft(
  inputs: MultiSourceInputs, result: WaterSupplyResult, role: Role, storage: DraftStorage,
): SupplyDraft {
  assertCan(role, "water:proposal");
  if (!result.feasible || result.unmetM3 > 1e-6) throw new Error("存在未满足需求，禁止保存为完整供水方案");
  const draft: SupplyDraft = {
    id: generateId("WS-"), createdAt: new Date().toISOString(), createdBy: role,
    state: "draft", source: "MOCK", name: "三水源协同供水建议",
    inputs: cloneMultiSource(inputs),
    result: {
      suppliedM3: result.suppliedM3, unmetM3: result.unmetM3,
      totalCostYuan: result.totalCostYuan, allTapBaselineYuan: result.allTapBaselineYuan,
      savingVsTapYuan: result.savingVsTapYuan, nonTapSuppliedM3: result.nonTapSuppliedM3,
    },
  };
  return persistOne(MULTI_SOURCE_DRAFT_KEY, draft, storage);
}

/**
 * Resolve one selected supply draft for cost comparison. Never silently fall back
 * to an unrelated "latest" draft when a particular ID was requested.
 * Reevaluate recorded inputs rather than trusting stored outcome figures.
 */
export function resolveSupplyDraft(
 storage:DraftStorage,requestedId?:string,
):SupplyDraft {
 const drafts=readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY,storage);
 const draft=requestedId ? drafts.find(x=>x?.id===requestedId) : drafts[0];
 if(!draft)throw new Error(requestedId
  ?"所选供水草稿不可用或已被清理，不能改用其他草稿。":"当前浏览器没有已保存的供水草稿。");
 if(draft.state!=="draft"||draft.source!=="MOCK"||!draft.inputs)
  throw new Error("供水草稿结构或来源无效，禁止导入成本核算。");
 const inputs=cloneMultiSource(draft.inputs);
 const fresh=evaluateMultiSource(inputs);
 if(!fresh.feasible||fresh.unmetM3>1e-6)
  throw new Error("所选供水草稿条件已不满足完整供水要求，请先重新核验。");
 return {...draft,inputs};
}

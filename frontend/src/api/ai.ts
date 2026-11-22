import http from './http'
import { useUserStore } from '@/stores/user'
import type { ApiResponse } from './types'

interface OllamaHealth {
  ok?: boolean
  models?: string[]
  chat_model?: string
  chat_model_present?: boolean
  error?: string
}

export interface AiHealth {
  enabled: boolean
  ok?: boolean
  mock?: boolean
  mode?: 'MOCK' | 'REAL'
  data_mode?: 'SIM'
  error?: string
  ollama?: OllamaHealth
  data?: {
    status?: string
    ollama?: OllamaHealth
    chat_model?: string
  }
  chat_model?: string
}

export interface AiToolTraceItem {
  name: string
  arguments?: Record<string, unknown>
  ok?: boolean
  error?: string
  pending?: boolean
  action_id?: string
  total?: number
  items_count?: number
  keys?: string[]
}

export interface AiPendingAction {
  action_id: string
  tool: string
  title: string
  summary: string
  payload?: Record<string, unknown>
  risk?: string
  status?: string
  result_path?: string | null
}

export interface AiSessionSummary {
  id: string
  preview?: string
  message_count?: number
  updated_at?: number
  created_at?: number
}

export interface AiRouteLink {
  path: '/port/water/supply' | '/port/operations/monitor' | '/port/operations/decision' |
    '/port/analysis/boards' | '/port/analysis/reports' |
    '/port/analysis/equipment-drafts'
  label: string
}

export interface AiSessionMessage {
  role: string
  content: string
  ts?: number
  pending_actions?: AiPendingAction[]
  links?: AiRouteLink[]
}
export interface AiSessionDetail {
  id: string
  messages: AiSessionMessage[]
  pending_actions?: AiPendingAction[]
  mock?: boolean
}
export type SimPlanId = 'as-is' | 'defer' | 'storage-first' | 'standby'
export interface AiSimPlan {
  id: SimPlanId
  title: string
  shortage_m3h: number
  deferred_m3h: number
  raw_end_storage_m3: number
  safety_margin_m3: number
  constraint: 'CONSTRAINT_FAIL' | 'UNVERIFIED'
  blockers: string[]
  field_validated: false
}
export interface AiDemoContext {
  data_mode: 'SIM'
  field_verified: false
  scenario_id: 'baseline' | 'peak' | 'storm' | 'pump-fault'
  run_number: number
  run_uid?: string | null
  demand_m3h: number
  delivered_m3h: number
  shortage_m3h: number
  coverage_percent: number
  pool_forecast_m3: number
  monitor_risk: 'normal' | 'attention' | 'critical' | 'insufficient'
  triggered_rules: string[]
  insufficient_rules: string[]
  affected_terminals: Array<{
    label: string
    demand_m3h: number
    allocated_m3h: number
    shortage_m3h: number
  }>
  checkpoints: string[]
  review_status: 'not_started' | 'investigating' | 'recorded'
  review_outcome: 'requires-field-check' | 'sim-recovery-conditions' | null
  review_note: string
  scenario_started_at: string
  plans: AiSimPlan[]
}
export interface AiSimReportContent extends Omit<AiDemoContext, 'plans'> {
  plans?: AiSimPlan[]
  report_version: string
  data_origin: 'BROWSER_SIM_SNAPSHOT'
  production_case_created: false
  repair_order_created: false
  conclusion: string
  next_action: string
  sim_evidence?: AiSimEvidenceSnapshot
  sim_decision?: {
    id: number
    selected_plan_id: SimPlanId
    rationale: string
    status: 'selected' | 'reviewed'
    review?: AiSimDecisionReview | null
    real_dispatch_executed: false
  }
}
export interface AiSimReport {
  id: number
  scenario_id: string
  run_number: number
  created_at: string
  report: AiSimReportContent
}

export function fetchAiSimReports() {
  return http.get<ApiResponse<AiSimReport[]>>('/ai/mock-reports', { silent: true })
}

export function fetchAiSimReport(id: number) {
  return http.get<ApiResponse<AiSimReport>>('/ai/mock-reports/' + id, { silent: true })
}

export interface AiSimAgentStep {
  id: 'supply' | 'monitor' | 'operations'
  name: string
  mode: 'MOCK_RULE'
  finding: string
  evidence: string
  limitation: string
}
export interface AiSimDecisionAnalysis {
  data_mode: 'SIM'
  field_verified: false
  scenario_id: string
  run_number: number
  roles: AiSimAgentStep[]
  plans: AiSimPlan[]
  notice: string
}
export interface AiSimDecisionReview {
  run_number: number
  data_mode: 'SIM'
  field_verified: false
  before_shortage_m3h: number
  after_shortage_m3h: number
  shortage_delta_m3h: number
  finding: string
  after_monitor_risk: string
  constraint: 'CONSTRAINT_FAIL' | 'UNVERIFIED'
  human_note: string
  simulation_only: true
  plan_executed: false
  effect_attribution: 'NOT_DEMONSTRATED'
  warning: string
}
export type SimEvidenceStatus = 'pending' | 'material-requested' | 'under-review'
export interface AiSimEvidenceItem {
  key: string
  label: string
  kind: 'required' | 'sim-checkpoint' | 'plan-blocker'
  source_verified: false
  status: SimEvidenceStatus
  note: string
  source_reference: string
  note_count: number
  field_verified: false
}
export interface AiSimEvidenceSnapshot {
  decision_id: number
  total: number
  pending: number
  material_requested: number
  under_review: number
  verified: 0
  field_verified: false
  items: AiSimEvidenceItem[]
}
export interface AiSimEvidence extends AiSimEvidenceSnapshot {
  data_mode: 'SIM'
}
export function fetchSimEvidence(decisionId: number) {
  return http.get<ApiResponse<AiSimEvidence>>(
    '/ai/mock-decisions/'+decisionId+'/evidence', { silent: true },
  )
}
export function recordSimEvidence(
  decisionId: number, data: {
    item_key: string
    status: SimEvidenceStatus
    note: string
    source_reference: string
  },
) {
  return http.post<ApiResponse<AiSimEvidence>>(
    '/ai/mock-decisions/'+decisionId+'/evidence', data, { silent: true },
  )
}

export interface AiSimDecision {
  id: number
  status: 'selected' | 'reviewed'
  scenario_id: string
  baseline_run: number
  selected_plan_id: SimPlanId
  selected_plan: AiSimPlan
  baseline: { shortage_m3h: number, monitor_risk: string }
  rationale: string
  analysis: AiSimDecisionAnalysis
  review: AiSimDecisionReview | null
  created_at: string
  data_mode: 'SIM'
  field_verified: false
  real_dispatch_executed: false
}
export function analyzeSimDecision(demoContext: AiDemoContext) {
  return http.post<ApiResponse<AiSimDecisionAnalysis>>(
    '/ai/mock-decisions/analyze', demoContext, { silent: true },
  )
}
export function fetchSimDecisions() {
  return http.get<ApiResponse<AiSimDecision[]>>('/ai/mock-decisions', { silent: true })
}
export function createSimDecision(
  demoContext: AiDemoContext, planId: SimPlanId, rationale: string,
) {
  return http.post<ApiResponse<AiSimDecision>>('/ai/mock-decisions', {
    demo_context: demoContext, plan_id: planId, rationale,
  }, { silent: true })
}
export function reviewSimDecision(
  id: number, demoContext: AiDemoContext, humanNote: string,
) {
  return http.post<ApiResponse<AiSimDecision>>('/ai/mock-decisions/'+id+'/review', {
    demo_context: demoContext, human_note: humanNote,
  }, { silent: true })
}

export type AiStreamEvent =
  | { type: 'session'; session_id: string }
  | { type: 'status'; message?: string }
  | { type: 'tool'; tool: AiToolTraceItem }
  | { type: 'pending'; action: AiPendingAction }
  | { type: 'token'; text: string }
  | {
      type: 'done'
      session_id?: string
      content?: string
      reply?: string
      tool_trace?: AiToolTraceItem[]
      pending_actions?: AiPendingAction[]
      links?: AiRouteLink[]
      model?: string
      rounds?: number
    }
  | { type: 'error'; message?: string }

// AI 接口统一走 silent 模式：对话框内自行展示错误（健康标签/消息提示），
// 避免 ai-service 不可用（5xx）时触发 http.ts 的全局 500 页跳转，打断当前页面
export function aiHealth() {
  return http.get<ApiResponse<AiHealth>>('/ai/health', { silent: true })
}

/** SSE 流式对话；回调每个事件 */
export async function aiChatStream(
  message: string,
  sessionId: string | undefined,
  onEvent: (ev: AiStreamEvent) => void,
  signal?: AbortSignal,
  demoContext?: AiDemoContext,
): Promise<void> {
  const user = useUserStore()
  const res = await fetch('/api/v1/ai/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user.token ? { Authorization: `Bearer ${user.token}` } : {}),
    },
    body: JSON.stringify({
      message,
      session_id: sessionId || undefined,
      enable_tools: true,
      ...(demoContext ? { demo_context: demoContext } : {}),
    }),
    signal,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j.detail || j.message || detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  if (!res.body) throw new Error('无响应流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() || ''
    for (const line of parts) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const raw = t.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        onEvent(JSON.parse(raw) as AiStreamEvent)
      } catch {
        /* ignore bad chunk */
      }
    }
  }
}

export function aiConfirm(actionId: string) {
  return http.post<ApiResponse<Record<string, unknown>>>(
    '/ai/confirm',
    {
      action_id: actionId,
    },
    { silent: true },
  )
}

export function aiCancel(actionId: string) {
  return http.post<ApiResponse<Record<string, unknown>>>(
    '/ai/cancel',
    {
      action_id: actionId,
    },
    { silent: true },
  )
}

export function aiSessions() {
  return http.get<ApiResponse<AiSessionSummary[]>>('/ai/sessions', { silent: true })
}

export function aiSessionDetail(sessionId: string) {
  return http.get<ApiResponse<AiSessionDetail>>(
    `/ai/sessions/${sessionId}`,
    { silent: true },
  )
}

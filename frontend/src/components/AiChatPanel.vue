<template>
  <div class="ai-chat-panel">
    <aside class="session-pane">
      <div class="session-head">
        <span>会话</span>
        <el-button size="small" type="primary" link @click="newChat">新建</el-button>
      </div>
      <div class="session-list" v-loading="sessionsLoading">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === sessionId }"
          @click="openSession(s.id)"
        >
          <div class="session-preview">{{ s.preview || '（空对话）' }}</div>
          <div class="session-meta">{{ s.message_count || 0 }} 条</div>
        </div>
        <div v-if="!sessions.length && !sessionsLoading" class="session-empty">暂无历史</div>
      </div>
    </aside>

    <div class="main-pane">
      <el-card shadow="never" class="status-card">
        <div class="status-row">
          <div>
            <div class="title">智能助手</div>
            <div class="sub">{{ isMock ? '规则驱动的SIM业务演示' : '流式对话 · 查询与受控操作' }}</div>
          </div>
          <div class="status-right">
            <el-tag :type="isMock ? 'info' : healthOk ? 'success' : 'danger'" effect="plain">
              {{ healthLabel }}
            </el-tag>
            <el-button size="small" @click="refreshHealth">刷新状态</el-button>
          </div>
        </div>
        <p v-if="healthHint" class="hint">{{ healthHint }}</p>
      </el-card>

      <el-card shadow="never" class="chat-card">
        <div ref="listRef" class="messages">
          <div v-if="!messages.length" class="empty">
            <p>{{ isMock ? 'SIM演示操作' : '试着问我' }}</p>
            <div class="examples">
              <el-button
                v-for="ex in examples"
                :key="ex"
                size="small"
                round
                @click="fill(ex)"
              >
                {{ ex }}
              </el-button>
            </div>
          </div>
          <div
            v-for="(m, idx) in messages"
            :key="idx"
            class="bubble"
            :class="m.role"
          >
            <div class="role">{{ m.role === 'user' ? '我' : '助手' }}</div>
            <div v-if="m.statusText" class="status-line">{{ m.statusText }}</div>
            <div v-if="m.tools?.length" class="tools">
              <el-tag
                v-for="(t, ti) in m.tools"
                :key="ti"
                size="small"
                :type="t.ok === false ? 'danger' : t.pending ? 'warning' : 'info'"
                effect="plain"
                class="tool-tag"
              >
                {{ t.ok === false ? '失败' : t.pending ? '待确认' : '已查询' }} · {{ t.name }}
              </el-tag>
            </div>
            <div class="content">{{ m.content }}<span v-if="m.streaming" class="caret">▍</span></div>
            <div v-if="m.links?.length" class="ai-route-links">
              <el-button v-for="link in m.links" :key="link.path" type="primary" link size="small"
                @click="gotoKnownRoute(link.path)">{{link.label}}</el-button>
            </div>

            <div v-if="m.pending?.length" class="pending-list">
              <div
                v-for="pa in m.pending"
                :key="pa.action_id"
                class="pending-card"
                :class="pa.uiStatus || 'pending'"
              >
                <div class="pending-title">
                  <el-tag size="small" :type="pa.risk === 'high' ? 'danger' : 'warning'">
                    {{ pa.risk === 'high' ? '高风险' : '写操作' }}
                  </el-tag>
                  <strong>{{ pa.title }}</strong>
                </div>
                <div class="pending-summary">{{ pa.summary }}</div>
                <el-descriptions v-if="isMock && pa.payload" :column="1" size="small" border class="pending-demo-details">
                  <el-descriptions-item v-if="pa.tool==='create_demo_equipment'" label="设备">
                    {{pa.payload.name}} · {{pa.payload.code}}
                  </el-descriptions-item>
                  <el-descriptions-item v-if="pa.tool==='create_demo_equipment'" label="来源">
                    SIM · {{pa.payload.source_note}}
                  </el-descriptions-item>
                  <el-descriptions-item v-if="pa.tool==='create_sim_board'" label="看板">
                    {{pa.payload.title}}
                  </el-descriptions-item>
                  <el-descriptions-item v-if="pa.tool==='create_sim_board'" label="发布位置">
                    {{pa.payload.target_path}}
                  </el-descriptions-item>
                  <template v-if="pa.tool==='edit_sim_board'">
                    <el-descriptions-item label="看板">{{pa.payload.title}} · #{{pa.payload.board_id}}</el-descriptions-item>
                    <el-descriptions-item label="版本">v{{pa.payload.expected_version}} → v{{Number(pa.payload.expected_version)+1}}</el-descriptions-item>
                    <el-descriptions-item label="操作">{{pa.payload.operation==='add'?'添加组件':'移除组件'}} · {{pa.payload.component_metric||pa.payload.component_kind}}</el-descriptions-item>
                  </template>
                  <template v-if="pa.tool==='create_sim_report'">
                    <el-descriptions-item label="情景">{{pa.payload.scenario_id}} · 第{{pa.payload.run_number}}轮</el-descriptions-item>
                    <el-descriptions-item label="供水缺口">{{pa.payload.shortage_m3h}} m³/h（SIM）</el-descriptions-item>
                    <el-descriptions-item label="核查状态">{{pa.payload.review_status}}</el-descriptions-item>
                  </template>
                  <el-descriptions-item label="执行范围">仅独立SIM业务表</el-descriptions-item>
                </el-descriptions>
                <pre v-else-if="pa.payload" class="pending-payload">{{ formatPayload(pa.payload) }}</pre>
                <div class="pending-actions">
                  <template v-if="!pa.uiStatus || pa.uiStatus === 'pending'">
                    <el-button
                      type="primary"
                      size="small"
                      :loading="actingId === pa.action_id"
                      @click="onConfirm(pa)"
                    >
                      确认执行
                    </el-button>
                    <el-button size="small" :disabled="!!actingId" @click="onCancel(pa)">
                      取消
                    </el-button>
                  </template>
                  <el-tag v-else-if="pa.uiStatus === 'confirmed'" type="success" size="small">
                    已执行
                  </el-tag>
                  <el-tag v-else-if="pa.uiStatus === 'cancelled'" type="info" size="small">
                    已取消
                  </el-tag>
                  <el-tag v-else-if="pa.uiStatus === 'failed'" type="danger" size="small">
                    执行失败
                  </el-tag>
                </div>
                <div v-if="pa.resultText" class="pending-result">{{ pa.resultText }}</div>
                <el-button v-if="pa.resultPath && pa.uiStatus==='confirmed'" type="primary"
                  link size="small" @click="gotoKnownRoute(pa.resultPath)">查看结果</el-button>
              </div>
            </div>
          </div>
        </div>

        <div class="composer">
          <el-input
            v-model="input"
            type="textarea"
            :rows="3"
            placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
            :disabled="loading || !healthOk"
            @keydown="onKeydown"
          />
          <el-button type="primary" :loading="loading" :disabled="!input.trim() || !healthOk" @click="send">
            发送
          </el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useScenarioStore } from '@/modules/tanggang/simulation/store'
import { simContext } from '@/modules/tanggang/simulation/mockContext'
import { ElMessage } from 'element-plus'
import {
  aiCancel,
  aiChatStream,
  aiConfirm,
  aiHealth,
  aiSessionDetail,
  aiSessions,
  type AiPendingAction,
  type AiSessionSummary,
  type AiToolTraceItem,
  type AiRouteLink,
} from '@/api/ai'

interface PendingUI extends AiPendingAction {
  uiStatus?: 'pending' | 'confirmed' | 'cancelled' | 'failed'
  resultText?: string
  resultPath?: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
  tools?: AiToolTraceItem[]
  pending?: PendingUI[]
  statusText?: string
  streaming?: boolean
  links?: AiRouteLink[]
}

const emit = defineEmits<{ (e: 'emotion', mood: 'happy' | 'sad'): void }>()
const router = useRouter()
const scenarioStore = useScenarioStore()
const isMock = ref(false)
const knownRoutes = new Set([
  '/port/water/supply','/port/operations/monitor','/port/operations/decision',
  '/port/analysis/boards','/port/analysis/reports',
  '/port/analysis/equipment-drafts',
])
async function gotoKnownRoute(path:string){
  const [base,query=''] = path.split('?')
  if(!knownRoutes.has(base))return
  const params=new URLSearchParams(query)
  // Only allow a board numeric selector; never execute a generated URL.
  if(query && (base!=='/port/analysis/boards' ||
      [...params.keys()].some(k=>k!=='board') ||
      !/^[1-9][0-9]{0,8}$/.test(params.get('board')||'')))return
  await router.push(path)
  // The mature out-in page transition can occasionally leave an empty router
  // outlet after a chat confirmation (especially without a WebGL context).
  // Preserve SPA state if successful; only recover by refreshing a blank view.
  window.setTimeout(()=>{
    if(router.currentRoute.value.path!==base)return
    const outlet=document.querySelector('.page-content')
    if(outlet && !outlet.querySelector('main'))window.location.reload()
  },950)
}


const messages = ref<Msg[]>([])
const sessions = ref<AiSessionSummary[]>([])
const sessionsLoading = ref(false)
const input = ref('')
const loading = ref(false)
const actingId = ref<string | null>(null)
const sessionId = ref<string | undefined>()
const listRef = ref<HTMLElement | null>(null)
const healthOk = ref(false)
const healthLabel = ref('检测中…')
const healthHint = ref('')
let abortCtrl: AbortController | null = null

const examples = [
  '当前模拟供水缺口是多少？',
  '查询演示设备',
  '在除尘系统新增设备，设备名称：演示喷雾泵，设备编号：SIM-FOG-001，参数：待核实',
  '帮我生成供水分析看板',
  '生成本轮SIM运行复盘报告',
  '分析本轮SIM处置方案',
]

function fill(text: string) {
  input.value = text
}

// 情绪规则：由接口返回状态驱动 —— 接口调用/写操作成功开心，失败难过
function emitMood(ok: boolean) {
  emit('emotion', ok ? 'happy' : 'sad')
}

function formatPayload(p: Record<string, unknown>) {
  try {
    return JSON.stringify(p, null, 2)
  } catch {
    return String(p)
  }
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    const { data } = await aiSessions()
    sessions.value = data.data || []
  } catch {
    sessions.value = []
  } finally {
    sessionsLoading.value = false
  }
}

async function openSession(id: string) {
  if (loading.value) return
  sessionId.value = id
  try {
    const { data } = await aiSessionDetail(id)
    const msgs = data.data?.messages || []
    messages.value = msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        links: isMock.value ? (m.links || []).filter(link=>knownRoutes.has(link.path)) : [],
        pending: isMock.value ? (m.pending_actions || []).map(p => ({
          ...p,
          uiStatus: p.status === 'confirmed' ? 'confirmed' as const
            : p.status === 'cancelled' ? 'cancelled' as const
            : 'pending' as const,
          resultPath: p.status === 'confirmed' && p.result_path
            ? (p.tool==='edit_sim_board'&&p.payload?.board_id
              ? '/port/analysis/boards?board='+p.payload.board_id : p.result_path)
            : undefined,
          resultText: p.status === 'confirmed' ? 'SIM演示记录已保存' : undefined,
        })) : [],
      }))
    if (isMock.value && data.data?.pending_actions?.length &&
        !messages.value.some(m => m.pending?.length)) {
      // Compatibility with sessions created before actions were linked to turns.
      const lastAssistant = [...messages.value].reverse().find(m => m.role === 'assistant')
      if (lastAssistant) {
        lastAssistant.pending = data.data.pending_actions.map(p => ({
          ...p,
          uiStatus: p.status === 'confirmed' ? 'confirmed' as const
            : p.status === 'cancelled' ? 'cancelled' as const : 'pending' as const,
          resultPath: p.status === 'confirmed' && p.result_path ? p.result_path : undefined,
        }))
      }
    }
    await scrollBottom()
  } catch {
    ElMessage.error('加载会话失败')
  }
}

function newChat() {
  if (abortCtrl) abortCtrl.abort()
  sessionId.value = undefined
  messages.value = []
  input.value = ''
}

async function refreshHealth() {
  try {
    const { data } = await aiHealth()
    const d = data.data
    const ollama = d?.data?.ollama || d?.ollama
    const ok = Boolean(d?.ok ?? ollama?.ok)
    healthOk.value = ok
    isMock.value = d?.mode === 'MOCK' || d?.mock === true
    if (ok) {
      const model = d?.data?.chat_model || d?.chat_model || ollama?.chat_model || '模型'
      healthLabel.value = isMock.value ? 'MOCK · 演示' : `就绪 · ${model}`
      healthHint.value = isMock.value
        ? '仅SIM演示；规则识别，无真实大模型。写操作必须人工确认。'
        : '写操作需确认；对话有频率限制'
    } else {
      healthLabel.value = '不可用'
      healthHint.value = d?.error || ollama?.error || '请检查 Ollama 与 ai-service'
    }
  } catch (e: unknown) {
    healthOk.value = false
    isMock.value = false
    const issue=e as {response?:{status?:number;data?:{detail?:string}}}
    healthLabel.value = issue?.response?.status===503?'未启用':'不可用'
    healthHint.value = issue?.response?.data?.detail || '无法连接 AI 接口'
  }
}

async function scrollBottom() {
  await nextTick()
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return
  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true

  const assistant: Msg = {
    role: 'assistant',
    content: '',
    tools: [],
    pending: [],
    statusText: '思考中…',
    streaming: true,
  }
  messages.value.push(assistant)
  await scrollBottom()

  abortCtrl = new AbortController()
  try {
    await aiChatStream(
      text,
      sessionId.value,
      (ev) => {
        if (ev.type === 'session' && ev.session_id) {
          sessionId.value = ev.session_id
        } else if (ev.type === 'status') {
          assistant.statusText =
            ev.message === 'thinking'
              ? '思考中…'
              : ev.message?.startsWith('tool:')
                ? `正在查询 ${ev.message.slice(5)}…`
                : ev.message || '处理中…'
        } else if (ev.type === 'tool' && ev.tool) {
          assistant.tools = [...(assistant.tools || []), ev.tool]
        } else if (ev.type === 'pending' && ev.action) {
          assistant.pending = [
            ...(assistant.pending || []),
            { ...ev.action, uiStatus: 'pending' },
          ]
        } else if (ev.type === 'token' && ev.text) {
          assistant.statusText = undefined
          assistant.content += ev.text
        } else if (ev.type === 'done') {
          assistant.streaming = false
          assistant.statusText = undefined
          if (ev.session_id) sessionId.value = ev.session_id
          if (ev.content || ev.reply) {
            assistant.content = (ev.content || ev.reply || assistant.content).trim()
          }
          if (ev.tool_trace?.length) assistant.tools = ev.tool_trace
          if (isMock.value && ev.links?.length) {
            assistant.links = ev.links.filter(link=>knownRoutes.has(link.path))
          }
          if (ev.pending_actions?.length) {
            assistant.pending = ev.pending_actions.map((p) => ({
              ...p,
              uiStatus: 'pending' as const,
            }))
          }
          if (!assistant.content) {
            assistant.content = '（无回复内容）'
          }
          emitMood(true)
        } else if (ev.type === 'error') {
          assistant.streaming = false
          assistant.statusText = undefined
          assistant.content = ev.message || '流式对话失败'
          emit('emotion', 'sad')
        }
        void scrollBottom()
      },
      abortCtrl.signal,
      simContext(scenarioStore),
    )
    await loadSessions()
  } catch (e: unknown) {
    assistant.streaming = false
    assistant.statusText = undefined
    if (!assistant.content) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as Error).message)
          : 'AI 请求失败'
      assistant.content = msg
    }
    ElMessage.error(assistant.content)
    emit('emotion', 'sad')
  } finally {
    loading.value = false
    abortCtrl = null
    await scrollBottom()
  }
}

async function onConfirm(pa: PendingUI) {
  if (actingId.value) return
  actingId.value = pa.action_id
  try {
    const { data } = await aiConfirm(pa.action_id)
    pa.uiStatus = 'confirmed'
    const res = data.data?.result as Record<string, unknown> | undefined
    if (res && typeof res === 'object') {
      const orderNo = (res as { order_no?: string }).order_no
      if (orderNo) pa.resultText = `工单已创建：${orderNo}`
      else if (isMock.value) {
        pa.resultText = pa.tool === 'create_sim_report'
          ? 'SIM复盘已保存，可以查看本轮运行记录'
          : res.status === 'draft'
            ? 'SIM看板草稿已保存，请前往“我的看板”预览或发布'
            : 'SIM演示设备已登记，未写入正式设备台账'
      } else pa.resultText = '执行成功'
      if (res.path && typeof res.path === 'string' &&
          ['/port/analysis/boards', '/port/analysis/equipment-drafts', '/port/analysis/reports'].includes(res.path)) {
        pa.resultPath = isMock.value && res.path === '/port/analysis/boards' &&
            Number.isSafeInteger(res.id) && Number(res.id)>0
          ? '/port/analysis/boards?board='+res.id : res.path
      }
    } else {
      pa.resultText = isMock.value ? 'SIM演示操作已确认' : '执行成功'
    }
    emitMood(true)
    ElMessage.success(pa.resultText)
  } catch (e: unknown) {
    pa.uiStatus = 'failed'
    pa.resultText =
      e && typeof e === 'object' && 'message' in e
        ? String((e as Error).message)
        : '执行失败'
    emitMood(false)
    ElMessage.error(pa.resultText)
  } finally {
    actingId.value = null
  }
}

async function onCancel(pa: PendingUI) {
  if (actingId.value) return
  actingId.value = pa.action_id
  try {
    await aiCancel(pa.action_id)
    pa.uiStatus = 'cancelled'
    pa.resultText = '已取消，未写入系统'
    ElMessage.info('已取消')
  } catch {
    ElMessage.error('取消失败')
  } finally {
    actingId.value = null
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

onMounted(async () => {
  await refreshHealth()
  await loadSessions()
})
</script>

<style scoped>
.ai-chat-panel {
  display: flex;
  gap: 12px;
  height: 100%;
  min-height: 460px;
}
.session-pane {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.session-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
  font-size: 13px;
}
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.session-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}
.session-item:hover {
  background: var(--el-fill-color-light);
}
.session-item.active {
  background: var(--el-color-primary-light-9);
}
.session-preview {
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.session-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  padding: 24px 8px;
}
.main-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.status-card {
  flex-shrink: 0;
}
.status-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.title {
  font-size: 18px;
  font-weight: 600;
}
.sub {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--el-color-warning);
}
.chat-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chat-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 12px;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 16px;
  min-height: 160px;
}
.empty {
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 40px 12px;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
}
.bubble {
  max-width: 92%;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.bubble.user {
  margin-left: auto;
  background: var(--el-color-primary-light-9);
}
.bubble.assistant {
  margin-right: auto;
}
.role {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.status-line {
  font-size: 12px;
  color: var(--el-color-primary);
  margin-bottom: 6px;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.tool-tag {
  font-size: 11px;
}
.content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.caret {
  display: inline-block;
  width: 8px;
  animation: blink 1s step-end infinite;
  color: var(--el-color-primary);
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.pending-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pending-card {
  border: 1px solid var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
  border-radius: 8px;
  padding: 10px;
}
.pending-card.confirmed {
  border-color: var(--el-color-success-light-5);
  background: var(--el-color-success-light-9);
}
.pending-card.cancelled {
  border-color: var(--el-border-color);
  background: var(--el-fill-color-blank);
  opacity: 0.85;
}
.pending-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.pending-summary {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.pending-payload {
  margin: 8px 0;
  padding: 8px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  max-height: 160px;
  overflow: auto;
}
.pending-actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
.pending-result {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.composer {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.composer .el-textarea {
  flex: 1;
}
.ai-route-links{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:8px}

/* ===== 窄屏（≤768px）：会话列表收起，聊天区占满整行 ===== */
@media only screen and (max-width: 768px) {
  .session-pane {
    display: none;
  }
}
</style>

<template>
  <div class="page mod-system scada-settings">
    <header class="page-head">
      <div>
        <h2>SCADA 接入设置</h2>
        <p class="desc">
          在这里填写现场 SCADA 的连接方式，先「测试连接」确认可达并能取到点位数据，再「保存并应用」。
          配置保存后立即生效，无需重启服务。
        </p>
      </div>
      <el-tag :type="config.source === 'saved' ? 'success' : 'info'" effect="plain">
        {{ config.source === 'saved' ? '使用页面保存配置' : '使用 .env 默认配置' }}
      </el-tag>
    </header>

    <el-alert
      class="hint"
      type="warning"
      :closable="false"
      show-icon
      title="该页面仅超级管理员可见；网关令牌、OPC UA 密码只保存在后端，页面只显示是否已配置。"
    />

    <div class="grid">
      <el-card class="panel" shadow="never">
        <template #header>
          <div class="panel-head">
            <span>接入方式</span>
            <span v-if="config.updated_at" class="meta">
              最近保存：{{ config.updated_by || '-' }} · {{ formatTime(config.updated_at) }}
            </span>
          </div>
        </template>

        <el-form label-width="112px" label-position="left">
          <el-form-item label="采集模式">
            <el-radio-group v-model="form.mode">
              <el-radio-button value="mock">内置仿真</el-radio-button>
              <el-radio-button value="gateway">现场网关</el-radio-button>
              <el-radio-button value="opcua">OPC UA 直连</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <template v-if="form.mode === 'gateway'">
            <el-form-item label="网关地址">
              <el-input v-model="form.gateway_url" placeholder="http://127.0.0.1:8100" clearable />
            </el-form-item>
            <el-form-item label="接口前缀">
              <el-input v-model="form.gateway_api_prefix" placeholder="/api/v1" clearable />
            </el-form-item>
            <el-form-item label="网关令牌">
              <el-input
                v-model="form.gateway_token"
                type="password"
                show-password
                :placeholder="config.gateway_token_set ? '已配置，留空保持不变' : 'X-Gateway-Token'"
              />
            </el-form-item>
            <el-form-item label="数据读取">
              <el-radio-group v-model="form.data_source">
                <el-radio value="mirror">读取主站镜像（推荐）</el-radio>
                <el-radio value="gateway">直接透传网关</el-radio>
              </el-radio-group>
            </el-form-item>
          </template>

          <template v-if="form.mode === 'opcua'">
            <el-form-item label="OPC UA 端点">
              <el-input v-model="form.opcua_endpoint" placeholder="opc.tcp://192.168.2.222:9433" clearable />
            </el-form-item>
            <el-form-item label="安全策略">
              <el-select v-model="form.opcua_security_policy" style="width: 100%">
                <el-option label="None" value="None" />
                <el-option label="Basic256Sha256" value="Basic256Sha256" />
                <el-option label="Aes128Sha256RsaOaep" value="Aes128Sha256RsaOaep" />
              </el-select>
            </el-form-item>
            <el-form-item label="认证方式">
              <el-radio-group v-model="form.opcua_auth_mode">
                <el-radio value="anonymous">匿名</el-radio>
                <el-radio value="username">用户名密码</el-radio>
              </el-radio-group>
            </el-form-item>
            <template v-if="form.opcua_auth_mode === 'username'">
              <el-form-item label="用户名">
                <el-input v-model="form.opcua_username" clearable />
              </el-form-item>
              <el-form-item label="密码">
                <el-input
                  v-model="form.opcua_password"
                  type="password"
                  show-password
                  :placeholder="config.opcua_password_set ? '已配置，留空保持不变' : 'OPC UA 密码'"
                />
              </el-form-item>
            </template>
          </template>

          <template v-if="form.mode === 'mock'">
            <el-form-item label="采样周期">
              <el-input-number v-model="form.sim_interval_sec" :min="0.5" :max="60" :step="0.5" />
              <span class="unit">秒</span>
            </el-form-item>
            <el-form-item label="自动启动">
              <el-switch v-model="form.auto_start" />
              <span class="tip">服务启动后自动拉起内置仿真</span>
            </el-form-item>
          </template>
        </el-form>
      </el-card>

      <el-card class="panel" shadow="never">
        <template #header>
          <div class="panel-head">
            <span>连接测试</span>
            <span v-if="tested" class="meta">
              {{ result?.ok ? '连接正常' : '存在问题' }} · 耗时 {{ result?.latency_ms }} ms
            </span>
          </div>
        </template>

        <el-alert
          v-if="tested"
          :type="result?.ok ? 'success' : 'error'"
          :closable="false"
          show-icon
          :title="result?.ok ? '连接测试通过，可以保存并应用' : '连接测试未通过，请按下方提示检查'"
        />

        <div v-if="tested" class="checks">
          <div v-for="c in result?.checks || []" :key="c.key" class="check-row">
            <el-tag :type="tagType(c.status)" size="small" effect="plain">
              {{ statusText(c.status) }}
            </el-tag>
            <span class="check-name">{{ c.name }}</span>
            <span class="check-detail">{{ c.detail }}</span>
          </div>
        </div>

        <div v-else class="empty">
          测试会检查：地址是否可达、鉴权是否通过、能否取到点位实时值。
        </div>

        <div class="test-actions">
          <el-button :loading="testing" @click="onTest">测试连接</el-button>
          <span class="tip">测试只使用当前表单参数，不会保存</span>
        </div>
      </el-card>
    </div>

    <el-card class="panel preview" shadow="never">
      <template #header>
        <div class="panel-head">
          <span>实时数据预览</span>
          <div class="preview-actions">
            <span class="meta">每 8 秒自动刷新</span>
            <el-button size="small" :loading="latestLoading" @click="loadLatest">刷新</el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="latestLoading" :data="latestRows" size="small" height="260">
        <el-table-column prop="tag_name" label="点位名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
        <el-table-column label="当前值" min-width="110">
          <template #default="{ row }">
            <span class="value">{{ row.display_value ?? '-' }}</span>
            <span v-if="row.unit" class="unit">{{ row.unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="质量" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status_name === 'Good' ? 'success' : 'warning'" size="small" effect="plain">
              {{ row.status_name || '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ formatTime(row.ts_ms) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <footer class="footer-actions">
      <el-button @click="loadConfig">重置</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存并应用</el-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchScadaConfig,
  fetchScadaLatest,
  saveScadaConfig,
  testScadaConfig,
  type ScadaConfig,
  type ScadaConfigCheck,
  type ScadaConfigTestResult,
  type ScadaLatest,
} from '@/api/scada'

const config = reactive<ScadaConfig>({
  mode: 'mock',
  gateway_url: '',
  gateway_api_prefix: '/api/v1',
  gateway_token: '',
  gateway_token_set: false,
  ingest_token: '',
  ingest_token_set: false,
  data_source: 'mirror',
  opcua_endpoint: '',
  opcua_security_policy: 'None',
  opcua_auth_mode: 'anonymous',
  opcua_username: '',
  opcua_password: '',
  opcua_password_set: false,
  sim_interval_sec: 1,
  auto_start: true,
  source: 'env',
})

const form = reactive({
  mode: 'mock' as ScadaConfig['mode'],
  gateway_url: '',
  gateway_api_prefix: '/api/v1',
  gateway_token: '',
  ingest_token: '',
  data_source: 'mirror' as ScadaConfig['data_source'],
  opcua_endpoint: '',
  opcua_security_policy: 'None',
  opcua_auth_mode: 'anonymous' as ScadaConfig['opcua_auth_mode'],
  opcua_username: '',
  opcua_password: '',
  sim_interval_sec: 1,
  auto_start: true,
})

const saving = ref(false)
const testing = ref(false)
const tested = ref(false)
const result = ref<ScadaConfigTestResult | null>(null)
const latestRows = ref<ScadaLatest[]>([])
const latestLoading = ref(false)
let timer: number | undefined

function applyConfig(data: ScadaConfig) {
  Object.assign(config, data)
  form.mode = data.mode
  form.gateway_url = data.gateway_url
  form.gateway_api_prefix = data.gateway_api_prefix || '/api/v1'
  form.gateway_token = ''
  form.data_source = data.data_source
  form.opcua_endpoint = data.opcua_endpoint
  form.opcua_security_policy = data.opcua_security_policy || 'None'
  form.opcua_auth_mode = data.opcua_auth_mode
  form.opcua_username = data.opcua_username
  form.opcua_password = ''
  form.sim_interval_sec = data.sim_interval_sec
  form.auto_start = data.auto_start
}

async function loadConfig() {
  const { data } = await fetchScadaConfig()
  applyConfig(data.data)
  tested.value = false
  result.value = null
}

function buildPayload() {
  return {
    mode: form.mode,
    gateway_url: form.gateway_url.trim(),
    gateway_api_prefix: form.gateway_api_prefix.trim() || '/api/v1',
    gateway_token: form.gateway_token || null,
    ingest_token: form.ingest_token || null,
    data_source: form.data_source,
    opcua_endpoint: form.opcua_endpoint.trim(),
    opcua_security_policy: form.opcua_security_policy,
    opcua_auth_mode: form.opcua_auth_mode,
    opcua_username: form.opcua_username.trim(),
    opcua_password: form.opcua_password || null,
    sim_interval_sec: form.sim_interval_sec,
    auto_start: form.auto_start,
  }
}

async function onTest() {
  if (form.mode === 'gateway' && !form.gateway_url.trim()) {
    ElMessage.warning('请先填写网关地址')
    return
  }
  if (form.mode === 'opcua' && !form.opcua_endpoint.trim()) {
    ElMessage.warning('请先填写 OPC UA 端点')
    return
  }
  testing.value = true
  try {
    const { data } = await testScadaConfig(buildPayload())
    result.value = data.data
    tested.value = true
  } finally {
    testing.value = false
  }
}

async function onSave() {
  if (form.mode === 'gateway' && !form.gateway_url.trim()) {
    ElMessage.warning('请先填写网关地址')
    return
  }
  if (form.mode === 'opcua' && !form.opcua_endpoint.trim()) {
    ElMessage.warning('请先填写 OPC UA 端点')
    return
  }
  saving.value = true
  try {
    const { data } = await saveScadaConfig(buildPayload())
    applyConfig(data.data)
    ElMessage.success('配置已保存并生效')
    loadLatest()
  } finally {
    saving.value = false
  }
}

async function loadLatest() {
  latestLoading.value = true
  try {
    const { data } = await fetchScadaLatest({ limit: 12 })
    latestRows.value = data.data || []
  } finally {
    latestLoading.value = false
  }
}

function tagType(status: ScadaConfigCheck['status']) {
  if (status === 'ok') return 'success'
  if (status === 'warn') return 'warning'
  return 'danger'
}

function statusText(status: ScadaConfigCheck['status']) {
  return { ok: '通过', warn: '警告', fail: '失败' }[status]
}

function formatTime(value?: number | string | null) {
  if (!value) return '-'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(async () => {
  await loadConfig()
  loadLatest()
  timer = window.setInterval(loadLatest, 8000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<style scoped>
.scada-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-head h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  margin: 0;
  max-width: 760px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.hint {
  margin-bottom: 0;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px;
}

.panel {
  border-radius: 10px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}

.meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}

.unit {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.tip {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.checks {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.check-row {
  display: grid;
  grid-template-columns: 56px 96px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.check-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.check-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.check-detail {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

.empty {
  margin-top: 12px;
  padding: 28px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.test-actions {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 400;
}

.value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-bottom: 8px;
}

@media (max-width: 1200px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>

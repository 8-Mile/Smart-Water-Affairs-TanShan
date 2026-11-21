import { reactive } from 'vue'

/** 全局连接健康状态（响应式单例）
 *  驱动来源：http 拦截器的成功/失败 + 浏览器 online/offline 事件。
 *  供布局层消费：断网感知条（apiDown）、数据新鲜度标识（lastOkAt）。 */
export const connection = reactive({
  /** API 不可达：网络错误 / 服务无响应 / 浏览器离线（HTTP 有响应但业务失败不算断连） */
  apiDown: false,
  /** 最近一次 API 成功拿到响应的时间戳（ms）；0 = 自打开页面起还没有成功请求 */
  lastOkAt: 0,
})

/** 任何拿到 HTTP 响应的时刻都视为链路健康（含 4xx/5xx，说明服务可达） */
export function markApiOk() {
  connection.apiDown = false
  connection.lastOkAt = Date.now()
}

/** 完全拿不到响应才算断连（ERR_NETWORK）；超时不计入，避免慢接口误报 */
export function markApiDown() {
  connection.apiDown = true
}

/* 浏览器级断网/恢复事件：offline 立刻反映，不等下一次请求失败；
 * online 只说明网卡恢复，不代表后端可达，保持 apiDown 直到下一次成功响应 */
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    connection.apiDown = true
  })
}

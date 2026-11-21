import { useUserStore } from '@/stores/user'

type Handler = (event: string, data: unknown) => void

let socket: WebSocket | null = null
const handlers = new Set<Handler>()

export function connectAlarmWs() {
  const user = useUserStore()
  if (!user.token) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  // 开发态走 Vite 同源，由 proxy 转发；也可直连后端
  const host = window.location.host
  // token 不再放 URL：连接建立后以首帧 auth 消息认证，避免进入历史/日志
  socket = new WebSocket(`${proto}://${host}/api/v1/ws/alarms`)

  socket.onopen = () => {
    socket?.send(JSON.stringify({ type: 'auth', token: user.token }))
  }

  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      handlers.forEach((h) => h(msg.event, msg.data))
    } catch {
      // ignore
    }
  }

  socket.onclose = () => {
    socket = null
    // 简单重连
    setTimeout(() => {
      if (useUserStore().token) connectAlarmWs()
    }, 3000)
  }
}

export function disconnectAlarmWs() {
  if (socket) {
    socket.close()
    socket = null
  }
}

export function onAlarmEvent(handler: Handler) {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

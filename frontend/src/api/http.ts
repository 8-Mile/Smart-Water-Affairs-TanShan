import axios, { CanceledError, type AxiosError } from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import router from '@/router'
import { markApiDown, markApiOk } from '@/utils/connection'
import type { ApiResponse } from './types'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** 静默模式：跳过拦截器的自动错误提示，由调用方自行处理（如弹窗展示） */
    silent?: boolean
  }
}

const http = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
})

/** 无需登录即可访问的接口 */
const PUBLIC_APIS = ['/auth/login']

http.interceptors.request.use((config) => {
  const user = useUserStore()
  if (user.token) {
    config.headers.Authorization = `Bearer ${user.token}`
    return config
  }
  /* 已退出/未登录：非公开接口直接取消，避免退出后残留轮询继续发请求产生一批 401 */
  if (!PUBLIC_APIS.some((path) => (config.url ?? '').startsWith(path))) {
    return Promise.reject(new CanceledError('未登录，请求已取消'))
  }
  return config
})

http.interceptors.response.use(
  (response) => {
    markApiOk()
    const body = response.data as ApiResponse
    if (body && typeof body.code === 'number' && body.code !== 0) {
      if (!response.config.silent) ElMessage.error(body.message || '请求失败')
      return Promise.reject(body)
    }
    return response
  },
  (error: AxiosError<ApiResponse>) => {
    /* 未登录/已退出被主动取消的请求：静默丢弃，不弹提示也不跳转 */
    if (axios.isCancel(error)) return Promise.reject(error)
    const status = error.response?.status
    /* 连接健康：拿到响应（含 4xx/5xx）说明服务可达；完全无响应（断网/服务挂掉）才标记断连。
       超时（ECONNABORTED）不计入，避免慢接口被误报为断网 */
    if (error.response) markApiOk()
    else if (error.code === 'ERR_NETWORK') markApiDown()
    /* 无 HTTP 响应（服务不可达/断网/超时）：给可操作的明确提示，而非 axios 原始英文 "Network Error" */
    const message =
      error.response?.data?.message ||
      (error.code === 'ECONNABORTED'
        ? '请求超时，请稍后重试'
        : !error.response
          ? '无法连接服务器，请检查网络或稍后重试'
          : error.message) ||
      '网络错误'
    // 当前已处于异常页时不再跳转，避免二次报错造成循环
    const onExceptionPage = router.currentRoute.value.path.startsWith('/exception')
    // 静默请求：错误交由调用方自行处理，拦截器不做全局跳转/提示（仅 401 例外，令牌失效仍需登出）
    const silent = error.config?.silent
    if (status === 401) {
      const user = useUserStore()
      user.logout()
      router.push({ name: 'login' })
      ElMessage.error(message || '请重新登录')
    } else if (status === 403 && !onExceptionPage && !silent) {
      // 越权访问：页面级 403（按钮显隐已由 v-perm 控制，此处为接口级兜底）
      router.replace({ name: 'exception-403' })
    } else if (status !== undefined && status >= 500 && !onExceptionPage && !silent) {
      // 服务端错误：5xx → 500 页
      router.replace({ name: 'exception-500' })
    } else if (!silent) {
      ElMessage.error(message)
    }
    return Promise.reject(error)
  },
)

export default http
export type { ApiResponse }

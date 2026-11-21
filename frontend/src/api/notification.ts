import http from './http'
import type { ApiResponse } from './http'

export interface NotificationItem {
  id: number
  ntype: string
  title: string
  content: string
  biz_type?: string
  biz_id?: string
  path?: string
  is_read: number
  created_at: string
}

export interface NotificationListResult {
  list: NotificationItem[]
  total: number
  unread: number
  page: number
  page_size: number
}

/** 通知类请求统一 silent：轮询/标记失败不弹全局错误、不触发 5xx 跳转踢离当前页（仅 401 仍登出） */
export function fetchNotifications(params: { unread_only?: number; page?: number; page_size?: number }) {
  return http.get<ApiResponse<NotificationListResult>>('/notifications', { params, silent: true })
}

export function fetchUnreadCount() {
  return http.get<ApiResponse<{ unread: number }>>('/notifications/unread-count', { silent: true })
}

export function markNotificationRead(id: number) {
  return http.post<ApiResponse<{ id: number; is_read: number }>>(`/notifications/${id}/read`, null, { silent: true })
}

export function markAllNotificationsRead() {
  return http.post<ApiResponse<{ updated: number }>>('/notifications/read-all', null, { silent: true })
}

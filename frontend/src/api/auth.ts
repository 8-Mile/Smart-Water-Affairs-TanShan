import http, { type ApiResponse } from './http'

export interface UserInfo {
  id: number
  username: string
  display_name: string
  role_code: string
  /** 数据范围（角色 sys_role.data_scope）：all=全部 / mine=仅本人，mine 默认值由其派生 */
  data_scope: 'all' | 'mine'
  /** 按钮权限码列表（menu_type='button' 的 perms 集合；按角色实际授权下发，超管不再通配） */
  perms: string[]
}

export interface LoginData {
  access_token: string
  token_type: string
  user: UserInfo
}

export function loginApi(username: string, password: string) {
  return http.post<ApiResponse<LoginData>>('/auth/login', { username, password })
}

export function meApi() {
  return http.get<ApiResponse<UserInfo>>('/auth/me')
}

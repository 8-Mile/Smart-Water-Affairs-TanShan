import http from './http'
import type { ApiResponse, MenuNode, OptionItem, PageResult } from './types'

export function fetchMyMenus() {
  return http.get<ApiResponse<MenuNode[]>>('/system/menus/my')
}

export function fetchMenuTree() {
  return http.get<ApiResponse<MenuNode[]>>('/system/menus/tree')
}

export function createMenu(data: unknown) {
  return http.post<ApiResponse<MenuNode>>('/system/menus', data)
}

export function updateMenu(id: number, data: unknown) {
  return http.put<ApiResponse<MenuNode>>(`/system/menus/${id}`, data)
}

export function deleteMenu(id: number) {
  return http.delete<ApiResponse<boolean>>(`/system/menus/${id}`)
}

// generic list helpers
export function listResource<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, unknown>,
) {
  return http.get<ApiResponse<PageResult<T>>>(path, { params })
}

export function createResource<T>(path: string, data: unknown) {
  return http.post<ApiResponse<T>>(path, data)
}

export function updateResource<T>(path: string, id: number, data: unknown) {
  return http.put<ApiResponse<T>>(`${path}/${id}`, data)
}

export function deleteResource(path: string, id: number) {
  return http.delete<ApiResponse<boolean>>(`${path}/${id}`)
}

export function optionsResource(path: string) {
  return http.get<ApiResponse<OptionItem[]>>(path)
}

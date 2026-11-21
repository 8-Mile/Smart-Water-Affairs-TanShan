import http from './http'
import type { ApiResponse, PageResult } from './types'

export interface ArchiveItem {
  id: number
  name: string
  category_code: string
  category_name?: string
  file_name: string
  file_size: number
  file_format?: string
  content_type?: string
  uploader_name?: string
  upload_time?: string
  updated_at?: string
  description?: string
  download_count: number
  favorited?: boolean
  /** 档案编号（如 DA20240328001） */
  archive_no?: string
  /** 来源类型：自动关联 / 人工上传 / 告警关联 */
  source?: string
  /** 关联设备名称 */
  related_equipment?: string
  /** 关联工单号 */
  related_order?: string
  /** 关联事项描述 */
  related_matter?: string
}

export interface ArchiveStats {
  total: number
  month_new: number
  today_new: number
  by_category: { code: string; name: string; count: number; ratio: number }[]
  /** 环比增幅（%），上一期基数为 0 时为 null */
  trend: { total: number | null; today: number | null; drawing: number | null; standard: number | null }
}

export interface ArchiveCategoryNode {
  id: number
  name: string
  code?: string
  count: number
  sort: number
  children: ArchiveCategoryNode[]
}

export function fetchArchiveStats() {
  return http.get<ApiResponse<ArchiveStats>>('/archives/stats')
}
export function listArchiveCategories() {
  return http.get<ApiResponse<ArchiveCategoryNode[]>>('/archives/categories')
}
export function createArchiveCategory(data: { name: string; parent_id?: number; count?: number }) {
  return http.post<ApiResponse<ArchiveCategoryNode>>('/archives/categories', data)
}
export function updateArchiveCategory(id: number, data: { name?: string; count?: number }) {
  return http.put<ApiResponse<ArchiveCategoryNode>>(`/archives/categories/${id}`, data)
}
export function deleteArchiveCategory(id: number) {
  return http.delete<ApiResponse<boolean>>(`/archives/categories/${id}`)
}
export function listArchives(params?: Record<string, unknown>) {
  return http.get<ApiResponse<PageResult<ArchiveItem>>>('/archives', { params })
}
export function deleteArchive(id: number) {
  return http.delete<ApiResponse<boolean>>(`/archives/${id}`)
}
export async function uploadArchive(form: FormData) {
  // 不要手动设置 Content-Type，由浏览器自动带 boundary
  return http.post<ApiResponse<ArchiveItem>>('/archives/upload', form)
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface OptionItem {
  id: number
  name: string
  code?: string
  parent_id?: number | null
  children?: OptionItem[]
  scada_point_ids?: string
}

export interface MenuNode {
  id: number
  name: string
  path?: string | null
  component?: string | null
  icon?: string | null
  parent_id: number
  sort: number
  menu_type: string
  perms?: string | null
  visible?: number
  created_at?: string | null
  updated_at?: string | null
  children?: MenuNode[]
}

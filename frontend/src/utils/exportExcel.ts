// xlsx 体积约 830KB，改为动态 import：仅在真正执行导出时加载，避免拖慢列表页首屏
export interface ExportColumn {
  /** 字段名 */
  prop: string
  /** 表头名 */
  label: string
  /** 可选：单元格宽度（字符数） */
  width?: number
  /** 可选：值格式化函数 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatter?: (row: any) => string | number
}

/** 以 = + - @ 或制表符/回车开头的文本会被 Excel 当作公式执行（CSV/公式注入），前置单引号转义 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

function sanitizeCell(v: unknown): unknown {
  if (typeof v !== 'string' || !v) return v
  return FORMULA_PREFIX.test(v) ? `'${v}` : v
}

/**
 * 导出数据为 Excel 文件。
 * @param columns 列配置
 * @param data 数据行
 * @param filename 文件名（不含扩展名）
 */
export async function exportExcel(
  columns: ExportColumn[],
  data: Record<string, any>[],
  filename = '导出数据',
) {
  const XLSX = await import('xlsx')
  const header = columns.map((c) => c.label)
  const rows = data.map((row) =>
    columns.map((c) => {
      const v = c.formatter ? c.formatter(row) : row[c.prop]
      return v === null || v === undefined ? '' : sanitizeCell(v)
    }),
  )
  const aoa = [header, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columns.map((c) => ({ wch: c.width ?? Math.max(c.label.length * 2, 12) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`)
}

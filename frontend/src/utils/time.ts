/**
 * 绝对时间格式化：yyyy-MM-dd HH:mm(:ss)
 * 兼容后端 ISO（2026-10-03T17:43:19.457383）与空格分隔（2026-10-03 17:43:19）
 * 默认不带秒，列表/卡片场景统一为 yyyy-MM-dd HH:mm
 */
export function formatDateTime(time?: string | null, withSeconds = false): string {
  if (!time) return '-'
  const d = new Date(time.includes('T') ? time : time.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return time
  const p = (n: number) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return withSeconds ? `${base}:${p(d.getSeconds())}` : base
}

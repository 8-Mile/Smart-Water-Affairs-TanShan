/**
 * 唐港管网图层与业务系统配色（来自 5188 CAD 场景配置）。
 * 单一事实来源：场景渲染、图例、系统聚焦共用，避免多处硬编码。
 */
export const pipeLegend = [
  { name: '中压除尘', layer: '$管综-中压除尘', color: '#286BDD' },
  { name: '雨水', layer: '$管综-雨水', color: '#00A3CE' },
  { name: '市政中水', layer: '$管综-市政中水', color: '#3E7FC1' },
  { name: '生活给水', layer: '$管综-市政自来水 生活给水', color: '#DBB12E' },
  { name: '生活污水', layer: '$管综-生活污水', color: '#8854BF' },
  { name: '污泥', layer: '$管综-污泥管', color: '#C77832' },
  { name: '消防', layer: '$管综-室外消防', color: '#DD4D50' },
] as const

export const systemColors: Record<string, string> = Object.fromEntries(
  pipeLegend.map((p) => [p.layer, p.color]),
)
systemColors['$管综-室内消防'] = '#DD4D50'
systemColors['$管综-高压除尘'] = '#46b9d5'

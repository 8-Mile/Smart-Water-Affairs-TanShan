// 两个固定的本地演示快照。总览、图表、清单与详情读取同一份数据。
export type Register = 'fleet' | 'warehouse' | 'tracking'
export type Page = 'overview' | Register
export type Fact = [string, string]
export interface Entry {
  id: string
  page: Register
  name: string
  location: string
  state: string
  facts: Fact[]
}
export interface Activity {
  id: string
  time: string
  title: string
  detail: string
  target: string
  pending: boolean
}
export const navItems: { page: Page; label: string }[] = [
  { page: 'overview', label: '综合总览' },
  { page: 'fleet', label: '运输车辆' },
  { page: 'warehouse', label: '仓储管理' },
  { page: 'tracking', label: '货物追踪' },
]
export const registerLabels: Record<Register, [string, string, string]> = {
  fleet: ['运输车辆', 'FLEET REGISTER', '车辆'],
  warehouse: ['仓储管理', 'WAREHOUSE REGISTER', '库区'],
  tracking: ['货物追踪', 'SHIPMENT TRACKING', '运单'],
}
const zoneData = [
  ['A-01', '智能货架区', '北区一层', 2436, 3200],
  ['A-02', '零担存储区', '北区二层', 1654, 2400],
  ['B-01', '整托备货区', '东区一层', 1521, 2100],
  ['B-02', '接驳暂存区', '东区月台', 1172, 1600],
  ['C-01', '周转容器区', '南区一层', 912, 1500],
  ['C-02', '复核缓冲区', '南区二层', 782, 1100],
] as const
const orders = [
  ['FL-1121', '精密组件', '智能货架区', '入库复核', 240],
  ['FL-1122', '标准周转箱', '分拣输送区', '输送分拣', 180],
  ['FL-1123', '包装材料', '接驳暂存区', '等待装车', 320],
  ['FL-1124', '工装器具', 'AGV 搬运区', '搬运交接', 96],
  ['FL-1125', '通用配件', '东区三号月台', '已发运', 450],
  ['FL-1126', '检修耗材', '复核缓冲区', '等待复核', 128],
] as const
const vehiclePlaces = [
  '东区一号月台',
  '东区二号月台',
  '北侧接驳口',
  '南侧等候区',
  '西区装卸口',
  '东区三号月台',
  '北侧等候区',
  '西区接驳口',
]
const vehicleStates = [
  '装卸中',
  '待装车',
  '已到场',
  '待装车',
  '装卸中',
  '待放行',
  '已到场',
  '待放行',
]
export const slots = ['09时', '10时', '11时', '12时', '13时', '14时', '15时', '16时']
export const sum = (n: number[]) => n.reduce((v, x) => v + x, 0)
export const fmt = (n: number) => n.toLocaleString('zh-CN')
function snapshot(previous: boolean) {
  const date = previous ? '2026-11-18' : '2026-11-19'
  const inbound = previous
    ? [108, 174, 212, 280, 263, 371, 351, 324]
    : [119, 207, 238, 305, 287, 429, 394, 370]
  const outbound = previous
    ? [92, 150, 163, 216, 206, 300, 272, 249]
    : [105, 168, 195, 256, 213, 345, 308, 285]
  const internal = previous
    ? [852, 981, 1154, 973, 1026, 1253, 1217, 938]
    : [921, 1052, 1268, 1023, 1047, 1305, 1223, 949]
  const operationSeries = slots.map((_, i) => inbound[i] + outbound[i] + internal[i])
  const inventory = zoneData.map((z, i) => Number(z[3]) - (previous ? (i + 1) * 11 : 0))
  const zones: Entry[] = zoneData.map(([id, name, location, , capacity], i) => ({
    id,
    name,
    location,
    page: 'warehouse',
    state: '使用中',
    facts: [
      ['现存件数', fmt(inventory[i]) + ' 件'],
      ['设计容量', fmt(capacity) + ' 件'],
      ['占用率', ((inventory[i] / capacity) * 100).toFixed(1) + '%'],
    ],
  }))
  const fleet: Entry[] = vehiclePlaces.slice(0, previous ? 7 : 8).map((location, i) => ({
    id: 'TR-' + String(i + 1).padStart(2, '0'),
    page: 'fleet',
    name:
      ['短驳货车', '厢式货车', '集装箱车'][i % 3] + ' ' + String(i + 1).padStart(2, '0') + ' 号',
    location,
    state: vehicleStates[(i + (previous ? 1 : 0)) % vehicleStates.length],
    facts: [
      ['进场时间', date + ' ' + String(8 + i).padStart(2, '0') + ':15'],
      ['任务类型', i % 2 ? '出库运输' : '入库接驳'],
    ],
  }))
  const shipments: Entry[] = orders.map(([id, name, location, state, qty], i) => ({
    id,
    name,
    location,
    page: 'tracking',
    state: previous && i === 3 ? '等待交接' : state,
    facts: [
      ['货物数量', fmt(qty) + ' 件'],
      ['作业批次', date.slice(5).replace('-', '') + '-' + String(i + 1).padStart(2, '0')],
      ['经办班组', i % 2 ? '运输二组' : '仓储一组'],
    ],
  }))
  const raw: [string, string, string, string, boolean][] = [
    ['15:58', 'AGV 搬运任务已交接', '工装器具已送达交接工位。', 'FL-1124', false],
    ['15:52', '二号月台等待装车', '车辆已到位，等待装车确认。', 'TR-02', true],
    ['15:46', '智能货架区已完成盘点', '库区库存记录已核对。', 'A-01', false],
    ['15:32', '复核缓冲区有待复核运单', '货物已入缓冲区，等待复核。', 'FL-1126', true],
    ['15:17', '输送分拣批次更新', '周转箱已进入分拣工位。', 'FL-1122', false],
    ['15:08', '出库批次等待放行', '车辆正在月台等待放行。', 'TR-06', true],
  ]
  const priorRaw: typeof raw = [
    ['15:54', '北区库存已复核', '盘点记录已汇总。', 'A-01', false],
    ['15:42', '搬运工位等待交接', '工装器具等待接收。', 'FL-1124', true],
    ['15:23', '车辆已进入装卸区', '车辆位置已登记。', 'TR-01', false],
    ['15:06', '运单等待复核', '待核对货物封签。', 'FL-1126', true],
  ]
  const events: Activity[] = (previous ? priorRaw : raw).map(
    ([time, title, detail, target, pending], i) => ({
      id: date + '-' + i,
      time,
      title,
      detail,
      target,
      pending,
    }),
  )
  return {
    date,
    inbound,
    outbound,
    internal,
    operationSeries,
    inventory: sum(inventory),
    fleet,
    zones,
    shipments,
    events,
    entries: [...fleet, ...zones, ...shipments],
    completed: previous ? 116 : 121,
    scheduled: 125,
    online: previous ? 54 : 55,
    totalDevices: 56,
    operation: sum(operationSeries),
    inTotal: sum(inbound),
    outTotal: sum(outbound),
  }
}
export const snapshots = [snapshot(false), snapshot(true)] as const
export type Snapshot = (typeof snapshots)[number]
export const markers = [
  { id: 'A-01', label: '智能货架', kind: 'STORAGE', x: 52.26, y: 21.54, color: '#498e87' },
  { id: 'TR-01', label: '运输车辆', kind: 'TRANSPORT', x: 72.98, y: 28.28, color: '#6889ac' },
  { id: 'FL-1122', label: '分拣输送', kind: 'SORTING', x: 38.07, y: 43.45, color: '#b18c51' },
  { id: 'FL-1124', label: 'AGV 搬运', kind: 'TRANSFER', x: 29.55, y: 56.55, color: '#9082ad' },
]

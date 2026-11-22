/** 唐港业务菜单唯一配置：顶部七组导航、业务落地页与路由共用。 */
export interface TanggangNavItem {
  id: string
  title: string
  icon: string
  path: string
  permission?: string
  children?: TanggangNavItem[]
}
export const tanggangMenus: TanggangNavItem[] = [
  { id:'overview', title:'综合总览', icon:'ri:dashboard-3-line',path:'/dashboard' },
  { id:'monitor',title:'运行监测',icon:'ri:radar-line',path:'/port/process/fog',children:[
    {id:'fog',title:'射雾器除尘',icon:'ri:cloudy-line',path:'/port/process/fog'},
    {id:'middle',title:'中压供水',icon:'ri:water-flash-line',path:'/port/process/middle'},
    {id:'mineral',title:'含矿污水处理',icon:'ri:recycle-line',path:'/port/process/mineral'},
    {id:'rain',title:'雨水收集',icon:'ri:rainy-line',path:'/port/process/rain'},
    {id:'pool',title:'水池供水',icon:'ri:drop-line',path:'/port/process/pool'},
    {id:'domestic',title:'生活污水提升与外送',icon:'ri:flow-chart',path:'/port/process/domestic'},
  ]},
  { id:'water',title:'水资源管理',icon:'ri:water-flash-line',path:'/port/water/supply',children:[
    {id:'supply',title:'大机供水保障',icon:'ri:water-flash-line',path:'/port/water/supply'},
    {id:'rain-risk',title:'雨水调蓄风险',icon:'ri:rainy-line',path:'/port/water/rain-risk'},
    {id:'water-stats',title:'供水统计',icon:'ri:bar-chart-line',path:'/water/stats',permission:'water:stats'},
    {id:'energy-stats',title:'能耗分析',icon:'ri:line-chart-line',path:'/energy/stats',permission:'energy:stats'},
    {id:'dispatch-stats',title:'调度指令',icon:'ri:send-plane-line',path:'/dispatch/stats',permission:'dispatch:stats'},
  ]},
  { id:'operations',title:'运行处置',icon:'ri:alarm-warning-line',path:'/port/operations/monitor',children:[
    {id:'active-monitor',title:'主动智能监护',icon:'ri:shield-check-line',path:'/port/operations/monitor'},
    {id:'sim-decision',title:'模拟处置研判',icon:'ri:flow-chart',path:'/port/operations/decision'},
    {id:'alarm',title:'告警中心',icon:'ri:alarm-warning-line',path:'/alarm/realtime',permission:'alarm:realtime'},
    {id:'repair',title:'维修工单',icon:'ri:tools-line',path:'/repair/list',permission:'repair:list'},
  ]},
  { id:'assets',title:'设备运维',icon:'ri:server-line',path:'/equipment/list',children:[
    {id:'equipment',title:'设备台账',icon:'ri:server-line',path:'/equipment/list',permission:'eq:list'},
    {id:'inspection',title:'设备巡检',icon:'ri:list-check-2',path:'/inspection/tasks',permission:'insp:task:list'},
    {id:'maintenance',title:'计划维保',icon:'ri:settings-5-line',path:'/maintenance/plans',permission:'maint:plan:list'},
    {id:'archive',title:'档案管理',icon:'ri:archive-line',path:'/archive',permission:'archive:list'},
    {id:'data-review',title:'资料与测点核对',icon:'ri:file-search-line',path:'/port/data/provenance',permission:'scada:monitor'},
  ]},
  { id:'analysis',title:'分析中心',icon:'ri:brain-line',path:'/ai/chat',children:[
    {id:'analysis-ai',title:'AI智能助手',icon:'ri:robot-2-line',path:'/ai/chat'},
    {id:'analysis-boards',title:'我的看板',icon:'ri:layout-grid-line',path:'/port/analysis/boards'},
    {id:'analysis-reports',title:'运行复盘',icon:'ri:file-chart-line',path:'/port/analysis/reports'},
  ]},
  { id:'system',title:'系统管理',icon:'ri:settings-3-line',path:'/system/users',children:[
    {id:'system-org',title:'组织设置',icon:'ri:building-line',path:'/system/departments',permission:'sys:dept:list'},
    {id:'system-users',title:'权限管理',icon:'ri:user-settings-line',path:'/system/users',permission:'sys:user:list'},
    {id:'system-logs',title:'操作日志',icon:'ri:file-list-3-line',path:'/system/logs',permission:'sys:log:list'},
    {id:'system-scada',title:'SCADA接入',icon:'ri:link-line',path:'/system/scada',permission:'sys:scada:config'},
  ]},
]
export function tanggangGroupForPath(path: string): string {
  const group=tanggangMenus.find(m=>m.path===path || m.children?.some(c=>c.path===path) || (m.id==='monitor' && path.startsWith('/port/process/')))
  return group?.id ?? 'overview'
}

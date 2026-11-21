import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { usePermissions } from '@/utils/permissions'

/**
 * 异常页展示逻辑（与效果图 403/404/500 一一对应）：
 * 1. 404「页面不存在」：访问未定义路由 → catchAll 兜底；未登录时先由守卫送去登录，登录后回到原地址落到 404。
 * 2. 403「暂无访问权限」：
 *    - 路由级：路由 meta.perm 声明所需权限码（与后端菜单 perms 一致），守卫校验不通过 → 403；
 *    - 接口级：后端返回 HTTP 403（越权调用）→ http.ts 统一跳 403。
 * 3. 500「服务暂时不可用」：后端返回 HTTP 5xx（服务错误）→ http.ts 统一跳 500。
 * 异常页均为全屏独立页（带品牌栏，无业务布局），页面内不发业务请求，避免二次报错循环。
 */
const exceptionRoutes = [
  {
    path: '/exception/403',
    name: 'exception-403',
    component: () => import('@/views/exception/403/index.vue'),
    meta: { title: '暂无访问权限' },
  },
  {
    path: '/exception/500',
    name: 'exception-500',
    component: () => import('@/views/exception/500/index.vue'),
    meta: { title: '服务暂时不可用' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'exception-404',
    component: () => import('@/views/exception/404/index.vue'),
    meta: { title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/themes/ThemeLoginHost.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/themes/ThemeShell.vue'),
      // 默认首页为 /dashboard，内容即唐港港区总览
      redirect: '/dashboard',
      children: [
        {
          // 原泵站工作台：/dashboard 让位给港区总览后，改由此地址继续访问
          path: 'dashboard/workbench',
          name: 'dashboard-workbench',
          component: () => import('@/views/dashboard/DashboardView.vue'),
          meta: { title: '泵站首页总览', perm: 'dashboard:view' },
        },
        // ai
        {
          path: 'ai/chat',
          name: 'ai-chat',
          component: () => import('@/views/ai/ChatView.vue'),
          // 无页面级权限码：右下角悬浮入口，所有登录用户可用
          meta: { title: '智能助手' },
        },
        // system
        {
          path: 'system/departments',
          name: 'system-departments',
          component: () => import('@/views/system/DepartmentsView.vue'),
          meta: { title: '组织设置', perm: 'sys:dept:list' },
        },
        {
          path: 'system/teams',
          redirect: '/system/departments',
        },
        {
          path: 'system/locations',
          redirect: '/system/departments',
        },
        {
          path: 'system/units',
          redirect: '/system/departments',
        },
        {
          path: 'system/users',
          name: 'system-users',
          component: () => import('@/views/system/UsersView.vue'),
          meta: { title: '权限管理', perm: 'sys:user:list' },
        },
        {
          path: 'system/roles',
          redirect: '/system/users',
        },
        {
          path: 'system/menus',
          redirect: '/system/users',
        },
        {
          path: 'system/logs',
          name: 'system-logs',
          component: () => import('@/views/system/LogsView.vue'),
          meta: { title: '操作日志', perm: 'sys:log:list' },
        },
        {
          path: 'system/scada',
          name: 'system-scada',
          component: () => import('@/views/system/ScadaSettingsView.vue'),
          // superOnly：仅超级管理员可见（后端接口同样以角色硬校验）
          meta: { title: 'SCADA 接入设置', perm: 'sys:scada:config', superOnly: true },
        },
        // archive
        {
          path: 'archive',
          name: 'archive',
          component: () => import('@/views/archive/IndexView.vue'),
          meta: { title: '档案管理', perm: 'archive:list' },
        },
        // water
        {
          path: 'water/plans',
          redirect: '/water/stats',
        },
        {
          path: 'water/stats',
          name: 'water-stats',
          component: () => import('@/views/water/StatsView.vue'),
          meta: { title: '供水分析', perm: 'water:stats' },
        },
        {
          path: 'water/compare',
          redirect: '/water/stats',
        },
        // energy
        {
          path: 'energy/stats',
          name: 'energy-stats',
          component: () => import('@/views/energy/StatsView.vue'),
          meta: { title: '能耗分析', perm: 'energy:stats' },
        },
        {
          path: 'energy/records',
          redirect: '/energy/stats',
        },
        {
          path: 'energy/fee',
          redirect: '/energy/stats',
        },
        {
          path: 'energy/ratio',
          redirect: '/energy/stats',
        },
        {
          path: 'energy/prices',
          redirect: '/energy/stats',
        },
        // dispatch
        {
          path: 'dispatch/stats',
          name: 'dispatch-stats',
          component: () => import('@/views/dispatch/StatsView.vue'),
          meta: { title: '调度指令', perm: 'dispatch:stats' },
        },
        {
          path: 'dispatch/audit',
          redirect: '/dispatch/stats',
        },
        {
          path: 'dispatch/tasks',
          redirect: '/dispatch/stats',
        },
        // inspection
        {
          path: 'inspection/plans',
          redirect: '/inspection/tasks',
        },
        {
          path: 'inspection/tasks',
          name: 'insp-tasks',
          component: () => import('@/views/inspection/TasksView.vue'),
          meta: { title: '设备巡检', perm: 'insp:task:list' },
        },
        {
          path: 'inspection/records',
          redirect: '/inspection/tasks',
        },
        // maintenance
        {
          path: 'maintenance/plans',
          name: 'maint-plans',
          component: () => import('@/views/maintenance/PlansView.vue'),
          meta: { title: '设备维护', perm: 'maint:plan:list' },
        },
        {
          path: 'maintenance/records',
          redirect: '/maintenance/plans',
        },
        {
          path: 'maintenance/ledger',
          redirect: '/maintenance/plans',
        },
        // repair
        {
          path: 'repair/approve',
          redirect: '/repair/list',
        },
        {
          path: 'repair/process',
          redirect: '/repair/list',
        },
        {
          path: 'repair/accept',
          redirect: '/repair/list',
        },
        {
          path: 'repair/list',
          name: 'repair-list',
          component: () => import('@/views/repair/ListView.vue'),
          meta: { title: '维修工单', perm: 'repair:list' },
        },
        // alarm
        {
          path: 'alarm/realtime',
          name: 'alarm-realtime',
          component: () => import('@/views/alarm/RealtimeView.vue'),
          meta: { title: '告警中心', perm: 'alarm:realtime' },
        },
        // 历史的独立入口：告警中心以 ?tab= 形式承载子 Tab，支持深层链接与刷新保持
        {
          path: 'alarm/rules',
          redirect: { path: '/alarm/realtime', query: { tab: 'rules' } },
        },
        {
          path: 'alarm/history',
          redirect: { path: '/alarm/realtime', query: { tab: 'history' } },
        },
        {
          path: 'alarm/types',
          redirect: { path: '/alarm/realtime', query: { tab: 'types' } },
        },
        // scada
        {
          path: 'scada/points',
          redirect: '/scada/monitor',
        },
        {
          path: 'scada/monitor',
          name: 'scada-monitor',
          component: () => import('@/views/scada/MonitorView.vue'),
          meta: { title: '实时监控', perm: 'scada:monitor' },
        },
        // equipment
        {
          path: 'equipment/types',
          redirect: '/equipment/list',
        },
        {
          path: 'equipment/list',
          name: 'equipment-list',
          component: () => import('@/views/equipment/ListView.vue'),
          meta: { title: '设备台账', perm: 'eq:list' },
        },
        {
          path: 'equipment/running-status',
          redirect: '/equipment/list',
        },
        {
          path: 'equipment/detail/:id',
          name: 'equipment-detail',
          component: () => import('@/views/equipment/UnitDetailView.vue'),
          meta: { title: '机组详情', perm: 'eq:list' },
        },
        {
          path: 'equipment/maintenance-vendors',
          name: 'equipment-maintenance-vendors',
          component: () => import('@/views/equipment/MaintenanceVendorsView.vue'),
          meta: { title: '厂商管理', perm: 'eq:maintainer:list' },
        },
        {
          path: 'equipment/manufacturers',
          redirect: '/equipment/maintenance-vendors',
        },
        {
          path: 'equipment/run-log',
          redirect: '/equipment/list',
        },
      ],
    },
    // 默认首页：/dashboard 直接渲染唐港港区总览（与 /port/overview 同一页面）
    // 不设页面级权限码：super_admin 仅有 sys:* 权限，若绑定 dashboard:view 会被 403 拦截
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/port/PortOverviewView.vue'),
      meta: { title: '唐港港区总览' },
    },
    // 唐港港区智慧水务首页：独立顶部导航布局，保留原地址以兼容既有链接
    {
      path: '/port/overview',
      name: 'port-overview',
      component: () => import('@/views/port/PortOverviewView.vue'),
      meta: { title: '唐港港区总览' },
    },
    {
      path: '/port/scene-lab',
      name: 'port-scene-lab',
      component: () => import('@/views/port/SceneLabView.vue'),
      meta: { title: '唐港三维场景验证' },
    },
    // 异常页（根级全屏，catchAll 404 必须最后注册）
    ...exceptionRoutes,
  ],
})

router.beforeEach(async (to) => {
  const user = useUserStore()
  if (to.meta.public) {
    if (user.isLoggedIn && to.name === 'login') {
      return { name: 'dashboard' }
    }
    return true
  }
  if (!user.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (!user.profile) {
    try {
      await user.fetchMe()
    } catch {
      user.logout()
      return { name: 'login' }
    }
  }
  // 页面级权限：meta.perm 与后端菜单 perms 对齐，无权限 → 403
  const needPerm = to.meta.perm as string | undefined
  if (needPerm && !usePermissions().hasPerm(needPerm)) {
    return { name: 'exception-403', query: { from: to.fullPath } }
  }
  // 仅超级管理员可见的页面（如 SCADA 接入设置）
  if (to.meta.superOnly && !usePermissions().isSuper) {
    return { name: 'exception-403', query: { from: to.fullPath } }
  }
  return true
})

export default router

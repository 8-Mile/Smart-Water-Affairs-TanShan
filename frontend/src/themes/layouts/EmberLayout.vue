<template>
  <div class="app-layout">
    <!-- 移动端抽屉遮罩（≤768px：点击关闭侧栏抽屉） -->
    <div v-if="isMobile && drawerOpen" class="sidebar-mask" @click="drawerOpen = false" />

    <!-- 侧栏 -->
    <div id="app-sidebar" :class="{ 'drawer-open': drawerOpen }">
      <div class="layout-sidebar is-light" :class="{ 'is-collapsed': collapsed }">
        <div class="menu-left menu-left-light" :class="{ 'menu-left-close': collapsed }">
          <div class="header" @click="$router.push('/')">
            <img :src="logoImg" class="logo" alt="logo" />
            <span v-if="!collapsed" class="sys-title" title="唐港51·52号泊位智慧水务">唐港智慧水务</span>
          </div>
          <el-scrollbar>
            <el-menu
              ref="menuEl"
              :class="'el-menu-design'"
              :collapse="collapsed"
              :default-active="active"
              :collapse-transition="false"
              :unique-opened="true"
              :default-openeds="activeGroupIndex ? [activeGroupIndex] : []"
              router
              background-color="transparent"
              @open="onSubMenuToggle"
              @close="onSubMenuToggle"
            >
              <!-- 选中高亮块：绝对定位滑块，切换时从旧位置滑到新位置，宽高跟随目标 -->
              <li v-show="hl.visible" class="menu-highlight" :style="hlStyle" aria-hidden="true" />
              <template v-for="item in menus" :key="item.id">
                <el-sub-menu
                  v-if="item.children?.length"
                  :index="item.path || String(item.id)"
                >
                  <template #title>
                    <div class="menu-icon flex-cc">
                      <ArtSvgIcon :icon="item.icon || 'ri:folder-line'" />
                    </div>
                    <span class="menu-name">{{ item.name }}</span>
                  </template>
                  <template v-for="child in item.children" :key="child.id">
                    <el-sub-menu
                      v-if="child.children?.length"
                      :index="child.path || String(child.id)"
                    >
                      <template #title>
                        <div class="menu-icon flex-cc">
                          <ArtSvgIcon :icon="child.icon || 'ri:folder-line'" />
                        </div>
                        <span class="menu-name">{{ child.name }}</span>
                      </template>
                      <el-menu-item
                        v-for="grand in child.children"
                        :key="grand.id"
                        :index="grand.path || String(grand.id)"
                      >
                        <div class="menu-icon flex-cc">
                          <ArtSvgIcon :icon="grand.icon || 'ri:record-circle-line'" />
                        </div>
                        <span class="menu-name">{{ grand.name }}</span>
                      </el-menu-item>
                    </el-sub-menu>
                    <el-menu-item v-else :index="child.path || String(child.id)">
                      <div class="menu-icon flex-cc">
                        <ArtSvgIcon :icon="child.icon || 'ri:record-circle-line'" />
                      </div>
                      <span class="menu-name">{{ child.name }}</span>
                    </el-menu-item>
                  </template>
                </el-sub-menu>
                <el-menu-item
                  v-else
                  :index="item.path || String(item.id)"
                >
                  <div class="menu-icon flex-cc">
                    <ArtSvgIcon :icon="item.icon || 'ri:apps-2-line'" />
                  </div>
                  <span class="menu-name">{{ item.name }}</span>
                </el-menu-item>
              </template>
            </el-menu>
          </el-scrollbar>
        </div>
      </div>
    </div>

    <!-- 主区 -->
    <div id="app-main">
      <header id="app-header">
        <div class="h-btn" @click="onMenuToggle">
          <ArtSvgIcon icon="ri:menu-2-fill" :style="{ fontSize: '20px' }" />
        </div>
        <!-- 顶栏：仅页面名 -->
        <div class="head-title">
          <span class="page-name">{{ pageTitle === '工作台' ? '唐港综合总览' : pageTitle }}</span>
        </div>
        <div class="h-spacer" />

        <!-- 数据新鲜度：最近一次成功取数时间，点击重载当前页 -->
        <div class="head-freshness" title="点击刷新当前页面数据" @click="onRefreshPage">
          <ArtSvgIcon icon="ri:refresh-line" class="fresh-icon" :class="{ spinning: pageReloading }" />
          <span>更新 {{ freshnessText }}</span>
        </div>

        <!-- 实时时钟 -->
        <div class="head-clock">
          <el-icon :size="16"><Clock /></el-icon>
          <span>{{ clockText }}</span>
        </div>

        <div class="h-right">
          <!-- 全屏 -->
          <div class="h-btn ml-extra" @click="onFullscreen">
            <ArtSvgIcon
              :icon="isFullscreen ? 'ri:fullscreen-exit-line' : 'ri:fullscreen-fill'"
              :style="{ fontSize: '20px' }"
            />
          </div>

          <!-- 通知（超管不接收站内消息，隐藏入口） -->
          <el-popover
            v-if="!isSuper"
            v-model:visible="noticeVisible"
            placement="bottom-end"
            :width="340"
            :offset="8"
            trigger="click"
            popper-class="art-head-popover"
            @show="loadNotifications"
          >
            <template #reference>
              <div class="h-btn icon-wrap" @click="loadNotifications">
                <ArtSvgIcon icon="ri:notification-2-line" :style="{ fontSize: '20px' }" />
                <span v-if="unreadCount > 0" class="head-dot dot-danger" :class="{ 'has-num': unreadCount > 0 }">
                  {{ unreadCount > 99 ? '99+' : unreadCount }}
                </span>
              </div>
            </template>
            <div class="notice-panel">
              <div class="panel-head">
                <span>通知{{ unreadCount > 0 ? `（${unreadCount} 条未读）` : '' }}</span>
                <span v-if="unreadCount > 0" class="panel-mark" @click="onReadAll">全部已读</span>
              </div>
              <div v-loading="noticeLoading" class="notice-list">
                <div v-if="!noticeLoading && notifications.length === 0" class="panel-empty">
                  <ArtSvgIcon icon="ri:notification-off-line" :style="{ fontSize: '28px' }" />
                  <p>暂无新通知</p>
                </div>
                <div
                  v-for="n in notifications"
                  :key="n.id"
                  class="notice-item"
                  :class="{ unread: !n.is_read }"
                  @click="onNoticeClick(n)"
                >
                  <div class="notice-dot" :class="ntypeDot(n.ntype)" />
                  <div class="notice-body">
                    <div class="notice-title">
                      {{ n.title }}
                      <span v-if="!n.is_read" class="new-tag">NEW</span>
                    </div>
                    <div class="notice-content">{{ n.content }}</div>
                    <div class="notice-time">{{ formatTime(n.created_at) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </el-popover>

          <!-- 用户头像菜单 -->
          <el-popover
            placement="bottom-end"
            :width="240"
            :offset="10"
            :show-arrow="false"
            trigger="hover"
            popper-class="art-head-popover"
            popper-style="padding: 5px 16px;"
          >
            <template #reference>
              <span class="h-avatar">{{ avatarText }}</span>
            </template>
            <div class="user-card">
              <div class="uc-head">
                <span class="uc-avatar">{{ avatarText }}</span>
                <div class="uc-info">
                  <p class="uc-name">{{ user.displayName }}</p>
                  <p class="uc-sub">{{ user.profile?.username || user.profile?.role_code || '' }}</p>
                </div>
              </div>
              <div class="uc-divider" />
              <div class="uc-logout" @click="onLogout">退出登录</div>
            </div>
          </el-popover>
        </div>
      </header>

      <!-- 断网感知条：API 不可达（断网/服务无响应）时出现，恢复后自动消失 -->
      <transition name="conn-slide">
        <div v-if="connection.apiDown" class="conn-banner" role="alert">
          <span class="conn-pulse" />
          <span>连接已断开，等待恢复中……当前数据可能不是最新</span>
        </div>
      </transition>

      <div id="app-content">
        <div class="layout-content">
          <div class="page-content">
            <router-view v-if="pageAlive" v-slot="{ Component, route }">
              <transition name="fade" mode="out-in">
                <!-- key 用 path 而非 fullPath：同页 query 变化（tab 切换、筛选同步地址栏）
                     不再整页重挂载；跨页导航（path 变化）仍正常重建。
                     同路径需强制刷新的场景走 app:reload-page 事件（通知点击已用此机制） -->
                <component :is="Component" :key="route.path" />
              </transition>
            </router-view>
          </div>
        </div>
      </div>
    </div>
    <AiFloatAssistant />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { connection } from '@/utils/connection'
import { useRoute, useRouter } from 'vue-router'
import { Clock } from '@element-plus/icons-vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import AiFloatAssistant from '@/components/AiFloatAssistant.vue'
import logoImg from '@/assets/img/DALOGO.webp'
import { useAppMenus } from '@/composables/useAppMenus'
import { useAppChrome } from '@/composables/useAppChrome'
import { usePermissions } from '@/utils/permissions'
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '@/api/notification'

const router = useRouter()
const route = useRoute()
const { menus, active, pageTitle } = useAppMenus()
const { user, onLogout } = useAppChrome()

const collapsed = ref(false)
// 路由级高亮沿用成熟滑块与子菜单动效，父级使用独立索引。
// 不让二级目录与六工艺首页共享路由索引而产生选中状态冲突。
const activeGroupIndex = computed(() => {
  for (const node of menus.value) {
    if (!node.children?.length) continue
    if (node.children.some((child) => child.path === route.path)) return node.path ?? ''
  }
  return ''
})
function openActiveGroup() {
  const index = activeGroupIndex.value
  if (index && !collapsed.value) {
    menuEl.value?.open(index)
  }
}


/* ===== 侧栏选中高亮块：切换菜单时从旧位置滑到新位置，宽高跟随目标并带回弹 =====
   位置在路由变化/折叠/子菜单展开后重新测量；首次渲染静默定位，不播动画 */
const menuEl = ref()
const hl = reactive({ x: 0, y: 0, w: 0, h: 0, visible: false })
let hlFirst = true
let hlTimer: number | undefined

const hlStyle = computed(() => ({
  transform: `translate(${hl.x}px, ${hl.y}px)`,
  width: `${hl.w}px`,
  height: `${hl.h}px`,
}))

function menuRootEl(): HTMLElement | undefined {
  return (menuEl.value as { $el?: HTMLElement } | undefined)?.$el
}

function measureActiveItem() {
  const root = menuRootEl()
  if (!root) return
  // 优先叶子菜单项；叶子不可见（侧栏折叠为弹层/子菜单收起）时退到父级标题
  const rr = root.getBoundingClientRect()
  let r = root.querySelector<HTMLElement>('.el-menu-item.is-active')?.getBoundingClientRect()
  if (!r || (r.width === 0 && r.height === 0)) {
    r = root
      .querySelector<HTMLElement>('.el-sub-menu.is-active > .el-sub-menu__title')
      ?.getBoundingClientRect()
  }
  if (!r || (r.width === 0 && r.height === 0)) {
    hl.visible = false
    return
  }
  hl.x = r.left - rr.left
  hl.y = r.top - rr.top
  hl.w = r.width
  hl.h = r.height
  hl.visible = true
}

function updateHighlight(animate = true) {
  window.clearTimeout(hlTimer)
  nextTick(() => {
    const root = menuRootEl()
    if (!root) return
    const instant = !animate || hlFirst
    if (instant) root.classList.add('menu-hl-instant')
    measureActiveItem()
    if (instant) {
      hlFirst = false
      requestAnimationFrame(() => root.classList.remove('menu-hl-instant'))
    }
    // 子菜单展开/收起动画（约 300ms）会改变激活项位置，动画结束后再校准一次
    hlTimer = window.setTimeout(measureActiveItem, 320)
  })
}

function onSubMenuToggle() {
  updateHighlight()
}

function onWindowResize() {
  updateHighlight()
}

/* ===== 窄屏（≤1024px）侧栏自动收起为图标栏；宽屏恢复展开，手动切换仍可用 ===== */
let mqCollapse: MediaQueryList | undefined
function onMqCollapse(e: MediaQueryList | MediaQueryListEvent) {
  if (isMobile.value) return // 移动态由抽屉接管，不联动收起
  collapsed.value = e.matches
}

/* ===== 移动端（≤768px）侧栏抽屉化：默认隐藏，汉堡按钮滑出，遮罩/换路由关闭 ===== */
const isMobile = ref(false)
const drawerOpen = ref(false)
let mqMobile: MediaQueryList | undefined
function onMqMobile(e: MediaQueryList | MediaQueryListEvent) {
  isMobile.value = e.matches
  drawerOpen.value = false
  if (isMobile.value) collapsed.value = false // 抽屉内始终展开完整菜单
  else collapsed.value = mqCollapse?.matches ?? false
}
function onMenuToggle() {
  if (isMobile.value) drawerOpen.value = !drawerOpen.value
  else collapsed.value = !collapsed.value
}
/* 高亮块重定位触发：路由/折叠/移动态/菜单数据（菜单首载时静默，不播动画） */
watch(
  () => route.path,
  () => {
    drawerOpen.value = false
    nextTick(openActiveGroup)
    updateHighlight()
  },
)
watch(collapsed, () => { nextTick(openActiveGroup); updateHighlight() })
watch(isMobile, () => updateHighlight())
watch(menus, () => {
  nextTick(openActiveGroup)
  updateHighlight(false)
})

const isFullscreen = ref(false)

function syncFullscreen() {
  isFullscreen.value = !!document.fullscreenElement
}

function onFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
}

const avatarText = computed(() => (user.displayName || 'U').slice(0, 1))

/* ===== 数据新鲜度 + 手动刷新：显示最近一次成功取数时间；点击重挂载当前页 ===== */
const freshnessText = computed(() => {
  if (!connection.lastOkAt) return '--:--:--'
  const d = new Date(connection.lastOkAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
const pageAlive = ref(true)
const pageReloading = ref(false)
function onRefreshPage() {
  if (pageReloading.value) return
  pageReloading.value = true
  pageAlive.value = false
  nextTick(() => {
    pageAlive.value = true
    window.setTimeout(() => (pageReloading.value = false), 600)
  })
}

/* ===== 顶栏实时时钟 ===== */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const now = ref(new Date())
let clockTimer: number | undefined
const clockText = computed(() => {
  const d = now.value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

/* ===== 通知铃铛（超管不接收站内消息：隐藏入口并停止轮询） ===== */
const { isSuper } = usePermissions()
const noticeVisible = ref(false)
const noticeLoading = ref(false)
const notifications = ref<NotificationItem[]>([])
const unreadCount = ref(0)
let unreadTimer: number | undefined

async function loadUnreadCount() {
  try {
    const { data } = await fetchUnreadCount()
    unreadCount.value = data?.data?.unread ?? 0
  } catch {
    /* 静默 */
  }
}

async function loadNotifications() {
  noticeLoading.value = true
  try {
    const { data } = await fetchNotifications({ page: 1, page_size: 20 })
    notifications.value = data?.data?.list ?? []
    unreadCount.value = data?.data?.unread ?? 0
  } catch (e) {
    console.warn('[notifications] 列表加载失败:', e)
    notifications.value = []
  } finally {
    noticeLoading.value = false
  }
}

async function onNoticeClick(n: NotificationItem) {
  if (!n.is_read) {
    try {
      await markNotificationRead(n.id)
      n.is_read = 1
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    } catch {
      /* ignore */
    }
  }
  if (n.path) {
    noticeVisible.value = false
    const [p, q] = n.path.split('?')
    const params = new URLSearchParams(q || '')
    const focusVal = params.get('focus') || ''
    const tabVal = params.get('tab') || ''
    if (route.path === p) {
      // 已在目标页：不重复导航，就地高亮 + 触发页面数据刷新
      // focus 与当前一致（重复点击同一条）时 query 不变、watch 不触发，用事件兜底重新定位
      if (focusVal && route.query.focus === focusVal) {
        window.dispatchEvent(new CustomEvent('app:focus-row', { detail: { value: focusVal } }))
        window.dispatchEvent(new CustomEvent('app:reload-page'))
      } else {
        // 保留通知 path 携带的其他参数（如维保页 tab=records），否则无法切换到目标 Tab
        window.dispatchEvent(new CustomEvent('app:reload-page'))
        router
          .push({
            path: p,
            query: { ...route.query, ...(tabVal ? { tab: tabVal } : {}), focus: focusVal || undefined },
          })
          .catch(() => {})
      }
    } else {
      router.push(n.path)
    }
  }
}

async function onReadAll() {
  try {
    await markAllNotificationsRead()
    notifications.value.forEach((n) => (n.is_read = 1))
    unreadCount.value = 0
  } catch {
    /* ignore */
  }
}

function ntypeDot(ntype: string) {
  switch (ntype) {
    case 'alarm': return 'dot-alarm'
    case 'repair': return 'dot-repair'
    case 'inspection': return 'dot-inspection'
    case 'dispatch': return 'dot-dispatch'
    default: return 'dot-default'
  }
}

function formatTime(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreen)
  // 窄屏侧栏自动收起 / 移动态抽屉化
  mqCollapse = window.matchMedia('(max-width: 1024px)')
  mqCollapse.addEventListener('change', onMqCollapse)
  mqMobile = window.matchMedia('(max-width: 768px)')
  mqMobile.addEventListener('change', onMqMobile)
  onMqMobile(mqMobile) // 初始化时同步一次（内部会按移动态决定 collapsed）
  // 超管无通知入口，跳过未读轮询
  if (!isSuper.value) {
    loadUnreadCount()
    unreadTimer = window.setInterval(loadUnreadCount, 10000)
  }
  clockTimer = window.setInterval(() => (now.value = new Date()), 1000)
  // 高亮块：首帧静默定位，视口尺寸变化时跟随
  window.addEventListener('resize', onWindowResize)
  updateHighlight(false)
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
  mqCollapse?.removeEventListener('change', onMqCollapse)
  mqMobile?.removeEventListener('change', onMqMobile)
  if (unreadTimer) window.clearInterval(unreadTimer)
  if (clockTimer) window.clearInterval(clockTimer)
  window.clearTimeout(hlTimer)
  window.removeEventListener('resize', onWindowResize)
})
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100%;
  /* 背景统一锚定在 body 视口级底图，布局层全透明 */
  background: transparent;
}

/* 独立悬浮侧栏：距视口左/上/下16px，右侧与主内容间隔16px。
   边距放在容器而非面板内，确保阴影不被面板overflow裁切。 */
#app-sidebar {
  flex: 0 0 auto;
  box-sizing: border-box;
  height: 100vh;
  padding: 16px;
  display: flex;
  min-width: 0;
}

.layout-sidebar {
  position: relative;
  width: 210px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  border-radius: 20px;
  /* 轻盈的冷白磨砂层，不再是一整块顶天立地的实色导航 */
  background: linear-gradient(
    165deg,
    rgb(255 255 255 / 67%) 0%,
    rgb(250 253 255 / 57%) 48%,
    rgb(241 248 255 / 51%) 100%
  );
  backdrop-filter: blur(18px) saturate(1.18);
  -webkit-backdrop-filter: blur(18px) saturate(1.18);
  border: 1px solid rgb(255 255 255 / 70%);
  /* 每层阴影不透明度都较低：近层接地，中层体积，远层氛围 */
  box-shadow:
    0 2px 5px rgb(33 68 102 / 3.2%),
    0 9px 24px rgb(33 68 102 / 5.2%),
    0 24px 50px rgb(33 68 102 / 3.2%),
    inset 0 1px 0 rgb(255 255 255 / 58%);
  transition:
    box-shadow var(--motion-fast, 200ms) ease,
    background-color var(--motion-fast, 200ms) ease;
}
/* 侧栏背景图：仅铺在菜单栏底部，100% 不透明显示 */
.layout-sidebar::before {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 220px;
  background: url('../../assets/img/menuBg.png') center bottom / cover no-repeat;
  /* 顶边羽化：与上方侧栏底色渐变融合，消除硬横线 */
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 72px);
  mask-image: linear-gradient(180deg, transparent 0, #000 72px);
  pointer-events: none;
  opacity: 0.25;
}
.layout-sidebar.is-collapsed {
  width: 70px;
}

/* 设计图 logo 区：圆形 logo + 系统标题 */
.layout-sidebar .header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 14px;
}
.layout-sidebar .header .logo {
  width: 40px;
  height: 40px;
  margin-left: 0;
  border-radius: 50%;
  flex-shrink: 0;
}
.layout-sidebar .header .sys-title {
  font-size: 16px;
  font-weight: 700;
  color: #1b2a3d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 设计图侧栏：深灰蓝文字 + 白→浅蓝渐变激活块 */
.layout-sidebar .menu-left :deep(.el-menu-design) {
  /* 高亮块 .menu-highlight 的定位容器 */
  position: relative;
  background: transparent;

  .menu-icon {
    color: rgb(51 65 90 / 72%);
  }

  .el-sub-menu__title,
  .el-menu-item {
    /* 内容层叠在高亮块之上 */
    position: relative;
    z-index: 1;
    color: #33415a;
    font-weight: 600;
    border: 1px solid transparent;
    border-radius: 10px;
    transition:
      background 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease,
      box-shadow 0.2s ease;

    /* Hover 时出现极淡边框 */
    &:hover {
      color: #1d4ed8 !important;
      border-color: rgb(95 166 235 / 12%);
      background: linear-gradient(
        90deg,
        rgb(231 243 255 / 92%),
        rgb(244 250 255 / 68%)
      ) !important;
    }

    .menu-name {
      color: inherit;
    }
  }

  .el-sub-menu__icon-arrow {
    color: rgb(51 65 90 / 55%) !important;
  }

  /* 菜单选中：文字/图标高亮（背景胶囊由 .menu-highlight 滑块承载，切换时滑动） */
  .el-menu-item.is-active {
    color: #0969da !important;
    font-weight: 600;

    .menu-icon {
      color: #1677ff !important;
    }
  }
  /* 激活项收在子菜单内时，父级标题文字/图标同步高亮 */
  .el-sub-menu.is-active > .el-sub-menu__title {
    color: #0969da !important;

    .menu-icon {
      color: #1677ff !important;
    }
  }
}

/* ===== 菜单滑动高亮块：切换时从旧位置滑到新位置，宽高跟随目标，带回弹 ===== */
.menu-highlight {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  border: 1px solid rgb(95 166 235 / 16%);
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    rgb(255 255 255 / 98%) 0%,
    rgb(233 246 255 / 96%) 100%
  );
  box-shadow:
    0 5px 15px rgb(45 121 192 / 8%),
    inset 0 1px 0 rgb(255 255 255 / 88%);
  pointer-events: none;
  transition:
    transform var(--motion-slow, 360ms) cubic-bezier(0.34, 1.56, 0.64, 1),
    width var(--motion-slow, 360ms) cubic-bezier(0.34, 1.56, 0.64, 1),
    height var(--motion-slow, 360ms) cubic-bezier(0.34, 1.56, 0.64, 1);
}
/* 高亮块左侧蓝色竖线（随块滑动，垂直居中适配不同行高） */
.menu-highlight::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  width: 3px;
  height: 28px;
  max-height: 64%;
  border-radius: 0 4px 4px 0;
  background: linear-gradient(180deg, #24b9ff 0%, #1677ff 100%);
  box-shadow: 0 0 8px rgb(22 119 255 / 28%);
  transform: translateY(-50%);
}
/* 首帧定位/批量重排：静默，不播滑动 */
.menu-hl-instant .menu-highlight {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .menu-highlight {
    transition: none;
  }
}
.menu-left {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.menu-left :deep(.el-scrollbar) {
  flex: 1;
  min-height: 0;
}
.menu-left-close {
  width: 70px;
}
/* 收起时菜单填满侧栏宽度，避免 EP 默认 64px 留白 */
.layout-sidebar :deep(.el-menu) {
  width: 100% !important;
}

#app-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow: auto;
}

#app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 60px;
  padding: 0 20px;
  /* 顶栏取消实色白底：极轻白纱 + 轻模糊，保持底图光束连续性；
     模糊仅用于滚动内容穿过时防文字混叠 */
  background: rgb(255 255 255 / 16%);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgb(147 184 220 / 20%);
  flex-shrink: 0;
}

/* 效果图顶栏大标题 */
.head-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.head-title .sys-name {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 1px;
  white-space: nowrap;
  background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 45%, #0ea5e9 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.head-title .title-divider {
  width: 1px;
  height: 20px;
  background: var(--art-card-border, #d8e0ea);
}
.head-title .page-name {
  overflow: hidden;
  color: #000;
  font-size: 17px;
  font-weight: 800;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 数据新鲜度标识 */
.head-freshness {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 16px;
  color: rgb(0 0 0 / 55%);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: color var(--motion-fast) var(--ease-standard);
}
.head-freshness:hover {
  color: var(--el-color-primary);
}
.head-freshness .fresh-icon {
  font-size: 14px;
}
.head-freshness .fresh-icon.spinning {
  animation: fresh-spin 0.6s var(--ease-standard);
}
@keyframes fresh-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 断网感知条 */
.conn-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 34px;
  font-size: 13px;
  color: #92610a;
  background: linear-gradient(90deg, rgb(254 243 199 / 96%), rgb(253 230 138 / 94%));
  border-bottom: 1px solid rgb(217 119 6 / 25%);
}
.conn-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d97706;
  animation: conn-blink 1.2s ease-in-out infinite;
}
@keyframes conn-blink {
  50% {
    opacity: 0.35;
    transform: scale(0.8);
  }
}
.conn-slide-enter-active {
  transition:
    opacity var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
}
.conn-slide-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
/* 离场不做过渡：连接恢复时立即摘除（leave 无 CSS 时长，v-if 即时移除），
   同时规避后台标签页 transitionend 被节流导致元素残留的问题 */

/* 实时时钟 */
.head-clock {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #000;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.h-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  color: #000;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.2s, color 0.2s;
}
.h-btn:hover {
  background: var(--art-hover-color);
}
.ml-extra {
  margin-left: 12px;
}
.refresh-btn:hover {
  animation: rotate180 0.5s;
}
@keyframes rotate180 {
  from { transform: rotate(0); }
  to { transform: rotate(180deg); }
}

.crumb {
  font-size: 14px;
}
.crumb :deep(.el-breadcrumb__inner) {
  color: var(--art-gray-600);
}
.crumb :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--art-gray-900);
}

.h-spacer {
  flex: 1;
}

.h-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 图标上的小圆点 */
.icon-wrap {
  position: relative;
}
.head-dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.dot-danger {
  background: var(--el-color-danger, #f56c6c);
}
.dot-success {
  background: var(--el-color-success, #67c23a);
}
.breathing {
  animation: breathing 1.5s ease-in-out infinite;
}
@keyframes breathing {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}

/* 头像 */
.h-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--theme-color), var(--el-color-primary-light-5));
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

#app-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.layout-content {
  /* padding: 20px; */
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.page-content {
  flex: 1 1 auto;
  min-height: 0;
  padding: 20px;
  /* 全站打通白色容器：透出 body 视口级工业底图（磨砂卡片直接对底图模糊） */
  background: transparent;
  border: none;
  border-radius: calc(var(--custom-radius) / 2 + 2px);
}

/* 页面整体切换动效：旧页快速上浮退场（150ms），新页从下方带轻微缩放落定（360ms），
   形成「整体更换」的方向感；只动 transform/opacity，时长缓动走全局 token */
.fade-enter-active {
  transition:
    opacity var(--motion-slow) var(--ease-standard),
    transform var(--motion-slow) var(--ease-standard);
}
.fade-leave-active {
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(18px) scale(0.99);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.995);
}
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
  .fade-enter-from,
  .fade-leave-to {
    transform: none;
  }
}

/* ===== 响应式：平板隐藏实时时钟；手机收紧顶栏与内容留白 ===== */
@media only screen and (max-width: 1024px) {
  .head-clock {
    display: none;
  }
}
@media only screen and (max-width: 768px) {
  #app-header {
    gap: 10px;
    padding: 0 12px;
  }
  .head-title .page-name {
    font-size: 15px;
  }
  .ml-extra {
    margin-left: 4px;
  }
  .page-content {
    padding: 12px;
  }

  /* 侧栏抽屉化：脱离文档流，默认隐藏在左屏外，抽屉内始终展开完整菜单 */
  #app-sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    height: 100dvh;
    z-index: 2200;
    /* 手机也保持四边16px，抽屉滑出时阴影跟随面板而非全屏遮罩 */
    transform: translateX(calc(-100% - 18px));
    transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  #app-sidebar.drawer-open {
    transform: translateX(0);
  }
  #app-sidebar .layout-sidebar,
  #app-sidebar .layout-sidebar.is-collapsed {
    width: 210px;
    height: 100%;
    box-shadow:
      0 2px 5px rgb(33 68 102 / 3.2%),
      0 9px 24px rgb(33 68 102 / 5.2%),
      0 24px 50px rgb(33 68 102 / 3.2%),
      inset 0 1px 0 rgb(255 255 255 / 58%);
  }
  .sidebar-mask {
    position: fixed;
    inset: 0;
    z-index: 2190;
    background: rgb(15 32 55 / 32%);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
}
</style>

<!-- 弹层内容（teleport 到 body，需非 scoped） -->
<style>
.art-head-popover {
  border-radius: calc(var(--custom-radius) / 2 + 4px) !important;
}

/* 通知面板 */
.notice-panel .panel-head {
  margin: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--art-gray-900);
  border-bottom: 1px solid var(--art-card-border);
}
.panel-mark {
  font-size: 12px;
  font-weight: 400;
  color: var(--art-gray-500);
  cursor: pointer;
}
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 0 18px;
  color: var(--art-gray-400);
}
.panel-empty p {
  margin: 0;
  font-size: 13px;
}

/* 通知列表 */
.notice-list {
  max-height: 380px;
  overflow-y: auto;
  margin-top: 6px;
}
.notice-item {
  display: flex;
  gap: 10px;
  padding: 12px 8px;
  margin-bottom: 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.notice-item:last-child {
  margin-bottom: 0;
}
.notice-item:hover {
  background: var(--art-gray-100);
}
.notice-item.unread {
  background: rgba(64, 158, 255, 0.06);
}
.notice-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
}
.dot-alarm { background: #f56c6c; }
.dot-repair { background: #e6a23c; }
.dot-inspection { background: #67c23a; }
.dot-dispatch { background: #409eff; }
.dot-default { background: #909399; }
.notice-body {
  flex: 1;
  min-width: 0;
}
.notice-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--art-gray-900);
  display: flex;
  align-items: center;
  gap: 6px;
}
.notice-title .new-tag {
  font-size: 10px;
  background: #f56c6c;
  color: #fff;
  padding: 1px 4px;
  border-radius: 3px;
  line-height: 1.4;
}
.notice-content {
  font-size: 12px;
  color: var(--art-gray-600);
  margin-top: 3px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.notice-time {
  font-size: 11px;
  color: var(--art-gray-400);
  margin-top: 4px;
}
.head-dot.has-num {
  width: auto;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  color: #fff;
  top: 2px;
  right: 2px;
  border-radius: 8px;
}

/* 用户卡片 */
.user-card {
  padding-top: 8px;
}
.uc-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 6px;
}
.uc-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--theme-color), var(--el-color-primary-light-5));
  color: #fff;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.uc-info {
  min-width: 0;
}
.uc-name {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--art-gray-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.uc-sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--art-gray-500);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.uc-divider {
  height: 1px;
  margin: 10px 0;
  background: var(--art-card-border);
}
.uc-logout {
  padding: 7px 0;
  margin-bottom: 6px;
  font-size: 12px;
  text-align: center;
  color: var(--art-gray-700);
  border: 1px solid var(--art-gray-400);
  border-radius: calc(var(--custom-radius) / 2 + 2px);
  cursor: pointer;
  transition: all 0.2s;
}
.uc-logout:hover {
  color: var(--el-color-danger, #f56c6c);
  border-color: var(--el-color-danger, #f56c6c);
}
</style>

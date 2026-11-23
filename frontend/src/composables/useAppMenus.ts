import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchMyMenus } from '@/api/system'
import type { MenuNode } from '@/api/types'
import { useUserStore } from '@/stores/user'
import { tanggangMenus, type TanggangNavItem } from '@/modules/tanggang/business/menu'

/**
 * 唐港左右导航使用同一份 tanggangMenus，避免5175旧菜单与唐港首页七大模块不一致。
 * 原后台菜单仍作为功能可见性授权来源，前端导航绝不替代后端实际鉴权。
 */
export function useAppMenus() {
  const route = useRoute()
  const userStore = useUserStore()
  const serverMenus = ref<MenuNode[]>([])
  const hasServerMenuSnapshot = ref(false)
  const loading = ref(false)

  const active = computed(() => route.path)
  const pageTitle = computed(() => route.meta.hideHeaderTitle ? '' : (route.meta.title as string) || '工作台')

  const grantedPaths = computed(() => {
    const paths = new Set<string>()
    const visit = (list: MenuNode[]) => {
      for (const node of list) {
        if (node.path?.startsWith('/')) paths.add(node.path)
        if (node.children?.length) visit(node.children)
      }
    }
    visit(serverMenus.value)
    return paths
  })
  function canOpen(item: TanggangNavItem): boolean {
    if (!item.permission) return true
    if (!userStore.perms.includes(item.permission)) return false
    return !hasServerMenuSnapshot.value || grantedPaths.value.has(item.path)
  }
  const tanggangVisibleItems = computed<TanggangNavItem[]>(() =>
    tanggangMenus.map((item) => ({
      ...item,
      children: item.children?.filter(canOpen),
    })).filter((item) => item.id !== 'system' || Boolean(item.children?.length)),
  )

  const menus = computed<MenuNode[]>(() =>
    tanggangVisibleItems.value.map((item, idx) => {
      const id = idx + 1
      // 父级索引不同于叶子路径，避免Element Plus高亮与菜单展开冲突。
      return {
        id,
        name: item.title,
        path: item.children?.length ? 'tg-group-' + item.id : item.path,
        icon: item.icon,
        component: null,
        parent_id: 0,
        sort: id,
        menu_type: item.children?.length ? 'directory' : 'menu',
        perms: item.permission ?? null,
        children: item.children?.map((child, childIdx) => ({
          id: id * 100 + childIdx + 1,
          name: child.title,
          path: child.path,
          icon: child.icon,
          component: null,
          parent_id: id,
          sort: childIdx + 1,
          menu_type: 'menu',
          perms: child.permission ?? null,
        })),
      }
    }),
  )
  const opened = computed(() =>
    menus.value.filter((m) => m.children?.length).map((m) => m.path || String(m.id)),
  )
  const topLevelMenus = computed(() => menus.value)

  async function loadMenus() {
    loading.value = true
    try {
      const { data } = await fetchMyMenus()
      serverMenus.value = data.data || []
      hasServerMenuSnapshot.value = true
    } catch (e) {
      hasServerMenuSnapshot.value = false
      console.warn('唐港导航：无法同步后端菜单，按当前登录权限显示入口', e)
    } finally {
      loading.value = false
    }
  }

  function onMenusChanged() {
    void loadMenus()
    if (userStore.token) void userStore.fetchMe()
  }

  let lastSyncAt = 0
  function onVisible() {
    if (document.visibilityState !== 'visible' || !userStore.token) return
    const now = Date.now()
    if (now - lastSyncAt < 10_000) return
    lastSyncAt = now
    void userStore.fetchMe()
    void loadMenus()
  }
  onMounted(() => {
    void loadMenus()
    window.addEventListener('app:menus-changed', onMenusChanged)
    document.addEventListener('visibilitychange', onVisible)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('app:menus-changed', onMenusChanged)
    document.removeEventListener('visibilitychange', onVisible)
  })
  return {
    menus,
    tanggangVisibleItems,
    loading,
    active,
    pageTitle,
    opened,
    topLevelMenus,
    loadMenus,
  }
}

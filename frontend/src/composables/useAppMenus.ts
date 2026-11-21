import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchMyMenus } from '@/api/system'
import type { MenuNode } from '@/api/types'
import { useUserStore } from '@/stores/user'

/** 智能助手已改为右下角浮动入口，不再作为菜单展示 */
function stripFloatingAiMenus(list: MenuNode[]): MenuNode[] {
  return list
    .filter((m) => m.component !== 'ai/chat')
    .map((m) =>
      m.children
        ? { ...m, children: stripFloatingAiMenus(m.children) }
        : m,
    )
}

export function useAppMenus() {
  const route = useRoute()
  const menus = ref<MenuNode[]>([])
  const loading = ref(false)

  const active = computed(() => route.path)
  const pageTitle = computed(() => (route.meta.title as string) || '工作台')
  const opened = computed(() =>
    menus.value.filter((m) => m.children?.length).map((m) => m.path || String(m.id)),
  )

  /** 扁平一级菜单（slate 顶栏用） */
  const topLevelMenus = computed(() => menus.value)

  async function loadMenus() {
    loading.value = true
    try {
      const { data } = await fetchMyMenus()
      menus.value = stripFloatingAiMenus(data.data || [])
    } finally {
      loading.value = false
    }
  }

  /**
   * 权限/菜单数据变更（菜单管理/角色授权保存后）：
   * - 重新拉取侧边栏菜单
   * - 同步当前登录用户的按钮权限快照（/auth/me），否则 v-if="hasPerm(...)"
   *   会一直沿用登录时的旧 perms，表现为「权限已收回但按钮还在」
   */
  function onMenusChanged() {
    loadMenus()
    const userStore = useUserStore()
    if (userStore.token) void userStore.fetchMe()
  }

  /**
   * 跨会话兜底：管理员在其他会话改动了当前用户的角色/权限时，
   * 当前标签页重新获得焦点即静默重拉权限与菜单（10s 节流），无需对方重新登录。
   * 后端接口每次请求都按 DB 实时鉴权，这里只影响显隐，不改变安全边界。
   * 注意：菜单（loadMenus）与按钮权限（fetchMe）必须一起刷新——
   * 只刷 perms 不刷 menus 会导致「角色已收回某菜单，但侧边栏仍显示」。
   */
  let lastSyncAt = 0
  function onVisible() {
    if (document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - lastSyncAt < 10_000) return
    lastSyncAt = now
    const userStore = useUserStore()
    if (userStore.token) {
      void userStore.fetchMe()
      void loadMenus()
    }
  }

  onMounted(() => {
    loadMenus()
    window.addEventListener('app:menus-changed', onMenusChanged)
    document.addEventListener('visibilitychange', onVisible)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('app:menus-changed', onMenusChanged)
    document.removeEventListener('visibilitychange', onVisible)
  })

  return {
    menus,
    loading,
    active,
    pageTitle,
    opened,
    topLevelMenus,
    loadMenus,
  }
}

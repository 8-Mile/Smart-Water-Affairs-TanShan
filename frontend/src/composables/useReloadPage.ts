import { onMounted, onScopeDispose } from 'vue'

/**
 * 监听消息通知"同页跳转"触发的全局刷新事件。
 * 已在 EmberLayout 中：点击通知且目标路径 === 当前路由时 dispatch('app:reload-page')
 * 各业务页面在 onMounted 后用 useReloadPage(load) 绑定 reload 回调即可。
 */
export function useReloadPage(reload: () => void) {
  function handler() {
    reload()
  }
  onMounted(() => {
    window.addEventListener('app:reload-page', handler)
  })
  onScopeDispose(() => {
    window.removeEventListener('app:reload-page', handler)
  })
}

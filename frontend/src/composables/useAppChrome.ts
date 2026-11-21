import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { getAppTitle } from '@/themes/applyTheme'

export function useAppChrome() {
  const router = useRouter()
  const user = useUserStore()
  const appTitle = getAppTitle()

  function onLogout() {
    user.logout()
    router.push({ name: 'login' })
  }

  return {
    user,
    appTitle,
    displayName: user.displayName,
    onLogout,
  }
}

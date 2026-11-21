import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loginApi, meApi, type UserInfo } from '@/api/auth'

const TOKEN_KEY = 'water_ops_token'

export const useUserStore = defineStore('user', () => {
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) || '')
  const profile = ref<UserInfo | null>(null)
  const perms = ref<string[]>([])

  const isLoggedIn = computed(() => Boolean(token.value))
  const displayName = computed(
    () => profile.value?.display_name || profile.value?.username || '',
  )

  function setToken(value: string) {
    token.value = value
    if (value) {
      localStorage.setItem(TOKEN_KEY, value)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  async function login(username: string, password: string) {
    const { data } = await loginApi(username, password)
    setToken(data.data.access_token)
    profile.value = data.data.user
    perms.value = data.data.user.perms || []
    return data.data.user
  }

  async function fetchMe() {
    if (!token.value) return null
    const { data } = await meApi()
    profile.value = data.data
    perms.value = data.data.perms || []
    return data.data
  }

  function logout() {
    setToken('')
    profile.value = null
    perms.value = []
  }

  return {
    token,
    profile,
    perms,
    isLoggedIn,
    displayName,
    login,
    fetchMe,
    logout,
    setToken,
  }
})

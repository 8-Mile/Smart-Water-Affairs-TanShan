<template>
  <div class="exception-page">
    <!-- 顶部品牌栏 -->
    <header class="brand-bar">
      <div class="brand">
        <img class="brand-logo" :src="logo" alt="logo" />
        <span class="brand-name">运维管理平台</span>
      </div>
    </header>

    <!-- 主体：左插画 + 右文案 -->
    <main class="exception-body">
      <div class="illus">
        <img :src="imgUrl" alt="" />
      </div>
      <div class="content">
        <h1 class="title">{{ title }}</h1>
        <p v-if="desc" class="desc">{{ desc }}</p>
        <div class="actions">
          <el-button
            v-if="showHome"
            type="primary"
            size="large"
            class="btn-home"
            @click="goHome"
          >
            <el-icon class="btn-icon"><HomeFilled /></el-icon>
            返回首页
          </el-button>
          <el-button
            v-if="showRefresh"
            size="large"
            class="btn-refresh"
            :loading="probing"
            @click="refresh"
          >
            <el-icon v-if="!probing" class="btn-icon"><RefreshRight /></el-icon>
            {{ refreshProbe ? '重试返回首页' : '重新刷新' }}
          </el-button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import { HomeFilled, RefreshRight } from '@element-plus/icons-vue'
  import { useRouter } from 'vue-router'
  import logo from '@/assets/img/DALOGO.webp'
  import { usePermissions } from '@/utils/permissions'
  import { useUserStore } from '@/stores/user'

  const router = useRouter()
  const perms = usePermissions()

  const props = withDefaults(
    defineProps<{
      /** 插画图片（assets/exception 下的 svg） */
      imgUrl: string
      /** 主标题，如「暂无访问权限」 */
      title: string
      /** 副标题说明文案（可选） */
      desc?: string
      /** 是否显示「返回首页」按钮（403/404 用；500 页不显示——服务异常时跳首页会被再次弹回） */
      showHome?: boolean
      /** 是否显示「重新刷新」按钮（500 页专用） */
      showRefresh?: boolean
      /** 探测模式：刷新前先探测后端是否恢复，恢复则跳首页，未恢复留在本页并提示（500 页专用） */
      refreshProbe?: boolean
    }>(),
    { showHome: true, showRefresh: true, refreshProbe: false },
  )

  const probing = ref(false)

  function goHome() {
    // 站点首页为 /dashboard（唐港港区总览，无页面级权限码），优先回到首页
    if (router.hasRoute('dashboard')) {
      router.replace({ name: 'dashboard' })
      return
    }
    // 仅跳转到当前用户确有权限的页面，避免首页不可达时再次被守卫弹回 403，形成死循环
    const candidates = router.getRoutes().filter((r) => {
      const perm = r.meta?.perm as string | undefined
      return typeof r.name === 'string' && !!perm && perms.hasPerm(perm)
    })
    const home = candidates.find((r) => r.name === 'dashboard') ?? candidates[0]
    if (home?.name) {
      router.replace({ name: home.name })
      return
    }
    // 无任何可访问页面：退回登录，给出明确出口
    useUserStore().logout()
    window.location.href = '/login'
  }

  /**
   * 刷新。探测模式（500 页）：先探测后端是否恢复——
   * 任一正常应答（含 401/403，说明服务已恢复响应）即跳转首页；
   * 仍 5xx 或网络不通则提示并留在本页，避免用户跳过去又被打回 500。
   */
  async function refresh() {
    if (!props.refreshProbe) {
      window.location.reload()
      return
    }
    if (probing.value) return
    probing.value = true
    try {
      const res = await fetch('/api/v1/auth/me', { cache: 'no-store' })
      if (res.status < 500) {
        window.location.href = '/'
        return
      }
      ElMessage.warning('服务尚未恢复，请稍后重试')
    } catch {
      ElMessage.warning('服务尚未恢复，请检查网络后重试')
    } finally {
      probing.value = false
    }
  }
</script>

<style scoped>
  .exception-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #ffffff 0%, #f4f8fd 100%);
  }

  .brand-bar {
    height: 56px;
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 20px;
    background: #ffffff;
    border-bottom: 1px solid #eef2f7;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .brand-logo {
    width: 26px;
    height: 26px;
    object-fit: contain;
  }

  .brand-name {
    font-size: 16px;
    font-weight: 600;
    color: #1f2d3d;
    letter-spacing: 0.5px;
  }

  .exception-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 48px;
    padding: 32px 6vw;
  }

  .illus {
    flex: 1.1;
    max-width: 560px;
  }

  .illus img {
    width: 100%;
    height: auto;
    display: block;
    user-select: none;
  }

  .content {
    flex: 1;
    max-width: 460px;
  }

  .title {
    margin: 0 0 14px;
    font-size: 40px;
    line-height: 1.25;
    font-weight: 700;
    color: #17233d;
    letter-spacing: 1px;
  }

  .desc {
    margin: 0 0 32px;
    font-size: 15px;
    line-height: 1.7;
    color: #7b8798;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .btn-home {
    min-width: 128px;
    border-radius: 8px;
  }

  .btn-refresh {
    min-width: 128px;
    border-radius: 8px;
  }

  .btn-icon {
    margin-right: 6px;
  }

  @media only screen and (max-width: 1024px) {
    .exception-body {
      flex-direction: column;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }

    .illus {
      max-width: 420px;
    }

    .title {
      font-size: 30px;
    }

    .actions {
      justify-content: center;
    }
  }
</style>

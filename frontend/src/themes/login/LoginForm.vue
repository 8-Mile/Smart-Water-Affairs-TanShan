<template>
  <el-form
    ref="formRef"
    :model="form"
    :rules="rules"
    label-position="top"
    @submit.prevent
  >
    <!-- 用户名 -->
    <el-form-item prop="username" class="form-row">
      <el-input
        v-model="form.username"
        placeholder="请输入用户名"
        size="large"
        class="login-input"
        @keyup.enter="onSubmit"
      >
        <template #prefix>
          <ArtSvgIcon icon="ri:user-line" class="prefix-icon" />
        </template>
      </el-input>
    </el-form-item>

    <!-- 密码 -->
    <el-form-item prop="password" class="form-row">
      <el-input
        v-model="form.password"
        type="password"
        show-password
        placeholder="请输入密码"
        size="large"
        class="login-input"
        @keyup.enter="onSubmit"
      >
        <template #prefix>
          <ArtSvgIcon icon="ri:lock-line" class="prefix-icon" />
        </template>
      </el-input>
    </el-form-item>

    <!-- 登录按钮 -->
    <el-button
      type="primary"
      size="large"
      class="submit-btn"
      :loading="loading"
      @click="onSubmit"
    >
      登 录
    </el-button>
  </el-form>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'

const REMEMBER_KEY = 'login_remember_info'

const router = useRouter()
const route = useRoute()
const user = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  username: '',
  password: '',
  remember: false,
  autoLogin: false,
})

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

/* ---------- 记住密码（逻辑保留，设计图无勾选项时不启用） ---------- */
function saveRemember() {
  if (form.remember) {
    localStorage.setItem(
      REMEMBER_KEY,
      JSON.stringify({ username: form.username, password: form.password }),
    )
  } else {
    localStorage.removeItem(REMEMBER_KEY)
  }
}
function loadRemember() {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      form.username = data.username || ''
      form.password = data.password || ''
      form.remember = true
    }
  } catch {
    // ignore
  }
}

/* ---------- 提交 ---------- */
async function onSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saveRemember()
  loading.value = true
  try {
    await user.login(form.username, form.password)
    ElMessage.success('登录成功')
    const redirect = (route.query.redirect as string) || '/dashboard'
    router.replace(redirect)
  } catch {
    // 错误已由拦截器提示
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadRemember()
})
</script>

<style lang="scss" scoped>
.form-row {
  margin-bottom: 22px;
}

.login-input {
  :deep(.el-input__wrapper) {
    height: 54px;
    padding: 0 18px;
    border-radius: 14px;
    background: #fff;
    box-shadow: 0 0 0 1px #e3eaf5 inset;
    transition: box-shadow 0.15s;
  }
  :deep(.el-input__inner) {
    font-size: 15px;
    color: #1f3b6b;

    &::placeholder {
      color: #9aaac4;
    }
  }
  :deep(.el-input__wrapper.is-focus) {
    box-shadow: 0 0 0 1px var(--el-color-primary) inset;
  }
  /* 密码显隐眼睛图标 */
  :deep(.el-input__suffix-inner .el-icon) {
    color: #5a6f95;
    font-size: 18px;
  }
  /* 覆盖浏览器自动填充黑底 */
  :deep(input:-webkit-autofill),
  :deep(input:-webkit-autofill:hover),
  :deep(input:-webkit-autofill:focus) {
    -webkit-text-fill-color: #1f3b6b !important;
    -webkit-box-shadow: 0 0 0 1000px #fff inset !important;
    transition: background-color 5000s ease-in-out 0s;
    caret-color: #1f3b6b;
  }
}

.prefix-icon {
  color: #3b82f6;
  font-size: 20px;
  margin-right: 4px;
}

.submit-btn {
  width: 100%;
  height: 54px;
  margin-top: 10px;
  border: none;
  border-radius: 14px;
  font-size: 19px;
  font-weight: 500;
  letter-spacing: 8px;
  text-indent: 8px;
  color: #fff;
  background: linear-gradient(90deg, #2f8dff 0%, #4a6bff 100%);
  box-shadow: 0 8px 18px rgba(47, 141, 255, 0.28);
  transition: filter 0.15s, box-shadow 0.15s;

  &:hover,
  &:focus {
    color: #fff;
    background: linear-gradient(90deg, #2f8dff 0%, #4a6bff 100%);
    filter: brightness(1.05);
    box-shadow: 0 10px 22px rgba(47, 141, 255, 0.36);
  }
}
</style>

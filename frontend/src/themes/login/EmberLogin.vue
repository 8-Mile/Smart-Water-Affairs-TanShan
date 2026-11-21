<template>
  <div class="login-page">
    <!-- 左上品牌区 -->
    <div class="brand-area">
      <div class="brand-head">
        <img class="brand-logo" :src="logo" alt="logo" />
        <div class="brand-titles">
          <h1 class="brand-name">智慧泵站生产运维管理平台</h1>
          <p class="brand-en">INTELLIGENT PUMP STATION OPERATION AND MAINTENANCE PLATFORM</p>
        </div>
      </div>
      <p class="brand-slogan">智 · 慧 · 运 · 维&nbsp;&nbsp;&nbsp;｜&nbsp;&nbsp;&nbsp;守 · 护 · 水 · 安</p>
    </div>

    <!-- 右侧登录卡片（背景即 logobg.webp：圆角描边/飘带/桥梁城市波浪均为图内元素） -->
    <div class="login-card">
      <div class="card-titles">
        <h2 class="welcome">欢迎登录</h2>
        <p class="sub">智慧泵站生产运维管理平台</p>
      </div>

      <LoginForm />
    </div>
  </div>
</template>

<script setup lang="ts">
import logo from '@/assets/img/DALOGO.webp'
import LoginForm from './LoginForm.vue'
</script>

<style lang="scss" scoped>
@use '@styles/core/breakpoints.scss' as bp;
.login-page {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background-color: #eef4fb;
  background-image: url('@/assets/img/bg.webp');
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
}

/* ===== 左上品牌区 ===== */
.brand-area {
  position: absolute;
  top: 12%;
  left: 8.5%;
  z-index: 10;
}
.brand-head {
  display: flex;
  align-items: center;
  gap: 18px;
}
.brand-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
.brand-titles {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.brand-name {
  margin: 0;
  font-size: 38px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 2px;
  color: #143c7e;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.45);
}
.brand-en {
  margin: 0;
  font-size: 13px;
  letter-spacing: 1.2px;
  color: #5476a6;
}
.brand-slogan {
  margin: 34px 0 0;
  padding-left: 6px;
  font-size: 18px;
  letter-spacing: 4px;
  color: #6482ab;
}

/* ===== 右侧登录卡片 ===== */
.login-card {
  position: absolute;
  top: 50%;
  right: 6%;
  transform: translateY(-50%);
  z-index: 10;
  width: 520px;
  /* 锁定与 logobg.webp 原图一致的宽高比，避免背景图拉伸变形 */
  aspect-ratio: 1122 / 1402;
  /* 卡片视觉（圆角/浅蓝底/描边高光/底部波浪桥梁城市）全部来自 logobg.webp */
  background-image: url('@/assets/img/logobg.webp');
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
  /* 顶部内容起始位对齐设计图，底部空间留给图内波浪装饰 */
  padding: 112px 68px 0;
  box-sizing: border-box;
}

.card-titles {
  margin-bottom: 38px;

  .welcome {
    margin: 0;
    font-size: 32px;
    font-weight: 700;
    color: #163a7c;
    line-height: 1.3;
  }
  .sub {
    margin: 12px 0 0;
    font-size: 18px;
    color: #48699c;
  }
}

/* ===== 响应式：窄屏卡片居中、品牌区精简 ===== */
@include bp.respond(tablet) {
  .brand-name {
    font-size: 30px;
  }
  .brand-en {
    font-size: 11px;
  }
  .login-card {
    right: 50%;
    transform: translate(50%, -50%);
  }
}
@include bp.respond(mobile) {
  .brand-area {
    top: 24px;
    left: 24px;
    right: 24px;
  }
  .brand-logo {
    width: 44px;
    height: 44px;
  }
  .brand-name {
    font-size: 22px;
    letter-spacing: 1px;
  }
  .brand-en,
  .brand-slogan {
    display: none;
  }
  .login-card {
    top: 52%;
    width: calc(100vw - 48px);
    max-width: 420px;
    padding: 80px 44px 0;
  }
}
</style>

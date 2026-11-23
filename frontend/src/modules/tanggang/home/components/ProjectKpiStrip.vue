<script setup lang="ts">
/**
 * 场景顶部「项目概况」指标条。
 * 与左侧信息卡同排，利用场景上方空余区域，形成完整的页面骨架。
 */
const stats = [
  { label: '覆盖泊位', value: '2', unit: '个', note: '51 / 52 号' },
  { label: '业务子系统', value: '6', unit: '个', note: '独立工艺入口' },
  { label: '集水池', value: '2 / 5', unit: '座', note: '北池 / 南池（设计）' },
  { label: '管网图层', value: '7', unit: '类', note: '除尘 · 给排水 · 消防' },
] as const
</script>

<template>
  <div class="tg-kpi-strip" aria-label="项目概况">
    <div class="tg-kpi-lead">
      <b>项目概况</b>
      <small>PROJECT OVERVIEW</small>
    </div>
    <div v-for="s in stats" :key="s.label" class="tg-kpi-cell">
      <span>{{ s.label }}</span>
      <strong>{{ s.value }}<em>{{ s.unit }}</em></strong>
      <i>{{ s.note }}</i>
    </div>
  </div>
</template>

<style scoped>
.tg-kpi-strip {
  position: absolute;
  z-index: 6;
  top: 16px;
  left: calc(var(--tg-left-card-w, 320px) + 32px);
  display: flex;
  align-items: stretch;
  max-width: min(720px, calc(100% - var(--tg-left-card-w, 320px) - 176px));
  padding: 9px 4px;
  pointer-events: auto;
  border: 1px solid var(--tg-glass-border, rgba(255, 255, 255, 0.74));
  border-radius: 16px;
  background: var(--tg-glass-surface, linear-gradient(150deg, rgba(255, 255, 255, 0.84) 0%, rgba(244, 250, 255, 0.73) 49%, rgba(231, 242, 251, 0.68) 100%));
  box-shadow: var(--tg-glass-shadow, 0 8px 25px rgba(39, 89, 135, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.6));
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  backdrop-filter: blur(14px) saturate(1.3);
}

.tg-kpi-lead {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 0 15px;
  border-right: 1px solid rgba(203, 226, 238, 0.75);
}

.tg-kpi-lead b {
  font-size: 13px;
  font-weight: 700;
  color: #2b5a72;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.tg-kpi-lead small {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.13em;
  color: #8aa8b8;
  white-space: nowrap;
}

.tg-kpi-cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  min-width: 104px;
  padding: 0 16px;
  border-right: 1px solid rgba(203, 226, 238, 0.55);
}

.tg-kpi-cell:last-child {
  border-right: 0;
}

.tg-kpi-cell span {
  font-size: 9.5px;
  color: #7d98a8;
  white-space: nowrap;
}

.tg-kpi-cell strong {
  font-size: 20px;
  font-weight: 750;
  line-height: 1.15;
  color: #2f6f88;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tg-kpi-cell em {
  margin-left: 2px;
  font-style: normal;
  font-size: 9px;
  font-weight: 600;
  color: #7d98a8;
}

.tg-kpi-cell i {
  font-style: normal;
  font-size: 8.5px;
  color: #9aafbc;
  white-space: nowrap;
}

/* 与左侧卡片同步缩放 */
@media (min-width: 2200px) {
  .tg-kpi-strip {
    top: clamp(16px, 0.75vw, 32px);
    left: calc(clamp(330px, 15vw, 480px) + clamp(32px, 1.1vw, 48px));
    max-width: min(900px, calc(100% - clamp(330px, 15vw, 480px) - 220px));
    padding: clamp(9px, 0.38vw, 14px) clamp(4px, 0.17vw, 8px);
    border-radius: clamp(16px, 0.65vw, 24px);
  }
  .tg-kpi-lead {
    padding: 0 clamp(15px, 0.6vw, 24px);
  }
  .tg-kpi-lead b {
    font-size: clamp(13px, 0.52vw, 19px);
  }
  .tg-kpi-lead small {
    font-size: clamp(8px, 0.3vw, 12px);
  }
  .tg-kpi-cell {
    min-width: clamp(104px, 4.2vw, 160px);
    padding: 0 clamp(16px, 0.64vw, 26px);
  }
  .tg-kpi-cell span {
    font-size: clamp(9.5px, 0.36vw, 14px);
  }
  .tg-kpi-cell strong {
    font-size: clamp(20px, 0.8vw, 30px);
  }
  .tg-kpi-cell em,
  .tg-kpi-cell i {
    font-size: clamp(8.5px, 0.3vw, 12px);
  }
}

@media (min-width: 950px) and (max-width: 1199px) {
  .tg-kpi-cell {
    min-width: 82px;
    padding: 0 10px;
  }
  .tg-kpi-cell strong {
    font-size: 17px;
  }
  .tg-kpi-cell i {
    display: none;
  }
  .tg-kpi-lead {
    padding: 0 11px;
  }
}

@media (max-width: 949px) {
  .tg-kpi-strip {
    display: none;
  }
}
</style>

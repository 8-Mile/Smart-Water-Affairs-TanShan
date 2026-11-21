<script setup lang="ts">
import { computed,onMounted,ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElButton,ElInput } from 'element-plus'
import { loadTanggangCatalog,summarizeSystem,type TanggangCatalog } from '../mapping/tanggangCatalog'
import './business.css'
const router=useRouter()
const catalog=ref<TanggangCatalog|null>(null)
const pending=ref(true)
const error=ref('')
const keyword=ref('')
onMounted(async()=>{try{catalog.value=await loadTanggangCatalog()}catch(e){error.value=e instanceof Error?e.message:String(e)}finally{pending.value=false}})
const systems=computed(()=>catalog.value?.systems.filter(s=>s.name.includes(keyword.value)||s.intro.includes(keyword.value))??[])
</script>
<template>
  <main class="tg-biz page-fill">
    <div class="tg-biz-head">
      <div><h1>运行监测 · 六套专业系统</h1><p class="tg-biz-sub">按工程设计分系统查看设施、测点要求与数据接入状态；六系统共用统一港区空间底图</p></div>
      <div class="tg-biz-actions"><ElInput v-model="keyword" clearable placeholder="查找专业系统" style="width:180px"/><ElButton @click="router.push('/dashboard')">返回港区三维总览</ElButton></div>
    </div>
    <div class="tg-biz-note"><strong>数据口径：</strong>本页展示已迁移的设计系统清单与设施分类，不展示虚构的运行状态。CAD对象、设施与实际SCADA测点尚未全部绑定，在线率与告警数量在接入前不进行计算。</div>
    <div v-if="pending" class="tg-biz-empty">正在读取工程专业系统资料…</div>
    <div v-else-if="error" class="tg-biz-empty">工程资料读取失败：{{error}}</div>
    <div v-else class="tg-biz-grid">
      <section v-for="system in systems" :key="system.id" class="tg-biz-card art-card" data-clickable="true" role="link" tabindex="0" @click="router.push('/port/process/'+system.id)" @keydown.enter="router.push('/port/process/'+system.id)">
        <div class="tg-biz-card-head"><h3>{{system.name}}</h3><span class="tg-biz-chip">工程参考</span></div>
        <p>{{system.intro}}</p>
        <div class="tg-biz-list-row"><span class="tg-biz-label">设计关联设备项</span><strong>{{summarizeSystem(system,catalog!).designCategories}}</strong></div>
        <div class="tg-biz-list-row"><span class="tg-biz-label">尚未完成资产/测点关联</span><span class="tg-biz-chip warn">需厂家点表</span></div>
        <div class="tg-biz-link">查看系统详细信息 →</div>
      </section>
    </div>
    <section class="tg-biz-card art-card">
      <h2>六系统如何与首页三维场景协作</h2>
      <div class="tg-biz-steps"><span>首页选择工艺系统</span><b>→</b><span>Three.js聚焦关联设施与管线</span><b>→</b><span>进入专业监测</span><b>→</b><span>设备与测点详情</span><b>→</b><span>告警/工单处置</span></div>
      <p>空间聚焦和管道高亮由首页引擎提供，本页负责工艺与业务数据，不重复建立三维实体。控制权限仍由厂家PLC和原系统安全联锁约束。</p>
    </section>
  </main>
</template>

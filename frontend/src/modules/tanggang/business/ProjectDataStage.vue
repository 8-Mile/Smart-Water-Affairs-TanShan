<script setup lang="ts">
import {onMounted,ref} from 'vue'
import {fetchTanggangDataContext} from '@/api/tanggangProvenance'

/** Necessary business state, not a decorative explanatory label. Default safe. */
const description=ref('本系统仅依据用户上传资料与演示假设构建，尚无经确认的唐港现场监测数据。')
onMounted(async()=>{
  try{
    const result=await fetchTanggangDataContext()
    if(result.data.data.stage==='DOCUMENT_BASED_DEMO'){
      description.value=result.data.data.numeric_values_policy
    }
  }catch{
    // Fail closed: NEVER change the stage label to imply field data is live.
  }
})
</script>
<template>
  <span class="tg-data-stage" :title="description" aria-label="资料演示，非现场实测">资料演示</span>
</template>
<style scoped>
.tg-data-stage{
  display:inline-flex;align-items:center;justify-content:center;
  flex:0 0 auto;height:24px;padding:0 8px;border-radius:6px;
  background:rgba(125,140,160,.09);color:#697c8c;
  border:1px solid rgba(119,138,159,.16);font-size:11px;font-weight:600;
  white-space:nowrap;line-height:1;
}
@media(max-width:550px){.tg-data-stage{height:22px;padding:0 5px;font-size:10px}}
</style>

<script setup lang="ts">
import {computed,ref} from "vue";
import {NButton,NSelect,NTag} from "naive-ui";
import {
 allBasinRecords,basinRole,basinVolumes,
 PURPOSE_LABELS,type BasinRecord,type BasinRole,
} from "../demo/basinRegistry";
defineEmits<{use:[pool:BasinRecord]}>();
const poolRows=allBasinRecords(localStorage).filter(x=>!x.archived);
const role=ref<"polluted"|"clear">("polluted");
const poolId=ref("MOCK-POLLUTED-POOL");
const candidates=computed(()=>poolRows.filter(x=>basinRole(x.purpose)===role.value));
const pool=computed(()=>candidates.value.find(x=>x.id===poolId.value)??null);
const preview=computed(()=>pool.value?basinVolumes(pool.value):null);
function changeRole(next:BasinRole){
 if(next!=="polluted"&&next!=="clear")return;
 role.value=next;poolId.value=candidates.value[0]?.id??"";
}
</script>
<template>
 <section class="scenario-basins">
  <div class="scenario-header">
    <div><div class="eyebrow">V3.2 / 池体证据联动</div><h3>从逐池V-H曲线加载单池MOCK参数</h3>
      <p>只允许明确选择一座池作为本模型对应的污染池或清水池，不跨池叠加；未核实的实际池容和液位不会自动进入计算。</p></div>
    <NTag type="warning" size="small">真实池容尚未验收</NTag>
  </div>
  <div class="selectors">
    <label><span>目标模型</span><NSelect :value="role" size="small" :options="[{label:'污染水收集池（单池）',value:'polluted'},{label:'清水池（单池）',value:'clear'}]" @update:value="changeRole"/></label>
    <label><span>选择池体（未归档）</span><NSelect v-model:value="poolId" size="small" :options="candidates.map(x=>({label:x.code+' · '+x.name,value:x.id}))" placeholder="该类别暂无台账"/></label>
    <div v-if="pool" class="selected-pool">
      <strong>{{ pool.code }}</strong><span>{{ PURPOSE_LABELS[pool.purpose] }} · {{ pool.source==='MOCK'?'独立MOCK示例':'人工资料待核' }}</span>
    </div>
    <NButton size="small" type="primary" :disabled="!pool||preview?.mockInitialM3==null" @click="pool&&$emit('use',pool)">加载为MOCK情景</NButton>
  </div>
  <p v-if="pool" class="scenario-provenance">对应池号：{{ pool.code }} · {{ pool.name }}；资料来源：{{ pool.drawingRef }} / {{ pool.drawingVersion }}；假设有效库容 {{ preview?.effectiveCapacityM3.toFixed(1) }}m³，起始储量 {{ preview?.mockInitialM3==null?'未给定':preview.mockInitialM3.toFixed(1)+'m³' }}。这些值只是当前池体的模型插值，不是全港可用库容、真实液位或已确认管路。</p>
  <div class="scenario-link"><router-link to="/engineering/registry?focus=basins">打开逐池工程台账 / V-H曲线与测点核查 →</router-link><router-link to="/engineering/registry?item=CK-007">CK-007 逐池有效库容核查 →</router-link></div>
 </section>
</template>
<style scoped>
.scenario-basins{border:1px solid #dbe9f0;border-radius:10px;background:#fff;padding:16px 18px;display:grid;gap:10px}
.scenario-header{display:flex;justify-content:space-between;gap:12px;align-items:start}
.eyebrow{font-size:10px;color:#87aab8;letter-spacing:.06em}
.scenario-header h3{font-size:15px;color:#30758f;margin:7px 0}.scenario-header p{font-size:11px;color:#8da6b2;line-height:1.7;margin:0}
.selectors{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(220px,1.4fr) minmax(160px,.8fr) auto;gap:10px;align-items:end}
.selectors label{display:grid;gap:7px;min-width:0}.selectors label>span{font-size:11px;color:#789aab}
.selected-pool{display:grid;gap:5px;padding-bottom:4px}.selected-pool strong{font-size:12px;color:#417e96}.selected-pool span{font-size:10px;color:#9cabb4}
.scenario-provenance{font-size:11px;line-height:1.75;color:#9b8867;background:#fffaf1;padding:9px 11px;border-radius:6px;margin:0}
.scenario-link{display:flex;flex-wrap:wrap;gap:12px}.scenario-link a{font-size:11px;color:#2b83a2;text-decoration:none}
@media(max-width:1100px){.selectors{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:650px){.selectors{grid-template-columns:1fr}.scenario-header{display:grid}}
</style>

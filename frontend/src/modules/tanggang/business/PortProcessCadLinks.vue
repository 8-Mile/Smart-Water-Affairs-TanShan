<script setup lang="ts">
import {computed} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {relationsForProcess,relationFor} from './cadWaterTrace'

const props=defineProps<{systemId:string}>()
const route=useRoute(),router=useRouter()
const relations=computed(()=>relationsForProcess(props.systemId))
const focus=computed(()=>{
  const q=route.query.cad_relation
  const selected=typeof q==='string'?relationFor(q):null
  return selected&&relations.value.some(x=>x.id===selected.id)?selected.id:null
})
function openRelation(id:string){
  void router.push({path:'/port/water/supply',query:{cad_relation:id}})
}
</script>

<template>
  <section v-if="relations.length" class="tg-proc-cad"
    data-testid="process-cad-relations">
    <div class="tg-proc-cad-head">
      <div>
        <strong>关联 CAD 水路</strong>
        <small>仅设计关联，不表示物理管道已核验</small>
      </div>
      <button type="button" @click="openRelation(focus||relations[0]!.id)">
        回到水路与 CAD
      </button>
    </div>
    <button v-if="focus" class="tg-proc-cad-focused"
      data-testid="process-cad-focused" @click="openRelation(focus)">
      来自CAD关系：{{relations.find(x=>x.id===focus)?.label}} · 返回原关系
    </button>
    <div class="tg-proc-cad-links">
      <button v-for="rel in relations.slice(0,4)" :key="rel.id" type="button"
        :data-cad-relation="rel.id" :class="{focused:focus===rel.id}"
        @click="openRelation(rel.id)">
        <span>{{rel.label}}</span>
        <small>{{rel.status==='alternative'?'备选':
          rel.status==='conditional'?'有条件':
          rel.status==='cad_note'?'设计注记':'设计关系'}}</small>
      </button>
    </div>
    <details v-if="relations.length>4" class="tg-proc-cad-more">
      <summary>查看更多关联（{{relations.length-4}}）</summary>
      <div class="tg-proc-cad-links">
        <button v-for="rel in relations.slice(4)" :key="rel.id" type="button"
          :data-cad-relation="rel.id" :class="{focused:focus===rel.id}"
          @click="openRelation(rel.id)">
          <span>{{rel.label}}</span>
          <small>{{rel.id}}</small>
        </button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.tg-proc-cad{border:1px solid var(--art-card-border,#dceaf1);
  background:var(--default-box-color,rgba(255,255,255,.86));
  border-radius:11px;padding:13px 16px;min-width:0}
.tg-proc-cad-head{display:flex;gap:12px;align-items:center;
  justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}
.tg-proc-cad-head>div{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.tg-proc-cad-head strong{font-size:13px;color:#406e86}
.tg-proc-cad-head small{font-size:10px;color:#98a7b0}
.tg-proc-cad-head>button{font:inherit;font-size:11px;border:1px solid #d5e7ef;
  background:#f6fbfd;color:#3c809b;padding:6px 10px;border-radius:6px;cursor:pointer}
.tg-proc-cad-focused{display:block;text-align:left;width:100%;font:inherit;font-size:11px;
  background:#eaf6fa;color:#327f9c;border:1px solid #afd9e9;border-radius:6px;
  padding:9px 11px;margin-bottom:9px;cursor:pointer}
.tg-proc-cad-links{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.tg-proc-cad-links>button{border:1px solid #dfeaf0;border-radius:6px;
  padding:10px 11px;background:#f8fbfd;cursor:pointer;
  display:flex;flex-direction:column;align-items:flex-start;gap:5px;text-align:left;
  font:inherit;min-width:0}
.tg-proc-cad-links>button.focused{background:#e8f5fb;border-color:#63a9c8}
.tg-proc-cad-links span{font-size:11px;color:#4e788e;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;max-width:100%}
.tg-proc-cad-links small{font-size:10px;color:#9a9fa4}
.tg-proc-cad-more{margin-top:9px}
.tg-proc-cad-more summary{font-size:11px;color:#6c8fa3;cursor:pointer;margin-bottom:9px}
@media(max-width:1120px){.tg-proc-cad-links{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:550px){.tg-proc-cad-links{grid-template-columns:1fr}}
</style>

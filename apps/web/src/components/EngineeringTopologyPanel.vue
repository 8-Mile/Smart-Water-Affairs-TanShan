<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NTag } from "naive-ui";
import { readEngineeringReviews, engineeringEntry, ENGINEERING_STATUS_LABELS } from "../demo/engineering";
import {
  topologyCases,topologySummary,RELATION_STATUS,
  type EngineeringLayer,type EngineeringRelationStatus,
} from "../demo/engineeringTopology";
const props=withDefaults(defineProps<{scope?:"all"|"environment"|"supply"|"control";compact?:boolean}>(),{
 scope:"all",compact:false,
});
const reviews=ref(readEngineeringReviews(localStorage));
onMounted(()=>{reviews.value=readEngineeringReviews(localStorage);});
const layer=ref<"all"|EngineeringLayer>("all");
const selectedId=ref(props.scope==="supply"?"REL-08":props.scope==="control"?"REL-10":"REL-02");
const cases=computed(()=>topologyCases(reviews.value).filter(item=>{
 if(props.scope==="environment"&&!["REL-01","REL-02","REL-03","REL-04","REL-05","REL-06","REL-07"].includes(item.relation.id))return false;
 if(props.scope==="supply"&&item.relation.id!=="REL-08")return false;
 if(props.scope==="control"&&item.relation.layer!=="control")return false;
 return layer.value==="all"||item.relation.layer===layer.value;
}));
watch(()=>props.scope,scope=>{layer.value="all";selectedId.value=scope==="supply"?"REL-08":scope==="control"?"REL-10":"REL-02";});
const selected=computed(()=>cases.value.find(x=>x.relation.id===selectedId.value)??cases.value[0]??null);
const summary=computed(()=>topologySummary(reviews.value));
const statusType=(status:EngineeringRelationStatus)=>status==="prohibited"?"error":status==="unconfirmed"?"warning":"info";
const checked=(id:string)=>reviews.value.find(x=>x.id===id);
function selectRelation(id:string){selectedId.value=id;}
</script>

<template>
  <section class="topology" :class="{compact}">
    <header class="topology-head">
      <div>
        <div class="topology-eyebrow">ENGINEERING TOPOLOGY / 设计方向与真实连接严格分离</div>
        <h3>工艺水路与控制关系核查</h3>
        <p>工程关系不是一张可任意连接的示意图。以下每段均有独立证据缺口，未经专业签认的管道、阀门、终端和数据接口一律不可作为真实调度条件。</p>
      </div>
      <NTag type="warning" size="small">现场已确认 {{ summary.fieldVerified }}/{{ summary.total }}</NTag>
    </header>

    <div v-if="!compact" class="topology-metrics">
      <div><b>{{ summary.total }}</b><span>待核关系</span></div>
      <div><b>{{ summary.fieldBlocked }}</b><span>未完成现场签认</span></div>
      <div><b>{{ summary.prohibited }}</b><span>当前禁止使用的路径</span></div>
      <div><b>{{ summary.reviewedEvidence }}</b><span>仅DEMO资料已审阅</span></div>
    </div>

    <div v-if="scope==='all'" class="layer-tabs" role="tablist" aria-label="工程关系层次">
      <button v-for="item in ([{id:'all',label:'全部关系'},{id:'water',label:'水流向'},{id:'compliance',label:'合规去向'},{id:'control',label:'自动化边界'}] as const)"
       :key="item.id" type="button" role="tab" :aria-selected="layer===item.id" :class="{active:layer===item.id}"
       @click="layer=item.id">{{ item.label }}</button>
    </div>

    <div class="topology-workspace">
      <div class="relation-list" aria-label="待核实工程关系清单">
        <button v-for="item in cases" :key="item.relation.id" type="button" class="relation-item"
          :class="{active:selected?.relation.id===item.relation.id,prohibited:item.relation.status==='prohibited'}"
          @click="selectRelation(item.relation.id)">
          <span class="relation-id">{{ item.relation.id }} · {{ item.relation.label }}</span>
          <span class="relation-pair"><b>{{ item.from.name }}</b><span class="edge-arrow">→</span><b>{{ item.to.name }}</b></span>
          <span class="relation-flags"><NTag size="tiny" :type="statusType(item.relation.status)">{{ RELATION_STATUS[item.relation.status] }}</NTag>
            <span>{{ item.relation.checkIds.length }}项前置核查</span></span>
        </button>
      </div>
      <div v-if="selected" class="relation-detail">
        <div class="detail-header">
          <div><span>{{ selected.relation.id }} / {{ selected.relation.layer==='water'?'工艺水路':selected.relation.layer==='compliance'?'排放与合规':'自动化接入' }}</span>
            <h4>{{ selected.relation.label }}</h4></div>
          <NTag :type="statusType(selected.relation.status)" size="small">现场未确认</NTag>
        </div>
        <div class="flow">
          <div>{{ selected.from.name }}<small>{{ selected.from.subsystemId }} · 设施待核</small></div>
          <div class="flow-middle">→ <small>物理连接待核</small></div>
          <div>{{ selected.to.name }}<small>{{ selected.to.subsystemId }} · 设施待核</small></div>
        </div>
        <p class="detail-meaning">{{ selected.relation.meaning }}</p>
        <p class="detail-warning">{{ selected.relation.restrictions }}</p>
        <div class="detail-section">
          <strong>前置工程任务及证据状态</strong>
          <div class="check-links">
            <router-link v-for="id in selected.relation.checkIds" :key="id" :to="'/engineering/registry?item='+id">
              <b>{{ id }}</b><span>{{ engineeringEntry(id)?.title }}</span>
              <em>{{ ENGINEERING_STATUS_LABELS[checked(id)?.state??'unverified'] }}</em>
            </router-link>
          </div>
        </div>
        <div class="detail-section">
          <strong>涉及的仪表/数据能力</strong>
          <div class="point-links">
            <router-link v-for="id in selected.relation.pointIds" :key="id" :to="'/engineering/registry?item='+id">
              {{ id }} · {{ engineeringEntry(id)?.title }}
            </router-link>
          </div>
        </div>
        <div class="gate-note">
          <span>G0 图纸与设施：未放行</span>
          <span>G1 测点与PLC：未放行</span>
          <span>G2 控制与合规：未放行</span>
          <p>工程任务即使在DEMO中审核通过，仍不构成真实管线验收、流量计标定或PLC授权。所有关系 fieldVerified=false，controlAuthorized=false。</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.topology{display:grid;gap:12px;padding:18px 20px;background:linear-gradient(135deg,#fff,#f7fbfd);border:1px solid #d8e8f1;border-radius:11px;color:#33657c;min-width:0}
.topology-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.topology-eyebrow{font-size:10px;color:#85a9b8;letter-spacing:.07em}
.topology-head h3{font-size:16px;color:#256983;margin:7px 0}
.topology-head p{font-size:11px;color:#829da9;line-height:1.8;max-width:850px;margin:0}
.topology-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.topology-metrics>div{display:grid;gap:5px;padding:11px;background:#f1f8fc;border:1px solid #dfedf3;border-radius:7px}
.topology-metrics b{font-size:22px;color:#327a94}.topology-metrics span{font-size:10px;color:#91a8b6}
.layer-tabs{display:flex;gap:7px;flex-wrap:wrap}
.layer-tabs button{border:1px solid #d4e6ee;border-radius:7px;padding:7px 12px;background:#f8fbfd;font-size:11px;color:#7699a8;cursor:pointer}
.layer-tabs button.active{background:#e5f5fb;color:#287aa1;border-color:#83c2db;font-weight:650}
.topology-workspace{display:grid;grid-template-columns:minmax(265px,.9fr) minmax(0,1.4fr);gap:12px}
.relation-list{display:grid;gap:6px;align-content:start;max-height:490px;overflow:auto;padding-right:5px}
.relation-item{display:grid;gap:8px;width:100%;min-width:0;text-align:left;cursor:pointer;padding:11px;border:1px solid #e0ebf0;border-radius:8px;background:#fff;color:#476e84}
.relation-item.active{border-color:#77bcd6;background:#ecf8fc}
.relation-item.prohibited{border-left:3px solid #d4a384}
.relation-id{font-size:11px;color:#3181a4;font-weight:650}
.relation-pair{display:flex;align-items:center;gap:7px;line-height:1.55;font-size:11px}
.relation-pair b{font-weight:500;min-width:0}.edge-arrow{color:#99bfd0;flex:none}
.relation-flags{display:flex;align-items:center;justify-content:space-between;gap:7px;flex-wrap:wrap}
.relation-flags>span{font-size:10px;color:#9aabb3}
.relation-detail{min-width:0;border:1px solid #dcecf3;background:#fff;border-radius:9px;padding:16px;display:grid;gap:12px;align-content:start}
.detail-header{display:flex;justify-content:space-between;gap:10px;align-items:center}
.detail-header>div>span{font-size:10px;color:#8daebd}.detail-header h4{font-size:15px;margin:5px 0 0;color:#2f7694}
.flow{display:grid;grid-template-columns:minmax(0,1fr) 82px minmax(0,1fr);align-items:center;gap:8px}
.flow>div:first-child,.flow>div:last-child{padding:13px 8px;text-align:center;border:1px solid #cfe5ee;background:#f4fbfe;border-radius:7px;font-size:12px;color:#356c85;font-weight:650;overflow-wrap:anywhere}
.flow small{display:block;font-weight:400;font-size:10px;color:#9aabba;margin-top:5px}
.flow-middle{text-align:center;color:#65a7bb;font-size:24px}.flow-middle small{font-size:10px}
.detail-meaning{font-size:11px;line-height:1.8;color:#738fa0;margin:0}
.detail-warning{font-size:11px;line-height:1.7;padding:10px 12px;border-left:3px solid #d0a179;background:#fff9f1;color:#987b59;margin:0}
.detail-section{display:grid;gap:8px;padding-top:9px;border-top:1px solid #e7f1f5}
.detail-section>strong{font-size:12px;color:#46788d}
.check-links{display:grid;gap:6px}
.check-links a{display:grid;grid-template-columns:54px minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 9px;border-radius:6px;background:#f7fbfd;color:#4d7c93;text-decoration:none;font-size:11px}
.check-links a b{color:#278cb0}.check-links a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.check-links em{font-size:10px;color:#a17e5a;font-style:normal}
.point-links{display:flex;flex-wrap:wrap;gap:6px}
.point-links a{font-size:10px;padding:7px 9px;border-radius:6px;color:#3c849f;background:#eff8fb;text-decoration:none}
.gate-note{display:flex;flex-wrap:wrap;gap:6px;padding:10px;background:#fffaf2;border:1px solid #eddcc3;border-radius:8px}
.gate-note>span{font-size:10px;color:#9a8059;margin-right:8px}.gate-note p{width:100%;font-size:10px;color:#a38a6a;line-height:1.6;margin:6px 0 0}
.topology.compact{padding:14px 15px}
.topology.compact .topology-workspace{grid-template-columns:minmax(220px,.75fr) minmax(0,1.2fr)}
.topology.compact .relation-list{max-height:400px}
@media(max-width:1200px){.topology-workspace,.topology.compact .topology-workspace{grid-template-columns:1fr}.relation-list{grid-template-columns:repeat(2,minmax(0,1fr));max-height:370px}}
@media(max-width:760px){.topology-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.relation-list{grid-template-columns:1fr}.topology-head{display:grid}.flow{grid-template-columns:1fr}.flow-middle{font-size:18px}.check-links a{grid-template-columns:50px minmax(0,1fr)}.check-links em{grid-column:2}}
</style>

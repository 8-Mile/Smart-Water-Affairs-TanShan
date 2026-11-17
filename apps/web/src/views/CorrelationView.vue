<script setup lang="ts">
import PortBusinessJourney from "../components/PortBusinessJourney.vue";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { NButton, NInput, NTag, useMessage } from "naive-ui";
import { useDemoStore } from "../demo/store";
import { useUnattendedStore } from "../demo/unattendedStore";
import { buildSeed } from "../demo/seed";
import { can } from "../demo/permissions";
import {
  acceptCorrelationCase,attachCorrelationOrder,buildCorrelationSnapshot,
  collectCorrelationSignals,readCorrelation,readScenarioCorrelation,
  recordDemoLink,reviewDemoLink,saveCorrelation,updateCorrelationCase,
  type CorrelationCase,type CorrelationCluster,type CorrelationPair,
} from "../demo/correlation";

const demo=useDemoStore();
const duty=useUnattendedStore();
const router=useRouter();
const message=useMessage();
const preview=ref(false);
const recoveredPreview=ref(false);
const faultSeed=buildSeed("SCN-PUMP-FAULT");
const sourceName=computed(()=>!preview.value?"平台当前场景":recoveredPreview.value?"独立MOCK恢复回放":"独立MOCK故障情景预览");
const scenario=computed(()=>preview.value?"SCN-PUMP-FAULT":demo.scenarioId);
const assets=computed(()=>preview.value?faultSeed.assets:demo.assets);
const alarms=computed(()=>!preview.value?demo.alarms:recoveredPreview.value
  ? faultSeed.alarms.map(a=>({...a,status:"closed" as const})) : faultSeed.alarms);
const orders=computed(()=>!preview.value?demo.workorders:recoveredPreview.value
  ? faultSeed.workorders.map(o=>({...o,status:"archived" as const})) : faultSeed.workorders);
const events=computed(()=>preview.value?[]:duty.events);
const registry=ref(readCorrelation(localStorage));
const scoped=computed(()=>readScenarioCorrelation(registry.value,scenario.value));
const snapshot=computed(()=>buildCorrelationSnapshot(alarms.value,events.value,orders.value,assets.value,scoped.value.links,scenario.value));
const selectedAssetId=ref("asset-p002");
/** 已受理事件必须在原始告警解除后继续留在队列，否则根本无法完成恢复核验。 */
const displayedClusters=computed<CorrelationCluster[]>(()=>{
  const active=snapshot.value.clusters;
  const archivedCaseEntries=scoped.value.cases.filter(c=>!active.some(x=>x.id===c.id)).map(c=>{
    const asset=assets.value.find(a=>a.id===c.rootAssetId);
    const sourceSignals=snapshot.value.signals.filter(x=>c.signalRefs.includes(x.ref));
    return {
      id:c.id,assetId:c.rootAssetId,assetCode:asset?.code??c.rootAssetId,
      subsystemId:asset?.subsystemId??"unknown",
      title:asset?.name??"已受理的待核验事件",
      severity:(sourceSignals.some(x=>x.severity==="critical")?"critical":"warning") as CorrelationCluster["severity"],
      signals:sourceSignals,
      existingOrders:orders.value.filter(o=>o.assetId===c.rootAssetId||o.id===c.workOrderId),
      linkedPairs:[],
    };
  });
  return [...active,...archivedCaseEntries];
});
const selected=computed<CorrelationCluster|null>(()=>
  displayedClusters.value.find(x=>x.assetId===selectedAssetId.value)??displayedClusters.value[0]??null);
function caseFor(cluster:CorrelationCluster):CorrelationCase|undefined{
  return scoped.value.cases.find(x=>x.status!=="closed"&&(
    x.id===cluster.id||x.signalRefs.some(ref=>cluster.signals.some(signal=>signal.ref===ref))
  ))??scoped.value.cases.find(x=>x.id===cluster.id);
}
const selectedCase=computed<CorrelationCase|undefined>(()=>selected.value?caseFor(selected.value):undefined);
const activeCase=computed(()=>selectedCase.value && selectedCase.value.status!=="closed" ? selectedCase.value : null);
const canLink=computed(()=>can(demo.role,"correlation:link"));
const canReview=computed(()=>can(demo.role,"correlation:review"));
const canHandle=computed(()=>can(demo.role,"correlation:handle"));
const canOrder=computed(()=>!preview.value&&can(demo.role,"workorder:create"));
const actionNote=ref("");
const evidenceRef=ref("");
const relationNote=ref("");
const reviewNote=ref("");
const reviewPairId=ref("");
const openCaseCount=computed(()=>scoped.value.cases.filter(x=>x.status!=="closed").length);
const counterpartName=(candidate:CorrelationPair)=>{
  const counterpart=candidate.from.assetId===selected.value?.assetId?candidate.to:candidate.from;
  return assets.value.find(a=>a.id===counterpart.assetId)?.code??counterpart.assetId;
};
const refLink=(signal:{source:string;id:string;subsystemId:string;assetId:string})=>{
  if(signal.source==="alarm")return "/operations/alarms?alarmId="+encodeURIComponent(signal.id);
  return "/intelligent/unattended";
};
function setRegistry(next:ReturnType<typeof readCorrelation>):void{
  saveCorrelation(localStorage,next);
  registry.value=next;
}
function success(text:string):void{message.success(text);}
function fail(err:unknown):void{message.error((err as Error).message);}
function now():string{return new Date().toISOString();}
function registerLink(current:CorrelationPair):void{
  if(!current)return;
  try{
    const next=recordDemoLink(registry.value,scenario.value,
      current.from.assetId,current.to.assetId,evidenceRef.value,relationNote.value,
      demo.role,now());
    setRegistry(next);success("已提交DEMO关系依据，等待管理者人工复核；尚未确认现场连通");
    evidenceRef.value="";relationNote.value="";
  }catch(e){fail(e);}
}
function reviewLink(candidate:CorrelationPair):void{
  if(!scoped.value.links.some(x=>x.id===candidate.id))return;
  try{
    setRegistry(reviewDemoLink(registry.value,candidate.id,reviewNote.value,demo.role,now()));
    success("已在DEMO中复核假设关联；仍不可宣称真实供水关系或共同故障原因");
    reviewNote.value="";reviewPairId.value="";
  }catch(e){fail(e);}
}
function accept():void{
  if(!selected.value)return;
  try{
    setRegistry(acceptCorrelationCase(registry.value,scenario.value,selected.value,demo.role,now(),actionNote.value));
    actionNote.value="";
    success("已受理同设备关联事件；跨工艺假设只作为人工协同核查范围");
  }catch(e){fail(e);}
}
function progress(to:"processing"|"pending_recovery"|"closed"):void{
  if(!selectedCase.value)return;
  try{
    setRegistry(updateCorrelationCase(registry.value,selectedCase.value.id,to,
      demo.role,now(),actionNote.value,collectCorrelationSignals(alarms.value,events.value),orders.value));
    actionNote.value="";
    success(to==="closed"?"已人工关闭协同事件（DEMO）":"已更新协同事件处置状态");
  }catch(e){fail(e);}
}
function ensureOrder():void{
  const current=selected.value,existing=activeCase.value;
  if(!current||!existing||preview.value)return;
  try{
    if(existing.workOrderId){
      void router.push("/operations/workorders?workOrderId="+encodeURIComponent(existing.workOrderId));
      return;
    }
    const matched=orders.value.find(o=>o.assetId===existing.rootAssetId&&!["archived","cancelled"].includes(o.status));
    if(matched){
      setRegistry(attachCorrelationOrder(registry.value,existing.id,matched.id,demo.role,now()));
      success("已关联现有工单 "+matched.code+"，没有重复生成");
      return;
    }
    const order=demo.createWorkOrder({
      title:"[协同核查] "+(assets.value.find(a=>a.id===existing.rootAssetId)?.code??current.assetCode)+" 多异常证据复核（MOCK草稿）",
      assetId:existing.rootAssetId,source:"inspection",
      symptom:existing.signalRefs.join("；"),
      suggestion:"逐一核验源告警、测点数据、设备状态及疑似跨系统联系。未审核的工艺关系不得作为根因。",
      priority:current.severity==="critical"?"high":"medium",
      evidenceIds:existing.signalRefs.map(x=>x.replace(/^(alarm|duty):/,"")),
    });
    setRegistry(attachCorrelationOrder(registry.value,existing.id,order.id,demo.role,now()));
    success("已建立一份待审核的检查工单草稿，未自动派发、未启停设备");
  }catch(e){fail(e);}
}
watch(scenario,()=>{selectedAssetId.value="asset-p002";actionNote.value="";reviewPairId.value="";recoveredPreview.value=false;});
const statusName=(status:string)=>({
  acknowledged:"已人工受理",processing:"协同处理中",pending_recovery:"待恢复核验",closed:"已闭环",
}[status]??status);
</script>

<template>
  <section class="corr-root">
  <PortBusinessJourney />
    <header class="corr-head">
      <div>
        <div class="eyebrow">智能运行 / 异常关联与处置</div>
        <h2>跨系统异常关联诊断 <small>V1</small></h2>
        <p>先找相同设备与现有工单的明确业务联系；跨工艺同时异常仅是线索，核查管网关系后才允许协同处置。</p>
      </div>
      <NTag type="warning" size="small">MOCK · 不确认现场物理拓扑</NTag>
    </header>

    <section class="source-switch">
      <div><strong>当前分析数据：{{ sourceName }}</strong><small>{{ scenario }} · 独立演示不会更改整个平台的场景、告警或工单</small></div>
      <div class="switch-buttons">
        <NTag v-if="recoveredPreview" type="warning" size="small">模拟恢复回放 · 未改动原告警和工单</NTag>
        <NButton secondary size="small" :type="!preview?'primary':'default'" @click="preview=false;recoveredPreview=false">使用当前场景</NButton>
        <NButton secondary size="small" :type="preview?'primary':'default'" @click="preview=true;recoveredPreview=false">预览P-002与射雾器异常（MOCK）</NButton>
      </div>
    </section>

    <div class="corr-metrics">
      <div><span>活动生产/值守信号</span><strong>{{ snapshot.signals.filter(x=>x.active).length }}</strong><small>业务告警及值守事件原ID</small></div>
      <div><span>活动关联组</span><strong>{{ snapshot.clusters.length }}</strong><small>已受理但恢复待闭环记录继续保留</small></div>
      <div><span>跨工艺待证实线索</span><strong>{{ snapshot.unconfirmedCount }}</strong><small>时间接近但物理连接未知</small></div>
      <div><span>正在协同处理</span><strong>{{ openCaseCount }}</strong><small>已人工受理，不自动派工</small></div>
    </div>

    <div class="corr-workspace">
      <section class="panel corr-list">
        <div class="section-head"><div><h3>异常关联队列</h3><p>按设备归并，已受理事件恢复后仍可查</p></div><NTag size="small">{{ displayedClusters.length }} 组</NTag></div>
        <div v-if="!displayedClusters.length" class="empty">当前数据没有活动生产告警或值守事件。未配置监护的工艺不能判定为正常。</div>
        <button v-for="item in displayedClusters" :key="item.id" class="corr-item" type="button"
          :class="{selected:selected?.id===item.id}" @click="selectedAssetId=item.assetId">
          <div class="item-head">
            <strong>{{ item.assetCode }} <span>{{ item.title }}</span></strong>
            <NTag size="tiny" :type="item.severity==='critical'?'error':'warning'">{{ item.severity==='critical'?'严重':'关注' }}</NTag>
          </div>
          <div class="item-sub">{{ item.signals.filter(x=>x.active).length }}项活动信号 · {{ item.signals.length }}项追溯记录 · {{ item.existingOrders.length }}条历史/现有工单</div>
          <div class="item-foot">
            <NTag v-if="item.linkedPairs.length" size="tiny" type="info">含人工DEMO假设关系</NTag>
            <NTag v-else-if="snapshot.crossCandidates.some(p=>p.from.assetId===item.assetId||p.to.assetId===item.assetId)" size="tiny" type="warning">有待核实跨工艺线索</NTag>
            <NTag v-else size="tiny">同设备归集</NTag>
            <span>{{ statusName(caseFor(item)?.status??'待人工受理') }}</span>
          </div>
        </button>
      </section>

      <section class="panel corr-detail">
        <div v-if="!selected" class="empty">当前没有可关联的活动信号。可打开右上方MOCK故障情景查看业务规则。</div>
        <template v-else>
          <div class="section-head"><div><h3>{{ selected.assetCode }} · 关联诊断与协同处置</h3>
            <p>{{ selected.subsystemId }} · {{ selected.signals.length }}项原始信号（含已解除的待核验证据），按共同设备ID归集</p></div>
            <NTag size="small" :type="activeCase?'success':'warning'">{{ selectedCase?statusName(selectedCase.status):'尚未受理' }}</NTag>
          </div>
          <div class="knowledge-link">
            <div><strong>使用知识库核查设备资料</strong><small>原始事件可溯源，资料不足时不推断跨系统故障原因。</small></div>
            <router-link :to="{path:'/decision/knowledge',query:{
              assetId:selected.assetId,
              ...(preview?{}:selected.signals.find(x=>x.source==='alarm')?.id
                ?{alarmId:selected.signals.find(x=>x.source==='alarm')?.id}:{}),
              symptom:selected.signals[0]?.title??'异常待核实',
            }}">查看相关资料与原文</router-link>
          </div>
          <div class="corr-evidence">
            <h4>原始告警与值守证据</h4>
            <div v-for="signal in selected.signals" :key="signal.ref" class="evidence-row">
              <span class="evidence-mark" :class="{critical:signal.severity==='critical'}"></span>
              <div><strong>{{ signal.title }}</strong>
                <small>{{ signal.source==='alarm'?'生产告警':'智能值守' }} · {{ signal.id }} · 状态 {{ signal.status }} · {{ new Date(signal.at).toLocaleString('zh-CN',{hour12:false}) }}</small>
              </div>
              <router-link :to="refLink(signal)">查看原事件</router-link>
            </div>
          </div>
          <div class="known-link">
            <h4>已有工单引用</h4>
            <template v-if="selected.existingOrders.length">
              <div v-for="order in selected.existingOrders" :key="order.id" class="order-ref">
                <div><strong>{{ order.code }}</strong><span>{{ order.title }} · {{ order.status }}</span></div>
                <router-link :to="'/operations/workorders?workOrderId='+order.id">查看工单</router-link>
              </div>
            </template>
            <p v-if="!selected.existingOrders.length">暂无原设备关联工单；只有受理后才能提出待审核的检查工单草稿。</p>
            <p v-if="selectedCase?.workOrderId&&!selected.existingOrders.some(x=>x.id===selectedCase?.workOrderId)" class="shared-order">
              本设备已纳入 {{ selectedCase.rootAssetId }} 的协同处置记录，主案沿用
              <router-link :to="'/operations/workorders?workOrderId='+selectedCase.workOrderId">{{ selectedCase.workOrderId }}</router-link>。
            </p>
            <small>只引用原业务工单，不悄悄改变其任务范围，也不重复派工。</small>
          </div>
          <div v-if="selected.linkedPairs.length" class="associated">
            <h4>人工登记的跨工艺关联（仅DEMO）</h4>
            <div v-for="link in selected.linkedPairs" :key="link.id">
              <strong>{{ counterpartName(link) }} · 待现场确认的跨工艺协同</strong>
              <p>{{ link.message }}</p>
              <small>证据索引：{{ link.relation?.evidenceRef }} · 复核人：{{ link.relation?.reviewedBy }}</small>
            </div>
          </div>
          <div v-if="activeCase?.linkedPairIds.length&&!selected.linkedPairs.length" class="associated">
            <h4>处置范围中保留的跨工艺人工关联依据（DEMO）</h4>
            <p v-for="id in activeCase.linkedPairIds" :key="id">关系索引：{{ id }}。对应原始告警即使解除，也保留在本处置案卷中，仍不得作为真实因果结论。</p>
          </div>
          <div class="co-workflow">
            <h4>协同处置流程</h4>
            <div class="steps"><span :class="{done:Boolean(selectedCase)}">01 受理复核</span><span :class="{done:selectedCase?.status==='processing'||selectedCase?.status==='pending_recovery'||selectedCase?.status==='closed'}">02 现场核查</span><span :class="{done:selectedCase?.status==='pending_recovery'||selectedCase?.status==='closed'}">03 恢复验证</span><span :class="{done:selectedCase?.status==='closed'}">04 人工关闭</span></div>
            <NInput v-model:value="actionNote" type="textarea" :rows="2" placeholder="必填至少8字：说明需要核查的设备、测点、现场证据或处置结果"/>
            <div class="case-actions">
              <NButton v-if="!activeCase&&selected.signals.some(x=>x.active)" type="primary" size="small" :disabled="!canHandle" @click="accept">人工受理关联事件</NButton>
              <NButton v-else-if="activeCase?.status==='acknowledged'" type="primary" size="small" :disabled="!canHandle" @click="progress('processing')">开始协同处理</NButton>
              <NButton v-else-if="activeCase?.status==='processing'" type="primary" size="small" :disabled="!canHandle" @click="progress('pending_recovery')">申请恢复核验</NButton>
              <NButton v-else-if="activeCase?.status==='pending_recovery'" type="primary" size="small" :disabled="!canHandle" @click="progress('closed')">核验并人工关闭</NButton>
              <NTag v-if="selectedCase?.status==='closed'" size="small" type="success">已闭环 · 保留处置审计</NTag>
              <NButton v-if="preview&&activeCase?.status==='pending_recovery'&&!recoveredPreview" secondary size="small"
                @click="recoveredPreview=true">模拟告警解除与工单验收（仅DEMO）</NButton>
              <NButton v-if="activeCase&&activeCase.status!=='closed'&&canOrder" size="small" secondary @click="ensureOrder">{{ activeCase.workOrderId?'打开已有检查工单':'关联/生成一份检查草稿' }}</NButton>
              <NTag v-if="!canHandle" size="tiny" type="warning">当前角色仅可查看</NTag>
            </div>
            <p v-if="recoveredPreview" class="replay-warning">当前仅将独立MOCK输入切换为“告警已关闭、工单已验收”的回放样本，以验证业务状态机；原业务系统没有任何状态变更，也不代表现场真实恢复。</p>
            <p class="boundary">若源告警/值守事件仍活动或关联工单未验收，系统将拒绝关闭。阶段流转只记录人工业务操作，不是PLC控制或已自动恢复。</p>
          </div>
          <details v-if="selectedCase" class="audit">
            <summary>处置事件完整审计 · {{ selectedCase.audit.length }}条</summary>
            <div v-for="(entry,i) in selectedCase.audit" :key="i"><strong>{{ entry.action }}</strong><small>{{ new Date(entry.at).toLocaleString('zh-CN',{hour12:false}) }} · {{ entry.by }}</small><p>{{ entry.detail }}</p></div>
          </details>
        </template>
      </section>
    </div>

    <section class="panel candidates">
      <div class="section-head"><div><h3>跨系统待核实线索与关系证据</h3>
        <p>时间接近不等于管线连通、也不等于同一故障原因。关系录入和审核仅为DEMO业务训练。</p></div>
        <NTag type="warning" size="small">{{ snapshot.unconfirmedCount }} 条缺少关系证据</NTag>
      </div>
      <div class="topology-verify-link">
        <router-link to="/engineering/registry?item=CK-019">核查中压供水服务终端（CK-019）</router-link>
        <router-link to="/engineering/registry?item=CK-021">核查射雾器工艺连接（CK-021）</router-link>
        <span>当前REL-08为未核实的跨工艺候选，不能依据同时告警认定中压泵导致射雾压力降低。</span>
      </div>
      <div v-if="!snapshot.crossCandidates.length" class="empty">当前场景没有满足24小时线索窗口的跨工艺活动生产异常；不会凭空创建关联。</div>
      <div v-for="item in snapshot.crossCandidates" :key="item.id" class="candidate-row">
        <div class="candidate-header">
          <div><strong>{{ item.from.id }} <em>⇄</em> {{ item.to.id }}</strong><p>{{ item.from.subsystemId }} / {{ item.to.subsystemId }} · 报警时差约 {{ item.deltaHours }} 小时</p></div>
          <NTag size="small" :type="item.relation?'info':'warning'">{{ item.relation?'DEMO人工关联已复核':'仅时间线索' }}</NTag>
        </div>
        <p>{{ item.message }}</p>
        <div v-if="scoped.links.find(x=>x.id===item.id)" class="relation-record">
          <strong>关系依据：{{ scoped.links.find(x=>x.id===item.id)?.evidenceRef }}</strong>
          <span>{{ scoped.links.find(x=>x.id===item.id)?.note }}</span>
          <NTag size="tiny" :type="item.relation?'success':'warning'">{{ item.relation?'DEMO已复核':'等待演示审核' }}</NTag>
        </div>
        <template v-if="!item.relation">
          <div v-if="!scoped.links.find(x=>x.id===item.id)" class="link-editor">
            <label><span>相关资料/记录编号（待现场核验）</span><NInput v-model:value="evidenceRef" size="small" placeholder="例如：PIPING-DEMO-01（非真实图号）" :disabled="!canLink"/></label>
            <label><span>人工说明</span><NInput v-model:value="relationNote" size="small" placeholder="只记录拟核查的连接假设，不能直接断定上游影响下游" :disabled="!canLink"/></label>
            <NButton size="small" :disabled="!canLink" @click="registerLink(item)">提交关系待审核</NButton>
          </div>
          <div v-else-if="!item.relation&&canReview" class="review-actions">
            <NButton secondary size="small" @click="reviewPairId=reviewPairId===item.id?'':item.id">{{ reviewPairId===item.id?'收起':'填写DEMO关系复核意见' }}</NButton>
            <div v-if="reviewPairId===item.id"><NInput v-model:value="reviewNote" size="small" placeholder="至少8字，说明复核内容与现场未确认的限制"/>
              <NButton type="primary" size="small" @click="reviewLink(item)">确认DEMO关联复核</NButton></div>
          </div>
          <p v-else class="boundary">已提交关系假设，须由管理者复核；现场仍需以正式图纸和测量证据确认。</p>
        </template>
      </div>
    </section>

    <section class="panel limits">
      <h3>工程可信度说明</h3>
      <p v-for="line in snapshot.summary" :key="line">{{ line }}</p>
      <p>当前六套工艺并非都具备已确认的真实在线测点与共同时间基准；本期跨系统分析仅在同设备、原工单引用和演示关系记录范围内工作。</p>
      <p>要进入现场工程，需要工艺管网拓扑、泵站控制边界、阀门/管段连接、SCADA测点和授时、事件时序及审核过的因果/影响规则。不把多个独立工艺点的同时异常自动判定为系统性事故。</p>
    </section>
  </section>
</template>

<style scoped>
.topology-verify-link{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:11px;background:#f5fafb;border-radius:8px;border:1px solid #d7e9ef;margin-bottom:10px}
.topology-verify-link a{color:#2d86a4;font-size:11px}
.topology-verify-link span{font-size:11px;color:#8ba3ae;flex:1;min-width:200px}

.corr-root{display:grid;gap:14px;color:#24516d;padding-bottom:30px}
.corr-head{border:1px solid #cde4f3;background:linear-gradient(107deg,#e0f2fc,#fff 61%,#e8f5f5);border-radius:12px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;gap:15px}
.eyebrow{font-size:11px;color:#6397b4;margin-bottom:7px}
.corr-head h2{font-size:23px;margin:0;font-weight:750;color:#20577a}
.corr-head h2 small{font-size:11px;font-weight:500;color:#8cadbe}
.corr-head p{font-size:12px;color:#7799ad;line-height:1.8;max-width:830px;margin:8px 0 0}
.source-switch,.panel,.corr-metrics>div{background:#fff;border:1px solid #dbeaf3;box-shadow:0 5px 20px #2e67840a;border-radius:11px}
.source-switch{padding:13px 17px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.source-switch>div:first-child{display:grid;gap:6px}
.source-switch strong{font-size:13px;color:#2f6d91}
.source-switch small{font-size:11px;color:#90a9b8}
.switch-buttons{display:flex;gap:8px;flex-wrap:wrap}
.corr-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.corr-metrics>div{padding:18px;display:grid;gap:6px;min-width:0}
.corr-metrics span{font-size:12px;color:#7e98aa}
.corr-metrics strong{font-size:27px;color:#2d80a5}
.corr-metrics small{font-size:10px;color:#93adbd;line-height:1.6}
.corr-workspace{display:grid;grid-template-columns:minmax(270px,.8fr) minmax(0,1.55fr);gap:13px;align-items:start}
.panel{padding:17px;min-width:0}
.section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:15px}
.section-head h3{font-size:16px;color:#286484;margin:0}
.section-head p{font-size:11px;color:#96acba;line-height:1.7;margin:6px 0 0}
.corr-list{display:grid;gap:8px}
.corr-item{background:#f8fcfe;border:1px solid #e1ecf3;border-radius:8px;padding:13px;text-align:left;cursor:pointer;display:grid;gap:9px;color:inherit;width:100%}
.corr-item.selected{border-color:#85c5e5;background:#edf9ff}
.item-head{display:flex;justify-content:space-between;gap:9px}
.item-head strong{font-size:13px;color:#2e708e}.item-head strong span{font-size:11px;font-weight:500}
.item-sub{font-size:11px;color:#829dae}
.item-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:5px}
.item-foot>span{font-size:10px;color:#84a0b0}
.empty{background:#f7fafc;border:1px dashed #dce9f1;border-radius:8px;padding:22px;color:#92a8b5;font-size:12px;line-height:1.75}
/* 保留资产ID，MOCK故障预览不传不存在于原场景的告警ID */
.knowledge-link{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid #d5eaf4;background:#f3faff;border-radius:7px}
.knowledge-link>div{display:grid;gap:5px}
.knowledge-link strong{font-size:12px;color:#3c7f9d}
.knowledge-link small{font-size:10px;color:#8daabb}
.knowledge-link a{color:#1d84ad;font-size:11px;white-space:nowrap;text-decoration:none}
@media(max-width:700px){.knowledge-link{align-items:flex-start;flex-direction:column}}
.corr-evidence,.known-link,.associated,.co-workflow{border-top:1px solid #e7f0f5;padding-top:14px;margin-top:12px}
h4{font-size:12px;color:#2e708f;margin:0 0 12px}
.evidence-row{display:flex;gap:10px;align-items:center;background:#f7fbfe;border:1px solid #ecf2f6;border-radius:7px;padding:11px;margin-bottom:7px}
.evidence-mark{height:8px;width:8px;border-radius:50%;background:#e8a44b;flex:none}
.evidence-mark.critical{background:#d86f64}
.evidence-row>div{flex:1;display:grid;gap:6px;min-width:0}
.evidence-row strong{font-size:12px;color:#325f7c}
.evidence-row small{font-size:10px;color:#93aaba;overflow-wrap:anywhere}
.evidence-row a,.order-ref a{font-size:11px;color:#1686b4;white-space:nowrap}
.known-link p,.known-link small{font-size:11px;color:#849dab;line-height:1.7}
.shared-order{color:#397c9e!important;background:#ecf8ff;border-radius:6px;padding:8px}
.replay-warning{font-size:11px;line-height:1.7;border:1px solid #cde8f2;background:#f0f9fd;padding:10px;border-radius:7px;color:#2f81a3}
.order-ref{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:9px;padding:9px;background:#f8fbfd;border-radius:6px}
.order-ref div{display:grid;gap:5px}
.order-ref strong{font-size:12px;color:#346b8b}
.order-ref span{font-size:11px;color:#87a0b1}
.associated{background:#f4faf9;border:1px solid #d4eee7;border-radius:7px;padding:13px}
.associated strong{font-size:12px;color:#267f74}
.associated p,.associated small{font-size:11px;color:#648f8d;line-height:1.8}
.steps{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;padding:11px;background:#f6fafc;margin-bottom:12px;border-radius:6px}
.steps span{color:#9eb3be;font-size:11px}
.steps span.done{color:#2587b2;font-weight:700}
.case-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
.boundary{font-size:11px;color:#9b8a75;line-height:1.8;margin:10px 0 0}
.audit{margin-top:12px;border:1px solid #e2eef5;border-radius:7px;padding:10px}
.audit summary{font-size:12px;color:#3682ab;cursor:pointer}
.audit>div{margin:9px 0;border-left:2px solid #a0d4e8;padding:0 10px;display:grid;gap:5px}
.audit strong{font-size:11px;color:#356e8f}
.audit small,.audit p{font-size:10px;color:#8da4b3;margin:0}
.candidates .candidate-row{border:1px solid #e1eaf1;border-radius:8px;padding:14px;margin-bottom:9px;background:#fbfdff}
.candidate-header{display:flex;justify-content:space-between;align-items:center;gap:12px}
.candidate-header strong{font-size:13px;color:#367a98}
.candidate-header em{font-style:normal;color:#a7bfce;padding:0 5px}
.candidate-header p,.candidate-row>p{font-size:11px;color:#819eae;line-height:1.7;margin:6px 0}
.relation-record{display:flex;flex-wrap:wrap;gap:9px;align-items:center;background:#edf9f5;border-radius:6px;padding:9px}
.relation-record strong{font-size:11px;color:#327e71}
.relation-record span{font-size:11px;color:#8c9c98}
.link-editor{margin-top:12px;display:flex;align-items:end;gap:9px;flex-wrap:wrap}
.link-editor label{flex:1;min-width:225px;display:grid;gap:6px}
.link-editor label span{font-size:10px;color:#93a7b4}
.review-actions{display:grid;gap:9px;margin-top:9px}
.review-actions>div{display:flex;gap:8px;align-items:center}
.review-actions :deep(.n-input){max-width:520px}
.limits h3{font-size:14px;color:#387a9a}
.limits p{font-size:11px;color:#849caa;line-height:1.8;border-bottom:1px dashed #e6f0f5;padding:8px 0;margin:0}
@media(max-width:1200px){.corr-workspace{grid-template-columns:1fr}.corr-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:680px){.corr-head{flex-direction:column;align-items:flex-start}.corr-metrics{grid-template-columns:1fr 1fr}.link-editor label{min-width:180px}.candidate-header{align-items:flex-start;flex-direction:column}}
</style>

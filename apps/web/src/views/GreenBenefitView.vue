<script setup lang="ts">
import WorkspaceNav from "../components/WorkspaceNav.vue";
import { computed, reactive, ref, watch } from "vue";
import {useRoute} from "vue-router";
import { NButton, NCheckbox, NInputNumber, NTag, useMessage } from "naive-ui";
import { useDemoStore } from "../demo/store";
import { can } from "../demo/permissions";
import { readDrafts, MULTI_SOURCE_DRAFT_KEY, resolveSupplyDraft, type SupplyDraft } from "../demo/proposalDrafts";
import {
  cloneGreenBenefit, evaluateGreenBenefit, readGreenDrafts, saveGreenBenefitDraft,
  GREEN_SOURCE_LABELS,
  type GreenBenefitInputs, type GreenBenefitDraft,
} from "../demo/greenBenefit";
import {cloneMultiSource,type WaterSourceId} from "../demo/multisource";

const store=useDemoStore();
const route=useRoute();
const selectedSupplyId=computed(()=>typeof route.query.supplyDraftId==="string"?route.query.supplyDraftId:"");
const incomingDraftStatus=computed(()=>{
 if(!selectedSupplyId.value)return "";
 try{return resolveSupplyDraft(localStorage,selectedSupplyId.value).id;}
 catch(error){return (error as Error).message;}
});
const message=useMessage();
const editable=reactive<GreenBenefitInputs>(cloneGreenBenefit());
const applied=ref<GreenBenefitInputs>(cloneGreenBenefit());
const calculationError=ref("");
const showParameters=ref(false);
const showEvidence=ref(false);
const showHistory=ref(false);
const drafts=ref<GreenBenefitDraft[]>(readGreenDrafts(localStorage,store.scenarioId));
const supplyDrafts=ref<SupplyDraft[]>(readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY,localStorage));
const canSave=computed(()=>can(store.role,"water:proposal"));
const dirty=computed(()=>JSON.stringify(editable)!==JSON.stringify(applied.value));
const result=computed(()=>evaluateGreenBenefit(applied.value));
const ledgerCount=computed(()=>store.seed.ledger.length);
const sourceExtras=(id:WaterSourceId)=>editable.extras.find(x=>x.id===id)!;
const shortNumber=new Intl.NumberFormat("zh-CN",{minimumFractionDigits:0,maximumFractionDigits:2});
function n(value:number|null|undefined):string{
  return value==null||!Number.isFinite(value)?"—":shortNumber.format(value);
}
function cash(value:number|null|undefined):string{
  return value==null?"暂不可比":(value<0?"−":"")+"¥"+n(Math.abs(value));
}
function setValues(next:GreenBenefitInputs):void{
  Object.assign(editable,cloneGreenBenefit(next));
  if(!next.sourceDraftId)delete editable.sourceDraftId;
  // reactive对象的数组需经clone整体替换，不共享已计算对象引用
  editable.extras=next.extras.map(x=>({...x}));
  editable.water=cloneMultiSource(next.water);
}
function recalculate():void{
  try{
    const fresh=cloneGreenBenefit(editable);
    evaluateGreenBenefit(fresh);
    applied.value=fresh;calculationError.value="";
    message.success("已重新核算本时段MOCK成本和供水约束，未改动账本或设备");
  }catch(err){
    calculationError.value=(err as Error).message;
    message.error(calculationError.value);
  }
}
function preset(kind:"normal"|"quality"|"shortage"|"loss"):void{
  const fresh=cloneGreenBenefit();
  if(kind==="quality"){
    for(const path of fresh.water.routes)if(path.sourceId==="reclaimed")path.qualityAccepted=false;
  }else if(kind==="shortage"){
    const tap=fresh.water.sources.find(x=>x.id==="tap")!;
    tap.availableM3=450;tap.deliverableM3=450;
    fresh.water.sources.find(x=>x.id==="rain")!.availableM3=100;
    fresh.water.sources.find(x=>x.id==="reclaimed")!.availableM3=100;
  }else if(kind==="loss"){
    fresh.fixedReuseYuanPeriod=3800;
  }
  setValues(fresh);recalculate();
}
function loadExistingSupplyDraft():void{
  supplyDrafts.value=readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY,localStorage);
  try{
    const original=resolveSupplyDraft(localStorage,selectedSupplyId.value||undefined);
    const fresh=cloneGreenBenefit();
    // 原始草稿仅传入供水条件；费用必须经过本模型重新计算。
    fresh.water=cloneMultiSource(original.inputs);
    fresh.sourceDraftId=original.id;
    evaluateGreenBenefit(fresh);
    setValues(fresh);
    recalculate();
    message.success("已按草稿 "+original.id+" 的供水条件重新核算；未复制旧节约数字");
  }catch(err){
    message.error("供水草稿不可用于成本核算："+(err as Error).message);
  }
}
watch(()=>route.query.supplyDraftId,()=>{ // do not silently apply an unconfirmed cross-workflow input
  supplyDrafts.value=readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY,localStorage);
});
function save():void{
  if(dirty.value)return;
  try{
    const draft=saveGreenBenefitDraft(applied.value,result.value,store.scenarioId,store.role,localStorage);
    drafts.value=readGreenDrafts(localStorage,store.scenarioId);
    showHistory.value=true;
    message.success("已保存模拟效益核算草稿 "+draft.id+"；未宣称真实节约或下发控制");
  }catch(err){message.error((err as Error).message);}
}
const isPositive=computed(()=>result.value.netDeltaYuan!==null&&result.value.netDeltaYuan>0);
const comparedText=computed(()=>{
  if(result.value.netDeltaYuan===null)return "净差额暂不可比";
  if(result.value.netDeltaYuan>0)return "条件模拟净节约";
  if(result.value.netDeltaYuan<0)return "条件模拟净增支";
  return "条件模拟费用持平";
});
const signedValue=computed(()=>result.value.netDeltaYuan===null?"暂不可比":cash(Math.abs(result.value.netDeltaYuan)));
</script>

<template>
  <div class="benefit-root">
    <WorkspaceNav label="水源优化与效益" :items="[{name:'水源分配',to:'/water/multi-source'},{name:'成本效益',to:'/water/green-benefit'}]" />
    <header class="green-hero">
      <div>
        <div class="eyebrow">水资源管理 / 绿色运营效益核算</div>
        <h2>节水节能与运营净效益 <small>V1 · 成本可追溯</small></h2>
        <p>在同等用水量、可行供水路径和一致成本口径下，比较回用组合与全自来水基准。少购水不等于总耗水下降，模拟净效益不等于已实现收益。</p>
      </div>
      <NTag type="warning" size="small">全部MOCK · 不是财务实绩</NTag>
    </header>

    <section class="panel quick-preset">
      <div><strong>快速演示运营决策</strong><p>水质不合格、供水不足或额外成本过高时，系统不会硬说节约。</p></div>
      <div class="quick-actions">
        <NButton size="small" secondary @click="preset('normal')">正常成本</NButton>
        <NButton size="small" secondary @click="preset('quality')">中水水质受限</NButton>
        <NButton size="small" secondary @click="preset('shortage')">供水能力不足</NButton>
        <NButton size="small" secondary @click="preset('loss')">成本导致净增支</NButton>
      </div>
    </section>

    <div class="metrics">
      <div class="metric">
        <span>同口径供水需求</span>
        <strong>{{ n(result.water.requestedM3) }} <small>m³</small></strong>
        <p>{{ applied.water.periodHours }}小时 · {{ result.water.feasible?'方案已满足需求':'存在供水缺口' }}</p>
      </div>
      <div class="metric">
        <span>少购自来水量（条件模拟）</span>
        <strong>{{ result.tapAvoidedM3===null?'—':n(result.tapAvoidedM3) }} <small>m³</small></strong>
        <p>不是用水量下降，更不是港区实际节水成果</p>
      </div>
      <div class="metric">
        <span>全自来水可比费用</span>
        <strong>{{ cash(result.baselineYuan) }}</strong>
        <p>必须满足同需求下的水质、管路、供水上限</p>
      </div>
      <div class="metric net" :class="{positive:isPositive,negative:result.netDeltaYuan!==null&&!isPositive}">
        <span>{{ comparedText }}</span>
        <strong>{{ signedValue }}</strong>
        <p>{{ result.netDeltaYuan===null?'成本口径或供水比较条件不满足':'当前情景费用 '+cash(result.currentYuan)+' · 差额 '+n(result.savingRatioPercent)+'%' }}</p>
      </div>
    </div>

    <section v-if="result.blockers.length" class="stop-notice">
      <NTag type="error" size="small">结论受阻</NTag>
      <p v-for="messageText in result.blockers" :key="messageText">{{ messageText }}</p>
    </section>

    <div class="two-col">
      <section class="panel">
        <div class="section-head">
          <div><h3>运营成本账算清楚了吗？</h3>
            <p>全部为本时段MOCK情景费用，追加项按已声明的排重假设单列</p></div>
          <NTag size="small" :type="result.netDeltaYuan===null?'warning':result.netDeltaYuan<0?'error':'info'">
            {{ result.netDeltaYuan===null?'不具备净费用比较条件':'条件模拟可比' }}
          </NTag>
        </div>
        <div class="money-line"><span>全自来水情景费用</span><strong>{{ cash(result.baselineYuan) }}</strong></div>
        <div class="money-line"><span>当前组合原来源综合成本</span><strong>{{ cash(result.baseScenarioYuan) }}</strong></div>
        <div class="money-line sub"><span>追加处理 / 药剂</span><strong>{{ cash(result.treatmentYuan) }}</strong></div>
        <div class="money-line sub"><span>追加输配成本</span><strong>{{ cash(result.transferYuan) }}</strong></div>
        <div class="money-line sub"><span>追加污泥 / 残渣处置成本</span><strong>{{ cash(result.residualYuan) }}</strong></div>
        <div class="money-line sub"><span>追加用电成本（{{ n(result.addedElectricityKwh) }} kWh）</span><strong>{{ cash(result.electricityYuan) }}</strong></div>
        <div class="money-line sub"><span>回用设施增量固定O&M</span><strong>{{ cash(result.fixedYuan) }}</strong></div>
        <div class="money-line final-cost"><span>当前组合条件模拟总费用</span><strong>{{ cash(result.currentYuan) }}</strong></div>
        <div class="money-line result-line">
          <span>相对可比基准的净差额</span>
          <strong :class="{loss:result.netDeltaYuan!==null&&result.netDeltaYuan<0}">{{ cash(result.netDeltaYuan) }}</strong>
        </div>
        <p class="cost-note">基础费用差额（未扣新增费用）：{{ cash(result.grossDeltaYuan) }}。如果追加成本改变了水源价格排序，系统会重新运行原三水源分配模型，而不是直接在旧方案上减一个数字。</p>
      </section>

      <section class="panel">
        <div class="section-head"><div><h3>三种水源的实际配比</h3><p>复用现有多水源供需与路径模型，不重复计雨水和中水</p></div></div>
        <div class="source-row" v-for="source in result.bySource" :key="source.id">
          <div class="source-line"><strong>{{ source.label }}</strong><span>{{ n(source.volumeM3) }} m³</span></div>
          <div class="volume-track"><div :class="source.id" :style="{width:result.water.requestedM3>0?Math.min(100,source.volumeM3/result.water.requestedM3*100)+'%':'0%'}"></div></div>
          <div class="source-sub"><span>基础 {{ n(source.baseUnitYuanM3) }} 元/m³</span><span>含追加项 {{ n(source.effectiveUnitYuanM3) }} 元/m³</span><span>小计 {{ cash(source.totalYuan) }}</span></div>
        </div>
        <div class="source-balance"><span>已匹配供水</span><strong>{{ n(result.water.suppliedM3) }} / {{ n(result.water.requestedM3) }} m³</strong></div>
        <div class="source-balance"><span>未满足供水</span><strong :class="{loss:result.water.unmetM3>0}">{{ n(result.water.unmetM3) }} m³</strong></div>
        <div class="source-balance"><span>雨水和中水独立库存</span><strong>{{ applied.water.separateStockConfirmed?'按MOCK假设分别核实':'未核实，回用水禁用' }}</strong></div>
        <div class="sub-links"><router-link to="/water/multi-source">查看三水源分配约束</router-link><router-link to="/water/ledger">查看历史水量账本</router-link></div>
      </section>
    </div>

    <section class="panel settings">
      <div v-if="selectedSupplyId" class="incoming-draft" aria-label="指定供水方案传递">
        <div><strong>来自水源分配的指定方案：{{ selectedSupplyId }}</strong>
          <p>{{ incomingDraftStatus===selectedSupplyId?"草稿已找到；需人工确认导入，成本费用将在本页重新核算。":incomingDraftStatus }}</p>
          <p>MOCK草稿，不代表现场实际供水；切换页面不会自动覆盖当前成本参数。</p></div>
        <NButton type="primary" size="small" :disabled="incomingDraftStatus!==selectedSupplyId" @click="loadExistingSupplyDraft()">确认导入此编号并重新核算</NButton>
      </div>
      <div class="section-head">
        <div><h3>核算边界与模型输入</h3><p>专业配置默认折叠；修改后需重新计算，防止用旧结果保存新参数。</p></div>
        <div class="action-row">
          <NButton size="small" secondary @click="loadExistingSupplyDraft()">{{ selectedSupplyId?"导入指定供水草稿":"载入最近供水草稿" }}</NButton>
          <NButton size="small" secondary @click="showParameters=!showParameters">{{ showParameters?'收起':'调整成本与供水条件' }}</NButton>
        </div>
      </div>
      <div class="basic-context">
        <div><strong>基础水源费用</strong><span>沿用原多水源模型，包含各来源已计入的综合运行费用</span></div>
        <div><strong>新增成本</strong><span>仅在未与原单价重复时单列追加；电耗必须有独立计量或清晰工程假设</span></div>
        <div><strong>泵组能效</strong><span>中压泵能效MOCK不直接代入供水处理/输配能耗，避免错误设备归属</span></div>
      </div>
      <div v-if="showParameters" class="parameter-area">
        <NCheckbox v-model:checked="editable.costBoundaryConfirmed">
          DEMO排重假设：以下新增费用均未包含在原来源单方综合费用中（不是现场已审核）
        </NCheckbox>
        <p class="input-note">取消后保留供水核算，但不显示净效益，因为成本口径没有完成排重；默认成本只是MOCK估算，不构成合同、发票或实测依据。</p>
        <div class="common-inputs">
          <label><span>追加电价（元/kWh）</span><NInputNumber v-model:value="editable.electricityYuanKwh" :min="0" :max="100" :precision="3" size="small"/></label>
          <label><span>回用增量固定成本（元/本时段）</span><NInputNumber v-model:value="editable.fixedReuseYuanPeriod" :min="0" :precision="2" size="small"/></label>
          <label><span>统计时段（小时）</span><NInputNumber v-model:value="editable.water.periodHours" :min="1" :max="720" :precision="0" size="small"/></label>
        </div>
        <div class="source-edit" v-for="source in editable.water.sources" :key="source.id">
          <h4>{{ GREEN_SOURCE_LABELS[source.id] }}</h4>
          <div class="editable-grid">
            <label><span>本期库存(m³)</span><NInputNumber v-model:value="source.availableM3" :min="0" size="small"/></label>
            <label><span>供水能力(m³)</span><NInputNumber v-model:value="source.deliverableM3" :min="0" size="small"/></label>
            <label><span>原综合成本(元/m³)</span><NInputNumber v-model:value="source.unitCostYuanM3" :min="0" :precision="2" size="small"/></label>
            <label><span>追加处理/药剂(元/m³)</span><NInputNumber v-model:value="sourceExtras(source.id).treatmentYuanM3" :min="0" :precision="2" size="small"/></label>
            <label><span>追加输配(元/m³)</span><NInputNumber v-model:value="sourceExtras(source.id).transferYuanM3" :min="0" :precision="2" size="small"/></label>
            <label><span>追加处置(元/m³)</span><NInputNumber v-model:value="sourceExtras(source.id).residualYuanM3" :min="0" :precision="2" size="small"/></label>
            <label><span>追加电耗(kWh/m³)</span><NInputNumber v-model:value="sourceExtras(source.id).additionalKwhM3" :min="0" :precision="3" size="small"/></label>
          </div>
        </div>
        <div class="demand-edit">
          <h4>用水量与保障要求</h4>
          <div class="editable-grid"><label v-for="use in editable.water.demands" :key="use.id">
            <span>{{ use.label }} (m³)</span><NInputNumber v-model:value="use.neededM3" :min="0" size="small"/>
          </label></div>
          <NCheckbox v-model:checked="editable.water.separateStockConfirmed">雨水与中水库存为分别确认的不同水源（仅演示假设）</NCheckbox>
          <p class="input-note">水质与管网连接的9条路径沿用多水源模型预设；需调整实际路径，请先在三水源优化页面配置并保存草稿，再载入此处。</p>
        </div>
        <div class="config-actions">
          <span v-if="dirty">配置已修改，结果仍为上次有效测算。</span>
          <NButton secondary size="small" @click="preset('normal')">恢复默认演示</NButton>
          <NButton type="primary" size="small" @click="recalculate">按当前参数重新计算</NButton>
        </div>
        <p v-if="calculationError" class="input-error">{{ calculationError }}</p>
      </div>
      <p v-if="applied.sourceDraftId" class="draft-source">已载入多水源建议原始编号：{{ applied.sourceDraftId }}。本页会重新根据追加费用优化分配，不直接复制旧草稿的节约金额。</p>
    </section>

    <section class="panel">
      <div class="section-head"><div><h3>来源与可信度说明</h3><p>不把不同期间的水量账本、设备铭牌和用水情景混为一项真实效益</p></div>
        <NButton size="small" text @click="showEvidence=!showEvidence">{{ showEvidence?'收起详情':'查看所有限制条件' }}</NButton></div>
      <div class="evidence-strip">
        <div><strong>三水源模型</strong><span>原供水分配代码 + 人工假设费用</span><router-link to="/water/multi-source">检查</router-link></div>
        <div><strong>历史水量账本</strong><span>{{ ledgerCount }}条MOCK记录，仅供分类核对，未并入本期成本</span><router-link to="/water/ledger">检查</router-link></div>
        <div><strong>泵组能效</strong><span>独立MOCK能效评估，无相同设备电能计量关联</span><router-link to="/decision/health?tab=energy">检查</router-link></div>
      </div>
      <div v-if="showEvidence" class="boundary-list"><p v-for="warn in result.warnings" :key="warn">{{ warn }}</p></div>
      <p class="subtle">当前只做单时段增量运营费用核算，不自动计算碳减排、处理量合规、长期投资回收期或实际环境收益。</p>
    </section>
    <section class="panel draft-panel">
      <div class="section-head"><div><h3>保存待工程复核的运营核算草稿</h3><p>本地模拟数据，不写入水量账本、不生成财务记账或现场设备控制。</p></div>
        <NTag size="small" :type="dirty?'warning':'info'">{{ dirty?'有未计算的修改':'已按当前条件计算' }}</NTag></div>
      <div class="save-actions">
        <NButton type="primary" size="small"
          :disabled="!canSave||dirty||!result.comparable||result.netDeltaYuan===null"
          @click="save">保存本期条件净效益待复核草稿</NButton>
        <span v-if="!canSave">当前角色无权保存水务建议。</span>
        <span v-else-if="result.netDeltaYuan===null">比较基准或成本边界未满足，不允许作为完整净效益草稿保存。</span>
        <span v-else-if="dirty">参数已变动，请先重新计算。</span>
        <span v-else>无论净节约或净增支均可存草稿，正式成本合同及技术人员仍需审核。</span>
        <NButton size="small" text @click="showHistory=!showHistory">{{ showHistory?'收起':'查看' }}草稿（{{ drafts.length }}）</NButton>
      </div>
      <div v-if="showHistory" class="draft-list">
        <p v-if="!drafts.length">当前演示场景暂无已保存的核算草稿。</p>
        <div v-for="item in drafts.slice(0,10)" :key="item.id">
          <strong>{{ item.id }}</strong><span>净差额 {{ cash(item.result.netDeltaYuan) }} · {{ item.result.nonTapM3 }} m³非自来水</span>
          <small>{{ item.createdBy }} · {{ new Date(item.createdAt).toLocaleString('zh-CN',{hour12:false}) }} · DEMO待复核</small>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.benefit-root{display:grid;gap:13px;min-width:0;color:#2e556d;padding-bottom:28px}
.green-hero{display:flex;justify-content:space-between;align-items:center;gap:16px;background:linear-gradient(110deg,#e3f4f0,#f9fdff 59%,#e8f4fb);padding:22px 24px;border:1px solid #d2e7ee;border-radius:11px}
.eyebrow{color:#669ca5;font-size:11px;margin-bottom:7px}
.green-hero h2{font-size:22px;color:#256c78;margin:0;font-weight:750}
.green-hero h2 small{font-size:11px;color:#81a5ac;font-weight:500}
.green-hero p{font-size:12px;color:#7598a8;line-height:1.85;max-width:880px;margin:7px 0 0}
.panel,.metric{background:#fff;border-radius:10px;border:1px solid #dbeaf2;box-shadow:0 5px 17px #236f8709;min-width:0}
.panel{padding:17px 19px}
.quick-preset{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.quick-preset strong{font-size:13px;color:#347e83}
.quick-preset p{font-size:11px;margin:5px 0 0;color:#92a7b2}
.quick-actions,.action-row{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}
.metric{display:grid;gap:8px;padding:17px;min-width:0}
.metric>span{font-size:11px;color:#7794a7}
.metric>strong{font-size:24px;font-weight:750;color:#326e92;line-height:1.25;overflow-wrap:anywhere}
.metric strong small{font-size:12px;color:#92a9b8;font-weight:500}
.metric p{font-size:10px;color:#92a7b6;margin:0;line-height:1.7}
.metric.net{background:linear-gradient(145deg,#f1faf5,#fff)}
.metric.net.positive>strong{color:#19956f}
.metric.net.negative{background:#fff8f4}
.metric.net.negative>strong{color:#be624d}
.stop-notice{border:1px solid #e9c6bc;border-radius:9px;padding:12px;background:#fff7f4;display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.stop-notice p{font-size:12px;color:#b06156;margin:0;line-height:1.6}
.two-col{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,1fr);gap:13px;align-items:stretch}
.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.section-head h3{font-size:15px;margin:0;color:#31728a}
.section-head p{font-size:11px;line-height:1.7;color:#8ba5b3;margin:6px 0 0}
.money-line{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 2px;border-bottom:1px solid #eaf0f4;font-size:12px}
.money-line span{color:#718e9d}.money-line strong{color:#386d86;font-size:13px;white-space:nowrap}
.money-line.sub{padding-left:16px}.money-line.sub span{font-size:11px;color:#90a5b0}
.money-line.final-cost{background:#f2faf8;border-radius:6px;padding:12px;margin-top:8px;border:0}
.money-line.final-cost span,.money-line.final-cost strong{color:#287c70;font-weight:700}
.money-line.result-line{border:0;margin-top:8px}.money-line.result-line strong{font-size:20px;color:#168d6e}.money-line.result-line strong.loss{color:#c26853}
.cost-note{background:#f5fafc;padding:10px;border-radius:6px;font-size:11px;line-height:1.8;color:#7e9aab;margin:6px 0 0}
.source-row{padding:14px 0;border-bottom:1px solid #e9f0f4}.source-line{display:flex;justify-content:space-between;gap:9px;font-size:12px}
.source-line strong{color:#39748f}.source-line span{color:#547e92}
.volume-track{height:9px;background:#edf2f6;border-radius:6px;overflow:hidden;margin:9px 0}
.volume-track>div{height:100%;border-radius:5px}
.volume-track .rain{background:#48a7d2}.volume-track .reclaimed{background:#46b39a}.volume-track .tap{background:#9eb6cb}
.source-sub{font-size:10px;color:#8da6b4;display:flex;justify-content:space-between;flex-wrap:wrap;gap:7px}
.source-balance{display:flex;justify-content:space-between;gap:11px;margin:10px 0;color:#839ca9;font-size:11px}
.source-balance strong{color:#3e7895}.source-balance strong.loss{color:#ce6a56}
.sub-links{display:flex;flex-wrap:wrap;gap:13px;padding-top:13px}.sub-links a,.evidence-strip a{color:#178bb0;text-decoration:none;font-size:11px}
.basic-context,.evidence-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
.basic-context>div,.evidence-strip>div{display:grid;gap:7px;background:#f8fbfd;border:1px solid #e5eff5;border-radius:7px;padding:12px}
.basic-context strong,.evidence-strip strong{font-size:12px;color:#36758d}.basic-context span,.evidence-strip span{color:#8fa6b3;line-height:1.75;font-size:11px}
.parameter-area{padding-top:17px;margin-top:13px;border-top:1px solid #e6eff4;display:grid;gap:13px}
.input-note,.draft-source,.subtle{font-size:11px;color:#93a6b4;line-height:1.8;margin:0}
.common-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.common-inputs label,.editable-grid label{display:grid;gap:6px;min-width:0}
.common-inputs label span,.editable-grid label span{font-size:10px;color:#8ca3b1}
.common-inputs :deep(.n-input-number),.editable-grid :deep(.n-input-number){width:100%}
.source-edit{border:1px solid #e2edf3;border-radius:8px;padding:12px}
.source-edit h4,.demand-edit h4{font-size:13px;color:#3b8093;margin:0 0 12px}
.editable-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.demand-edit{padding:12px;background:#f7fbfd;border-radius:8px;display:grid;gap:8px}
.config-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;align-items:center}
.config-actions span{font-size:11px;color:#b68a59;margin-right:auto}
.input-error{font-size:11px;color:#bc5858}
.draft-source{padding:10px;background:#f2f9fc;margin-top:11px;color:#5690ac}
.evidence-strip>div a{justify-self:start}.boundary-list{margin-top:12px;display:grid;gap:7px}
.boundary-list p{padding:10px;background:#f8fbfd;font-size:11px;line-height:1.8;color:#7893a2;margin:0;border-radius:6px}
.subtle{margin-top:11px}.save-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.save-actions span{font-size:11px;color:#96aab6;flex:1;min-width:200px}
.draft-list{padding-top:12px;display:grid;gap:8px}
.draft-list>div{display:flex;flex-wrap:wrap;gap:13px;background:#f6fafb;padding:11px;border-radius:7px;align-items:center}
.draft-list strong{font-size:11px;color:#357993}.draft-list span,.draft-list small{font-size:10px;color:#8ba2ae}
@media(max-width:1300px){.two-col{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:900px){.editable-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.basic-context,.evidence-strip{grid-template-columns:1fr 1fr}}
@media(max-width:670px){.green-hero{flex-direction:column;align-items:flex-start}.metrics,.common-inputs,.basic-context,.evidence-strip{grid-template-columns:1fr}.editable-grid{grid-template-columns:1fr}}
.incoming-draft{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;border:1px solid #b9dce9;background:#f0f9fd;border-radius:8px;padding:11px 13px;margin-bottom:12px;color:#40758c}
.incoming-draft strong{font-size:12px}.incoming-draft p{margin:5px 0 0;font-size:11px;color:#7d9eaf;line-height:1.5}
</style>

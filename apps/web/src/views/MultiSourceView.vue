<script setup lang="ts">
import WorkspaceNav from "../components/WorkspaceNav.vue";
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { NButton, NCheckbox, NInputNumber, NTag, useMessage } from "naive-ui";
import { useDemoStore } from "../demo/store";
import { MULTI_SOURCE_DRAFT_KEY, readDrafts, saveSupplyDraft, type SupplyDraft } from "../demo/proposalDrafts";
import { can } from "../demo/permissions";
import {
  cloneMultiSource, evaluateMultiSource,
  type MultiSourceInputs, type WaterSourceId, type WaterUseId, type WaterSupplyResult,
} from "../demo/multisource";

const message=useMessage();
const store=useDemoStore();
const route=useRoute();
const initialInputs=cloneMultiSource();
if (route.query.scenario === "quality") {
  for (const path of initialInputs.routes) if (path.sourceId === "reclaimed") path.qualityAccepted = false;
} else if (route.query.scenario === "shortage") {
  initialInputs.sources.find(s => s.id === "tap")!.availableM3 = 450;
  initialInputs.sources.find(s => s.id === "tap")!.deliverableM3 = 450;
  initialInputs.sources.find(s => s.id === "rain")!.availableM3 = 100;
  initialInputs.sources.find(s => s.id === "reclaimed")!.availableM3 = 100;
}
const editable=reactive<MultiSourceInputs>(cloneMultiSource(initialInputs));
const applied=ref<MultiSourceInputs>(cloneMultiSource(initialInputs));
const error=ref("");
const showConfig=ref(false);
const showRoute=ref(false);
const showDetails=ref(false);
const showDrafts=ref(route.query.source === "ai");
// AI在本页上直接生成草稿或切换情景时，路由组件不会重新挂载。
watch(() => route.fullPath, () => {
  if (route.query.source !== "ai") return;
  drafts.value = readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY, localStorage);
  showDrafts.value = true;
  const next = cloneMultiSource();
  if (route.query.scenario === "quality") {
    for (const path of next.routes) if (path.sourceId === "reclaimed") path.qualityAccepted = false;
  } else if (route.query.scenario === "shortage") {
    next.sources.find(x => x.id === "tap")!.availableM3 = 450;
    next.sources.find(x => x.id === "tap")!.deliverableM3 = 450;
    next.sources.find(x => x.id === "rain")!.availableM3 = 100;
    next.sources.find(x => x.id === "reclaimed")!.availableM3 = 100;
  }
  Object.assign(editable, cloneMultiSource(next));
  applied.value = next;
});

const drafts = ref<SupplyDraft[]>(readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY, localStorage));
const canSave=computed(()=>can(store.role, "water:proposal"));
const dirty=computed(()=>JSON.stringify(editable)!==JSON.stringify(applied.value));
const result=computed<WaterSupplyResult|null>(()=>{try{return evaluateMultiSource(applied.value);}catch{return null;}});
const sourceColors:Record<WaterSourceId,string>={rain:"#2598cf",reclaimed:"#20a98c",tap:"#a4b8c7"};
const sourceNames:Record<WaterSourceId,string>={rain:"雨水",reclaimed:"中水",tap:"自来水"};
const usedNames:Record<WaterUseId,string>={critical:"关键生产补水",spray:"射雾除尘",cleaning:"场地冲洗"};
const sourceOf=(id:WaterSourceId)=>result.value?.sources.find(x=>x.id===id);
const format=new Intl.NumberFormat("zh-CN",{maximumFractionDigits:1});
function n(value:number|null|undefined):string{return value===null||value===undefined?"—":format.format(value);}
function money(value:number|null|undefined):string{return value===null||value===undefined?"暂不可比":(value<0?"−":"")+"¥"+n(Math.abs(value));}
function supplyFor(useId:WaterUseId, sourceId:WaterSourceId):number{
  return result.value?.allocations.find(x=>x.useId===useId&&x.sourceId===sourceId)?.volumeM3??0;
}
function percent(v:number,total:number):number{return total>0?Math.min(100,Math.max(0,v/total*100)):0;}
function run():void{
  try{
    const next=cloneMultiSource(editable);
    evaluateMultiSource(next);
    applied.value=next;error.value="";
    message.success("已重新计算水源匹配（MOCK数据）");
  }catch(e){error.value=(e as Error).message;message.error(error.value);}
}
function selectPreset(id:"normal"|"quality"|"shortage"):void{
  Object.assign(editable,cloneMultiSource());
  if(id==="quality"){
    for(const route of editable.routes)if(route.sourceId==="reclaimed")route.qualityAccepted=false;
  }else if(id==="shortage"){
    editable.sources.find(x=>x.id==="tap")!.availableM3=450;
    editable.sources.find(x=>x.id==="tap")!.deliverableM3=450;
    editable.sources.find(x=>x.id==="rain")!.availableM3=100;
    editable.sources.find(x=>x.id==="reclaimed")!.availableM3=100;
  }
  run();
}
function save():void{
  if (!result.value) return;
  try {
    const created = saveSupplyDraft(applied.value, result.value, store.role, localStorage);
    drafts.value = readDrafts<SupplyDraft>(MULTI_SOURCE_DRAFT_KEY, localStorage);
    showDrafts.value=true;
    message.success("已保存待人工审核草稿 "+created.id+"；没有下发设备控制");
  } catch(err) { message.error((err as Error).message); }
}

function exportCsv():void{
  if(!result.value)return;
  const rows:(string|number)[][]=[
    ["用水对象","需水量(m³)","雨水供给(m³)","中水供给(m³)","自来水供给(m³)","缺口(m³)","优先级"],
    ...result.value.uses.map(u=>[u.label,u.neededM3,supplyFor(u.id,"rain"),supplyFor(u.id,"reclaimed"),supplyFor(u.id,"tap"),u.unmetM3,u.priority]),
    ["合计",result.value.requestedM3,sourceOf("rain")?.usedM3??0,sourceOf("reclaimed")?.usedM3??0,sourceOf("tap")?.usedM3??0,result.value.unmetM3,""],
  ];
  const csv="\uFEFF"+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="三水源协同匹配-MOCK.csv";a.click();URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="multi-water">
    <WorkspaceNav label="水源优化与效益" :items="[{name:'水源分配',to:'/water/multi-source'},{name:'成本效益',to:'/water/green-benefit'}]" />
    <div class="water-header">
      <div>
        <div class="eyebrow">水资源管理 / 多水源协同利用</div>
        <h2>多水源供需与经济优化 <span>V1 · 单时段演示</span></h2>
        <p>先保障生产用水，再根据水质、管网和设备能力，选择满足需求且运行成本更合理的水源组合。</p>
      </div>
      <div class="header-actions"><NTag type="warning" size="small">MOCK · 无真实调度命令</NTag><NButton secondary size="small" @click="exportCsv">导出分配表</NButton></div>
    </div>

    <section class="scenario">
      <div><strong>快速体验一个供水决策</strong><span>三个演示场景：看正常配水、限制回用水质、验证供水不足时的风险</span></div>
      <div class="scenario-actions">
        <NButton secondary @click="selectPreset('normal')">正常多水源</NButton>
        <NButton secondary @click="selectPreset('quality')">模拟中水水质不达标</NButton>
        <NButton secondary @click="selectPreset('shortage')">模拟供水能力不足</NButton>
      </div>
    </section>

    <template v-if="result">
      <div class="metrics">
        <div class="metric"><span>本期用水需求</span><strong>{{ n(result.requestedM3) }}<em>m³</em></strong><small>三个业务用水对象 · {{ applied.periodHours }}小时</small></div>
        <div class="metric"><span>实际可匹配供水</span><strong :class="{ danger:!result.feasible }">{{ n(result.suppliedM3) }}<em>m³</em></strong><small>{{ result.feasible ? "已满足全部演示需求":"仍有用水缺口，不能视为可执行方案" }}</small></div>
        <div class="metric"><span>雨水 + 中水实际使用</span><strong>{{ n(result.nonTapSuppliedM3) }}<em>m³</em></strong><small>占已匹配水量 {{ n(percent(result.nonTapSuppliedM3,result.suppliedM3)) }}%</small></div>
        <div class="metric"><span>可比情景下的假设节约</span><strong :class="{ positive:result.savingVsTapYuan!==null&&result.savingVsTapYuan>0 }">{{ money(result.savingVsTapYuan) }}</strong><small>{{ result.savingVsTapYuan===null?"全自来水基准或当前方案不可执行":'比可行的全自来水替代情景降低 '+n(result.costSavingPercent)+'%' }}</small></div>
      </div>

      <div class="main-grid">
        <section class="panel supply-card">
          <div class="section-head">
            <div><h3>供水怎么分配？</h3><p>蓝色雨水 · 绿色中水 · 灰蓝自来水；配水量按实际通过约束的路径计算</p></div>
            <NTag :type="result.feasible?'success':'error'">{{ result.feasible?"需求全部满足":"供水能力不足" }}</NTag>
          </div>
          <div class="allotment" v-for="use in result.uses" :key="use.id">
            <div class="use-line">
              <div><strong>{{ use.label }}</strong><small>{{ use.priority===1?"优先保障":use.priority===2?"正常保障":"弹性用水" }}</small></div>
              <div><span>需求 {{ n(use.neededM3) }} m³</span><strong :class="{ shortage:use.unmetM3>0 }">{{ use.unmetM3>0?'缺口 '+n(use.unmetM3)+' m³':'已满足' }}</strong></div>
            </div>
            <div class="stack" :aria-label="use.label+'水源配比'">
              <div v-for="source in ['rain','reclaimed','tap'] as WaterSourceId[]" :key="source" :style="{width:percent(supplyFor(use.id,source),use.neededM3)+'%',background:sourceColors[source]}" :title="sourceNames[source]+' '+n(supplyFor(use.id,source))+'m³'" />
              <div v-if="use.unmetM3>0" class="unmet" :style="{width:percent(use.unmetM3,use.neededM3)+'%'}" :title="'缺口 '+n(use.unmetM3)+'m³'"/>
            </div>
            <div class="source-figures">
              <span v-for="source in ['rain','reclaimed','tap'] as WaterSourceId[]" :key="source"><i :style="{background:sourceColors[source]}"></i>{{ sourceNames[source] }} {{ n(supplyFor(use.id,source)) }}</span>
            </div>
          </div>
          <div class="chart-bottom"><strong>优化原则</strong><span>先保证优先级较高的用水，再对同级需求寻找满足水质、管网与能力限制的较低成本供水路径。</span></div>
        </section>
        <aside class="panel advice-card">
          <div class="section-head"><div><h3>系统建议</h3><p>解释为什么这样配水，而不是只给出一个数字</p></div></div>
          <div v-if="result.feasible" class="advice-status"><span class="dot"></span>演示方案可满足当前用水</div>
          <div v-else class="advice-status dangerous"><span class="dot"></span>存在缺口，需要人工核实供水保障</div>
          <p class="advice-message">{{ result.feasible ? "优先保证关键生产补水，用符合用途和管网条件的雨水、中水满足非关键需求；不足部分再由自来水补足。":"系统已将可用水量优先分配给关键生产用水，但仍有需求无法满足。应核实补水能力、设备状态及可调整的弹性用水计划。" }}</p>
          <div class="bill-line"><span>方案总增量运行费用</span><strong>{{ money(result.totalCostYuan) }}</strong></div>
          <div class="bill-line"><span>全自来水可行比较基准</span><strong>{{ money(result.allTapBaselineYuan) }}</strong></div>
          <div class="bill-line"><span>相对比较情景减少购水量</span><strong>{{ result.tapAvoidedM3===null?"暂不可比":n(result.tapAvoidedM3)+" m³" }}</strong></div>
          <div class="bill-line"><span>未满足需求</span><strong :class="{shortage:result.unmetM3>0}">{{ n(result.unmetM3) }} m³</strong></div>
          <div class="advice-action">
            <NButton type="primary" block :disabled="!canSave||!result.feasible" @click="save">保存待审核的供水建议</NButton>
            <small>{{ result.feasible ? "草稿仅保存在本地浏览器，不触发设备启停或设定值更改。":"仍有需求缺口，暂不能保存为完整供水方案。" }}</small>
          </div>
        </aside>
      </div>

      <section class="panel">
        <div class="section-head"><div><h3>三种水源还有多少可用量？</h3><p>用独立库存与本时段供水能力的较小值作为源端上限，不把雨水处理形成的中水重复算成一份水</p></div><NButton size="small" secondary @click="showDetails=!showDetails">{{ showDetails?"收起明细":"查看用水明细" }}</NButton></div>
        <div class="source-grid">
          <div v-for="source in result.sources" :key="source.id" class="source-card">
            <div class="source-header"><span class="source-icon" :style="{background:sourceColors[source.id]}"></span><strong>{{ sourceNames[source.id] }}</strong><span>{{ n(source.usedM3) }} m³ 已使用</span></div>
            <div class="source-progress"><span :style="{width:percent(source.usedM3,source.limitM3)+'%',background:sourceColors[source.id]}"></span></div>
            <div class="source-meta"><span>本期有效上限 {{ n(source.limitM3) }} m³</span><span>未使用 {{ n(source.remainingM3) }} m³</span></div>
          </div>
        </div>
        <div v-if="showDetails" class="table-wrap">
          <table><thead><tr><th>用水用途</th><th>需求m³</th><th>雨水m³</th><th>中水m³</th><th>自来水m³</th><th>缺口m³</th></tr></thead>
            <tbody><tr v-for="use in result.uses" :key="use.id"><td>{{ use.label }}</td><td>{{ n(use.neededM3) }}</td><td>{{ n(supplyFor(use.id,'rain')) }}</td><td>{{ n(supplyFor(use.id,'reclaimed')) }}</td><td>{{ n(supplyFor(use.id,'tap')) }}</td><td :class="{shortage:use.unmetM3>0}">{{ n(use.unmetM3) }}</td></tr></tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="section-head"><div><h3>计算条件与工程约束</h3><p>默认仅展示结果；专业人员可展开调整库存、水质适用、管网连通、供水能力和单方成本。</p></div><NButton size="small" secondary @click="showConfig=!showConfig">{{ showConfig?'收起配置':'调整供水条件' }}</NButton></div>
        <div v-if="showConfig" class="config-area">
          <div class="context-line"><span>演示时间跨度（小时）</span><NInputNumber v-model:value="editable.periodHours" :min="1" :max="720" :precision="0" size="small" /></div>
          <NCheckbox v-model:checked="editable.separateStockConfirmed">演示假设：雨水与中水为独立、已经分别核实的当前可用库存</NCheckbox>
          <p class="config-note">取消勾选后两类非自来水均不能参与优化，防止把雨水与其处理产生的中水重复计量。真实项目应来自带有来源标识的库存台账。</p>
          <div class="config-title">水源库存、供水能力与单方费用</div>
          <div class="config-grid source-parameters" v-for="source in editable.sources" :key="source.id">
            <strong>{{ sourceNames[source.id] }}</strong>
            <label><span>独立可用量(m³)</span><NInputNumber v-model:value="source.availableM3" :min="0" size="small"/></label>
            <label><span>本时段能力(m³)</span><NInputNumber v-model:value="source.deliverableM3" :min="0" size="small"/></label>
            <label><span>增量成本(元/m³)</span><NInputNumber v-model:value="source.unitCostYuanM3" :min="0" :precision="2" size="small"/></label>
          </div>
          <div class="config-title">分用途需水量与保障优先级</div>
          <div class="config-grid demand-parameters" v-for="use in editable.demands" :key="use.id">
            <strong>{{ usedNames[use.id] }}</strong>
            <label><span>需水量(m³)</span><NInputNumber v-model:value="use.neededM3" :min="0" size="small"/></label>
            <span class="priority-info">{{ use.priority===1?"关键生产优先":use.priority===2?"第二级保障":"第三级弹性需求" }}</span>
          </div>
          <div class="matrix-toggle"><NButton secondary size="small" @click="showRoute=!showRoute">{{ showRoute?"收起路径矩阵":"查看/编辑9条供水路径的水质与连通性" }}</NButton></div>
          <div v-if="showRoute" class="route-grid">
            <div v-for="route in editable.routes" :key="route.sourceId+route.useId" class="route-item">
              <strong>{{ sourceNames[route.sourceId] }} → {{ usedNames[route.useId] }}</strong>
              <NCheckbox v-model:checked="route.qualityAccepted">水质适用（演示确认）</NCheckbox>
              <NCheckbox v-model:checked="route.connected">管网连通（演示确认）</NCheckbox>
              <label><span>该路径上限m³</span><NInputNumber v-model:value="route.limitM3" :min="0" size="small"/></label>
            </div>
          </div>
          <p v-if="error" class="error">{{ error }}</p>
          <div class="config-actions"><span v-if="dirty">参数有修改，请重新计算后查看结果。</span><NButton secondary @click="selectPreset('normal')">恢复演示值</NButton><NButton type="primary" @click="run">重新计算</NButton></div>
        </div>
      </section>

      <section class="panel">
        <div class="section-head"><div><h3>可信度与使用边界</h3><p>把尚未核实的工程条件明确列出，不输出没有依据的节约承诺</p></div></div>
        <div class="boundary"><div v-for="(warning,i) in result.warnings" :key="'w'+i"><span>!</span>{{ warning }}</div></div>
        <details class="calculation"><summary>查看计算检查项（{{ result.checks.length }}项）</summary><p v-for="(check,i) in result.checks" :key="i">{{ i+1 }}. {{ check }}</p></details>
      </section>

      <section v-if="drafts.length" class="panel">
        <div class="section-head"><div><h3>待审核供水建议草稿</h3><p>本地MOCK记录，不是执行调度令，也不写入实际运行水量账本。</p></div><NButton size="small" secondary @click="showDrafts=!showDrafts">{{ showDrafts?"收起草稿":"查看草稿（"+drafts.length+"）" }}</NButton></div>
        <div v-if="showDrafts" class="draft-list">
          <div v-for="draft in drafts.slice(0,10)" :key="draft.id" class="draft"><strong>{{ draft.id }} · {{ draft.name }}</strong><small>{{ new Date(draft.createdAt).toLocaleString('zh-CN',{hour12:false}) }} · {{ draft.createdBy }} · 待审核</small><span>需水 {{ n(draft.result.suppliedM3) }}m³ / 节约 {{ money(draft.result.savingVsTapYuan) }} / 仅供演示</span></div>
        </div>
      </section>
      <p class="footer-note">演示说明：未接真实水质检验、管线、泵组、电价水价、生产调度与独立库存计量。计算仅在已配置的静态可用水量和路径约束下分配；不执行水泵、阀门及工艺参数控制。</p>
    </template>
    <div v-else class="panel error">当前参数无法计算，请恢复演示配置。</div>
  </div>
</template>

<style scoped>
.multi-water{color:#244865;display:grid;gap:14px;padding-bottom:26px}
.water-header{background:linear-gradient(110deg,#e3f3fd,#f8fcff 61%,#e6f6f4);border:1px solid #d3e6f0;border-radius:11px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px 24px}
.eyebrow{font-size:12px;color:#5290ab;margin-bottom:6px}
.water-header h2{margin:0;font-size:23px;color:#174260}
.water-header h2 span{font-size:12px;font-weight:500;color:#7c9ba9}
.water-header p{font-size:12px;color:#7696a6;line-height:1.7;margin:7px 0 0}
.header-actions{display:flex;align-items:center;flex-wrap:wrap;gap:9px}
.scenario,.panel,.metric{background:#fff;border-radius:10px;border:1px solid #dceaf3;box-shadow:0 5px 18px #336c8b09}
.scenario{padding:14px 18px;background:#f9fcff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.scenario>div:first-child{display:grid;gap:5px}.scenario strong{font-size:13px}.scenario span{font-size:11px;color:#91a5b5}
.scenario-actions{display:flex;flex-wrap:wrap;gap:7px}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.metric{padding:17px 18px;display:grid;gap:6px}.metric>span{font-size:12px;color:#7996a7}
.metric strong{font-size:27px;line-height:1.35;color:#1c6d94}.metric strong.danger{color:#cb5752}.metric strong.positive{color:#1a9b7b}
.metric em{font-size:13px;font-style:normal;font-weight:500;margin-left:5px;color:#90a7b5}.metric small{font-size:11px;line-height:1.55;color:#8ca6b6}
.main-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(290px,.92fr);gap:13px;align-items:stretch}
.panel{padding:19px;min-width:0}.section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:15px}
.section-head h3{font-size:16px;color:#2c5875;margin:0}.section-head p{font-size:11px;color:#91a6b5;line-height:1.65;margin:5px 0 0}
.allotment{border-top:1px solid #e7f0f6;padding:14px 0}.use-line{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.use-line>div{display:grid;gap:4px}.use-line strong{font-size:13px;color:#36627c}.use-line small{font-size:10px;color:#8da5b4}.use-line div:last-child{text-align:right}.use-line div:last-child span{font-size:11px;color:#93a9b7}.use-line div:last-child strong{color:#1b9b79}.use-line div:last-child .shortage,.shortage{color:#d35751!important}
.stack{height:15px;background:#eff2f5;border-radius:4px;display:flex;overflow:hidden}
.stack div{height:100%;transition:width .28s}.stack .unmet{background:repeating-linear-gradient(45deg,#ffd9cf,#ffd9cf 5px,#f0a8a1 5px,#f0a8a1 10px)}
.source-figures{display:flex;justify-content:flex-start;gap:19px;flex-wrap:wrap;margin-top:10px}
.source-figures span{font-size:11px;color:#7492a5;display:inline-flex;gap:6px;align-items:center}
.source-figures i{display:inline-block;width:9px;height:9px;border-radius:2px}.chart-bottom{padding:12px;background:#f4f9fc;border-radius:8px;display:flex;gap:10px;align-items:flex-start}.chart-bottom strong{font-size:11px;white-space:nowrap;color:#307498}.chart-bottom span{font-size:11px;color:#7b99ac;line-height:1.6}
.advice-card{background:linear-gradient(160deg,#eff9ff,#fff 47%);display:flex;flex-direction:column}
.advice-status{display:flex;align-items:center;gap:8px;color:#118e70;font-size:14px;font-weight:700}.advice-status.dangerous{color:#d35652}
.dot{width:10px;height:10px;border-radius:50%;background:currentColor}.advice-message{font-size:12px;line-height:1.9;color:#748d9e;margin:15px 0}
.bill-line{display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid #e6edf3;padding:12px 0;font-size:12px}
.bill-line span{color:#839caf}.bill-line strong{font-size:13px;color:#316483;white-space:nowrap}.advice-action{margin-top:auto;padding-top:20px}
.advice-action small{display:block;color:#99aab7;font-size:11px;line-height:1.7;margin-top:10px}
.source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.source-card{background:#f9fcfe;border:1px solid #e1edf5;border-radius:9px;padding:13px;min-width:0}
.source-header{display:flex;align-items:center;gap:7px}.source-icon{width:9px;height:9px;border-radius:50%;flex:none}.source-header strong{font-size:12px;color:#315e7a}.source-header>span:last-child{margin-left:auto;color:#63899e;font-size:11px;white-space:nowrap}
.source-progress{height:8px;border-radius:4px;background:#e6eff4;overflow:hidden;margin:14px 0 8px}.source-progress span{height:100%;display:block}
.source-meta{display:flex;justify-content:space-between;gap:5px;flex-wrap:wrap;font-size:10px;color:#9baebc}
.table-wrap{overflow-x:auto;margin-top:16px}.table-wrap table{border-collapse:collapse;width:100%;min-width:620px}.table-wrap th{font-size:11px;font-weight:600;color:#7b9cac;background:#f3f9fc;text-align:left;padding:12px}.table-wrap td{font-size:12px;padding:11px;border-bottom:1px solid #eaf1f6}
.config-area{border-top:1px solid #eaf0f5;padding-top:16px}.config-note,.footer-note{font-size:11px;color:#8ba5b5;line-height:1.8}
.context-line{display:flex;gap:12px;align-items:center;margin-bottom:14px;font-size:12px}.context-line :deep(.n-input-number){width:130px}
.config-title{font-size:13px;color:#316780;font-weight:700;margin:20px 0 10px}
.config-grid{display:grid;gap:12px;align-items:end;padding:10px;border:1px solid #e5eef4;border-radius:8px;background:#fbfdfe;margin-bottom:8px}
.source-parameters{grid-template-columns:140px repeat(3,minmax(0,1fr))}.demand-parameters{grid-template-columns:140px 160px 1fr;align-items:center}
.config-grid strong{font-size:12px;color:#426c87}.config-grid label{display:grid;gap:6px;min-width:0}.config-grid label span{font-size:11px;color:#86a1b0}.config-grid :deep(.n-input-number){width:100%}
.priority-info{color:#819bab;font-size:11px}.matrix-toggle{margin:14px 0}.route-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.route-item{border:1px solid #e0edf5;background:#f8fbfe;border-radius:8px;padding:12px;display:grid;gap:10px}
.route-item strong{font-size:12px}.route-item :deep(.n-checkbox){font-size:11px}.route-item label{display:grid;gap:6px}.route-item label span{font-size:10px;color:#93a8b5}
.route-item :deep(.n-input-number){width:100%}.config-actions{display:flex;justify-content:flex-end;gap:9px;align-items:center;margin-top:17px}.config-actions span{font-size:11px;color:#b58a49;margin-right:auto}
.error{font-size:12px;color:#bb5555}
.boundary{display:grid;gap:8px}.boundary>div{font-size:12px;line-height:1.7;color:#748e9f;padding:8px 10px;border:1px solid #e5eff5;background:#fafcfe;border-radius:7px;display:flex;gap:9px}
.boundary>div>span{color:#d49b4a;font-weight:800}.calculation{margin-top:13px;border-top:1px solid #e8f0f5;padding-top:12px}.calculation summary{font-size:12px;color:#2486b5;cursor:pointer}.calculation p{font-size:11px;line-height:1.8;color:#829caa}
.draft-list{display:grid;gap:7px}.draft{padding:12px;background:#f7fafc;border-radius:8px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:11px}.draft strong{color:#36728d}.draft small{color:#93a6b4}.draft span{color:#5f8aa0}
@media(max-width:1250px){.main-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.source-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:750px){.source-parameters{grid-template-columns:1fr 1fr}.route-grid{grid-template-columns:1fr 1fr}.water-header{flex-direction:column;align-items:flex-start}.source-grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}}
@media(max-width:530px){.metrics,.route-grid,.source-parameters{grid-template-columns:1fr}.demand-parameters{grid-template-columns:1fr 1fr}.source-figures{gap:9px}.config-actions{flex-wrap:wrap}.scenario-actions{display:grid;grid-template-columns:1fr}}
</style>

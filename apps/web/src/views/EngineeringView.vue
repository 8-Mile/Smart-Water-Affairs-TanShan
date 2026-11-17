<script setup lang="ts">
import {computed,ref,watch} from "vue";
import EngineeringTopologyPanel from "../components/EngineeringTopologyPanel.vue";
import EngineeringCoveragePanel from "../components/EngineeringCoveragePanel.vue";
import BasinRegistryPanel from "../components/BasinRegistryPanel.vue";
import BasinBalancePanel from "../components/BasinBalancePanel.vue";
import {useRoute,useRouter} from "vue-router";
import {NButton,NInput,NSelect,NTag,useMessage} from "naive-ui";
import {useDemoStore} from "../demo/store";
import {can} from "../demo/permissions";
import {
 ENGINEERING_BASELINE,ENGINEERING_REQUIREMENTS,ENGINEERING_POINTS,
 ENGINEERING_ISSUES,ENGINEERING_HARDWARE_RULES,
 ENGINEERING_STATUS_LABELS,ENGINEERING_CATALOG,
 readEngineeringReviews,submitEngineeringEvidence,reviewEngineeringEvidence,
 engineeringReadiness,type EngineeringEntry,type EngineeringKind,
} from "../demo/engineering";

const route=useRoute(),router=useRouter(),demo=useDemoStore(),message=useMessage();
type EngineeringWorkspace="checks"|"topology"|"coverage"|"basins"|"balance";
const workspace=ref<EngineeringWorkspace>(
  route.query.focus==="topology"?"topology":route.query.focus==="coverage"?"coverage":route.query.focus==="basins"?"basins":route.query.focus==="balance"?"balance":"checks"
);
function switchWorkspace(next:EngineeringWorkspace){
  workspace.value=next;
  if(next==="checks"){
    const id=selectedId.value;
    void router.replace({path:route.path,query:{item:id}});
  }else{
    void router.replace({path:route.path,query:{focus:next}});
  }
}
const tab=ref<EngineeringKind>("check");
const filter=ref("全部范围"),keyword=ref("");
const records=ref(readEngineeringReviews(localStorage));
const selectedId=ref("CK-001"),evidenceRef=ref(""),evidenceNote=ref(""),reviewNote=ref("");
const canSubmit=computed(()=>can(demo.role,"engineering:submit"));
const canReview=computed(()=>can(demo.role,"engineering:review"));
const ready=computed(()=>engineeringReadiness(records.value));
const currentItems=computed(()=>ENGINEERING_CATALOG.filter(x=>x.kind===tab.value));
const options=computed(()=>[...new Set(currentItems.value.map(x=>x.scope))].sort().map(value=>({label:value,value})));
const filtered=computed(()=>currentItems.value.filter(x=>(filter.value==="全部范围"||x.scope===filter.value)&&
 (!keyword.value.trim()||[x.id,x.scope,x.title,x.detail,x.blocker].join(" ").toLowerCase().includes(keyword.value.trim().toLowerCase()))));
const selected=computed(()=>filtered.value.find(x=>x.id===selectedId.value)??filtered.value[0]??null);
const selectedRecord=computed(()=>records.value.find(x=>x.id===selected.value?.id)??null);
const labels:Record<EngineeringKind,string>={check:"P0核查任务",instrument:"测点与硬件",requirement:"业务与建设需求",issue:"工程口径冲突"};
const processRoutes:Record<string,string>={
 "雨水收集":"/process/rainwater","含矿污水处理":"/process/mining",
 "中压供水":"/process/medium-pressure","射雾器除尘":"/process/spray",
 "水池供水（DEMO）":"/process/pool","生活污水处理":"/process/domestic",
};
function linkFor(item:EngineeringEntry):string{
 if(item.scope==="池容与水路"||item.scope==="污水处理与消纳")return "/water/port-chain";
 if(item.scope==="供水与生产保障")return "/intelligent/correlation";
 return processRoutes[item.scope]??"/water/port-chain";
}
function stateOf(item:EngineeringEntry){return ENGINEERING_STATUS_LABELS[records.value.find(x=>x.id===item.id)?.state??"unverified"];}
function choose(entry:EngineeringEntry){
 selectedId.value=entry.id;evidenceRef.value="";evidenceNote.value="";reviewNote.value="";
 void router.replace({path:route.path,query:{item:entry.id}});
}
function chooseTab(next:EngineeringKind){
 tab.value=next;filter.value="全部范围";keyword.value="";
 const first=ENGINEERING_CATALOG.find(x=>x.kind===next);
 if(first)choose(first);
}
watch(()=>[route.query.item,route.query.focus],()=>{
 const id=typeof route.query.item==="string"?route.query.item:"";
 const found=ENGINEERING_CATALOG.find(x=>x.id===id);
 if(found){
  workspace.value="checks";tab.value=found.kind;selectedId.value=found.id;
  filter.value="全部范围";keyword.value="";
 }else if(route.query.focus==="topology"||route.query.focus==="coverage"||route.query.focus==="basins"||route.query.focus==="balance"){
  workspace.value=route.query.focus;
 }else{
  workspace.value="checks";
 }
},{immediate:true});
function refresh(){records.value=readEngineeringReviews(localStorage);}
function submit(){
 if(!selected.value)return;
 try{
  submitEngineeringEvidence(localStorage,selected.value.id,demo.role,evidenceRef.value,evidenceNote.value,new Date().toISOString());
  refresh();message.success("依据登记完成，仅待人工DEMO资料复核，不代表现场批准或设备已安装");
 }catch(err){message.error((err as Error).message);}
}
function review(decision:"reviewed_demo"|"blocked"){
 if(!selected.value)return;
 try{
  reviewEngineeringEvidence(localStorage,selected.value.id,demo.role,decision,reviewNote.value,new Date().toISOString());
  refresh();message.success(decision==="blocked"?"已退回证据，不改变工程事实":"完成DEMO资料审阅，工程仍须正式签认");
 }catch(err){message.error((err as Error).message);}
}
const selectedSource=computed(()=>selected.value?ENGINEERING_BASELINE+" · "+selected.value.sourceRef:"");
</script>

<template>
 <section class="engineering">
  <header class="hero" :class="{compact:workspace==='basins'||workspace==='balance'}">
   <div>
    <div class="eyebrow">唐港智慧水务 V3.3 / 工程基础与证据</div>
    <h2>工程事实 · 仪表能力 · 建设缺口</h2>
    <p>先核查正式设计、控制边界和现场能力，再决定复用、补点或改造。这里的台账来自原P0工程核查工作簿，不将MOCK或内部设计估算认定为竣工事实。</p>
   </div>
   <NTag type="warning" size="small">工程正式签认 0 项 · 不放行自动控制</NTag>
  </header>
  <div v-if="workspace==='checks'||workspace==='topology'||workspace==='coverage'" class="metrics">
   <div><span>六工艺与共性建设需求</span><strong>{{ ENGINEERING_REQUIREMENTS.length }}</strong><small>原工作簿 REQ 项</small></div>
   <div><span>测点与硬件核查</span><strong>{{ ENGINEERING_POINTS.length }}</strong><small>优先复用，缺口才评估采购</small></div>
   <div><span>P0现场核查</span><strong>{{ ready.total }}</strong><small>{{ ready.submitted }} 项资料待复核</small></div>
   <div class="risk"><span>工程口径冲突 / 放行状态</span><strong>{{ ENGINEERING_ISSUES.length }} <small>项</small></strong><small>正式工程已放行 {{ ready.fieldApproved }} 项</small></div>
  </div>
  <div v-if="workspace==='checks'||workspace==='topology'||workspace==='coverage'" class="gate-banner">
    <div><strong><span class="gate-dot"></span> G0 工程事实未签认</strong><span>逐池有效库容、处理出水去向、PLC/SCADA点表和各系统资产边界仍待设计、业主和自控专业核验。</span></div>
    <div><strong><span class="gate-dot"></span> G1 数据接入未放行</strong><span>本期没有可靠现场计量覆盖率、时标和质量码的验收依据；停机设备也不自动算作可投运备用。</span></div>
    <div><strong><span class="gate-dot"></span> G2 控制与合规未放行</strong><span>合法排口、水质用途和PLC本地联锁未经工程确认，网页与AI仅做只读辅助及MOCK方案演练。</span></div>
  </div>
  <div v-if="workspace==='basins'||workspace==='balance'" class="compact-gates">
    <strong>工程资料门槛</strong><span>G0 图纸与池容未正式签认</span>
    <span>G1 真实计量未接入验收</span><span>G2 自动控制与排放未放行</span>
  </div>
  <nav class="workspace-tabs" aria-label="工程基础工作区">
    <button type="button" :class="{active:workspace==='checks'}" :aria-current="workspace==='checks'?'page':undefined"
      @click="switchWorkspace('checks')">
      <span>01 / P0工程核查</span><strong>49需求 · 41测点 · 31任务</strong>
    </button>
    <button type="button" :class="{active:workspace==='topology'}" :aria-current="workspace==='topology'?'page':undefined"
      @click="switchWorkspace('topology')">
      <span>02 / 水路与控制关系</span><strong>10条未核实关系 · 防止假联通</strong>
    </button>
    <button type="button" :class="{active:workspace==='coverage'}" :aria-current="workspace==='coverage'?'page':undefined"
      @click="switchWorkspace('coverage')">
      <span>03 / 数据接入能力</span><strong>六工艺测点质量 · 现场验收0</strong>
    </button>
    <button type="button" :class="{active:workspace==='basins'}" :aria-current="workspace==='basins'?'page':undefined"
      @click="switchWorkspace('basins')">
      <span>04 / 逐池设施台账</span><strong>V-H容量曲线 · 液位点一对一关联</strong>
    </button>
    <button type="button" :class="{active:workspace==='balance'}" :aria-current="workspace==='balance'?'page':undefined"
      @click="switchWorkspace('balance')">
      <span>05 / 单池水量核查</span><strong>同期水量平衡 · 人工确认</strong>
    </button>
  </nav>
  <EngineeringTopologyPanel v-if="workspace==='topology'" />
  <EngineeringCoveragePanel v-if="workspace==='coverage'" />
  <BasinRegistryPanel v-if="workspace==='basins'" />
  <BasinBalancePanel v-if="workspace==='balance'" />
  <div v-if="workspace==='checks'" class="workspace">
   <section class="panel list-panel">
    <div class="panel-heading"><div><h3>工程核查台账</h3><p>可追溯到原工作簿的单元格编号</p></div></div>
    <div class="tabs" role="tablist" aria-label="工程台账类型">
     <button v-for="(name,key) in labels" :key="key" type="button" role="tab" :aria-selected="tab===key"
      :class="{active:tab===key}" @click="chooseTab(key as EngineeringKind)">{{ name }}</button>
    </div>
    <div class="filter-row">
     <NInput v-model:value="keyword" clearable size="small" placeholder="按编号、工艺、问题、缺口搜索"/>
     <NSelect v-model:value="filter" size="small" :options="[{label:'全部范围',value:'全部范围'},...options]" style="width:175px;flex:none"/>
    </div>
    <div class="list-count">显示 {{ filtered.length }}/{{ currentItems.length }} 项 · 所有状态以已提交核查记录为准</div>
    <div class="entry-list">
     <button v-for="item in filtered" :key="item.id" type="button" class="entry" :class="{selected:selected?.id===item.id}" @click="choose(item)">
      <div class="entry-title"><b>{{ item.id }}</b><NTag size="tiny" :type="item.kind==='issue'?'error':item.priority==='P0'?'warning':'default'">{{ item.priority }}</NTag></div>
      <strong>{{ item.title }}</strong>
      <p>{{ item.scope }} · {{ item.detail }}</p>
      <span>{{ stateOf(item) }}</span>
     </button>
     <p v-if="!filtered.length" class="empty">没有匹配结果。可以修改工艺范围或检索关键字。</p>
    </div>
   </section>
   <section class="panel detail-panel">
    <template v-if="selected">
     <div class="detail-top">
      <div><span class="eyebrow">{{ labels[selected.kind] }} / {{ selected.scope }}</span><h3>{{ selected.id }} · {{ selected.title }}</h3></div>
      <NTag :type="selectedRecord?.state==='reviewed_demo'?'info':selectedRecord?.state==='blocked'?'error':'warning'" size="small">{{ stateOf(selected) }}</NTag>
     </div>
     <div class="fact-grid">
      <div><small>当前判断/业务目标</small><p>{{ selected.detail }}</p></div>
      <div><small>当前阻断条件</small><p>{{ selected.blocker }}</p></div>
      <div><small>建议责任方</small><p>{{ selected.owner??'依工艺/自控/业主责任矩阵认定' }}</p></div>
      <div><small>需要的验收依据</small><p>{{ selected.acceptance??'设计、采购及现场资料对照记录' }}</p></div>
     </div>
     <div class="source-box">
      <div><strong>工作簿追溯</strong><span>{{ selectedSource }}</span></div>
      <p>来源为前期方案分析台账，属于工程核查要求，不是现场测点已安装、真实管线已建或数据已接入的证明。</p>
     </div>
     <div class="detail-actions">
      <router-link :to="linkFor(selected)">进入关联业务页面</router-link>
      <router-link to="/water/port-chain">查看港口三条业务链</router-link>
      <router-link to="/archives">查看工程档案</router-link>
     </div>
     <section class="review">
      <h4>登记核查依据 <small>所有记录仅本地DEMO，非正式审批</small></h4>
      <div class="fields">
       <label><span>图纸号、合同编号或现场记录编号</span><NInput v-model:value="evidenceRef" size="small" :disabled="!canSubmit" placeholder="例如：P&ID-待核-001（示例占位符）"/></label>
       <label><span>核查情况、缺口及需谁签认</span><NInput v-model:value="evidenceNote" type="textarea" :rows="3" :disabled="!canSubmit" placeholder="至少8字；不得把尚未核实的设施标成已投运"/></label>
      </div>
      <NButton type="primary" size="small" :disabled="!canSubmit" @click="submit">提交资料待复核</NButton>
      <p v-if="!canSubmit" class="hint">当前角色仅可查看；需工程或管理岗位提交资料。</p>
      <div v-if="selectedRecord" class="submitted">
       <strong>已登记资料 {{ selectedRecord.evidenceRef }}</strong>
       <p>{{ selectedRecord.note }}</p>
       <small>{{ selectedRecord.submittedBy }} · {{ selectedRecord.submittedAt.slice(0,19).replace('T',' ') }} · {{ ENGINEERING_STATUS_LABELS[selectedRecord.state] }}</small>
       <div v-if="selectedRecord.state==='submitted'&&canReview" class="review-form">
        <NInput v-model:value="reviewNote" size="small" placeholder="填写至少8字的审核意见（仅DEMO）"/>
        <div><NButton size="small" secondary @click="review('blocked')">证据不足，退回</NButton>
         <NButton size="small" type="primary" @click="review('reviewed_demo')">完成DEMO资料审阅</NButton></div>
       </div>
       <details class="audit"><summary>完整变更与复核日志（{{ selectedRecord.history.length }}）</summary>
        <div v-for="(h,i) in selectedRecord.history" :key="i"><strong>{{ h.action }}</strong><small>{{ h.by }} · {{ h.at }}</small><p>{{ h.note }}</p></div>
       </details>
      </div>
      <p class="legal-boundary">管理者在本DEMO中确认资料已审阅，不等于设计院、监理、业主或专业主管部门正式签认；G0/G1/G2工程放行始终保持未批准状态。</p>
     </section>
    </template>
   </section>
  </div>
  <section v-if="workspace==='checks'||workspace==='topology'||workspace==='coverage'" class="panel procurement">
   <div class="panel-heading"><div><h3>软硬件采购决策 · A / B / C</h3><p>先判断存在的是业务问题、计量问题，还是工艺与自动化问题；不按六套系统机械配置六套网关或AI服务器。</p></div></div>
   <div class="purchase-grid"><div v-for="rule in ENGINEERING_HARDWARE_RULES" :key="rule.id"><strong>{{ rule.title }}</strong><p>{{ rule.condition }}</p><span>{{ rule.decision }}</span></div></div>
   <p class="purchase-foot">现场防护必须考虑盐雾、粉尘、潮湿腐蚀、雷电、工控安全边界及设备检修条件。无点表/合同/现场安装条件之前，不列采购数量和品牌。</p>
  </section>
 </section>
</template>

<style scoped>
 .compact-gates{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid #ebdfcd;background:#fffaf4;padding:11px 15px;border-radius:8px;color:#a08462;font-size:11px}
.compact-gates strong{color:#956d47}.compact-gates span{border-left:1px solid #e5d6c2;padding-left:10px}
.workspace-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}
.workspace-tabs button{text-align:left;display:grid;gap:7px;min-width:0;background:linear-gradient(130deg,#f6fafc,#fff);padding:15px;border:1px solid #dbeaf1;border-radius:9px;cursor:pointer;color:#628ba1}
.workspace-tabs button.active{background:linear-gradient(130deg,#e9f6fb,#fff);border-color:#8bc5d9;box-shadow:inset 3px 0 0 #2c98bc}
.workspace-tabs button span{font-size:12px;font-weight:700;color:#3d7a97}
.workspace-tabs button strong{font-size:11px;font-weight:500;color:#8ea5b1;line-height:1.6}
@media(max-width:1050px){.workspace-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:650px){.workspace-tabs{grid-template-columns:1fr}}

.engineering{display:grid;gap:14px;min-width:0;color:#335a75;padding-bottom:30px}
.hero.compact{padding:10px 17px;min-height:0}.hero.compact p{display:none}.hero.compact h2{font-size:19px;margin:3px 0}.hero.compact .eyebrow{font-size:10px}
.hero{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:23px 26px;border:1px solid #d5e7f2;border-radius:12px;background:linear-gradient(108deg,#e4f1fa,#f9fcff 55%,#eff9f6)}
.eyebrow{font-size:11px;color:#7295ac}.hero h2{margin:7px 0;font-size:23px;color:#265a77}.hero p{max-width:920px;font-size:12px;line-height:1.8;color:#7898ac;margin:0}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metrics>div,.panel{border:1px solid #dae8f0;border-radius:10px;background:#fff;box-shadow:0 6px 20px #25678309}
.metrics>div{padding:17px;display:grid;gap:7px}.metrics span{color:#829ead;font-size:11px}.metrics strong{color:#286f92;font-size:28px;font-variant-numeric:tabular-nums}.metrics strong small{font-size:12px}.metrics small{color:#9aadb8;font-size:10px}.metrics .risk strong{color:#c1855e}
.gate-banner{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}.gate-banner>div{border:1px solid #eddfca;background:#fffbf3;padding:13px;border-radius:9px;display:grid;gap:6px}.gate-banner strong{font-size:12px;color:#8f7151}.gate-banner span{font-size:11px;line-height:1.6;color:#a18d75}.gate-dot{width:7px;height:7px;display:inline-block;border-radius:50%;background:#d29457;margin-right:7px}
.panel{padding:17px}.workspace{display:grid;grid-template-columns:minmax(350px,.85fr) minmax(0,1.3fr);align-items:start;gap:13px}.panel-heading h3,.detail-top h3{font-size:16px;color:#2e6785;margin:0}.panel-heading p{font-size:11px;line-height:1.7;color:#8ba5b4;margin:7px 0 0}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 12px}.tabs button{border:1px solid #deebf2;padding:8px 10px;border-radius:7px;background:#f8fbfd;color:#65869b;font-size:11px;cursor:pointer}.tabs button.active{background:#e8f6fd;border-color:#91cde6;color:#257ca6;font-weight:700}
.filter-row{display:flex;gap:9px;min-width:0}.list-count{padding:12px 0 8px;color:#9aadb9;font-size:10px}
.entry-list{display:grid;gap:6px;max-height:595px;overflow-y:auto;padding-right:5px}.entry{display:grid;gap:6px;width:100%;text-align:left;background:#fafdfe;border:1px solid #e6eef3;border-radius:8px;padding:12px;cursor:pointer;color:inherit}.entry.selected{background:#edf8fc;border-color:#8bc9e4}.entry-title{display:flex;justify-content:space-between;align-items:center}.entry-title b{font-size:11px;color:#2585aa}.entry strong{font-size:13px;color:#346d8c}.entry p{font-size:11px;color:#8b9fab;margin:0;line-height:1.6}.entry span{font-size:10px;color:#a37e5d}.empty{padding:24px;text-align:center;color:#93aabb;font-size:12px}
.detail-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid #e7f0f4;padding-bottom:14px}.detail-top h3{margin:8px 0 0}
.fact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.fact-grid>div{background:#f7fafc;border-radius:8px;padding:12px}.fact-grid small{font-size:10px;color:#9aacb7}.fact-grid p{font-size:12px;color:#436f86;margin:7px 0 0;line-height:1.7}
.source-box{border:1px solid #d5e8ef;border-radius:8px;background:#f1f9fc;padding:12px;margin-top:12px}.source-box>div{display:grid;gap:7px}.source-box strong{font-size:11px;color:#397c97}.source-box span{font-size:11px;color:#608ba2;overflow-wrap:anywhere}.source-box p{font-size:10px;color:#8ca6b3;margin:8px 0 0;line-height:1.7}
.detail-actions{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0;padding-bottom:13px;border-bottom:1px solid #e6eff4}.detail-actions a{font-size:11px;color:#1681ab;text-decoration:none}.review h4{font-size:13px;margin:0 0 10px;color:#3f718d}.review h4 small{font-weight:400;color:#9caebb}.fields{display:grid;gap:9px;margin-bottom:11px}.fields label{display:grid;gap:6px}.fields label span{font-size:11px;color:#8ea5b2}
.submitted{border:1px solid #d9e9f0;background:#f7fbfd;padding:11px;border-radius:8px;margin-top:11px;display:grid;gap:7px}.submitted strong{font-size:11px;color:#3b7796}.submitted p{font-size:11px;color:#7795a4;line-height:1.7;margin:0}.submitted small{font-size:10px;color:#9db0ba}.review-form{display:grid;gap:8px}.review-form>div{display:flex;gap:8px;flex-wrap:wrap}
.legal-boundary,.hint{font-size:11px;color:#a08664;line-height:1.85;margin:12px 0 0}.audit{border-top:1px solid #e1ecf2;padding-top:8px}.audit summary{font-size:11px;color:#477c98;cursor:pointer}.audit>div{display:grid;gap:5px;border-left:2px solid #badbe8;padding:7px;margin:7px 0}
.purchase-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:15px}.purchase-grid>div{border:1px solid #dbe9f1;background:#f6fbfd;border-radius:8px;padding:14px;display:grid;gap:9px}.purchase-grid strong{font-size:13px;color:#327e92}.purchase-grid p{font-size:11px;line-height:1.7;color:#7a99aa;margin:0}.purchase-grid span{font-size:11px;color:#3d7b79}.purchase-foot{font-size:11px;color:#98aab6;line-height:1.7}
@media(max-width:1220px){.workspace{grid-template-columns:1fr}.entry-list{max-height:390px}.gate-banner{grid-template-columns:1fr 1fr}}
@media(max-width:800px){.metrics{grid-template-columns:repeat(2,1fr)}.gate-banner,.purchase-grid,.fact-grid{grid-template-columns:1fr}.hero{display:block}.hero :deep(.n-tag){margin-top:10px}}
@media(max-width:490px){.metrics{grid-template-columns:1fr}.filter-row{flex-wrap:wrap}.filter-row :deep(.n-select){width:100%!important}.tabs button{flex:1}}
</style>

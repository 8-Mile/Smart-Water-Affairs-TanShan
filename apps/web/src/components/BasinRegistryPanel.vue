<script setup lang="ts">
import {computed,reactive,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import {NButton,NInput,NInputNumber,NSelect,NTag,useMessage} from "naive-ui";
import Chart from "../Chart.vue";
import {useDemoStore} from "../demo/store";
import {can} from "../demo/permissions";
import {
  MOCK_BASINS,allBasinRecords,readBasinRecords,
  PURPOSE_LABELS,PURPOSE_SUBSYSTEM,basinVolumes,pointBindingCheck,
  parseBasinCurve,saveBasinRecord,reviewBasinRecord,archiveBasinRecord,exportBasinSurveyCsv,
  type BasinInput,type BasinPurpose,type BasinRecord,type BasinState,
} from "../demo/basinRegistry";
const route=useRoute(),router=useRouter(),store=useDemoStore(),message=useMessage();
const records=ref(allBasinRecords(localStorage));
const selectedId=ref(typeof route.query.pool==="string"?route.query.pool:"MOCK-POLLUTED-POOL");
const purposeFilter=ref("all");
const editMode=ref<"view"|"create"|"edit">("view");
const actionNote=ref("");
const error=ref("");
const blank=():BasinInput=>({
  code:"",name:"",purpose:"polluted_collection",subsystemId:"rainwater",
  siteRef:"",drawingRef:"",drawingVersion:"",datumDescription:"",
  minLevelM:0,maxLevelM:1,assumedLevelM:null,levelPointId:null,knots:[],
});
const draft=reactive<BasinInput>(blank());
const curveText=ref("");
const purposes=Object.entries(PURPOSE_LABELS).map(([value,label])=>({value,label}));
const poolRows=computed(()=>records.value.filter(p=>purposeFilter.value==="all"||p.purpose===purposeFilter.value));
const selected=computed(()=>records.value.find(p=>p.id===selectedId.value)??records.value[0]??null);
const canSubmit=computed(()=>can(store.role,"engineering:submit"));
const canReview=computed(()=>can(store.role,"engineering:review"));
const storedCount=computed(()=>records.value.filter(p=>p.source==="USER_ENTRY"&&!p.archived).length);
const reviewedCount=computed(()=>records.value.filter(p=>p.state==="reviewed_demo"&&!p.archived).length);
const statusText:Record<BasinState,string>={
 mock_sample:"MOCK假设样本",submitted:"资料待审阅",reviewed_demo:"仅DEMO已审阅",returned:"资料退回",
};
const volumes=computed(()=>selected.value?basinVolumes(selected.value):null);
const chartSeries=computed(()=>selected.value?[{
 name:"累积库容（纯样本/录入资料）",unit:"m³",values:selected.value.knots.map(x=>x.volumeM3),
}]:[]);
const chartLabels=computed(()=>selected.value?.knots.map(x=>x.hM.toFixed(2)+" m")??[]);
const candidatePoints=computed(()=>store.points.filter(p=>p.kind==="number"&&p.unit==="m"&&
 /(液位|水位)/.test(p.label)&&store.getAsset(p.assetId)?.subsystemId===draft.subsystemId&&
 /池|井|罐|液位|水位/.test(store.getAsset(p.assetId)?.type??"")).map(p=>({
  value:p.id,label:p.id+" · "+p.label+"（待核归属）",
})));
const binding=computed(()=>selected.value?pointBindingCheck(selected.value,selected.value.levelPointId,store.assets,store.points,records.value):
 {ok:false,reason:"待选择池体"});
const maybe=()=>draft.levelPointId===null?null:pointBindingCheck(draft,draft.levelPointId,store.assets,store.points,readBasinRecords(localStorage));
const fmt=(n:number|null|undefined,decimal=1)=>n===null||n===undefined?"待补":n.toLocaleString("zh-CN",{maximumFractionDigits:decimal});
const filteredEmpty=computed(()=>!poolRows.value.length);
const checkRefs=computed(()=>selected.value?.purpose==="clear_reuse"?["CK-014","PT-013","CK-013","CK-023"]:
 ["CK-004","CK-005","CK-007","PT-002","CK-009","CK-023"]);
function refresh(){records.value=allBasinRecords(localStorage);}
function exportSurvey(){
 const csv=exportBasinSurveyCsv(readBasinRecords(localStorage));
 const blob=new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 try{
  const anchor=document.createElement("a");
  anchor.href=url;anchor.download="唐港逐池工程核查台账-V3.2.csv";
  document.body.append(anchor);anchor.click();anchor.remove();
  message.info("已导出CSV模板与非归档登记项；不包含MOCK示例，正式现场库容仍待核查。");
 }finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
function selectPool(id:string){
 selectedId.value=id;editMode.value="view";actionNote.value="";error.value="";
 void router.replace({path:route.path,query:{focus:"basins",pool:id}});
}
watch(()=>route.query.pool,id=>{
 if(typeof id==="string"&&records.value.some(x=>x.id===id)&&id!==selectedId.value){
  selectedId.value=id;editMode.value="view";
 }
});
function startCreate(){
 editMode.value="create";Object.assign(draft,blank());curveText.value="";
 error.value="";actionNote.value="";
}
function fromExample(){
 const pool=selected.value??MOCK_BASINS[0];
 Object.assign(draft,{...pool,code:"",name:"",siteRef:"",drawingRef:"",drawingVersion:"",
  datumDescription:"",levelPointId:null,assumedLevelM:pool.assumedLevelM,
  knots:pool.knots.map(x=>({...x}))});
 curveText.value=pool.knots.map(x=>x.hM+", "+x.volumeM3).join("\n");
 editMode.value="create";error.value="";actionNote.value="";
 message.warning("只复制曲线用于演示。请录入独立池号和图纸依据；保存仍是未验收资料草稿。");
}
function startEdit(){
 if(!selected.value||selected.value.source==="MOCK"||selected.value.archived)return;
 Object.assign(draft,{...selected.value,knots:selected.value.knots.map(x=>({...x}))});
 curveText.value=selected.value.knots.map(x=>x.hM+", "+x.volumeM3).join("\n");
 editMode.value="edit";error.value="";actionNote.value="";
}
function changePurpose(value:BasinPurpose){
 draft.purpose=value;draft.subsystemId=PURPOSE_SUBSYSTEM[value];
 draft.levelPointId=null;
}
function save(){
 try{
  draft.knots=parseBasinCurve(curveText.value);
  const x=saveBasinRecord(localStorage,{...draft},store.role,new Date().toISOString(),store.assets,store.points);
  refresh();editMode.value="view";selectPool(x.id);message.success("池体草稿已记录（修订V"+x.revision+"）；仅本地资料，未正式验收");
 }catch(e){error.value=(e as Error).message;message.error(error.value);}
}
function review(decision:"reviewed_demo"|"returned"){
 if(!selected.value)return;
 try{
  const x=reviewBasinRecord(localStorage,selected.value.code,store.role,decision,actionNote.value,new Date().toISOString());
  refresh();selectPool(x.id);message.success("仅完成DEMO审阅/退回，fieldVerified仍为false");
 }catch(e){message.error((e as Error).message);}
}
function archive(){
 if(!selected.value)return;
 try{
  archiveBasinRecord(localStorage,selected.value.code,store.role,actionNote.value,new Date().toISOString());
  refresh();editMode.value="view";message.success("已软归档，审计记录保留，情景计算禁止使用");
 }catch(e){message.error((e as Error).message);}
}
const statusType=(x:BasinRecord):"warning"|"info"|"default"|"error"=>
 x.archived?"default":x.state==="reviewed_demo"?"info":x.state==="returned"?"error":"warning";
</script>
<template>
 <section class="basin-registry">
  <header class="registry-head">
   <div>
    <div class="eyebrow">V3.2 / ONE BASIN · ONE ID · ONE DATUM</div>
    <h3>逐池工程台账与 V-H 有效库容核查</h3>
    <p>每座池必须独立编号、提供批准图纸和统一液位高程基准。库容曲线只可插值、不外推；池间未核连通时不汇总成“全港可用库容”。</p>
   </div>
   <NTag type="warning" size="small">现场容量已签认：0座</NTag>
  </header>
  <div class="summary">
   <div><span>内置假设示例</span><strong>{{ MOCK_BASINS.length }}</strong><small>仅示范数据结构，非港口实物</small></div>
   <div><span>用户登记草稿</span><strong>{{ storedCount }}</strong><small>有证据编号，未完成现场确认</small></div>
   <div><span>DEMO资料已审阅</span><strong>{{ reviewedCount }}</strong><small>不放行工程或自动调度</small></div>
   <div><span>现场池容可用于生产</span><strong>0</strong><small>需要正式G0/G1/G2验收</small></div>
  </div>
  <div class="layout">
   <aside class="basin-list">
    <div class="list-head"><strong>池体一池一号</strong><NButton size="small" type="primary" :disabled="!canSubmit" @click="startCreate">+ 登记池体</NButton></div>
    <NButton class="export-survey" block size="small" secondary @click="exportSurvey">导出逐池核查台账CSV</NButton>
    <NSelect v-model:value="purposeFilter" size="small" :options="[{value:'all',label:'全部用途'},...purposes]"/>
    <button v-for="pool in poolRows" :key="pool.id" class="pool-item" type="button" :class="{active:selected?.id===pool.id&&editMode==='view',muted:pool.archived}" @click="selectPool(pool.id)">
      <span class="code">{{ pool.code }}<NTag size="tiny" :type="statusType(pool)">{{ pool.archived?'已归档':statusText[pool.state] }}</NTag></span>
      <strong>{{ pool.name }}</strong>
      <small>{{ PURPOSE_LABELS[pool.purpose] }} · {{ pool.subsystemId }} · V{{ pool.revision }}</small>
    </button>
    <p v-if="filteredEmpty" class="empty">此类池体暂无资料。先核正式设计范围，不能通过添加演示项推导实际池数。</p>
    <div class="registry-boundary">原资料存在70,638.9与60,739m³等不同口径。此处不选择任何数值作为真实总容量，也不假定所有池体相通。</div>
    <div class="registry-links">
      <router-link to="/engineering/registry?item=CK-004">CK-004 一池一号</router-link>
      <router-link to="/engineering/registry?item=CK-005">CK-005 容量冲突</router-link>
      <router-link to="/engineering/registry?focus=topology">核查REL工程水路</router-link>
    </div>
   </aside>
   <div v-if="editMode==='view'&&selected" class="basin-detail">
    <div class="detail-title">
      <div><small>{{ selected.id }} · 修订V{{ selected.revision }}</small><h4>{{ selected.name }}</h4><p>{{ PURPOSE_LABELS[selected.purpose] }} · {{ selected.siteRef }}</p></div>
      <NTag size="small" :type="statusType(selected)">{{ selected.archived?'已归档':statusText[selected.state] }}</NTag>
    </div>
    <div class="mini-kpis">
      <div><span>模型有效库容</span><strong>{{ fmt(volumes?.effectiveCapacityM3) }}<small> m³</small></strong><em>仅MOCK/资料草稿插值</em></div>
      <div><span>假设当前占用</span><strong>{{ fmt(volumes?.mockInitialM3) }}<small> m³</small></strong><em>无现场质量合格液位</em></div>
      <div><span>假设剩余空间</span><strong>{{ fmt(volumes?.mockFreeM3) }}<small> m³</small></strong><em>不得当作雨前可腾库容</em></div>
    </div>
    <div class="information">
      <div><small>关联图号</small><strong>{{ selected.drawingRef }} · {{ selected.drawingVersion }}</strong></div>
      <div><small>液位高程基准</small><strong>{{ selected.datumDescription }}</strong></div>
      <div><small>工作液位范围</small><strong>{{ fmt(selected.minLevelM,3) }}–{{ fmt(selected.maxLevelM,3) }} m</strong></div>
      <div><small>液位测点一对一关联</small><strong>{{ selected.levelPointId??"未绑定" }}</strong><p>{{ binding.reason }}</p></div>
    </div>
    <div class="vh-plot">
      <div class="section-head"><strong>V-H液位—累积库容曲线</strong><span>插值演示；不是竣工测量</span></div>
      <Chart :labels="chartLabels" :series="chartSeries" :height="245" />
      <table class="curve-table"><thead><tr><th>液位m（统一基准）</th><th>累积库容m³</th></tr></thead>
      <tbody><tr v-for="(node,i) in selected.knots" :key="i"><td>{{ node.hM }}</td><td>{{ fmt(node.volumeM3,3) }}</td></tr></tbody></table>
    </div>
    <div class="baseline">
      <strong>工程上为什么还不能使用这个计算值？</strong>
      <p>当前图号可能为MOCK或尚未正式签认，未复核竣工池容、起算高程、设计停泵水位和真实液位测点。百分比测点不能直接用于以m为自变量的V-H曲线；模拟初始液位不等于实时液位。</p>
      <div class="check-links"><router-link v-for="id in checkRefs" :key="id" :to="'/engineering/registry?item='+id">{{ id }}</router-link></div>
    </div>
    <div class="detail-buttons">
      <NButton size="small" v-if="selected.source==='MOCK'&&canSubmit" @click="fromExample">复制示例为待核草稿</NButton>
      <NButton size="small" v-if="selected.source==='USER_ENTRY'&&!selected.archived" :disabled="!canSubmit" @click="startEdit">修订资料</NButton>
      <router-link to="/water/port-chain">到污染水情景选择单池模拟</router-link>
      <router-link :to="'/engineering/registry?focus=balance&pool='+selected.id">进入单池水量平衡与核查</router-link>
    </div>
    <div v-if="selected.source==='USER_ENTRY'" class="review-area">
      <strong>资料复核与审计</strong>
      <p>仅本地模拟资料审阅，不具备设计院/监理/业主工程签认权限；历史修订必须留痕。</p>
      <NInput v-if="!selected.archived&&canReview" v-model:value="actionNote" size="small" placeholder="填写复核/退回/归档原因，至少8字"/>
      <div class="review-actions" v-if="!selected.archived&&canReview">
        <NButton size="small" v-if="selected.state==='submitted'" @click="review('returned')">证据不足，退回</NButton>
        <NButton size="small" v-if="selected.state==='submitted'" type="primary" @click="review('reviewed_demo')">完成DEMO资料审阅</NButton>
        <NButton size="small" tertiary @click="archive">软归档</NButton>
      </div>
      <details class="history"><summary>修订及审核记录（{{ selected.history.length }}）</summary>
       <div v-for="(row,i) in selected.history" :key="i"><b>V{{ row.revision }} · {{ row.action }}</b><small>{{ row.by }} · {{ row.at }}</small><p>{{ row.note }}</p></div>
      </details>
    </div>
   </div>
   <div v-else class="basin-editor">
     <div class="editor-heading"><strong>{{ editMode==='edit'?'修订逐池设计资料':'登记逐池设计资料草稿' }}</strong><span>一池一号、同一高程基准、不跨池叠加</span></div>
     <p class="warning">没有批准图纸和实际测点时，请不要将示例曲线复制为真实工程参数。本表只能保存“待核”资料；即使管理者完成模拟审核，现场放行也始终为0。</p>
     <div class="fields">
       <label><span>池体独立编号（必填，不含MOCK前缀）</span><NInput v-model:value="draft.code" size="small" :disabled="editMode==='edit'" placeholder="如：BASIN-A01（请按批准图纸填写）"/></label>
       <label><span>名称（必填）</span><NInput v-model:value="draft.name" size="small" placeholder="逐池设施名称"/></label>
       <label><span>池体用途</span><NSelect :value="draft.purpose" size="small" :options="purposes" @update:value="changePurpose"/></label>
       <label><span>工艺子系统</span><NInput :value="draft.subsystemId" disabled size="small"/></label>
       <label><span>站点、分区、池号对应位置</span><NInput v-model:value="draft.siteRef" size="small" placeholder="需提供站点分区实际依据"/></label>
       <label><span>图纸/设计资料编号</span><NInput v-model:value="draft.drawingRef" size="small" placeholder="批准图号或待核资料编号"/></label>
       <label><span>设计图纸版本</span><NInput v-model:value="draft.drawingVersion" size="small" placeholder="如：A01"/></label>
       <label class="span-2"><span>液位高程基准说明（严禁混用m和%）</span><NInput v-model:value="draft.datumDescription" size="small" placeholder="如：采用设计高程基准，参考零点及水准点待核"/></label>
       <label><span>最低工作液位（m）</span><NInputNumber v-model:value="draft.minLevelM" size="small" :step="0.1"/></label>
       <label><span>最高工作液位（m）</span><NInputNumber v-model:value="draft.maxLevelM" size="small" :step="0.1"/></label>
       <label><span>仅模拟起始液位（m，可留空）</span><NInputNumber v-model:value="draft.assumedLevelM" size="small" clearable :step="0.1"/></label>
       <label><span>现有池体专属液位点（选填）</span><NSelect v-model:value="draft.levelPointId" size="small" clearable :options="candidatePoints" placeholder="无符合条件测点则留空"/></label>
       <label class="span-2"><span>V-H曲线（每行：液位m,累积容积m³；3–30行）</span>
         <NInput v-model:value="curveText" type="textarea" :rows="6" placeholder="例如（仅格式示例）：&#10;0,0&#10;1,450&#10;2,1000"/></label>
     </div>
     <div class="link-warning">符合单位为m的池体液位测点：{{ candidatePoints.length }} 个。旧DEMO雨水集水池是百分比%，不能直接绑定，需核实专用液位计或经批准的水位换算和标定。{{ maybe()?.reason??'' }}</div>
     <p v-if="error" class="error" role="alert">{{ error }}</p>
     <div class="form-actions">
       <NButton type="primary" size="small" :disabled="!canSubmit" @click="save">保存待核查池体草稿</NButton>
       <NButton size="small" @click="editMode='view'">取消</NButton>
     </div>
   </div>
  </div>
  <p class="boundary-footer">本系统不把环评、内部估算的初雨池/后期池/生态池容量相加，也不自动将此逐池演示值同步为真实SCADA库容。只有明确单池选择时才允许传给污染水模型作为MOCK情景参数。</p>
 </section>
</template>
<style scoped>
.basin-registry{display:grid;gap:12px;color:#3d7089;min-width:0}
.registry-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;border:1px solid #dbeaf1;border-radius:10px;background:#fff;padding:19px}
.eyebrow{font-size:10px;color:#8fb0bf;letter-spacing:.08em}.registry-head h3{font-size:17px;margin:8px 0;color:#26718d}
.registry-head p{font-size:11px;line-height:1.8;color:#829da9;margin:0;max-width:900px}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.summary>div{display:grid;gap:6px;border:1px solid #e0eaf0;border-radius:8px;background:#fff;padding:13px}
.summary span{font-size:11px;color:#86a1af}.summary strong{font-size:24px;color:#347d9b}.summary small{font-size:10px;color:#a1b0ba}
.layout{display:grid;grid-template-columns:minmax(255px,.82fr) minmax(0,1.65fr);gap:12px;align-items:start}
.basin-list,.basin-detail,.basin-editor{min-width:0;border:1px solid #dfebf1;border-radius:10px;background:#fff;padding:16px}
.list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:11px}
.list-head strong{font-size:13px;color:#397895}
.export-survey{margin-bottom:8px}
.pool-item{width:100%;padding:12px;text-align:left;display:grid;gap:7px;margin-top:7px;background:#fbfdfe;border:1px solid #e5eef2;border-radius:8px;cursor:pointer;color:#65869b}
.pool-item.active{background:#eaf7fc;border-color:#8ac8e0}.pool-item.muted{opacity:.65}
.pool-item .code{display:flex;align-items:center;justify-content:space-between;gap:5px;flex-wrap:wrap;font-size:10px;color:#3984a4}
.pool-item>strong{font-size:12px;color:#396d86}.pool-item small{font-size:10px;color:#96a9b7}
.registry-boundary{border:1px solid #eadcc3;border-radius:8px;background:#fffcf5;padding:12px;font-size:11px;color:#9e845f;line-height:1.7;margin-top:15px}
.registry-links{display:flex;flex-wrap:wrap;gap:9px;margin-top:12px}.registry-links a,.detail-buttons a,.check-links a{font-size:11px;color:#217da6}
.empty{font-size:11px;color:#91aab7;line-height:1.6}
.basin-detail{display:grid;gap:13px}
.detail-title{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.detail-title small{font-size:10px;color:#8ba9b7}.detail-title h4{margin:5px 0;font-size:16px;color:#326f8a}.detail-title p{font-size:11px;color:#92a5b0;margin:0}
.mini-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.mini-kpis>div{display:grid;gap:6px;padding:12px;background:#f5fafd;border-radius:8px;border:1px solid #e0edf3}
.mini-kpis span{font-size:11px;color:#8eacb8}.mini-kpis strong{font-size:19px;color:#3a8aa3}.mini-kpis strong small{font-size:10px}.mini-kpis em{font-size:10px;color:#ab9b78;font-style:normal}
.information{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.information>div{display:grid;gap:6px;padding:12px;background:#f9fbfd;border-radius:7px}
.information small{font-size:10px;color:#9eafb9}.information strong{font-size:11px;color:#4b7b90;line-height:1.6;overflow-wrap:anywhere}.information p{font-size:10px;color:#a18b6a;line-height:1.6;margin:0}
.section-head{display:flex;align-items:center;gap:12px;justify-content:space-between;margin-bottom:12px}
.section-head strong{font-size:12px;color:#467c92}.section-head span{font-size:10px;color:#9bb0bb}
.vh-plot{padding:12px;border:1px solid #e4eff4;border-radius:8px}
.curve-table{width:100%;border-collapse:collapse;margin-top:9px}.curve-table td,.curve-table th{border-bottom:1px solid #e6f0f4;padding:8px 12px;text-align:right;font-size:11px;color:#5b8298}
.curve-table th{background:#f4fbfe;color:#83a4b5}
.baseline{background:#fffaf3;border:1px solid #f1dfc3;border-radius:8px;padding:12px}
.baseline strong{font-size:12px;color:#9c7753}.baseline p{font-size:11px;color:#a08f77;line-height:1.75;margin:8px 0}
.check-links,.detail-buttons,.review-actions,.form-actions{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.check-links a{border-radius:5px;padding:5px 7px;background:#fff}
.detail-buttons{border-top:1px solid #e8f1f6;padding-top:10px}
.review-area{display:grid;gap:9px;border-top:1px solid #e7eff3;padding-top:12px}
.review-area>strong{font-size:12px;color:#417a97}.review-area>p{font-size:10px;color:#90a9b6;margin:0;line-height:1.7}
.history summary{font-size:11px;color:#4387a6;cursor:pointer}.history>div{display:grid;gap:6px;padding:9px;margin:8px 0;border-left:2px solid #c2e1ed;background:#f7fbfd}
.history b{font-size:11px}.history small,.history p{font-size:10px;color:#8ba6b2}
.editor-heading{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.editor-heading strong{font-size:15px;color:#327a94}.editor-heading span{font-size:11px;color:#8bacb9}
.warning,.link-warning,.boundary-footer{font-size:11px;line-height:1.8;color:#a08a66;background:#fffaf3;border-radius:7px;padding:10px 12px}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0}
.fields label{display:grid;gap:5px;min-width:0}.fields label>span{font-size:11px;color:#809cad}
.fields .span-2{grid-column:1/-1}.fields :deep(.n-input-number){width:100%}
.error{font-size:11px;color:#ca6e60}.boundary-footer{margin:0}
@media(max-width:1200px){.layout{grid-template-columns:1fr}.basin-list{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.list-head{width:100%}.basin-list>.n-select{width:100%}.pool-item{flex:1 1 245px;max-width:100%}.registry-boundary,.registry-links{width:100%}}
@media(max-width:700px){.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.mini-kpis,.information,.fields{grid-template-columns:1fr}.fields .span-2{grid-column:auto}.registry-head{display:grid}}
</style>

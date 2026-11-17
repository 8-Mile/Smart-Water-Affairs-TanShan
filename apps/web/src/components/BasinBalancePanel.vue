<script setup lang="ts">
import {computed,reactive,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import {NButton,NInput,NInputNumber,NSelect,NTag,useMessage} from "naive-ui";
import {useDemoStore} from "../demo/store";
import {can} from "../demo/permissions";
import {allBasinRecords,basinVolumes,pointBindingCheck,readBasinRecords} from "../demo/basinRegistry";
import {calculateBasinBalance,readBasinBalanceCases,submitBasinBalanceCase,
 acknowledgeBasinBalanceCase,attachBasinBalanceWorkOrder,closeDemoBalanceCase,
 preflightBasinBalanceOrder,finishBasinDemoCase,exportBasinBalanceBackup,MAX_BALANCE_CASES,
 type BalanceInput,type BalanceResult,type BalanceCase} from "../demo/basinBalance";
const route=useRoute(),router=useRouter(),store=useDemoStore(),message=useMessage();
const pools=ref(allBasinRecords(localStorage));
const poolId=ref(typeof route.query.pool==="string"&&pools.value.some(x=>x.id===route.query.pool)
 ?route.query.pool:"MOCK-POLLUTED-POOL");
const pool=computed(()=>pools.value.find(p=>p.id===poolId.value)??null);
const cases=ref(readBasinBalanceCases(localStorage));
const currentCases=computed(()=>cases.value.filter(x=>x.poolId===poolId.value));
const activeCaseId=ref(typeof route.query.caseId==="string"&&cases.value.some(x=>x.id===route.query.caseId)
 ?route.query.caseId:"");
const activeCase=computed(()=>cases.value.find(x=>x.id===activeCaseId.value)??null);
const preview=ref<BalanceResult|null>(null);
const error=ref("");
const ackNote=ref("");
const demoNote=ref("");
const closeNote=ref("");
const recheckId=ref("");
const confirmAsset=ref(false);
const canRecord=computed(()=>can(store.role,"engineering:submit"));
const canWorkOrder=computed(()=>can(store.role,"workorder:create"));
const canReview=computed(()=>can(store.role,"engineering:review"));
const fmt=(n:number|undefined|null,d=2)=>n==null?"—":n.toLocaleString("zh-CN",{maximumFractionDigits:d});
const localTime=(date:Date)=>[
 date.getFullYear(),"-",String(date.getMonth()+1).padStart(2,"0"),"-",
 String(date.getDate()).padStart(2,"0"),"T",String(date.getHours()).padStart(2,"0"),":",
 String(date.getMinutes()).padStart(2,"0"),
].join("");
const now=new Date();now.setMinutes(0,0,0);
const template=():BalanceInput=>({
 poolId:poolId.value,poolRevision:pool.value?.revision??1,
 startAt:localTime(new Date(now.getTime()-2*3600000)),endAt:localTime(now),
 startLevelM:pool.value?.assumedLevelM??pool.value?.minLevelM??0,
 endLevelM:pool.value?.assumedLevelM??pool.value?.minLevelM??0,
 inflowM3:0,outflowM3:0,basis:pool.value?.source==="MOCK"?"MOCK":"MANUAL_UNVERIFIED",
 evidenceRef:"",
});
const input=reactive<BalanceInput>(template());
const title=(item:BalanceCase)=>"[逐池核查] "+item.id+" · "+item.poolCode+" 计量残差核实（待核）";
const matchingPoint=computed(()=>{
 if(!pool.value?.levelPointId)return null;
 return store.points.find(x=>x.id===pool.value?.levelPointId)??null;
});
const matchingAsset=computed(()=>store.assets.find(x=>x.id===matchingPoint.value?.assetId)??null);
const candidateBinding=computed(()=>pool.value&&pool.value.levelPointId?
 pointBindingCheck(pool.value,pool.value.levelPointId,store.assets,store.points,readBasinRecords(localStorage)):
 {ok:false,reason:"尚未登记一对一的池体液位测点"});
const canLink=computed(()=>!!activeCase.value&&activeCase.value.status==="acknowledged"&&
 activeCase.value.input.basis==="MANUAL_UNVERIFIED"&&
 activeCase.value.poolSource==="USER_ENTRY"&&pool.value?.id===activeCase.value.poolId&&
 pool.value?.revision===activeCase.value.poolRevision&&
 !!matchingPoint.value&&!!matchingAsset.value&&
 matchingPoint.value.unit==="m"&&candidateBinding.value.ok&&matchingAsset.value.subsystemId===pool.value?.subsystemId&&
 canWorkOrder.value&&confirmAsset.value);
const statusLabel=(status:string)=>({
 recorded:"已留存（未触发演示阈值）",needs_ack:"疑似偏差 · 待人工受理",
 acknowledged:"已受理 · 待核对设备",workorder_draft:"已关联工单草稿",
 closed_demo:"模拟复核完成（非现场消项）",demo_finished:"MOCK演练结束（非现场恢复）",
}[status]??status);
const rechecks=computed(()=>cases.value.filter(x=>x.poolId===activeCase.value?.poolId&&
 x.poolRevision===activeCase.value?.poolRevision&&!x.result.suspected&&
 x.id!==activeCase.value?.id&&
 Date.parse(x.input.startAt)>=Date.parse(activeCase.value?.input.endAt??""))
 .map(x=>({label:x.id+" · 残差 "+fmt(x.result.residualM3)+"m³",value:x.id})));
const linkedOrder=computed(()=>store.workorders.find(x=>x.id===activeCase.value?.linkedWorkOrderId)??null);
const eligibleForClose=computed(()=>activeCase.value?.status==="workorder_draft"&&
 linkedOrder.value?.status==="archived"&&recheckId.value.length>0&&canReview.value);
watch(input,()=>{preview.value=null;error.value="";},{deep:true});
watch(poolId,()=>{
 Object.assign(input,template());preview.value=null;error.value="";activeCaseId.value="";
 confirmAsset.value=false;ackNote.value="";demoNote.value="";closeNote.value="";recheckId.value="";
 void router.replace({path:route.path,query:{focus:"balance",pool:poolId.value}});
});
watch(()=>route.query.pool,id=>{
 if(typeof id==="string"&&pools.value.some(x=>x.id===id)&&id!==poolId.value)poolId.value=id;
});
watch(()=>route.query.caseId,id=>{
 if(typeof id==="string"&&cases.value.some(x=>x.id===id))activeCaseId.value=id;
});
function selectCase(item:BalanceCase){
 activeCaseId.value=item.id;confirmAsset.value=false;recheckId.value="";
 void router.replace({path:route.path,query:{focus:"balance",pool:item.poolId,caseId:item.id}});
}
function presetWindow(hours:number){
 const end=new Date(),start=new Date(end.getTime()-hours*3600000);
 input.startAt=localTime(start);input.endAt=localTime(end);
}
function backup(){
 try{
  const body=exportBasinBalanceBackup(localStorage,new Date().toISOString());
  const blob=new Blob([body],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;
  a.download="tanggang-basin-balance-backup-"+new Date().toISOString().slice(0,10)+".json";
  a.click();URL.revokeObjectURL(url);
  message.success("已导出当前浏览器的核查快照与操作历史，不含现场原始数据");
 }catch(e){message.error((e as Error).message);}
}
function finishDemo(){
 if(!activeCase.value)return;
 try{
  finishBasinDemoCase(localStorage,activeCase.value.id,store.role,demoNote.value,new Date().toISOString());
  refresh();demoNote.value="";
  message.success("仅结束本次MOCK演练，不代表水量已恢复或工程消项");
 }catch(e){message.error((e as Error).message);}
}
function loadMock(){
 if(!pool.value)return;
 const a=pool.value.assumedLevelM??pool.value.minLevelM;
 Object.assign(input,{poolId:pool.value.id,poolRevision:pool.value.revision,
  startLevelM:a,endLevelM:Math.min(pool.value.maxLevelM,a+.1),
  inflowM3:500,outflowM3:200,basis:"MOCK",
  evidenceRef:"V3.3演示数据：非现场液位、非SCADA累计流量"});
 preview.value=null;message.info("已填入假设样本，请先核算；不代表任何码头现场异常");
}
function calculate(){
 if(!pool.value)return;
 try{preview.value=calculateBasinBalance(pool.value,{...input});error.value="";}
 catch(e){preview.value=null;error.value=(e as Error).message;message.error(error.value);}
}
function refresh(){cases.value=readBasinBalanceCases(localStorage);}
function saveCase(){
 if(!pool.value||!preview.value)return;
 try{
  const saved=submitBasinBalanceCase(localStorage,pool.value,{...input},store.role,new Date().toISOString());
  refresh();selectCase(saved);
  message.success("已保存本地单池待核快照；不会产生真实报警或工单");
 }catch(e){message.error((e as Error).message);}
}
function acknowledge(){
 if(!activeCase.value)return;
 try{
  acknowledgeBasinBalanceCase(localStorage,activeCase.value.id,store.role,ackNote.value,new Date().toISOString());
  refresh();ackNote.value="";message.success("已人工受理模拟差额，未生成生产告警");
 }catch(e){message.error((e as Error).message);}
}
function createWorkOrder(){
 const current=activeCase.value;
 if(!current||!pool.value||!matchingAsset.value||!matchingPoint.value||!canLink.value)return;
 let createdOrderId="";
 try{
  // Cross-key localStorage is not transactional. Validate first, then compensate failed links.
  preflightBasinBalanceOrder(localStorage,current.id,store.role,pool.value,
   store.assets,store.points,matchingAsset.value.id);
  const t=title(current);
  const existing=store.workorders.find(x=>x.title===t&&x.status!=="cancelled"&&x.evidenceIds.includes(current.id));
  const order=existing??store.createWorkOrder({
   title:t,assetId:matchingAsset.value.id,source:"manual",
   symptom:"池号 "+current.poolCode+" 仅人工待核数据残差 "+fmt(current.result.residualM3)+
    "m³，记录 "+current.id+"；不代表计量设备已证实损坏。",
   suggestion:"核查池体设计V-H、液位高程基准、进出水累计计量、时间戳及未计支路；核实归属再进行诊断。不得远程启停。",
   priority:"medium",evidenceIds:[current.id,pool.value.drawingRef,matchingPoint.value.id],
  });
  if(!existing)createdOrderId=order.id;
  attachBasinBalanceWorkOrder(localStorage,current.id,store.role,pool.value,store.assets,store.points,
   order,new Date().toISOString());
  refresh();confirmAsset.value=false;
  message.success("已关联核查工单 "+order.code+"，仅草稿，未自动派单或控制");
 }catch(e){
  let compensation="";
  if(createdOrderId){
   try{store.workOrderAction(createdOrderId,"cancel",{
    note:"创建核查记录关联失败：自动撤回孤立工单草稿",by:"系统异常补偿（DEMO）",
   });compensation="；已自动撤回本次新建草稿";}
   catch{compensation="；草稿回滚失败，需到工单中心人工核查";}
  }
  message.error((e as Error).message+compensation);
 }
}
function closeCase(){
 if(!activeCase.value)return;
 try{
  closeDemoBalanceCase(localStorage,activeCase.value.id,store.role,new Date().toISOString(),
   closeNote.value,recheckId.value,store.workorders);
  refresh();closeNote.value="";recheckId.value="";
  message.success("完成DEMO内人工复核闭环；不代表现场工程消项");
 }catch(e){message.error((e as Error).message);}
}
</script>
<template>
 <section class="balance-panel">
  <header class="balance-head">
   <div><div class="eyebrow">V3.3 / SINGLE BASIN · MASS BALANCE · EVIDENCE</div>
    <h3>单池水量平衡与异常核查</h3>
    <p>先对同一座池、同一时间窗的水位变化与累计进出水量做守恒对照，再决定是否需要人工核查。所有结果均为MOCK或未核实人工数据。</p></div>
   <NTag type="warning" size="small">实时生产数据：未接入</NTag>
  </header>
  <div class="balance-steps">
   <div><b>01 · 逐池选取</b><span>同池同版 V-H 曲线</span></div>
   <div><b>02 · 同期计量</b><span>液位m · 累计水量m³</span></div>
   <div><b>03 · 残差核查</b><span>演示规则，不是报警阈值</span></div>
   <div><b>04 · 人工处置</b><span>受理、可选工单、复核</span></div>
  </div>
  <div class="main-grid">
   <section class="balance-card editor">
    <div class="card-title"><strong>01 / 输入同周期数据</strong><router-link to="/engineering/registry?focus=basins">核对逐池资料</router-link></div>
    <label class="field"><span>单池编号与资料版本</span><NSelect v-model:value="poolId" size="small"
      :options="pools.filter(x=>!x.archived).map(x=>({label:x.code+' · '+x.name+' · V'+x.revision,value:x.id}))"/></label>
    <div class="source" v-if="pool">
     <b>{{ pool.code }} · {{ pool.source==='MOCK'?'MOCK非现场池':'人工登记待核' }}</b>
     <span>图纸：{{ pool.drawingRef }} / {{ pool.drawingVersion }}；池体有效容积仅为条件插值 {{ fmt(basinVolumes(pool).effectiveCapacityM3) }} m³。</span>
     <span>现场验收：否 · 专属液位测点：{{ pool.levelPointId??"未提供" }} · 自动控制：禁止</span>
    </div>
    <NButton size="small" secondary class="mock-button" @click="loadMock">填入一组异常演示样例</NButton>
    <div class="quick-range" aria-label="快捷核算时间窗">
      <span>快捷时间窗</span>
      <NButton size="tiny" secondary @click="presetWindow(1)">最近1小时</NButton>
      <NButton size="tiny" secondary @click="presetWindow(2)">最近2小时</NButton>
      <NButton size="tiny" secondary @click="presetWindow(24)">最近24小时</NButton>
    </div>
    <div class="fields">
     <label class="field"><span>核算起始（本地时间）</span><input v-model="input.startAt" type="datetime-local" class="native-datetime" aria-label="核算起始" required/></label>
     <label class="field"><span>核算结束（本地时间）</span><input v-model="input.endAt" type="datetime-local" class="native-datetime" aria-label="核算结束" required/></label>
     <label class="field"><span>起始液位（m）</span><NInputNumber v-model:value="input.startLevelM" size="small" :step="0.1"/></label>
     <label class="field"><span>结束液位（m）</span><NInputNumber v-model:value="input.endLevelM" size="small" :step="0.1"/></label>
     <label class="field"><span>周期累计进水（m³）</span><NInputNumber v-model:value="input.inflowM3" size="small" :min="0" :step="10"/></label>
     <label class="field"><span>周期累计出水（m³）</span><NInputNumber v-model:value="input.outflowM3" size="small" :min="0" :step="10"/></label>
     <label class="field"><span>计量资料来源</span><NSelect v-model:value="input.basis" size="small"
       :options="[{label:'MOCK：纯情景演练',value:'MOCK'},{label:'人工录入：尚未核实',value:'MANUAL_UNVERIFIED'}]"/></label>
     <label class="field"><span>图号/计量证据说明（保存必填）</span><NInput v-model:value="input.evidenceRef" size="small" placeholder="至少8字，明确资料缺口或编号"/></label>
    </div>
    <p class="footnote">计量数据必须同一时段、同一池体、同一m制基准。累计量不得用瞬时流量代替；尚未接入计量质量码及现场校准记录。</p>
    <div class="actions">
      <NButton type="primary" size="small" @click="calculate">计算单池水量残差</NButton>
      <NButton size="small" :disabled="!preview||!canRecord" @click="saveCase">保存待核快照</NButton>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
   </section>
   <section class="balance-card result">
    <div class="card-title"><strong>02 / 水量守恒核算</strong><NTag size="tiny" type="warning">不等于实际生产告警</NTag></div>
    <template v-if="preview">
     <div class="result-kpis">
      <div><span>V-H 推算变化</span><b>{{ fmt(preview.observedDeltaM3) }} <small>m³</small></b></div>
      <div><span>进水 − 出水</span><b>{{ fmt(preview.meteredNetM3) }} <small>m³</small></b></div>
      <div class="delta" :class="{risk:preview.suspected}"><span>守恒残差</span><b>{{ fmt(preview.residualM3) }} <small>m³</small></b></div>
      <div><span>演示判断容差</span><b>±{{ fmt(preview.toleranceM3) }} <small>m³</small></b></div>
     </div>
     <div class="diagnosis" :class="{warning:preview.suspected}">
      <NTag size="small" :type="preview.suspected?'warning':'info'">
       {{ preview.suspected?'疑似偏差 · 需核对':'未触发演示阈值' }}
      </NTag>
      <p>{{ preview.outOfBounds?'预测期末储量超出该池体的模型容量边界；先核实V-H和进出水口径。':
        preview.suspected?'计量净变化与库容推算不一致。可能涉及时间窗、量程、基准或未计支路，不能直接判定漏水或设备故障。':
        '本次人工/模拟输入在演示容差内；不等于真实池体已经实现平衡或仪表准确。' }}</p>
     </div>
     <div class="formula">残差 = [V(H末) − V(H初)] − [累计进水 − 累计出水]<br/>
      本次演示容差 = max(20m³, 进出水量之和 × 5%)；人为演示规则，不是行业或现场告警标准。</div>
     <div class="math-details">
      <div>起始储量 <strong>{{ fmt(preview.startStorageM3) }} m³</strong></div>
      <div>结束储量 <strong>{{ fmt(preview.endStorageM3) }} m³</strong></div>
      <div>期末预测 <strong>{{ fmt(preview.predictedEndM3) }} m³</strong></div>
      <div>核算时长 <strong>{{ fmt(preview.hours) }} h</strong></div>
     </div>
    </template>
    <div v-else class="empty-state">
     <strong>尚未计算</strong><p>选择池体，填写相同时间窗内的液位与累计进出水量，再点击计算。修改输入后，旧结论立即失效。</p>
    </div>
    <div class="boundary"><strong>工程边界</strong><p>一池一算、不跨池合并。未确认池体真实连通关系、统一高程基准、V-H图纸和流量测点前，不推导全港库容，不生成实时报警，不下发泵阀启停。</p></div>
   </section>
  </div>
  <section class="balance-card tasks">
   <div class="card-title"><div><strong>03 / 人工核查与工单联动</strong><p>快照保存在本机浏览器；不是跨用户审批或现场运维系统的正式记录。</p></div>
     <div class="backup-tools"><NTag size="small" type="info">{{ currentCases.length }} / {{ MAX_BALANCE_CASES }} 条单池快照</NTag>
      <NButton size="tiny" secondary @click="backup">导出本机核查备份</NButton></div></div>
   <div v-if="!currentCases.length" class="empty-records">暂无记录。先计算，再保存待核快照，才能进入人工受理流程。</div>
   <div v-else class="task-layout">
    <div class="task-list">
     <button v-for="item in currentCases" :key="item.id" class="task-row"
      :class="{selected:activeCaseId===item.id}" @click="selectCase(item)">
      <b>{{ item.id }}</b><NTag size="tiny" :type="item.result.suspected?'warning':'info'">{{ item.result.suspected?'疑似偏差':'容差内' }}</NTag>
      <span>残差 {{ fmt(item.result.residualM3) }}m³ · {{ item.poolCode }} · V{{ item.poolRevision }}</span>
      <small>{{ statusLabel(item.status) }} · {{ item.createdAt.slice(0,16).replace('T',' ') }}</small>
     </button>
    </div>
    <div class="task-detail" v-if="activeCase">
      <b>{{ activeCase.id }} · {{ statusLabel(activeCase.status) }}</b>
      <p>原始区间：{{ activeCase.input.startAt.replace('T',' ') }} 至 {{ activeCase.input.endAt.replace('T',' ') }}；
        资料：{{ activeCase.input.evidenceRef }}；数据来源：{{ activeCase.input.basis }}。</p>
      <div v-if="activeCase.status==='needs_ack'" class="action-panel">
       <strong>确认需要核实的是数据与工程关系，不直接判定设备故障。</strong>
       <NInput v-model:value="ackNote" size="small" placeholder="至少8字：说明准备核实什么问题" :disabled="!canRecord"/>
       <NButton type="primary" size="small" :disabled="!canRecord" @click="acknowledge">人工受理疑似偏差</NButton>
      </div>
      <div v-if="activeCase.status==='acknowledged'" class="action-panel">
       <strong>设备核查工单草稿（需明确测点与资产对应关系）</strong>
       <template v-if="activeCase.poolSource==='MOCK'">
        <p>当前是MOCK示意池，不存在真实设备归属，不能生成真实设备工单；可单独结束本次演练。</p>
        <NInput v-model:value="demoNote" size="small" placeholder="至少8字：说明MOCK演练结果与现场资料缺口" :disabled="!canRecord"/>
        <NButton size="small" secondary :disabled="!canRecord" @click="finishDemo">结束本次MOCK演练（非现场恢复）</NButton>
       </template>
       <p v-else-if="activeCase.input.basis==='MOCK'">该快照使用MOCK计量输入，不得创建候选现场设备工单。请重新用人工待核资料记录。
        <span v-if="!candidateBinding.ok">该池无可用的独立候选仪表资产绑定：{{ candidateBinding.reason }}。</span>
       </p>
       <p v-else-if="!matchingPoint||!matchingAsset||!candidateBinding.ok">该池无可用的独立候选仪表资产绑定：{{ candidateBinding.reason }}。请先核对逐池资料，不能随意挂单。</p>
       <template v-else>
        <p>候选关联设备：{{ matchingAsset.code }} · {{ matchingAsset.name }}；测点 {{ matchingPoint.id }}。绑定仍待现场核实，工单仅用于核查资料。</p>
        <label class="confirm"><input v-model="confirmAsset" type="checkbox"/>
          <span>我确认仅创建该候选设备的计量核查草稿，不声称故障已经确认。</span></label>
        <NButton size="small" type="primary" :disabled="!canLink" @click="createWorkOrder">创建并关联设备工单草稿</NButton>
       </template>
      </div>
      <div v-if="activeCase.linkedWorkOrderId" class="action-panel">
       <strong>已关联工单：{{ activeCase.linkedWorkOrderCode }}</strong>
       <p>工单状态：{{ linkedOrder?.status??'当前场景未找到工单' }}。必须先按原工单流程处理与验收，不能在这里直接派单或终止故障。</p>
       <router-link :to="{path:'/operations/workorders',query:{
        workOrderId:activeCase.linkedWorkOrderId,
        returnTo:'/engineering/registry?focus=balance&pool='+activeCase.poolId+'&caseId='+activeCase.id,
       }}">打开该工单的详情与证据</router-link>
       <template v-if="activeCase.status==='workorder_draft'">
        <NSelect v-model:value="recheckId" size="small" placeholder="选择后续同池、同版且残差在演示容差内的核算记录" :options="rechecks"/>
        <NInput v-model:value="closeNote" size="small" placeholder="至少8字：记录复核依据及限制"/>
        <NButton size="small" :disabled="!eligibleForClose" @click="closeCase">人工确认DEMO复核闭环</NButton>
        <p>仅当工单正式走完原系统验收、且另有后续同池水量复核快照时，才能在DEMO中闭环。</p>
       </template>
      </div>
      <details class="history"><summary>查看核查历史（{{ activeCase.history.length }}）</summary>
        <div v-for="(h,i) in activeCase.history" :key="i">
         <b>{{ h.action }}</b><small>{{ h.by }} · {{ h.at }}</small><span>{{ h.note }}</span></div>
      </details>
    </div>
   </div>
  </section>
 </section>
</template>
<style scoped>
.balance-panel{display:grid;gap:12px;color:#376b87;min-width:0}
.balance-head,.balance-card{border:1px solid #d9e8f0;background:#fff;border-radius:10px;padding:18px;min-width:0}
.balance-head{padding:11px 16px;background:linear-gradient(110deg,#eef8fc,#fff 60%,#f1faf8);display:flex;justify-content:space-between;gap:12px;align-items:start}
.balance-head h3{font-size:17px;color:#2d718b;margin:7px 0}
.balance-head p{font-size:11px;line-height:1.8;color:#7896a8;max-width:850px;margin:0}
.eyebrow{font-size:10px;letter-spacing:.08em;color:#87a8b9}
.balance-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
.balance-steps>div{background:#f8fbfd;border:1px solid #dcecf2;border-radius:8px;padding:7px 10px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 9px}
.balance-steps b{font-size:12px;color:#3c819e}.balance-steps span{font-size:10px;color:#8ba8b6}
.main-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:12px;align-items:start}
.card-title{display:flex;align-items:start;justify-content:space-between;gap:10px;margin-bottom:15px}
.card-title strong{font-size:14px;color:#326e8c}.card-title a,.action-panel a{color:#2d88a7;font-size:11px;text-decoration:none}
.card-title p{font-size:11px;color:#8aa4b2;margin:6px 0 0}
.field{display:grid;gap:7px;min-width:0}.field>span{font-size:11px;color:#7795a8}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:13px 0}
.field :deep(.n-input-number){width:100%}
.source{display:grid;gap:5px;background:#f2f8fb;padding:10px;margin-top:10px;border-radius:7px;overflow-wrap:anywhere}
.source b{font-size:11px}.source span,.footnote{font-size:10px;line-height:1.7;color:#8ca7b6}
.mock-button{margin-top:12px}.footnote{color:#a18e72;margin:10px 0}.actions{display:flex;gap:9px;flex-wrap:wrap}
.error{font-size:11px;color:#bd6757}
.result-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.result-kpis>div{display:grid;gap:10px;background:#f6fafc;border:1px solid #e1edf2;padding:13px;border-radius:8px}
.result-kpis span{font-size:11px;color:#819dae}.result-kpis b{font-size:25px;font-variant-numeric:tabular-nums;color:#337995}
.result-kpis small{font-size:11px}.result-kpis .delta{background:#eefaef}.result-kpis .delta.risk{background:#fff8f0;border-color:#f0d8ba}.delta.risk b{color:#b98051}
.diagnosis{background:#f5fafd;padding:12px;margin-top:13px;border-radius:8px}.diagnosis.warning{background:#fff9ef}
.diagnosis p,.formula,.boundary p{font-size:11px;color:#829ba9;line-height:1.8;margin:8px 0 0}
.formula{padding:11px;border-bottom:1px solid #e2edf2}
.math-details{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:14px 0}
.math-details>div{display:grid;gap:6px;font-size:10px;color:#879eac}.math-details strong{font-size:13px;color:#4b7d97}
.empty-state{display:grid;gap:10px;padding:40px 15px;text-align:center}.empty-state strong{font-size:15px}
.empty-state p{font-size:11px;line-height:1.8;color:#9ab0bc}
.boundary{padding:12px;background:#fffaf3;border:1px solid #f2e3cd;border-radius:7px;color:#99784f}.boundary strong{font-size:11px}
.task-layout{display:grid;grid-template-columns:minmax(225px,.75fr) minmax(0,1.2fr);gap:12px}
.task-list{display:grid;align-content:start;gap:8px;max-height:420px;overflow-y:auto}
.task-row{text-align:left;display:flex;flex-wrap:wrap;gap:7px;align-items:center;border:1px solid #e1edf2;border-radius:8px;background:#fbfdfe;padding:11px;cursor:pointer;color:#397793}
.task-row.selected{background:#edf8fc;border-color:#92cbdf}.task-row b{font-size:12px}
.task-row>span,.task-row>small{font-size:10px;color:#789bad;width:100%}
.task-detail{background:#f8fbfd;border:1px solid #e0edf2;border-radius:8px;padding:13px;min-width:0;display:grid;gap:11px}
.task-detail>b{font-size:13px}.task-detail>p,.action-panel p{margin:0;font-size:11px;color:#8199a9;line-height:1.75;overflow-wrap:anywhere}
.action-panel{display:grid;gap:10px;padding:12px;border:1px solid #e4edf2;background:white;border-radius:7px}
.action-panel strong{font-size:12px;color:#477b94}.confirm{display:flex;gap:8px;align-items:start;font-size:11px;color:#7c94a4;line-height:1.6}
.confirm input{margin-top:2px}.action-panel :deep(.n-button){justify-self:start}
.history summary{font-size:11px;color:#3f87a5;cursor:pointer}.history>div{display:grid;gap:5px;margin:7px 0;padding:9px;border-left:2px solid #a6d9e8}
.history b{font-size:11px}.history small,.history span{font-size:10px;color:#8aa4b3}
.empty-records{font-size:12px;color:#91a9b7;padding:22px;text-align:center}
@media(max-width:1280px){.main-grid{grid-template-columns:1fr}}
@media(max-width:850px){.balance-steps{grid-template-columns:repeat(2,1fr)}.task-layout{grid-template-columns:1fr}}
@media(max-width:550px){.fields,.result-kpis,.math-details{grid-template-columns:1fr}.balance-head{display:grid}}
.quick-range,.backup-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.quick-range{margin-top:12px}.quick-range span{font-size:11px;color:#7894a8}
.backup-tools{justify-content:flex-end}
.native-datetime{box-sizing:border-box;width:100%;max-width:100%;min-height:34px;padding:6px 10px;border:1px solid #d7e4eb;border-radius:5px;background:#fff;color:#476f87;font-size:12px;font-family:inherit}
.native-datetime:focus-visible{outline:2px solid #48a1c3;outline-offset:1px}.native-datetime:hover{border-color:#97c8dd}
</style>

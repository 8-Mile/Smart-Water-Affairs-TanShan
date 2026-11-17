<script setup lang="ts">
import PortBusinessJourney from "../components/PortBusinessJourney.vue";
import {computed,reactive,ref,watch} from "vue";
import {useRoute} from "vue-router";
import {NButton,NInputNumber,NSelect,NTag,useMessage} from "naive-ui";
import Chart from "../Chart.vue";
import EngineeringTopologyPanel from "../components/EngineeringTopologyPanel.vue";
import BasinScenarioConnector from "../components/BasinScenarioConnector.vue";
import {basinForScenario,basinRole,type BasinRecord} from "../demo/basinRegistry";
import {PORT_CHAIN_PRESETS,PORT_CHAIN_HARDWARE,evaluatePortChain,type PortChainInput} from "../demo/portChain";
import {ENGINEERING_ISSUES} from "../demo/engineering";
const route=useRoute(),message=useMessage();
const activePreset=ref(route.query.scenario==="normal"?"normal":route.query.scenario==="extreme"?"extreme":"storm");
const editable=reactive<PortChainInput>({...PORT_CHAIN_PRESETS[activePreset.value]});
const applied=ref<PortChainInput>({...PORT_CHAIN_PRESETS[activePreset.value]});
const expanded=ref(false),showHours=ref(false),showNotes=ref(false);
const latest=ref(""),error=ref("");
type LoadedPool={id:string;revision:number;target:"polluted"|"clear";capacityM3:number;initialM3:number;source:"MOCK"};
const importedPools=ref<LoadedPool[]>([]);
const importedNeedsRecompute=ref(false);
function loadBasin(pool:BasinRecord){
 try{
  const result=basinForScenario(pool,basinRole(pool.purpose));
  if(result.target==="polluted"){
   editable.pollutedPoolCapacityM3=result.capacityM3;
   editable.pollutedPoolInitialM3=result.initialM3;
  }else{
   editable.clearPoolCapacityM3=result.capacityM3;
   editable.clearPoolInitialM3=result.initialM3;
  }
  importedPools.value=[...importedPools.value.filter(x=>x.target!==result.target),{
   id:result.sourceId,revision:result.sourceRevision,target:result.target,
   capacityM3:result.capacityM3,initialM3:result.initialM3,source:"MOCK",
  }];
  importedNeedsRecompute.value=true;
  message.warning("已载入单池V-H曲线的MOCK容量，请点击“重算情景和风险”；不代表现场池容或液位已核实。");
 }catch(e){message.error((e as Error).message);}
}
const usedBasinRefs=computed(()=>importedPools.value.filter(x=>{
 return x.target==="polluted"
   ?applied.value.pollutedPoolCapacityM3===x.capacityM3&&applied.value.pollutedPoolInitialM3===x.initialM3
   :applied.value.clearPoolCapacityM3===x.capacityM3&&applied.value.clearPoolInitialM3===x.initialM3;
}));
const reportKey="tanggang-port-chain-demo-run-v3";
const result=computed(()=>evaluatePortChain(applied.value));
const dirty=computed(()=>importedNeedsRecompute.value||JSON.stringify({...editable})!==JSON.stringify(applied.value));
const fmt=(n:number,digits=1)=>n.toLocaleString("zh-CN",{maximumFractionDigits:digits});
const labels=computed(()=>result.value.steps.map(s=>"第"+s.hour+"小时"));
const series=computed(()=>[
 {name:"污染池储量",values:result.value.steps.map(s=>s.poolStorageM3),unit:"m³"},
 {name:"清水池储量",values:result.value.steps.map(s=>s.clearStorageM3),unit:"m³"},
]);
const totalRisk=computed(()=>result.value.totalOverflowM3>0);
const qualityText=computed(()=>applied.value.qualityBasis==="unknown"?"无达标依据":applied.value.qualityBasis==="failed"?"模拟水质不合格":"仅演示假设达标");
const inletText=computed(()=>applied.value.inletBasis==="unknown"?"处理入口未核":applied.value.inletBasis==="blocked"?"入站断开":"仅MOCK假设入站");
const pipelineText=computed(()=>applied.value.pipelineBasis==="unknown"?"管线待核":applied.value.pipelineBasis==="blocked"?"路径不通":"仅演示假设连通");
const inletOptions=[
 {label:"入站管道未核实（不计处理量）",value:"unknown"},
 {label:"仅演示假设污染池与处理站可达",value:"assumed_connected"},
 {label:"入站水路模拟断开",value:"blocked"},
];
const waterQualityOptions=[
 {label:"水质无核验资料（停止处理出水计量）",value:"unknown"},
 {label:"仅演示假设检测合格（非现场审核）",value:"assumed_pass"},
 {label:"模拟出水水质不合格",value:"failed"},
];
const pipeOptions=[
 {label:"回用管道未核实（不计算回用）",value:"unknown"},
 {label:"仅演示假设管路可达（非现场核验）",value:"assumed_connected"},
 {label:"模拟路径不可达",value:"blocked"},
];
const controls=[
 {key:"rainMm",label:"设计降雨量",unit:"mm",max:500},
 {key:"catchmentM2",label:"模拟汇水面积",unit:"m²",max:1e9},
 {key:"runoffCoefficient",label:"径流系数",unit:"0~1",max:1},
 {key:"pollutedFraction",label:"初雨/污染径流比例",unit:"0~1",max:1},
 {key:"pollutedPoolInitialM3",label:"污染水池初始储量",unit:"m³",max:1e8},
 {key:"pollutedPoolCapacityM3",label:"污染水池有效容量",unit:"m³",max:1e8},
 {key:"treatmentM3h",label:"处理能力假设",unit:"m³/h",max:1e7},
 {key:"clearPoolInitialM3",label:"清水池初始储量",unit:"m³",max:1e8},
 {key:"clearPoolCapacityM3",label:"清水池有效容积",unit:"m³",max:1e8},
 {key:"flushDemandM3h",label:"码头冲洗需求假设",unit:"m³/h",max:1e7},
 {key:"transferCapacityM3h",label:"回用管线输送能力",unit:"m³/h",max:1e7},
] as const;
function choosePreset(id:string){
 if(!PORT_CHAIN_PRESETS[id])return;
 activePreset.value=id;importedPools.value=[];importedNeedsRecompute.value=false;
 Object.assign(editable,{...PORT_CHAIN_PRESETS[id]});
 apply();
}
function apply(){
 try{
  const input={...editable};evaluatePortChain(input);
  applied.value=input;importedNeedsRecompute.value=false;error.value="";
  message.success("已按当前MOCK输入重算污染水质量守恒与风险，不执行泵阀控制");
 }catch(e){error.value=(e as Error).message;message.error(error.value);}
}
watch(()=>route.query.scenario,v=>{
 if(v==="normal"||v==="storm"||v==="extreme")choosePreset(v);
});
function saveRun(){
 if(dirty.value){message.warning("参数发生变化，请先重算后再保存");return;}
 try{
  const r=result.value;
  const record={
   id:"PCHAIN-"+Date.now().toString(36).toUpperCase(),status:"MOCK",scenario:activePreset.value,
   at:new Date().toISOString(),inputs:{...applied.value},
   computed:{polluted:r.totalPollutedInM3,treated:r.totalProcessedM3,reused:r.totalReusedM3,
    overflow:r.totalOverflowM3,gap:r.massBalanceGapM3},
   sourceIds:["CK-007","CK-011","CK-012","CK-013","CK-014","CK-015"],
   basinSources:usedBasinRefs.value.map(x=>({id:x.id,revision:x.revision,target:x.target,
    source:"MOCK",fieldVerified:false})),
   conclusion:"仅情景演练，工程资料未签认，禁止实际泵阀调度",
  };
  localStorage.setItem(reportKey,JSON.stringify(record));
  latest.value=record.id;
  message.success("已保存MOCK分析快照，仅用于项目评审或演示，不代替工单/控制指令");
 }catch(e){message.error("浏览器本地存储失败："+(e as Error).message);}
}
</script>

<template>
 <section class="chain-root">
  <PortBusinessJourney />
  <header class="hero">
   <div><div class="eyebrow">港口环保水业务链 / V3.0 专业场景</div>
    <h2>污染雨水收集 · 含矿污水处理 · 合规消纳</h2>
    <p>围绕“污染水是否收得住、处理得了、合格出水能否用得掉”进行同周期水量守恒分析。六工艺分散布置，未经确认的管道、池容与排放去向不得视为实际连接。</p>
   </div>
   <NTag type="warning" size="small">独立MOCK · 非实时SCADA</NTag>
  </header>
  <section class="preset panel">
   <div><strong>选择港口污染径流情景</strong><p>初雨/污染水比例、汇水范围与处理能力均为演示输入，尚无最终审定参数。</p></div>
   <div class="preset-actions">
    <NButton size="small" :type="activePreset==='normal'?'primary':'default'" secondary @click="choosePreset('normal')">一般降雨 25mm</NButton>
    <NButton size="small" :type="activePreset==='storm'?'primary':'default'" secondary @click="choosePreset('storm')">强降雨 60mm</NButton>
    <NButton size="small" :type="activePreset==='extreme'?'primary':'default'" secondary @click="choosePreset('extreme')">极端演练 100mm</NButton>
   </div>
  </section>
  <div class="kpis">
   <div><span>假设污染径流来水</span><strong>{{ fmt(result.totalPollutedInM3) }}<small>m³</small></strong><p>汇水面积 × 雨量 × 径流系数 × 污染比例</p></div>
   <div><span>满足水质条件的处理量</span><strong>{{ fmt(result.totalProcessedM3) }}<small>m³</small></strong><p>仅在模拟水质通过时计算，不代表已达标</p></div>
   <div><span>码头面冲洗实际模拟消纳</span><strong>{{ fmt(result.totalReusedM3) }}<small>m³</small></strong><p>水质、连通假设和存储空间三重约束</p></div>
   <div :class="{danger:totalRisk}"><span>超容量未收集污染水</span><strong>{{ fmt(result.totalOverflowM3) }}<small>m³</small></strong><p>{{ totalRisk?'容量风险 · 不代表可以合法外排':'此情景未产生模型溢出，现场仍待校验' }}</p></div>
  </div>
  <section class="panel evidence-warning">
   <div class="evidence-header">
    <div><strong>工程放行状态：未通过 G0 / G1 / G2</strong><p>以下业务关系仅为环评要求与工程假设的组合，不是已经投运的水流通道。</p></div>
    <router-link to="/engineering/registry?item=CK-001">打开工程核查台账</router-link>
   </div>
   <div class="boundary-strip">
    <span><i></i> 池容口径待设计复核</span><span><i></i> 处理站入口管路与可用负荷未核</span>
    <span><i></i> 出水合格标准及检测责任未核</span><span><i></i> 码头冲洗水管道未验收</span>
   </div>
  </section>

  <BasinScenarioConnector @use="loadBasin" />
  <div class="v33-balance-link"><router-link to="/engineering/registry?focus=balance">单池累计进出水与库容残差核算（V3.3） →</router-link><span>仅人工/MOCK资料，暂不代表现场自动异常识别</span></div>
  <div v-if="importedPools.length" class="imported-basin-note">
    已选择逐池MOCK来源：<span v-for="item in importedPools" :key="item.target">{{ item.target==="polluted"?"污染池":"清水池" }} {{ item.id }} V{{ item.revision }}</span>
    <strong v-if="dirty">参数未重算，结果尚未更新</strong>
    <span v-else>已重算；仍不具备实际库容与管路验收依据</span>
  </div>
  <section class="panel flow-panel">
   <div class="section-heading"><div><h3>港口污染水分段工艺链</h3><p>仅业务顺序，非真实管网示意；实线代表当前模拟环节，虚线表示尚待证实的关联。</p></div>
    <NTag type="warning" size="small">无现场联锁、阀位或外排控制</NTag></div>
   <div class="process-flow">
    <div class="flow-node source"><div class="node-top"><span>01</span><NTag size="tiny" type="warning">汇水参数待核</NTag></div>
     <strong>码头面污染径流</strong><p>初雨 / 冲洗废水的设计来源</p><b>{{ fmt(result.totalPollutedInM3) }} m³</b>
     <small>依据入口：CK-008 / PT-001</small></div>
    <div class="flow-arrow"><span>分流路径<br/>待核</span>→</div>
    <div class="flow-node collection"><div class="node-top"><span>02</span><NTag size="tiny" :type="totalRisk?'error':'warning'">有效库容待核</NTag></div>
     <strong>污染水收集与调蓄</strong><p>逐池V-H、池间真实联通均待核</p><b>{{ fmt(result.poolFinalM3) }} m³</b>
     <small>风险：{{ fmt(result.totalOverflowM3) }}m³ · CK-005/007</small></div>
    <div class="flow-arrow"><span>{{ inletText }}<br/>待核</span>→</div>
    <div class="flow-node treatment"><div class="node-top"><span>03</span><NTag size="tiny" type="warning">{{ qualityText }}</NTag></div>
     <strong>含矿污水处理</strong><p>设计处理能力不能视为实际合格量</p><b>{{ fmt(result.totalProcessedM3) }} m³</b>
     <small>工艺/水质证据：CK-011/013</small></div>
    <div class="flow-arrow"><span>回用管线<br/>待核</span>→</div>
    <div class="flow-node reuse"><div class="node-top"><span>04</span><NTag size="tiny" type="warning">{{ pipelineText }}</NTag></div>
     <strong>合格出水 · 码头面冲洗</strong><p>没有真实终端需水和输配依据</p><b>{{ fmt(result.totalReusedM3) }} m³</b>
     <small>终端消纳证据：CK-014/015</small></div>
   </div>
   <div class="not-allowed">
    <strong>目前不计入的去向</strong>
    <span>除尘池/人工湖：未经批准设计核实，不可作为可达回用终端</span>
    <span>雨前对外排放：缺少排口、许可、水质及倒灌核验，不能自动提供外排方案</span>
   </div>
  </section>

  <EngineeringTopologyPanel scope="environment" compact />
  <div class="body-grid">
   <section class="panel controls">
    <div class="section-heading"><div><h3>水质与回用关系证据门槛</h3><p>一项不满足，系统即停止计入该环节的“可用水量”。</p></div></div>
    <label class="input-label"><span>污染池与含矿污水站入口是否确有可达管路？</span><NSelect v-model:value="editable.inletBasis" size="small" :options="inletOptions"/></label>
    <label class="input-label"><span>处理出水是否有合格证明？</span><NSelect v-model:value="editable.qualityBasis" size="small" :options="waterQualityOptions"/></label>
    <label class="input-label"><span>到码头面冲洗的回用路径是否可达？</span><NSelect v-model:value="editable.pipelineBasis" size="small" :options="pipeOptions"/></label>
    <div class="control-actions"><span v-if="dirty">条件已修改，结果仍是上次有效快照</span>
      <NButton size="small" type="primary" @click="apply">重算情景和风险</NButton></div>
    <p class="guard">同时选择“入站连通”“仅演示假设达标”与“回用连通”，只是在DEMO内开放模型路径，不生成真实水质或管道验收记录，也不放行任何泵阀控制。</p>
    <div class="section-heading second"><div><h3>专业计算参数</h3><p>建议由排水、工艺和自控人员根据图纸一起核定</p></div>
      <NButton size="small" text @click="expanded=!expanded">{{ expanded?'收起':'展开参数' }}</NButton></div>
    <div v-if="expanded" class="parameter-grid">
     <label v-for="item in controls" :key="item.key"><span>{{ item.label }} ({{ item.unit }})</span>
      <NInputNumber v-model:value="editable[item.key]" size="small" :min="0" :max="item.max" :precision="item.key==='runoffCoefficient'||item.key==='pollutedFraction'?3:1"/></label>
     <label><span>模拟时长（小时）</span><NInputNumber v-model:value="editable.hours" size="small" :min="1" :max="72" :precision="0"/></label>
     <NButton type="primary" size="small" @click="apply">按当前参数重算</NButton>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
   </section>
   <section class="panel bottlenecks">
    <div class="section-heading"><div><h3>当前主要制约环节</h3><p>将预测问题转化为现场核查任务，而不是直接下发控制命令。</p></div>
     <NTag size="small" type="warning">{{ result.bottlenecks.length }} 个待处理问题</NTag></div>
    <div v-for="b in result.bottlenecks" :key="b.id" class="block-item">
     <div class="block-header"><strong>{{ b.title }}</strong><NTag size="tiny" type="warning">工程待核</NTag></div>
     <p>{{ b.reason }}</p>
     <div class="check-links"><router-link v-for="id in b.checkIds" :key="id" :to="'/engineering/registry?item='+id">{{ id }}</router-link></div>
    </div>
    <p v-if="!result.bottlenecks.length" class="no-blockers">本轮模拟未触发当前列出的制约条件，但工程放行仍未通过，不代表现场具备。</p>
   </section>
  </div>

  <div class="body-grid">
   <section class="panel">
    <div class="section-heading"><div><h3>逐时段污染池与清水池占用</h3><p>同周期水量守恒，不用额定流量代替实测设备流量。</p></div></div>
    <Chart :labels="labels" :series="series" :height="265" />
    <div class="balances">
      <span>期末污染池 {{ fmt(result.poolFinalM3) }} m³</span>
      <span>期末清水池 {{ fmt(result.clearFinalM3) }} m³</span>
      <span>守恒残差 {{ fmt(result.massBalanceGapM3,4) }} m³</span>
    </div>
   </section>
   <section class="panel">
    <div class="section-heading"><div><h3>软硬件与工程依赖</h3><p>先确认哪些已有、哪些没有，再选择 A/B/C 工程实施路径。</p></div></div>
    <div class="hardware-rows"><div v-for="h in PORT_CHAIN_HARDWARE" :key="h.id">
      <router-link :to="'/engineering/registry?item='+h.id">{{ h.id }}</router-link>
      <div><strong>{{ h.section }} · {{ h.type }}</strong><p>{{ h.strategy }}</p></div>
      <NTag size="tiny" type="warning">{{ h.status }}</NTag>
    </div></div>
   </section>
  </div>
  <section class="panel lower">
   <div class="section-heading"><div><h3>审计记录与源依据</h3><p>这次分析只保存MOCK参数及计算快照，不变更水量账本、监测点、工单或生产设备。</p></div>
    <div class="lower-actions"><NButton size="small" secondary @click="showHours=!showHours">{{ showHours?'收起':'查看' }}逐时段水量</NButton>
     <NButton size="small" secondary @click="showNotes=!showNotes">{{ showNotes?'收起':'查看' }}假设</NButton>
     <NButton size="small" type="primary" :disabled="dirty" @click="saveRun">保存模拟分析快照</NButton></div></div>
   <div v-if="latest" class="saved">MOCK分析已保存：{{ latest }} · 控制输出始终禁用</div>
   <div v-if="showHours" class="table-wrap"><table><thead><tr><th>时段</th><th>污染来水</th><th>合格处理</th><th>回用量</th><th>污染池储量</th><th>清水池储量</th><th>超容水量</th></tr></thead>
    <tbody><tr v-for="s in result.steps" :key="s.hour"><td>{{ s.hour }}</td><td>{{ fmt(s.pollutedInM3) }}</td><td>{{ fmt(s.processedM3) }}</td><td>{{ fmt(s.flushReuseM3) }}</td><td>{{ fmt(s.poolStorageM3) }}</td><td>{{ fmt(s.clearStorageM3) }}</td><td :class="{negative:s.overflowM3>0}">{{ fmt(s.overflowM3) }}</td></tr></tbody></table></div>
   <div v-if="showNotes" class="assumptions"><p v-for="a in result.assumptions" :key="a">{{ a }}</p>
    <p v-for="issue in ENGINEERING_ISSUES.filter(x=>['ISS-01','ISS-03','ISS-04','ISS-07'].includes(x.id))" :key="issue.id">{{ issue.id }} · {{ issue.title }} · {{ issue.blocker }}</p></div>
   <div class="footer-links"><router-link to="/process/rainwater">雨水收集SCADA</router-link><router-link to="/process/mining">含矿污水SCADA</router-link>
    <router-link to="/water/dispatch">原雨前调蓄分析</router-link><router-link to="/engineering/registry">P0工程核查台账</router-link></div>
  </section>
 </section>
</template>

<style scoped>
.imported-basin-note{display:flex;gap:10px;flex-wrap:wrap;align-items:center;border:1px solid #e9dcbf;background:#fff9f0;border-radius:8px;padding:10px 13px;color:#9e805a;font-size:11px}
.imported-basin-note strong{color:#bd8453}

.chain-root{display:grid;gap:13px;color:#315c75;min-width:0;padding-bottom:28px}
.panel,.kpis>div{border:1px solid #dbeaf1;border-radius:11px;background:#fff;box-shadow:0 5px 18px #287b9309;min-width:0}
.panel{padding:17px 19px}
.hero{display:flex;justify-content:space-between;align-items:center;gap:15px;padding:24px;background:linear-gradient(110deg,#e5f1fa,#fafcff 60%,#edf9f5);border-radius:12px;border:1px solid #d4e5f0}
.eyebrow{font-size:11px;color:#6f96ab}.hero h2{font-size:22px;color:#28637e;margin:8px 0}.hero p{font-size:12px;color:#7796a6;line-height:1.8;margin:0;max-width:885px}
.preset{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.preset strong{font-size:13px;color:#3a778e}.preset p{font-size:11px;color:#93a9b4;margin:5px 0 0}.preset-actions{display:flex;gap:7px;flex-wrap:wrap}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}.kpis>div{padding:18px;display:grid;gap:8px}.kpis span{font-size:11px;color:#829aac}.kpis strong{font-size:24px;color:#2c7695;font-weight:750}.kpis strong small{font-size:12px;color:#a0acb9}.kpis p{font-size:10px;color:#91a6b5;line-height:1.6;margin:0}.kpis .danger{background:#fff8f5;border-color:#f0d4c9}.kpis .danger strong{color:#c36a58}
.evidence-warning{background:#fffaf2;border-color:#eaddc4}.evidence-header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.evidence-header strong{color:#97764b;font-size:12px}.evidence-header p{font-size:11px;color:#ae9579;margin:7px 0}.evidence-header a{font-size:11px;color:#957346}.boundary-strip{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.boundary-strip span{background:#fff;border:1px solid #eddfc7;border-radius:6px;padding:7px 9px;font-size:10px;color:#a08461}.boundary-strip i{display:inline-block;background:#c59a62;width:6px;height:6px;border-radius:50%;margin-right:5px}
.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:16px}.section-heading h3{font-size:15px;margin:0;color:#35758d}.section-heading p{font-size:11px;color:#8da6b2;margin:6px 0 0;line-height:1.7}
.process-flow{display:flex;align-items:stretch;gap:5px}.flow-node{flex:1;min-width:0;padding:15px 13px;border:1px solid #deebf2;border-radius:9px;background:#f7fbfe;display:grid;gap:9px}.flow-node.source{border-top:3px solid #77a6c6}.flow-node.collection{border-top:3px solid #5b9ec3}.flow-node.treatment{border-top:3px solid #49a6a0}.flow-node.reuse{border-top:3px solid #68b699}
.node-top{display:flex;justify-content:space-between;gap:4px;flex-wrap:wrap}.node-top>span{font-size:12px;color:#8faac0;font-weight:700}.flow-node strong{font-size:13px;color:#326985;line-height:1.6}.flow-node p{font-size:10px;color:#86a0ae;line-height:1.6;margin:0;min-height:32px}.flow-node b{font-size:19px;color:#327e9f}.flow-node small{font-size:10px;color:#a2b2bd;line-height:1.55}.flow-arrow{display:grid;place-content:center;text-align:center;color:#86b9cf;font-size:21px;padding:3px;min-width:58px}.flow-arrow span{color:#a0aeba;font-size:10px;line-height:1.5}
.not-allowed{border-top:1px dashed #e3eaf0;margin-top:15px;padding-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}.not-allowed strong{font-size:11px;color:#b57d56}.not-allowed span{font-size:10px;color:#969c9c}
.body-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;align-items:stretch}
.input-label{display:grid;gap:7px;margin-bottom:12px}.input-label>span{font-size:11px;color:#7895a6}.control-actions{display:flex;justify-content:space-between;gap:10px;align-items:center}.control-actions span{font-size:11px;color:#ba8b62}.guard{font-size:11px;line-height:1.75;padding:11px;color:#9a815d;background:#fff9ed;border-radius:6px;margin:10px 0 15px}.second{margin-top:14px;border-top:1px solid #e7eff4;padding-top:13px}
.parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.parameter-grid label{display:grid;gap:5px;min-width:0}.parameter-grid label span{font-size:10px;color:#8fa6b2}.parameter-grid :deep(.n-input-number){width:100%}.parameter-grid>.n-button{align-self:end}.error{font-size:11px;color:#cc675a}
.block-item{background:#f8fbfd;border:1px solid #e3edf3;border-radius:8px;margin-bottom:8px;padding:12px}.block-header{display:flex;justify-content:space-between;gap:9px}.block-header strong{font-size:12px;color:#3b708c}.block-item p,.no-blockers{font-size:11px;line-height:1.75;color:#8ba1ac;margin:7px 0}.check-links{display:flex;gap:10px}.check-links a,.hardware-rows a{font-size:11px;color:#1785b1;text-decoration:none}
.balances{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:#6692a6}.balances span{background:#f1f7fa;padding:7px 9px;border-radius:5px}
.hardware-rows{display:grid;gap:8px}.hardware-rows>div{display:flex;align-items:center;gap:10px;border-bottom:1px solid #edf2f5;padding:8px 0}.hardware-rows>div>div{flex:1;min-width:0}.hardware-rows strong{font-size:11px;color:#416d87}.hardware-rows p{font-size:10px;color:#90a6b3;margin:5px 0;line-height:1.6}
.lower-actions,.footer-links{display:flex;gap:8px;flex-wrap:wrap}.saved{padding:9px;font-size:11px;background:#eff8f5;color:#36876b;border-radius:6px}.table-wrap{overflow:auto}.table-wrap table{border-collapse:collapse;width:100%;font-size:11px;min-width:640px}.table-wrap th,.table-wrap td{padding:9px;text-align:right;border-bottom:1px solid #e6eff4}.table-wrap th{color:#6392a7;background:#f6fbfd}.table-wrap td{color:#698b9b}.table-wrap .negative{color:#ce715e}.assumptions{display:grid;gap:6px;margin-top:13px}.assumptions p{font-size:11px;color:#809ca9;line-height:1.7;background:#f8fafc;padding:9px;margin:0}.footer-links{border-top:1px solid #e5eef2;padding-top:13px;margin-top:12px}.footer-links a{font-size:11px;color:#1e89af;text-decoration:none}
@media(max-width:1300px){.process-flow{flex-wrap:wrap}.flow-node{min-width:40%}.flow-arrow{min-width:32px}.body-grid{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:680px){.hero{flex-direction:column;align-items:flex-start}.process-flow{display:grid;grid-template-columns:1fr}.flow-node{min-width:0}.flow-arrow{min-width:0;line-height:1}.kpis,.parameter-grid{grid-template-columns:1fr}.flow-node p{min-height:0}}
.v33-balance-link{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin:9px 0;font-size:11px}.v33-balance-link a{color:#247da0;text-decoration:none;font-weight:600}.v33-balance-link span{color:#a38e73}
</style>

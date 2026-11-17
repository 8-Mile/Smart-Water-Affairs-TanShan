<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { NButton, NCheckbox, NInputNumber, NTag, useMessage } from "naive-ui";
import { useDemoStore } from "../demo/store";
import { can } from "../demo/permissions";
import {
  cloneEnergyInputs, defaultPumpEnergyInputs, evaluatePumpEnergy,
  readEnergyDrafts, saveEnergyDraft,
  type PumpEnergyInputs, type PumpCombination, type PumpEnergyDraft,
  type PumpEnergyPoint, type PumpEnergyResult,
} from "../demo/pumpEnergy";

const store=useDemoStore();
const message=useMessage();
const inputs=reactive<PumpEnergyInputs>(defaultPumpEnergyInputs(store.assets));
const applied=ref<PumpEnergyInputs>(cloneEnergyInputs(inputs));
const error=ref("");
const settingsOpen=ref(false);
const advancedOpen=ref(false);
const detailsOpen=ref(false);
const draftsOpen=ref(false);
const selectedKey=ref("");
const drafts=ref<PumpEnergyDraft[]>(readEnergyDrafts(localStorage,store.scenarioId));
const canSave=computed(()=>can(store.role,"energy:proposal"));
const dirty=computed(()=>JSON.stringify(inputs)!==JSON.stringify(applied.value));
const result=computed<PumpEnergyResult|null>(()=> {
  try{return evaluatePumpEnergy(applied.value);}catch{return null;}
});
const selectedOption=computed(()=>result.value?.combinations.find(x=>x.key===selectedKey.value)??result.value?.recommended??null);
const feasibleCount=computed(()=>result.value?.combinations.filter(x=>x.feasible).length??0);
const number=new Intl.NumberFormat("zh-CN",{maximumFractionDigits:2});
const specificNumber=new Intl.NumberFormat("zh-CN",{minimumFractionDigits:3,maximumFractionDigits:4});
function se(value:number):string{return specificNumber.format(value);}
function n(value:number|null|undefined):string {return value===null||value===undefined?"—":number.format(value);}
function money(value:number|null):string {return value===null?"暂不可比":(value<0?"−":"")+"¥"+n(Math.abs(value));}
function label(resultItem:PumpCombination|null):string {
  return resultItem?.codes.join(" + ")??"暂无符合约束的组合";
}
function refreshDrafts():void {drafts.value=readEnergyDrafts(localStorage,store.scenarioId);}
function calculate():void {
  try{
    const next=cloneEnergyInputs(inputs);
    const output=evaluatePumpEnergy(next);
    applied.value=next;
    selectedKey.value=output.recommended?.key??"";
    error.value="";
    message.success("已按MOCK运行点重算机组组合与电耗");
  }catch(e){error.value=(e as Error).message;message.error(error.value);}
}
function preset(mode:"normal"|"peak"|"fault"|"standby"):void {
  const next=defaultPumpEnergyInputs(store.assets);
  if(mode==="peak"){
    next.dailyVolumeM3=9300;
    next.peakFlowM3h=600;
  }else if(mode==="fault"){
    const p=next.pumps.find(x=>x.code==="P-002");
    if(p){p.status="fault";p.readyForDispatch=false;}
  }else if(mode==="standby"){
    const p=next.pumps.find(x=>x.code==="P-004");
    if(p)p.readyForDispatch=true;
  }
  Object.assign(inputs,cloneEnergyInputs(next));
  calculate();
}
function markUserEntry(pump:PumpEnergyPoint):void{
  pump.provenance="USER_ENTRY";
}
function save():void {
  if(!result.value)return;
  try{
    const saved=saveEnergyDraft(result.value,store.role,store.scenarioId,localStorage);
    refreshDrafts();
    draftsOpen.value=true;
    message.success("已保存待工程核验的能效比选草稿 "+saved.id+"；未改变设备运行状态");
  }catch(e){message.error((e as Error).message);}
}
watch(()=>store.scenarioId,()=>{
  Object.assign(inputs,defaultPumpEnergyInputs(store.assets));
  applied.value=cloneEnergyInputs(inputs);
  selectedKey.value="";
  error.value="";
  refreshDrafts();
});
const maxBar=computed(()=>Math.max(1,...(result.value?.combinations.filter(x=>x.feasible).map(x=>x.energyKwh)??[])));
</script>

<template>
  <div class="energy-root">
    <header class="energy-hero">
      <div>
        <div class="energy-breadcrumb">中压供水 · 工况计算 / 能效决策</div>
        <h2>泵组运行组合与能耗比选 <small>V1 · 定频泵 / 单工况点</small></h2>
        <p>同一日供水任务下，校核峰值流量、总扬程、运行小时与备用能力，比较单泵和多泵组合的单位水量电耗。</p>
      </div>
      <div class="hero-tags">
        <NTag type="warning" size="small">MOCK 工况假设</NTag>
        <NTag size="small" type="info">不下发启停控制</NTag>
      </div>
    </header>

    <section class="scenario-bar">
      <div class="scenario-copy"><strong>快速验证工况匹配</strong><span>方案重新计算时会说明不能采用某台泵的具体原因</span></div>
      <div class="scenario-buttons">
        <NButton secondary size="small" @click="preset('normal')">正常供水</NButton>
        <NButton secondary size="small" @click="preset('peak')">高峰双泵需求</NButton>
        <NButton secondary size="small" @click="preset('fault')">模拟P-002故障</NButton>
        <NButton secondary size="small" @click="preset('standby')">假设备用泵已核验</NButton>
      </div>
    </section>

    <template v-if="result">
      <div class="metric-grid">
        <div class="metric">
          <span>日供水任务量</span>
          <strong>{{ n(result.inputs.dailyVolumeM3) }}<em>m³</em></strong>
          <small>需同时满足 {{ n(result.inputs.peakFlowM3h) }} m³/h 峰值</small>
        </div>
        <div class="metric">
          <span>当前组合预测电耗</span>
          <strong>{{ result.baseline?.feasible ? n(result.baseline.energyKwh) : "不可比" }}<em v-if="result.baseline?.feasible">kWh</em></strong>
          <small>{{ label(result.baseline) }} · 现行组合</small>
        </div>
        <div class="metric">
          <span>条件最优组合单位电耗</span>
          <strong>{{ result.recommended ? se(result.recommended.unitEnergyKwhM3) : "无可行组合" }}<em v-if="result.recommended">kWh/m³</em></strong>
          <small>{{ label(result.recommended) }} · 模拟计算</small>
        </div>
        <div class="metric">
          <span>与当前组合的假设成本差</span>
          <strong :class="{good:result.savingYuan!==null&&result.savingYuan>0}">{{ money(result.savingYuan) }}</strong>
          <small>{{ result.savingKwh===null?"当前组合不满足约束，不能比较":'假设节电 '+n(result.savingKwh)+' kWh（'+n(result.savingPercent)+'%）' }}</small>
        </div>
      </div>

      <div class="decision-grid">
        <section class="panel combinations">
          <div class="section-heading">
            <div><h3>泵组运行方案比较</h3><p>共 {{ result.combinations.length }} 种组合，其中 {{ feasibleCount }} 种符合本次模拟约束；同一目标供水量比较。</p></div>
            <NTag :type="result.recommended?'success':'error'">{{ result.recommended?"存在条件可行组合":"当前条件无可行组合" }}</NTag>
          </div>
          <div class="compare-header"><span>运行机组组合</span><span>共同运行时间</span><span>单位电耗</span><span>全任务预测电耗</span></div>
          <button v-for="option in result.combinations" :key="option.key" type="button"
            class="combo-row" :class="{highlight:option.key===result.recommended?.key,selected:option.key===selectedOption?.key,blocked:!option.feasible}"
            @click="selectedKey=option.key">
            <div class="combo-name">
              <strong>{{ option.codes.join(' + ') }}</strong>
              <div>
                <NTag v-if="option.isBaseline" size="tiny" type="info">当前组合</NTag>
                <NTag v-if="option.key===result.recommended?.key" size="tiny" type="success">模拟优选</NTag>
                <NTag v-if="!option.feasible" size="tiny" type="warning">条件不足</NTag>
              </div>
            </div>
            <span>{{ n(option.runHours) }} h</span>
            <span>{{ se(option.unitEnergyKwhM3) }} kWh/m³</span>
            <div class="combo-energy">
              <strong>{{ n(option.energyKwh) }} kWh</strong>
              <div class="energy-bar"><i :style="{width:(option.energyKwh/maxBar*100)+'%',opacity:option.feasible?1:.3}"></i></div>
            </div>
          </button>
          <p class="compare-note">点击方案查看约束；灰色方案仅保留计算结果用于解释被淘汰的原因，不参与推荐或节能结论。</p>
        </section>

        <aside class="panel option-detail">
          <div class="section-heading"><div><h3>方案可行性与决策依据</h3><p>只在已配置的演示条件下比较，不表示现场已具备启停条件</p></div></div>
          <template v-if="selectedOption">
            <div class="option-title">
              <span>{{ selectedOption.feasible?"条件模拟可行":"当前约束阻断" }}</span>
              <strong>{{ label(selectedOption) }}</strong>
            </div>
            <div class="option-kv"><span>模拟总流量</span><strong>{{ n(selectedOption.totalFlowM3h) }} m³/h</strong></div>
            <div class="option-kv"><span>假设输入有功功率</span><strong>{{ n(selectedOption.totalInputKw) }} kW</strong></div>
            <div class="option-kv"><span>计划运行时长</span><strong>{{ n(selectedOption.runHours) }} h</strong></div>
            <div class="option-kv"><span>综合电价假设</span><strong>{{ n(result.inputs.electricityYuanKwh) }} 元/kWh</strong></div>
            <div class="option-kv"><span>本次任务预测费用</span><strong>{{ money(selectedOption.electricCostYuan) }}</strong></div>
            <div v-if="selectedOption.reasons.length" class="blockers">
              <strong>不能直接纳入比选的原因</strong>
              <p v-for="reason in selectedOption.reasons" :key="reason">{{ reason }}</p>
            </div>
            <div v-else class="conditional">
              仅满足演示容量与时长约束。实际还需核验Q-H曲线、共母管连接、工况点效率、联锁保护与调度许可。
            </div>
          </template>
          <div v-else class="blockers">不存在任何可供比较的组合，请核实数据输入。</div>
          <div class="save-actions">
            <NButton type="primary" block :disabled="!canSave||!result.recommended||dirty" @click="save">保存待工程复核建议草稿</NButton>
            <small>{{ !canSave?"当前角色可查看计算，但无保存建议权限。":dirty?"请先重新计算已修改的参数，再保存建议。":"仅将计算参数和方案保存在本地，不会自动启停泵或下发调度令。" }}</small>
          </div>
        </aside>
      </div>

      <section class="panel points">
        <div class="section-heading">
          <div><h3>各泵模拟运行点与物理核算</h3><p>输入功率与流量均为假设点；综合效率为由假设流量、总扬程和输入电功率反算的 <b>wire-to-water</b>，不是厂家实测效率。</p></div>
          <NButton secondary size="small" @click="detailsOpen=!detailsOpen">{{ detailsOpen?"收起计算解释":"查看水力功率核算" }}</NButton>
        </div>
        <div class="point-grid">
          <div v-for="point in result.points" :key="point.assetId" class="point-card">
            <div class="point-head"><strong>{{ point.code }}</strong><small>{{ result.inputs.pumps.find(x=>x.assetId===point.assetId)?.status==="running"?"当前运行":result.inputs.pumps.find(x=>x.assetId===point.assetId)?.status==="fault"?"当前故障":'停机/备用' }}</small></div>
            <div class="point-meter"><span>模拟工况单位电耗</span><strong>{{ se(point.specificEnergyKwhM3) }}<em>kWh/m³</em></strong></div>
            <div class="point-line"><span>流量 / 总扬程</span><strong>{{ n(point.flowM3h) }} m³/h / {{ n(point.headM) }} m</strong></div>
            <div class="point-line"><span>假设输入有功功率</span><strong>{{ n(point.electricKw) }} kW</strong></div>
            <div v-if="detailsOpen" class="point-details">
              <div><span>水力功率（反算）</span><strong>{{ n(point.hydraulicKw) }} kW</strong></div>
              <div><span>假设综合效率</span><strong>{{ n(point.wireToWaterEfficiencyPct) }}%</strong></div>
              <div><span>功率数据来源</span><strong>{{ result.inputs.pumps.find(x=>x.assetId===point.assetId)?.provenance==="USER_ENTRY"?"人工输入":"模拟假设" }}</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel parameter-panel">
        <div class="section-heading"><div><h3>专业工况参数</h3><p>保持默认可以直接演示；工程人员可修改供水目标、泵工况、备用约束，重新执行模型。</p></div>
          <NButton secondary size="small" @click="settingsOpen=!settingsOpen">{{ settingsOpen?"收起计算条件":"调整计算条件" }}</NButton>
        </div>
        <div v-if="settingsOpen" class="settings">
          <div class="settings-grid">
            <label><span>日供水任务 (m³)</span><NInputNumber v-model:value="inputs.dailyVolumeM3" :min="1" :max="500000" size="small"/></label>
            <label><span>峰时流量需求 (m³/h)</span><NInputNumber v-model:value="inputs.peakFlowM3h" :min="0.01" size="small"/></label>
            <label><span>最低系统总扬程 (m)</span><NInputNumber v-model:value="inputs.requiredHeadM" :min="0.01" size="small"/></label>
            <label><span>单泵日运行上限 (h)</span><NInputNumber v-model:value="inputs.maxRunHours" :min="0.1" :max="24" size="small"/></label>
            <label><span>综合电价 (元/kWh)</span><NInputNumber v-model:value="inputs.electricityYuanKwh" :min="0" :precision="3" size="small"/></label>
          </div>
          <NCheckbox :checked="inputs.minReadyStandby===1" @update:checked="v=>inputs.minReadyStandby=v?1:0">
            演示附加约束：任一运行方案必须保留至少1台已确认可用备用泵
          </NCheckbox>
          <div class="advanced-control"><NButton secondary size="small" @click="advancedOpen=!advancedOpen">{{ advancedOpen?"收起单泵假设":"修改单泵运行点及备用确认" }}</NButton></div>
          <div v-if="advancedOpen" class="pump-editor">
            <div v-for="point in inputs.pumps" :key="point.assetId" class="pump-input">
              <div class="pump-input-head"><strong>{{ point.code }} · {{ point.name }}</strong><NTag size="tiny" :type="point.status==='fault'?'error':point.status==='running'?'success':'default'">{{ point.status }}</NTag></div>
              <p>DEMO铭牌：{{ n(point.ratedMotorKw) }}kW，{{ n(point.ratedFlowM3h) }}m³/h，{{ n(point.ratedHeadM) }}m。不是厂家曲线。</p>
              <div class="settings-grid">
                <label><span>假设运行流量(m³/h)</span><NInputNumber v-model:value="point.flowM3h" :min="0.01" size="small" @update:value="markUserEntry(point)"/></label>
                <label><span>假设工况总扬程(m)</span><NInputNumber v-model:value="point.totalHeadM" :min="0.01" size="small" @update:value="markUserEntry(point)"/></label>
                <label><span>假设输入有功功率(kW)</span><NInputNumber v-model:value="point.electricalInputKw" :min="0.01" size="small" @update:value="markUserEntry(point)"/></label>
              </div>
              <NCheckbox v-if="point.status==='stopped'" v-model:checked="point.readyForDispatch">演示假设：现场已确认该停机/备用泵具备投运条件（不改变实际设备状态）</NCheckbox>
              <small>{{ point.provenance==="USER_ENTRY"?"本次人工填写的演示工况":"程序内置的演示假设工况" }}</small>
            </div>
          </div>
          <p v-if="dirty" class="dirty-warning">参数已修改，当前结果仍为上一次有效计算，请点击重新计算。</p>
          <p v-if="error" class="error">{{ error }}</p>
          <div class="settings-actions"><NButton secondary @click="preset('normal')">恢复默认演示</NButton><NButton type="primary" @click="calculate">重新计算所有机组组合</NButton></div>
        </div>
      </section>

      <section class="panel boundary-panel">
        <div class="section-heading"><div><h3>计算可信度与现场实施边界</h3><p>模拟工况与真实运行之间，还缺哪些关键证据</p></div></div>
        <div class="warnings">
          <div v-for="warning in result.warnings" :key="warning"><span>!</span>{{ warning }}</div>
        </div>
        <details class="formula-details"><summary>查看计算公式与校核规则</summary>
          <p v-for="(check,i) in result.checks" :key="i">{{ i+1 }}. {{ check }}</p>
        </details>
      </section>

      <section v-if="drafts.length" class="panel draft-panel">
        <div class="section-heading"><div><h3>待工程复核的能效建议</h3><p>本机存储，仅作模拟分析归档，未创建工单、未启停泵。</p></div>
          <NButton secondary size="small" @click="draftsOpen=!draftsOpen">{{ draftsOpen?"收起草稿":"查看草稿（"+drafts.length+"）" }}</NButton></div>
        <div v-if="draftsOpen" class="drafts">
          <div v-for="draft in drafts.slice(0,12)" :key="draft.id" class="draft">
            <div><strong>{{ draft.id }}</strong><small>{{ new Date(draft.createdAt).toLocaleString('zh-CN',{hour12:false}) }} · {{ draft.createdBy }} · 待工程复核</small></div>
            <span>{{ draft.recommendedKey }} · 日供水量 {{ n(draft.inputs.dailyVolumeM3) }}m³ · 假设节约 {{ draft.conditionalSavingYuan===null?"不可比":money(draft.conditionalSavingYuan) }}</span>
          </div>
        </div>
      </section>
    </template>
    <div v-else class="panel error">当前泵组资料不足，不能计算能效方案。请确认设备铭牌、运行点和供水需求。</div>
    <p class="bottom-note">水利专业说明：本期用电量估算不应作为采购、调度或节能绩效依据。真实优化须提供厂家Q-H、η-Q、P-Q曲线，准确的系统扬程、实际有功功率、电能及流量曲线，并完成最小流量、汽蚀余量、并联运行与泵组启停许可验证。</p>
  </div>
</template>

<style scoped>
.energy-root{display:grid;gap:14px;min-width:0;color:#2c536c}
.energy-hero{padding:19px 22px;border-radius:11px;border:1px solid #cce2ef;background:linear-gradient(108deg,#e2f3fa,#f8fcff 58%,#e4f4ef);display:flex;justify-content:space-between;align-items:center;gap:15px}
.energy-breadcrumb{font-size:11px;color:#5592ae;margin-bottom:6px}
.energy-hero h2{font-size:22px;color:#1e5574;font-weight:700;margin:0}
.energy-hero h2 small{font-size:12px;font-weight:500;color:#89a5b4}
.energy-hero p{font-size:12px;line-height:1.7;color:#7796a9;margin:7px 0 0}
.hero-tags{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.scenario-bar,.panel,.metric{background:#fff;border:1px solid #dceaf3;border-radius:10px;box-shadow:0 4px 18px #2b668609}
.scenario-bar{background:#f9fcfe;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:11px;padding:12px 16px}
.scenario-copy{display:grid;gap:4px}
.scenario-copy strong{font-size:13px;color:#346987}
.scenario-copy span{font-size:11px;color:#92a6b5}
.scenario-buttons{display:flex;flex-wrap:wrap;gap:6px}
.panel{padding:17px;min-width:0}
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}
.metric{padding:16px 17px;display:grid;gap:7px;min-width:0}
.metric>span{font-size:12px;color:#7c97a8}
.metric strong{font-size:24px;color:#24698f;line-height:1.4;overflow-wrap:anywhere}
.metric strong.good{color:#239575}
.metric em{font-size:12px;color:#819fad;font-weight:500;margin-left:4px;font-style:normal}
.metric small{font-size:11px;color:#95a9b7;line-height:1.55}
.decision-grid{display:grid;grid-template-columns:minmax(0,1.56fr) minmax(300px,.9fr);gap:12px}
.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
.section-heading h3{font-size:16px;color:#2c5974;margin:0}
.section-heading p{font-size:11px;color:#90a6b5;line-height:1.65;margin:5px 0 0}
.compare-header,.combo-row{display:grid;grid-template-columns:minmax(160px,1.23fr) .62fr .82fr 1fr;align-items:center;gap:12px}
.compare-header{padding:8px 9px;background:#f4f9fc;font-size:10px;color:#87a1b1;border-radius:6px}
.combo-row{border:1px solid transparent;border-bottom-color:#e7eff4;background:transparent;text-align:left;width:100%;padding:11px 9px;cursor:pointer;font:inherit;color:#52768c;border-radius:7px}
.combo-row.selected{border-color:#9acbe6;background:#f5fbff}
.combo-row.highlight{background:#f0faf7}
.combo-row.blocked{color:#a1afba}
.combo-name{display:grid;gap:5px}
.combo-name strong{font-size:12px;color:#2b607f}
.combo-name>div{display:flex;gap:4px;flex-wrap:wrap}
.combo-row>span{font-size:12px}
.combo-energy{display:grid;gap:5px}
.combo-energy strong{font-size:12px;color:#3a718e}
.energy-bar{height:5px;border-radius:5px;background:#e9f0f6;overflow:hidden}
.energy-bar i{display:block;height:100%;background:linear-gradient(90deg,#55abdc,#40b6b6)}
.compare-note{font-size:10px;line-height:1.7;color:#9aafbc;margin:12px 0 0}
.option-detail{background:linear-gradient(160deg,#eef8ff,#fff 50%);display:flex;flex-direction:column}
.option-title{background:#f4f9fd;padding:12px;border-radius:8px;display:grid;gap:7px;margin-bottom:10px}
.option-title span{font-size:11px;color:#668ca1}
.option-title strong{font-size:19px;color:#246d90}
.option-kv{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #e7eff5;font-size:12px}
.option-kv span{color:#8ca2b1}.option-kv strong{color:#32657c}
.blockers{background:#fff5f1;border:1px solid #f4dbd0;border-radius:7px;padding:10px;margin-top:12px;color:#bd6958;font-size:11px}
.blockers strong{font-size:12px}
.blockers p{line-height:1.65;margin:7px 0}
.conditional{background:#effaf5;border:1px solid #d5f0e5;color:#278567;font-size:11px;line-height:1.8;padding:11px;margin-top:12px;border-radius:7px}
.save-actions{margin-top:auto;padding-top:18px;display:grid;gap:8px}
.save-actions small{color:#96aaba;font-size:10px;line-height:1.6}
.point-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
.point-card{background:#f8fcfe;border:1px solid #dfedf4;padding:14px;border-radius:8px;min-width:0}
.point-head{display:flex;justify-content:space-between;gap:5px}
.point-head strong{font-size:13px;color:#2e6b8f}
.point-head small{font-size:11px;color:#90aabb}
.point-meter{display:grid;gap:5px;margin:14px 0}
.point-meter span,.point-line span{font-size:11px;color:#879daa}
.point-meter strong{font-size:24px;color:#2784ae}
.point-meter em{font-size:11px;font-style:normal;margin-left:4px;font-weight:500}
.point-line{display:flex;justify-content:space-between;gap:10px;margin:10px 0}
.point-line strong{font-size:11px;text-align:right;color:#3d748d}
.point-details{border-top:1px solid #e1ebf2;padding-top:10px;margin-top:10px;display:grid;gap:10px}
.point-details div{display:flex;justify-content:space-between;font-size:11px;gap:8px}
.point-details span{color:#8fa6b5}
.settings{border-top:1px solid #eaf1f5;padding-top:14px}
.settings-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
.settings-grid label{display:grid;gap:5px;min-width:0}
.settings-grid label span{font-size:11px;color:#849eac}
.settings-grid :deep(.n-input-number){width:100%}
.advanced-control{margin-top:15px}
.pump-editor{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}
.pump-input{padding:12px;background:#f7fbfe;border-radius:7px;border:1px solid #e0ecf4}
.pump-input-head{display:flex;align-items:center;justify-content:space-between;gap:7px}
.pump-input-head strong{font-size:12px;color:#286585}
.pump-input p,.pump-input small{font-size:10px;line-height:1.7;color:#8da7b5;display:block;margin:7px 0}
.pump-input .settings-grid{grid-template-columns:1fr}
.pump-input :deep(.n-checkbox){font-size:11px}
.settings-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.dirty-warning{font-size:11px;color:#a98645}
.error{color:#bc5656;font-size:12px}
.warnings{display:grid;gap:8px}
.warnings>div{background:#f8fbfd;border:1px solid #e6eff4;border-radius:6px;padding:9px 10px;font-size:11px;line-height:1.7;color:#748fa0;display:flex;gap:9px}
.warnings>div span{color:#d19d4f;font-weight:800}
.formula-details{padding-top:12px;margin-top:12px;border-top:1px solid #e7eff5}
.formula-details summary{font-size:11px;color:#267da5;cursor:pointer}
.formula-details p{font-size:11px;color:#809baa;line-height:1.8}
.drafts{display:grid;gap:7px}
.draft{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;border:1px solid #e2edf4;background:#f8fbfe;border-radius:7px;padding:11px}
.draft div{display:grid;gap:5px}
.draft strong{font-size:12px;color:#326780}
.draft small,.draft span{font-size:10px;color:#809bad}
.bottom-note{font-size:11px;color:#8fa5b4;line-height:1.8;margin:0}
@media(max-width:1400px){.decision-grid{grid-template-columns:1fr}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1000px){.point-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pump-editor{grid-template-columns:1fr}.compare-header,.combo-row{grid-template-columns:minmax(145px,1.2fr) .6fr .7fr 1fr;gap:6px}}
@media(max-width:700px){.energy-hero{flex-direction:column;align-items:flex-start}.metric-grid,.point-grid{grid-template-columns:1fr 1fr}.settings-grid{grid-template-columns:1fr 1fr}.compare-header,.combo-row{grid-template-columns:minmax(120px,1fr) .8fr}.compare-header span:nth-child(2),.compare-header span:nth-child(3),.combo-row>span{display:none}}
@media(max-width:480px){.metric-grid,.point-grid,.settings-grid{grid-template-columns:1fr}.scenario-buttons{display:grid;grid-template-columns:1fr 1fr}.combo-row{grid-template-columns:1fr 1fr}}
</style>

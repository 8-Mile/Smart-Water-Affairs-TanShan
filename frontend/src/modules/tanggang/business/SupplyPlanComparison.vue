<script setup lang="ts">
import {computed,ref} from 'vue'
import {useScenarioStore} from '../simulation/store'
import type {SupplyPlan} from '../simulation/supplyPlans'
import {SUPPLY_PLAN_MODEL} from '../simulation/supplyPlans'

const store=useScenarioStore()
const plans=computed(()=>store.supplyPlans)
const opened=ref<string[]>([])
const fmt=(n:number)=>n.toLocaleString('zh-CN',{maximumFractionDigits:1})
const red=(p:SupplyPlan)=>p.constraint==='CONSTRAINT_FAIL'

function exportSnapshot(){
  if(!store.running||!store.effectiveScenario||!store.result)return
  // A downloadable, explicitly labelled simulation calculation record.
  // Nothing is persisted in backend or written to equipment/SCADA.
  const payload={
    reportType:'TG-DEMO-SUPPLY-PLAN-COMPARISON',
    modelVersion:SUPPLY_PLAN_MODEL,
    stage:'DOCUMENT_BASED_DEMO',
    dataMode:'SIM',
    provenance:'全部数值为依据用户资料建立的演示假设，非唐港现场实测',
    noFieldValidation:true,
    noHydraulicValidation:true,
    noActualDispatch:true,
    scenarioId:store.activeId,
    runNumber:store.runNumber,
    startedAt:store.startedAt,
    inputs:store.effectiveScenario.inputs,
    baseResult:store.result,
    comparison:plans.value.map(p=>({
      id:p.id,title:p.title,change:p.change,assumptions:p.assumptions,
      input:p.input,result:p.result,
      deferredDemandM3h:p.deferredDemandM3h,
      rawEndStorageM3:p.rawEndStorageM3,
      safetyMarginM3:p.safetyMarginM3,
      constraint:p.constraint,blockers:p.blockers,fieldValidated:false,
      sourceMode:'SIM',
    })),
  }
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download='唐港-演示供水方案比选-'+store.runNumber+'.json'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1500)
}
</script>

<template>
  <section v-if="store.running&&plans.length" class="tg-biz-card art-card tg-plan-comparison">
    <div class="tg-biz-card-head tg-plan-comparison-head">
      <div>
        <h2>供水方案比选</h2>
        <p>同一轮SIM参数 · 对比当期缺口与储量变化</p>
      </div>
      <div class="tg-plan-tools">
        <el-button size="small" plain @click="store.openConsole()">调整假设</el-button>
        <el-button size="small" plain @click="exportSnapshot">导出比选依据</el-button>
      </div>
    </div>
    <el-table :data="plans" row-key="id" style="width:100%" class="tg-plan-table"
      :expand-row-keys="opened" @expand-change="(row:SupplyPlan,rows:SupplyPlan[])=>{opened=rows.map(p=>p.id)}">
      <el-table-column type="expand" width="34">
        <template #default="{row}">
          <div class="tg-plan-detail">
            <div class="tg-plan-why">
              <strong>计算假设</strong>
              <p>{{row.change}}</p>
              <p v-for="a in row.assumptions" :key="a">{{a}}</p>
            </div>
            <div class="tg-plan-why">
              <strong>实施前提与限制</strong>
              <p v-for="a in row.blockers" :key="a">{{a}}</p>
              <p>未核实现场泵组、真实管网、储量曲线、作业计划及审批权限；本方案不能直接执行。</p>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="方案" min-width="168">
        <template #default="{row}">
          <div class="tg-plan-name">
            <strong>{{row.title}}</strong>
            <span v-if="row.id==='as-is'">基准</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="当期需求" min-width="98" align="right">
        <template #default="{row}">{{fmt(row.result.demandedM3h)}}</template>
      </el-table-column>
      <el-table-column label="可分配" min-width="90" align="right">
        <template #default="{row}">{{fmt(row.result.deliveredM3h)}}</template>
      </el-table-column>
      <el-table-column label="缺口" min-width="83" align="right">
        <template #default="{row}">
          <span :class="{'tg-plan-risk-number':row.result.shortageM3h>0}">{{fmt(row.result.shortageM3h)}}</span>
        </template>
      </el-table-column>
      <el-table-column label="顺延需求" min-width="91" align="right">
        <template #default="{row}">{{fmt(row.deferredDemandM3h)}}</template>
      </el-table-column>
      <el-table-column label="期末储量" min-width="110" align="right">
        <template #default="{row}">
          <span :class="{'tg-plan-risk-number':red(row)}">{{fmt(row.rawEndStorageM3)}}</span>
        </template>
      </el-table-column>
      <el-table-column label="约束判断" min-width="126" align="right">
        <template #default="{row}">
          <span class="tg-plan-status" :class="{danger:red(row)}">
            {{red(row)?'储量约束未通过':'模型内未越线'}}
          </span>
        </template>
      </el-table-column>
    </el-table>
    <p class="tg-plan-footnote">
      流量单位 m³/h，储量单位 m³；顺延不等于节水。全部方案均未进行现场核实或水力校核，不构成生产调度建议。
      点击方案左侧展开计算依据。
    </p>
  </section>
</template>

<style scoped>
.tg-plan-comparison{margin-top:14px;overflow:hidden}
.tg-plan-comparison-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
.tg-plan-comparison-head p{margin:4px 0 0;color:#91a2af;font-size:11px}
.tg-plan-tools{display:flex;gap:6px;flex-wrap:wrap}
.tg-plan-table{width:100%;background:transparent;font-size:12px}
.tg-plan-name{display:flex;align-items:center;gap:6px;white-space:nowrap}
.tg-plan-name strong{color:#415f71;font-size:12px;font-weight:660}
.tg-plan-name>span{font-size:10px;color:#8fa0ab}
.tg-plan-risk-number{color:#b67a36;font-weight:650}
.tg-plan-status{font-size:11px;color:#5e788b;white-space:nowrap}
.tg-plan-status.danger{color:#b67935}
.tg-plan-detail{display:grid;grid-template-columns:1fr 1fr;gap:16px;
  padding:8px 14px 17px;color:#6e8492;font-size:11px}
.tg-plan-why strong{display:block;font-size:12px;color:#456578;margin-bottom:7px}
.tg-plan-why p{margin:5px 0;line-height:1.5}
.tg-plan-footnote{margin:14px 0 0;font-size:11px;color:#8a9daa;line-height:1.6}
@media(max-width:850px){
  .tg-plan-comparison-head{align-items:flex-start;flex-direction:column}
  .tg-plan-detail{grid-template-columns:1fr;gap:9px}
  .tg-plan-comparison :deep(.el-table__body-wrapper){overflow-x:auto}
}
</style>

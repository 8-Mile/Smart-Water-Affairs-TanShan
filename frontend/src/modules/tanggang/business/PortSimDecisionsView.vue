<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {useScenarioStore} from '../simulation/store'
import type {SupplyPlan} from '../simulation/supplyPlans'
import {processName} from '../simulation/waterOperations'
import PortOperatingInputs from './PortOperatingInputs.vue'
import './business.css'

const router=useRouter()
const store=useScenarioStore()
const selectedId=ref('as-is')
const plans=computed(()=>store.supplyPlans)
const current=computed(()=>plans.value.find(p=>p.id===selectedId.value)||plans.value[0]||null)
const r=computed(()=>store.result)
const fmt=(v:number)=>v.toLocaleString('zh-CN',{maximumFractionDigits:1})
const constraints=(p:SupplyPlan)=>
  p.constraint==='CONSTRAINT_FAIL'?'储量约束未满足':'条件待核实'
watch(()=>plans.value.map(p=>p.id).join('|'),()=>{
  if(!plans.value.some(p=>p.id===selectedId.value))selectedId.value='as-is'
})
</script>

<template>
  <main class="tg-biz tg-decision-v2 page-fill" data-testid="tg-decision-main">
    <header class="tg-decision-toolbar">
      <span class="tg-decision-status" :class="{manual:!store.autoEnabled}">
        {{store.autoEnabled?'自动分析':store.running?'人工参数':'暂无数据'}}
      </span>
      <div class="tg-decision-actions">
        <PortOperatingInputs context="supply"/>
        <el-button plain @click="router.push('/port/operations/monitor')">运行监护</el-button>
      </div>
    </header>

    <template v-if="r&&plans.length">
      <div class="tg-decision-summary">
        <div class="tg-biz-card"><small>用水需求</small><strong>{{fmt(r.demandedM3h)}} <em>m³/h</em></strong></div>
        <div class="tg-biz-card"><small>可分配能力</small><strong>{{fmt(r.usableCapacityM3h)}} <em>m³/h</em></strong></div>
        <div class="tg-biz-card"><small>当前供水缺口</small><strong :class="{warn:r.shortageM3h>0}">{{fmt(r.shortageM3h)}} <em>m³/h</em></strong></div>
        <div class="tg-biz-card"><small>预测末储量</small><strong>{{fmt(r.forecastPoolM3)}} <em>m³</em></strong></div>
      </div>

      <div v-if="r.events.length" class="tg-decision-findings"
        data-testid="decision-current-findings">
        <strong v-for="event in r.events" :key="event.id">{{event.title}}</strong>
      </div>

      <section class="tg-biz-card tg-decision-plan-section" data-testid="decision-plan-comparison">
        <div class="tg-biz-card-head">
          <h2>供水保障方案</h2>
          <el-button link @click="router.push('/port/water/supply')">查看供水分配</el-button>
        </div>
        <div class="tg-decision-plans">
          <button v-for="p in plans" :key="p.id" class="tg-decision-plan"
            :class="{active:selectedId===p.id,risk:p.constraint==='CONSTRAINT_FAIL'}"
            :data-plan-id="p.id" type="button" @click="selectedId=p.id">
            <span class="tg-decision-plan-top">
              <strong>{{p.title}}</strong>
              <small>{{constraints(p)}}</small>
            </span>
            <span class="tg-decision-plan-number">{{fmt(p.result.shortageM3h)}}
              <em>m³/h 缺口</em></span>
            <span class="tg-decision-plan-bottom">
              预测余量 {{fmt(p.safetyMarginM3)}} m³
              <span v-if="p.deferredDemandM3h>0">· 顺延 {{fmt(p.deferredDemandM3h)}} m³/h</span>
            </span>
          </button>
        </div>
      </section>

      <div class="tg-decision-grid">
        <section v-if="current" class="tg-biz-card tg-decision-details"
          data-testid="decision-plan-detail">
          <div class="tg-biz-card-head">
            <h2>{{current.title}}</h2>
            <span class="tg-decision-valid" :class="{warn:current.constraint==='CONSTRAINT_FAIL'}">
              {{constraints(current)}}
            </span>
          </div>
          <div class="tg-decision-comparison">
            <div><small>计划分配</small><strong>{{fmt(current.result.deliveredM3h)}} <em>m³/h</em></strong></div>
            <div><small>剩余需求</small><strong>{{fmt(current.result.shortageM3h)}} <em>m³/h</em></strong></div>
            <div><small>顺延需求</small><strong>{{fmt(current.deferredDemandM3h)}} <em>m³/h</em></strong></div>
            <div><small>期末安全余量</small><strong>{{fmt(current.safetyMarginM3)}} <em>m³</em></strong></div>
          </div>
          <div class="tg-decision-constraints">
            <strong>方案条件</strong>
            <div v-for="line in current.blockers" :key="line">{{line}}</div>
            <span v-if="!current.blockers.length">暂无模型阻断项</span>
          </div>
          <div class="tg-decision-detail-actions">
            <el-button plain size="small" @click="router.push('/port/process/middle')">中压供水工艺</el-button>
            <el-button plain size="small" @click="router.push('/port/process/pool')">水池供水工艺</el-button>
          </div>
        </section>

        <section class="tg-biz-card tg-decision-events">
          <div class="tg-biz-card-head">
            <h2>关联运行事件</h2>
            <el-button link @click="router.push('/port/operations/monitor')">处理事件</el-button>
          </div>
          <template v-if="store.activeCases.length">
            <div v-for="c in store.activeCases.slice(-6).reverse()" :key="c.id"
              class="tg-decision-event">
              <span :class="{critical:c.level==='critical'}"/>
              <div><strong>{{c.title}}</strong>
                <small>{{processName(c.sourceProcess)}} · {{c.status==='new'?'待确认':'处理中'}}</small>
              </div>
              <el-button link size="small"
                @click="router.push('/port/operations/monitor?case='+c.id)">查看</el-button>
            </div>
          </template>
          <div v-else class="tg-decision-empty">当前没有待处理事件</div>
          <details class="tg-decision-source-details">
            <summary>方案计算依据</summary>
            <p>统一供水能力与负荷输入、用水点优先级、库容安全约束。</p>
            <p>当前为SIM模型计算；真实泵曲线、管网连通和许可尚需工程核验。</p>
          </details>
        </section>
      </div>
    </template>
    <section v-else class="tg-biz-card tg-decision-empty">
      <strong>当前无运行数据</strong>
      <el-button size="small" @click="store.resumeAuto()">启动自动数据</el-button>
    </section>
  </main>
</template>

<style scoped>
.tg-decision-v2{display:flex;flex-direction:column;gap:13px;min-width:0}
.tg-decision-toolbar{display:flex;justify-content:flex-end;align-items:center;
  flex-wrap:wrap;min-height:46px;gap:10px}
.tg-decision-status{font-size:11px;color:#4b9282;margin-right:auto}
.tg-decision-status.manual{color:#bc8b56}
.tg-decision-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tg-decision-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}
.tg-decision-summary .tg-biz-card{padding:14px 16px;display:flex;flex-direction:column;gap:9px}
.tg-decision-summary small{font-size:11px;color:#879ead}
.tg-decision-summary strong{font-size:23px;color:#327f9c}
.tg-decision-summary strong.warn{color:#bc8350}
.tg-decision-summary em,.tg-decision-comparison em{font-size:11px;font-weight:400;font-style:normal}
.tg-decision-findings{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tg-decision-findings strong{font-size:11px;color:#aa784c;border:1px solid #ead3b6;
  border-radius:5px;padding:7px 10px;background:rgba(255,247,234,.92)}
.tg-decision-plan-section,.tg-decision-details,.tg-decision-events{padding:16px 18px}
.tg-decision-plans{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.tg-decision-plan{border:1px solid #dfebf1;border-radius:9px;padding:14px;
  background:rgba(248,252,254,.85);text-align:left;display:flex;
  flex-direction:column;gap:10px;cursor:pointer;color:#517a91;font:inherit;min-width:0}
.tg-decision-plan.active{border-color:#6daccc;background:#eaf5fa}
.tg-decision-plan.risk{border-color:#e9c8a5}
.tg-decision-plan-top{display:flex;gap:7px;justify-content:space-between;
  flex-wrap:wrap;align-items:center}
.tg-decision-plan-top strong{font-size:12px}
.tg-decision-plan-top small{font-size:10px;color:#9c9885}
.tg-decision-plan-number{font-size:24px;color:#317f9e;font-weight:700}
.tg-decision-plan-number em{font-style:normal;font-size:10px;font-weight:400}
.tg-decision-plan-bottom{font-size:10px;color:#879eab}
.tg-decision-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(310px,.85fr);
  gap:13px;align-items:start}
.tg-decision-valid{font-size:10px;color:#5f927b}
.tg-decision-valid.warn{color:#bd8955}
.tg-decision-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.tg-decision-comparison>div{background:#f6fafc;border:1px solid #e0ebf1;
  border-radius:7px;padding:12px}
.tg-decision-comparison small{font-size:10px;color:#879cab;display:block;margin-bottom:5px}
.tg-decision-comparison strong{font-size:20px;color:#357e9d}
.tg-decision-constraints{margin-top:15px;font-size:11px;color:#7c95a3;line-height:1.8}
.tg-decision-constraints strong{display:block;color:#58778a;margin-bottom:4px}
.tg-decision-detail-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.tg-decision-event{display:flex;align-items:center;gap:9px;padding:11px 0;
  border-bottom:1px solid #e0ebf1}
.tg-decision-event>span{width:7px;height:7px;border-radius:50%;background:#d5ae72}
.tg-decision-event>span.critical{background:#cf8067}
.tg-decision-event>div{flex:1;display:flex;flex-direction:column;gap:4px;min-width:0}
.tg-decision-event strong{font-size:11px;color:#537990}
.tg-decision-event small{font-size:10px;color:#8aa1ae}
.tg-decision-source-details{margin-top:13px;padding-top:10px;border-top:1px solid #e1edf1}
.tg-decision-source-details summary{font-size:11px;color:#7593a3;cursor:pointer}
.tg-decision-source-details p{font-size:10px;color:#8ba0ac}
.tg-decision-empty{padding:23px;color:#8ba0ad;font-size:12px}
@media(max-width:1200px){.tg-decision-plans{grid-template-columns:repeat(2,minmax(0,1fr))}
 .tg-decision-grid{grid-template-columns:1fr}}
@media(max-width:650px){.tg-decision-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
 .tg-decision-v2 .tg-biz-card{padding:12px}
 .tg-decision-actions{width:100%}
}
</style>

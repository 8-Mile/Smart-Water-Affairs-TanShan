<script setup lang="ts">
/** The same derived operating model drives system relation, demand matching,
 * operating impact, and economic comparisons. No stored fake KPI payloads.
 */
import {computed,ref} from 'vue'
import {useRouter} from 'vue-router'
import {useScenarioStore} from '../simulation/store'
import {
  WATER_PROCESSES,WATER_RELATIONSHIPS,processName,
  DEFAULT_WATER_POLICY, type ProcessId,
} from '../simulation/waterOperations'
import PortOperationsCaseBoard from './PortOperationsCaseBoard.vue'
const router=useRouter()
const store=useScenarioStore()
const econ=computed(()=>store.waterEconomics)
const output=computed(()=>store.result)
const selectedEdge=ref<string>('clean-reuse')
const expandedAssumptions=ref(false)
const selectedRelation=computed(()=>WATER_RELATIONSHIPS.find(x=>x.id===selectedEdge.value))
const impactMap=computed(()=>new Map(store.processImpacts.map(x=>[x.systemId,x])))
const fmt=(v:number|null|undefined,precision=1)=>
  v===null||v===undefined?'—':
  v.toLocaleString('zh-CN',{maximumFractionDigits:precision,minimumFractionDigits:precision})
const metricSign=(v:number|null|undefined,unit:string)=>{
  if(v===null||v===undefined)return '不可比'
  if(Math.abs(v)<.0001)return '0 '+unit
  return (v>0?'减少 ':'增加 ')+fmt(Math.abs(v),1)+' '+unit
}
const color=(id:ProcessId)=>{
  const level=impactMap.value.get(id)?.level
  return level==='critical'?'critical':level==='attention'?'attention':
    level==='independent'?'independent':'normal'
}
const diagramNodes={
  rain:{x:42,y:105,w:224,h:103},
  mineral:{x:337,y:105,w:225,h:103},
  pool:{x:634,y:105,w:225,h:103},
  middle:{x:987,y:35,w:235,h:106},
  fog:{x:987,y:251,w:235,h:106},
  domestic:{x:337,y:410,w:236,h:96},
} satisfies Record<ProcessId,{x:number;y:number;w:number;h:number}>
const linkPaths:Record<string,string>={
  'collect-treatment':'M266 155 H337',
  'clean-reuse':'M562 155 H634',
  'pool-middle':'M859 155 H924 V88 H987',
  'pool-fog':'M859 177 H924 V304 H987',
  'return-wash':'M1222 87 H1274 V382 H154 V208',
}
const edgeLabels:Record<string,{x:number;y:number;text:string}>={
  'collect-treatment':{x:301,y:131,text:'提升'},
  'clean-reuse':{x:600,y:132,text:'达标回用'},
  'pool-middle':{x:932,y:67,text:'供水'},
  'pool-fog':{x:927,y:279,text:'供水'},
  'return-wash':{x:724,y:375,text:'洗车后回收（间接、条件路径）'},
}
function go(id:ProcessId){void router.push('/port/process/'+id)}
const trend=computed(()=>{
  const samples=store.autoHistory
  if(samples.length<2)return {demand:'',delivered:''}
  const width=1050,height=72
  const max=Math.max(1,...samples.map(s=>s.demandM3h))*1.1
  const poly=(fn:(x:typeof samples[number])=>number)=>samples.map((x,i)=>{
    const dx=i/(samples.length-1)*width
    const dy=height-fn(x)/max*height
    return (i?'L':'M')+dx.toFixed(1)+' '+dy.toFixed(1)
  }).join(' ')
  return {demand:poly(s=>s.demandM3h),delivered:poly(s=>s.deliveredM3h)}
})
const shownAssumptions=computed(()=>DEFAULT_WATER_POLICY.source)
</script>

<template>
  <section class="tg-ops-section" data-testid="water-operations-overview">
    <template v-if="output&&econ">
      <div class="tg-ops-kpis" data-testid="water-economics-kpis">
        <div class="tg-biz-card tg-ops-kpi">
          <span>供需匹配率</span>
          <strong>{{fmt(output.coveragePercent,1)}}<small>%</small></strong>
          <p>已分配 {{fmt(output.deliveredM3h)}} / 需求 {{fmt(output.demandedM3h)}} m³/h</p>
        </div>
        <div class="tg-biz-card tg-ops-kpi">
          <span>模型回用水占比</span>
          <strong>{{fmt(econ.reusePercent,1)}}<small>%</small></strong>
          <p>含假设达标处理回用与市政中水</p>
        </div>
        <div class="tg-biz-card tg-ops-kpi">
          <span>电耗变化（同量）</span>
          <strong :class="{'tg-ops-negative':(econ.savedEnergyKwhH??0)<0}">
            {{econ.energyReductionPercent===null?'不可比':
              (econ.savedEnergyKwhH!==null&&econ.savedEnergyKwhH<0?'↑':'↓')+
              fmt(Math.abs(econ.energyReductionPercent),1)+'%'}}
          </strong>
          <p>{{metricSign(econ.savedEnergyKwhH,'kWh/h')}} · 不是实测节能</p>
        </div>
        <div class="tg-biz-card tg-ops-kpi">
          <span>综合成本变化（同量）</span>
          <strong :class="{'tg-ops-negative':(econ.savedCostYuanH??0)<0}">
            {{econ.costReductionPercent===null?'不可比':
              (econ.savedCostYuanH!==null&&econ.savedCostYuanH<0?'↑':'↓')+
              fmt(Math.abs(econ.costReductionPercent),1)+'%'}}
          </strong>
          <p>{{metricSign(econ.savedCostYuanH,'元/h')}} · 假设单价</p>
        </div>
      </div>

      <section class="tg-biz-card tg-ops-map-card" data-testid="water-network-graph">
        <div class="tg-biz-card-head">
          <h2>六系统业务关联</h2>
          <span class="tg-biz-chip">CAD设计关系</span>
        </div>
        <div class="tg-ops-map-scroll">
          <svg viewBox="0 0 1316 547" class="tg-ops-map-svg"
            role="img" aria-label="六套子系统的设计业务关系：雨水收集→含矿污水处理→水池供水→中压与射雾；生活污水独立。">
            <defs>
              <marker id="tg-ops-link-arrow" markerWidth="8" markerHeight="8"
                refX="7.2" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 Z" fill="#72a9c4"/>
              </marker>
              <marker id="tg-ops-conditional-arrow" markerWidth="8" markerHeight="8"
                refX="7.2" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 Z" fill="#b1a180"/>
              </marker>
            </defs>
            <rect width="1316" height="547" rx="14" fill="#f6fafc"/>
            <path d="M18 248 H1296 M18 399 H1296" stroke="#e2edf2" stroke-width="1"/>
            <text x="35" y="45" fill="#94a9b5" font-size="14">水流与资源回用链</text>
            <text x="35" y="435" fill="#94a9b5" font-size="14">独立生活污水链（不并入含矿处理）</text>
            <g v-for="edge in WATER_RELATIONSHIPS" :key="edge.id"
              tabindex="0" role="button" :aria-label="edge.label"
              :data-relation-id="edge.id"
              @click="selectedEdge=edge.id"
              @keydown.enter.prevent="selectedEdge=edge.id">
              <path :d="linkPaths[edge.id]" stroke="transparent"
                stroke-width="23" fill="none" class="tg-ops-link-hit"/>
              <path :d="linkPaths[edge.id]" fill="none"
                :stroke="selectedEdge===edge.id?'#358cb1':
                  edge.relation==='conditional'?'#b1a180':'#8db8cc'"
                :stroke-width="selectedEdge===edge.id?4.5:3"
                :stroke-dasharray="edge.relation==='conditional'?'8 7':'none'"
                :marker-end="edge.relation==='conditional'?
                  'url(#tg-ops-conditional-arrow)':'url(#tg-ops-link-arrow)'"/>
              <rect :x="edgeLabels[edge.id].x-4"
                :y="edgeLabels[edge.id].y-14"
                :width="edgeLabels[edge.id].text.length*11+8" height="19"
                rx="4" fill="#f8fbfc" opacity=".95"/>
              <text :x="edgeLabels[edge.id].x" :y="edgeLabels[edge.id].y"
                fill="#638da0" font-size="12">{{edgeLabels[edge.id].text}}</text>
            </g>
            <g v-for="process in WATER_PROCESSES" :key="process.id"
              tabindex="0" role="button"
              :data-system-node="process.id"
              :aria-label="'查看'+process.label"
              class="tg-ops-diagram-node"
              :transform="'translate('+diagramNodes[process.id].x+','+
                diagramNodes[process.id].y+')'"
              @click="go(process.id)"
              @keydown.enter.prevent="go(process.id)">
              <rect :width="diagramNodes[process.id].w"
                :height="diagramNodes[process.id].h"
                rx="12" fill="#fff"
                :stroke="color(process.id)==='critical'?'#d59f82':
                  color(process.id)==='attention'?'#deb987':
                  color(process.id)==='independent'?'#b9cbd3':'#afd2e2'"
                stroke-width="2.3"/>
              <rect x="0" y="0" width="5"
                :height="diagramNodes[process.id].h" rx="2.5"
                :fill="color(process.id)==='critical'?'#d78e67':
                  color(process.id)==='attention'?'#d2aa70':
                  color(process.id)==='independent'?'#9db5c1':'#65a2c0'"/>
              <text x="18" y="31" font-size="17" fill="#345f77" font-weight="700">
                {{process.label}}
              </text>
              <text x="18" y="66" font-size="12" fill="#67889b">
                {{impactMap.get(process.id)?.level==='critical'?'SIM风险':
                  impactMap.get(process.id)?.level==='attention'?'SIM关注':
                  process.id==='domestic'?'独立管理':'SIM正常'}}
              </text>
            </g>
            <text x="620" y="465" fill="#849dab" font-size="13">
              办公给水计量与生活污水独立展示，不参与回用节能计算
            </text>
            <text x="45" y="525" fill="#a0b0b9" font-size="12">
              实线：设计业务关系　·　虚线：条件/间接路径　·　未确认物理连通与阀门启闭
            </text>
          </svg>
        </div>
        <div v-if="selectedRelation" class="tg-ops-relation-detail"
          data-testid="water-relation-detail">
          <div>
            <strong>{{processName(selectedRelation.from)}} → {{processName(selectedRelation.to)}}</strong>
            <p>{{selectedRelation.label}}：{{selectedRelation.reason}}</p>
            <small>依据 V2.3 区域水路关系 ·
              {{selectedRelation.relation==='conditional'?'设计条件/未核实':'设计关系/未核实'}} · 非实测管线</small>
          </div>
          <div class="tg-ops-relation-actions">
            <el-button size="small" plain @click="go(selectedRelation.from)">上游工艺</el-button>
            <el-button size="small" plain @click="go(selectedRelation.to)">下游工艺</el-button>
          </div>
        </div>
      </section>

      <div class="tg-ops-grid">
        <section class="tg-biz-card tg-ops-analysis" data-testid="water-source-economics">
          <div class="tg-biz-card-head">
            <h2>水源匹配及综合成本</h2>
            <span class="tg-biz-chip">SIM / 模型比选</span>
          </div>
          <table class="tg-ops-economics-table">
            <thead><tr>
              <th>来源</th><th>基准供水</th><th>成本优先</th><th>节电优先</th>
            </tr></thead>
            <tbody>
              <tr v-for="src in DEFAULT_WATER_POLICY.source" :key="src.id">
                <td>{{src.title}}</td>
                <td>{{fmt(econ.base.allocation.find(x=>x.id===src.id)?.volumeM3h)}} m³/h</td>
                <td><strong>{{fmt(econ.optimized.allocation.find(x=>x.id===src.id)?.volumeM3h)}}</strong> m³/h</td>
                <td>{{fmt(econ.energyPriority.allocation.find(x=>x.id===src.id)?.volumeM3h)}} m³/h</td>
              </tr>
            </tbody>
          </table>
          <div class="tg-ops-cost-comparison">
            <div>
              <span>基准模型</span>
              <strong>{{fmt(econ.base.costYuanH)}} <small>元/h</small></strong>
              <p>{{fmt(econ.base.energyKwhH)}} kWh/h · {{fmt(econ.base.specificKwhM3,3)}} kWh/m³</p>
            </div>
            <div>
              <span>成本优先候选</span>
              <strong>{{fmt(econ.optimized.costYuanH)}} <small>元/h</small></strong>
              <p>{{fmt(econ.optimized.energyKwhH)}} kWh/h · {{fmt(econ.optimized.specificKwhM3,3)}} kWh/m³</p>
            </div>
            <div>
              <span>节电优先候选</span>
              <strong>{{fmt(econ.energyPriority.costYuanH)}} <small>元/h</small></strong>
              <p>{{fmt(econ.energyPriority.energyKwhH)}} kWh/h · {{fmt(econ.energyPriority.specificKwhM3,3)}} kWh/m³</p>
            </div>
          </div>
        </section>

        <section class="tg-biz-card tg-ops-analysis" data-testid="water-auto-diagnosis">
          <div class="tg-biz-card-head">
            <h2>运行风险与工艺影响</h2>
            <span class="tg-biz-chip">{{store.activeScenario?.title}}</span>
          </div>
          <div class="tg-ops-process-impact">
            <div v-for="impact in store.processImpacts" :key="impact.systemId">
              <span class="tg-ops-impact-mark" :class="impact.level"/>
              <strong>{{processName(impact.systemId)}}</strong>
              <span>{{impact.description}}</span>
              <el-button size="small" link @click="go(impact.systemId)">查看</el-button>
            </div>
          </div>
          <PortOperationsCaseBoard mode="compact"/>
        </section>
      </div>

      <section class="tg-biz-card tg-ops-trend" data-testid="water-automatic-trend">
        <div class="tg-biz-card-head">
          <h2>供需趋势 · {{store.autoHistory.length}} 帧</h2>
          <span class="tg-biz-chip">需求曲线 / 分配曲线</span>
        </div>
        <svg class="tg-ops-trend-svg" viewBox="0 0 1050 95"
          role="img" aria-label="自动模拟的供需对比趋势">
          <path d="M0 75 H1050 M0 40 H1050" stroke="#dceaf1" stroke-width="1"/>
          <path v-if="trend.demand" :d="trend.demand" fill="none"
            stroke="#be9769" stroke-width="3" stroke-linejoin="round"/>
          <path v-if="trend.delivered" :d="trend.delivered" fill="none"
            stroke="#4a9bbb" stroke-width="3" stroke-linejoin="round"/>
        </svg>
      </section>

      <section class="tg-biz-card tg-ops-model">
        <div class="tg-ops-model-head">
          <strong>计算依据</strong>
          <el-button size="small" plain data-testid="water-assumption-toggle"
            @click="expandedAssumptions=!expandedAssumptions">
            {{expandedAssumptions?'收起':'查看计算公式与假设'}}
          </el-button>
        </div>
        <div v-if="expandedAssumptions" class="tg-ops-model-details"
          data-testid="water-assumption-details">
          <p><b>对比边界：</b>基准和优化都按已分配水量
            {{fmt(output.deliveredM3h)}} m³/h 计算，不把顺延或供水缺口计作节水。
            需求缺口 {{fmt(output.shortageM3h)}} m³/h 独立展示。</p>
          <p><b>用水匹配：</b>匹配率＝可分配水量 ÷ 总需求；受假设泵供水能力、预留和优先级制约。</p>
          <p><b>单位电耗：</b>（各水源取水/处理能耗＋末端供水泵能耗）÷ 分配供水量。
            基准泵 {{DEFAULT_WATER_POLICY.deliveryBaselineKwhM3}}、优化泵
            {{DEFAULT_WATER_POLICY.deliveryOptimizedKwhM3}} kWh/m³ 均为模型假设，不代表真实泵效率曲线。</p>
          <p><b>小时综合成本：</b>Σ(水源供水量×单位费用)＋总电耗×假设电价
            {{DEFAULT_WATER_POLICY.electricityYuanKwh}} 元/kWh；
            比选只在两方案服务量相等时输出差值。</p>
          <table class="tg-ops-economics-table">
            <thead><tr><th>水源</th><th>源水/处理费</th><th>水源侧电耗</th><th>使用前提</th></tr></thead>
            <tbody><tr v-for="src in shownAssumptions" :key="src.id">
              <td>{{src.title}}</td><td>{{src.feeYuanM3}} 元/m³</td>
              <td>{{src.sourceKwhM3}} kWh/m³</td><td>{{src.condition}}</td>
            </tr></tbody>
          </table>
          <p v-for="message in econ.blockers" :key="message">· {{message}}</p>
          <p><b>模型版本：</b>{{econ.modelVersion}} · 数据模式 SIM ·
            现场确认 false · 工程节能验收 false</p>
        </div>
      </section>
    </template>
    <div v-else class="tg-biz-card tg-ops-model">
      <strong>未获得运行计算结果</strong>
      <p>系统需要可用数据源；不以静态假数字冒充正常运行。</p>
      <el-button size="small" plain @click="store.startAuto()">启用自动Mock运行</el-button>
    </div>
  </section>
</template>

<style scoped>
.tg-ops-section{min-width:0;display:flex;flex-direction:column;gap:13px}
.tg-ops-header{display:flex;align-items:center;justify-content:space-between;
  gap:15px;flex-wrap:wrap;padding:16px 20px}
.tg-ops-overline{font-size:11px;color:#7093a6;letter-spacing:.06em}
.tg-ops-header h2{font-size:18px;color:#335e74;margin:6px 0;line-height:1.35}
.tg-ops-header p{font-size:12px;max-width:870px;color:#8195a3;line-height:1.7;margin:0}
.tg-ops-operating{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.tg-ops-operating small{font-size:10px;color:#91a2ad}
.tg-ops-status{display:flex;align-items:center;gap:6px;font-size:12px;color:#3b849f}
.tg-ops-status i{display:block;width:8px;height:8px;border-radius:50%;background:#51a78e}
.tg-ops-status i.manual{background:#bf985e}
.tg-ops-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.tg-ops-kpi{padding:15px 17px;min-width:0;display:flex;flex-direction:column;gap:5px}
.tg-ops-kpi>span{font-size:11px;color:#728d9d}
.tg-ops-kpi>strong{font-size:27px;line-height:1.3;color:#347a99;font-weight:680;
  font-variant-numeric:tabular-nums}
.tg-ops-kpi strong small{font-size:13px;font-weight:500;margin-left:3px}
.tg-ops-kpi>strong.tg-ops-negative{color:#b3834f}
.tg-ops-kpi p{font-size:10px;color:#879fac;line-height:1.6;margin:0}
.tg-ops-map-card,.tg-ops-analysis,.tg-ops-trend,.tg-ops-model{padding:17px 20px;min-width:0}
.tg-ops-map-card .tg-biz-card-head{display:flex;justify-content:space-between;
  align-items:flex-start;gap:8px;flex-wrap:wrap}
.tg-ops-map-card .tg-biz-card-head p,.tg-ops-analysis .tg-biz-card-head p,
.tg-ops-trend .tg-biz-card-head p{font-size:11px;margin:4px 0;color:#8da4b1}
.tg-ops-map-scroll{overflow-x:auto;margin-top:12px;border:1px solid #dcebf2;
  border-radius:10px}
.tg-ops-map-svg{width:100%;min-width:1000px;display:block}
.tg-ops-diagram-node,.tg-ops-map-svg g[role="button"]{cursor:pointer}
.tg-ops-diagram-node:hover>rect:first-child,
.tg-ops-diagram-node:focus-visible>rect:first-child{stroke:#3e98bb;stroke-width:3}
.tg-ops-relation-detail{display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:12px;padding:12px 2px 0}
.tg-ops-relation-detail strong{color:#396c82;font-size:12px}
.tg-ops-relation-detail p{color:#6e8998;font-size:11px;margin:4px 0;line-height:1.6}
.tg-ops-relation-detail small{color:#94a6b0;font-size:10px}
.tg-ops-relation-actions{display:flex;gap:6px}
.tg-ops-grid{display:grid;grid-template-columns:1.06fr 1fr;gap:13px}
.tg-ops-economics-table{border-collapse:collapse;width:100%;font-size:11px;
  margin:14px 0;table-layout:auto}
.tg-ops-economics-table th{text-align:left;color:#7a94a3;font-weight:600;
  background:#f2f8fb}
.tg-ops-economics-table td,.tg-ops-economics-table th{padding:10px 7px;
  border-bottom:1px solid #e3eef3}
.tg-ops-economics-table td{color:#52758a;line-height:1.5}
.tg-ops-economics-table td strong{color:#317e9e}
.tg-ops-cost-comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.tg-ops-cost-comparison>div{border:1px solid #dcebf1;border-radius:7px;
  padding:12px;background:#f7fafc}
.tg-ops-cost-comparison span{display:block;font-size:10px;color:#839caa}
.tg-ops-cost-comparison strong{display:block;font-size:22px;font-weight:700;color:#3c829f;
  margin-top:5px}
.tg-ops-cost-comparison strong small{font-size:11px;font-weight:500}
.tg-ops-cost-comparison p{color:#879ead;font-size:10px;margin:4px 0}
.tg-ops-analysis-note{color:#8c9fa9;font-size:10px;line-height:1.7;margin:12px 0 0}
.tg-ops-process-impact{display:flex;flex-direction:column;margin-top:12px}
.tg-ops-process-impact>div{display:flex;align-items:center;gap:7px;
  border-bottom:1px solid #e7eef2;min-height:38px;font-size:11px;color:#6c8799}
.tg-ops-process-impact strong{width:110px;flex-shrink:0;color:#456f85}
.tg-ops-process-impact span:not(.tg-ops-impact-mark){flex:1;line-height:1.5}
.tg-ops-impact-mark{display:block;width:6px;height:6px;border-radius:100%;
  background:#77a9ba}
.tg-ops-impact-mark.attention{background:#d4a776}
.tg-ops-impact-mark.critical{background:#cc8266}
.tg-ops-impact-mark.independent{background:#9baeb6}
.tg-ops-events{background:#f7fafc;border:1px solid #e1edf2;
  padding:11px 13px;margin-top:11px;border-radius:8px}
.tg-ops-events>strong{font-size:11px;color:#52788a}
.tg-ops-events>div{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:9px}
.tg-ops-events span{font-size:11px;color:#618497}
.tg-ops-events span.level-attention{color:#af853e}
.tg-ops-events span.level-critical{color:#b97053}
.tg-ops-events small{font-size:10px;color:#8ea2ad;flex:1}
.tg-ops-no-event{font-size:11px;color:#859ba8;padding:15px 0}
.tg-ops-trend-svg{display:block;width:100%;height:100px;margin-top:12px}
.tg-ops-model-head{display:flex;align-items:center;justify-content:space-between;
  gap:8px;flex-wrap:wrap}
.tg-ops-model-head strong{font-size:13px;color:#486f83}
.tg-ops-model-head p{font-size:11px;color:#8ba0aa;margin:5px 0}
.tg-ops-model-details{background:#f5fafc;border:1px solid #dcebf1;
  padding:14px;margin-top:10px;border-radius:8px}
.tg-ops-model-details p{font-size:11px;line-height:1.7;color:#6f8896;margin:7px 0}
.tg-ops-boundary{font-size:10px;color:#829aa9;line-height:1.7;
  padding-top:10px;border-top:1px solid #e6eef2;margin-top:12px}
@media(max-width:1200px){.tg-ops-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tg-ops-grid{grid-template-columns:1fr}}
@media(max-width:650px){.tg-ops-kpis{grid-template-columns:1fr}
  .tg-ops-cost-comparison{grid-template-columns:1fr}
  .tg-ops-header,.tg-ops-map-card,.tg-ops-analysis,.tg-ops-trend,.tg-ops-model{
    padding:13px}
  .tg-ops-operating{align-items:flex-start;text-align:left}
}
</style>

import {A2UI_CATALOG_ID,type A2uiMessage,type SurfaceComposeResult} from "./a2ui";
import type {LedgerEntry} from "./types";
import {waterAccountingSnapshot} from "./waterAccounting";

/**
 * 将明确周期的账本数据转换为受控 A2UI 图表和口径表；
 * 不把月账本绘制为日/近30天的连续曲线，也不重复累加跨环节水量。
 */
export function composeWaterLedgerSurface(
 entries:LedgerEntry[],chartType:"line"|"bar"="bar",prompt=""
):SurfaceComposeResult{
 const periods=[...new Set(entries.map(e=>e.period))].sort().slice(-12);
 if(!periods.length)return {messages:[],rejected:true,errors:[{code:"MISSING_DATA",message:"没有可用于绘图的水量账本",path:"seed.ledger"}]};
 const snapshot=periods.map(period=>waterAccountingSnapshot(entries.filter(e=>e.period===period)));
 const values=(key:"tapM3"|"reclaimedM3"|"rainCollectedM3")=>snapshot.map(s=>s[key]);
 const latest=snapshot.at(-1)!;
 const compareMining=/(含矿污水|污水处理量|处理量对比)/.test(prompt);
 const miningOut=periods.map(period=>{
  const values=entries.filter(e=>e.period===period&&e.sourceType==="含矿污水"&&e.direction==="out");
  return values.length?values.reduce((sum,e)=>sum+e.volume,0):null;
 });
 const monthly=/(近\s*30\s*天|最近\s*30\s*天|今天|日趋势|逐日|每日)/.test(prompt);
 const chart={
  id:"water-ledger-chart",component:"TrendChart",
  props:{
   title:"水量来源与外供（各自独立口径·按月账本）",
   labels:periods,chartType,height:305,
   series:[
    {name:"自来水源端补水（进项）",values:values("tapM3"),unit:"m³"},
    {name:"中水处理后外供（出项）",values:values("reclaimedM3"),unit:"m³"},
    {name:"雨水收集入池（进项）",values:values("rainCollectedM3"),unit:"m³"},
    ...(compareMining?[{name:"含矿污水处理过程出站（非最终回用）",values:miningOut,unit:"m³"}]:[]),
   ],
   layout:{x:0,y:0,w:12,h:5},
  },
 };
 const metric={
  id:"water-reuse-metric",component:"MetricCard",
  props:{
   label:"最新账本周期中水外供",
   value:latest.reclaimedM3===null?"缺数":latest.reclaimedM3,
   unit:"m³",hint:periods.at(-1)+" · MOCK · 出项 / 不等于终端实耗",
   layout:{x:0,y:6,w:5,h:3},
  },
 };
 const missing={
  id:"water-circulation-missing",component:"EmptyState",
  props:{
   title:"循环水回路计量缺失",
   description:"洗车等独立循环回路尚无实际流经量计量；不得用雨水入池或中水外供推算循环量。含矿污水处理出站量也是处理过程量，不等于末端合规回用。",
   reason:"缺独立回路计量与真实终端资料（MOCK）",
   layout:{x:5,y:6,w:7,h:3},
  },
 };
 const table={
  id:"water-period-table",component:"DataTable",
  props:{
   title:"按月独立统计 · 不合计为总取水",
   columns:[{key:"period",title:"账本周期"},{key:"tap",title:"自来水补水（m³）"},
    {key:"reclaimed",title:"中水外供（m³）"},{key:"rain",title:"雨水入池（m³）"},
    {key:"circulation",title:"循环水流经量"},
    ...(compareMining?[{key:"mining",title:"含矿污水处理出站"}]:[])],
   rows:periods.map((period,i)=>({
    period,tap:snapshot[i].tapM3,reclaimed:snapshot[i].reclaimedM3,
    rain:snapshot[i].rainCollectedM3,circulation:"缺数（未接入）",
    ...(compareMining?{mining:miningOut[i]}:{}),
   })),
   layout:{x:0,y:9,w:12,h:4},
  },
 };
 const notice=monthly?{
  id:"water-time-grain-warning",component:"EmptyState",
  props:{
   title:"日粒度数据不可用",
   description:"本查询要求今天/近30天的逐日趋势，但现有数据仅为周期账本。下方展示月度来源对比，不是逐日或连续30天的实际用量。",
   reason:"缺少日计量时间戳",layout:{x:0,y:13,w:12,h:2},
  },
 }:null;
 const id="surface-water-ledger";
 const messages:A2uiMessage[]=[
  {type:"createSurface",surface:{surfaceId:id,root:"water-ledger-chart",catalogId:A2UI_CATALOG_ID,
   dataModel:{mode:"water-ledger",periods,requestedPrompt:prompt,source:"MOCK",dailyUnsupported:monthly}}},
  {type:"updateComponents",surfaceId:id,components:[chart,metric,missing,table,...(notice?[notice]:[])]},
 ];
 return {messages,rejected:false,errors:[]};
}

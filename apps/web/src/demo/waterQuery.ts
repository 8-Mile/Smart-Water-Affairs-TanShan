import type {LedgerEntry} from "./types";
import {waterAccountingSnapshot} from "./waterAccounting";
export interface WaterUsageAnswer {
 title:string;
 lines:string[];
 route:string;
}
/** 对水资源问数只使用有明确统计周期的账本；不可用月账本伪造“今日用量”。 */
export function answerWaterUsageQuery(prompt:string,entries:LedgerEntry[]):WaterUsageAnswer|null{
 if(!/(中水|自来水|循环水|雨水|水资源|回用水)/.test(prompt))return null;
 const periods=[...new Set(entries.map(e=>e.period))].sort();
 const latest=periods.at(-1);
 if(!latest)return {title:"水资源账本缺少计量记录",lines:["没有可用的水量账本，无法得出水量结论。"],route:"/water/ledger"};
 if(/(今天|今日|当天|昨天|昨日|本周|这周|最近[一二三四五六七0-9]+天|近7天|近一周)/.test(prompt))return {
  title:"所问时段暂时缺少有效水量数据",
  lines:["当前可用的水量账本按周期记录，不能据此推算今日或近7日的实际使用量。",
   "可查看最新已登记周期："+latest+"；如需日/班次统计，需接入对应计量数据和时间戳。"],
  route:"/water/ledger",
 };
 const snapshot=waterAccountingSnapshot(entries.filter(e=>e.period===latest));
 const m=(n:number|null)=>n===null?"缺数":n.toLocaleString("zh-CN")+" m³";
 const lines:string[]=[];
 if(/自来水|水资源/.test(prompt))lines.push("自来水源端补水（"+latest+"）："+m(snapshot.tapM3));
 if(/中水|回用水|水资源/.test(prompt))lines.push("中水外供（"+latest+"）："+m(snapshot.reclaimedM3)+"；不等同于终端已消耗水量");
 if(/雨水|水资源/.test(prompt))lines.push("收集雨水入池（"+latest+"）："+m(snapshot.rainCollectedM3)+"；不等同于已回用量");
 if(/循环水|水资源/.test(prompt))lines.push("循环水回路循环流经量："+m(snapshot.circulatingM3)+"；缺少独立循环回路计量，不能由雨水入池反推");
 if(!lines.length)return null;
 lines.push("数据来源：本地演示账本，统计周期为"+latest+"；各环节水量不直接相加。");
 return {title:"水资源用量查询（演示账本）",lines,route:"/water/ledger"};
}

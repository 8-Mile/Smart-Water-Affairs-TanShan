import type {LedgerEntry} from "./types";

/** 水从哪里来、流经哪一步必须分开。循环流量只能取回路计量，不能由雨水入池推导。 */
export type WaterAccountingCategory="自来水"|"中水/再生水"|"循环利用·雨水子项"|"污水处理过程"|"生活污水外送"|"未分类";
export interface WaterAccountingRow {
  category:WaterAccountingCategory;
  stage:string;
  canCountAsExternalTake:boolean;
  canCountAsReuse:boolean;
}
export function classifyWaterAccounting(entry:LedgerEntry):WaterAccountingRow{
  if(entry.sourceType==="自来水")return {category:"自来水",stage:"源端补水",canCountAsExternalTake:entry.direction==="in",canCountAsReuse:false};
  if(entry.sourceType==="中水")return {category:"中水/再生水",stage:"处理后外供（用水端待核）",canCountAsExternalTake:false,canCountAsReuse:entry.direction==="out"};
  if(entry.sourceType==="雨水")return {category:"循环利用·雨水子项",stage:"雨水收集入池（并非循环流量）",canCountAsExternalTake:false,canCountAsReuse:false};
  if(entry.sourceType==="含矿污水")return {category:"污水处理过程",stage:"污水站处理出站（并非最终回用）",canCountAsExternalTake:false,canCountAsReuse:false};
  if(entry.sourceType==="生活污水")return {category:"生活污水外送",stage:"外部处理单位接管",canCountAsExternalTake:false,canCountAsReuse:false};
  return {category:"未分类",stage:"待确认计量点和工艺环节",canCountAsExternalTake:false,canCountAsReuse:false};
}
function sumOrNull(entries:LedgerEntry[],predicate:(entry:LedgerEntry)=>boolean):number|null{
 const filtered=entries.filter(predicate);
 return filtered.length?filtered.reduce((a,b)=>a+b.volume,0):null;
}
export function waterAccountingSnapshot(entries:LedgerEntry[]){
 return {
  tapM3:sumOrNull(entries,e=>e.direction==="in"&&e.sourceType==="自来水"),
  reclaimedM3:sumOrNull(entries,e=>e.direction==="out"&&e.sourceType==="中水"),
  rainCollectedM3:sumOrNull(entries,e=>e.direction==="in"&&e.sourceType==="雨水"),
  circulatingM3:null as number|null, // 当前种子未提供洗车循环和其它循环回路实测
  externalTakeM3:sumOrNull(entries,e=>classifyWaterAccounting(e).canCountAsExternalTake),
  reuseM3:sumOrNull(entries,e=>classifyWaterAccounting(e).canCountAsReuse),
  limits:"循环水的循环量、补水量和实际外供必须分别计量；雨水入池、污水处理出站不可重复累计为回用量。",
 };
}

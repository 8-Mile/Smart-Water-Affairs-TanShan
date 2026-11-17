/**
 * 绿色运营效益核算 V1：复用多水源路径/库存/用途优先级及最小费用分配。
 * 全部价格、流量、耗电与费用为MOCK/人工输入；不读取实际电表或成本合同。
 * 所有新增费用只能按“原来源单方费用未包括”的演示假设加一次，避免重复计价。
 * 仅基于同需求量、同时间段且供水均可行的全自来水基准计算情景费用差。
 */
import { assertCan } from "./permissions";
import {
  cloneMultiSource, DEFAULT_MULTI_SOURCE, evaluateMultiSource,
  type MultiSourceInputs, type WaterSourceId, type WaterSupplyResult,
} from "./multisource";
import type { Role } from "./types";

export const GREEN_DRAFT_KEY = "tanggang-green-benefit-drafts-v1";
export const GREEN_SOURCE_IDS:WaterSourceId[]=["rain","reclaimed","tap"];
export const GREEN_SOURCE_LABELS:Record<WaterSourceId,string>={
  rain:"雨水",reclaimed:"中水",tap:"自来水",
};
const round=(v:number):number=>Math.round((v+Number.EPSILON)*1e4)/1e4;
export interface GreenSourceExtra {
  id:WaterSourceId;
  /** 原来源单方费用之外的处理或药剂增量费用 */
  treatmentYuanM3:number;
  /** 原来源单方费用之外的输配增量费用 */
  transferYuanM3:number;
  /** 原来源单方费用之外的污泥/残渣/处置增量费用 */
  residualYuanM3:number;
  /** 未包含在来源单价中的额外电耗，不是现场电表读数 */
  additionalKwhM3:number;
}
export interface GreenBenefitInputs {
  water:MultiSourceInputs;
  extras:GreenSourceExtra[];
  electricityYuanKwh:number;
  /** 只在实际采用雨水/中水时计入的相对全自来水增量固定O&M */
  fixedReuseYuanPeriod:number;
  /** 必须明确确认新增科目不在原各来源综合单价内，才能输出净差额 */
  costBoundaryConfirmed:boolean;
  sourceDraftId?:string;
}
export interface GreenSourceCost {
  id:WaterSourceId;label:string;
  volumeM3:number;
  baseYuan:number;
  treatmentYuan:number;
  transferYuan:number;
  residualYuan:number;
  additionalKwh:number;
  energyYuan:number;
  totalYuan:number;
  baseUnitYuanM3:number;
  effectiveUnitYuanM3:number;
}
export interface GreenBenefitResult {
  inputs:GreenBenefitInputs;
  water:WaterSupplyResult;
  comparable:boolean;
  costBoundaryConfirmed:boolean;
  baselineYuan:number|null;
  baseScenarioYuan:number;
  grossDeltaYuan:number|null;
  treatmentYuan:number;
  transferYuan:number;
  residualYuan:number;
  addedElectricityKwh:number;
  electricityYuan:number;
  fixedYuan:number;
  totalAdditionalYuan:number|null;
  currentYuan:number|null;
  netDeltaYuan:number|null;
  savingRatioPercent:number|null;
  tapAvoidedM3:number|null;
  bySource:GreenSourceCost[];
  blockers:string[];
  warnings:string[];
}
const DEFAULT_EXTRAS:GreenSourceExtra[]=[
  {id:"rain",treatmentYuanM3:0.10,transferYuanM3:0.05,residualYuanM3:0,additionalKwhM3:0.10},
  {id:"reclaimed",treatmentYuanM3:0.22,transferYuanM3:0.12,residualYuanM3:0.09,additionalKwhM3:0.25},
  {id:"tap",treatmentYuanM3:0,transferYuanM3:0,residualYuanM3:0,additionalKwhM3:0},
];
export const DEFAULT_GREEN_BENEFIT:GreenBenefitInputs={
  water:cloneMultiSource(DEFAULT_MULTI_SOURCE),
  extras:DEFAULT_EXTRAS.map(x=>({...x})),
  electricityYuanKwh:0.85,
  fixedReuseYuanPeriod:240,
  costBoundaryConfirmed:true,
};
export function cloneGreenBenefit(input:GreenBenefitInputs=DEFAULT_GREEN_BENEFIT):GreenBenefitInputs{
  return {
    water:cloneMultiSource(input.water),
    extras:input.extras.map(x=>({...x})),
    electricityYuanKwh:input.electricityYuanKwh,
    fixedReuseYuanPeriod:input.fixedReuseYuanPeriod,
    costBoundaryConfirmed:input.costBoundaryConfirmed,
    ...(input.sourceDraftId?{sourceDraftId:input.sourceDraftId}:{}),
  };
}
function bounded(label:string,value:number,max:number):void{
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>max)
    throw new Error(label+"必须为0至"+max+"之间的有效数值");
}
function validExtras(input:GreenBenefitInputs):void{
  if(typeof input.costBoundaryConfirmed!=="boolean")throw new Error("成本边界状态非法");
  bounded("电价",input.electricityYuanKwh,100);
  bounded("回用固定增量费用",input.fixedReuseYuanPeriod,10000000);
  if(input.extras.length!==3)throw new Error("三水源追加费用配置不完整");
  for(const id of GREEN_SOURCE_IDS){
    const matches=input.extras.filter(x=>x.id===id);
    if(matches.length!==1)throw new Error("重复或缺失的水源增量费用配置："+id);
    const x=matches[0];
    bounded(GREEN_SOURCE_LABELS[id]+"额外处理/药剂",x.treatmentYuanM3,1000);
    bounded(GREEN_SOURCE_LABELS[id]+"额外输配",x.transferYuanM3,1000);
    bounded(GREEN_SOURCE_LABELS[id]+"额外处置",x.residualYuanM3,1000);
    bounded(GREEN_SOURCE_LABELS[id]+"额外单位电耗",x.additionalKwhM3,100);
  }
}
function extraUnit(x:GreenSourceExtra,tariff:number):number{
  return x.treatmentYuanM3+x.transferYuanM3+x.residualYuanM3+x.additionalKwhM3*tariff;
}
export function evaluateGreenBenefit(input:GreenBenefitInputs):GreenBenefitResult{
  validExtras(input);
  const original=cloneGreenBenefit(input);
  // 如果尚未核对源单价的费用覆盖范围，不擅自追加、也不报“净收益”。
  const adjusted=cloneMultiSource(original.water);
  const extras=new Map(original.extras.map(x=>[x.id,x]));
  if(original.costBoundaryConfirmed){
    for(const source of adjusted.sources)
      source.unitCostYuanM3=round(source.unitCostYuanM3+extraUnit(extras.get(source.id)!,original.electricityYuanKwh));
  }
  // 成本变化可能改变多水源最小费用解；必须重跑原约束求解，而不是事后只乘单价。
  const water=evaluateMultiSource(adjusted);
  const sourceById=new Map(original.water.sources.map(x=>[x.id,x]));
  const bySource:GreenSourceCost[]=GREEN_SOURCE_IDS.map(id=>{
    const x=extras.get(id)!;
    const volume=water.sources.find(row=>row.id===id)?.usedM3??0;
    const baseUnit=sourceById.get(id)!.unitCostYuanM3;
    const apply=original.costBoundaryConfirmed;
    const baseYuan=round(volume*baseUnit);
    const treatmentYuan=apply?round(volume*x.treatmentYuanM3):0;
    const transferYuan=apply?round(volume*x.transferYuanM3):0;
    const residualYuan=apply?round(volume*x.residualYuanM3):0;
    const additionalKwh=apply?round(volume*x.additionalKwhM3):0;
    const energyYuan=round(additionalKwh*original.electricityYuanKwh);
    return {
      id,label:GREEN_SOURCE_LABELS[id],volumeM3:volume,baseYuan,treatmentYuan,transferYuan,
      residualYuan,additionalKwh,energyYuan,
      totalYuan:round(baseYuan+treatmentYuan+transferYuan+residualYuan+energyYuan),
      baseUnitYuanM3:baseUnit,
      effectiveUnitYuanM3:round(baseUnit+(apply?extraUnit(x,original.electricityYuanKwh):0)),
    };
  });
  const sum=(field:keyof GreenSourceCost)=>round(bySource.reduce((v,row)=>v+Number(row[field]),0));
  const baseScenarioYuan=sum("baseYuan");
  const treatmentYuan=sum("treatmentYuan"),transferYuan=sum("transferYuan");
  const residualYuan=sum("residualYuan"),addedElectricityKwh=sum("additionalKwh");
  const electricityYuan=sum("energyYuan");
  const fixedYuan=original.costBoundaryConfirmed&&water.nonTapSuppliedM3>1e-6
    ?original.fixedReuseYuanPeriod:0;
  const blockers:string[]=[];
  if(!water.feasible)blockers.push("当前水源方案无法满足全部需求，不允许计算完整节约或净效益");
  if(water.allTapBaselineYuan===null)blockers.push("相同需求下全自来水基准受到水量、水质或管网限制，不能比较");
  if(!original.costBoundaryConfirmed)blockers.push("成本边界未确认：来源综合单价与追加处理、输配、处置、电耗费用是否重叠尚未核对，不能输出净效益");
  const comparable=water.feasible&&water.allTapBaselineYuan!==null;
  const netEligible=comparable&&original.costBoundaryConfirmed;
  const baselineYuan=netEligible?water.allTapBaselineYuan:null;
  const variableYuan=round(bySource.reduce((v,row)=>v+row.totalYuan,0));
  const currentYuan=netEligible?round(variableYuan+fixedYuan):null;
  // base gross difference uses exact same allocation, original source inclusive unit prices.
  const tapBase=sourceById.get("tap")!.unitCostYuanM3;
  const grossDeltaYuan=comparable?round(water.requestedM3*tapBase-baseScenarioYuan):null;
  const netDeltaYuan=baselineYuan!==null&&currentYuan!==null
    ?round(baselineYuan-currentYuan):null;
  const savingRatioPercent=netDeltaYuan!==null&&baselineYuan!==null&&baselineYuan>0
    ?round(netDeltaYuan/baselineYuan*100):null;
  const warnings=[
    "全部水源库存、用途、水质、管线连通和单位价格为MOCK或人工假设，未接真实水表及企业成本账。",
    "来源单方成本沿用多水源模型的综合运行成本（可能已经含常规处理/能耗）；本页仅把明确假定未包含的增量费用追加一次，不能重复计价。",
    "额外电耗仅由人工输入的单位kWh/m³×本时段分配水量推算；不能把主泵铭牌kW、实时电流或健康评分当实测电表读数。",
    "水量账本与本次24小时模拟库存并非统一计量期间，不直接相加；少购自来水量不是港口总用水节约量。",
    "不核算资本性支出、折旧/融资、税费、溢流排放合规、处理副产物实际去向和碳减排；本页不能形成真实项目ROI或碳资产。",
  ];
  if(!original.costBoundaryConfirmed)warnings.push("成本边界未确认：仅展示原综合水价下的基础费用差，所有净效益指标隐藏。");
  if(netDeltaYuan!==null&&netDeltaYuan<0)warnings.push("此情景下完整假设费用高于全自来水基准，应显示增支，而不能声称节约。");
  return {
    inputs:original,water,comparable,costBoundaryConfirmed:original.costBoundaryConfirmed,
    baselineYuan,baseScenarioYuan,grossDeltaYuan,treatmentYuan,transferYuan,
    residualYuan,addedElectricityKwh,electricityYuan,fixedYuan,
    totalAdditionalYuan:netEligible?round(treatmentYuan+transferYuan+residualYuan+electricityYuan+fixedYuan):null,
    currentYuan,netDeltaYuan,savingRatioPercent,
    tapAvoidedM3:comparable?water.tapAvoidedM3:null,
    bySource,blockers,warnings,
  };
}
export interface GreenBenefitDraft{
  id:string;createdAt:string;createdBy:Role;status:"draft";source:"MOCK";
  name:string;scenarioId:string;inputs:GreenBenefitInputs;
  result:{requestedM3:number;nonTapM3:number;netDeltaYuan:number;baselineYuan:number;
    currentYuan:number;addedKwh:number;sourceDraftId?:string};
}
export interface GreenStorage{getItem(key:string):string|null;setItem(key:string,v:string):void}
export function readGreenDrafts(storage:GreenStorage,scenarioId?:string):GreenBenefitDraft[]{
  try{
    const value:unknown=JSON.parse(storage.getItem(GREEN_DRAFT_KEY)??"[]");
    if(!Array.isArray(value))return [];
    const clean=(value as GreenBenefitDraft[]).filter(x=>x&&typeof x.id==="string"&&x.source==="MOCK"&&x.status==="draft");
    return scenarioId?clean.filter(x=>x.scenarioId===scenarioId):clean;
  }catch{return [];}
}
export function saveGreenBenefitDraft(input:GreenBenefitInputs,result:GreenBenefitResult,
  scenarioId:string,role:Role,storage:GreenStorage):GreenBenefitDraft{
  assertCan(role,"water:proposal");
  // 后端未实现，本地仍须重新复算防止将过期、篡改或不完整结果保存为“净收益”。
  const fresh=evaluateGreenBenefit(input);
  if(!fresh.comparable||fresh.netDeltaYuan===null||fresh.baselineYuan===null||fresh.currentYuan===null)
    throw new Error("需求/基准/成本边界未完成可比核验，不能保存完整效益核算草稿");
  if(result.netDeltaYuan!==fresh.netDeltaYuan||result.currentYuan!==fresh.currentYuan
    ||result.water.suppliedM3!==fresh.water.suppliedM3)
    throw new Error("测算结果已发生变化，请重新计算再保存");
  const draft:GreenBenefitDraft={
    id:"GNB-"+Date.now().toString(36).toUpperCase()+"-"+Math.random().toString(36).slice(2,7).toUpperCase(),
    createdAt:new Date().toISOString(),createdBy:role,scenarioId,status:"draft",source:"MOCK",
    name:"绿色运营情景净效益待核算草稿",
    inputs:cloneGreenBenefit(input),
    result:{
      requestedM3:fresh.water.requestedM3,nonTapM3:fresh.water.nonTapSuppliedM3,
      netDeltaYuan:fresh.netDeltaYuan,baselineYuan:fresh.baselineYuan,
      currentYuan:fresh.currentYuan,addedKwh:fresh.addedElectricityKwh,
      ...(input.sourceDraftId?{sourceDraftId:input.sourceDraftId}:{}),
    },
  };
  storage.setItem(GREEN_DRAFT_KEY,JSON.stringify([draft,...readGreenDrafts(storage)].slice(0,30)));
  return draft;
}

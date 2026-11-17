/**
 * 固定转速中压泵组：单一假设工况点 + 日任务量的组合比选。
 * 不使用铭牌额定功率冒充实时功率；不伪造Q-H曲线、变频调速或实际节能率。
 * 泵状态与铭牌源自现有DEMO设备；输入电功率与共母管条件由人工假设。
 */
import type { Asset, AssetStatus, Role } from "./types";
import { assertCan } from "./permissions";

export const ENERGY_DRAFT_KEY = "tanggang-pump-energy-drafts-v1";
export type PointProvenance = "MOCK_ASSUMPTION" | "USER_ENTRY";
export interface PumpEnergyPoint {
  assetId: string;
  code: string;
  name: string;
  status: AssetStatus;
  ratedMotorKw: number;
  ratedFlowM3h: number;
  ratedHeadM: number;
  flowM3h: number;             // 单个运行点的假设出流（非任意流量调速）
  totalHeadM: number;          // 单个运行点的假设总扬程（不能用出口表压直接代替）
  electricalInputKw: number;   // 假设实功率，不是电机铭牌功率，也不是电流推算
  readyForDispatch: boolean;  // 停用备用泵需要现场确认，界面仅是演示勾选
  provenance: PointProvenance;
}
export interface PumpEnergyInputs {
  dailyVolumeM3: number;
  peakFlowM3h: number;
  requiredHeadM: number;
  maxRunHours: number;
  electricityYuanKwh: number;
  minReadyStandby: number;
  pumps: PumpEnergyPoint[];
}
export interface PumpPointPerformance {
  assetId: string;
  code: string;
  flowM3h: number;
  headM: number;
  electricKw: number;
  hydraulicKw: number;
  wireToWaterEfficiencyPct: number;
  specificEnergyKwhM3: number;
}
export interface PumpCombination {
  key: string;
  codes: string[];
  count: number;
  totalFlowM3h: number;
  totalInputKw: number;
  runHours: number;
  energyKwh: number;
  unitEnergyKwhM3: number;
  electricCostYuan: number;
  estimatedDeliveredM3: number;
  feasible: boolean;
  reasons: string[];
  isBaseline: boolean;
}
export interface PumpEnergyResult {
  inputs: PumpEnergyInputs;
  points: PumpPointPerformance[];
  combinations: PumpCombination[];
  baseline: PumpCombination | null;
  recommended: PumpCombination | null;
  savingKwh: number | null;
  savingYuan: number | null;
  savingPercent: number | null;
  checks: string[];
  warnings: string[];
}
export interface PumpEnergyDraft {
  id: string;
  scenarioId: string;
  createdAt: string;
  createdBy: Role;
  source: "MOCK";
  state: "draft";
  title: string;
  inputs: PumpEnergyInputs;
  recommendedKey: string;
  baselineKey: string | null;
  conditionalSavingKwh: number | null;
  conditionalSavingYuan: number | null;
}
export interface EnergyDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const ROUND = (n: number) => Math.round((n + Number.EPSILON) * 1e5) / 1e5;
const TARGET_CODES = ["P-001","P-002","P-004"] as const;
const ASSUMED_POINTS: Record<string,{electricKw:number}> = {
  "P-001":{electricKw:75},
  "P-002":{electricKw:75},
  "P-004":{electricKw:71.5},
};
function bounded(label: string, n:number, min:number,max:number):void {
  if(!Number.isFinite(n)||n<min||n>max) throw new Error(`${label}必须位于${min}至${max}之间`);
}
export function defaultPumpEnergyInputs(assets:Asset[]):PumpEnergyInputs {
  const pumps=TARGET_CODES.flatMap(code=>{
    const a=assets.find(x=>x.code===code&&x.subsystemId==="medium-pressure"&&!x.archived);
    if(!a||!a.rated?.powerKw||!a.rated?.flowM3h||!a.rated?.headM)return [];
    return [{
      assetId:a.id,code:a.code,name:a.name,status:a.status,
      ratedMotorKw:a.rated.powerKw,ratedFlowM3h:a.rated.flowM3h,ratedHeadM:a.rated.headM,
      flowM3h:a.rated.flowM3h,totalHeadM:a.rated.headM,
      electricalInputKw:ASSUMED_POINTS[code]?.electricKw??a.rated.powerKw,
      readyForDispatch:a.status==="running",
      provenance:"MOCK_ASSUMPTION" as const,
    }];
  });
  return {
    dailyVolumeM3:5500,peakFlowM3h:300,requiredHeadM:70,
    maxRunHours:18,electricityYuanKwh:0.85,minReadyStandby:0,pumps,
  };
}
export function cloneEnergyInputs(input:PumpEnergyInputs):PumpEnergyInputs {
  return {...input,pumps:input.pumps.map(p=>({...p}))};
}
function validate(input:PumpEnergyInputs):void {
  bounded("日供水任务量",input.dailyVolumeM3,1,500_000);
  bounded("峰时供水需求",input.peakFlowM3h,0.01,100_000);
  bounded("最小总扬程",input.requiredHeadM,0.01,1000);
  bounded("单台日运行上限",input.maxRunHours,0.1,24);
  bounded("综合电价",input.electricityYuanKwh,0,20);
  bounded("最少可用备用台数",input.minReadyStandby,0,5);
  if(!Number.isInteger(input.minReadyStandby))throw new Error("备用台数必须为整数");
  if(input.dailyVolumeM3>input.peakFlowM3h*24+1e-7)throw new Error("日任务平均流量不能高于所设峰时流量");
  if(input.pumps.length<1||input.pumps.length>8)throw new Error("缺少有效的中压供水泵组");
  if(new Set(input.pumps.map(p=>p.code)).size!==input.pumps.length
    ||new Set(input.pumps.map(p=>p.assetId)).size!==input.pumps.length)
    throw new Error("泵组编号或资产ID重复");
  for(const p of input.pumps){
    bounded(p.code+"铭牌功率",p.ratedMotorKw,.01,20000);
    bounded(p.code+"铭牌流量",p.ratedFlowM3h,.01,100000);
    bounded(p.code+"铭牌扬程",p.ratedHeadM,.01,1000);
    bounded(p.code+"工况流量",p.flowM3h,.01,100000);
    bounded(p.code+"工况总扬程",p.totalHeadM,.01,1000);
    bounded(p.code+"演示实功率",p.electricalInputKw,.01,20000);
    if(p.flowM3h>p.ratedFlowM3h*1.00001 ||p.totalHeadM>p.ratedHeadM*1.00001)
      throw new Error(`${p.code}工况点超出演示采用的铭牌Q/H点；缺少厂家曲线，不允许向外推算`);
    if(p.electricalInputKw>p.ratedMotorKw*1.00001)
      throw new Error(`${p.code}输入电功率高于演示铭牌功率，请先复核工况`);
    const hydraulic=9.81*p.flowM3h*p.totalHeadM/3600;
    if(hydraulic>p.electricalInputKw*(1+1e-9))
      throw new Error(`${p.code}水力功率超出输入电功率（效率>100%），假设无效`);
    if(!["running","stopped","fault","unknown"].includes(p.status))
      throw new Error(p.code+"设备状态无效");
    if(!["MOCK_ASSUMPTION","USER_ENTRY"].includes(p.provenance))throw new Error(p.code+"数据来源无效");
  }
}

export function evaluatePumpEnergy(input:PumpEnergyInputs):PumpEnergyResult {
  validate(input);
  const data=cloneEnergyInputs(input);
  const points:PumpPointPerformance[]=data.pumps.map(p=>{
    const hydraulic=9.81*p.flowM3h*p.totalHeadM/3600;
    return {
      assetId:p.assetId,code:p.code,flowM3h:p.flowM3h,headM:p.totalHeadM,
      electricKw:p.electricalInputKw,hydraulicKw:ROUND(hydraulic),
      wireToWaterEfficiencyPct:ROUND(hydraulic/p.electricalInputKw*100),
      specificEnergyKwhM3:ROUND(p.electricalInputKw/p.flowM3h),
    };
  });
  const running=data.pumps.filter(p=>p.status==="running").map(p=>p.code);
  const combos:PumpCombination[]=[];
  const n=data.pumps.length;
  for(let mask=1;mask<(1<<n);mask++){
    const selected=data.pumps.filter((_,i)=>Boolean(mask&(1<<i)));
    const codes=selected.map(p=>p.code);
    const totalFlow=selected.reduce((a,p)=>a+p.flowM3h,0);
    const totalKw=selected.reduce((a,p)=>a+p.electricalInputKw,0);
    const hours=data.dailyVolumeM3/totalFlow;
    const kwh=totalKw*hours;
    const reasons:string[]=[];
    for(const p of selected){
      if(p.status==="fault")reasons.push(`${p.code}当前故障，禁止参与组合`);
      if(p.status==="unknown")reasons.push(`${p.code}状态未知，禁止参与组合`);
      if(p.status==="stopped"&&!p.readyForDispatch)
        reasons.push(`${p.code}为停机/备用状态，未确认启泵条件`);
      if(p.totalHeadM<input.requiredHeadM)reasons.push(`${p.code}演示工况扬程低于系统需求`);
    }
    if(totalFlow+1e-7<data.peakFlowM3h)reasons.push("组合工况流量不足以满足峰时需求");
    if(hours>data.maxRunHours+1e-7)reasons.push("完成日供水量所需运行小时超限");
    const readyStandby=data.pumps.filter(p=>!codes.includes(p.code)
      &&(p.status==="running" || (p.status==="stopped"&&p.readyForDispatch))).length;
    if(readyStandby<data.minReadyStandby)reasons.push("达不到已确认可用的备用泵台数");
    const isBaseline=running.length===codes.length&&running.every(c=>codes.includes(c));
    combos.push({
      key:codes.join("+"),codes,count:codes.length,totalFlowM3h:ROUND(totalFlow),
      totalInputKw:ROUND(totalKw),runHours:ROUND(hours),
      energyKwh:ROUND(kwh),unitEnergyKwhM3:ROUND(totalKw/totalFlow),
      electricCostYuan:ROUND(kwh*data.electricityYuanKwh),
      estimatedDeliveredM3:ROUND(data.dailyVolumeM3),
      feasible:reasons.length===0,reasons,isBaseline,
    });
  }
  combos.sort((a,b)=>Number(b.feasible)-Number(a.feasible)
    ||a.energyKwh-b.energyKwh ||a.count-b.count ||a.key.localeCompare(b.key));
  const recommended=combos.find(c=>c.feasible)??null;
  const baseline=combos.find(c=>c.isBaseline)??null;
  const comparable=Boolean(recommended && baseline && baseline.feasible);
  const savingKwh=comparable?ROUND(baseline!.energyKwh-recommended!.energyKwh):null;
  const savingYuan=comparable?ROUND(baseline!.electricCostYuan-recommended!.electricCostYuan):null;
  const savingPercent=comparable&&baseline!.energyKwh>0?ROUND(savingKwh!/baseline!.energyKwh*100):null;
  const warnings=[
    "全部泵组铭牌及工况点来自MOCK，假设电功率并非电能表或有功功率测量值；预测费用与节约仅为模拟比较。",
    "没有厂家Q-H、效率曲线、实际运行功率、系统管网曲线及最低流量/NPSH校核，组合仅为条件模拟，不具备直接下发或启停依据。",
    "按同一供水任务量比较：假设组合泵在同一运行点并联、以连续共同运行小时完成目标；未模拟流量波动、管网压力动态、峰谷电价和启停损耗。",
    "当前系统没有已核实的共母管连通与备用泵投用许可。即使模型可行，也须现场确认水力联通、保护联锁、备用能力及运行制度。",
  ];
  if(!recommended)warnings.push("按目前约束，没有可完成供水任务的演示组合，必须核实额外供水能力或调整任务计划。");
  if(!baseline)warnings.push("没有可以识别的现行运行泵组，无法生成可比基线。");
  else if(!baseline.feasible)warnings.push("当前运行组合不符合本次设定约束，不能计算与现行方案的节约率。");
  return {
    inputs:data,points,combinations:combos,baseline,recommended,savingKwh,savingYuan,savingPercent,warnings,
    checks:[
      "单位水量电耗(kWh/m³) = 输入有功功率(kW) / 运行点流量(m³/h)；不以电机铭牌额定功率代替实际运行功率",
      "水力功率(kW) = 9.81 × 流量(m³/h) × 总扬程(m) / 3600，默认水密度1000kg/m³；综合效率为水力功率/输入电功率",
      "运行时长(h) = 日供水任务(m³) / 所选泵组总流量(m³/h)；能耗(kWh) = 各泵输入功率之和×运行时长",
      "剔除故障、未知状态、备用启泵条件未确认、扬程/峰值供水/运行小时不足的方案",
      "可用备用泵数从未选中的状态正常且已确认可用设备计算；对比基线为当前标记运行的组合",
    ],
  };
}
export function readEnergyDrafts(storage:EnergyDraftStorage,scenarioId?:string):PumpEnergyDraft[] {
  try {
    const raw:unknown=JSON.parse(storage.getItem(ENERGY_DRAFT_KEY)??"[]");
    if(!Array.isArray(raw))return [];
    const all=(raw as PumpEnergyDraft[]).filter(x=>x&&typeof x.id==="string"&&x.state==="draft");
    return scenarioId?all.filter(x=>x.scenarioId===scenarioId):all;
  }catch{return [];}
}
export function saveEnergyDraft(result:PumpEnergyResult,role:Role,scenarioId:string,storage:EnergyDraftStorage):PumpEnergyDraft {
  assertCan(role,"energy:proposal");
  if(!result.recommended || !result.recommended.feasible)throw new Error("没有可行的条件模拟组合，不能保存推荐草稿");
  const record:PumpEnergyDraft={
    id:"ENG-"+Date.now().toString(36).toUpperCase()+"-"+Math.random().toString(36).slice(2,7).toUpperCase(),
    scenarioId,createdAt:new Date().toISOString(),createdBy:role,source:"MOCK",state:"draft",
    title:"中压供水泵组工况与能耗比选（待现场核验）",
    inputs:cloneEnergyInputs(result.inputs),recommendedKey:result.recommended.key,
    baselineKey:result.baseline?.key??null,
    conditionalSavingKwh:result.savingKwh,conditionalSavingYuan:result.savingYuan,
  };
  const all=readEnergyDrafts(storage);
  storage.setItem(ENERGY_DRAFT_KEY,JSON.stringify([record,...all].slice(0,30)));
  return record;
}

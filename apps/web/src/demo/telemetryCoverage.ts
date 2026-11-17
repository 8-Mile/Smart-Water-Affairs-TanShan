/**
 * V3.1 数据可用性：演示样本质量 ≠ 现场在线监测覆盖率。
 * 当前DataSource没有经授权、FAT/SAT验收的LIVE数据来源类型；
 * 只有MOCK/REFERENCE/USER_ENTRY/CALCULATED，绝不能将quality.valid误报成真实在线。
 */
import type { Asset,MeasurePoint,TelemetrySample } from "./types";

export const SUBSYSTEM_METER_GATES=[
 {id:"rainwater",name:"雨水收集",checks:["CK-004","CK-007","CK-023"],points:["PT-002","PT-005","PT-008"],
  critical:"逐池液位、V-H曲线、入出池流量、阀位和PLC点表"},
 {id:"mining",name:"含矿污水处理",checks:["CK-011","CK-013","CK-014"],points:["PT-009","PT-011","PT-012","PT-013"],
  critical:"进出水计量、质量判定、清水池有效水位"},
 {id:"pool",name:"水池供水",checks:["CK-016","CK-023"],points:["PT-031","PT-032","PT-034"],
  critical:"水源分表、合法回用终端、可靠的末端需水"},
 {id:"medium-pressure",name:"中压供水",checks:["CK-019","CK-020","CK-023"],points:["PT-021","PT-023","PT-027"],
  critical:"压力/流量、泵组Q-H/P-Q特性、分项电表和冗余联锁"},
 {id:"spray",name:"射雾器除尘",checks:["CK-021","CK-022"],points:["PT-017","PT-018","PT-019"],
  critical:"末端压力和流量、运行状态、作业影响范围"},
 {id:"domestic",name:"生活污水外送",checks:["CK-018","CK-023"],points:["PT-028","PT-030"],
  critical:"收集井、接管交接量、外部处理责任和接收记录"},
] as const;

export interface CoverageLine{
 subsystemId:string;name:string;assetCount:number;pointCount:number;
 mockFreshPointCount:number;invalidOrMissingPointCount:number;
 sampleCoveragePercent:number;
 fieldValidatedOnlinePointCount:0;
 verifiedEngineeringMeterCount:0;
 checks:readonly string[];
 pointRequirements:readonly string[];
 critical:string;
 dataSource:"MOCK_ONLY";
}
export function evaluateTelemetryCoverage(
 assets:Asset[],points:MeasurePoint[],
 latest:(pointId:string)=>TelemetrySample|null,
 asOf:string,
):CoverageLine[]{
 const at=Date.parse(asOf);
 return SUBSYSTEM_METER_GATES.map(sub=>{
  const assetIds=new Set(assets.filter(a=>a.subsystemId===sub.id&&!a.archived).map(a=>a.id));
  const related=points.filter(p=>assetIds.has(p.assetId));
  const usable=related.filter(point=>{
   const sample=latest(point.id);
   if(!sample||sample.quality!=="valid"||point.quality!=="valid"||
      typeof sample.value!=="number"||!Number.isFinite(sample.value))return false;
   const sampleAt=Date.parse(sample.at);
   if(!Number.isFinite(sampleAt)||!Number.isFinite(at)||sampleAt>at)return false;
   // 模拟新鲜度按期望采样间隔计算，但只是MOCK时标，不是正式SCADA授时验收。
   return at-sampleAt<=point.samplePeriodMinutes*2*60000;
  });
  return {
   subsystemId:sub.id,name:sub.name,assetCount:assetIds.size,pointCount:related.length,
   mockFreshPointCount:usable.length,
   invalidOrMissingPointCount:related.length-usable.length,
   sampleCoveragePercent:related.length?Math.round(usable.length/related.length*1000)/10:0,
   fieldValidatedOnlinePointCount:0,
   verifiedEngineeringMeterCount:0,
   checks:sub.checks,pointRequirements:sub.points,critical:sub.critical,
   dataSource:"MOCK_ONLY",
  };
 });
}
export function summarizeTelemetryCoverage(lines:CoverageLine[]){
 return {
  subsystemCount:lines.length,
  demoAssets:lines.reduce((sum,row)=>sum+row.assetCount,0),
  demoPoints:lines.reduce((sum,row)=>sum+row.pointCount,0),
  mockFreshPoints:lines.reduce((sum,row)=>sum+row.mockFreshPointCount,0),
  actualOnlineAcceptedPoints:0,
  readyForUnattended24h:false,
 };
}

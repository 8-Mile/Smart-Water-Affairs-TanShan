import test from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "./seed";
import { evaluateTelemetryCoverage,summarizeTelemetryCoverage,SUBSYSTEM_METER_GATES } from "./telemetryCoverage";
import type { MeasurePoint,TelemetrySample } from "./types";

const seed=buildSeed("SCN-NORMAL");
const samples=new Map<string,TelemetrySample>();
for(const point of seed.points){
  // 单测中显式构造MOCK采样，不冒充ScenarioSeed包含真实采集流。
  samples.set(point.id,{
    pointId:point.id,at:seed.referenceTime,
    value:point.baseline??(point.kind==="number"?1:"RUNNING"),
    quality:point.quality,source:"MOCK",
  });
}
const evaluate=(asOf:string)=>evaluateTelemetryCoverage(seed.assets,seed.points,id=>samples.get(id)??null,asOf);
test("V31-C01 六套工艺必须逐项核对，不把valid的MOCK测点当已验收的真实SCADA数据",()=>{
 const lines=evaluate(seed.referenceTime);
 assert.equal(lines.length,6);
 assert.equal(SUBSYSTEM_METER_GATES.length,6);
 assert.ok(lines.some(x=>x.subsystemId==="rainwater"));
 assert.ok(lines.some(x=>x.subsystemId==="mining"));
 assert.ok(lines.every(x=>x.fieldValidatedOnlinePointCount===0&&x.verifiedEngineeringMeterCount===0));
 const summary=summarizeTelemetryCoverage(lines);
 assert.equal(summary.actualOnlineAcceptedPoints,0);
 assert.equal(summary.readyForUnattended24h,false);
});
test("V31-C02 样本源与时标、质量码必须明确，缺测和无效数据不能当有效点",()=>{
 const point:MeasurePoint={id:"testpoint",assetId:seed.assets[0].id,label:"模拟压力",kind:"number",source:"MOCK",quality:"valid",samplePeriodMinutes:5};
 const asset={...seed.assets[0],subsystemId:"rainwater"};
 const fresh:TelemetrySample={pointId:point.id,at:"2026-11-16T10:00:00Z",value:1,quality:"valid",source:"MOCK"};
 const line=(sample:TelemetrySample|null)=>evaluateTelemetryCoverage([asset],[point],()=>sample,"2026-11-16T10:05:00Z")
   .find(x=>x.subsystemId==="rainwater")!;
 assert.equal(line(fresh).mockFreshPointCount,1);
 assert.equal(line({...fresh,quality:"invalid"}).mockFreshPointCount,0);
 assert.equal(line({...fresh,value:null}).mockFreshPointCount,0);
 assert.equal(line({...fresh,value:Number.NaN}).mockFreshPointCount,0);
 assert.equal(line({...fresh,at:"2026-11-16T09:50:00Z"}).mockFreshPointCount,0);
 assert.equal(line({...fresh,at:"2026-11-16T10:06:00Z"}).mockFreshPointCount,0);
 assert.equal(line(null).mockFreshPointCount,0);
 assert.equal(line(fresh).fieldValidatedOnlinePointCount,0);
});
test("V31-C03 时刻超出模拟参考时点不能称为真实现场失联",()=>{
 const veryLate=evaluate("2026-11-30T12:00:00Z");
 assert.ok(veryLate.every(x=>x.mockFreshPointCount===0));
 assert.ok(veryLate.every(x=>x.fieldValidatedOnlinePointCount===0));
});
test("V31-C04 所有工艺的硬件核查入口必须指向已有CK和PT条目",async()=>{
 const {engineeringEntry}=await import("./engineering");
 for(const x of SUBSYSTEM_METER_GATES){
  assert.ok(x.checks.length>0&&x.points.length>0);
  assert.ok(x.checks.every(id=>engineeringEntry(id)));
  assert.ok(x.points.every(id=>engineeringEntry(id)));
 }
});
test("V31-C05 无有效模拟测点时不能用满分覆盖率暗示已具备值守条件",()=>{
 const line=evaluateTelemetryCoverage([seed.assets[0]],[],()=>null,seed.referenceTime);
 assert.ok(line.every(x=>x.sampleCoveragePercent===0));
 assert.ok(line.every(x=>x.fieldValidatedOnlinePointCount===0));
});

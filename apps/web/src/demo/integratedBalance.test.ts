import test from "node:test";
import assert from "node:assert/strict";
import {assessIntegratedBalance,DEFAULT_INTEGRATED_BALANCE} from "./integratedBalance";

test("正常运行守恒，已处理水和末端回用不重复计入库存",()=>{
 const result=assessIntegratedBalance({...DEFAULT_INTEGRATED_BALANCE});
 assert.ok(Math.abs(result.physicalBalanceGapM3)<1e-6);
 assert.equal(result.pollutionOverflowM3,0);
 assert.equal(result.machineShortageM3,0);
 assert.equal(result.executable,false);
 assert.ok(result.actualReuseM3<=DEFAULT_INTEGRATED_BALANCE.approvedReuseDemandM3);
});
test("大雨和处理能力不足：仅输出溢出风险，不认定合法排放",()=>{
 const result=assessIntegratedBalance({...DEFAULT_INTEGRATED_BALANCE,rainMm:100,treatmentM3h:40});
 assert.ok(result.pollutionOverflowM3>0);
 assert.ok(result.risks.some(x=>x.includes("不代表允许排放")));
 assert.ok(Math.abs(result.physicalBalanceGapM3)<1e-6);
});
test("回用水质不合格或回用管路不通：不能产生回用量",()=>{
 for(const changes of [{qualityAccepted:false},{reusePathAssumed:false}]){
  const result=assessIntegratedBalance({...DEFAULT_INTEGRATED_BALANCE,...changes});
  assert.equal(result.actualReuseM3,0);
  assert.ok(result.processedM3<=DEFAULT_INTEGRATED_BALANCE.cleanCapacityM3-DEFAULT_INTEGRATED_BALANCE.cleanInitialM3);
  assert.ok(Math.abs(result.physicalBalanceGapM3)<1e-6);
 }
});
test("机器供水缺口与污水池水量守恒独立",()=>{
 const result=assessIntegratedBalance({...DEFAULT_INTEGRATED_BALANCE,machineDemandM3h:110,machineAvailableM3h:60});
 assert.equal(result.machineShortageM3,50*24);
 assert.ok(Math.abs(result.physicalBalanceGapM3)<1e-6);
});
test("无效池容、负数和错误比例必须拒算",()=>{
 assert.throws(()=>assessIntegratedBalance({...DEFAULT_INTEGRATED_BALANCE,pollutedCapacityM3:100}),/初始储量/);
 assert.throws(()=>assessIntegratedBalance({...DEFAULT_INTEGRATED_BALANCE,rainMm:-1}),/范围/);
 assert.throws(()=>assessIntegratedBalance({...DEFAULT_INTEGRATED_BALANCE,contaminatedRunoffRatio:1.2}),/比例/);
});

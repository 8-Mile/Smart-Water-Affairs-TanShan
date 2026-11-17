import test from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "./seed";
import {
  cloneEnergyInputs,defaultPumpEnergyInputs,evaluatePumpEnergy,
  readEnergyDrafts,saveEnergyDraft, ENERGY_DRAFT_KEY,
} from "./pumpEnergy";
const normal=()=>defaultPumpEnergyInputs(buildSeed("SCN-NORMAL").assets);
const calc=()=>evaluatePumpEnergy(normal());
const approx=(a:number,b:number,tol=0.00002)=>assert.ok(Math.abs(a-b)<tol,`${a} ~= ${b}`);
test("默认3台中压泵直接复用现有MOCK铭牌和实际演示状态；不含其他工艺泵",()=>{
  const input=normal();
  assert.deepEqual(input.pumps.map(p=>p.code),["P-001","P-002","P-004"]);
  assert.deepEqual(input.pumps.map(p=>p.status),["running","running","stopped"]);
  assert.deepEqual(input.pumps.map(p=>p.readyForDispatch),[true,true,false]);
  assert.equal(input.pumps[0].ratedMotorKw,75);
  assert.ok(input.pumps.every(p=>p.provenance==="MOCK_ASSUMPTION"));
});
test("同一5500m³日任务量：基线双泵、条件优选单泵，水量/电耗和小时保持守恒",()=>{
  const r=calc();
  assert.equal(r.baseline?.key,"P-001+P-002");
  assert.equal(r.recommended?.key,"P-002");
  approx(r.baseline!.runHours,5500/650);
  approx(r.recommended!.runHours,5500/330);
  approx(r.baseline!.energyKwh,150*(5500/650));
  approx(r.recommended!.energyKwh,75*(5500/330));
  approx(r.recommended!.unitEnergyKwhM3,75/330);
  assert.equal(r.recommended!.estimatedDeliveredM3,5500);
  assert.ok(r.savingKwh!>0 && r.savingYuan!>0);
  assert.ok(r.savingPercent!<3,"示例不能人为制造高得离谱的节电率");
});
test("水力功率和综合效率严格按Q H 输入功率计算，不能把电机额定功率直接当真实电表",()=>{
  const r=calc();
  const p=r.points.find(x=>x.code==="P-002")!;
  approx(p.hydraulicKw,9.81*330*74/3600);
  approx(p.specificEnergyKwhM3,75/330);
  approx(p.wireToWaterEfficiencyPct,9.81*330*74/(3600*75)*100);
  assert.ok(r.warnings.some(x=>x.includes("Q-H")));
  assert.ok(r.warnings.some(x=>x.includes("电功率")));
});
test("峰值流量需求上升：单泵即使日总量可用也不能被选为有效方案",()=>{
  const i=normal();i.dailyVolumeM3=9300;i.peakFlowM3h=600;
  const r=evaluatePumpEnergy(i);
  assert.ok(r.combinations.filter(x=>x.count===1).every(x=>!x.feasible));
  assert.equal(r.recommended?.key,"P-001+P-002");
  assert.equal(r.savingKwh,0);
});
test("备用P004未经投运条件核验：任何包含P004的组合不得参与优选",()=>{
  const r=calc();
  assert.ok(r.combinations.filter(x=>x.codes.includes("P-004")).every(x=>!x.feasible));
  assert.ok(r.combinations.some(x=>x.reasons.some(e=>e.includes("未确认启泵条件"))));
});
test("确认P004具备模拟投运条件后才允许参与优化，且不修改泵实体状态",()=>{
  const i=normal();i.pumps.find(p=>p.code==="P-004")!.readyForDispatch=true;
  const r=evaluatePumpEnergy(i);
  assert.ok(r.combinations.some(x=>x.key==="P-004"&&x.feasible));
  assert.equal(r.inputs.pumps.find(p=>p.code==="P-004")!.status,"stopped");
});
test("现有种子故障场景P002必须从所有可行组合排除；不能与失效基线比较节约额",()=>{
  const i=defaultPumpEnergyInputs(buildSeed("SCN-PUMP-FAULT").assets);
  const r=evaluatePumpEnergy(i);
  assert.ok(r.combinations.filter(x=>x.codes.includes("P-002")).every(x=>!x.feasible));
  assert.equal(r.recommended?.key,"P-001");
  assert.equal(r.baseline?.key,"P-001");
});
test("自定义模拟故障状态时，不能把故障泵当可派发设备，即使勾选备用",()=>{
  const i=normal();
  const p=i.pumps.find(x=>x.code==="P-002")!;p.status="fault";p.readyForDispatch=true;
  const r=evaluatePumpEnergy(i);
  assert.ok(r.combinations.filter(x=>x.codes.includes("P-002")).every(x=>!x.feasible));
});
test("最少一个已确认可用备用泵约束：当P004未核验时现行双泵基线不满足，禁止计算节约",()=>{
  const i=normal();i.minReadyStandby=1;
  const r=evaluatePumpEnergy(i);
  assert.equal(r.baseline?.feasible,false);
  assert.equal(r.savingYuan,null);
  assert.ok(r.baseline?.reasons.some(x=>x.includes("备用泵")));
});
test("扬程不足会阻断方案，系统全体超限时无推荐不计算收益",()=>{
  const i=normal();i.requiredHeadM=100;
  const r=evaluatePumpEnergy(i);
  assert.equal(r.recommended,null);
  assert.equal(r.savingKwh,null);
  assert.ok(r.combinations.every(x=>x.reasons.some(e=>e.includes("扬程"))));
});
test("最小输入功率不能低于水力功率，不得计算效率超过100%的虚假工况",()=>{
  const i=normal();i.pumps[0].electricalInputKw=60;
  assert.throws(()=>evaluatePumpEnergy(i),/效率>100%/);
});
test("不外推铭牌运行点，也不允许超额定功率、负电价、矛盾的日负荷和重复设备",()=>{
  const q=normal();q.pumps[0].flowM3h=q.pumps[0].ratedFlowM3h+1;
  assert.throws(()=>evaluatePumpEnergy(q),/铭牌Q\/H/);
  const power=normal();power.pumps[0].electricalInputKw=76;
  assert.throws(()=>evaluatePumpEnergy(power),/高于演示铭牌功率/);
  const rate=normal();rate.electricityYuanKwh=-1;
  assert.throws(()=>evaluatePumpEnergy(rate),/综合电价/);
  const peak=normal();peak.dailyVolumeM3=9000;peak.peakFlowM3h=200;
  assert.throws(()=>evaluatePumpEnergy(peak),/平均流量/);
  const repeated=normal();repeated.pumps[1].code=repeated.pumps[0].code;
  assert.throws(()=>evaluatePumpEnergy(repeated),/重复/);
});
test("完整供水任务也可能全部受阻，不能凭空推荐组合",()=>{
  const i=normal();i.peakFlowM3h=800;
  const r=evaluatePumpEnergy(i);
  assert.equal(r.recommended,null);
  assert.equal(r.savingYuan,null);
  assert.ok(r.warnings.some(x=>x.includes("没有可完成")));
});
test("草稿保存复用权限并保存假设与场景，未授权及无可行组合均拒绝",()=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,v:string)=>{values.set(key,v);}};
  const r=calc();
  assert.throws(()=>saveEnergyDraft(r,"viewer","SCN-NORMAL",storage),/无权/);
  const draft=saveEnergyDraft(r,"engineer","SCN-NORMAL",storage);
  assert.equal(draft.source,"MOCK");assert.equal(draft.state,"draft");
  assert.equal(draft.inputs.pumps[0].provenance,"MOCK_ASSUMPTION");
  assert.equal(readEnergyDrafts(storage,"SCN-NORMAL").length,1);
  assert.equal(readEnergyDrafts(storage,"SCN-PUMP-FAULT").length,0);
  const blocked=normal();blocked.requiredHeadM=100;
  assert.throws(()=>saveEnergyDraft(evaluatePumpEnergy(blocked),"engineer","SCN-NORMAL",storage),/没有可行/);
  values.set(ENERGY_DRAFT_KEY,"invalid-json");
  assert.deepEqual(readEnergyDrafts(storage),[]);
});
test("cloneEnergyInputs必须深拷贝运行点，不能影响原始设备数据或参数",()=>{
  const i=normal();const j=cloneEnergyInputs(i);
  j.pumps[0].electricalInputKw=70;
  assert.equal(i.pumps[0].electricalInputKw,75);
});

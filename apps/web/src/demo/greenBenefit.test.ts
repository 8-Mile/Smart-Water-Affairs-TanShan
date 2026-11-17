import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneGreenBenefit,evaluateGreenBenefit,readGreenDrafts,saveGreenBenefitDraft,GREEN_DRAFT_KEY,
} from "./greenBenefit";

const base=()=>cloneGreenBenefit();
function memory(){
  const values=new Map<string,string>();
  return {values,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
}
test("G1 默认MOCK使用原三水源路径求解，满足1700m³并禁止雨水中水重复库存",()=>{
  const input=base(),before=JSON.stringify(input);
  const result=evaluateGreenBenefit(input);
  assert.equal(JSON.stringify(input),before,"pure financial calculation must not mutate supply configuration");
  assert.equal(result.water.requestedM3,1700);
  assert.equal(result.water.suppliedM3,1700);
  assert.equal(result.water.unmetM3,0);
  assert.equal(result.water.feasible,true);
  assert.deepEqual(result.water.sources.map(x=>x.usedM3),[650,600,450]);
  assert.equal(result.tapAvoidedM3,1250);
  assert.equal(result.water.nonTapSuppliedM3,1250);
});
test("G2 默认同量全自来水基准与各项费用相加匹配，毛/净差额严格可追溯",()=>{
  const result=evaluateGreenBenefit(base());
  assert.equal(result.baselineYuan,6120);
  assert.equal(result.currentYuan,3258.25);
  assert.equal(result.netDeltaYuan,2861.75);
  assert.equal(result.grossDeltaYuan,3640);
  assert.equal(result.totalAdditionalYuan,778.25);
  assert.equal(result.addedElectricityKwh,215);
  assert.equal(result.netDeltaYuan!,result.baselineYuan!-result.currentYuan!);
  assert.ok(result.bySource.every(x=>x.totalYuan>=x.baseYuan));
  assert.equal(result.bySource.reduce((a,x)=>a+x.volumeM3,0),1700);
  assert.equal(result.electricityYuan,182.75);
});
test("G3 成本科目排重未确认，保留原模型结果但隐藏净差额和确认结论",()=>{
  const input=base();input.costBoundaryConfirmed=false;
  const result=evaluateGreenBenefit(input);
  assert.equal(result.comparable,true);
  assert.equal(result.grossDeltaYuan,3640);
  assert.equal(result.baselineYuan,null);
  assert.equal(result.currentYuan,null);
  assert.equal(result.netDeltaYuan,null);
  assert.equal(result.totalAdditionalYuan,null);
  assert.equal(result.addedElectricityKwh,0);
  assert.equal(result.fixedYuan,0);
  assert.match(result.blockers.join("、"),/成本边界/);
});
test("G4 模拟中水水质不达标时不使用中水，而不是假装满足水质",()=>{
  const input=base();
  for(const route of input.water.routes)if(route.sourceId==="reclaimed")route.qualityAccepted=false;
  const result=evaluateGreenBenefit(input);
  assert.equal(result.water.sources.find(x=>x.id==="reclaimed")?.usedM3,0);
  assert.equal(result.water.feasible,true);
  assert.ok(result.netDeltaYuan!==null);
});
test("G5 供水缺口时净费用差不能披露为节约，完整方案不能保存",()=>{
  const input=base();
  const tap=input.water.sources.find(x=>x.id==="tap")!;
  tap.availableM3=400;tap.deliverableM3=400;
  input.water.sources.find(x=>x.id==="rain")!.availableM3=80;
  input.water.sources.find(x=>x.id==="reclaimed")!.availableM3=80;
  const result=evaluateGreenBenefit(input);
  assert.equal(result.water.feasible,false);
  assert.equal(result.netDeltaYuan,null);
  assert.equal(result.tapAvoidedM3,null);
  assert.match(result.blockers.join("；"),/无法满足全部需求/);
  assert.throws(()=>saveGreenBenefitDraft(input,result,"SCN-NORMAL","manager",memory()),/不能保存完整效益核算草稿/);
});
test("G6 当前组合满足要求但全自来水基准不可行时，不能编造假设节约",()=>{
  const input=base();
  const tap=input.water.sources.find(x=>x.id==="tap")!;
  tap.availableM3=1000;tap.deliverableM3=1000;
  const result=evaluateGreenBenefit(input);
  assert.equal(result.water.feasible,true);
  assert.equal(result.water.allTapBaselineYuan,null);
  assert.equal(result.netDeltaYuan,null);
  assert.equal(result.grossDeltaYuan,null);
  assert.match(result.blockers.join("、"),/全自来水基准/);
});
test("G7 成本有可能让回用净增支，不得只展示正向宣传收益",()=>{
  const input=base();input.fixedReuseYuanPeriod=3800;
  const result=evaluateGreenBenefit(input);
  assert.ok(result.netDeltaYuan!==null&&result.netDeltaYuan<0);
  assert.ok(result.warnings.some(x=>x.includes("增支")));
  assert.ok(result.water.nonTapSuppliedM3>0);
});
test("G8 追加处理成本改变了水源排序，必须重新优化而不是直接在旧结果上追加费用",()=>{
  const input=base();
  input.extras.find(x=>x.id==="reclaimed")!.treatmentYuanM3=6;
  const result=evaluateGreenBenefit(input);
  assert.equal(result.water.feasible,true);
  assert.equal(result.water.sources.find(x=>x.id==="reclaimed")?.usedM3,0);
  assert.ok(result.water.sources.find(x=>x.id==="tap")!.usedM3>450);
  assert.equal(result.bySource.find(x=>x.id==="reclaimed")?.totalYuan,0);
});
test("G9 雨水中水不是分别核实的库存时，不可拿原水/中水账本做两份可用库存",()=>{
  const input=base();input.water.separateStockConfirmed=false;
  const result=evaluateGreenBenefit(input);
  assert.equal(result.water.sources.find(x=>x.id==="rain")!.usedM3,0);
  assert.equal(result.water.sources.find(x=>x.id==="reclaimed")!.usedM3,0);
  assert.equal(result.water.sources.find(x=>x.id==="tap")!.usedM3,1700);
  assert.equal(result.tapAvoidedM3,0);
  assert.equal(result.fixedYuan,0);
  assert.equal(result.netDeltaYuan,0);
});
test("G10 非法单价、额外电耗、负成本、重复水源配置必须拒绝",()=>{
  for(const mutate of [
    (x:ReturnType<typeof base>)=>{x.electricityYuanKwh=Number.NaN;},
    (x:ReturnType<typeof base>)=>{x.extras[0].additionalKwhM3=-1;},
    (x:ReturnType<typeof base>)=>{x.fixedReuseYuanPeriod=-100;},
    (x:ReturnType<typeof base>)=>{x.extras[1].treatmentYuanM3=Infinity;},
    (x:ReturnType<typeof base>)=>{x.extras[1].id="rain";},
    (x:ReturnType<typeof base>)=>{x.water.sources[0].unitCostYuanM3=-0.5;},
  ]){
    const input=base();mutate(input);
    assert.throws(()=>evaluateGreenBenefit(input));
  }
});
test("G11 保存草稿需授权且重新计算一致，不能篡改净收益值或带过期计算",()=>{
  const input=base(),result=evaluateGreenBenefit(input),st=memory();
  assert.throws(()=>saveGreenBenefitDraft(input,result,"SCN-NORMAL","viewer",st),/无权/);
  assert.throws(()=>saveGreenBenefitDraft({...input,fixedReuseYuanPeriod:600},result,"SCN-NORMAL","manager",st),/发生变化/);
  assert.equal(readGreenDrafts(st).length,0);
  const draft=saveGreenBenefitDraft(input,result,"SCN-NORMAL","water",st);
  assert.equal(draft.status,"draft");
  assert.equal(draft.result.netDeltaYuan,2861.75);
  assert.equal(readGreenDrafts(st,"SCN-NORMAL").length,1);
  assert.equal(readGreenDrafts(st,"SCN-PUMP-FAULT").length,0);
  assert.ok(st.getItem(GREEN_DRAFT_KEY)?.includes(draft.id));
});
test("G12 成本口径未确认不允许保存伪装成完整财务净效益的草稿",()=>{
  const input=base();input.costBoundaryConfirmed=false;
  const result=evaluateGreenBenefit(input);
  assert.throws(()=>saveGreenBenefitDraft(input,result,"SCN-NORMAL","admin",memory()),/不能保存完整效益核算草稿/);
});
test("G13 草稿读取错误JSON/错误类型容错，配置拷贝不共享可变原对象",()=>{
  const st=memory();
  st.setItem(GREEN_DRAFT_KEY,"invalid-json");
  assert.deepEqual(readGreenDrafts(st),[]);
  const input=base(),copy=cloneGreenBenefit(input);
  copy.extras[0].treatmentYuanM3=7;
  copy.water.demands[0].neededM3=789;
  assert.notEqual(input.extras[0].treatmentYuanM3,copy.extras[0].treatmentYuanM3);
  assert.notEqual(input.water.demands[0].neededM3,copy.water.demands[0].neededM3);
});
test("G14 只计算同周期已满足的总需求，不能把水量账本回用量或泵组铭牌功率直接加入费用",()=>{
  const input=base();input.water.demands[2].neededM3=250;
  const result=evaluateGreenBenefit(input);
  assert.equal(result.water.requestedM3,1550);
  assert.ok(!("ledgerVolume" in result));
  assert.ok(!("motorNameplateKw" in result));
  assert.ok(result.warnings.some(x=>x.includes("不是港口总用水节约量")));
});

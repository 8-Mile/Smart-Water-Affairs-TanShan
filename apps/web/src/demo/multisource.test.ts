import test from "node:test";
import assert from "node:assert/strict";
import { cloneMultiSource, evaluateMultiSource, type MultiSourceInputs } from "./multisource";
const base = (): MultiSourceInputs => cloneMultiSource();
const near = (a:number,b:number) => assert.ok(Math.abs(a-b)<.00001,`${a} !== ${b}`);

test("默认单时段：三水源分配不超库存、不超供水能力、成本比全自来水更低",()=>{
  const result=evaluateMultiSource(base());
  assert.equal(result.feasible,true);
  assert.equal(result.requestedM3,1700);
  near(result.suppliedM3,1700);
  near(result.unmetM3,0);
  near(result.sources.reduce((s,x)=>s+x.usedM3,0),1700);
  for(const s of result.sources) {
    assert.ok(s.usedM3<=s.limitM3+1e-6);
    assert.ok(s.usedM3<=s.availableM3+1e-6);
  }
  for(const a of result.allocations){
    const route=result.inputs.routes.find(r=>r.sourceId===a.sourceId&&r.useId===a.useId)!;
    assert.ok(route.qualityAccepted&&route.connected);
    assert.ok(a.volumeM3<=route.limitM3+1e-6);
  }
  near(result.totalCostYuan,2480);
  near(result.allTapBaselineYuan!,6120);
  near(result.savingVsTapYuan!,3640);
  near(result.nonTapSuppliedM3,1250);
  assert.ok(result.costSavingPercent!>50);
});

test("关键生产补水只能走明确获准的自来水路径",()=>{
 const result=evaluateMultiSource(base());
 const critical=result.uses.find(x=>x.id==="critical")!;
 assert.equal(critical.unmetM3,0);
 assert.deepEqual(critical.allocations.map(a=>a.sourceId),["tap"]);
});

test("水质不满足：关闭回用水到除尘的合格判断后，优化不得偷走该管路",()=>{
 const input=base();
 input.routes.find(x=>x.sourceId==="reclaimed"&&x.useId==="spray")!.qualityAccepted=false;
 const result=evaluateMultiSource(input);
 assert.ok(result.allocations.every(a=>a.sourceId!=="reclaimed"||a.useId!=="spray"));
 assert.equal(result.feasible,true);
});

test("物理管网不通：断开雨水到除尘的路径后，供水结果立即变更",()=>{
 const input=base();
 input.routes.find(x=>x.sourceId==="rain"&&x.useId==="spray")!.connected=false;
 const result=evaluateMultiSource(input);
 assert.ok(result.allocations.every(a=>a.sourceId!=="rain"||a.useId!=="spray"));
 assert.ok(result.sources.find(x=>x.id==="rain")!.usedM3 <= 200 + 1e-6);
 assert.equal(result.feasible,true);
});

test("切断关键用水水路：即使总库存充裕也不得显示全部满足",()=>{
 const input=base();
 input.routes.find(x=>x.sourceId==="tap"&&x.useId==="critical")!.connected=false;
 const result=evaluateMultiSource(input);
 assert.equal(result.feasible,false);
 assert.equal(result.uses.find(x=>x.id==="critical")!.unmetM3,450);
 assert.equal(result.allTapBaselineYuan,null);
 assert.equal(result.savingVsTapYuan,null);
});

test("库存未明确分开时，禁用雨水和中水以避免双计",()=>{
 const input=base();input.separateStockConfirmed=false;
 const result=evaluateMultiSource(input);
 near(result.nonTapSuppliedM3,0);
 assert.equal(result.sources.find(x=>x.id==="rain")!.usedM3,0);
 assert.equal(result.sources.find(x=>x.id==="reclaimed")!.usedM3,0);
 assert.ok(result.warnings.some(x=>x.includes("独立库存未核实")));
});

test("供水能力不足优先保障关键用水，其他用水不能挤占",()=>{
 const input=base();
 const tap=input.sources.find(x=>x.id==="tap")!;
 tap.availableM3=450;tap.deliverableM3=450;
 const rain=input.sources.find(x=>x.id==="rain")!;rain.availableM3=0;
 const reuse=input.sources.find(x=>x.id==="reclaimed")!;reuse.availableM3=100;
 const result=evaluateMultiSource(input);
 assert.equal(result.feasible,false);
 assert.equal(result.uses.find(x=>x.id==="critical")!.unmetM3,0);
 assert.ok(result.uses.find(x=>x.id==="spray")!.unmetM3>0);
 assert.ok(result.warnings.some(x=>x.includes("未满足供水需求")));
 assert.equal(result.savingVsTapYuan,null);
});

test("全自来水比较不可执行时，即使优化方案可以满足需求，也不声称节约额",()=>{
 const input=base();
 const tap=input.sources.find(x=>x.id==="tap")!;
 tap.availableM3=500; tap.deliverableM3=500;
 const result=evaluateMultiSource(input);
 assert.equal(result.feasible,true);
 assert.equal(result.allTapBaselineYuan,null);
 assert.equal(result.savingVsTapYuan,null);
 assert.equal(result.tapAvoidedM3,null);
});

test("不存在同一份水被分配两次，任意可行水量保持源端与去向守恒",()=>{
 const input=base();
 for (const v of [0,100,300,700,1300]) {
  input.demands.find(x=>x.id==="spray")!.neededM3=v;
  const result=evaluateMultiSource(input);
  for(const s of result.sources){
    near(result.allocations.filter(a=>a.sourceId===s.id).reduce((sum,a)=>sum+a.volumeM3,0),s.usedM3);
  }
  for(const u of result.uses){
    near(result.allocations.filter(a=>a.useId===u.id).reduce((sum,a)=>sum+a.volumeM3,0),u.suppliedM3);
    near(u.neededM3,u.suppliedM3+u.unmetM3);
  }
  near(result.requestedM3,result.suppliedM3+result.unmetM3);
 }
});

test("不符合模型输入约束的需求、价格、路径、时间均拒绝计算",()=>{
 const src=base(); src.sources[0].unitCostYuanM3=-1;
 assert.throws(()=>evaluateMultiSource(src),/单位成本/);
 const req=base();req.demands[0].neededM3=-50;
 assert.throws(()=>evaluateMultiSource(req),/用水需求/);
 const matrix=base();matrix.routes.pop();
 assert.throws(()=>evaluateMultiSource(matrix),/矩阵不完整/);
 const time=base();time.periodHours=0;
 assert.throws(()=>evaluateMultiSource(time),/统计时段/);
 const duplicate=base();duplicate.routes[0]={...duplicate.routes[1]};
 assert.throws(()=>evaluateMultiSource(duplicate),/路径配置缺失或重复/);
});

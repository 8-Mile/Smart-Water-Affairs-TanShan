import test from "node:test";
import assert from "node:assert/strict";
import {evaluatePortChain,PORT_CHAIN_PRESETS,PORT_CHAIN_HARDWARE} from "./portChain";
const from=(id:"normal"|"storm"|"extreme"="storm")=>({...PORT_CHAIN_PRESETS[id]});
const allowMock=(id:"normal"|"storm"|"extreme"="storm")=>{
 const i=from(id);i.inletBasis="assumed_connected" as const;i.qualityBasis="assumed_pass" as const;i.pipelineBasis="assumed_connected" as const;return i;
};
test("V3-P01 默认强降雨污染水不因没有水质证据或管线证据而宣称出水/回用",()=>{
 const result=evaluatePortChain(from());
 assert.equal(result.totalRunoffM3,18144);
 assert.equal(result.totalPollutedInM3,9979.2);
 assert.equal(result.totalProcessedM3,0);
 assert.equal(result.totalReusedM3,0);
 assert.equal(result.totalOverflowM3,5579.2);
 assert.equal(result.totalUnmetDemandM3,2640);
 assert.equal(result.massBalanceGapM3,0);
 assert.ok(result.bottlenecks.some(x=>x.id==="quality"));
 assert.ok(result.bottlenecks.some(x=>x.id==="pipe"));
 assert.equal(result.realEngineeringVerified,false);
 assert.equal(result.controlReleased,false);
 assert.ok(result.steps.every(x=>x.unapprovedOutflowM3===0));
});
test("V3-P02 没有工程证明时即使清水池有水，也不允许计入码头冲洗回用量",()=>{
 const input=from();input.qualityBasis="assumed_pass";input.inletBasis="assumed_connected";
 const result=evaluatePortChain(input);
 assert.equal(result.totalReusedM3,0);
 assert.ok(result.totalProcessedM3>0);
 assert.ok(result.bottlenecks.some(x=>x.id==="pipe"));
 assert.equal(result.massBalanceGapM3,0);
});
test("V3-P03 管道假设连通而无合格水质，不可计入任何合格处理出水",()=>{
 const input=from();input.pipelineBasis="assumed_connected";
 const result=evaluatePortChain(input);
 assert.equal(result.totalProcessedM3,0);
 assert.equal(result.totalReusedM3,0);
 assert.equal(result.massBalanceGapM3,0);
});
test("V3-P04 人工仅在MOCK选择水质合格与管路通畅后，可以展示完整四段流程",()=>{
 const input=allowMock();
 const r=evaluatePortChain(input);
 assert.equal(r.totalRunoffM3,18144);
 assert.ok(r.totalProcessedM3>0);
 assert.ok(r.totalReusedM3>0);
 assert.ok(r.totalReusedM3<=input.flushDemandM3h*input.hours);
 assert.ok(r.totalReusedM3<=input.transferCapacityM3h*input.hours);
 assert.equal(r.massBalanceGapM3,0);
 assert.equal(r.realEngineeringVerified,false);
 assert.equal(r.controlReleased,false);
 assert.ok(r.steps.every(x=>x.unapprovedOutflowM3===0));
});
test("V3-P05 强降雨高于一般降雨，极端高于强降雨，模型按小时守恒不造假外排",()=>{
 const a=evaluatePortChain(from("normal")),b=evaluatePortChain(from("storm")),c=evaluatePortChain(from("extreme"));
 assert.ok(a.totalPollutedInM3<b.totalPollutedInM3);
 assert.ok(b.totalPollutedInM3<c.totalPollutedInM3);
 assert.ok(a.totalOverflowM3<b.totalOverflowM3);
 assert.ok(b.totalOverflowM3<c.totalOverflowM3);
 for(const x of [a,b,c]){assert.equal(x.steps.length,12);assert.equal(x.massBalanceGapM3,0);}
});
test("V3-P06 当前处理站名义处理能力只是上限，清水池满时不可继续算合格处理",()=>{
 const input=allowMock();
 input.flushDemandM3h=0;input.clearPoolInitialM3=input.clearPoolCapacityM3;
 const r=evaluatePortChain(input);
 assert.equal(r.totalProcessedM3,0);
 assert.equal(r.totalReusedM3,0);
 assert.ok(r.totalOverflowM3>0);
 assert.equal(r.massBalanceGapM3,0);
});
test("V3-P07 码头面冲洗实际需求为零时不得根据处理出水而声称节约水量",()=>{
 const i=allowMock();i.flushDemandM3h=0;
 const r=evaluatePortChain(i);
 assert.equal(r.totalReusedM3,0);
 assert.equal(r.totalUnmetDemandM3,0);
 assert.equal(r.massBalanceGapM3,0);
});
test("V3-P08 污染水溢出只能成为风险量，不能转换为合法排口流量",()=>{
 const i=allowMock("extreme");i.pollutedPoolCapacityM3=1900;
 const r=evaluatePortChain(i);
 assert.ok(r.totalOverflowM3>0);
 assert.ok(r.bottlenecks.some(x=>x.id==="overflow"));
 assert.equal(r.steps.reduce((v,x)=>v+x.unapprovedOutflowM3,0),0);
 assert.match(r.assumptions.join("；"),/合法排水/);
});
test("V3-P09 各阶段不允许超出分池容量，且历史库存和回用守恒残差为零",()=>{
 for(const id of ["normal","storm","extreme"] as const){
  const i=allowMock(id);const r=evaluatePortChain(i);
  assert.equal(r.massBalanceGapM3,0);
  for(const s of r.steps){
   assert.ok(s.poolStorageM3<=i.pollutedPoolCapacityM3+0.0001);
   assert.ok(s.clearStorageM3<=i.clearPoolCapacityM3+0.0001);
   assert.ok(s.poolStorageM3>=0&&s.clearStorageM3>=0);
  }
 }
});
test("V3-P10 无效面积/容量/负库存/小时/水质和连通状态必须拒绝",()=>{
 const changes:Array<(i:ReturnType<typeof from>)=>void>=[
 (i:ReturnType<typeof from>)=>{i.rainMm=-1;},
 (i:ReturnType<typeof from>)=>{i.rainMm=Infinity;},
 (i:ReturnType<typeof from>)=>{i.catchmentM2=0;},
 (i:ReturnType<typeof from>)=>{i.pollutedFraction=1.1;},
 (i:ReturnType<typeof from>)=>{i.hours=1.5;},
 (i:ReturnType<typeof from>)=>{i.pollutedPoolCapacityM3=10;},
 (i:ReturnType<typeof from>)=>{i.clearPoolInitialM3=-10;},
 (i:ReturnType<typeof from>)=>{i.qualityBasis="fake" as never;},
 (i:ReturnType<typeof from>)=>{i.pipelineBasis="sure" as never;},
 (i:ReturnType<typeof from>)=>{i.inletBasis="sure" as never;},
 ];
 for(const mutate of changes){const i=from();mutate(i);assert.throws(()=>evaluatePortChain(i));}
});
test("V3-P11 每项核心硬件依赖必须提供真实CK编号，不预先指定采购数量",()=>{
 assert.ok(PORT_CHAIN_HARDWARE.length>=5);
 assert.ok(PORT_CHAIN_HARDWARE.every(x=>/^CK-\d{3}$/.test(x.id)));
 assert.ok(PORT_CHAIN_HARDWARE.some(x=>x.id==="CK-013"));
 assert.ok(PORT_CHAIN_HARDWARE.every(x=>x.status==="待核查"));
});
test("V3-P12 输入纯函数不会篡改场景配置或原来的六工艺种子",()=>{
 const i=allowMock();const before=JSON.stringify(i);
 evaluatePortChain(i);assert.equal(JSON.stringify(i),before);
 assert.equal(PORT_CHAIN_PRESETS.storm.inletBasis,"unknown");
 assert.equal(PORT_CHAIN_PRESETS.storm.qualityBasis,"unknown");
 assert.equal(PORT_CHAIN_PRESETS.storm.pipelineBasis,"unknown");
});

test("V3-P13 即使水质有MOCK合格假设，没有入站管路依据也不产生新的处理出水",()=>{
 const i=from();i.qualityBasis="assumed_pass";i.pipelineBasis="assumed_connected";
 const r=evaluatePortChain(i);
 assert.equal(r.totalProcessedM3,0);
 assert.ok(r.totalReusedM3<=i.clearPoolInitialM3); // 仅可能消纳期初已有清水
 assert.ok(r.bottlenecks.some(x=>x.id==="inlet"));
 assert.equal(r.massBalanceGapM3,0);
});

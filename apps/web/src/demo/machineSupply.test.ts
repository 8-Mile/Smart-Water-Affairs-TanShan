import test from "node:test";
import assert from "node:assert/strict";
import {createMachineSupplyScenario,evaluateMachineSupply} from "./machineSupply";

test("单机供水模拟：扣除预留仍能供给已作业终端",()=>{
 const result=evaluateMachineSupply(createMachineSupplyScenario("single"));
 assert.equal(result.demandedM3h,56);
 assert.equal(result.availableM3h,80);
 assert.equal(result.shortageM3h,0);
 assert.equal(result.fullySatisfied,true);
 assert.equal(result.hydraulicVerified,false);
});
test("多机同时作业：缺口可解释且不分给未作业终端",()=>{
 const result=evaluateMachineSupply(createMachineSupplyScenario("parallel"));
 assert.equal(result.demandedM3h,94);
 assert.equal(result.shortageM3h,14);
 assert.equal(result.allocatedM3h,80);
 assert.equal(result.terminals.filter(t=>t.active).length,3);
});
test("供水能力降低后优先供给高优先级终端",()=>{
 const result=evaluateMachineSupply(createMachineSupplyScenario("limited"));
 assert.equal(result.shortageM3h,49);
 assert.equal(result.terminals.find(t=>t.id==="M-C")!.allocatedM3h,0);
});
test("不允许超大预留量和非法需求",()=>{
 const s=createMachineSupplyScenario();
 s.reservedM3h=91;
 assert.throws(()=>evaluateMachineSupply(s),/预留/);
 s.reservedM3h=1;s.terminals[0].demandM3h=-1;
 assert.throws(()=>evaluateMachineSupply(s),/终端需求/);
});

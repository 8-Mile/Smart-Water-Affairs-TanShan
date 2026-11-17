import test from "node:test";
import assert from "node:assert/strict";
import { parseWaterWorkflow, executeWaterWorkflow } from "./waterAiWorkflow";
import { saveDispatchDraft, saveSupplyDraft, readDrafts, DISPATCH_DRAFT_KEY, MULTI_SOURCE_DRAFT_KEY } from "./proposalDrafts";
import type { DutyEvent } from "./unattended";

test("中文降雨语义解析：80毫米按真实参数传给水量模型，不返回预制答案",()=>{
  const request=parseWaterWorkflow("分析未来80毫米降雨并比较雨前调蓄方案");
  assert.equal(request?.kind,"dispatch");
  assert.equal(request?.rainMm,80);
  const answer=executeWaterWorkflow(request!);
  assert.equal(answer.dispatch?.inputs.rainMm,80);
  assert.equal(answer.dispatch?.options.length,3);
  assert.match(answer.resultLines.join(" "),/方案A/);
  assert.match(answer.caveat,/MOCK|演示/);
});

test("无雨量指令明确采用演示默认60毫米，不能暗示是实际天气",()=>{
  const request=parseWaterWorkflow("比较雨前调蓄方案");
  assert.equal(request?.kind,"dispatch");
  assert.equal(request?.rainMm,60);
  assert.match(executeWaterWorkflow(request!).resultLines.join(" "),/固定MOCK/);
});

test("一次输入多个雨量或非法雨量，拒绝随机选择",()=>{
  const multi=parseWaterWorkflow("比较30毫米和80毫米降雨的调蓄方案");
  assert.equal(multi?.kind,"dispatch");
  assert.match(multi?.issue??"",/一次只支持/);
  assert.throws(()=>executeWaterWorkflow(multi!),/一次只支持/);
  const over=parseWaterWorkflow("分析900毫米降雨并比较雨前调蓄方案");
  assert.match(over?.issue??"",/0至500/);
});

test("三水源优化解析常规、水质受阻与能力不足三种场景",()=>{
  const common=parseWaterWorkflow("比较雨水、中水、自来水的供水经济方案");
  assert.equal(common?.kind,"supply");
  const a=executeWaterWorkflow(common!);
  assert.equal(a.supply?.result.feasible,true);
  assert.equal(a.supply?.result.savingVsTapYuan,3640);
  const quality=parseWaterWorkflow("比较多水源方案，中水水质不达标怎么办");
  assert.equal(quality?.supplyScenario,"quality");
  const b=executeWaterWorkflow(quality!);
  assert.equal(b.supply?.result.sources.find(s=>s.id==="reclaimed")?.usedM3,0);
  const shortage=parseWaterWorkflow("分析多水源供水能力不足方案");
  assert.equal(shortage?.supplyScenario,"shortage");
  assert.ok(executeWaterWorkflow(shortage!).supply!.result.unmetM3>0);
});

test("值守事件只查询现有事件，没有事件不能说全港正常",()=>{
  const request=parseWaterWorkflow("查询当前无人值守待处理事件");
  assert.equal(request?.kind,"duty");
  const empty=executeWaterWorkflow(request!);
  assert.match(empty.resultLines.join(" "),/不代表全港/);
  const event: DutyEvent={
    id:"UT-001", subsystemId:"medium-pressure",assetId:"asset-p002",kind:"low_pressure",
    title:"中压供水异常",level:"warning",status:"pending_verification",firstSeen:"2026-11-16",
    lastSeen:"2026-11-16",occurrences:2,validRecoveryChecks:0,detail:"",evidence:[],history:[],
  };
  const answered=executeWaterWorkflow(request!,[event]);
  assert.match(answered.resultLines[0],/UT-001/);
});

test("涉及生产控制的类似指令不得进入水务规则工具",()=>{
  for(const prompt of [
    "自动启动水泵并比较雨前调蓄方案",
    "下发雨水外排控制并分析80毫米降雨",
    "分析多水源方案并自动切换阀门",
  ]) assert.equal(parseWaterWorkflow(prompt),null);
});

function memory(){
  const all=new Map<string,string>();
  return {
    storage:{getItem:(key:string)=>all.get(key)??null,setItem:(key:string,value:string)=>{all.set(key,value);}},
    all,
  };
}
test("AI雨前建议写入原雨前调蓄页面的草稿键、精确保留80mm",()=>{
  const {storage}=memory();
  const answer=executeWaterWorkflow(parseWaterWorkflow("分析80毫米降雨并比较雨前调蓄方案")!);
  const draft=saveDispatchDraft(answer.dispatch!,"manager",storage);
  assert.equal(draft.dataSource,"MOCK");
  assert.equal(draft.parameters.rainMm,80);
  assert.equal(readDrafts(DISPATCH_DRAFT_KEY,storage).length,1);
  assert.throws(()=>saveDispatchDraft(answer.dispatch!,"viewer",storage),/无权/);
});
test("AI多水源建议复用现有供水草稿，缺口和只读角色均禁止写入",()=>{
  const {storage}=memory();
  const normal=executeWaterWorkflow(parseWaterWorkflow("比较雨水中水自来水的供水经济方案")!);
  const draft=saveSupplyDraft(normal.supply!.inputs,normal.supply!.result,"water",storage);
  assert.equal(draft.state,"draft");assert.equal(draft.source,"MOCK");
  assert.equal(readDrafts(MULTI_SOURCE_DRAFT_KEY,storage).length,1);
  const shortage=executeWaterWorkflow(parseWaterWorkflow("比较多水源供水能力不足方案")!);
  assert.throws(()=>saveSupplyDraft(shortage.supply!.inputs,shortage.supply!.result,"water",storage),/未满足/);
  assert.throws(()=>saveSupplyDraft(normal.supply!.inputs,normal.supply!.result,"engineer",storage),/无权/);
  assert.equal(readDrafts(MULTI_SOURCE_DRAFT_KEY,storage).length,1);
});
test("限额草稿保留30条，容错损坏localStorage",()=>{
  const {storage,all}=memory();
  const assessment=executeWaterWorkflow(parseWaterWorkflow("计算雨前调蓄方案")!).dispatch!;
  for(let i=0;i<33;i++)saveDispatchDraft(assessment,"admin",storage);
  assert.equal(readDrafts(DISPATCH_DRAFT_KEY,storage).length,30);
  all.set(DISPATCH_DRAFT_KEY,"not-a-json");
  assert.deepEqual(readDrafts(DISPATCH_DRAFT_KEY,storage),[]);
});

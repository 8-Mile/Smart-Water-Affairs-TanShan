import test from "node:test";
import assert from "node:assert/strict";
import {readFlowDraft,saveFlowDraft,safeReturnPath,FLOW_DRAFT_TTL_MS} from "./userJourney";
test("试算草稿在同标签页可恢复，超时和损坏数据不会被采用",()=>{
 const data=new Map<string,string>();
 const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 saveFlowDraft(storage,"machine:normal",{capacityM3h:90},100);
 assert.deepEqual(readFlowDraft(storage,"machine:normal",(x):x is {capacityM3h:number}=>typeof x==="object"&&x!==null&&"capacityM3h" in x,200),{capacityM3h:90});
 assert.equal(readFlowDraft(storage,"machine:normal",(_x):_x is never=>false,200),null);
 assert.equal(readFlowDraft(storage,"machine:normal",(_x):_x is never=>false,100+FLOW_DRAFT_TTL_MS+1),null);
 data.set("tg-v42-flow:machine:normal","broken");
 assert.equal(readFlowDraft(storage,"machine:normal",(x):x is object=>typeof x==="object"),null);
});
test("返回来源仅接受已知本地业务路径，不接受外链和跳回自身",()=>{
 assert.equal(safeReturnPath("/operations/events?tab=queue&eventRef=alarm%3AALM-P002-01","/operations/workorders"),"/operations/events?tab=queue&eventRef=alarm%3AALM-P002-01");
 assert.equal(safeReturnPath("/process/medium-pressure?tab=trend","/water/balance"),"/process/medium-pressure?tab=trend");
 assert.equal(safeReturnPath("//external.example","/water/balance"),null);
 assert.equal(safeReturnPath("/admin/secrets","/water/balance"),null);
 assert.equal(safeReturnPath("/water/balance","/water/balance"),null);
});

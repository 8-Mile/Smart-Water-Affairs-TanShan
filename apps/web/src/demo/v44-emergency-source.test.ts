import test from "node:test";
import assert from "node:assert/strict";
import {createEmergencyCase,readEmergencyCases} from "./emergencyWorkflow";
const fakeStore=()=>{
 const kv=new Map<string,string>();
 return {getItem:(key:string)=>kv.get(key)??null,setItem:(key:string,value:string)=>{kv.set(key,value);}};
};
test("V44 same source duty event retains original reference and cannot open duplicate active emergency",()=>{
 const storage=fakeStore();
 const payload={
  scenarioId:"SCN-NORMAL" as const,actor:"admin" as const,
  kind:"equipment" as const,title:"巡查异常对应的应急协同",
  severity:"warning" as const,assetId:"asset-001",
  sourceEventRef:"duty:UT-001",now:"2026-11-17T08:00:00Z",
 };
 const item=createEmergencyCase(storage,payload);
 assert.equal(item.sourceEventRef,"duty:UT-001");
 assert.equal(item.eventId,undefined);
 assert.deepEqual(readEmergencyCases(storage,"SCN-NORMAL").map(x=>x.id),[item.id]);
 assert.throws(()=>createEmergencyCase(storage,payload),/已有未归档应急任务/);
});
test("V44 legacy alarm source references remain resolvable after migration",()=>{
 const storage=fakeStore();
 const item=createEmergencyCase(storage,{
  scenarioId:"SCN-NORMAL",actor:"admin",kind:"supply",title:"中压泵告警协同",
  severity:"critical",eventId:"ALM-P002-01",now:"2026-11-17T08:00:00Z",
 });
 assert.equal(item.sourceEventRef,"alarm:ALM-P002-01");
 assert.equal(item.eventId,"ALM-P002-01");
 assert.throws(()=>createEmergencyCase(storage,{
  scenarioId:"SCN-NORMAL",actor:"admin",kind:"equipment",title:"重复告警协同",
  severity:"warning",eventId:"ALM-P002-01",now:"2026-11-17T08:05:00Z",
 }),/未归档应急任务/);
});

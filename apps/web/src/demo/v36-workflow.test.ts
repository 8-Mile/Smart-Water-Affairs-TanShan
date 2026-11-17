import test from "node:test";
import assert from "node:assert/strict";
import {cloneMultiSource,evaluateMultiSource} from "./multisource";
import {resolveSupplyDraft,saveSupplyDraft,MULTI_SOURCE_DRAFT_KEY} from "./proposalDrafts";

function storage(){
 const db=new Map<string,string>();
 return {
  getItem:(k:string)=>db.get(k)??null,
  setItem:(k:string,v:string)=>{db.set(k,v);},
 };
}
test("V36-01 明确指定草稿编号才导入对应供水条件；重新检验可行性",()=>{
 const store=storage();
 const a=cloneMultiSource();const one=saveSupplyDraft(a,evaluateMultiSource(a),"admin",store);
 const b=cloneMultiSource();b.sources.find(s=>s.id==="tap")!.unitCostYuanM3+=0.1;
 const two=saveSupplyDraft(b,evaluateMultiSource(b),"admin",store);
 assert.equal(resolveSupplyDraft(store).id,two.id);
 assert.equal(resolveSupplyDraft(store,one.id).id,one.id);
 assert.equal(resolveSupplyDraft(store,one.id).inputs.sources.find(s=>s.id==="tap")!.unitCostYuanM3,
  a.sources.find(s=>s.id==="tap")!.unitCostYuanM3);
 assert.throws(()=>resolveSupplyDraft(store,"WS-MISSING"),/不可用或已被清理/);
});
test("V36-02 草稿未通过完整供水复算、非法来源和缺少输入均禁止导入",()=>{
 const store=storage();
 const a=cloneMultiSource();const one=saveSupplyDraft(a,evaluateMultiSource(a),"admin",store);
 const broken=JSON.parse(store.getItem(MULTI_SOURCE_DRAFT_KEY)??"[]");
 broken[0].inputs.sources.find((x:{id:string})=>x.id==="tap").availableM3=0;
 broken[0].inputs.sources.find((x:{id:string})=>x.id==="tap").deliverableM3=0;
 store.setItem(MULTI_SOURCE_DRAFT_KEY,JSON.stringify(broken));
 assert.throws(()=>resolveSupplyDraft(store,one.id),/完整供水|条件/);
 broken[0].source="UNKNOWN";
 store.setItem(MULTI_SOURCE_DRAFT_KEY,JSON.stringify(broken));
 assert.throws(()=>resolveSupplyDraft(store,one.id),/结构或来源/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {classifyWaterAccounting,waterAccountingSnapshot} from "./waterAccounting";
import type {LedgerEntry} from "./types";
const make=(sourceType:string,direction:"in"|"out",volume:number):LedgerEntry=>({
 id:sourceType,sourceType,direction,volume,period:"2026-11",unit:"m³",note:"MOCK",source:"MOCK",
});
test("循环水缺表不得把收集雨水或处理出站量重复算作循环量",()=>{
 const ledger=[make("自来水","in",100),make("雨水","in",90),make("中水","out",75),
 make("含矿污水","out",70),make("生活污水","out",20)];
 const r=waterAccountingSnapshot(ledger);
 assert.equal(r.tapM3,100);
 assert.equal(r.rainCollectedM3,90);
 assert.equal(r.reclaimedM3,75);
 assert.equal(r.circulatingM3,null);
 assert.equal(r.reuseM3,75);
 assert.equal(r.externalTakeM3,100);
 assert.equal(classifyWaterAccounting(ledger[3]).canCountAsReuse,false);
 assert.equal(classifyWaterAccounting(ledger[4]).stage,"外部处理单位接管");
});
test("缺少某类型计量返回null而不是0",()=>{
 const r=waterAccountingSnapshot([make("雨水","in",90)]);
 assert.equal(r.tapM3,null);
 assert.equal(r.reclaimedM3,null);
});

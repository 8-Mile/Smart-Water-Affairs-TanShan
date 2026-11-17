import test from "node:test";
import assert from "node:assert/strict";
import {answerWaterUsageQuery} from "./waterQuery";
import type {LedgerEntry} from "./types";
const entry=(sourceType:string,direction:"in"|"out",volume:number,period:string):LedgerEntry=>({
 id:sourceType+period,sourceType,direction,volume,period,unit:"m³",note:"MOCK",source:"MOCK",
});
const rows=[entry("自来水","in",100,"2026-10"),entry("自来水","in",120,"2026-11"),
 entry("中水","out",75,"2026-11"),entry("雨水","in",90,"2026-11")];
test("水资源AI问数按最新周期取数，不跨周期求和",()=>{
 const r=answerWaterUsageQuery("本月自来水和中水用量多少？",rows);
 assert.ok(r?.lines.some(x=>x.includes("120")));
 assert.ok(r?.lines.some(x=>x.includes("75")));
 assert.equal(r?.lines.some(x=>x.includes("100")),false);
});
test("今日或近一周问数不能拿月账本当日实测",()=>{
 const r=answerWaterUsageQuery("今天中水使用了多少？",rows);
 assert.match(r?.title??"",/缺少有效水量数据/);
 assert.ok(r?.lines.some(x=>x.includes("不能据此推算")));
});
test("循环水缺测不能把雨水入池当循环量",()=>{
 const r=answerWaterUsageQuery("循环水用了多少？",rows);
 assert.ok(r?.lines.some(x=>x.includes("缺数")));
 assert.ok(r?.lines.some(x=>x.includes("不能由雨水入池反推")));
 assert.equal(answerWaterUsageQuery("查询设备状态",rows),null);
});

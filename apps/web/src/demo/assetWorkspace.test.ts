import test from "node:test";
import assert from "node:assert/strict";
import {alarmOrder,inspectionOrder,nextInspectionId,validateInspection} from "./assetWorkspace";

test("V37-01 巡检编号跨刷新与旧数据递增",()=>{
 assert.equal(nextInspectionId([{id:"INS-MOCK-01"},{id:"INS-USER-011"},{id:"INS-USER-007"}]),"INS-USER-012");
 assert.equal(nextInspectionId([]),"INS-USER-001");
});
test("V37-02 巡检验证禁止空项与无效时间，异常项决定结果",()=>{
 assert.throws(()=>validateInspection("","2026-11-17T12:00:00+08:00",[{label:"泵体",value:"正常",abnormal:false}],""),/设备/);
 assert.throws(()=>validateInspection("a","not-a-time",[{label:"泵体",value:"正常",abnormal:false}],""),/时间/);
 assert.throws(()=>validateInspection("a","2026-11-17T12:00:00+08:00",[{label:"",value:"正常",abnormal:false}],""),/不能为空/);
 const accepted=validateInspection("a","2026-11-17T12:00:00+08:00",[{label:" 外观 ",value:" 渗漏 ",abnormal:true},{label:"温度",value:"正常",abnormal:false}],"  待复测 ");
 assert.equal(accepted.result,"abnormal");
 assert.equal(accepted.items[0].label,"外观");
 assert.equal(accepted.note,"待复测");
});
test("V37-03 告警已有工单、失效引用和未关联分别识别",()=>{
 const order={id:"WO-1",alarmId:"AL-1"};
 assert.deepEqual(alarmOrder({id:"AL-1"},[order]),{id:"WO-1",exists:true,orphaned:false});
 assert.deepEqual(alarmOrder({id:"AL-1",workOrderId:"WO-missing"},[order]),{id:"WO-missing",exists:false,orphaned:true});
 assert.deepEqual(alarmOrder({id:"AL-2"},[order]),{id:null,exists:false,orphaned:false});
});
test("V37-04 巡检已生成过草稿时返回原工单ID，不重复创建",()=>{
 const orders=[{id:"WO-2",source:"inspection" as const,evidenceIds:["INS-USER-001"]}];
 assert.equal(inspectionOrder("INS-USER-001",orders),"WO-2");
 assert.equal(inspectionOrder("INS-USER-999",orders),null);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  BASIN_STORAGE_KEY,MOCK_BASINS,BASIN_REQUIREMENTS,basinVolumes,interpolateBasinVolume,
  parseBasinCurve,verifyBasinInput,pointBindingCheck,basinForScenario,basinRole,
  readBasinRecords,allBasinRecords,saveBasinRecord,reviewBasinRecord,archiveBasinRecord,
  exportBasinSurveyCsv,
  type BasinInput,
} from "./basinRegistry";
import {engineeringEntry} from "./engineering";
import type {Asset,MeasurePoint} from "./types";
const now="2026-11-17T07:00:00+08:00";
const storage=()=>{const items=new Map<string,string>();return{
  getItem:(id:string)=>items.get(id)??null,
  setItem:(id:string,value:string)=>{items.set(id,value);},
};};
const base=():BasinInput=>({
 code:"A-POLL-01",name:"设计资料待核的示例污染水池",purpose:"polluted_collection",subsystemId:"rainwater",
 siteRef:"雨水收集现场一区待核",drawingRef:"DWG-RAIN-PID-001",drawingVersion:"A01",
 datumDescription:"本工程设计高程零点待水工单位统一核实",minLevelM:0,maxLevelM:5,assumedLevelM:2,
 levelPointId:null,knots:[{hM:0,volumeM3:0},{hM:2,volumeM3:1800},{hM:5,volumeM3:6200}],
});
const asset:Asset={id:"asset-basin-a",code:"A-BASIN",name:"模拟池体",type:"水池",subsystemId:"rainwater",
 status:"unknown",source:"MOCK",area:"north",runtimeHours:0,startCount:0,archived:false};
const point:MeasurePoint={id:"asset-basin-a-level",assetId:asset.id,label:"池体液位",kind:"number",unit:"m",
 source:"MOCK",quality:"valid",samplePeriodMinutes:30};
test("V32-B01 独立两个MOCK池绝不被误认正式竣工库容",()=>{
 assert.equal(MOCK_BASINS.length,2);
 assert.equal(allBasinRecords(storage()).length,2);
 assert.ok(MOCK_BASINS.every(x=>x.source==="MOCK"&&!x.fieldVerified&&!x.controlReleased));
 assert.deepEqual([basinVolumes(MOCK_BASINS[0]).effectiveCapacityM3,basinVolumes(MOCK_BASINS[1]).effectiveCapacityM3],[6200,2200]);
 assert.equal(basinVolumes(MOCK_BASINS[0]).actualAcceptedCapacityM3,null);
});
test("V32-B02 V-H在范围内线性插值，计算从最低运行液位到最高的有效容量",()=>{
 const b=base();b.minLevelM=1;b.maxLevelM=4;b.assumedLevelM=3;
 const r=basinVolumes(b);
 assert.equal(interpolateBasinVolume(b.knots,1),900);
 assert.ok(Math.abs(interpolateBasinVolume(b.knots,4)-(1800+4400*2/3))<1e-8);
 assert.ok(Math.abs(r.effectiveCapacityM3-(interpolateBasinVolume(b.knots,4)-900))<1e-8);
 assert.ok(Math.abs(r.mockInitialM3!-(interpolateBasinVolume(b.knots,3)-900))<1e-8);
 assert.equal(r.verifiedFieldMeasurement,false);
});
test("V32-B03 严禁越界外推、缺节点、乱序、重复节点和反向容量增长",()=>{
 assert.throws(()=>interpolateBasinVolume(base().knots,6),/禁止外推/);
 assert.throws(()=>interpolateBasinVolume(base().knots,-1),/禁止外推/);
 assert.throws(()=>verifyBasinInput({...base(),knots:[{hM:0,volumeM3:0},{hM:1,volumeM3:1}]}),/3–30行/);
 assert.throws(()=>verifyBasinInput({...base(),knots:[{hM:0,volumeM3:0},{hM:0,volumeM3:40},{hM:5,volumeM3:6200}]}),/严格递增/);
 assert.throws(()=>verifyBasinInput({...base(),knots:[{hM:0,volumeM3:0},{hM:2,volumeM3:4000},{hM:5,volumeM3:2000}]}),/严格递增/);
 assert.throws(()=>verifyBasinInput({...base(),knots:[{hM:0,volumeM3:0},{hM:2,volumeM3:NaN},{hM:5,volumeM3:6200}]}),/有限数/);
 assert.throws(()=>verifyBasinInput({...base(),minLevelM:-1}),/禁止外推/);
 assert.throws(()=>verifyBasinInput({...base(),assumedLevelM:6}),/起始液位/);
});
test("V32-B04 粘贴CSV或空格分隔的V-H行可解析，但不能接受列数与单位混写",()=>{
 assert.deepEqual(parseBasinCurve("0,0\n2，1800\n5 6200"),base().knots);
 assert.throws(()=>parseBasinCurve("0,0\n2,1800\n5m,6200m³"),/液位m,累积库容/);
 assert.throws(()=>parseBasinCurve("0,0\n2,1800\n5,6200,额外列"),/液位m,累积库容/);
 assert.throws(()=>parseBasinCurve("0,0\n2,1800\n1,6200"),/严格递增/);
});
test("V32-B05 编号、图纸版本、高程基准与工艺用途必须明确，用户不能占用MOCK命名空间",()=>{
 assert.throws(()=>verifyBasinInput({...base(),code:"MOCK-POLL-001"}),/MOCK-前缀/);
 assert.throws(()=>verifyBasinInput({...base(),drawingRef:"x"}),/图纸/);
 assert.throws(()=>verifyBasinInput({...base(),datumDescription:"短"}),/高程/);
 assert.throws(()=>verifyBasinInput({...base(),subsystemId:"mining"}),/用途与所属工艺/);
 assert.equal(verifyBasinInput(base()).code,"A-POLL-01");
});
test("V32-B06 示例池与实际池录入隔离；保存不改变老模拟池且支持独立版本",()=>{
 const st=storage(),one=saveBasinRecord(st,base(),"engineer",now,[],[]);
 assert.equal(one.state,"submitted");assert.equal(one.revision,1);assert.equal(one.fieldVerified,false);
 assert.equal(allBasinRecords(st).length,3);
 const two=saveBasinRecord(st,{...base(),name:"修订后的池体名称"},"engineer",now,[],[]);
 assert.equal(two.revision,2);assert.equal(two.history.length,2);
 assert.equal(readBasinRecords(st).length,1);
 assert.equal(MOCK_BASINS[0].name,"假设污染水池（非实物）");
});
test("V32-B07 viewer不能登记、engineer不能审核；DEMO审核不会批准实际库容",()=>{
 const st=storage();
 assert.throws(()=>saveBasinRecord(st,base(),"viewer",now,[],[]),/无权/);
 saveBasinRecord(st,base(),"engineer",now,[],[]);
 assert.throws(()=>reviewBasinRecord(st,"A-POLL-01","engineer","reviewed_demo","演示审核记录仅供学习",now),/无权/);
 const reviewed=reviewBasinRecord(st,"A-POLL-01","manager","reviewed_demo","只是看过这份人工资料，尚未签发",now);
 assert.equal(reviewed.state,"reviewed_demo");
 assert.equal(reviewed.fieldVerified,false);assert.equal(reviewed.controlReleased,false);
 assert.equal(basinVolumes(reviewed).actualAcceptedCapacityM3,null);
 assert.throws(()=>reviewBasinRecord(st,"A-POLL-01","manager","reviewed_demo","不得重复审核同一版本",now),/只能复核/);
});
test("V32-B08 退回修改留痕、管理者可软归档且旧记录保留审计",()=>{
 const st=storage();saveBasinRecord(st,base(),"duty",now,[],[]);
 const sent=reviewBasinRecord(st,"A-POLL-01","manager","returned","水位零点尚未提供正式批准图",now);
 assert.equal(sent.history.length,2);
 saveBasinRecord(st,base(),"engineer",now,[],[]);
 const archived=archiveBasinRecord(st,"A-POLL-01","manager","该图号历史作废请使用新图纸",now);
 assert.equal(archived.archived,true);
 assert.equal(archived.history.length,4);
 assert.throws(()=>basinForScenario(archived,"polluted"),/已归档/);
 assert.throws(()=>saveBasinRecord(st,base(),"engineer",now,[],[]),/归档池体/);
});
test("V32-B09 现有雨水池液位%不能直接绑定为V-H高程m",()=>{
 const percent={...point,unit:"%"};
 const invalid=pointBindingCheck(base(),percent.id,[asset],[percent],[]);
 assert.equal(invalid.ok,false);assert.match(invalid.reason,/百分比%/);
 assert.equal(pointBindingCheck(base(),point.id,[asset],[point],[]).ok,true);
});
test("V32-B10 单池一测点，禁止跨系统绑定与两个池体共享同一测点",()=>{
 const otherAsset={...asset,subsystemId:"mining"};
 assert.equal(pointBindingCheck(base(),point.id,[otherAsset],[point],[]).ok,false);
 const st=storage();
 saveBasinRecord(st,{...base(),levelPointId:point.id},"engineer",now,[asset],[point]);
 assert.throws(()=>saveBasinRecord(st,{...base(),code:"A-POLL-02",levelPointId:point.id},"engineer",now,[asset],[point]),/已绑定另一个池体/);
 assert.equal(pointBindingCheck(base(),point.id,[asset],[point],readBasinRecords(st)).ok,true);
});
test("V32-B11 即使单位是m，泵体专属压力/非池体归属也不能误认池体液位",()=>{
 const wrongAsset={...asset,type:"离心泵"};
 assert.equal(pointBindingCheck(base(),point.id,[wrongAsset],[point],[]).ok,false);
 assert.equal(pointBindingCheck(base(),null,[asset],[point],[]).ok,false);
 assert.equal(pointBindingCheck(base(),"NO-SUCH",[asset],[point],[]).ok,false);
});
test("V32-B12 模拟曲线可单池输入污染模型，但后期雨水/生态池不能充当合格清水",()=>{
 assert.equal(basinRole("first_flush"),"polluted");
 assert.equal(basinRole("clear_reuse"),"clear");
 assert.equal(basinRole("ecological"),null);
 const dirty=basinForScenario(MOCK_BASINS[0],"polluted"),clear=basinForScenario(MOCK_BASINS[1],"clear");
 assert.deepEqual([dirty.capacityM3,dirty.initialM3],[6200,1800]);
 assert.deepEqual([clear.capacityM3,clear.initialM3],[2200,450]);
 assert.equal(dirty.fieldVerified,false);assert.equal(dirty.source,"MOCK");
 assert.throws(()=>basinForScenario(MOCK_BASINS[1],"polluted"),/用途/);
});
test("V32-B13 没有假设起始液位不允许转换为可用情景，也不允许将实际工程签认状态从本地伪造",()=>{
 const st=storage();
 const input={...base(),assumedLevelM:null};
 const record=saveBasinRecord(st,input,"admin",now,[],[]);
 assert.throws(()=>basinForScenario(record,"polluted"),/起始液位/);
 st.setItem(BASIN_STORAGE_KEY,JSON.stringify([{...record,fieldVerified:true,controlReleased:true}]));
 assert.equal(readBasinRecords(st).length,0);
 st.setItem(BASIN_STORAGE_KEY,JSON.stringify([{...record,state:"field_approved"}]));
 assert.equal(readBasinRecords(st).length,0);
 st.setItem(BASIN_STORAGE_KEY,"{broken json");
 assert.equal(readBasinRecords(st).length,0);
});
test("V32-B14 原工作簿CK/PT核查编号全部有出处；不会预设真实池数",()=>{
 assert.ok(BASIN_REQUIREMENTS.length>=6);
 for(const x of BASIN_REQUIREMENTS)assert.ok(engineeringEntry(x.id),x.id);
 assert.ok(!Object.hasOwn(MOCK_BASINS[0],"realVolume"));
});
test("V32-B15 插值模型是纯函数，绝不改变曲线对象或种子数据",()=>{
 const i=base(),before=JSON.stringify(i);
 basinVolumes(i);assert.equal(JSON.stringify(i),before);
 const s=storage(),out=allBasinRecords(s);
 out.push({...MOCK_BASINS[0]});assert.equal(allBasinRecords(s).length,2);
});

test("V32-B16 现场核查CSV不能混入MOCK池，含审核状态、曲线、版本且不执行Excel公式",()=>{
 const st=storage();
 const a=saveBasinRecord(st,{...base(),name:"=HYPERLINK(\"x\")"},"engineer",now,[],[]);
 const csv=exportBasinSurveyCsv([MOCK_BASINS[0],a,MOCK_BASINS[1]]);
 assert.ok(csv.includes("池体独立编号"));
 assert.ok(csv.includes(a.code));
 assert.ok(csv.includes("0:0;2:1800;5:6200"));
 assert.ok(!csv.includes("MOCK-POOL-D"));
 assert.ok(!csv.includes("MOCK-POOL-C"));
 assert.ok(csv.includes("\"'=HYPERLINK"));
 assert.ok(csv.includes("\"否\",\"否\""));
});

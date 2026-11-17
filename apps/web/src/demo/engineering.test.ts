import test from "node:test";
import assert from "node:assert/strict";
import {
 ENGINEERING_BASELINE,ENGINEERING_REQUIREMENTS,ENGINEERING_POINTS,
 ENGINEERING_CHECKS,ENGINEERING_ISSUES,ENGINEERING_CATALOG,
 engineeringEntry,relatedEngineering,engineeringReadiness,
 readEngineeringReviews,submitEngineeringEvidence,reviewEngineeringEvidence,
 ENGINEERING_STORAGE_KEY,
} from "./engineering";
function storage(){
 const map=new Map<string,string>();
 return {map,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);}};
}
const NOW="2026-11-16T09:30:00Z";
test("V3-E01 原工作簿49需求+41测点+31核查+12冲突来源编号完整",()=>{
 assert.deepEqual([ENGINEERING_REQUIREMENTS.length,ENGINEERING_POINTS.length,ENGINEERING_CHECKS.length,ENGINEERING_ISSUES.length],[49,41,31,12]);
 assert.equal(ENGINEERING_CATALOG.length,133);
 assert.equal(new Set(ENGINEERING_CATALOG.map(x=>x.id)).size,133);
 assert.match(ENGINEERING_BASELINE,/六工艺软硬件需求/);
 assert.equal(engineeringEntry("CK-031")?.sourceRef,"P0现场核查清单!A36");
 assert.equal(engineeringEntry("PT-041")?.sourceRef,"测点及硬件台账!A46");
 assert.equal(engineeringEntry("REQ-049")?.sourceRef,"六工艺需求矩阵!A54");
 assert.equal(engineeringEntry("ISS-12")?.sourceRef,"口径冲突与红线!A17");
});
test("V3-E02 工艺检索区分需现场核验的用水端和通用信息化事项",()=>{
 assert.ok(relatedEngineering("含矿污水处理",100).some(x=>x.id==="REQ-014"));
 assert.ok(relatedEngineering("水池供水",100).some(x=>x.id==="PT-032"));
 assert.ok(relatedEngineering("雨水收集",100).some(x=>x.id==="PT-002"));
 assert.ok(relatedEngineering("中压供水",100).some(x=>x.id==="REQ-023"));
 assert.equal(engineeringEntry("NO-SUCH-ID"),undefined);
});
test("V3-E03 基线冲突保留，不能自行消除设计版本矛盾",()=>{
 const issue=engineeringEntry("ISS-03")!;
 assert.match(issue.detail,/70,638.9/);
 assert.match(issue.detail,/60,739/);
 assert.match(engineeringEntry("ISS-07")!.blocker,/核验/);
 assert.match(engineeringEntry("ISS-09")!.blocker,/因果/);
});
test("V3-E04 所有现场放行均为零，演示资料审查不形成PLC/水质/图纸签认",()=>{
 const st=storage();
 const initial=engineeringReadiness(readEngineeringReviews(st));
 assert.deepEqual([initial.total,initial.reviewedDemo,initial.fieldApproved,initial.realControlReleased],[31,0,0,false]);
 submitEngineeringEvidence(st,"CK-015","engineer","DRAWING-DEMO-01","码头面冲洗的回用管线仍待业主与设计院核验",NOW);
 let state=engineeringReadiness(readEngineeringReviews(st));
 assert.deepEqual([state.submitted,state.reviewedDemo,state.fieldApproved,state.realControlReleased],[1,0,0,false]);
 reviewEngineeringEvidence(st,"CK-015","manager","reviewed_demo","只确认看过假设图号，未进行真实工程签认",NOW);
 state=engineeringReadiness(readEngineeringReviews(st));
 assert.deepEqual([state.submitted,state.reviewedDemo,state.fieldApproved,state.realControlReleased],[0,1,0,false]);
 assert.equal(state.missing,30);
});
test("V3-E05 禁止查看角色或非审核角色提交或核验工程资料",()=>{
 const st=storage();
 assert.throws(()=>submitEngineeringEvidence(st,"CK-005","viewer","DESIGN-1001","已获取设计单位最新修订意见需要比对","2026-11-16T02:00:00Z"),/无权/);
 assert.throws(()=>submitEngineeringEvidence(st,"CK-X","engineer","DESIGN-1001","设计编号不能凭空提交不存在条目",NOW),/未找到/);
 const record=submitEngineeringEvidence(st,"CK-005","engineer","DESIGN-1001","内部池容合计与报告总量存在差异，应核设计口径",NOW);
 assert.equal(record.state,"submitted");
 assert.throws(()=>reviewEngineeringEvidence(st,"CK-005","engineer","reviewed_demo","设计仍待批准不能审核",NOW),/无权/);
});
test("V3-E06 提交凭据必须有明确资料编号和不少于8字说明",()=>{
 const st=storage();
 assert.throws(()=>submitEngineeringEvidence(st,"PT-017","engineer","abc","末端压力测点需现场核实来源",NOW),/图纸号/);
 assert.throws(()=>submitEngineeringEvidence(st,"PT-017","engineer","PT-017-DWG","短",NOW),/核查说明/);
 assert.equal(readEngineeringReviews(st).length,0);
});
test("V3-E07 退回留痕和再次提交不会绕过历史记录",()=>{
 const st=storage();
 submitEngineeringEvidence(st,"CK-026","water","PLC-CTRL-DEMO-1","需业主确认AI只读及原PLC本地联锁不可更改",NOW);
 const rejected=reviewEngineeringEvidence(st,"CK-026","manager","blocked","缺少PLC最终版控制方案与责任人签认",NOW);
 assert.equal(rejected.history.length,2);
 assert.equal(rejected.state,"blocked");
 assert.throws(()=>reviewEngineeringEvidence(st,"CK-026","manager","reviewed_demo","不能在无新证据情况下二次审批",NOW),/可审核|待复核/);
 const again=submitEngineeringEvidence(st,"CK-026","engineer","PLC-CTRL-DEMO-2","已申请最终版联锁图但现场授权仍未取得",NOW);
 assert.equal(again.state,"submitted");
 assert.equal(again.history.length,3);
 assert.equal(readEngineeringReviews(st).length,1);
 assert.equal(engineeringReadiness(readEngineeringReviews(st)).realControlReleased,false);
});
test("V3-E08 资料读取错误JSON不产生已批准状态",()=>{
 const st=storage();
 st.setItem(ENGINEERING_STORAGE_KEY,"{broken-json");
 assert.deepEqual(readEngineeringReviews(st),[]);
 st.setItem(ENGINEERING_STORAGE_KEY,JSON.stringify([{id:"CK-001",state:"field_approved",history:[]}]));
 assert.deepEqual(readEngineeringReviews(st),[]);
 st.setItem(ENGINEERING_STORAGE_KEY,JSON.stringify([{id:"IMAGINARY",state:"reviewed_demo",history:[]}]));
 assert.deepEqual(readEngineeringReviews(st),[]);
});
test("V3-E09 本地注册状态不改变项目原有设备和测点数量",()=>{
 const st=storage();
 const baseline=ENGINEERING_CATALOG.map(x=>x.id).join(",");
 submitEngineeringEvidence(st,"REQ-009","duty","MINING-DRAWING-01","需要先核实处理入水来源与实际水管位置",NOW);
 assert.equal(ENGINEERING_CATALOG.map(x=>x.id).join(","),baseline);
});

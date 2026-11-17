/**
 * 港口V3.1：工程关系基线。关系是核查任务，不是经现场批准的管网。
 * 工程图纸/环评的业务方向，不能代替物理管段、阀门和PLC拓扑确认。
 * 只有专业签认、设备投运及测点验收后，未来服务端才能建立verifiedPhysicalLink。
 * 此模型全程只读，所有实际控制授权始终false。
 */
import { engineeringEntry, type EngineeringReview } from "./engineering";
import type { DataSource } from "./types";

export type EngineeringLayer="water"|"control"|"compliance";
export type EngineeringRelationStatus="design_direction"|"unconfirmed"|"prohibited";
export interface EngineeringFacility{
 id:string;name:string;subsystemId:string;kind:"source"|"tank"|"treatment"|"terminal"|"pump"|"control"|"external";
 domain:"collection"|"treatment"|"reuse"|"supply"|"external"|"control";
 status:"design_context"|"demo_only"|"external_boundary";
 checkIds:string[];siteStatus:"unverified";
}
export interface EngineeringRelation{
 id:string;from:string;to:string;layer:EngineeringLayer;
 status:EngineeringRelationStatus;
 label:string;meaning:string;restrictions:string;
 checkIds:string[];pointIds:string[];source:DataSource;
 fieldVerified:false;controlAuthorized:false;
}
export interface TopologyCase{
 relation:EngineeringRelation;
 from:EngineeringFacility;to:EngineeringFacility;
 submitted:number;reviewedDemo:number;
 blockingCheckIds:string[];
 pointCount:number;
}
export const FACILITIES:readonly EngineeringFacility[]=[
 {id:"F-RUNOFF",name:"码头面含尘径流与冲洗废水",subsystemId:"rainwater",kind:"source",domain:"collection",status:"design_context",checkIds:["CK-008","CK-010"],siteStatus:"unverified"},
 {id:"F-COLLECTION",name:"污染水收集池（逐池待编号）",subsystemId:"rainwater",kind:"tank",domain:"collection",status:"design_context",checkIds:["CK-004","CK-005","CK-007"],siteStatus:"unverified"},
 {id:"F-MINERAL-IN",name:"含矿污水站入口",subsystemId:"mining",kind:"control",domain:"treatment",status:"design_context",checkIds:["CK-009","CK-011"],siteStatus:"unverified"},
 {id:"F-TREAT",name:"含矿污水处理工艺",subsystemId:"mining",kind:"treatment",domain:"treatment",status:"design_context",checkIds:["CK-011","CK-012","CK-013"],siteStatus:"unverified"},
 {id:"F-CLEAR",name:"合格出水与清水池",subsystemId:"mining",kind:"tank",domain:"reuse",status:"design_context",checkIds:["CK-013","CK-014"],siteStatus:"unverified"},
 {id:"F-FLUSH",name:"码头面冲洗用水端",subsystemId:"mining",kind:"terminal",domain:"reuse",status:"design_context",checkIds:["CK-015"],siteStatus:"unverified"},
 {id:"F-RAIN-OUT",name:"拟议排口／雨前腾库去向",subsystemId:"rainwater",kind:"external",domain:"external",status:"demo_only",checkIds:["CK-031"],siteStatus:"unverified"},
 {id:"F-OTHER-REUSE",name:"除尘池／人工湖等扩展去向",subsystemId:"pool",kind:"terminal",domain:"reuse",status:"demo_only",checkIds:["CK-016"],siteStatus:"unverified"},
 {id:"F-MID-PUMP",name:"中压供水泵站",subsystemId:"medium-pressure",kind:"pump",domain:"supply",status:"design_context",checkIds:["CK-019","CK-020"],siteStatus:"unverified"},
 {id:"F-SPRAY",name:"射雾器末端",subsystemId:"spray",kind:"terminal",domain:"supply",status:"design_context",checkIds:["CK-021","CK-022"],siteStatus:"unverified"},
 {id:"F-SEWAGE",name:"生活污水收集与提升",subsystemId:"domestic",kind:"source",domain:"external",status:"design_context",checkIds:["CK-018"],siteStatus:"unverified"},
 {id:"F-EXTERNAL",name:"外部既有处理站（项目范围外）",subsystemId:"domestic",kind:"external",domain:"external",status:"external_boundary",checkIds:["CK-018"],siteStatus:"unverified"},
 {id:"F-SCADA",name:"现有PLC/SCADA及工业安全域",subsystemId:"common",kind:"control",domain:"control",status:"design_context",checkIds:["CK-023","CK-025","CK-026"],siteStatus:"unverified"},
 {id:"F-PLATFORM",name:"智慧水务平台（只读接入）",subsystemId:"common",kind:"control",domain:"control",status:"demo_only",checkIds:["CK-023","CK-025","CK-026"],siteStatus:"unverified"},
];
export const RELATIONS:readonly EngineeringRelation[]=[
 {id:"REL-01",from:"F-RUNOFF",to:"F-COLLECTION",layer:"water",status:"design_direction",label:"污染径流收集",meaning:"符合环保收集方向，实际分流点、支管和切换控制仍待确认",restrictions:"不能将全部雨水等价为含矿污染径流",checkIds:["CK-008","CK-010"],pointIds:["PT-001","PT-003","PT-004"],source:"REFERENCE",fieldVerified:false,controlAuthorized:false},
 {id:"REL-02",from:"F-COLLECTION",to:"F-MINERAL-IN",layer:"water",status:"unconfirmed",label:"收集池至处理站",meaning:"处理入口可能受独立泵站、管段和阀位限制",restrictions:"无批准图纸不得计作实际可输送处理量",checkIds:["CK-009","CK-011"],pointIds:["PT-005","PT-009"],source:"USER_ENTRY",fieldVerified:false,controlAuthorized:false},
 {id:"REL-03",from:"F-MINERAL-IN",to:"F-TREAT",layer:"water",status:"design_direction",label:"污水进入处理工艺",meaning:"仅表达工艺进出站处理方向，500m³/h名义能力需另核",restrictions:"设备开机不等于合格处理量",checkIds:["CK-011","CK-012"],pointIds:["PT-009","PT-010"],source:"REFERENCE",fieldVerified:false,controlAuthorized:false},
 {id:"REL-04",from:"F-TREAT",to:"F-CLEAR",layer:"water",status:"unconfirmed",label:"处理出水至清水池",meaning:"需要正式管线、逐池容积、出水检测和回用泵对应关系",restrictions:"无水质合格证明不得称为合格可回用水",checkIds:["CK-013","CK-014"],pointIds:["PT-011","PT-012","PT-013"],source:"USER_ENTRY",fieldVerified:false,controlAuthorized:false},
 {id:"REL-05",from:"F-CLEAR",to:"F-FLUSH",layer:"water",status:"design_direction",label:"码头面冲洗回用",meaning:"前期环保设计中的回用方向；实际终端、连接与用水时序未确认",restrictions:"不能用设计用途直接推定每日有稳定消纳量",checkIds:["CK-014","CK-015"],pointIds:["PT-014","PT-034"],source:"REFERENCE",fieldVerified:false,controlAuthorized:false},
 {id:"REL-06",from:"F-CLEAR",to:"F-OTHER-REUSE",layer:"water",status:"prohibited",label:"扩展回用终端",meaning:"除尘池、人工湖等去向在现有材料中未取得批准工程依据",restrictions:"禁止纳入可执行调配或经济节约计算",checkIds:["CK-016"],pointIds:["PT-032"],source:"USER_ENTRY",fieldVerified:false,controlAuthorized:false},
 {id:"REL-07",from:"F-COLLECTION",to:"F-RAIN-OUT",layer:"compliance",status:"prohibited",label:"雨前腾库外排",meaning:"合法排口、污染水水质、排放许可和责任人未核",restrictions:"禁止将模拟超容水量解释为合法外排量",checkIds:["CK-031","CK-008"],pointIds:["PT-007"],source:"USER_ENTRY",fieldVerified:false,controlAuthorized:false},
 {id:"REL-08",from:"F-MID-PUMP",to:"F-SPRAY",layer:"water",status:"unconfirmed",label:"中压供水到射雾末端",meaning:"同时间低压不证明共同供水原因；两套系统可能独立",restrictions:"未核实物理拓扑，不做跨设备故障根因判定",checkIds:["CK-019","CK-021","CK-022"],pointIds:["PT-021","PT-022"],source:"USER_ENTRY",fieldVerified:false,controlAuthorized:false},
 {id:"REL-09",from:"F-SEWAGE",to:"F-EXTERNAL",layer:"water",status:"design_direction",label:"生活污水收集与外送",meaning:"按设计方向外送既有处理设施；接管位置、权属和合同仍待核",restrictions:"不画成本项目自建生化处理站",checkIds:["CK-018"],pointIds:["PT-028","PT-030"],source:"REFERENCE",fieldVerified:false,controlAuthorized:false},
 {id:"REL-10",from:"F-SCADA",to:"F-PLATFORM",layer:"control",status:"unconfirmed",label:"原自动化系统只读数据接入",meaning:"按站点授权获取PLC/SCADA数据，确保独立安全域与质量/时间戳",restrictions:"不得把网页或Agent作为PLC联锁控制器",checkIds:["CK-023","CK-025","CK-026"],pointIds:["PT-039","PT-040"],source:"USER_ENTRY",fieldVerified:false,controlAuthorized:false},
];
export const RELATION_STATUS:Readonly<Record<EngineeringRelationStatus,string>>={
 design_direction:"环保／设计业务方向，连接未核",unconfirmed:"工程关系待图纸及现场核实",prohibited:"当前禁止按此路径调度或外排",
};
export function relationById(id:string){return RELATIONS.find(x=>x.id===id);}
export function facilityById(id:string){return FACILITIES.find(x=>x.id===id);}
export function relationsForSubsystem(subsystemId:string):EngineeringRelation[]{
 const facilityIds=new Set(FACILITIES.filter(x=>x.subsystemId===subsystemId).map(x=>x.id));
 return RELATIONS.filter(x=>facilityIds.has(x.from)||facilityIds.has(x.to));
}
export function topologyCases(reviews:EngineeringReview[]):TopologyCase[]{
 const map=new Map(reviews.map(x=>[x.id,x]));
 return RELATIONS.map(relation=>{
  const from=facilityById(relation.from)!,to=facilityById(relation.to)!;
  return {
   relation,from,to,
   submitted:relation.checkIds.filter(x=>map.get(x)?.state==="submitted").length,
   reviewedDemo:relation.checkIds.filter(x=>map.get(x)?.state==="reviewed_demo").length,
   // DEMO review cannot clear any formal blocker; every physical check remains unverified.
   blockingCheckIds:relation.checkIds,
   pointCount:relation.pointIds.filter(x=>Boolean(engineeringEntry(x))).length,
  };
 });
}
export function topologySummary(reviews:EngineeringReview[]){
 const cases=topologyCases(reviews);
 return {
  total:cases.length,
  fieldVerified:cases.filter(x=>x.relation.fieldVerified).length,
  prohibited:cases.filter(x=>x.relation.status==="prohibited").length,
  fieldBlocked:cases.filter(x=>!x.relation.fieldVerified).length,
  reviewedEvidence:cases.filter(x=>x.reviewedDemo>0).length,
  realControlAuthorized:false as const,
 };
}

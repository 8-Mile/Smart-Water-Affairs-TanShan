/**
 * 唐港V3 港口污染水业务链：全量MOCK情景、小时级水量守恒和三重合规门槛。
 * 处理出水回用于码头面冲洗是前期环评方向；真实P&ID/水质/管线仍未核实。
 * 不能推导未经核定的跨六套工艺管线，不能生成PLC、外排或安全联锁命令。
 */
export interface PortChainInput{
 rainMm:number;catchmentM2:number;runoffCoefficient:number;pollutedFraction:number;
 hours:number;pollutedPoolInitialM3:number;pollutedPoolCapacityM3:number;
 treatmentM3h:number;clearPoolInitialM3:number;clearPoolCapacityM3:number;
 flushDemandM3h:number;transferCapacityM3h:number;
 inletBasis:"unknown"|"assumed_connected"|"blocked";
 qualityBasis:"unknown"|"assumed_pass"|"failed";
 pipelineBasis:"unknown"|"assumed_connected"|"blocked";
}
export interface PortChainStep{
 hour:number;rainInM3:number;pollutedInM3:number;processedM3:number;
 flushReuseM3:number;unmetDemandM3:number;poolStorageM3:number;
 clearStorageM3:number;overflowM3:number;unapprovedOutflowM3:number;
}
export interface PortChainResult{
 steps:PortChainStep[];input:PortChainInput;totalRunoffM3:number;totalPollutedInM3:number;
 totalProcessedM3:number;totalReusedM3:number;totalOverflowM3:number;
 totalUnmetDemandM3:number;poolFinalM3:number;clearFinalM3:number;
 maxPoolRatio:number;peakHour:number;massBalanceGapM3:number;
 basinStatus:"overflow"|"high"|"capacity_adequate";
 bottlenecks:{id:string;title:string;reason:string;checkIds:string[]}[];
 assumptions:string[];controlReleased:false;realEngineeringVerified:false;
}
const rnd=(n:number)=>Math.round(n*10000)/10000||0;
export const PORT_CHAIN_PRESETS:Record<string,PortChainInput>={
 normal:{
  rainMm:25,catchmentM2:420000,runoffCoefficient:.72,pollutedFraction:.55,hours:12,
  pollutedPoolInitialM3:1800,pollutedPoolCapacityM3:6200,treatmentM3h:400,
  clearPoolInitialM3:450,clearPoolCapacityM3:2200,flushDemandM3h:180,transferCapacityM3h:180,
  inletBasis:"unknown",qualityBasis:"unknown",pipelineBasis:"unknown",
 },
 storm:{
  rainMm:60,catchmentM2:420000,runoffCoefficient:.72,pollutedFraction:.55,hours:12,
  pollutedPoolInitialM3:1800,pollutedPoolCapacityM3:6200,treatmentM3h:400,
  clearPoolInitialM3:450,clearPoolCapacityM3:2200,flushDemandM3h:220,transferCapacityM3h:220,
  inletBasis:"unknown",qualityBasis:"unknown",pipelineBasis:"unknown",
 },
 extreme:{
  rainMm:100,catchmentM2:420000,runoffCoefficient:.72,pollutedFraction:.55,hours:12,
  pollutedPoolInitialM3:1800,pollutedPoolCapacityM3:6200,treatmentM3h:400,
  clearPoolInitialM3:450,clearPoolCapacityM3:2200,flushDemandM3h:220,transferCapacityM3h:220,
  inletBasis:"unknown",qualityBasis:"unknown",pipelineBasis:"unknown",
 },
};
export const PORT_CHAIN_HARDWARE=[
 {id:"CK-007",section:"污染水收集",type:"逐池液位＋有效容量V-H曲线",status:"待核查",strategy:"已有仪表可复用；没有标定曲线时不可发布真实库容预警"},
 {id:"CK-012",section:"含矿污水站",type:"入出水分表、处理段负荷、PLC运行状态",status:"待核查",strategy:"核500m³/h名义能力及故障、雨天降额；若计量缺口再补"},
 {id:"CK-013",section:"出水质量",type:"适用水质指标、检测记录及责任签认",status:"待核查",strategy:"无合格判定不得做回用出水或合法外排结论"},
 {id:"CK-014",section:"清水池与回用泵",type:"逐池有效容积、泵阀与流量",status:"待核查",strategy:"先核真实存储和输配条件，再判断补计量还是补设施"},
 {id:"CK-015",section:"码头面冲洗",type:"终端作业用水曲线、分表和管路确认",status:"待核查",strategy:"不得因存在处理站就默认每天有连续回用需求"},
 {id:"CK-026",section:"工控安全",type:"PLC本地联锁/操作模式/授权网络",status:"待核查",strategy:"模型只读辅助，不直接启停泵阀或改变排口"},
] as const;
function valid(label:string,x:number,min:number,max:number){
 if(!Number.isFinite(x)||x<min||x>max)throw new Error(label+"必须在"+min+"至"+max+"范围内");
}
export function evaluatePortChain(input:PortChainInput):PortChainResult{
 valid("降雨量",input.rainMm,0,500);valid("汇水面积",input.catchmentM2,1,1e9);
 valid("径流系数",input.runoffCoefficient,0,1);
 valid("污染径流比例",input.pollutedFraction,0,1);
 valid("分析时长",input.hours,1,72);
 if(!Number.isInteger(input.hours))throw new Error("小时必须为整数");
 valid("污染池初始储量",input.pollutedPoolInitialM3,0,1e8);
 valid("污染池有效容积",input.pollutedPoolCapacityM3,1,1e8);
 valid("处理能力",input.treatmentM3h,0,1e7);
 valid("清水池初始储量",input.clearPoolInitialM3,0,1e8);
 valid("清水池有效容积",input.clearPoolCapacityM3,1,1e8);
 valid("码头冲洗假设需求",input.flushDemandM3h,0,1e7);
 valid("回用路径能力",input.transferCapacityM3h,0,1e7);
 if(input.pollutedPoolInitialM3>input.pollutedPoolCapacityM3)throw new Error("污染池初始储量超过有效容积");
 if(input.clearPoolInitialM3>input.clearPoolCapacityM3)throw new Error("清水池初始储量超过有效容积");
 if(!["unknown","assumed_pass","failed"].includes(input.qualityBasis)
    ||!["unknown","assumed_connected","blocked"].includes(input.pipelineBasis)
    ||!["unknown","assumed_connected","blocked"].includes(input.inletBasis))
  throw new Error("水质或管线工程证据状态非法");
 const raw={...input},steps:PortChainStep[]=[];
 const runoff=input.rainMm/1000*input.catchmentM2*input.runoffCoefficient;
 const pollutedTotal=runoff*input.pollutedFraction;
 const pollutedPerHour=pollutedTotal/input.hours;
 let dirty=input.pollutedPoolInitialM3,clean=input.clearPoolInitialM3;
 let processed=0,reused=0,overflowed=0,unmet=0,maxPoolRatio=dirty/input.pollutedPoolCapacityM3,peakHour=0;
 const qualified=input.qualityBasis==="assumed_pass",connected=input.pipelineBasis==="assumed_connected";
 const inletConnected=input.inletBasis==="assumed_connected";
 for(let hour=1;hour<=input.hours;hour++){
  // 严格采用先供已有合格水、再处理污染来水的时间排序；
  // 无水质依据时，绝不能凭处理站铭牌宣称形成合格清水。
  const consumed=qualified&&connected?Math.min(clean,input.flushDemandM3h,input.transferCapacityM3h):0;
  clean-=consumed;
  const treated=qualified&&inletConnected?Math.min(input.treatmentM3h,dirty+pollutedPerHour,
    Math.max(0,input.clearPoolCapacityM3-clean)):0;
  dirty+=pollutedPerHour-treated;
  clean+=treated;
  const overflow=Math.max(0,dirty-input.pollutedPoolCapacityM3);
  dirty=Math.min(input.pollutedPoolCapacityM3,dirty);
  const lack=Math.max(0,input.flushDemandM3h-consumed);
  processed+=treated;reused+=consumed;overflowed+=overflow;unmet+=lack;
  const ratio=dirty/input.pollutedPoolCapacityM3;
  if(ratio>maxPoolRatio){maxPoolRatio=ratio;peakHour=hour;}
  steps.push({
   hour,rainInM3:rnd(runoff/input.hours),pollutedInM3:rnd(pollutedPerHour),
   processedM3:rnd(treated),flushReuseM3:rnd(consumed),unmetDemandM3:rnd(lack),
   poolStorageM3:rnd(dirty),clearStorageM3:rnd(clean),overflowM3:rnd(overflow),
   unapprovedOutflowM3:0,
  });
 }
 const massGap=input.pollutedPoolInitialM3+input.clearPoolInitialM3+pollutedTotal
  -(dirty+clean+reused+overflowed);
 const bottlenecks:PortChainResult["bottlenecks"]=[];
 if(!inletConnected)bottlenecks.push({id:"inlet",title:"污染池至处理站入口管线待核",
  reason:input.inletBasis==="blocked"?"模型设定入站水路不通":"尚无批准入站管段、阀门与泵站资料；停止计算可输送处理量",
  checkIds:["CK-009","CK-011","PT-009"]});
 if(!qualified)bottlenecks.push({id:"quality",title:"处理出水水质不可放行",
  reason:input.qualityBasis==="failed"?"模拟水质未满足条件，停止回用计量":"缺少经批准的水质指标与有效检验结论",
  checkIds:["CK-013","PT-012"]});
 if(!connected)bottlenecks.push({id:"pipe",title:"码头面冲洗路径未证实",
  reason:input.pipelineBasis==="blocked"?"该情景水路不通":"没有已核实管段、阀门和终端用水合同/作业需求",
  checkIds:["CK-014","CK-015","PT-014"]});
 if(overflowed>1e-6)bottlenecks.push({id:"overflow",title:"污染水调蓄容量不足",
  reason:"当前假设下污染池产生不能安全收集的超容水量；不是允许对外排放",
  checkIds:["CK-005","CK-007","CK-008"]});
 if(qualified&&inletConnected&&processed<input.treatmentM3h*input.hours*0.95){
  bottlenecks.push({id:"capacity",title:"处理量受到库存或运行边界约束",
   reason:"处理上限不等于实际合格处理量，清水池空间或来水量可能限制出水",
   checkIds:["CK-012","CK-014"]});
 }
 if(qualified&&connected&&unmet>1e-6)bottlenecks.push({id:"demand",title:"码头面冲洗用水仍有缺口",
  reason:"实际冲洗需求必须结合装卸班次和终端计量，不假定全天连续用水",
  checkIds:["CK-015","PT-014"]});
 return {
  steps,input:raw,totalRunoffM3:rnd(runoff),totalPollutedInM3:rnd(pollutedTotal),
  totalProcessedM3:rnd(processed),totalReusedM3:rnd(reused),totalOverflowM3:rnd(overflowed),
  totalUnmetDemandM3:rnd(unmet),poolFinalM3:rnd(dirty),clearFinalM3:rnd(clean),
  maxPoolRatio:rnd(maxPoolRatio),peakHour,massBalanceGapM3:rnd(massGap),
  basinStatus:overflowed>1e-6?"overflow":maxPoolRatio>=.85?"high":"capacity_adequate",
  bottlenecks,controlReleased:false,realEngineeringVerified:false,
  assumptions:[
   "本页全部数值为独立MOCK情景，不代表51/52号泊位已建或可用库容、实际污水处理能力或雨水归属。",
   "降雨按时段均匀分布、污染径流占比固定；缺少最新汇水分区和初雨切换设计。",
   "本期仅模拟一个假设污染水池和清水池，不将环评、设计或内部报告多种口径的池容相加；也不包含码头冲洗废水的单独入水计算。",
   "处理入口与回用出口是两条不同管线；未选择仅MOCK假设的入站连通时，不能计处理站处理量。",
   "只有选择“仅演示假设水质合格”才允许在模型内部计合格处理量；这不等于真实水质达标。",
   "只有选择“仅演示假设冲洗管线连通”才计算模型回用；未核实的除尘池、人工湖或射雾供水路径全部禁止。",
   "本页任何溢流量都是未被模型收集的风险量，不得转换为合法排水量；永不输出PLC指令。",
  ],
 };
}

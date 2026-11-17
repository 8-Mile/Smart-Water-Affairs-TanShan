/**
 * 同一演示时段的污染水收集—处理—清水池—合格消纳质量守恒。
 * 同时展示大机供水需求缺口，但不预设大机供水与回用水管线连通。
 * 本模型不是管网水力仿真，也不下发控制命令。
 */
export interface IntegratedBalanceInput {
  periodHours:number;
  rainMm:number;
  catchmentAreaM2:number;
  contaminatedRunoffRatio:number;
  pollutedInitialM3:number;
  pollutedCapacityM3:number;
  treatmentM3h:number;
  cleanInitialM3:number;
  cleanCapacityM3:number;
  approvedReuseDemandM3:number;
  reusePumpM3h:number;
  qualityAccepted:boolean;
  reusePathAssumed:boolean;
  machineDemandM3h:number;
  machineAvailableM3h:number;
}
export interface IntegratedBalanceResult {
  pollutedRainInM3:number;
  processedM3:number;
  actualReuseM3:number;
  pollutedEndM3:number;
  cleanEndM3:number;
  pollutionOverflowM3:number;
  physicalBalanceGapM3:number;
  machineDemandM3:number;
  machineDeliveredM3:number;
  machineShortageM3:number;
  risks:string[];
  executable:false;
}
export const DEFAULT_INTEGRATED_BALANCE: IntegratedBalanceInput={
  periodHours:24,rainMm:30,catchmentAreaM2:120000,contaminatedRunoffRatio:0.65,
  pollutedInitialM3:1900,pollutedCapacityM3:8000,treatmentM3h:160,
  cleanInitialM3:1200,cleanCapacityM3:5000,
  approvedReuseDemandM3:2100,reusePumpM3h:115,
  qualityAccepted:true,reusePathAssumed:true,
  machineDemandM3h:56,machineAvailableM3h:80,
};
function finite(name:string,n:number,max=10000000):void {
  if(!Number.isFinite(n)||n<0||n>max)throw Error(name+"范围错误（MOCK输入必须为非负有限数）");
}
const round=(n:number)=>Math.round((n+Number.EPSILON)*1e6)/1e6;
export function assessIntegratedBalance(input:IntegratedBalanceInput):IntegratedBalanceResult{
  for(const [name,value] of Object.entries(input)){
    if(typeof value==="number")finite(name,value);
  }
  if(input.periodHours===0||input.periodHours>168)throw Error("分析时段需在1～168小时");
  if(input.contaminatedRunoffRatio>1)throw Error("污染径流比例需在0～1");
  if(input.pollutedInitialM3>input.pollutedCapacityM3||input.cleanInitialM3>input.cleanCapacityM3)throw Error("初始储量不能超过池容");
  const rainIn=input.rainMm/1000*input.catchmentAreaM2*input.contaminatedRunoffRatio;
  const availablePolluted=input.pollutedInitialM3+rainIn;
  const eligibleReuse=(input.qualityAccepted&&input.reusePathAssumed)
    ?Math.min(input.approvedReuseDemandM3,input.reusePumpM3h*input.periodHours):0;
  // 确保合格出水有清水池空间或在时段内可经许可回用
  const treated=Math.min(availablePolluted,input.treatmentM3h*input.periodHours,
    input.cleanCapacityM3-input.cleanInitialM3+eligibleReuse);
  const reuse=Math.min(input.cleanInitialM3+treated,eligibleReuse);
  const rawPollutedEnd=availablePolluted-treated;
  const overflow=Math.max(0,rawPollutedEnd-input.pollutedCapacityM3);
  const pollutedEnd=rawPollutedEnd-overflow;
  const cleanEnd=input.cleanInitialM3+treated-reuse;
  const machineDemand=input.machineDemandM3h*input.periodHours;
  const machineDelivered=Math.min(machineDemand,input.machineAvailableM3h*input.periodHours);
  const machineShortage=machineDemand-machineDelivered;
  const gap=(input.pollutedInitialM3+input.cleanInitialM3+rainIn)-(pollutedEnd+cleanEnd+reuse+overflow);
  const risks:string[]=[];
  if(overflow>0.001)risks.push("污染水暂存超出假设池容，溢出部分仅为风险量，不代表允许排放");
  if(machineShortage>0.001)risks.push("大机末端模拟供水存在缺口，尚未核验压力与管网");
  if(!input.qualityAccepted)risks.push("出水水质未满足回用前提，禁止计入合格回用");
  if(!input.reusePathAssumed)risks.push("回用路径模拟设为不可达，无法形成末端回用");
  if(!risks.length)risks.push("仅模拟守恒成立；工艺管网、水质与现场能力未核实");
  return {
    pollutedRainInM3:round(rainIn),processedM3:round(treated),actualReuseM3:round(reuse),
    pollutedEndM3:round(pollutedEnd),cleanEndM3:round(cleanEnd),
    pollutionOverflowM3:round(overflow),physicalBalanceGapM3:round(gap),
    machineDemandM3:round(machineDemand),machineDeliveredM3:round(machineDelivered),
    machineShortageM3:round(machineShortage),risks,executable:false,
  };
}

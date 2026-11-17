/**
 * 大机抑尘/冲洗供水需求演示模型。
 * 大机编号、需求、供水能力均为MOCK，不代表港口真实机位和水力网络。
 */
export type MachineScenarioId = "single" | "parallel" | "limited";
export interface MachineTerminal {
  id: string;
  name: string;
  waterPurpose: string;
  active: boolean;
  demandM3h: number;
  priority: 1 | 2 | 3;
  pipelineVerified: boolean;
}
export interface MachineSupplyInput {
  periodHours: number;
  capacityM3h: number;
  reservedM3h: number;
  terminals: MachineTerminal[];
}
export interface TerminalAssessment extends MachineTerminal {
  allocatedM3h: number;
  shortageM3h: number;
}
export interface MachineSupplyAssessment {
  demandedM3h: number;
  availableM3h: number;
  allocatedM3h: number;
  shortageM3h: number;
  terminals: TerminalAssessment[];
  fullySatisfied: boolean;
  hydraulicVerified: false;
}
const baseTerminals: MachineTerminal[] = [
  {id:"M-A",name:"大机 A · 卸船抑尘点（演示）",waterPurpose:"卸船作业抑尘",active:true,demandM3h:34,priority:1,pipelineVerified:false},
  {id:"M-B",name:"大机 B · 卸船抑尘点（演示）",waterPurpose:"卸船作业抑尘",active:false,demandM3h:38,priority:1,pipelineVerified:false},
  {id:"M-C",name:"转运点 C · 末端抑尘（演示）",waterPurpose:"转运作业抑尘",active:true,demandM3h:22,priority:2,pipelineVerified:false},
];
export function createMachineSupplyScenario(id:MachineScenarioId="single"):MachineSupplyInput {
  const terminals=baseTerminals.map(x=>({...x}));
  const scenario:MachineSupplyInput={periodHours:24,capacityM3h:90,reservedM3h:10,terminals};
  if(id==="parallel")terminals[1].active=true;
  if(id==="limited"){terminals[1].active=true;scenario.capacityM3h=55;}
  return scenario;
}
function finite(label:string,value:number,max=100000):void {
  if(!Number.isFinite(value)||value<0||value>max)throw Error(label+"必须是0到"+max+"之间的有限数值");
}
export function evaluateMachineSupply(input:MachineSupplyInput):MachineSupplyAssessment{
  finite("时段",input.periodHours,168);
  if(input.periodHours<=0)throw Error("时段必须大于0");
  finite("供水能力",input.capacityM3h);
  finite("安全预留量",input.reservedM3h);
  if(input.reservedM3h>input.capacityM3h)throw Error("安全预留量不得大于供水能力");
  const seen=new Set<string>();
  for(const terminal of input.terminals){
    if(seen.has(terminal.id))throw Error("重复用水点编号");
    seen.add(terminal.id);
    finite("终端需求",terminal.demandM3h);
    if(![1,2,3].includes(terminal.priority))throw Error("优先级必须为1到3");
  }
  let remaining=input.capacityM3h-input.reservedM3h;
  const assessed=new Map<string,TerminalAssessment>();
  const sorted=[...input.terminals].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
  for(const terminal of sorted){
    const demand=terminal.active?terminal.demandM3h:0;
    const allocated=Math.min(demand,remaining);
    remaining-=allocated;
    assessed.set(terminal.id,{...terminal,allocatedM3h:allocated,shortageM3h:demand-allocated});
  }
  const terminals=input.terminals.map(x=>assessed.get(x.id)!);
  const demandedM3h=terminals.reduce((v,x)=>v+(x.active?x.demandM3h:0),0);
  const allocatedM3h=terminals.reduce((v,x)=>v+x.allocatedM3h,0);
  const shortageM3h=Math.max(0,demandedM3h-allocatedM3h);
  return {demandedM3h,availableM3h:input.capacityM3h-input.reservedM3h,allocatedM3h,
    shortageM3h,terminals,fullySatisfied:shortageM3h<1e-7,hydraulicVerified:false};
}

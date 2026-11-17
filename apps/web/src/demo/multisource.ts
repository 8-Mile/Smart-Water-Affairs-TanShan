/**
 * 多水源供需匹配 V1。全部数据均为MOCK / 人工假设。
 * 仅作单时段“独立库存 → 已验证水质与管网路径 → 用水需求”分配；
 * 不将雨水处理为中水，也不将水量账本的雨水/中水统计直接相加。
 * 优先保障关键用水，随后各级用水按可行路径做最小增量成本分配。
 */
export type WaterSourceId = "rain" | "reclaimed" | "tap";
export type WaterUseId = "critical" | "spray" | "cleaning";
export type DemandPriority = 1 | 2 | 3; // 1最高

export interface WaterSourcePlan {
  id: WaterSourceId;
  label: string;
  availableM3: number;
  deliverableM3: number;
  unitCostYuanM3: number;
  provenance: string;
}
export interface WaterDemandPlan {
  id: WaterUseId;
  label: string;
  neededM3: number;
  priority: DemandPriority;
}
export interface WaterRoutePlan {
  sourceId: WaterSourceId;
  useId: WaterUseId;
  /** 水质满足该用途：需与相应工程水质要求核验，非简单等级高低 */
  qualityAccepted: boolean;
  /** 已确认这条源→用水点物理管网可达 */
  connected: boolean;
  /** 时段内这条供水路径最大可供量 */
  limitM3: number;
}
export interface MultiSourceInputs {
  periodHours: number;
  /** 两种可回用水源可用库存是否明确分开核实；未核实则不参与可信优化 */
  separateStockConfirmed: boolean;
  sources: WaterSourcePlan[];
  demands: WaterDemandPlan[];
  routes: WaterRoutePlan[];
}
export interface WaterAllocation {
  sourceId: WaterSourceId;
  useId: WaterUseId;
  sourceLabel: string;
  useLabel: string;
  volumeM3: number;
  unitCostYuanM3: number;
  totalCostYuan: number;
}
export interface WaterUseResult {
  id: WaterUseId;
  label: string;
  priority: DemandPriority;
  neededM3: number;
  suppliedM3: number;
  unmetM3: number;
  allocations: WaterAllocation[];
}
export interface SourceUsageResult {
  id: WaterSourceId;
  label: string;
  availableM3: number;
  limitM3: number;
  usedM3: number;
  remainingM3: number;
}
export interface WaterSupplyResult {
  inputs: MultiSourceInputs;
  requestedM3: number;
  suppliedM3: number;
  unmetM3: number;
  feasible: boolean;
  totalCostYuan: number;
  /** 同等需求量全部由自来水供应的已验证可行比较情景，否则null */
  allTapBaselineYuan: number | null;
  savingVsTapYuan: number | null;
  costSavingPercent: number | null;
  tapAvoidedM3: number | null;
  nonTapSuppliedM3: number;
  sources: SourceUsageResult[];
  uses: WaterUseResult[];
  allocations: WaterAllocation[];
  checks: string[];
  warnings: string[];
}

const sourceOrder: WaterSourceId[] = ["rain", "reclaimed", "tap"];
const useOrder: WaterUseId[] = ["critical", "spray", "cleaning"];
const EPS = 1e-7;
const round = (n: number): number => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const maxVolume = 1_000_000;

export const DEFAULT_MULTI_SOURCE: MultiSourceInputs = {
  periodHours: 24,
  separateStockConfirmed: true,
  sources: [
    { id: "rain", label: "雨水（演示独立可用量）", availableM3: 700, deliverableM3: 650, unitCostYuanM3: 0.40, provenance: "假设单独存储且满足直供用途的已处理雨水" },
    { id: "reclaimed", label: "中水（演示独立可用量）", availableM3: 800, deliverableM3: 700, unitCostYuanM3: 1.00, provenance: "假设已处理合格、另池存储的中水；不与本期雨水库存重计" },
    { id: "tap", label: "自来水", availableM3: 2000, deliverableM3: 2000, unitCostYuanM3: 3.60, provenance: "外购补水的演示供应上限" },
  ],
  demands: [
    { id: "critical", label: "关键生产补水", neededM3: 450, priority: 1 },
    { id: "spray", label: "射雾除尘", neededM3: 850, priority: 2 },
    { id: "cleaning", label: "场地冲洗", neededM3: 400, priority: 3 },
  ],
  routes: [
    { sourceId:"rain", useId:"critical", qualityAccepted:false, connected:false, limitM3:0 },
    { sourceId:"reclaimed", useId:"critical", qualityAccepted:false, connected:false, limitM3:0 },
    { sourceId:"tap", useId:"critical", qualityAccepted:true, connected:true, limitM3:500 },
    { sourceId:"rain", useId:"spray", qualityAccepted:true, connected:true, limitM3:650 },
    { sourceId:"reclaimed", useId:"spray", qualityAccepted:true, connected:true, limitM3:700 },
    { sourceId:"tap", useId:"spray", qualityAccepted:true, connected:true, limitM3:900 },
    { sourceId:"rain", useId:"cleaning", qualityAccepted:true, connected:true, limitM3:200 },
    { sourceId:"reclaimed", useId:"cleaning", qualityAccepted:true, connected:true, limitM3:400 },
    { sourceId:"tap", useId:"cleaning", qualityAccepted:true, connected:true, limitM3:500 },
  ],
};

export function cloneMultiSource(input: MultiSourceInputs = DEFAULT_MULTI_SOURCE): MultiSourceInputs {
  return {
    periodHours: input.periodHours,
    separateStockConfirmed: input.separateStockConfirmed,
    sources: input.sources.map(x => ({...x})),
    demands: input.demands.map(x => ({...x})),
    routes: input.routes.map(x => ({...x})),
  };
}
function bounded(label: string, value: number, max = maxVolume): void {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label}必须为0至${max}之间的有效数值`);
}
function validate(input: MultiSourceInputs): void {
  if (!Number.isInteger(input.periodHours) || input.periodHours < 1 || input.periodHours > 720) {
    throw new Error("统计时段必须为1至720的整数小时");
  }
  if (typeof input.separateStockConfirmed !== "boolean") throw new Error("库存分开核实状态无效");
  if (input.sources.length !== 3 || input.demands.length !== 3 || input.routes.length !== 9) {
    throw new Error("水源、需求和管网矩阵不完整，不能计算");
  }
  for (const id of sourceOrder) if (input.sources.filter(x => x.id === id).length !== 1) throw new Error("水源配置重复或缺失");
  for (const id of useOrder) if (input.demands.filter(x => x.id === id).length !== 1) throw new Error("用水需求配置重复或缺失");
  for (const source of input.sources) {
    bounded(source.label + "可用库存", source.availableM3);
    bounded(source.label + "供水能力", source.deliverableM3);
    bounded(source.label + "单位成本", source.unitCostYuanM3, 1000);
  }
  for (const use of input.demands) {
    bounded(use.label + "用水需求", use.neededM3);
    if (![1,2,3].includes(use.priority)) throw new Error("用水优先级配置无效");
  }
  for (const sid of sourceOrder) for (const uid of useOrder) {
    const routes = input.routes.filter(x => x.sourceId === sid && x.useId === uid);
    if (routes.length !== 1) throw new Error("源-用水点路径配置缺失或重复");
    const route = routes[0];
    bounded("路径供水上限", route.limitM3);
    if (typeof route.qualityAccepted !== "boolean" || typeof route.connected !== "boolean") {
      throw new Error("路径水质或连通状态非法");
    }
  }
}

interface Edge { to:number; rev:number; capacity:number; cost:number; initialCapacity:number }
type Graph = Edge[][];
function addEdge(graph:Graph, from:number, to:number, capacity:number, cost:number): Edge {
  const fwd:Edge={to,rev:graph[to].length,capacity,cost,initialCapacity:capacity};
  const rev:Edge={to:from,rev:graph[from].length,capacity:0,cost:-cost,initialCapacity:0};
  graph[from].push(fwd);
  graph[to].push(rev);
  return fwd;
}
/**
 * 每个优先级独立执行最小费用最大流。前一优先级占用的供水容量不可被低优先级挤占。
 * 不是跨工况的多时段调度，也不宣称全生命周期经济最优。
 */
function minimumCostFlow(
  sources: WaterSourcePlan[], demands: WaterDemandPlan[], routes: WaterRoutePlan[],
  remainingSupply: Map<WaterSourceId,number>, remainingRoute: Map<string,number>,
  allocations: Map<string, number>,
): void {
  const relevant=demands.filter(d=>d.neededM3>EPS);
  if (!relevant.length) return;
  const N=2+sources.length+relevant.length, START=0, END=N-1, graph:Graph=Array.from({length:N},()=>[]);
  const sourceIndex=new Map(sources.map((s,i)=>[s.id,1+i]));
  const demandIndex=new Map(relevant.map((u,i)=>[u.id,1+sources.length+i]));
  for(const s of sources) addEdge(graph,START,sourceIndex.get(s.id)!,Math.max(0,remainingSupply.get(s.id)??0),0);
  for(const demand of relevant) addEdge(graph,demandIndex.get(demand.id)!,END,demand.neededM3,0);
  const refs: { key:string; edge:Edge }[]=[];
  for(const route of routes){
    if(!route.connected || !route.qualityAccepted) continue;
    const from=sourceIndex.get(route.sourceId),to=demandIndex.get(route.useId);
    if(from===undefined || to===undefined) continue;
    const cap=remainingRoute.get(route.sourceId+":"+route.useId)??0;
    if(cap <= EPS) continue;
    const s=sources.find(x=>x.id===route.sourceId)!;
    refs.push({key:route.sourceId+":"+route.useId,edge:addEdge(graph,from,to,cap,s.unitCostYuanM3)});
  }
  // 残量网络中的反向边是负成本，用Bellman-Ford求真实最短路。
  // 每次增广可能通过反向边重新路由同一优先级流量，以获得更低费用。
  const maxAugment=1000;
  for(let loop=0;loop<maxAugment;loop++){
    const dist=Array<number>(N).fill(Infinity),prevV=Array<number>(N).fill(-1),prevE=Array<number>(N).fill(-1);
    dist[START]=0;
    for(let pass=0;pass<N-1;pass++){
      let changed=false;
      for(let v=0;v<N;v++){
        if(!Number.isFinite(dist[v])) continue;
        for(let ei=0;ei<graph[v].length;ei++){
          const e=graph[v][ei]; if(e.capacity<=EPS)continue;
          if(dist[e.to]>dist[v]+e.cost+1e-8){
            dist[e.to]=dist[v]+e.cost;prevV[e.to]=v;prevE[e.to]=ei;changed=true;
          }
        }
      }
      if(!changed)break;
    }
    if(prevV[END]===-1)break;
    let flow=Infinity,at=END,guard=0;
    while(at!==START){
      if(++guard>N) throw new Error("供水分配路径出现异常循环");
      const v=prevV[at],ei=prevE[at];if(v<0||ei<0)throw new Error("无法回溯供水路径");
      flow=Math.min(flow,graph[v][ei].capacity);at=v;
    }
    if(!Number.isFinite(flow)||flow<=EPS)break;
    at=END;
    while(at!==START){
      const v=prevV[at],e=graph[v][prevE[at]];
      e.capacity-=flow;graph[at][e.rev].capacity+=flow;at=v;
    }
  }
  // 路径的净流量有可能因反向增广重新分配；以最终网络实际流量作准。
  for(const {key,edge} of refs){
    const used=edge.initialCapacity-edge.capacity;
    if(used<=EPS)continue;
    const [sid]=key.split(":");
    allocations.set(key,(allocations.get(key)??0)+used);
    remainingSupply.set(sid as WaterSourceId,Math.max(0,(remainingSupply.get(sid as WaterSourceId)??0)-used));
    remainingRoute.set(key,Math.max(0,(remainingRoute.get(key)??0)-used));
  }
}

function calculate(input:MultiSourceInputs,onlyTap=false):WaterSupplyResult {
  const sources=input.sources.filter(s=>!onlyTap || s.id==="tap");
  const sourceById=new Map(input.sources.map(s=>[s.id,s]));
  const initialCap=new Map<WaterSourceId,number>();
  for(const s of sources){
    initialCap.set(s.id, s.id!=="tap"&&!input.separateStockConfirmed ? 0 : Math.min(s.availableM3,s.deliverableM3));
  }
  const capacity=new Map(initialCap);
  const remainRoutes=new Map(input.routes.map(r=>[r.sourceId+":"+r.useId,r.limitM3]));
  const allocated=new Map<string,number>();
  for(const priority of [1,2,3] as const){
    minimumCostFlow(sources,input.demands.filter(u=>u.priority===priority),input.routes,capacity,remainRoutes,allocated);
  }
  const allocations:WaterAllocation[]=[];
  for(const [key,v] of allocated){
    if(v<=EPS)continue;
    const [sid,uid]=key.split(":") as [WaterSourceId,WaterUseId];
    const source=sourceById.get(sid)!;const dest=input.demands.find(x=>x.id===uid)!;
    allocations.push({
      sourceId:sid,useId:uid,sourceLabel:source.label,useLabel:dest.label,
      volumeM3:round(v),unitCostYuanM3:source.unitCostYuanM3,totalCostYuan:round(v*source.unitCostYuanM3),
    });
  }
  allocations.sort((a,b)=>useOrder.indexOf(a.useId)-useOrder.indexOf(b.useId)||sourceOrder.indexOf(a.sourceId)-sourceOrder.indexOf(b.sourceId));
  const uses:WaterUseResult[]=input.demands.map(u=>{
    const volume=[...allocated.entries()].filter(([key])=>key.endsWith(":"+u.id)).reduce((sum,[,v])=>sum+v,0);
    return {id:u.id,label:u.label,priority:u.priority,neededM3:u.neededM3,
      suppliedM3:round(volume),unmetM3:round(Math.max(0,u.neededM3-volume)),
      allocations:allocations.filter(x=>x.useId===u.id)};
  });
  const sourceResults:SourceUsageResult[]=input.sources.map(s=>{
    const total=[...allocated.entries()].filter(([key])=>key.startsWith(s.id+":")).reduce((sum,[,v])=>sum+v,0);
    const limit= s.id!=="tap"&&!input.separateStockConfirmed?0:Math.min(s.availableM3,s.deliverableM3);
    return {id:s.id,label:s.label,availableM3:s.availableM3,limitM3:round(limit),usedM3:round(total),remainingM3:round(Math.max(0,limit-total))};
  });
  const requested=input.demands.reduce((sum,x)=>sum+x.neededM3,0);
  const supplied=[...allocated.values()].reduce((a,b)=>a+b,0);
  const totalCost=[...allocated.entries()].reduce((sum,[key,v])=>sum+v*sourceById.get(key.split(":")[0] as WaterSourceId)!.unitCostYuanM3,0);
  const tapSupplied=[...allocated.entries()].filter(([key])=>key.startsWith("tap:")).reduce((sum,[,v])=>sum+v,0);
  return {
    inputs:cloneMultiSource(input),
    requestedM3:round(requested),suppliedM3:round(supplied),unmetM3:round(Math.max(0,requested-supplied)),
    feasible:requested-supplied<EPS,totalCostYuan:round(totalCost),
    allTapBaselineYuan:null,savingVsTapYuan:null,costSavingPercent:null,tapAvoidedM3:null,
    nonTapSuppliedM3:round(supplied-tapSupplied),
    sources:sourceResults,uses,allocations,
    checks:[],warnings:[],
  };
}

export function evaluateMultiSource(input:MultiSourceInputs):WaterSupplyResult {
  validate(input);
  const result=calculate(input);
  const baseline=calculate(input,true);
  if(baseline.feasible){
    result.allTapBaselineYuan=baseline.totalCostYuan;
    if(result.feasible){
      result.savingVsTapYuan=round(baseline.totalCostYuan-result.totalCostYuan);
      result.costSavingPercent=baseline.totalCostYuan>EPS?round(result.savingVsTapYuan/baseline.totalCostYuan*100):null;
      result.tapAvoidedM3=round(result.requestedM3-result.sources.find(s=>s.id==="tap")!.usedM3);
    }
  }
  result.checks=[
    "源端可用库存与时段供水能力分别限制，各路供水路径有独立上限",
    "每条供水路径须同时满足具体用途水质和物理管网连通条件",
    "关键生产用水优先于除尘与冲洗；各级按可行路径成本最小化",
    "雨水、中水必须属于不同的当前可用库存，不将同一笔雨水处理量重复记作两份水",
    "全自来水比较仅在自来水供水能力和各路径可满足全部需求时计算",
  ];
  result.warnings=[
    "MOCK演示：库存、成本、水质合规、管网路径和设备能力均为人工假设，非现场事实",
    "单位成本假设应包含对应处理和能耗，尚未核算水质检测、固定资产、税费及环保外部成本",
    "本期不模拟雨水处理转中水、处理损耗及多时段库容更新；水量账本不可直接代入作同一期独立库存",
  ];
  if(!input.separateStockConfirmed)result.warnings.push("雨水与中水独立库存未核实：非自来水来源已禁用，不能据原水与中水账本推断可供量");
  if(!result.feasible)result.warnings.push("本时段存在未满足供水需求，请优先执行供水保障预案；不得宣称方案可落地");
  if(!baseline.feasible)result.warnings.push("全自来水基准不满足已配置水量或管网能力，节约金额及替代量不提供比较结论");
  for(const use of result.uses.filter(x=>x.unmetM3>EPS)){
    result.warnings.push(`${use.label}未满足${use.unmetM3}m³（优先级${use.priority}），需工程核实`);
  }
  return result;
}

/**
 * View-only orthogonal CAD functional-flow router.
 * Routes around the design facility bounding boxes, never asserting pipe
 * geometry or endpoint accuracy. Editing/moving nodes automatically reroutes.
 * Fog's established geometry is intentionally not modified.
 */
import type {ProcessDiagramConnection,ProcessDiagramDocument,ProcessDiagramNode} from '@/api/tanggangProcessDiagrams'

export type FlowPoint={x:number;y:number}
export interface FlowRoute{path:string;points:FlowPoint[];label:FlowPoint}
type Rect={left:number;right:number;top:number;bottom:number}
const PAD=14
const round=(n:number)=>Math.round(n)
const rect=(n:ProcessDiagramNode):Rect=>({
  left:n.position.x-PAD,right:n.position.x+n.size.width+PAD,
  top:n.position.y-PAD,bottom:n.position.y+n.size.height+PAD,
})
function segmentHits(a:FlowPoint,b:FlowPoint,r:Rect):boolean{
  if(a.x===b.x)
    return a.x>r.left&&a.x<r.right&&
      Math.max(a.y,b.y)>r.top&&Math.min(a.y,b.y)<r.bottom
  return a.y>r.top&&a.y<r.bottom&&
    Math.max(a.x,b.x)>r.left&&Math.min(a.x,b.x)<r.right
}
function length(points:FlowPoint[]){
  return points.slice(1).reduce((sum,p,i)=>
    sum+Math.abs(p.x-points[i]!.x)+Math.abs(p.y-points[i]!.y),0)
}
function clean(points:FlowPoint[]):FlowPoint[]{
  const result:FlowPoint[]=[]
  for(const p of points){
    if(result.length&&p.x===result[result.length-1]!.x&&
      p.y===result[result.length-1]!.y)continue
    result.push(p)
    while(result.length>=3){
      const [a,b,c]=result.slice(-3) as [FlowPoint,FlowPoint,FlowPoint]
      if((a.x===b.x&&b.x===c.x)||(a.y===b.y&&b.y===c.y))
        result.splice(-2,1)
      else break
    }
  }
  return result
}
function labelAlong(points:FlowPoint[]):FlowPoint{
  if(points.length<2)return points[0]||{x:0,y:0}
  // At the 50% travelled point, not merely between equipment centers.
  const target=length(points)*.5
  let running=0
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!
    const step=Math.abs(a.x-b.x)+Math.abs(a.y-b.y)
    if(running+step>=target){
      const frac=step?(target-running)/step:0
      return {x:round(a.x+(b.x-a.x)*frac),y:round(a.y+(b.y-a.y)*frac)-10}
    }
    running+=step
  }
  return points[points.length-1]!
}
function port(n:ProcessDiagramNode,other:ProcessDiagramNode,out:boolean):FlowPoint{
  const cx=n.position.x+n.size.width/2
  const ox=other.position.x+other.size.width/2
  if(Math.abs(ox-cx)<65){
    return {x:round(cx),y:round(n.position.y+
      (other.position.y>n.position.y?n.size.height:0))}
  }
  // Both ports are at the equipment boundary, never at the center.
  const toRight=ox>=cx
  return {x:round(n.position.x+(toRight?n.size.width:0)),
    y:round(n.position.y+n.size.height/2)}
}
function svgPath(points:FlowPoint[]):string{
  return points.map((p,i)=>{
    if(!i)return 'M'+round(p.x)+','+round(p.y)
    const prev=points[i-1]!
    return p.y===prev.y?'H'+round(p.x):'V'+round(p.y)
  }).join(' ')
}
export function calculateProcessFlowRoute(
  line:ProcessDiagramConnection,diagram:ProcessDiagramDocument,
):FlowRoute{
  const from=diagram.nodes.find(n=>n.id===line.source_node_id)
  const to=diagram.nodes.find(n=>n.id===line.target_node_id)
  if(!from||!to)return {path:'',points:[],label:{x:0,y:0}}
  const source=port(from,to,true)
  const target=port(to,from,false)
  const direction=target.x>=source.x?1:-1
  const obstacles=diagram.nodes.filter(n=>
    n.id!==from.id&&n.id!==to.id&&n.visible!==false).map(rect)
  const width=diagram.view_box.width,height=diagram.view_box.height
  const xs=new Set<number>([
    round((source.x+target.x)/2),source.x+direction*25,target.x-direction*25,
    ...obstacles.flatMap(r=>[round(r.left-8),round(r.right+8)]),
  ])
  const ys=new Set<number>([
    round((source.y+target.y)/2),source.y,target.y,
    ...obstacles.flatMap(r=>[round(r.top-8),round(r.bottom+8)]),
  ])
  const all:FlowPoint[][]=[]
  const add=(pts:FlowPoint[])=>{
    const cleaned=clean(pts)
    if(cleaned.every(p=>p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height))
      all.push(cleaned)
  }
  add([source,{x:target.x,y:source.y},target])
  add([source,{x:source.x,y:target.y},target])
  for(const x of xs){
    add([source,{x,y:source.y},{x,y:target.y},target])
  }
  for(const y of ys){
    add([source,{x:source.x,y},{x:target.x,y},target])
    for(const x of xs){
      add([source,{x,y:source.y},{x,y},{x:target.x,y},target])
      add([source,{x:source.x,y},{x,y},{x,y:target.y},target])
    }
  }
  // Prioritize obstacle-free routes. Tie-break: short, few bends, stable order.
  let winner:FlowPoint[]=all[0]||[source,target]
  let best=Infinity
  for(const candidate of all){
    const blocked=candidate.slice(1).reduce((sum,p,i)=>
      sum+obstacles.filter(rectangle=>
        segmentHits(candidate[i]!,p,rectangle)).length,0)
    const backtracks=candidate.slice(1).filter((p,i)=>
      Math.abs(p.x-candidate[i]!.x)>0&&
      Math.sign(p.x-candidate[i]!.x)!==direction).length
    const score=blocked*100000+backtracks*175+
      length(candidate)+(candidate.length-2)*45
    if(score<best){best=score;winner=candidate}
  }
  return {path:svgPath(winner),points:winner,label:labelAlong(winner)}
}

export function routeHitsUnrelatedNodes(
  route:FlowRoute,line:ProcessDiagramConnection,diagram:ProcessDiagramDocument,
):string[]{
  return diagram.nodes.filter(n=>
    n.id!==line.source_node_id&&n.id!==line.target_node_id&&
    route.points.slice(1).some((p,i)=>
      segmentHits(route.points[i]!,p,rect(n)))).map(n=>n.id)
}

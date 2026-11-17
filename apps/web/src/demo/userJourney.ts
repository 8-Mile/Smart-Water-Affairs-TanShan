/** DEMO 业务上下文：保留同一浏览器标签内的试算输入，不写入生产业务数据。 */
export const FLOW_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
interface SavedDraft<T> { version: 1; at: number; data: T }
type StorageRead = Pick<Storage,"getItem">;
type StorageWrite = Pick<Storage,"setItem">;
export function readFlowDraft<T>(
 storage:StorageRead,key:string,guard:(value:unknown)=>value is T,now=Date.now()
):T|null {
 try {
  const text=storage.getItem("tg-v42-flow:"+key);
  if(!text)return null;
  const parsed=JSON.parse(text) as SavedDraft<unknown>;
  if(parsed.version!==1||typeof parsed.at!=="number"||parsed.at>now||now-parsed.at>FLOW_DRAFT_TTL_MS)return null;
  return guard(parsed.data)?parsed.data:null;
 }catch{return null;}
}
export function saveFlowDraft<T>(storage:StorageWrite,key:string,data:T,now=Date.now()):void {
 try {storage.setItem("tg-v42-flow:"+key,JSON.stringify({version:1,at:now,data}));}
 catch { /* 容量或隐私模式禁用时，保持当前页面操作可用。 */ }
}
const RETURN_ROUTES=new Set([
 "/overview","/operations/events","/operations/alarms","/operations/workorders",
 "/operations/assets","/operations/asset-workspace",
 "/water/overview","/water/ledger","/water/rainfall","/water/port-chain",
 "/water/machine-supply","/water/balance","/water/dispatch","/water/multi-source",
 "/water/green-benefit","/decision/health","/data/reports","/data/ai-workspace",
 "/engineering/registry","/decision/four-pre",
]);
const PROCESS_PATHS=new Set(["spray","medium-pressure","mining","rainwater","pool","domestic"]);
export function safeReturnPath(value:unknown,currentPath:string):string|null{
 if(typeof value!=="string"||value.length>1200||!value.startsWith("/")||value.startsWith("//")||
   /[\\\u0000-\u001f]/.test(value))return null;
 const bare=value.split(/[?#]/,1)[0];
 if(bare===currentPath)return null;
 if(RETURN_ROUTES.has(bare))return value;
 if(bare.startsWith("/process/")&&PROCESS_PATHS.has(bare.slice("/process/".length)))return value;
 return null;
}

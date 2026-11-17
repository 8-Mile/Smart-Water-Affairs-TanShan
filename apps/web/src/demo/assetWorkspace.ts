import type {Alarm,InspectionRecord,WorkOrder} from "./types";

export type InspectionCheck = InspectionRecord["items"][number];

export function nextInspectionId(records:readonly Pick<InspectionRecord,"id">[]):string{
 const max=records.reduce((n,record)=>{
  const match=/^INS-USER-(\d+)$/.exec(record.id);
  return match ? Math.max(n,Number(match[1])) : n;
 },0);
 return "INS-USER-"+String(max+1).padStart(3,"0");
}

/** No implicit "normal" on incomplete inspection inputs. */
export function validateInspection(
 assetId:string,inspectedAt:string,items:readonly InspectionCheck[],
 note:string,
):Pick<InspectionRecord,"assetId"|"inspectedAt"|"items"|"result"|"note"> {
 if(!assetId.trim())throw new Error("缺少有效设备，不能保存巡检。");
 const time=Date.parse(inspectedAt);
 if(!Number.isFinite(time))throw new Error("巡检时间无效。");
 if(!items.length)throw new Error("请至少填写一个检查项。");
 const cleaned=items.map(item=>({
  label:item.label.trim(),value:item.value.trim(),abnormal:item.abnormal===true,
 }));
 if(cleaned.some(x=>!x.label||!x.value))throw new Error("检查项和检查结果不能为空。");
 return {
  assetId,inspectedAt:new Date(time).toISOString(),items:cleaned,
  result:cleaned.some(x=>x.abnormal)?"abnormal":"normal",
  ...(note.trim()?{note:note.trim()}:{}),
 };
}

/** A linked alarm, including a missing historical order, must not create a new order silently. */
export function alarmOrder(
 alarm:Pick<Alarm,"id"|"workOrderId">,
 orders:readonly Pick<WorkOrder,"id"|"alarmId">[],
):{id:string|null;exists:boolean;orphaned:boolean} {
 const byAlarm=orders.find(o=>o.alarmId===alarm.id);
 const id=alarm.workOrderId??byAlarm?.id??null;
 return {id,exists:!!id&&orders.some(o=>o.id===id),orphaned:!!id&&!orders.some(o=>o.id===id)};
}

/** A recorded abnormal inspection can create at most one user-initiated linked draft. */
export function inspectionOrder(
 inspectionId:string,
 orders:readonly Pick<WorkOrder,"id"|"source"|"evidenceIds">[],
):string|null {
 return orders.find(order=>order.source==="inspection"&&order.evidenceIds.includes(inspectionId))?.id??null;
}

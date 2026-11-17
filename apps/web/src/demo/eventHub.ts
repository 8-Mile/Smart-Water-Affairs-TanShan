/**
 * Unified, read-only event index. It NEVER merges source records or changes statuses:
 * an alarm and a patrol event on the same asset remain two distinct evidence records.
 * Business actions go through the existing authorized source workflows.
 */
import type {Alarm, Asset, WorkOrder} from "./types";
import type {DutyEvent} from "./unattended";
import {alarmStatusLabels} from "./workorderMeta";
import {EVENT_STATUS_NAMES, eventActive} from "./unattended";

export type EventOrigin="alarm"|"duty";
export type EventHubFilter="open"|"all"|"closed";
export interface HubEvent {
  ref:string;
  origin:EventOrigin;
  originalId:string;
  sourceName:string;
  assetId:string;
  assetLabel:string;
  subsystemId:string;
  title:string;
  description:string;
  at:string;
  active:boolean;
  severity:"critical"|"warning"|"info";
  status:string;
  statusLabel:string;
  workOrderId?:string;
  workOrderCode?:string;
  pointId?:string;
  isMissingWorkOrder:boolean;
}
export interface HubSummary {
  events:HubEvent[];
  open:number;
  alarms:number;
  duty:number;
  critical:number;
  hasOrder:number;
  assetCount:number;
}
export function buildEventHub(
 alarms:readonly Alarm[],
 dutyEvents:readonly DutyEvent[],
 assets:readonly Pick<Asset,"id"|"code"|"name">[],
 orders:readonly Pick<WorkOrder,"id"|"code">[],
):HubSummary {
 const assetName=(id:string)=> {
  const a=assets.find(x=>x.id===id);
  return a ? a.code+" · "+a.name : "资产待核实："+id;
 };
 const workOrderCode=(id?:string)=>orders.find(x=>x.id===id)?.code;
 const mappedAlarms:HubEvent[]=alarms.map(a=>({
  ref:"alarm:"+a.id,origin:"alarm",originalId:a.id,
  sourceName:a.kind==="production"?"生产告警":"业务提醒",
  assetId:a.assetId,assetLabel:assetName(a.assetId),
  subsystemId:a.subsystemId,title:a.title,description:a.detail,at:a.occurredAt,
  active:a.status!=="closed",severity:a.level,status:a.status,
  statusLabel:alarmStatusLabels[a.status],
  workOrderId:a.workOrderId,workOrderCode:workOrderCode(a.workOrderId),
  pointId:a.pointId,isMissingWorkOrder:!!a.workOrderId&&!workOrderCode(a.workOrderId),
 }));
 const mappedDuty:HubEvent[]=dutyEvents.map(d=>({
  ref:"duty:"+d.id,origin:"duty",originalId:d.id,
  sourceName:"智能巡查",assetId:d.assetId,assetLabel:assetName(d.assetId),
  subsystemId:d.subsystemId,title:d.title,description:d.detail,at:d.lastSeen,
  active:eventActive(d.status),severity:d.level,status:d.status,
  statusLabel:EVENT_STATUS_NAMES[d.status],
  workOrderId:d.workOrderId,workOrderCode:workOrderCode(d.workOrderId),
  isMissingWorkOrder:!!d.workOrderId&&!workOrderCode(d.workOrderId),
 }));
 const severityPriority={critical:0,warning:1,info:2};
 const events=[...mappedAlarms,...mappedDuty].sort((a,b)=>
  Number(b.active)-Number(a.active)
  ||severityPriority[a.severity]-severityPriority[b.severity]
  ||(Date.parse(b.at)||0)-(Date.parse(a.at)||0)
  ||a.ref.localeCompare(b.ref));
 return {
  events,open:events.filter(x=>x.active).length,
  alarms:mappedAlarms.filter(x=>x.active).length,
  duty:mappedDuty.filter(x=>x.active).length,
  critical:events.filter(x=>x.active&&x.severity==="critical").length,
  hasOrder:events.filter(x=>x.workOrderId&& !x.isMissingWorkOrder).length,
  assetCount:new Set(events.filter(x=>x.active).map(x=>x.assetId)).size,
 };
}
export function filterHubEvents(
 events:readonly HubEvent[],state:EventHubFilter,origin:"all"|EventOrigin,query:string,
):HubEvent[] {
 const q=query.trim().toLowerCase();
 return events.filter(x=>
  (state==="all"|| (state==="open" ? x.active : !x.active))&&
  (origin==="all"||x.origin===origin)&&
  (!q||[x.title,x.description,x.assetLabel,x.originalId,x.ref,x.workOrderCode??""]
     .join(" ").toLowerCase().includes(q))
 );
}

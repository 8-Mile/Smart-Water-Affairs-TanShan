import type {useScenarioStore} from './store'
import type {AiDemoContext} from '@/api/ai'

/**
 * Single shared conversion of one browser-only simulation run.
 * Never replace unknown real measurements with guessed assets.
 */
export function simContext(store: ReturnType<typeof useScenarioStore>): AiDemoContext | undefined {
  const result=store.result
  const monitor=store.monitorEvidence
  const id=store.activeId
  if(!store.running||!id||!result||!monitor)return undefined
  return {
    data_mode:'SIM',field_verified:false,
    scenario_id:id,run_number:store.runNumber,run_uid:store.runUid,
    demand_m3h:result.demandedM3h,
    delivered_m3h:result.deliveredM3h,
    shortage_m3h:result.shortageM3h,
    coverage_percent:result.coveragePercent,
    pool_forecast_m3:result.forecastPoolM3,
    monitor_risk:monitor.risk,
    triggered_rules:monitor.rules.filter(r=>r.outcome==='TRIGGERED').map(r=>r.label),
    insufficient_rules:monitor.rules.filter(r=>r.outcome==='INSUFFICIENT').map(r=>r.label),
    affected_terminals:(store.impactAnalysis?.affectedTerminals||[]).map(t=>({
      label:t.label,demand_m3h:t.demandM3h,
      allocated_m3h:t.allocatedM3h,shortage_m3h:t.shortageM3h,
    })),
    checkpoints:(store.impactAnalysis?.checkpoints||[]).map(x=>x.label),
    review_status:store.monitorReview?.status||'not_started',
    review_outcome:store.monitorReview?.outcome||null,
    review_note:store.monitorReview?.note||'',
    process_checks:store.processChecks.map(x=>({...x})),
    scenario_started_at:store.startedAt,
    plans:store.supplyPlans.map(p=>({
      id:p.id,title:p.title,
      shortage_m3h:p.result.shortageM3h,
      deferred_m3h:p.deferredDemandM3h,
      raw_end_storage_m3:p.rawEndStorageM3,
      safety_margin_m3:p.safetyMarginM3,
      constraint:p.constraint,
      blockers:p.blockers,
      field_validated:false,
    })),
  }
}

/** Tanggang software-demonstration supply plan comparison.
 *
 * No field instrumentation, installed standby pump, operating permits, water
 * network connection, or manufacturer curve has been independently verified.
 * These are transparent *hypothetical* variants of one common input snapshot.
 *
 * Plan deltas are re-calculated using the SAME scenario engine as every
 * existing business page; not a fabricated independent per-card data store.
 */
import {
  calculateScenario, type ScenarioDefinition, type ScenarioInputs,
  type ScenarioResult, type SimTerminal,
} from './engine'

export const SUPPLY_PLAN_MODEL = 'tg-demo-supply-compare-v1'
export type SupplyPlanId = 'as-is' | 'defer' | 'storage-first' | 'standby'
export type SupplyPlanCheck = 'CONSTRAINT_FAIL' | 'UNVERIFIED'

export interface SupplyPlan {
  id: SupplyPlanId
  title: string
  change: string
  assumptions: string[]
  input: ScenarioInputs
  result: ScenarioResult
  deferredDemandM3h: number
  rawEndStorageM3: number
  safetyMarginM3: number
  constraint: SupplyPlanCheck
  blockers: string[]
  /** Never a real hydraulic, operational or construction feasibility verdict. */
  fieldValidated: false
  sourceMode: 'SIM'
  modelVersion: typeof SUPPLY_PLAN_MODEL
}

const round = (value: number, precision = 1) =>
  Math.round((value + Number.EPSILON) * 10 ** precision) / 10 ** precision

function variant(base: ScenarioDefinition, x: ScenarioInputs): ScenarioDefinition {
  return {
    ...base,
    inputs: {
      ...x,
      terminals: x.terminals.map(t => ({ ...t })),
    },
  }
}

function safeVolumeEnd(input: ScenarioInputs, flowM3h: number): number {
  return input.poolInitialM3 + (input.poolInflowM3h - flowM3h) * input.horizonHours
}

function build(
  scenario: ScenarioDefinition, id: SupplyPlanId, title: string,
  change: string, inputs: ScenarioInputs, deferredDemandM3h: number,
  assumptions: string[],
): SupplyPlan {
  const result = calculateScenario(variant(scenario, inputs))
  const rawEndStorageM3 = safeVolumeEnd(inputs, result.deliveredM3h)
  const safetyMarginM3 = rawEndStorageM3 - inputs.poolSafetyM3
  const blockers: string[] = []

  if (inputs.poolInitialM3 < inputs.poolSafetyM3)
    blockers.push('起始水池储量已低于假设安全线')
  if (rawEndStorageM3 < inputs.poolSafetyM3 - 1e-6)
    blockers.push('按整个推演窗口保持同一分配流量将突破假设安全储量线')
  if (rawEndStorageM3 < -1e-6)
    blockers.push('按恒定流量推算会抽空水池，不能将当前分配量视为整个时段的供水保障')
  if (id === 'standby')
    blockers.push('新增35 m³/h能力只是演示假设；没有核实备用设备、泵曲线、电源、管网及操作许可')
  if (id === 'defer' && deferredDemandM3h > 0)
    blockers.push('延后需求未消失，需要核实作业时序和延后时段的供水能力')
  if (id === 'storage-first' && inputs.poolInitialM3 < inputs.poolSafetyM3)
    blockers.push('当前库容不足，限供不能恢复起始时刻已越过的安全线')

  // No model alternative is operationally approved; "UNVERIFIED" still
  // requires engineering/owner checks even if the simplified volume balance passes.
  const violatesSafety = rawEndStorageM3 < inputs.poolSafetyM3 - 1e-6
  const hasCriticalConstraint = violatesSafety || inputs.poolInitialM3 < inputs.poolSafetyM3
  return {
    id, title, change, assumptions, input: inputs, result,
    deferredDemandM3h: round(deferredDemandM3h),
    rawEndStorageM3: round(rawEndStorageM3),
    safetyMarginM3: round(safetyMarginM3),
    constraint: hasCriticalConstraint ? 'CONSTRAINT_FAIL' : 'UNVERIFIED',
    blockers,
    fieldValidated: false,
    sourceMode: 'SIM',
    modelVersion: SUPPLY_PLAN_MODEL,
  }
}

export function compareSupplyPlans(scenario: ScenarioDefinition): SupplyPlan[] {
  const x = scenario.inputs
  // Validate baseline before running alternatives and protect user input.
  calculateScenario(scenario)
  const clone = (): ScenarioInputs => ({
    ...x,
    terminals: x.terminals.map(t => ({ ...t })),
  })

  const asIs = build(scenario, 'as-is', '维持现状', '不调整演示假设',
    clone(), 0, ['预置供需参数来自软件演示', '不构成现场实际供水能力'])

  // Only postpone a fraction of lower-priority tasks. Their water demand
  // MUST remain visible as deferred; do not report it as water saved.
  const deferred = clone()
  let deferredM3h = 0
  deferred.terminals = deferred.terminals.map((t: SimTerminal) => {
    if (t.priority === 1) return t
    const delayed = t.demandM3h * .5
    deferredM3h += delayed
    return { ...t, demandM3h: round(t.demandM3h - delayed, 3) }
  })
  const defer = build(scenario, 'defer', '错峰低优先级用水',
    '假设将二、三级用水需求的50%顺延至推演窗口后',
    deferred, deferredM3h, [
      '50%顺延比例仅为演示输入，不是港口生产计划',
      '顺延用水仍必须在后续时段满足，不能当作节水',
    ])

  // Clamp the outlet rate by the available water above safety over the
  // chosen horizon, while retaining the same pump-capacity and reserved flow.
  const protectedInputs = clone()
  const limitOut = Math.max(0,
    x.poolInflowM3h + (x.poolInitialM3 - x.poolSafetyM3) / x.horizonHours,
  )
  const maxUsable = x.capacityM3h - x.reservedM3h
  const newUsable = Math.min(maxUsable, limitOut)
  protectedInputs.capacityM3h = round(newUsable + x.reservedM3h, 6)
  const storageFirst = build(scenario, 'storage-first', '优先守住安全储量',
    '限制演示可用供水量，以保留推演窗口末的假设安全储量',
    protectedInputs, 0, [
      '使用简化恒定入/出水量与假设安全线，不代表实际泵阀调度策略',
      '可能增加当期缺口，不能保证所有生产环节连续供水',
    ])

  const reserve = clone()
  reserve.capacityM3h += 35
  const standby = build(scenario, 'standby', '假设备用能力增加',
    '将总供水能力假设增加35 m³/h，不表示现场确有备用泵',
    reserve, 0, [
      '35 m³/h为纯演示增量，非现场设备参数',
      '不能推断现场备用泵存在、管线可达或水质适用',
    ])

  return [asIs, defer, storageFirst, standby]
}

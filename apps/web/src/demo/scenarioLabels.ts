import type { ScenarioId } from "./types";

export const SCENARIO_NAMES: Record<ScenarioId, string> = {
  "SCN-NORMAL": "常态运行",
  "SCN-PUMP-FAULT": "泵组故障",
  "SCN-RAIN": "降雨过程",
  "SCN-MINING": "含矿污水波动",
  "SCN-YARD-STOP": "堆场作业结束",
};

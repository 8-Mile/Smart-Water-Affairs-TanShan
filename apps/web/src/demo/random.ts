/**
 * 固定种子伪随机工具。所有演示数据必须由字符串种子派生，
 * 刷新浏览器、切换场景再切回时结果保持一致。
 */

/** FNV-1a 32 位哈希，将任意字符串映射为 uint32。 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 伪随机数生成器，返回 [0, 1) 的确定性序列。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由种子键生成 count 个 [-1, 1] 区间的确定性噪声。 */
export function noiseSeries(key: string, count: number): number[] {
  const random = mulberry32(hashString(key));
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(random() * 2 - 1);
  return values;
}

/** 围绕 base 叠加波动幅度的确定性序列。 */
export function jitterAround(
  base: number,
  volatility: number,
  key: string,
  count: number,
): number[] {
  return noiseSeries(key, count).map((noise) => base + noise * volatility);
}

/** 保留指定小数位，避免浮点尾差导致快照不一致。 */
export function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 在两个时刻之间按 stepMinutes 生成时间点（含首尾）。
 * 用于遥测序列，保证样本时间可复现。
 */
export function timeSteps(
  fromMs: number,
  toMs: number,
  stepMinutes: number,
): number[] {
  const stepMs = stepMinutes * 60_000;
  const steps: number[] = [];
  for (let at = fromMs; at <= toMs; at += stepMs) steps.push(at);
  if (steps.length === 0 || steps[steps.length - 1] !== toMs) steps.push(toMs);
  return steps;
}

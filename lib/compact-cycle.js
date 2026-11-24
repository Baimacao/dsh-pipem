// compact-cycle.js —— 上下文到阈值时的四步循环。
//
// ta 定的流程（2026-11-24）：
//   1. 到 78%  停手，让模型写交接（只提醒这一次，其余时间不打扰）
//   2. 写完    结束此轮（pre-step 返回 reject）
//   3. 然后    触发 DSH 自己的上下文压缩
//   4. 压缩完  开新轮，自动把交接注入进去继续
//
// 状态机三个阶段：idle → halting（已提醒，等交接）→ compressing → idle
//
// 为什么必须在 idle 时压缩：compactNow 的约束是
//   "manual compaction requires an idle agent with no waking queued work"
// 所以流程是 halt 提醒 → 模型写交接 → reject 结束此轮 → idle → 压缩 → followup 开新轮。

/** 每个 agent 的循环状态。 */
const cycles = new WeakMap()

function stateOf(agent) {
  let s = cycles.get(agent)
  if (s === undefined) {
    s = { phase: "idle", halts: 0, compacts: 0 }
    cycles.set(agent, s)
  }
  return s
}

/** 当前阶段。 */
export function phaseOf(agent) {
  return stateOf(agent).phase
}

/** 进到「已提醒停手」阶段。 */
export function markHalting(agent) {
  const s = stateOf(agent)
  s.phase = "halting"
  s.halts += 1
  return s
}

/** 进到「压缩中」阶段。 */
export function markCompressing(agent) {
  const s = stateOf(agent)
  s.phase = "compressing"
  return s
}

/** 回到 idle。 */
export function markIdle(agent) {
  const s = stateOf(agent)
  s.phase = "idle"
  // halts 必须清零：否则压缩后又涨上来时 isFirstHalt 永远 false，
  // 一轮会话就只能停手一次。compacts 保留用来统计。
  s.halts = 0
  s.compacts += 1
  return s
}

/** 是不是第一次到这个阈值（避免每轮都提醒）。 */
export function isFirstHalt(agent) {
  return stateOf(agent).halts === 0
}

/** 统计。 */
export function cycleStats(agent) {
  const s = stateOf(agent)
  return { ...s }
}

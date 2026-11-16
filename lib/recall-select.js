// recall-select.js —— 公平车道选择器（FAIR-DRI 精简版）。
//
// 搬自 dsh-rofm 的 engine/recall-index.js（97KB），砍到核心思路，约 150 行。
//
// 它解决的问题：只按分数取前 N 条，低分记忆永远出不来。
// 结果就是"我明明记过，但它从来不提"。
//
// 原版有 8 条车道。我的数据量小（几十到几百条），保留 4 条够用：
//   1. rareHigh     稀有词命中的高 α —— 查询里有明确的专名，当轮必现
//   2. hi           高 α 主车道 —— 按 α 排
//   3. rotation     低 α 轮转道 —— 保证低分记忆也有机会
//   4. recycle      回收道 —— 上轮被挤掉的，冷却后重入
//
// 全部确定性：同一个库 + 同一个查询 → 同样的结果。

/** 高 α 阈值。超过它算"重要记忆"，优先保住。 */
const THETA_HIGH = 0.6

/**
 * 挑出这一轮要用的回忆。
 *
 * @param {Array<{id:any, alpha?:number, text?:string, at?:string}>} pool  候选（已通过关键词过滤）
 * @param {object} opts
 * @param {number} [opts.k]        总配额，默认 8
 * @param {number} [opts.explore]  低 α 保留槽，默认 2
 * @param {Set<string>} [opts.rareTerms]  稀有词（命中即高价值）
 * @param {object} [opts.state]    跨轮状态（游标、冷却）
 * @returns {{picks:Array, state:object, lanes:object}}
 */
export function selectRecall(pool, opts = {}) {
  const k = Math.max(1, opts.k ?? 8)
  const explore = Math.max(0, Math.min(k - 1, opts.explore ?? 2))
  const hiQuota = k - explore
  const rareTerms = opts.rareTerms ?? new Set()
  const state = opts.state ?? {}

  // 归一化：把 pool 里每条算上 σ 排序键 (α desc, at asc, id asc)
  const items = pool.map((it) => ({
    it,
    a: Number.isFinite(it.alpha) ? it.alpha : 0,
  }))

  const high = items.filter((x) => x.a >= THETA_HIGH)
  const low = items.filter((x) => x.a < THETA_HIGH)

  const picked = []
  const pickedIds = new Set()
  const lanes = { rareHigh: 0, hi: 0, rotation: 0, recycle: 0 }

  const take = (x, lane) => {
    if (!x || pickedIds.has(x.it.id)) return false
    if (picked.length >= k) return false
    picked.push(x)
    pickedIds.add(x.it.id)
    lanes[lane] = (lanes[lane] ?? 0) + 1
    return true
  }

  // ── 车道 1：稀有词命中的高 α，当轮必现 ────────────────
  if (rareTerms.size > 0) {
    const rare = high
      .filter((x) => {
        const t = String(x.it.text ?? '')
        return [...rareTerms].some((w) => w && t.includes(w))
      })
      .sort((a, b) => b.a - a.a)
    for (const x of rare) {
      if (lanes.rareHigh >= hiQuota) break
      take(x, 'rareHigh')
    }
  }

  // ── 车道 2：主车道（按 α 降序）────────────────────
  // 高 α 优先，但整体按 α 排就行——分成"高/低"再分别处理反而乱
  const byAlpha = items
    .filter((x) => !pickedIds.has(x.it.id))
    .sort((a, b) => b.a - a.a || String(a.it.at ?? '').localeCompare(String(b.it.at ?? '')))

  // 主车道配额 = 总数 - 轮转保留
  for (const x of byAlpha) {
    if (picked.length >= k - explore) break
    take(x, 'hi')
  }

  // ── 车道 3：轮转道（低 α 也有机会）──────────────────
  // 只从"没被主车道选中"的里按 α 升序轮，游标持久化保证不重样
  const leftover = byAlpha.filter((x) => !pickedIds.has(x.it.id))
  const lowFirst = leftover.sort((a, b) => a.a - b.a || String(a.it.at ?? '').localeCompare(String(b.it.at ?? '')))
  const cursor = Number.isInteger(state.cursor) ? state.cursor : 0
  let idx = lowFirst.length > 0 ? cursor % lowFirst.length : 0
  const rotateTarget = Math.min(explore, lowFirst.length)
  for (let n = 0; n < lowFirst.length && lanes.rotation < rotateTarget; n++) {
    const x = lowFirst[idx]
    idx = (idx + 1) % lowFirst.length
    if (!take(x, 'rotation')) break
  }

  // ── 补满：还有空位就从剩下的按 α 补 ──────────────────
  if (picked.length < k) {
    for (const x of leftover) {
      if (picked.length >= k) break
      take(x, 'hi')
    }
  }

  // ── 车道 4：回收道 ──────────────────────────────────
  // 上轮因为配额被挤掉的，冷却 N 轮后重入
  const cooldown = opts.cooldownRounds ?? 15
  const round = (state.round ?? 0) + 1
  const recycleQueue = Array.isArray(state.recycle) ? state.recycle : []
  const stillCooling = []
  for (const entry of recycleQueue) {
    const target = items.find((x) => x.it.id === entry.id)
    if (!target) continue
    if (round - entry.droppedAt < cooldown) { stillCooling.push(entry); continue }
    if (!take(target, 'recycle')) { stillCooling.push(entry); continue }
  }

  // 没被选上的（但进过候选的）进回收队列
  const dropped = items
    .filter((x) => !pickedIds.has(x.it.id))
    .slice(0, 20)
    .map((x) => {
      const prev = stillCooling.find((e) => e.id === x.it.id)
      return prev ?? { id: x.it.id, droppedAt: round }
    })

  return {
    picks: picked.map((x) => x.it),
    lanes,
    state: {
      round,
      cursor: lowFirst.length > 0 ? (idx + 1) % lowFirst.length : 0,
      recycle: dropped,
    },
  }
}

/** 判断哪些查询词算「稀有」（命中的记忆条数少）。 */
export function rareTermsOf(pool, terms) {
  const rare = new Set()
  const total = Math.max(1, pool.length)
  const threshold = Math.max(3, Math.ceil(total * 0.15))
  for (const t of terms) {
    if (!t || t.length < 2) continue
    const hits = pool.filter((it) => String(it.text ?? '').includes(t)).length
    if (hits > 0 && hits <= threshold) rare.add(t)
  }
  return rare
}

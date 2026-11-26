// 复读检测 —— 算法搬自 dsh-degeneration-kit 的 thinking-guard，只用纯文本统计。
//
// 为什么要这个：长上下文下模型会陷进复读（"我要做 X" 空转），而且回合看起来还是成功的。
// 实测数据（作者全机 493 个会话）：24 个真退化块里 18 个回合正常结束，只在思考里烂。
//
// 我这里不折叠历史——那是它插件的做法，要改 surface 节点，风险大。
// 我改成：检测到我自己在复读时，**在下一步的上下文里塞一条提醒**，让我自己跳出来。
// 同一个目的（打断复读），但不碰历史。

/** 默认判据。英文环境要调大 maxUnit（见下方注释）。 */
export const DETECT_DEFAULTS = {
  minChars: 400,      // 思考块短于这个不看
  minRepeats: 25,     // 同一单元至少重复这么多次
  maxUnit: 80,        // 算作重复单元的最大字符数（原版 30 是中文定的，英文调大到 80）
  minShare: 0.20,     // 重复部分至少占整块 20%
  tailChars: 4000,    // 只看尾部这么长
  shortShareMin: 0.35, // v2：极短段（≤3 词）占尾窗段数比例下限
  topUnitShareMin: 0.50, // v2：最高频 5 段合计占比下限
}

/** 切句：中文标点 + 英文句点 + 换行。 */
function splitSegments(text) {
  return text.split(/[。！？!?\n]+|\.\s+/).map((s) => s.trim()).filter(Boolean)
}

/** 实义字符（字母数字 + 汉字）。 */
function hasSubstance(s) {
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(s)
}

/**
 * 判断一段思考是不是复读。
 * @returns {{ hit: boolean, reason?: string, detail?: object }}
 */
export function detectRepetition(reasoning, options = {}) {
  const cfg = { ...DETECT_DEFAULTS, ...options }
  if (typeof reasoning !== 'string' || reasoning.length < cfg.minChars) {
    return { hit: false, reason: 'too-short' }
  }

  // 只看尾部窗口
  const tail = reasoning.length > cfg.tailChars ? reasoning.slice(-cfg.tailChars) : reasoning
  const segments = splitSegments(tail).filter(hasSubstance)
  if (segments.length < cfg.minRepeats) {
    return { hit: false, reason: 'too-few-segments', detail: { segments: segments.length } }
  }

  // ── 原判据：单个单元重复次数 ────────────────────────
  const counts = new Map()
  for (const s of segments) {
    const key = s.slice(0, cfg.maxUnit)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let topUnit = ''
  let topCount = 0
  for (const [k, v] of counts) {
    if (v > topCount) { topCount = v; topUnit = k }
  }
  const share = topCount / segments.length

  if (topCount >= cfg.minRepeats && share >= cfg.minShare) {
    return {
      hit: true,
      reason: 'single-unit-repeat',
      detail: { unit: topUnit.slice(0, 60), count: topCount, share: Number(share.toFixed(2)), segments: segments.length },
    }
  }

  // ── v2 判据：短句轮换（英文更难抓的那种）────────────
  // 尾部被切成很多极短段、每段都不够 20%，但合起来占了很大比例
  const short = segments.filter((s) => s.split(/\s+/).length <= 3)
  const shortShare = short.length / segments.length
  if (shortShare >= cfg.shortShareMin) {
    // 再看最高频 5 段合计占比
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const top5 = sorted.reduce((n, [, v]) => n + v, 0) / segments.length
    if (top5 >= cfg.topUnitShareMin) {
      return {
        hit: true,
        reason: 'short-rotation',
        detail: {
          shortShare: Number(shortShare.toFixed(2)),
          top5Share: Number(top5.toFixed(2)),
          topUnits: sorted.slice(0, 3).map(([k, v]) => k.slice(0, 30) + '×' + v),
          segments: segments.length,
        },
      }
    }
  }

  return { hit: false, reason: 'below-threshold', detail: { topCount, share: Number(share.toFixed(2)), segments: segments.length } }
}

/** 给模型的提醒文案。 */
export function repetitionReminder(result) {
  const d = result.detail ?? {}
  const lines = [
    '[pipem] Your reasoning in the previous step is looping.',
    '  That usually means you are stuck in a do-X loop while the turn still looks successful.',
  ]
  if (result.reason === 'single-unit-repeat') {
    lines.push('  Evidence: the same phrase "' + d.unit + '" repeated ' + d.count + ' times in the trailing window (' + Math.round((d.share ?? 0) * 100) + '%).')
  } else {
    lines.push('  Evidence: short-phrase rotation - very short units are ' + Math.round((d.shortShare ?? 0) * 100) + '% and the top 5 units are ' + Math.round((d.top5Share ?? 0) * 100) + '%.')
    if (d.topUnits) lines.push('  Frequent fragments: ' + d.topUnits.join(' / '))
  }
  lines.push('  What to do: stop and state which step you are actually stuck on; change approach or report blocked. Do not continue the same loop.')
  return lines.join('\n')
}

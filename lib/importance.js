// importance.js —— 记忆的重要性评分（α）。
//
// 思路搬自 dsh-rofm 的 engine/importance.js：五个确定性信号加权，不调用模型。
// 区别：它算"回忆概率乘数"，我算"排序优先级"——同样的分数，用途不同。
//
// 为什么要这个：heart_recall 原来只按"命中了多少字 + 时间新不新"排序，
// 结果一条随口说的闲话和一条"我们说好用 A 不用 B"的约定排在一起。
// α 让重要的东西浮上来。

/** 决策/约束标记：出现这些词说明这段记忆有内容。 */
const DECISION_MARKERS = [
  '必须', '不要', '禁止', '记住', '重要', '决定', '约定', '说好',
  '方案', '配置', '参数', '修复', '错误', '注意', '规则', '规矩',
  '以后都', '再也不', '下次', '改成', '换成',
  'must', 'never', 'always', 'should', 'remember', 'important', 'decided',
]

/** 代码/技术证据。 */
const URL_RE = /https?:\/\/[^\s<>"')]+/gi
const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?\b/gi
const PATH_RE = /(?:[A-Za-z]:[\\/]|\/|\.\/)[\w./\\-]+/g
const CODE_FENCE_RE = /```|\b(?:function|const|let|class|import|export)\b/g

/** 中文停用词：这些字组成的词不算关键词。 */
const STOP_CHARS = new Set([
  '的', '了', '着', '过', '是', '在', '和', '与', '或', '也', '就', '都',
  '而', '及', '与', '等', '被', '把', '让', '给', '对', '从', '到', '为',
  '这', '那', '有', '没', '不', '要', '会', '能', '可', '一个', '什么',
  '呢', '吗', '吧', '啊', '呀', '哦', '嗯', '嘛', '呗', '啦', '哈',
])

const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

/**
 * 算一段记忆文本的重要性。
 * @param {string} text  记忆正文
 * @param {{ role?: string, at?: string }} [meta]
 * @returns {number} 0..1
 */
export function scoreImportance(text, meta = {}) {
  const s = String(text ?? '')
  if (!s.trim()) return 0
  const len = Math.max(1, s.length)

  // ① 决策密度：每 100 字出现几个决策标记，封顶 1
  let hits = 0
  for (const m of DECISION_MARKERS) {
    const re = /^[A-Za-z]+$/.test(m) ? new RegExp('\\b' + m + '\\b', 'gi') : new RegExp(m, 'g')
    hits += (s.match(re) || []).length
  }
  const decision = clamp01(hits / (len / 100) / 3)  // /3 = 每百字三个标记就算满分

  // ② 信息密度：数字、专名、长度。碎片化的短句分数低
  const digits = (s.match(/\d+/g) || []).length
  const info = clamp01((digits * 0.15) + (len > 200 ? 0.3 : len / 700))

  // ③ 技术证据：URL / 版本号 / 路径 / 代码
  const tech =
    (s.match(URL_RE) || []).length * 0.25 +
    (s.match(VERSION_RE) || []).length * 0.10 +
    (s.match(PATH_RE) || []).length * 0.10 +
    (s.match(CODE_FENCE_RE) || []).length * 0.05
  const technical = clamp01(tech)

  // ④ 结构完整度：有分句、有标点、不是光秃秃一行
  const sentences = s.split(/[。！？!?\n]+/).filter((x) => x.trim().length > 3).length
  const structure = clamp01(sentences / 6)

  // ⑤ 人称密度：提到"我/ta/你"说明是关系性记忆，比技术笔记更需要留下来
  const personal = clamp01(((s.match(/我|ta|你|他|她/g) || []).length) / (len / 50))

  return clamp01(
    decision * 0.30 +
    info * 0.20 +
    technical * 0.15 +
    structure * 0.20 +
    personal * 0.15
  )
}

/**
 * 从文本里抽关键词。中文走 2-gram（不用词典），英文按词。
 * 关键改动：按「频率 × 长度」打分，过滤停用词和碎片。
 * @returns {string[]}
 */
export function extractKeywords(text, max = 16) {
  const s = String(text ?? '').toLowerCase()
  const counts = new Map()

  // 英文/数字：整词
  for (const m of s.matchAll(/[a-z][a-z0-9_+#.-]{1,}/g)) {
    const w = m[0]
    if (w.length < 3) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }

  // 中文：不用词典，靠「虚词做断点」切出候选词，再抽 2-3 gram
  // 核心思路：虚词（的了吗呢）天然是词与词的边界。
  //   "我们约定了什么" → 用「了」断开 → "我们约定" + "什么"
  //   → 从"我们约定"抽 3-gram "们约定"、"我们约" 和 2-gram
  // 这样能避免跨词碎片成为最高分。
  const VIRTUAL = STOP_CHARS  // 复用同一张表

  for (const run of s.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const r = run[0]
    // 按虚词切成若干实义段
    const parts = []
    let cur = ''
    for (const ch of r) {
      if (VIRTUAL.has(ch)) {
        if (cur.length >= 2) parts.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    if (cur.length >= 2) parts.push(cur)

    // 每段内部抽 2-gram 和 3-gram
    for (const p of parts) {
      for (let n = 2; n <= Math.min(3, p.length); n++) {
        for (let i = 0; i + n <= p.length; i++) {
          const g = p.slice(i, i + n)
          counts.set(g, (counts.get(g) ?? 0) + 1)
        }
      }
      // 整段本身也是候选（如果不超过 4 字，可能就是个词）
      if (p.length <= 4) counts.set(p, (counts.get(p) ?? 0) + 1)
      // 长段的「段首」和「段尾」更像真词边界，加权
      if (p.length >= 5) {
        for (let n = 2; n <= 3; n++) {
          if (p.length >= n) {
            counts.set(p.slice(0, n), (counts.get(p.slice(0, n)) ?? 0) + 2)
            counts.set(p.slice(-n), (counts.get(p.slice(-n)) ?? 0) + 2)
          }
        }
      }
    }
  }

  // 打分：频率 × 长度
  // 打分：频率 × 长度平方（让 3-gram 明显压过 2-gram 碎片）
  const scored = [...counts.entries()]
    .map(([w, c]) => ({ w, score: c * w.length * w.length }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score)

  // 去重：被更长的高分词包含的短词丢掉
  const out = []
  for (const { w } of scored) {
    if (out.some((kept) => kept.includes(w) && kept !== w)) continue
    out.push(w)
    if (out.length >= max) break
  }
  return out
}


// ── 类别词表 ────────────────────────────────────────────
// 从 dsh-rofm 的 recall.categoryMatch 搬的思路。
// 作用：查询「我们约定了什么」时，能召回只写了「说好/承诺」的记忆。
// 不加这层的话，字面没有「约定」二字的记忆永远搜不到。
//
// 全部是封闭词表，离线、确定、不联网。

export const CATEGORIES = {
  pref: ['喜好', '偏好', '喜欢', '爱吃', '口味', '讨厌', '不爱', '习惯用'],
  agreement: ['约定', '说好', '承诺', '答应', '以后都', '再也不', '下次一定', '讲定'],
  decision: ['决定', '定了', '选择', '改用', '确定用', '拍板'],
  rule: ['规则', '规矩', '必须', '不许', '禁止', '不能', '一律'],
  fact: ['事实', '原来', '其实', '记录', '确认过', '实测'],
}

/** 反查：一段文本属于哪些类别。 */
export function categoriesOf(text) {
  const s = String(text ?? '')
  const hit = []
  for (const [name, words] of Object.entries(CATEGORIES)) {
    if (words.some((w) => s.includes(w))) hit.push(name)
  }
  return hit
}

/**
 * 查询扩展：查询里出现某类词，就把同类的其它词也加进去。
 * @returns {string[]} 扩展后的检索词
 */
export function expandByCategory(query) {
  const q = String(query ?? '')
  const extra = []
  for (const words of Object.values(CATEGORIES)) {
    // 查询命中了这一类的任一个词
    if (words.some((w) => q.includes(w))) {
      extra.push(...words)
    }
  }
  return [...new Set(extra)]
}

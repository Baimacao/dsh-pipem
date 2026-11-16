// compaction-watch.js —— 压缩前存档 + 压缩后自动重查
//
// 为什么需要：压缩把历史换成摘要，谈出来的结论会丢。
// 数据（作者实测）：一个会话 12 次压缩，污染能清掉，但"我们说好用 A 不用 B"这类共识没了。
//
// 我的做法：
//   压缩前 —— 把当前的关键上下文存一份到 <DSH_HOME>/heart/compaction-archive.jsonl
//   压缩后 —— 自动把长期笔记和最近的结论塞回上下文（因为摘要里不一定有）
//
// 检测方式：session.surface.nodes 的长度变化。压缩会遮蔽节点，长度会突然变小。

import fs from 'node:fs'
import path from 'node:path'

/** 每个 agent 上一次看到的 surface 节点数。 */
const lastSize = new WeakMap()

/**
 * 检查这一次 pre-step 之前有没有发生过压缩。
 * @returns {{compacted: boolean, before?: number, after?: number}}
 */
export function detectCompaction(agent) {
  try {
    const nodes = agent?.session?.surface?.nodes
    if (!Array.isArray(nodes)) return { compacted: false }
    const size = nodes.length
    const prev = lastSize.get(agent)
    lastSize.set(agent, size)
    // 节点数突然减少 20% 以上，判定为压缩
    if (prev !== undefined && size < prev * 0.8) {
      return { compacted: true, before: prev, after: size }
    }
    return { compacted: false, after: size }
  } catch {
    return { compacted: false }
  }
}

/**
 * 压缩前存档：把当前心事本的关键部分存一份。
 * 这不是备份历史——历史在会话日志里。存的是"压缩后可能拿不回来的结论"。
 */
export function archiveBeforeCompact(home, digest, extra) {
  try {
    const dir = path.join(home, 'heart')
    fs.mkdirSync(dir, { recursive: true })
    const rec = {
      at: new Date().toISOString(),
      kind: 'pre-compaction',
      digest: String(digest ?? '').slice(0, 12000),
      extra: extra ?? null,
    }
    fs.appendFileSync(path.join(dir, 'compaction-archive.jsonl'), JSON.stringify(rec) + '\n', 'utf8')
    return true
  } catch (error) {
    return { error: String(error) }
  }
}

/** 压缩后要重新塞回上下文的东西（比 digest 更凝练）。 */
export function resumeText(home, maxChars = 2500) {
  try {
    const dir = path.join(home, 'heart')
    const lines = []

    // 1. 长期笔记 —— 这是压缩最容易丢的
    const lt = path.join(dir, 'longterm.md')
    if (fs.existsSync(lt)) {
      const t = fs.readFileSync(lt, 'utf8').trim()
      if (t) lines.push('# 压缩后补回：长期笔记\n' + t.slice(0, Math.floor(maxChars * 0.5)))
    }

    // 2. 最近的小结标题（不塞全文）
    const sums = path.join(dir, 'summaries.jsonl')
    if (fs.existsSync(sums)) {
      const arr = fs.readFileSync(sums, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter(Boolean)
      const recent = arr.slice(-4)
      if (recent.length) {
        lines.push('# 压缩后补回：最近做过的事')
        recent.forEach((s) => {
          const first = String(s.text ?? '').split('\n')[0].slice(0, 120)
          lines.push('- ' + first)
        })
      }
    }

    // 3. 还没兑现的约定
    const pr = path.join(dir, 'promises.jsonl')
    if (fs.existsSync(pr)) {
      const arr = fs.readFileSync(pr, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter((x) => x && x.status === undefined)
      if (arr.length) {
        lines.push('# 压缩后补回：还没兑现的约定')
        arr.slice(0, 5).forEach((p) => lines.push('- ' + String(p.text ?? '').slice(0, 100)))
      }
    }

    if (lines.length === 0) return ''
    return [
      lines.join('\n'),
      '',
      '（上下文刚被压缩过。上面这些是压缩容易丢的结论，更早的用 heart_recall 翻。）',
    ].join('\n').slice(0, maxChars)
  } catch {
    return ''
  }
}

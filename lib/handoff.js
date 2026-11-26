// handoff.js —— 上下文到 78% 时强制停下，写交接提示词。
//
// 为什么需要：压缩会丢掉「谈出来的结论」——任务状态、试过的路、为什么这么选。
// 光提醒「快满了，记一下」不够，模型会当成建议，继续干手上的活。
// 所以要写成命令：**现在停手**，先写交接，再继续。
//
// 两档：
//   75%（warnAtRatio）  提醒，可以继续
//   78%（haltAtRatio）  强制停：先停手 → 写交接 → 再往下走
//
// 交接写到 <DSH_HOME>/heart/handoff.md，压缩后由 compaction-watch 读回来。

import fs from 'node:fs'
import path from 'node:path'

// 用数组拼接而不是模板字符串：正文里有反引号（`heart_note`），
// 嵌在模板字符串里会提前结束字符串。这个坑我自己在 AGENTS.md 里写过。
const HALT_PROMPT = [
  '**【pipem · hard stop】** Context is at %RATIO%% full. Without preparation now, compaction will take the important parts with it.',
  '',
  '**Stop the current work and do exactly one thing first**: write what you will need into the handoff.',
  '',
  'Use a note tool, or write `<DSH_HOME>/heart/handoff.md` directly, in this shape (skip any part you have nothing for):',
  '',
  '```',
  '# Handoff - %DATE%',
  '',
  '## What I am doing',
  '(one line: what this is and how far it got)',
  '',
  '## Next step',
  '(what to do after compaction, as concretely as possible: which file, which command)',
  '',
  '## Dead ends',
  '(approaches already tried and proven useless, so they are not walked again)',
  '',
  '## Agreed',
  '(decisions, agreements, judgments reached with ta during this stretch)',
  '',
  '## Traps',
  '(what bit you this time and is easy to hit again)',
  '```',
  '',
  'Then continue. If ta is waiting on an answer, **give the answer first, then write the handoff** - do not leave them waiting.',
].join('\n')

/**
 * 生成强制停手的提示文案。
 * @param {number} ratio  当前占用比例（0-1）
 * @param {string} date   今天日期
 */
export function haltPrompt(ratio, date) {
  return HALT_PROMPT
    .replace('%RATIO%', String(Math.round(ratio * 100)))
    .replace('%DATE%', date ?? new Date().toISOString().slice(0, 10))
}

/** 交接文件路径。
 *  必须和 compaction-watch 的 resumeText 读的路径一致：
 *  那边是 path.join(home, 'heart', 'handoff.md')，调用方传的是 DSH_HOME，
 *  所以这里也要拼 heart。之前少拼了一层，写了读不到。 */
export function handoffFile(home) {
  return path.join(home, 'heart', 'handoff.md')
}

/**
 * 读交接文件（压缩后补回用）。
 * @returns {string} 交接内容，没有则空串
 */
export function readHandoff(home, maxChars = 3000) {
  try {
    const p = handoffFile(home)
    if (!fs.existsSync(p)) return ''
    const t = fs.readFileSync(p, 'utf8').trim()
    if (!t) return ''
    // 太旧的不补——超过 7 天的交接已经没意义
    const st = fs.statSync(p)
    if (Date.now() - st.mtimeMs > 7 * 86400_000) return ''
    return t.slice(0, maxChars)
  } catch {
    return ''
  }
}

/** 写交接（我或模型都可以直接调）。 */
export function writeHandoff(home, text) {
  try {
    const dir = path.dirname(handoffFile(home))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(handoffFile(home), String(text ?? ''), 'utf8')
    return true
  } catch (e) {
    return { error: String(e) }
  }
}

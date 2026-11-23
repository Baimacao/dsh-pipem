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
  '**【哌甲酯·强制停手】** 上下文已用到 %RATIO%%，再不做准备，压缩会把重要的东西一起压掉。',
  '',
  '**现在停下手上的活，先做这一件事**：把接下来要用的东西写进交接。',
  '',
  '用心记工具或直接写 `<DSH_HOME>/heart/handoff.md`，按这个格式（有就写，没有就跳过）：',
  '',
  '```',
  '# 交接 —— %DATE%',
  '',
  '## 正在做的事',
  '（一句话说清现在在干什么、做到哪一步）',
  '',
  '## 下一步',
  '（压缩后接着做什么，越具体越好：改哪个文件、跑什么命令）',
  '',
  '## 走过的弯路',
  '（试过但没用的方向，避免压缩后又重走一遍）',
  '',
  '## 说好的事',
  '（这段时间和 ta 谈出来的决定、约定、判断）',
  '',
  '## 别忘的坑',
  '（这次踩到的、下次容易再踩的）',
  '```',
  '',
  '写完再继续。如果 ta 正在等一个答案，**先给答案，再写交接**——别让人等。',
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

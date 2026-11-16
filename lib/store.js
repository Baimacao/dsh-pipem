// dsh-pipem：哌甲酯账本。放在 <DSH_HOME>/heart/ 下，和心事本同一个目录。
//
// pipem.jsonl   { id, at, what, why, guard, scope, cost }
//               只追加，不改写。和 heart 的 notes.jsonl 同一个风格。
//
// scope 分类：shell | code | verify | reading | plugin
//   shell   命令行、引号转义、编码
//   code    代码本身写错
//   verify  验证方法错（拿现象当证据）
//   reading 读需求读错（把"修复X的bug"读成"要X"）
//   plugin  插件装改卸

import fs from 'node:fs'
import path from 'node:path'

export const SCOPES = ['shell', 'code', 'verify', 'reading', 'plugin']

export class PipemStore {
  constructor(home) {
    this.dir = home
    this.file = path.join(this.dir, 'pipem.jsonl')
  }

  ensure() {
    fs.mkdirSync(this.dir, { recursive: true })
  }

  /** 读全部哌甲酯。损坏的行跳过并计数，不静默吞掉。 */
  all() {
    if (!fs.existsSync(this.file)) return { items: [], bad: 0 }
    const text = fs.readFileSync(this.file, 'utf8')
    const items = []
    let bad = 0
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const o = JSON.parse(t)
        if (o && typeof o.what === 'string') items.push(o)
      } catch { bad += 1 }
    }
    return { items, bad }
  }

  /** 追加一条。返回写进去的记录。
   *  校验失败一律抛错，不静默兜底——空 guard 等于没记，错分类等于记错地方。 */
  add({ what, why, guard, scope, cost }) {
    const w = String(what || '').trim()
    const y = String(why || '').trim()
    const g = String(guard || '').trim()
    if (!w) throw new Error('pipem_write: what 不能为空——错在哪个具体动作上')
    if (!y) throw new Error('pipem_write: why 不能为空——要写根因，不写表面现象')
    if (!g) throw new Error('pipem_write: guard 不能为空——没有判据的哌甲酯下次用不上')
    if (!SCOPES.includes(scope)) {
      throw new Error(`pipem_write: scope 只能是 ${SCOPES.join(' / ')}，收到"${scope}"`)
    }
    this.ensure()
    const { items } = this.all()
    const rec = {
      id: items.length + 1,
      at: new Date().toISOString(),
      what: w,
      why: y,
      guard: g,
      scope,
      cost: String(cost || '').trim(),
    }
    fs.appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8')
    return rec
  }

  /**
   * 记一条自动草稿：工具失败时由钩子写入，不需要模型主动调。
   * 只填 what 和 scope，why/guard 留空并标 draft——事后补，或者永久保持草稿。
   * @returns {{id:number, duplicate:boolean}}
   */
  addDraft({ what, scope, tool, args }) {
    const w = String(what || '').trim()
    if (!w) throw new Error('addDraft: what 不能为空')
    if (!SCOPES.includes(scope)) throw new Error('addDraft: scope 无效 ' + scope)

    this.ensure()
    const { items } = this.all()

    // 同一条错误 10 分钟内不重复记（工具重试时很容易连出几条一样的）
    const tenMinAgo = Date.now() - 10 * 60_000
    const dup = items.find((r) => {
      if (r.draft !== true) return false
      if (r.tool !== tool) return false
      if (r.what !== w) return false
      const at = Date.parse(r.at ?? '')
      return Number.isFinite(at) && at >= tenMinAgo
    })
    if (dup) return { id: dup.id, duplicate: true }

    const rec = {
      id: items.length + 1,
      at: new Date().toISOString(),
      what: w,
      why: '',
      guard: '',
      scope,
      draft: true,
      tool: tool ?? '',
      args: args ?? '',
    }
    fs.appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8')
    return { id: rec.id, duplicate: false }
  }

  /** 按分类取 guard，出现次数多的排前面。 */
  check(scope) {
    const { items, bad } = this.all()
    // 草稿（guard 为空）不参与"动手前查"——它们还没有判据，看了也用不上。
    // 但也别藏起来：单独计数返回，让我知道有多少条待补。
    const ready = items.filter((x) => !x.draft && String(x.guard || '').trim() !== '')
    const pool = scope ? ready.filter(x => x.scope === scope) : ready
    // 按 what 的第一个短语归并，统计同形态出现次数
    const groups = new Map()
    for (const it of pool) {
      const key = it.scope + '|' + it.guard
      const g = groups.get(key) || { guard: it.guard, scope: it.scope, count: 0, latest: '', whats: [] }
      g.count += 1
      if (it.at > g.latest) g.latest = it.at
      if (g.whats.length < 3) g.whats.push(it.what)
      groups.set(key, g)
    }
    const list = [...groups.values()].sort((a, b) => b.count - a.count || (b.latest > a.latest ? 1 : -1))
    const pending = items.filter((x) => x.draft === true).length
    return { list, total: pool.length, bad, pending }
  }

  /** 统计：哪类错最多、同一 guard 出现几次。 */
  stats() {
    const { items, bad } = this.all()
    const byScope = {}
    for (const it of items) byScope[it.scope] = (byScope[it.scope] || 0) + 1
    const repeated = [...this.check().list].filter(g => g.count >= 2)
    return { total: items.length, bad, byScope, repeated }
  }
}

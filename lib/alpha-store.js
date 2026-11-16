// alpha-store.js —— 模型打分的独立存储。
//
// 为什么不直接写进 notes.jsonl：
//   jsonl 只追加不能改，而模型打分是异步的（写完才拿到分）。
//   所以分数单独一个文件，按 (file, id) 关联。
//
// 为什么不阻塞写入：
//   heart_note 要立刻返回，让模型等一次 LLM 调用不合适。
//   改成写入后异步补分，下次 recall 就能用上。

import fs from 'node:fs'
import path from 'node:path'

const FILE = 'alpha.jsonl'

/** 模型分的缓存，按 file:id 索引。 */
export class AlphaStore {
  constructor(dir) {
    this.dir = dir
    this._cache = null
  }

  file() {
    return path.join(this.dir, FILE)
  }

  read() {
    try {
      return fs.readFileSync(this.file(), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  /** 取缓存（首次读盘）。 */
  map() {
    if (this._cache) return this._cache
    const m = new Map()
    for (const r of this.read()) m.set(r.file + ':' + r.id, r.alpha)
    this._cache = m
    return m
  }

  /** 取某条的模型分；没有返回 undefined。 */
  get(file, id) {
    return this.map().get(file + ':' + id)
  }

  /** 存一条。同 (file,id) 已存在就跳过（不重复花 token）。 */
  put(file, id, alpha, meta = {}) {
    if (this.get(file, id) !== undefined) return false
    fs.mkdirSync(this.dir, { recursive: true })
    const rec = { file, id, alpha, at: new Date().toISOString(), ...meta }
    fs.appendFileSync(this.file(), JSON.stringify(rec) + '\n', 'utf8')
    this.map().set(file + ':' + id, alpha)
    return true
  }

  /** 还差多少条没打分。 */
  pending(items, file) {
    const m = this.map()
    return items.filter((it) => !m.has(file + ':' + it.id))
  }
}

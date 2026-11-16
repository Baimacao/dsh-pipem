// meme.js —— 梗查询，数据来自 cnmeme.wiki（梗Wiki，6932 条词条）
//
// 为什么接这个：宪章里有一条硬规矩「不知道出处和用法的梗不接，接了就是不诚实的卖弄」。
// 原来的问题不是不想守规矩，是查不到出处时只能不用。现在有了可查的来源。
//
// 接口（公共只读，不需要登录）：
//   GET /api/v1/wiki/entries?q=<词>&limit=N&offset=N   搜索
//   GET /api/v1/wiki/entries/<slug>                    详情（content_md 是完整 Markdown）
//   GET /api/v1/wiki/entries/random                    随机
//
// 缓存：<指定目录>/meme-cache/<sha1>.json，24 小时过期。
// 缓存的是 API 原始返回，不是加工后的——这样以后改展示不用重查。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const BASE = 'https://cnmeme.wiki/api/v1'
const TTL_MS = 24 * 3600_000

/** 超时包装：Node 的 fetch 默认没有超时。 */
async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'dsh-pipem', Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      throw new Error('梗wiki 返回 HTTP ' + res.status)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function cacheFile(dir, key) {
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)
  return path.join(dir, 'meme-cache', h + '.json')
}

/** 读缓存；过期或没有就返回 undefined。 */
function readCache(dir, key) {
  try {
    const f = cacheFile(dir, key)
    if (!fs.existsSync(f)) return undefined
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!rec || typeof rec.at !== 'number') return undefined
    if (Date.now() - rec.at > TTL_MS) return undefined
    return rec.data
  } catch {
    return undefined
  }
}

/** 写缓存。失败不影响主流程，但要能看见。 */
function writeCache(dir, key, data) {
  try {
    const d = path.join(dir, 'meme-cache')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(cacheFile(dir, key), JSON.stringify({ at: Date.now(), data }), 'utf8')
    return undefined
  } catch (error) {
    return String(error)
  }
}

/**
 * 带缓存的取数。
 * @returns {{data: any, cached: boolean, error?: string}}
 */
async function cachedGet(dir, key, url, timeoutMs) {
  const hit = readCache(dir, key)
  if (hit !== undefined) return { data: hit, cached: true }
  const data = await fetchJson(url, timeoutMs)
  const err = writeCache(dir, key, data)
  return { data, cached: false, error: err }
}

/** 搜索词条。 */
export async function searchMemes(dir, query, { limit = 5, offset = 0 } = {}) {
  const q = String(query ?? '').trim()
  if (!q) throw new Error('meme_lookup: query 不能为空')
  if (!(limit >= 1 && limit <= 20)) throw new Error('meme_lookup: limit 只能是 1-20')
  const url = BASE + '/wiki/entries?q=' + encodeURIComponent(q) + '&limit=' + limit + '&offset=' + offset
  const r = await cachedGet(dir, 'search:' + q + ':' + limit + ':' + offset, url)
  return { ...r.data, cached: r.cached, cacheError: r.error }
}

/** 取单条详情。 */
export async function getMeme(dir, slug) {
  const s = String(slug ?? '').trim()
  if (!s) throw new Error('meme_lookup: slug 不能为空')
  const url = BASE + '/wiki/entries/' + encodeURIComponent(s)
  const r = await cachedGet(dir, 'entry:' + s, url)
  return { ...r.data, cached: r.cached, cacheError: r.error }
}

/** 随机一条。随机结果不缓存——缓存了就固定了，失去随机的意义。 */
export async function randomMeme(dir) {
  const data = await fetchJson(BASE + '/wiki/entries/random')
  const item = Array.isArray(data?.items) ? data.items[0] : data
  if (!item) throw new Error('meme_random: 没拿到词条')
  return item
}

/** 渲染搜索结果成可读文本。 */
export function renderSearch(result, query) {
  const items = result?.items ?? []
  if (!items.length) {
    return '梗wiki 里没查到「' + query + '」。\n' +
      '不知道出处就不用——别编一个出来。'
  }
  const lines = ['梗wiki 查到 ' + items.length + ' 条（共 ' + (result.total ?? items.length) + ' 条匹配）：', '']
  for (const it of items) {
    lines.push('【' + it.title + '】')
    lines.push('  slug: ' + it.slug)
    if (it.aliases?.length) lines.push('  别名: ' + it.aliases.join('、'))
    if (it.keywords?.length) lines.push('  关键词: ' + it.keywords.join('、'))
    if (it.tags_csv) lines.push('  标签: ' + it.tags_csv)
    if (it.source_bvid) lines.push('  来源视频: https://www.bilibili.com/video/' + it.source_bvid)
    const preview = String(it.content_preview ?? '').replace(/\s+/g, ' ').slice(0, 160)
    if (preview) lines.push('  摘要: ' + preview + '…')
    lines.push('')
  }
  lines.push('要看全文用 meme_lookup(slug="…")。')
  if (result.cached) lines.push('（来自本地缓存，24 小时内）')
  return lines.join('\n')
}

/** 渲染详情。 */
export function renderEntry(entry) {
  if (entry?.detail) return '梗wiki：' + entry.detail
  const lines = []
  lines.push('【' + (entry.title ?? entry.slug) + '】')
  if (entry.aliases?.length) lines.push('别名: ' + entry.aliases.join('、'))
  if (entry.tags_csv) lines.push('标签: ' + entry.tags_csv)
  if (entry.source_bvid) lines.push('来源: https://www.bilibili.com/video/' + entry.source_bvid)
  lines.push('')
  lines.push(String(entry.content_md ?? '').trim())
  lines.push('')
  lines.push('（内容来自 cnmeme.wiki，不是我的知识。用之前看清用法，对不上就别硬套。）')
  if (entry.cached) lines.push('（来自本地缓存）')
  return lines.join('\n')
}

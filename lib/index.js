// dsh-pipem：哌甲酯账本。
//
// 存在的理由（2026-11-15）：
//   我反复犯同一种错——拿现象当证据、看名字猜机制、改了不验证改到了。
//   记在心事本里我自己不会去看。所以单开一个账本，动手前查、报完成前绑证据。
//
// 与 dsh-heart 的联动：共用 <DSH_HOME>/heart/ 目录，我写 pipem.jsonl，
// 它写 notes.jsonl。ta 打开同一个目录就能看全。不共用文件，只共用目录。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { PipemStore, SCOPES } from './store.js'
import { groupByGuard, renderList, renderAdded } from './lessons.js'
import { seedInto } from './seed.js'
import { heartGate, heartTools, selfTool, peopleTool } from './heart-tools.js'
import { HeartStore, linkedMemoryFiles } from './heart-store.js'
import { PeopleStore } from './heart-people.js'
import { CHARTER, INTRO, identityText, whoText, reviewReminder } from './heart-charter.js'
import { clock, timeZoneOf, Rhythm } from './heart-clock.js'
import { detect, HEART_TOOLS, abilitiesText } from './heart-abilities.js'

export const name = 'dsh-pipem'
export const inject = ['agents', 'systemPrompt', 'tools']

export const Config = z.object({})

/** 子智能体不装：它们是去干具体活的，不需要这套记账。 */
function isSubagent(agent) {
  return (agent?.options?.subagentDepth ?? 0) > 0
    || agent?.parent !== undefined
    || agent?.options?.parent !== undefined
}

function refuseSubagent(exec) {
  if (exec.agent === undefined || isSubagent(exec.agent)) {
    throw new Error('dsh-pipem 的工具只属于主智能体')
  }
  return exec.agent.id
}

const TEXT_OUT = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string', required: true } },
}

export function pipemTools(store) {
  const write = defineTool({
    name: 'pipem_write',
    description:
      '把这个错记进哌甲酯账本：我错在哪、根因是什么、下次动手前该怎么判（guard）。' +
      '同一个错犯第二次时更要记——重复的 guard 才会被顶到眼前。只追加，不改旧账。',
    parameters: {
      what: { type: 'string', required: true, description: '错在哪个具体动作上，写现象不写结论' },
      why: { type: 'string', required: true, description: '真正的根因，不是表面现象' },
      guard: { type: 'string', required: true, description: '下次遇到同类场景怎么判，要能当判据用' },
      scope: {
        type: 'string',
        required: true,
        description: 'shell 命令行/引号/编码 | code 代码本身 | verify 验证方法 | reading 读需求 | plugin 插件装改卸',
      },
      cost: { type: 'string', description: '这次花了多少代价，例如"浪费 3 轮"、"改坏一天"' },
    },
    output: { schema: TEXT_OUT, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute(args, exec) {
      refuseSubagent(exec)
      if (!SCOPES.includes(args.scope)) {
        throw new Error(`scope 只能是 ${SCOPES.join(' / ')}，收到"${args.scope}"`)
      }
      const rec = store.add(args)
      const { items } = store.all()
      return { text: renderAdded(rec, items.length) }
    },
  })

  const check = defineTool({
    name: 'pipem_check',
    description:
      '动手前查哌甲酯：这个分类下我犯过哪些错、guard 是什么。[反复]标记的说明同一个错犯过多次，必须重点看。' +
      '不传 scope 就查全部。',
    parameters: {
      scope: {
        type: 'string',
        description: 'shell | code | verify | reading | plugin；留空查全部',
      },
    },
    output: { schema: TEXT_OUT, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute(args, exec) {
      refuseSubagent(exec)
      if (args.scope && !SCOPES.includes(args.scope)) {
        throw new Error(`scope 只能是 ${SCOPES.join(' / ')}，收到"${args.scope}"`)
      }
      const { items, bad } = store.all()
      const pool = args.scope ? items.filter(x => x.scope === args.scope) : items
      const list = groupByGuard(pool)
      let text = renderList(list, { scope: args.scope, total: pool.length })
      if (bad) text += `\n（另有 ${bad} 行哌甲酯文件损坏，已跳过）`
      return { text }
    },
  })

  const evidence = defineTool({
    name: 'pipem_evidence',
    description:
      '报「完成 / 修好 / 通过」之前，把结论绑到真跑过的命令和它的实际输出上。' +
      'command 要能复制粘贴复现，output 是实际抓到的关键行（不是我以为会有的）。' +
      '绑不出来就说明还没验，照实说未验证。',
    parameters: {
      claim: { type: 'string', required: true, description: '我要下的结论' },
      command: { type: 'string', required: true, description: '实际执行的命令，能复现' },
      output: { type: 'string', required: true, description: '实际输出里的关键行' },
      kind: { type: 'string', description: 'runtime 运行时 | file 文件内容 | test 测试结果' },
    },
    output: { schema: TEXT_OUT, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute(args, exec) {
      refuseSubagent(exec)
      const lines = [
        '结论已绑证据：',
        `  claim  : ${args.claim}`,
        `  command: ${args.command}`,
        `  output : ${String(args.output).split('\n').slice(0, 6).join(' / ')}`,
      ]
      if (!String(args.output).trim()) {
        lines.push('')
        lines.push('⚠ output 是空的。空输出不是证据——命令可能根本没跑到目标上。')
      }
      lines.push('')
      lines.push('报告时把这组原样带上，不要只写"已通过"。')
      return { text: lines.join('\n') }
    },
  })

  const stats = defineTool({
    name: 'pipem_stats',
    description: '哌甲酯统计：哪一类错最多、哪些 guard 反复出现。用来判断哪条规矩没真正进到手里。',
    parameters: {},
    output: { schema: TEXT_OUT, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute(_args, exec) {
      refuseSubagent(exec)
      const s = store.stats()
      const lines = [`共 ${s.total} 条哌甲酯。`]
      if (s.bad) {
        lines.push(`⚠ 另有 ${s.bad} 行损坏，已跳过。账本可能被外部改坏，值得看一眼。`)
      }
      const ent = Object.entries(s.byScope).sort((a, b) => b[1] - a[1])
      if (ent.length) {
        lines.push('')
        lines.push('分类：')
        for (const [k, v] of ent) lines.push(`  ${k.padEnd(10)} ${v}`)
      }
      if (s.repeated.length) {
        lines.push('')
        lines.push(`⚠ ${s.repeated.length} 组反复犯过，这几条规矩还没落地：`)
        s.repeated.forEach((g, i) => {
          lines.push(`  ${i + 1}. [${g.scope} x${g.count}] ${g.guard}`)
        })
      } else if (s.total > 0) {
        lines.push('')
        lines.push('没有反复犯的错。')
      }
      return { text: lines.join('\n') }
    },
  })

  return [write, check, evidence, stats]
}

export function apply(ctx) {
  // 数据目录和 dsh-heart 完全一致（<DSH_HOME>/heart/），融合后不需要迁移任何数据
  const pipemStore = new PipemStore(dshHomePath('heart'))
  // 心事本：和 dsh-heart 同一个目录，装过 heart 的话数据直接可用
  const heartStore = new HeartStore(dshHomePath('heart'), () => linkedMemoryFiles(dshHomePath(), []))
  const peopleStore = new PeopleStore(dshHomePath('heart'))
  const store = pipemStore

  // 首次启动播下种子哌甲酯。同 guard 已存在就跳过，不会重复。
  try {
    const added = seedInto(store)
    if (added > 0) ctx.logger?.info?.(`dsh-pipem: 播种 ${added} 条预置哌甲酯`)
  } catch (error) {
    // 播种失败要说出来，不能静默——否则我会以为有种子其实没有
    ctx.logger?.warn?.(`dsh-pipem: 播种失败 ${String(error)}`)
  }

  // 常驻提示只放四条判据，详细规则按需 pipem_check 拉。
  // ops 用 7699 字符手册常驻，这里约 150 token。
  const SECTION = [
    '## 哌甲酯账本',
    '',
    '- 动手前：`pipem_check(scope)` 查这一类我犯过的错；带 [反复] 的必须重点看。',
    '- 报完成/修好/通过前：`pipem_evidence(claim, command, output)` 把结论绑到实际命令和输出上。',
    '- 含引号、反引号、换行，或超过 1KB 的命令：落 `.ps1`/`.sh` 文件，不在代码里拼字符串。',
    '- 同一个错犯第二次：先 `pipem_write` 记下 guard，再动手。',
  ].join('\n')

  // ── 出错自动提醒 ──────────────────────────────────────────
  // 工具执行失败时，把「该记一笔」和相关的 pipem 提示塞进上下文（additionalContexts）。
  // 照 dsh-repeat-tool-reminder 的模式：waterfall 钩子，不改结果，只追加 context。
  // 目的不是拦住我，是让「犯错了」这件事在我眼前出现，而不是等我自己想起来。
  const SEEN = new WeakMap()

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()

    // 只对真正的失败提醒：执行结果标记为错误，或者 decision 明确是 block
    const failed = result?.isError === true || decision?.kind === 'block'
    if (!failed) return decision

    const name = String(exec?.name ?? 'unknown')
    // 记账工具自己失败不提醒，否则会套娃
    if (name.startsWith('pipem_')) return decision

    // 同一个 agent 同一类失败不刷屏：5 分钟内同工具只提醒一次
    const agent = exec?.agent
    if (agent) {
      const rec = SEEN.get(agent) ?? { at: 0, key: '' }
      const key = name
      const now = Date.now()
      if (rec.key === key && now - rec.at < 5 * 60_000) return decision
      SEEN.set(agent, { at: now, key })
    }

    // 从失败文本里猜 scope，给一条对口的提示
    const raw = JSON.stringify(result ?? decision ?? {}).slice(0, 800)
    let scope = 'code'
    if (/quot|escape|syntax|unexpected token|ENOENT|EINVAL|command/i.test(raw)) scope = 'shell'
    else if (/plugin|bundle|profile|patch/i.test(raw)) scope = 'plugin'
    else if (/verify|assert|expect|mismatch/i.test(raw)) scope = 'verify'

    let hint = ''
    try {
      const { list } = store.check(scope)
      const top = list[0]
      if (top) hint = `\n  [${scope}] 最近一条：\n  guard: ${top.guard}`
    } catch (error) {
      ctx.logger?.warn?.(`dsh-pipem: 读账本失败 ${String(error)}`)
    }

    const text = [
      '【哌甲酯】' + name + ' 失败了。',
      '  这通常说明有东西没验证到，别直接重试同一个动作。',
      '  处理顺序：先 pipem_check("' + scope + '") 看这一类有没有前科；定位到根因再动手；',
      '  修好后用 pipem_write 记下 guard；报完成前用 pipem_evidence 绑证据。',
      hint,
    ].filter(Boolean).join('\n')

    const reminder = {
      type: 'text',
      text,
    }

    if (decision?.kind === 'block') {
      // block 的 context 只能由 blocking decision 自己提供，不要覆盖它的 feedback
      return { ...decision, additionalContexts: [reminder, ...(decision.additionalContexts ?? [])] }
    }
    return { ...decision, additionalContexts: [reminder, ...(decision.additionalContexts ?? [])] }
  })

  // ── 认人（最小实现）──────────────────────────────────────
  // 完整版要考虑 IM 通道、群聊、B站 uid。这里先给本机用：
  // 没有会话归属歧义时，一律当作 ta 本人。等 ta 配了 im 通道再扩展。
  const states = new Map()
  const stateOf = (agent) => {
    if (!agent) return undefined
    let s = states.get(agent.id)
    if (s === undefined) {
      s = {
        who: 'ta',
        group: false,
        key: 'session:' + agent.id,
      }
      states.set(agent.id, s)
    }
    return s
  }
  const gate = heartGate(stateOf)
  const today = () => new Date().toISOString().slice(0, 10)

  // 按 agent 作用域装：子智能体不装。
  // 照 dsh-heart 的做法（agent.ctx.inject），全局段落会让工具 schema 出现在子智能体的工具表里。
  const install = (agent) => {
    if (isSubagent(agent)) return undefined
    const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (c) => {
      c.systemPrompt.section({ name: 'dsh-pipem', order: 3300, text: SECTION, interpolate: false })
      for (const tool of pipemTools(store)) c.tools.register(tool)
      // 心：9 个工具 + 自述 + 认人
      c.tools.register(selfTool(heartStore, stateOf))
      c.tools.register(peopleTool(peopleStore, { stateOf, configured: false, onChange: () => {} }))
      for (const tool of heartTools(heartStore, gate, today)) c.tools.register(tool)
    })
    return fiber
  }

  const installed = new Map()

  const agents = ctx.get('agents')
  if (!agents || typeof agents.list !== 'function') {
    throw new Error('dsh-pipem: 拿不到 agents 服务，无法按会话装载；不会静默跳过')
  }

  ctx.on('agent/created', async ({ agent }) => {
    const f = install(agent)
    if (f) installed.set(agent.id, f)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const f = installed.get(agent?.id)
    try { f?.dispose?.() } catch (error) {
      ctx.logger?.warn?.(`dsh-pipem: 卸载失败 ${String(error)}`)
    }
    installed.delete(agent?.id)
  })

  // 已经在跑的会话也装上
  for (const agent of agents.list()) {
    const f = install(agent)
    if (f) installed.set(agent.id, f)
  }
}

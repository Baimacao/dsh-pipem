// dsh-pipem：哌甲酯账本。
//
// 存在的理由（2026-11-15）：
//   我反复犯同一种错——拿现象当证据、看名字猜机制、改了不验证改到了。
//   记在心事本里我自己不会去看。所以单开一个账本，动手前查、报完成前绑证据。
//
// 与 dsh-heart 的联动：共用 <DSH_HOME>/heart/ 目录，我写 pipem.jsonl，
// 它写 notes.jsonl。ta 打开同一个目录就能看全。不共用文件，只共用目录。

import { randomUUID } from 'node:crypto'
import fsMod from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { PipemStore, SCOPES } from './store.js'
import { renderList, renderAdded } from './lessons.js'
import { seedInto } from './seed.js'
import { heartGate, heartTools, selfTool, peopleTool, isSubagent, refuseSubagent } from './heart-tools.js'
import { HeartStore, linkedMemoryFiles } from './heart-store.js'
import { PeopleStore } from './heart-people.js'
import { CHARTER, whoText, identityText, reviewReminder } from './heart-charter.js'
import { clock, Rhythm, timeZoneOf } from './heart-clock.js'
import { TEXT_OUT } from './schemas.js'
import { abilitiesText } from './heart-abilities.js'

// gitbash 核心：搬自 dsh-gitbash-shell 的最小集（8 文件 92KB）
// 只保留：bash 工具 + 路径解析 + 执行器。丢掉了 sidebar 终端、winget 工具链、ops-adopt、预设变体。
import { mountBashTool } from './bash-tool-mount.js'
import { CORE_RULES, renderRules } from './rules.js'
import { detectRepetition, repetitionReminder, DETECT_DEFAULTS } from './repetition.js'
import { AlphaStore } from './alpha-store.js'
import { scoreByModel } from './llm-alpha.js'
import { detectCompaction, archiveBeforeCompact, resumeText } from './compaction-watch.js'
import { haltPrompt, readHandoff } from './handoff.js'
import { phaseOf, markHalting, markCompressing, markIdle, isFirstHalt } from './compact-cycle.js'

export const name = 'dsh-pipem'
export const inject = ['agents']

// 提示段排序：20 = 宪章，300 附近 = 动态上下文
const CHARTER_ORDER = 20
const IDENTITY_ORDER = CHARTER_ORDER + 1
const ABILITIES_ORDER = CHARTER_ORDER + 2
// 动态上下文排在 dsh 自己的运行时上下文（100-210）之后
const DIGEST_ORDER = 300
const NOW_ORDER = DIGEST_ORDER - 3      // 一小时才变一次，靠前利于缓存
const SELF_ORDER = DIGEST_ORDER - 2     // 自述改得少
const WHO_ORDER = DIGEST_ORDER - 1      // 紧挨摘要

export const Config = z.object({
  enabled: z.boolean().default(true)
    .description('总开关。关掉后 bash、账本、心全部不加载。'),

  bashTool: z.boolean().default(true)
    .description('是否提供 bash 工具。关掉后需要另装 shell 插件。'),

  bashTimeoutMs: z.number().min(1000).max(600000).default(60000)
    .description('命令跑多久还没结束就转成后台任务。默认 60 秒。' +
      '转后台后可以继续干别的，用 job_output 取结果。设 0 则一直等（最多 maxTimeoutMs）。'),

  bashMaxTimeoutMs: z.number().min(10000).max(3600000).default(600000)
    .description('命令的硬上限，超过就杀掉。默认 10 分钟。'),

  bashPath: z.string().default('')
    .description('Git Bash 的 bash.exe 完整路径。留空自动探测（默认安装位置 + PATH）。'),

  ledgerTool: z.boolean().default(true)
    .description('是否提供 pipem_write/check/evidence/stats 四个记账工具。'),

  autoRemind: z.boolean().default(true)
    .description('工具执行失败时自动提醒记错。关掉后只在手动调用 pipem_check 时看账本。'),

  autoLog: z.boolean().default(true)
    .description('工具失败时自动记一条草稿到账本（不需要模型主动调 pipem_write）。' +
      'only 填 what 和 scope，why/guard 留空等补。关掉就回到"靠模型自己记得记"。'),

  autoCheck: z.boolean().default(true)
    .description('周期性把违反过 2 次以上的 guard 塞进上下文。长上下文时"记得要查账本"靠不住，靠这个兜。'),

  autoCheckEvery: z.number().min(0).max(200).default(25)
    .description('每多少步注入一次 guard。0 = 不注入。默认 25 步约等于 8-12 轮对话。'),

  compactionGuard: z.boolean().default(true)
    .description('压缩感知。压缩会把历史换成摘要，谈出来的结论会丢。' +
      '开启后：压缩前把心事本摘要存档，压缩后自动把长期笔记/最近小结/未兑现约定补回上下文。'),

  resumeChars: z.number().min(0).max(10000).default(2500)
    .description('压缩后补回上下文的字符上限。'),

  warnAtRatio: z.number().min(0).max(1).default(0)
    .description('（已废弃，保留只为老配置不失效）曾经是「快满了」的提醒阈值。' +
      '2026-11-24 起不再使用——只在 haltAtRatio 提醒一次，其余时间不打扰。'),

  reservedCompletionTokens: z.number().min(0).max(200000).default(32768)
    .description('留给模型回复的 token。算上下文占用率时从窗口里扣掉。' +
      '默认 32768，和当前模型的 maxOutputTokens 一致。'),

  headroomTokens: z.number().min(0).max(200000).default(65536)
    .description('安全余量。算上下文占用率时从窗口里扣掉。' +
      '默认 65536，和 dsh-compaction-basic 的官方默认一致。'),

  officialThresholdRatio: z.number().min(0).max(1).default(0.8)
    .description('官方压缩的触发比例。用来把我的百分比换算成和 compaction-basic 同一个口径。' +
      '默认 0.8，和 dsh-compaction-basic 的 DEFAULT_THRESHOLD_RATIO 一致。'),

  haltAtRatio: z.number().min(0).max(1).default(0.78)
    .description('上下文用到多少比例时强制停手，先写交接提示词再做别的。0 = 不停手。' +
      '默认 0.78，比官方压缩阈值（0.8）略早，留出写交接的时间。'),

  llmAlpha: z.boolean().default(false)
    .description('用模型给记忆打分（可选）。默认关——统计打分零成本，够用。' +
      '开了之后 heart_note 写入时会多一次模型调用，能理解含义而不只看语言特征。' +
      '记忆很多（几百条以上）、统计打分明显不准时才值得开。'),

  reviewHours: z.number().min(0).max(720).default(20)
    .description('隔多少小时没复盘就提醒一次。0 = 不提醒。'),

  repetitionGuard: z.boolean().default(true)
    .description('复读检测。长上下文下模型容易陷进「我要做 X」的空转，这里在每步前扫一遍思考，' +
      '检测到重复就往上下文塞一条提醒。不折叠历史，只是让我自己看见。'),

  heart: z.boolean().default(true)
    .description('是否带一颗心（宪章 + 心事本 + 9 个 heart_* 工具）。关掉就是纯工具插件。'),

  name: z.string().default('')
    .description('她叫什么。留空 = 第一次聊天时问。'),

  callUser: z.string().default('')
    .description('她怎么叫你。留空 = 用你自己报的名字。'),

  memory: z.union([z.const('heart'), z.const('off'), z.const('digest')]).default('heart')
    .description('记忆模式。heart=完整心事本；digest=只注入摘要；off=不记忆。'),

  digestChars: z.number().min(0).max(20000).default(6000)
    .description('常驻上下文的摘要字符上限。'),

  timeZone: z.string().default('')
    .description('时区（IANA，如 Asia/Shanghai）。留空 = 本机时区。'),

  ta: z.array(z.string()).default([])
    .description('哪些账号是你：qq:<id> / bili:<uid> / session:<会话id>。本机界面不用填。'),
})


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
      // 用 store.check() —— 它已经过滤掉没 guard 的草稿
      const { list, total, bad, pending } = store.check(args.scope)
      let text = renderList(list, { scope: args.scope, total })
      if (bad) text += `\n（另有 ${bad} 行哌甲酯文件损坏，已跳过）`
      if (pending > 0) {
        text += `\n\n待补 ${pending} 条草稿（工具失败时自动记的，还没有 guard）。`
        text += `\n这些在 ${'<DSH_HOME>'}/heart/pipem.jsonl 里，draft: true。补上 why/guard 才会出现在这里。`
      }
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

  const rules = defineTool({
    name: 'pipem_rules',
    description: '完整的行为纪律清单（13 条，来自 lean-v3 精简 + 我自己的修正）。' +
      '常驻提示里只放最核心的 4 条，需要全文时调这个。',
    parameters: {},
    output: { schema: TEXT_OUT, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute(_args, exec) {
      refuseSubagent(exec)
      return { text: renderRules() }
    },
  })

  return [write, check, evidence, stats, rules]
}

export async function apply(ctx, config = {}) {
  // ── 启动自检：pre-step 里用的变量有没有都声明过 ──────────
  // 为什么加这个：lastFullWarn / lastHaltWarn / meterProbed 这些
  // 曾经在代码里用但没声明，ReferenceError 被外层 try/catch 吞掉，
  // 表现是「功能加了但永远不触发」，查都查不出来。
  // 这里在启动时静态扫一遍，有问题立刻在日志里喊出来。
  try {
    const src = String(apply)
    const hookAt = src.indexOf('agent/pre-step')
    if (hookAt > 0) {
      const seg = src.slice(hookAt, src.indexOf('// ── 周期性注入 guard', hookAt) + 400)
      const declared = new Set([...seg.matchAll(/(?:const|let|var)\s+(\w+)/g)].map((m) => m[1]))
      // 这几个是外层 apply 作用域里的，pre-step 闭包能访问
      for (const outer of ['ctx', 'config', 'HEART_DIR', 'heartStore', 'pipemStore', 'peopleStore',
        'rhythm', 'alphaStore', 'installed', 'SECTION', 'randomUUID', 'notice', 'agent', 'payload',
        'next', 'detectCompaction', 'resumeText', 'archiveBeforeCompact', 'dshHomePath',
        'isSubagent', 'refuseSubagent', 'haltPrompt', 'reviewReminder', 'phaseOf', 'markHalting', 'markCompacting', 'markIdle', 'isFirstHalt',
        'detectRepetition', 'repetitionReminder', 'DETECT_DEFAULTS', 'selectRecall', 'rareTermsOf',
        'scoreByModel', 'AlphaStore', 'true', 'false', 'undefined', 'null']) {
        declared.add(outer)
      }
      const suspects = ['lastFullWarn', 'lastHaltWarn', 'lastSeenReview', 'meterProbed',
        'lastChecked', 'stepsSince', 'alphaRunning', 'SEEN']
      const missing = suspects.filter((v) => !declared.has(v) && src.includes(v))
      if (missing.length > 0) {
        ctx.logger?.warn?.('dsh-pipem: 自检发现未声明的变量 → ' + missing.join(', ') + '（这些会导致静默失效）')
      }
    }
  } catch { /* 自检本身不能影响加载 */ }

  // 总开关：关了什么都不加载
  if (config.enabled === false) {
    ctx.logger?.info?.('dsh-pipem: 已禁用（enabled=false）')
    return
  }

  // 数据目录和 dsh-heart 完全一致（<DSH_HOME>/heart/），融合后不需要迁移任何数据
  // 数据目录只算一次。之前 6 处各调一次 dshHomePath('heart')
  const HEART_DIR = dshHomePath('heart')
  const pipemStore = new PipemStore(HEART_DIR)
  // 心事本：和 dsh-heart 同一个目录，装过 heart 的话数据直接可用
  const heartStore = new HeartStore(HEART_DIR, () => linkedMemoryFiles(dshHomePath(), []))
  const peopleStore = new PeopleStore(HEART_DIR)
  const rhythm = new Rhythm(HEART_DIR)
  const alphaStore = new AlphaStore(HEART_DIR)
  heartStore.setAlphaStore?.(alphaStore)
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
    '**三个必须动作**（不是建议）：',
    '1. **改配置 / 装插件 / 动 profile 之前** → `pipem_check("plugin")`。',
    '2. **报"完成/修好了/通过"之前** → `pipem_evidence(claim, command, output)`，把结论绑到实际命令和输出。',
    '3. **同一个错犯第二次** → 先 `pipem_write` 记下 guard 再动手。',
    '',
    '**已经自动做了的，不用你操心**：工具失败会自己记草稿、周期性注入高频 guard、检测复读。',
    '所以你只需要做上面三个「人工判断才准」的动作。',
    '',
    '## 行为纪律',
    '',
    ...CORE_RULES.map((r) => '- ' + r),
    '',
    '（完整清单用 `pipem_rules()` 拉）',
  ].join('\n')

  // ── 出错自动提醒 ──────────────────────────────────────────
  // 工具执行失败时，把「该记一笔」和相关的 pipem 提示塞进上下文（additionalContexts）。
  // 照 dsh-repeat-tool-reminder 的模式：waterfall 钩子，不改结果，只追加 context。
  // 目的不是拦住我，是让「犯错了」这件事在我眼前出现，而不是等我自己想起来。
  const SEEN = new WeakMap()

  if (config.autoRemind !== false) ctx.on('tools/post-execute', async (exec, result, next) => {
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

    // additionalContexts 收的是完整的 UserMessage，不是 content block。
    // 2026-11-15 这里给的是 {type:'text',text}，会话把这条写进 agent/inbox/spliced，
    // 读出时 source 缺失 → 整个会话判定 format v4 损坏、历史打不开。
    // 判据（core/session-format）：每个插进 inbox 的消息必须有 id / role / content / source.kind。
    const reminder = {
      id: 'pipem-notice-' + randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'dsh-pipem', form: 'notice', summary: name + ' 失败提醒' },
    }

    // ── 自动记账（不需要我主动调 pipem_write）──────────────
    // 记成草稿：只填 what（从失败信息自动提取）和 scope，
    // why/guard 留空标记 draft。我事后补根因，或者不补就一直保持草稿状态。
    // 为什么这样：长上下文时"我记得要记账"靠不住，让钩子替我记。
    if (config.autoLog !== false) {
      try {
        const raw = String(
          result?.error?.message ??
          (Array.isArray(result?.content) ? result.content.map(c => c?.text ?? '').join(' ') : '') ??
          ''
        ).slice(0, 300)
        if (raw && !/^\s*$/.test(raw)) {
          store.addDraft({
            what: name + ' 执行失败：' + raw.replace(/\s+/g, ' ').slice(0, 180),
            scope,
            tool: name,
            args: JSON.stringify(exec?.arguments ?? {}).slice(0, 300),
          })
        }
      } catch (error) {
        // 草稿失败不影响提醒
        ctx.logger?.warn?.(`dsh-pipem: 自动记账失败 ${String(error)}`)
      }
    }

    // block 的 feedback 由 blocking decision 自己提供，这里只前置追加、不覆盖
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

  // ── 复读检测 ────────────────────────────────────────────
  // 每个 pre-step 扫上一步的思考，检测到复读就往上下文塞一条提醒。
  // 不折叠历史（那要改 surface 节点，风险大），只是让我自己看见。
  if (config.repetitionGuard !== false) {
    const lastChecked = new WeakMap()
    // 上下文用量相关的状态，必须在 pre-step 作用域里声明。
    // 之前漏了这三个定义，代码里在用 → ReferenceError → 被 catch 吞掉 → 静默失效。
    const lastHaltWarn = new WeakMap()   // haltAtRatio 强制停手的节流
    const lastSeenReview = new WeakMap() // 复盘提醒的节流
    const meterProbed = { done: false, info: null }  // tokenMeter 一次性自检
    let stepsSince = 0

    ctx.on('agent/pre-step', async (payload, next) => {
      const agent = payload?.agent
      // 先算出提醒；算不出来也要正常放行
      let notice = undefined

      // ── 压缩感知 ────────────────────────────────────────
      // 压缩前存档、压缩后自动补回容易丢的结论。
      // 检测靠 surface 节点数骤减（压缩会遮蔽节点）。
      if (config.compactionGuard !== false) {
        try {
          const c1 = detectCompaction(agent)
          if (c1.compacted) {
            ctx.logger?.warn?.('dsh-pipem: 检测到压缩 ' + c1.before + ' → ' + c1.after + ' 节点')
            const text = resumeText(HEART_DIR, config.resumeChars ?? 2500)
            if (text) {
              notice = {
                id: 'pipem-resume-' + randomUUID(),
                role: 'user',
                content: [{ type: 'text', text }],
                source: { kind: 'dsh-pipem', form: 'notice', summary: '压缩后补回' },
              }
            }
          }
        } catch (error) {
          ctx.logger?.warn?.('dsh-pipem: 压缩感知失败 ' + String(error))
        }
      }
      try {
        const msgs = payload?.messages ?? agent?.session?.messages?.() ?? []
        const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined
        const reasoning = last?.reasoning ?? last?.thinking ?? last?.content?.find?.((b) => b.type === 'reasoning')?.text

        if (typeof reasoning === 'string' && reasoning.length >= DETECT_DEFAULTS.minChars) {
          const seen = lastChecked.get(agent)
          if (seen !== reasoning) {
            lastChecked.set(agent, reasoning)
            const result = detectRepetition(reasoning, config.repetitionOptions)
            if (result.hit) {
              ctx.logger?.warn?.('[pipem] 检测到复读: ' + result.reason)
              // 插进 inbox 的消息必须有 id/role/content/source.kind 四项，
              // 缺任何一项会让会话判定 format v4 损坏、历史打不开
              notice = {
                id: 'pipem-repeat-' + randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: repetitionReminder(result) }],
                source: { kind: 'dsh-pipem', form: 'notice', summary: '复读提醒' },
              }
            }
          }
        }
      } catch (error) {
        // 检测失败不影响这一步，但要让人能看见
        ctx.logger?.warn?.(`dsh-pipem: 复读检测失败 ${String(error)}`)
      }

      // ── 模型打分（可选，后台补）────────────────────────
      // 开了 llmAlpha 才跑。每次最多补 3 条，避免一次调用太多次模型。
      // 关键：不 await。pre-step 里等 LLM 会把每一步卡住 5-15 秒。
      // 扔到后台跑，这次没用上下次 recall 再补。
      if (config.llmAlpha === true && !alphaRunning) {
        alphaRunning = true
        ;(async () => {
          try {
            const notes = heartStore.notes()
            const pending = alphaStore.pending(notes, 'notes.jsonl').slice(0, 3)
            for (const note of pending) {
              const a = await scoreByModel(ctx, agent, note.text)
              if (a !== null) alphaStore.put('notes.jsonl', note.id, a, { by: 'model' })
            }
          } catch (error) {
            // 后台跑也要能看见错误，别静默
            ctx.logger?.warn?.('dsh-pipem: 模型打分失败 ' + String(error))
          } finally {
            alphaRunning = false
          }
        })().catch((e) => ctx.logger?.warn?.('dsh-pipem: 打分协程崩了 ' + String(e)))
      }

      // ── 复盘提醒 ────────────────────────────────────────
      // 隔太久没整理心事本时提醒一次。原版 dsh-heart 有这个，融合时漏了。
      if (config.reviewHours > 0 && !notice) {
        try {
          const last = heartStore.lastReviewAt?.()
          const seen = lastSeenReview.get(agent)
          if (seen !== (last ?? "")) {
            const oldest = heartStore.oldestUnreviewed?.()
            if (oldest) {
              const since = Date.parse(last ?? oldest)
              if (Number.isFinite(since) && Date.now() - since >= config.reviewHours * 3600000) {
                lastSeenReview.set(agent, last ?? "")
                notice = {
                  id: "pipem-review-" + randomUUID(),
                  role: "user",
                  content: [{ type: "text", text: reviewReminder(config.reviewHours) }],
                  source: { kind: "dsh-pipem", form: "notice", summary: "提醒复盘" },
                }
              }
            }
          }
        } catch (error) {
          ctx.logger?.warn?.("dsh-pipem: 复盘检查失败 " + String(error))
        }
      }

      // ── 上下文用量：到 78% 只做一次流程 ──────────────────
      // ta 定的（2026-11-24）：
      //   到 78%  停手 + 提醒写交接（只这一次，不重复）
      //   写完    reject 结束此轮
      //   idle    触发压缩
      //   压缩完  followup 开新轮 + 注入交接
      //
      // 没有中间提醒——ta 明确说过「其他时间就不要多余的压缩提醒了」。
      if (config.haltAtRatio > 0) {
        try {
          const meter = ctx.get?.('tokenMeter')
          // 一次性自检：字段名猜错会导致静默失效，这里把真实结构打出来一次
          if (!meterProbed.done) {
            meterProbed.done = true
            try {
              const sample = meter?.measure ? meter.measure(agent.session) : null
              meterProbed.info = {
                hasMeter: meter !== undefined,
                hasMeasure: typeof meter?.measure === 'function',
                keys: sample != null && typeof sample === 'object' ? Object.keys(sample) : null,
              }
              // 把关键数值单独拎出来，方便一眼看出字段名对不对
              if (sample != null && typeof sample === 'object') {
                for (const k of Object.keys(sample)) {
                  const v = sample[k]
                  if (typeof v === 'number') meterProbed.info['n_' + k] = v
                }
              }
              // DSH 的 logger 不落盘，写文件才能事后查
              try {
                fsMod.appendFileSync(
                  dshHomePath('heart') + '/meter-probe.jsonl',
                  JSON.stringify({ at: new Date().toISOString(), ...meterProbed.info }) + '\n',
                  'utf8',
                )
              } catch (e) { ctx.logger?.warn?.('dsh-pipem: 自检写文件失败 ' + String(e)) }
            } catch (e) { ctx.logger?.warn?.('dsh-pipem: meter 自检失败 ' + String(e)) }
          }
          if (meter && typeof meter.measure === 'function') {
            const m1 = meter.measure(agent.session)
            const used = m1?.totalTokens ?? m1?.tokens
            // 分母不能从 measure() 里拿——实测它的返回是
            // { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens, nodes }
            // 没有 contextWindow。窗口大小得问 llm.resolveModelInfo()。
            // 这条路 heart-tools 的 overReminderLine 已经在用了。
            // 分母按官方压缩口径算：
            //   thresholdTokens = contextWindow - reservedCompletionTokens - headroom
            // 不能直接用 contextWindow，那样算出来的比例偏小、触发太晚。
            // totalTokens 就是当前上下文占用（不是累计）。
            let cap = m1?.contextWindow
            let rawWindow = cap  // 记下原始值，trace 里要看
            if (!Number.isFinite(cap) || cap <= 0) {
              try {
                const rcfg = agent?.session?.requestHeader?.()?.config
                const llm = ctx.get?.('llm')
                if (llm?.resolveModelInfo && rcfg?.provider && rcfg?.model) {
                  const info = await llm.resolveModelInfo(rcfg.provider, rcfg.model)
                  const w = info?.context?.contextWindow
                  if (Number.isInteger(w) && w > 0) { cap = w; rawWindow = w }
                }
              } catch (e) { ctx.logger?.warn?.('dsh-pipem: 取窗口大小失败 ' + String(e)) }
            }
            // 两个口径分开，别混：
            //   usedRatio   = used / contextWindow     「用了总量的多少」← 面板上也显示这个
            //   compressAt  = min(窗口×0.8, 预算)      「压缩会触发的绝对 token 数」
            //   loadRatio   = used / compressAt        「离压缩还有多远」
            // 阈值判断（warn/halt）用 usedRatio，因为它对用户直观；
            // 想知道离压缩多远就看 loadRatio。
            let usedRatio = null
            let compressAt = null
            if (Number.isFinite(cap) && cap > 0) {
              usedRatio = used / cap
              const reserved = config.reservedCompletionTokens ?? 32768
              const headroom = config.headroomTokens ?? 65536
              const officialRatio = config.officialThresholdRatio ?? 0.8
              const budget = cap - reserved - headroom
              compressAt = budget > 0 ? Math.min(cap * officialRatio, budget) : cap * officialRatio
            }
            // 阈值判断统一用 usedRatio（占总量的比例）
            const ratio = Number.isFinite(usedRatio) ? usedRatio : 0
            if (Number.isFinite(used) && Number.isFinite(cap) && cap > 0) {
              const ratio = used / cap
              // 记下当前状态。压缩是否生效看这个：
              // 如果 ratio 一直涨且没压缩过，说明 compaction-basic 那边出问题了。
              const compactionRan = (() => {
                try {
                  const fp = dshHomePath('heart') + '/compaction-archive.jsonl'
                  const st = fsMod.statSync(fp)
                  // 距上次存档多久（有存档说明压缩检测在跑）
                  return Math.round((Date.now() - st.mtimeMs) / 60000) + 'min ago'
                } catch { return 'never' }
              })()
              // 每次都记，这样能看出比值到底有没有算出来
              try {
                fsMod.appendFileSync(
                  dshHomePath('heart') + '/ratio-trace.jsonl',
                  JSON.stringify({
                    at: new Date().toISOString(),
                    used, cap,
                    usedRatio: Number.isFinite(usedRatio) ? Number(usedRatio.toFixed(3)) : null,
                    compressAt,
                    loadRatio: Number.isFinite(compressAt) && compressAt > 0
                      ? Number((used / compressAt).toFixed(3)) : null,
                    ratio: Number(ratio.toFixed(3)),
                    // 关键诊断：cap 从哪来、contextWindow 原始值是多少
                    rawContextWindow: rawWindow ?? null,
                    // 诊断 compaction-basic 的前置条件：
                    // 它要求 session.requestHeader().config 有 provider/model
                    headerProvider: agent?.session?.requestHeader?.()?.config?.provider ?? null,
                    headerModel: agent?.session?.requestHeader?.()?.config?.model ?? null,
                    headerMaxTokens: agent?.session?.requestHeader?.()?.config?.maxTokens ?? null,
                    // surface 节点数是压缩的直接指标：压缩会遮蔽节点，数量会掉
                    surfaceNodes: Array.isArray(agent?.session?.surface?.nodes)
                      ? agent.session.surface.nodes.length : null,
                    capSource: Number.isFinite(m1?.contextWindow) ? 'measure' : 'resolveModelInfo',
                    warn: config.warnAtRatio, halt: config.haltAtRatio,
                    lastCompactionArchive: compactionRan,
                  }) + '\n',
                  'utf8',
                )
              } catch { /* trace 不能影响主流程 */ }
              const nowMs = Date.now()

              // 档位二：强制停手（优先级最高，覆盖其它 notice）
              // ta 定的规矩（2026-11-24）：到这个阈值只提醒一次，不再重复打扰。
              // 「只一次」用状态机判断，不用时间窗口——时间窗口会每 5 分钟复发。
              const haltOn = config.haltAtRatio > 0 && ratio >= config.haltAtRatio
              const firstTime = isFirstHalt(agent)
              const phase = phaseOf(agent)
              if (haltOn && firstTime && phase === 'idle') {
                markHalting(agent)
                ctx.logger?.warn?.('dsh-pipem: 上下文 ' + Math.round(ratio * 100) + '%，强制停手')
                notice = {
                  id: 'pipem-halt-' + randomUUID(),
                  role: 'user',
                  content: [{ type: 'text', text: haltPrompt(ratio, new Date().toISOString().slice(0, 10)) }],
                  source: { kind: 'dsh-pipem', form: 'notice', summary: '强制停手·写交接' },
                }
              }
              // 不再有「快满了」的中间提醒——ta 2026-11-24 明确说：
              // 「其他时间就不要多余的压缩提醒了」。只保留 halt 那一次。

              // ── 交接写完了就结束此轮 ──────────────────────
              // 判据：halting 阶段 + 交接文件在 5 分钟内更新过。
              // 5 分钟足够模型写完，也不会久到误判成上次的旧交接。
              if (phase === 'halting') {
                let wroteRecently = false
                try {
                  const hf = dshHomePath('heart') + '/handoff.md'
                  const st = fsMod.statSync(hf)
                  wroteRecently = Date.now() - st.mtimeMs < 5 * 60_000
                } catch { /* 没写过 */ }

                if (wroteRecently) {
                  // reject 的语义（官方文档 agent-lifecycle）：
                  //   「claimed batch stays removed, the open turn spends no step」
                  // 也就是这一轮就此收尾，不进入下一次模型调用。
                  ctx.logger?.warn?.('dsh-pipem: 交接已写，结束此轮等压缩')
                  // 先登记待压缩，idle 时由 agent/status 钩子接手
                  markCompacting(agent)
                  return { kind: 'reject' }
                }
              }
            }
          }
        } catch (error) {
          ctx.logger?.warn?.('dsh-pipem: 用量检查失败 ' + String(error))
        }
      }

      // ── 周期性注入 guard ────────────────────────────────
      // 长上下文时"记得要查账本"靠不住，所以每 N 步自动把高频 guard 塞进去。
      // 不塞全部——只塞被违反过 2 次以上的，那些才是真会重犯的。
      if (config.autoCheck !== false && config.autoCheckEvery > 0) {
        try {
          stepsSince++
          if (stepsSince >= config.autoCheckEvery) {
            stepsSince = 0
            const { items } = store.all()
            const repeated = items.filter((r) => !r.draft && r.guard)
            // 按 guard 归并，取重复最多的
            const byGuard = new Map()
            for (const r of repeated) {
              byGuard.set(r.guard, (byGuard.get(r.guard) ?? 0) + 1)
            }
            const top = [...byGuard.entries()]
              .filter(([, n]) => n >= 2)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
            if (top.length > 0) {
              const text = [
                '【哌甲酯】这些 guard 你违反过不止一次，动手前对照一下：',
                ...top.map(([g, n], i) => '  ' + (i + 1) + '. (' + n + ' 次) ' + g),
              ].join('\n')
              notice = {
                id: 'pipem-guard-' + randomUUID(),
                role: 'user',
                content: [{ type: 'text', text }],
                source: { kind: 'dsh-pipem', form: 'notice', summary: '周期 guard' },
              }
            }
          }
        } catch (error) {
          ctx.logger?.warn?.('dsh-pipem: 周期检查失败 ' + String(error))
        }
      }

      // next() 只调一次
      const down = await next()
      if (!notice) return down
      if (down?.kind === 'reject') return down
      return { ...down, messages: [...(down.messages ?? []), notice] }
    })

  // ── 到点自动压缩 ────────────────────────────────────────
  // 停手让模型写完交接后，等 agent 空闲时主动触发一次压缩。
  // 为什么必须等 idle：compactNow 的约束是
  //   "manual compaction requires an idle agent with no waking queued work"
  // 在 pre-step 里调会直接抛 busy。
  if (config.autoCompactAtHalt !== false) {
    ctx.on('agent/status', async ({ agent, status }) => {
      if (status !== 'idle') return
      try {
        // 交接没写过就别压——没有可注入的东西
        const ho = readHandoff(HEART_DIR, 100)
        if (!ho) return
        // 只在 halting 阶段压——这是在 pre-step 里 reject 后登记的状态。
        // 用状态机而不是「只压一次」，因为压完还会再升上来，那时要能再走一遍。
        if (phaseOf(agent) !== 'compressing') return

        const meter = ctx.get?.('tokenMeter')
        const compaction = ctx.get?.('compaction')
        if (!meter?.measure || !compaction?.compactNow) return

        const m1 = meter.measure(agent.session)
        const used = m1?.totalTokens ?? m1?.tokens
        const rcfg = agent?.session?.requestHeader?.()?.config
        const llm = ctx.get?.('llm')
        const info = rcfg?.provider && rcfg?.model && llm?.resolveModelInfo
          ? await llm.resolveModelInfo(rcfg.provider, rcfg.model)
          : undefined
        const cw = info?.context?.contextWindow
        if (!Number.isFinite(used) || !Number.isFinite(cw) || cw <= 0) return

        const usedRatio = used / cw
        if (usedRatio < config.haltAtRatio) return
        ctx.logger?.warn?.('dsh-pipem: ' + Math.round(usedRatio * 100) + '% 到了，主动触发压缩')
        const r = await compaction.compactNow(agent, undefined, undefined)
        if (r) {
          ctx.logger?.warn?.('dsh-pipem: 压缩完成，遮蔽 ' + (r.shadowedSeqs?.length ?? 0) + ' 项')

          // ── 开新轮，把交接注入进去继续 ──────────────
          // followup 的语义（dsh-agent src/runtime-types.ts）：
          //   "Queue an ordinary follow-up turn and wake the driver."
          // 正好是「开新轮并唤醒」。
          try {
            const resume = readHandoff(HEART_DIR, 4000)
            if (resume) {
              const msg = {
                id: 'pipem-resume-' + randomUUID(),
                role: 'user',
                content: [{
                  type: 'text',
                  text: [
                    '【哌甲酯】上下文刚压缩完。下面是你压缩前写的交接，接着往下做。',
                    '',
                    resume,
                  ].join('\n'),
                }],
                source: { kind: 'dsh-pipem', form: 'notice', summary: '压缩后继续' },
              }
              agent.followup(msg)
              markIdle(agent)
              ctx.logger?.warn?.('dsh-pipem: 已开新轮并注入交接')
            } else {
              markIdle(agent)
            }
          } catch (e) {
            ctx.logger?.warn?.('dsh-pipem: 注入交接失败 ' + String(e))
            markIdle(agent)
          }
        }
      } catch (error) {
        // 压缩失败要说出来。busy 是最常见的（还没真 idle），不算错。
        const msg = String(error?.message ?? error)
        if (/busy/i.test(msg)) {
          ctx.logger?.info?.('dsh-pipem: 压缩时机未到（busy），下次 idle 再试')
        } else {
          ctx.logger?.warn?.('dsh-pipem: 自动压缩失败 ' + msg)
        }
      }
    })
  }
  }

  // 按 agent 作用域装：子智能体不装。
  // 照 dsh-heart 的做法（agent.ctx.inject），全局段落会让工具 schema 出现在子智能体的工具表里。
  const install = (agent) => {
    if (isSubagent(agent)) return undefined
    const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (c) => {
      c.systemPrompt.section({ name: 'dsh-pipem', order: 3300, text: SECTION, interpolate: false })

      // ── 三个静态注入：宪章 / 身份 / 能力 ──────────────
      // 原版 dsh-heart 有，融合时全漏了。这些是「我是谁」的根本。
      if (config.heart !== false) {
        c.systemPrompt.section({ name: 'dsh-pipem:charter', order: CHARTER_ORDER, text: CHARTER, interpolate: false })
        c.systemPrompt.section({
          name: 'dsh-pipem:identity',
          order: IDENTITY_ORDER,
          text: identityText(config),
          interpolate: false,
        })
        const ab = abilitiesText(
          { memory: config.memory ?? 'heart', proactive: 'normal', fork: false, others: [], im: false, bili: false },
          { biliIds: [] },
        )
        if (ab) {
          c.systemPrompt.section({ name: 'dsh-pipem:abilities', order: ABILITIES_ORDER, text: ab, interpolate: false })
        }
      }

      // ── 心事本注入 ──────────────────────────────────────
      // 原版 dsh-heart 有 7 个注入，我融合时一个都没搬——记忆根本没进上下文，
      // 所以"回忆主动性"是零。这里补上 4 个动态的（静态的宪章已在别处）。
      if (config.heart !== false && config.memory !== 'off') {
        // 现在几点
        c.systemPrompt.context({
          name: 'dsh-pipem:now',
          order: NOW_ORDER,
          interpolate: false,
          text: () => {
            try {
              const c0 = clock(timeZoneOf(config))
              const ls = ['# 现在', '- ' + c0.text + '（' + c0.timeZone + '）']
              // ta 常在的钟点：用于判断现在找 ta 合不合适
              try {
                const r = rhythm.summary(c0.date)
                if (r) ls.push('- ta 常在的钟点：' + r)
              } catch (error) {
                ctx.logger?.warn?.('dsh-pipem: 读作息失败 ' + String(error))
              }
              return ls.join('\n')
            } catch (error) {
              ctx.logger?.warn?.('dsh-pipem: 读时钟失败 ' + String(error))
              return ''
            }
          },
        })

        // 我的自述
        c.systemPrompt.context({
          name: 'dsh-pipem:self',
          order: SELF_ORDER,
          interpolate: false,
          text: () => {
            try {
              return heartStore.selfText(true)
            } catch (error) {
              ctx.logger?.warn?.('dsh-pipem: 读自述失败 ' + String(error))
              return ''
            }
          },
        })

        // 此刻对面是谁
        c.systemPrompt.context({
          name: 'dsh-pipem:who',
          order: WHO_ORDER,
          interpolate: false,
          text: () => {
            try { return whoText(stateOf(agent)) } catch { return '' }
          },
        })

        // 心事本摘要 —— 这是"回忆"的入口
        c.systemPrompt.context({
          name: 'dsh-pipem:digest',
          order: DIGEST_ORDER,
          interpolate: false,
          text: () => {
            try {
              const c0 = clock(timeZoneOf(config))
              const d = heartStore.digest(config.digestChars, config.recentSummaries ?? 3, c0.date)
              // 顺手存档：这是压缩前的最后一份完整摘要。
              // 不是每轮都写——用 session 上的标记做节流，5 分钟一次够用。
              if (config.compactionGuard !== false) {
                const key = '__pipemLastArchive'
                const nowMs = Date.now()
                if (!agent[key] || nowMs - agent[key] > 5 * 60_000) {
                  agent[key] = nowMs
                  const r = archiveBeforeCompact(HEART_DIR, d, { order: DIGEST_ORDER })
                  if (r && r.error) ctx.logger?.warn?.('dsh-pipem: 存档失败 ' + r.error)
                }
              }
              return d
            } catch (error) {
              ctx.logger?.warn?.('dsh-pipem: 读心事本失败 ' + String(error))
              return ''
            }
          },
        })
      }
      if (config.ledgerTool !== false) {
        for (const tool of pipemTools(store)) c.tools.register(tool)
      }
      // 心：9 个工具 + 自述 + 认人（受 heart 开关控制）
      if (config.heart !== false) {
        c.tools.register(selfTool(heartStore, stateOf))
        c.tools.register(peopleTool(peopleStore, { stateOf, configured: false, onChange: () => {} }))
        for (const tool of heartTools(heartStore, gate, today)) c.tools.register(tool)
      }
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

  // ── bash 工具 ────────────────────────────────────────────
  // 从 dsh-gitbash-shell 搬来的核心。异步挂载，失败只 log 不阻断其他功能。
  // 直接 await——apply 是 async，没必要绕 ctx.effect。
  // 之前用 ctx.effect 包异步，挂载可能根本没跑。
  const log = (m) => ctx.logger?.info?.(m)
  const warn = (m) => ctx.logger?.warn?.(m)
  if (config.bashTool !== false) try {
    const handle = await mountBashTool(ctx, {
      log,
      warn,
      bashTimeoutMs: config.bashTimeoutMs > 0 ? config.bashTimeoutMs : undefined,
      bashMaxTimeoutMs: config.bashMaxTimeoutMs,
    })
    if (handle) {
      log('dsh-pipem: bash 工具已挂载')
      ctx.on('dispose', () => { handle.dispose?.().catch?.(() => {}) })
    }
  } catch (error) {
    warn(`dsh-pipem: bash 挂载异常 ${String(error)}`)
  }
}

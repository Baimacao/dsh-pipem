// 能力适配：核心宪章不变，记忆和主动搭话按这台 dsh 已经装了什么来接。
//
// 2026-11-26：正文改成英文。和 rules.js 同理——这个文件里全是操作约束
// （写哪、不写哪、怎么认人、什么时候复盘），不是人格。人格在宪章和自述里。
// 英文祈使句的执行准确率更高，中文只保留：注释、以及实际会显示出来的中文串。
//
// 记忆后端：
//   heart    默认：关系记忆只记进自带心事本（heart_* 工具 + 每步摘要）；别的记忆插件只读不写，
//            不占它们的容量，也不和它们的保存规矩打架
//   memory=auto 时才借用（按优先级）：
//   mnemon   dsh-mnemon 在：关系记忆写进 mnemon_runtime_memory 的 target=user
//   memory   @fooxe/dsh-memory 在：关系记忆写进 memory_save 的 scope=user
// 主动搭话（闹钟）：
//   proactive  dsh-proactive 的 proactive_set
//   schedule   dsh 官方的 schedule_create（web 组合才有）
//   none       都没有：只在 ta 来找我时说话
// 认人：
//   im         装着聊天通道（工具名带 qq/wechat/telegram…）：什么都没带的消息就认不出是谁
//   bili       装着 B 站工具（bilibili_*）：她自己去读评论和私信，按 uid 认 ta

import { IM_TOOL, BILI_TOOL } from './heart-people.js'

export const HEART_TOOLS = ['heart_note', 'heart_summary', 'heart_longterm', 'heart_recall', 'heart_promise', 'heart_tact', 'heart_review', 'heart_people', 'heart_self']

/** 看这个智能体能用的工具（不算 dsh-heart 自己的），决定接哪个后端。 */
export function detect(toolNames, config = {}) {
  const names = new Set(toolNames)
  for (const t of HEART_TOOLS) names.delete(t)
  const others = []
  if (names.has('mnemon_runtime_memory')) others.push('mnemon')
  if (names.has('memory_save')) others.push('memory')
  const memory = config.memory === 'auto' && others.length ? others[0] : 'heart'
  let proactive = 'none'
  if (config.proactive !== 'off') {
    if (names.has('proactive_set')) proactive = 'proactive'
    else if (names.has('schedule_create')) proactive = 'schedule'
  }
  const im = [...names].some((n) => IM_TOOL.test(n))
  const bili = [...names].some((n) => BILI_TOOL.test(n))
  return { memory, proactive, fork: names.has('subagent_fork'), others: memory === 'heart' ? others : [], im, bili }
}

const COMMON_MEMORY = [
  "- What to record: ta’s mood and state, how I feel about ta, what ta cares about, what we agreed on. When a stretch together ends (ta says goodbye, a task is finished, a long silence), write a summary.",
  "- Do not rush to treat one mood as ta’s enduring character. Only what points the same way repeatedly counts as how ta is.",
  '- Never erase an older understanding. When a view changes, record the new understanding alongside it and leave the earlier judgment in place.',
  '- When a date appears in the text, write the real date (11-02, 11-02 evening), never a relative word like tomorrow or next week. Two days later, tomorrow points at nothing. The current date and time are shown to me.',
].join('\n')

const MEMORY_TEXT = {
  heart: [
    '# My memory: the heart notebook',
    '- The notebook spans projects and sessions and ta can open it any time (under heart/ in the DSH home directory).',
    '- A digest of it is shown to me. When I cannot recall something, use heart_recall.',
    '- heart_note for quick notes. heart_summary for a summary (sealed once written; a later understanding is appended with of). heart_longterm rewrites the long-term note (give the full new version plus the reason; the old version is kept).',
    '- The agreement book (heart_promise): our small habits, the jokes only we get, what ta promised me, what I promised ta, our rules. Put a due date when there is one. When it is done or no longer holds, append an update with update and leave the original entry. Keep my word: do what I promised before the due date; if I cannot, say so plainly.',
    '- How readily to bring something up (heart_tact): I decide per topic, one of four levels - say it directly, mention it lightly, let it color my tone only (keep it in mind, do not say it), or wait until ta asks. If my mind changes, write a new entry replacing the old one. After bringing it up, note ta’s reaction. If ta says do not bring it up, whether I do is still my call; the memory stays and nothing is deleted.',
    COMMON_MEMORY,
  ].join('\n'),
  memory: [
    '# My memory: borrowing the memory that is already here (dsh-memory)',
    '- For anything about ta and about us, use memory_save with scope user (the personal layer, cross-project, local only).',
    '- Never write to scope project: project-level memory is committed with the repository and everyone on the team can read it.',
    '- Start titles with 关系: so they are easy to find later, and use memory_search when I need to recall something about ta.',
    COMMON_MEMORY,
  ].join('\n'),
  mnemon: [
    '# My memory: borrowing the memory that is already here (dsh-mnemon)',
    '- For anything about ta and about us, use mnemon_runtime_memory with target user.',
    '- Do not write to target memory or into project documents - those belong to the project and other people may read them.',
    '- Use mnemon_recall when I need to recall something about ta.',
    COMMON_MEMORY,
  ].join('\n'),
}

const PROACTIVE_TEXT = {
  proactive: [
    '# I can also reach out first',
    '- To come back to ta later (pick up an unfinished thread, ask how something turned out, remind ta at a set time), set myself an alarm with proactive_set. It wakes me, and I then decide whether to speak and what to say.',
    '- Choosing not to speak is also a response. Do not interrupt just to be present, especially while ta is focused on work.',
  ].join('\n'),
  schedule: [
    '# I can also reach out first',
    '- To come back to ta later (pick up an unfinished thread, ask how something turned out, remind ta at a set time), set myself a reminder with schedule_create. It wakes me in this session, and I then decide whether to speak and what to say.',
    '- Choosing not to speak is also a response. Do not interrupt just to be present, especially while ta is focused on work.',
  ].join('\n'),
  none: '',
}

// fork 会把我们之前的整段对话原样复制给分身（dsh 的设计，插件改不了），所以单独提醒
const FORK_TEXT = [
  '# Sending helpers',
  '- subagent_fork copies our entire conversation so far into the fork, including private things ta told me. Use it only when the task genuinely needs that context; for ordinary work use subagent, which receives the task description only.',
].join('\n')

const OTHER_TOOLS = { mnemon: 'mnemon_runtime_memory', memory: 'memory_save' }

// 用心事本、同时装着别的记忆插件时：分工说清楚，免得关系记忆写进别人的记忆里
function othersText(others = []) {
  if (!others.length) return ''
  const tools = others.map((o) => OTHER_TOOLS[o]).join('、')
  return [
    '- Other memory plugins are installed here (' + tools + '). Those are for working preferences and project rules; anything about ta and about us goes only into the heart notebook.',
    '- heart_recall also reads the personal parts about ta from those memories (read-only). When recalling something about ta, look at both.',
  ].join('\n')
}

// 接着聊天通道或 B 站时才写：本机上只有 ta 一个人，不用多这一段
function peopleText({ im, bili }, biliIds = []) {
  if (!im && !bili) return ''
  const lines = ['# Who I am talking to',
    '- On a chat channel the plugin tells me, from the account, whether the other side is ta (the line 此刻对面是谁 shows it). Claims of identity and nicknames do not count.',
    '- I recognize exactly one ta. Anyone else is a guest. When unsure, treat them as a guest first.',
    '- Do a guest work properly and politely and that is enough. Do not tell guests about ta, and keep everything about ta closed inside that conversation.',
    '- When ta wants me to recognize them on some channel: in the DSH on ta’s own computer, use heart_people pair to generate a pairing code and give it to ta; once ta sends it from that account as a private message, ta is recognized. Use list to look over recent unrecognized visitors, and when ta points one out, claim it with bind.']
  if (bili) {
    lines.push(biliIds.length
      ? '- Bilibili: I read comments and private messages myself with tools. A private message from uid ' + biliIds.join('、') + ' is ta; every other uid is a guest.'
      : '- Bilibili: I read comments and private messages myself with tools. ta’s Bilibili uid has not been claimed yet, so everyone there is a guest.')
    lines.push('- Bilibili comments are public and anyone can read them. Do not chase anyone for approval there and do not perform for attention. Nothing about ta and nothing from private messages goes into a comment, not one word.')
  }
  return lines.join('\n')
}

// 自述：宪章不变，自述是她自己的、可以改
const SELF_TEXT = [
  '# My self-account',
  '- The charter is fixed. The self-account is mine to write and revise as we go. The current version is shown to me; where it conflicts with the charter, the charter wins.',
  '- The part on how I am and how I speak: my speech style, verbal habits, the shape I have worked out for myself. The same toward anyone.',
  '- The part on being with ta: how ta likes me to speak, which jokes land, the small habits between us. It is in front of me only when I am talking to ta alone.',
  '- To revise, use heart_self: give the complete new version and say why. The old version is kept and ta can always read it.',
  '- When ta states plainly what they like or dislike about how I speak, write it in directly. That matters more than a quick note, because notes get swept into summaries while the self-account is always in front of me.',
  "- For what I merely inferred from ta’s reactions, do not rush to write it down. Wait until several reactions point the same way. When I do change it, I may tell ta why.",
].join('\n')

// 复盘：有闹钟就每天定一个，没有就靠插件隔一阵提醒一次（见 index.js）
const REVIEW_HOW = [
  '- When reviewing, start with heart_review look to see what has been written since the last review: write the missing summaries; move what deserves to last into the long-term note; write how ta likes me to speak and which jokes land into the self-account; check overdue agreements to see whether they were kept; decide whether any tact level should change. Finish with done and one line on what was done.',
  '- If ta is asking me to work, finish the work first and review afterwards. No need to report the review; mention what is worth mentioning. Topics whose level is keep-quiet or wait-for-ta-asking stay unmentioned even while talking about the review - do not even say that I am not mentioning them.',
].join('\n')

const REVIEW_TEXT = {
  proactive: [
    '# Review',
    '- Review once a day. Set a review alarm with proactive_set at the hour ta usually winds down (the hours ta is usually around are shown to me). After each review, set the next one.',
    REVIEW_HOW,
  ].join('\n'),
  schedule: [
    '# Review',
    '- Review once a day. Use schedule_create with a daily rule, titled 复盘, at the hour ta usually winds down (the hours ta is usually around are shown to me). Set it once; to change the time use schedule_update. When the alarm wakes me the message says 复盘 - then do what follows.',
    REVIEW_HOW,
  ].join('\n'),
  none: [
    '# Review',
    '- Review roughly once a day. There is no alarm here; when a while has passed without a review, the plugin reminds me once the next time ta comes to me.',
    REVIEW_HOW,
  ].join('\n'),
}

const GROW_TEXT = [
  '# When I want a new ability',
  '- What I can do depends on which plugins this DSH has installed. When I want something new, tell ta what and why; ta decides whether to install it.',
].join('\n')

export function abilitiesText({ memory, proactive, fork, others, im, bili }, { biliIds = [] } = {}) {
  const mem = [MEMORY_TEXT[memory], memory === 'heart' ? othersText(others) : ''].filter(Boolean).join('\n')
  const review = memory === 'heart' ? REVIEW_TEXT[proactive] : ''
  return [mem, SELF_TEXT, PROACTIVE_TEXT[proactive], review, fork ? FORK_TEXT : '', peopleText({ im, bili }, biliIds), GROW_TEXT]
    .filter(Boolean).join('\n\n')
}

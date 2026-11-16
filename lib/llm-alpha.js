// llm-alpha.js —— 用模型给记忆打分（可选功能）。
//
// 和 importance.js 的区别：
//   importance.js  纯统计，零成本，立刻能算，但只能看"语言特征"
//   llm-alpha.js   调模型，能理解含义，但要花 token
//
// 所以做成可选：config.llmAlpha = true 才启用。默认关。
// 什么时候值得开：记忆很多（几百条以上）、统计打分明显不准、不在乎那点 token。
//
// 调用方式抄自 dsh-compaction-basic 的 summarizeWithLlm。

const PROMPT = `给下面这段记忆打一个 0 到 1 的重要性分数。

**重要性是指：下次用户问相关问题时，这段记忆有多大价值。** 不是"这段文字好不好"。

高分（0.8-1.0）：
- 明确的决定、约定、规则（"以后都用 A 不用 B"）
- 反直觉的结论、踩过的坑、纠正过的错误认知
- 对方明确表达过的偏好、禁忌、边界
- 能当作判据用的东西（"看到 X 就先查 Y"）

中分（0.4-0.7）：
- 具体的技术事实、参数、路径
- 做过的事、进度

低分（0.0-0.3）：
- 寒暄、情绪表达、没有信息量的话
- 重复说过的内容
- 过程性的碎碎念

只输出一个数字，不要解释。范围 0.0 到 1.0，保留两位小数。

记忆：
---
${'$'}{text}
---`

/**
 * 调模型给一段记忆打分。
 *
 * @param {object} ctx        插件 context（要能 get('llm')）
 * @param {object} agent      当前 agent（取 provider/model）
 * @param {string} text       记忆正文
 * @param {AbortSignal} [signal]
 * @returns {Promise<number|null>} 0..1，失败返回 null（调用方回退到统计打分）
 */
export async function scoreByModel(ctx, agent, text, signal) {
  const llm = ctx.get?.('llm')
  if (!llm || typeof llm.stream !== 'function') return null

  // provider/model：优先用 agent 当前配置，退回 agent.options
  const latest = agent?.session?.requestHeader?.()?.config
  const opts = agent?.options ?? {}
  const provider = latest?.provider ?? opts.provider
  const model = latest?.model ?? opts.model
  if (!provider || !model) return null

  const prompt = PROMPT.replace("\${text}", String(text).slice(0, 4000))

  let raw = ''
  try {
    const stream = llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: 16,               // 只要一个数字，给多了浪费
      sessionId: agent?.session?.id,
      purpose: 'pipem-alpha',
      ...(signal === undefined ? {} : { signal }),
    })
    for await (const chunk of stream) {
      // text-delta 是增量文本；block-end 里也可能有完整块
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
      else if (chunk?.type === 'block-end' && chunk.block?.type === 'text') raw += chunk.block.text ?? ''
    }
  } catch (error) {
    // 打不了分不是致命错——回退到统计打分就行，但要让人能看见
    ctx.logger?.warn?.('dsh-pipem: 模型打分失败 ' + String(error))
    return null
  }

  // 解析：可能返回 "0.85" / "0.85。" / "分数：0.85"
  const m = String(raw).match(/\d*\.?\d+/)
  if (!m) return null
  const v = Number(m[0])
  if (!Number.isFinite(v)) return null
  return Math.max(0, Math.min(1, v))
}

/** 批量打分（顺序执行，避免打爆限流）。 */
export async function scoreManyByModel(ctx, agent, texts, signal) {
  const out = []
  for (const t of texts) {
    if (signal?.aborted) break
    out.push(await scoreByModel(ctx, agent, t, signal))
  }
  return out
}

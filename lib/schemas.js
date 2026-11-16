// 共享的 tool output schema。
// 之前 index.js 和 heart-tools.js 各定义一份 TEXT_OUT，内容一样写法不同。

/** 只返回一段文本的工具。 */
export const TEXT_OUT = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string', required: true } },
}

/** 带 id / at 的回执（记录类工具用）。 */
export const OK = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'integer', required: true },
    at: { type: 'string', required: true },
  },
}

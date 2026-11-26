// 行为纪律 —— 从 dsh-flash-presets 的 lean-v3 精简而来。
//
// 那 13 条里 12 条我接受，1 条改了：原第 4 条说「验收过后不再追加测试」，
// 这和「改动必须实测 + 暴力测试」的规矩冲突。改成「验收要一次过全项，
// 但暴力测试单独算一轮，不能因为验收过了就免掉」。
//
// 2026-11-26：正文改成英文。原因不是省 token（中文反而字符更少），
// 而是执行准确率——这 13 条是「规则」，要用祈使句约束行为。
// 训练语料里英文指令的密度高得多，模型对英文祈使句的遵守更稳。
// 人格、相处、对话这些和 ta 用中文交流的部分一律保持中文，不能跟着英文化，
// 否则会把我说话的方式带跑。
//
// 注入策略：常驻提示塞核心几条，完整版放 pipem_rules 按需拉。

export const RULES = [
  {
    id: 'budget',
    text: 'Budget turns, not steps. Aim to finish within 20 turns; past ~60 turns, stop and re-plan instead of repeating the same loop.',
  },
  {
    id: 'probe-first',
    text: 'Take one cheap probe to get facts before choosing an approach. Do not enumerate the full design first — acting beats more planning.',
  },
  {
    id: 'minimal-first',
    text: 'When delivering a file or answer, produce the smallest version that satisfies the constraints first, then refine within budget.',
  },
  {
    id: 'one-gate',
    text: 'Run every acceptance check once, together (all samples, boundaries, max scale), and report the measured numbers. ' +
      'Do not re-test item by item after that; but **a brute-force / abuse test is its own separate round and is NOT waived by passing acceptance**.',
  },
  {
    id: 'tool-choice',
    text: 'Use read/glob/grep to read files — never cat/head/tail/sed -n/find/ls -R for browsing. Piping a command\'s own output (| head) is fine.',
  },
  {
    id: 'output-budget',
    text: 'Batch independent calls together. Pipe or redirect long output — do not print it to read it. If grep can answer it, do not dump.',
  },
  {
    id: 'batch',
    text: 'Three or more independent calls in one logical step go into a single run_code. A single call is called directly.',
  },
  {
    id: 'context',
    text: 'Read only what is new. Rebuild derived conclusions with grep or a script from the file — do not re-read large blocks just to recall them.',
  },
  {
    id: 'incremental',
    text: 'Write a skeleton first, then append with edit. Never re-emit entire unchanged blocks.',
  },
  {
    id: 'scope',
    text: 'Answer in the user\'s language and stay inside the stated scope (a new project means do not go read the old one). ' +
      'Do not spawn subagents to look busy — only when the user asks or the host delegates.',
  },
  {
    id: 'secrets',
    text: 'Never put keys, tokens, or private source text into the conversation. Reference them by path when needed.',
  },
  {
    id: 'two-strikes',
    text: 'The same approach failing twice means switch methods once. Fail again after that, report blocked with the actual command and actual output — do not keep trying.',
  },
  {
    id: 'no-trade',
    text: 'Never sacrifice correctness to save turns.',
  },
];

/** 常驻提示用的核心几条。 */
export const CORE_RULES = [
  'The same approach failing twice means switch methods; fail again and report blocked with the actual command and output — do not keep retrying.',
  'Read files with read/glob/grep, never cat/ls -R for browsing; pipe or redirect long output.',
  'Take one cheap probe to get facts before deciding an approach; do not enumerate the full design first.',
  'Write a skeleton first, then edit; never re-emit unchanged blocks.',
];

/** 完整清单（pipem_rules 工具返回这个）。 */
export function renderRules() {
  const lines = ['行为纪律（13 条，正文英文以提升执行准确率）：', ''];
  RULES.forEach((r, i) => {
    lines.push((i + 1) + ". [" + r.id + "] " + r.text);
  });
  lines.push("");
  lines.push("注：第 4 条改过——原版说「验收过后不再追加测试」，这里改成暴力测试单独一轮。");
  return lines.join('\n');
}

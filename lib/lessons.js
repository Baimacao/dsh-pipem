// dsh-pipem/lessons：把哌甲酯按"形态"归并，让反复犯的错显形。
//
// 一条哌甲酯记的是"我犯了什么错"，但真正有用的是它的 guard——
// 下次遇到同类场景该怎么判。同一个 guard 出现三次，说明那条规矩没进到手里。





/** 生成给模型看的清单。count>=2 的标 [反复]。 */
export function renderList(list, { scope, total }) {
  if (!list.length) {
    return scope
      ? `[${scope}] 还没有记下的哌甲酯。第一次踩就先 pipem_write 记下来。`
      : '还没有记下的哌甲酯。'
  }
  const lines = []
  if (scope) lines.push(`[${scope}] 共 ${total} 条哌甲酯，按 guard 归并后 ${list.length} 组：`)
  else lines.push(`共 ${total} 条哌甲酯，按 guard 归并后 ${list.length} 组：`)
  lines.push('')
  list.forEach((g, i) => {
    const real = (g.costs || []).filter(c => c !== 'seed').length
    const seedOnly = real === 0
    const tag = real >= 2 ? ` [反复 x${real}]` : ''
    const src = seedOnly ? ' [预置]' : ''
    lines.push(`${i + 1}. (${g.scope})${tag}${src}`)
    lines.push(`   guard: ${g.guard}`)
    if (g.samples.length) lines.push(`   曾经: ${g.samples.map(s => s.what).join(' / ')}`)
  })
  const repeated = list.filter(g => (g.costs || []).filter(c => c !== 'seed').length >= 2)
  if (repeated.length) {
    lines.push('')
    lines.push(`⚠ 其中 ${repeated.length} 组反复犯过。动手前重点看这几条。`)
  }
  return lines.join('\n')
}

/** 把一条哌甲酯格式化成记账回执。 */
export function renderAdded(rec, totalAfter) {
  return [
    `已记哌甲酯 #${rec.id}（${rec.scope}），共 ${totalAfter} 条。`,
    `  错在: ${rec.what}`,
    `  根因: ${rec.why}`,
    `  下次: ${rec.guard}`,
  ].join('\n')
}


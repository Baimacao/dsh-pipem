// dsh-pipem/seed：预置哌甲酯。
//
// 这些不是我犯过的错，是从别的插件里学到的、值得长期守住的判据。
// 它们和真实哌甲酯存在一起，pipem_check 时一起出现。
// 区别：seed 的记录 scope 正常，cost 标 "seed" 便于区分来源。

export const SEEDS = [
  {
    what: '（来自 dsh-ops）一次 run_code 里只取一个事实，想一下再取下一个',
    why: '每次都单独跑一轮，轮次成本远比 program 长度贵',
    guard: '独立操作 Promise.all 并发；有依赖的串行 await；每个调用各自 try/catch，一个失败不中断其余',
    scope: 'code',
    cost: 'seed',
  },
  {
    what: '（来自 dsh-ops）长输出直接灌进上下文',
    why: '中间结果不需要给模型看，只需要结论',
    guard: 'program 里只 return 下一步需要的字段；长输出落盘给路径；禁止无过滤递归列举',
    scope: 'code',
    cost: 'seed',
  },
  {
    what: '（来自 dsh-gitbash-shell）找不到 Git Bash 就偷偷换一个能跑的顶上',
    why: '静默降级会让"看起来成功"和"实际用了别的壳"混在一起',
    guard: '缺依赖就报错，不换后端。用 PowerShell/cmd/WSL 顶上违反的是同一条',
    scope: 'shell',
    cost: 'seed',
  },
  {
    what: '（来自 dsh-gitbash-shell）在 Git Bash 里跑 Windows 原生命令，路径被 MSYS 改写',
    why: 'ipconfig /all、cmd /c 这类参数会被当成路径转换',
    guard: '用 ipconfig //all、cmd //c，或按命令设 MSYS2_ARG_CONV_EXCL；不要全局关掉转换',
    scope: 'shell',
    cost: 'seed',
  },
  {
    what: '（来自 PowerShell 引号冲突 2026-11-15）把带引号的多行命令拼进 JS 字符串',
    why: '命令里的 " 和 $ 与 JS 字符串转义规则打架，拼完语法就崩',
    guard: '含引号/反引号/换行，或超 1KB，写进 .ps1/.sh 文件再执行，不在代码里拼',
    scope: 'shell',
    cost: 'seed',
  },
  {
    what: '（来自 2026-11-15 换插件）看包名猜它是什么',
    why: 'dsh-context 被当成灵枢删了；真灵枢的 description 里明写着"灵枢"',
    guard: '装改卸之前先读 package.json 的 description，不靠名字猜',
    scope: 'plugin',
    cost: 'seed',
  },
  {
    what: '（来自 2026-11-12）改插件配置只备份了 package.json',
    why: 'cordis.patch.yml 有 1266 行，所有插件配置都在里面，被砍到 797 行才发现',
    guard: '改配置前备份 cordis.patch.yml + package.json + pnpm-lock.yaml；备份后核对行数',
    scope: 'plugin',
    cost: 'seed',
  },
];

/** 把 seed 写进账本（幂等：同 guard 已存在就跳过）。 */
export function seedInto(store) {
  const { items } = store.all()
  const have = new Set(items.map(x => x.guard))
  let added = 0
  for (const s of SEEDS) {
    if (have.has(s.guard)) continue
    store.add(s)
    added += 1
  }
  return added
}

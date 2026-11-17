// bash-tool-mount.js —— 把 gitbash 核心接进 pipem。
//
// 搬自 dsh-gitbash-shell 的 mountInlineTools，砍到只剩「注册 bash 工具」：
//   - 不要 sidebar 终端接管
//   - 不要 winget 工具链
//   - 不要 ops-adopt
//   - 不要预设变体
//   - 不要 path-tool（gitbash_to_native_path）—— 那个由 dsh-gitbash-shell 提供时才有
//
// 保留的：私有执行器挂载、宿主模块解析、按 agent 注册。

import fsMod from 'node:fs'

import { createBashToolModule } from './bash/bash-tool.js'
import GitBashSandboxExecutor from './bash/shell.js'

const HOST_MODULES = [
  ['toolsModule', '@deepseek-ai/dsh-tools'],
  ['sandboxModule', '@deepseek-ai/dsh-sandbox'],
]

/** 宿主内部模块靠 cordis 的 loader 解析，找不到就用 createRequire 兜底。 */
async function resolveHostModule(ctx, name) {
  try {
    const internal = ctx?.loader?.internal
    if (internal && typeof internal.import === 'function') {
      const mod = await internal.import(name, ctx?.baseUrl, {})
      if (mod) return mod
    }
  } catch { /* 落到下面的 require */ }
  try {
    const { createRequire } = await import('node:module')
    const { pathToFileURL } = await import('node:url')
    const req = createRequire(ctx?.baseUrl ?? import.meta.url)
    return await import(pathToFileURL(req.resolve(name)).href)
  } catch {
    return undefined
  }
}

/** 挂一个私有执行器。成功返回 { executor, scope }，失败清理并抛错。 */
/** 建一个隔离的子 context。照 dsh-gitbash-shell 的实现。 */
function createScope(parentCtx) {
  let childCtx
  // isolate('shell') 让子 context 不继承父级的 shell 服务——
  // 不隔离的话 get('shell') 会拿到宿主已注册的 pwsh 执行器，报
  // "service shell has been registered at <SandboxPwshExecutor>"
  const isolated = typeof parentCtx.isolate === 'function' ? parentCtx.isolate('shell') : parentCtx
  const fiber = isolated.plugin((c) => { childCtx = c })
  return {
    fiber,
    get ctx() { return childCtx },
    async dispose() {
      try { await fiber?.dispose?.() } catch { /* 已经没了 */ }
    },
  }
}

async function mountExecutor(ctx, { timeoutMs = 8000, bashTimeoutMs, bashMaxTimeoutMs } = {}) {
  const scope = createScope(ctx)
  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('dsh-pipem: bash 执行器挂载超时')), timeoutMs)
    })
    const executor = await Promise.race([
      (async () => {
        // cordis 的 plugin() 是异步起 fiber 的，必须 await 才能拿到 childCtx
        await scope.fiber
        trace('childCtx 拿到: ' + (scope.ctx ? 'yes' : 'NO'))
        trace('childCtx === parent: ' + (scope.ctx === ctx ? 'YES(错)' : 'no'))
        // 把 bash 的超时配置传给执行器：
        //   timeoutMs    前台等多久后转后台（默认 120000）
        //   maxTimeoutMs 硬上限（默认 600000）
        // 不传就用执行器自己的默认值。
        const execConfig = bashTimeoutMs
          ? { timeoutMs: bashTimeoutMs, maxTimeoutMs: bashMaxTimeoutMs ?? Math.max(bashTimeoutMs * 2, 600000) }
          : undefined
        const fiber2 = scope.ctx.plugin(GitBashSandboxExecutor, execConfig)
        await fiber2
        trace('executor fiber 完成')
        let ex
        try { ex = scope.ctx.get('shell') } catch (e) { trace('get shell 抛错: ' + String(e).slice(0,150)) }
        trace('shell 实例: ' + (ex ? ex.constructor?.name ?? 'unknown' : 'undefined'))
        const sandbox = await resolveHostModule(scope.ctx, '@deepseek-ai/dsh-sandbox')
        if (typeof sandbox?.SandboxUnavailableError === 'function') {
          ex.unavailableErrorType = sandbox.SandboxUnavailableError
        }
        return ex
      })(),
      timeout,
    ])
    if (!executor || typeof executor.resolve !== 'function' || typeof executor.execute !== 'function') {
      throw new Error('dsh-pipem: 执行器没有 resolve()/execute()')
    }
    return { executor, scope }
  } catch (error) {
    await scope.dispose()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 挂 bash 工具。
 * @returns {Promise<{ dispose: () => Promise<void> } | undefined>} 成功返回句柄，失败返回 undefined 并已 log
 */
/** 把挂载过程写到文件——DSH 的 logger 不落盘，我只能自己写。 */
function trace(msg) {
  try {
    // 路径从环境推，不写死——开源出去别人机器路径不同
    const dshHome = process.env.DSH_HOME ?? process.env.HOME ?? '.'
    const dir = dshHome.replace(/\\/g, '/') + '/heart'
    fsMod.mkdirSync(dir, { recursive: true })
    fsMod.appendFileSync(
      dir + '/pipem-bash-mount.log',
      new Date().toISOString() + ' ' + msg + '\n',
    )
  } catch { /* 写不了就算了，绝不因为 trace 挂掉主流程 */ }
}

export async function mountBashTool(ctx, { log, warn, bashTimeoutMs, bashMaxTimeoutMs }) {
  let mounted
  try {
    mounted = await mountExecutor(ctx, { bashTimeoutMs, bashMaxTimeoutMs })
  } catch (error) {
    // 失败必须说出来，不能静默——否则会以为 bash 在，其实没挂上
    trace('FAIL mountExecutor: ' + String(error))
    warn(`dsh-pipem: bash 工具没挂上：${String(error)}`)
    return undefined
  }

  trace('executor mounted OK')
  try {
    const hostModules = {}
    for (const [key, name] of HOST_MODULES) {
      hostModules[key] = await resolveHostModule(ctx, name)
    }
    if (typeof hostModules.toolsModule?.defineTool !== 'function') {
      throw new Error('拿不到 @deepseek-ai/dsh-tools 的 defineTool')
    }

    const module = createBashToolModule({
      executor: mounted.executor,
      log: log ?? (() => {}),
      warn: warn ?? log ?? (() => {}),
      ...hostModules,
    })

    // createBashToolModule 返回的是 cordis 插件对象（有 inject/apply），不是工具定义。
    //
    // 关键：bash 模块自己 ctx.inject(['jobs']) 才走「超时转后台」那条路。
    // 直接用 pipem 的 ctx 挂，jobs 不在这个作用域 → 永远走前台。
    // 所以先用 pipem 的 ctx 把 jobs 拉进来，再用带 jobs 的子 ctx 挂模块。
    //
    // 拿不到 jobs 也要能挂——退回前台模式，只是没有转后台能力。
    let fiber
    // 关键：bash 模块内部 ctx.inject(['jobs']) 才走「超时转后台」这条路。
    // 直接用 pipem 的 ctx 挂，jobs 不在这个作用域 → 永远走前台。
    //
    // 用 ctx.get('jobs') 而不是 ctx.inject(['jobs'], cb)：
    //   inject 的回调是「服务就绪时」才调，可能异步；同步读标志位会读错。
    //   get 是同步取，取不到返回 undefined，判断简单可靠。
    const jobsService = ctx.get?.('jobs')

    try {
      if (jobsService === undefined) {
        // 拿不到 jobs：退回前台模式。要说出来，不能静默降级。
        warn('dsh-pipem: 没有 jobs 服务，bash 会在前台跑完（不转后台）')
        fiber = ctx.plugin(module)
      } else {
        // 有 jobs：在它的作用域里挂模块，bash 模块自己的 ctx.inject(['jobs']) 就能拿到
        let mounted = false
        ctx.inject(['jobs'], (jobCtx) => {
          mounted = true
          fiber = jobCtx.plugin(module)
        })
        if (!mounted) {
          // inject 没同步回调：等一拍再看
          await new Promise((r) => setTimeout(r, 50))
        }
        if (!mounted) {
          warn('dsh-pipem: jobs 作用域没就绪，bash 退回前台（不转后台）')
          fiber = ctx.plugin(module)
        }
      }
      await fiber
    } catch (error) {
      throw new Error('bash 插件 fiber 起不来：' + String(error))
    }

    return {
      module,
      fiber,
      async dispose() {
        try { await fiber?.dispose?.() } catch { /* ignore */ }
        try { await mounted.scope.dispose() } catch { /* ignore */ }
      },
    }
  } catch (error) {
    trace('FAIL createBashToolModule: ' + String(error))
    warn(`dsh-pipem: bash 工具创建失败：${String(error)}`)
    try { await mounted.scope.dispose() } catch { /* ignore */ }
    return undefined
  }
}

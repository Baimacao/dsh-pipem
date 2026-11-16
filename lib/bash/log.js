/**
 * 日志策略：正常的启动过程静默，问题必须可见。
 * 信息性输出只在 DSH_PIPEM_DEBUG=1 时打；真问题永远走 console.warn。
 */
const DEBUG = (() => {
  const value = String(process.env.DSH_PIPEM_DEBUG ?? process.env.DSH_GITBASH_DEBUG ?? '').toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
})()

/** 正常流程的日志：除非开了 DEBUG，否则静默。 */
export function debugLog(message) {
  if (DEBUG) console.log(message)
}

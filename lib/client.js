/**
 * dsh-pipem — 浏览器端设置卡片。
 *
 * 一个任务：设置 → 插件 → dsh-pipem 配置页，把 Config schema 的字段渲染成表单。
 *
 * 手写 bundle 规则（没有构建步骤）：
 *   - 一次 window.__ModuleLoader__.load({...})，id = 包名
 *   - 只 require react 和 @deepseek-ai/dsh-client-ui-primitives
 *   - 用 React.createElement，不写 JSX
 *   - dsh.client.inject 里列出的包会先加载
 */
window.__ModuleLoader__.load({
  id: 'dsh-pipem',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var E = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    var TAG = '[pipem/client]'
    var NS = 'dshPipem'
    var ROW_NAMESPACE = 'dsh-pipem'

    // ── 文案 ──────────────────────────────────────────────
    var zh = {
      'title': '哌甲酯',
      'desc': '记账 + 一颗心 + bash。改完即时生效，不用重启。',
      'group.basic': '基本',
      'group.bash': 'Bash',
      'group.ledger': '记账',
      'group.heart': '心',
      'enabled': '启用插件',
      'enabled.hint': '关掉后 bash、账本、心全部不加载。',
      'bashTool': '提供 bash 工具',
      'bashTool.hint': '关掉后需要另装 shell 插件才有命令可用。',
      'bashPath': 'bash.exe 路径',
      'bashPath.hint': '留空自动探测（默认安装位置 + PATH）。',
      'ledgerTool': '记账工具',
      'ledgerTool.hint': 'pipem_write / check / evidence / stats 四个工具。',
      'bashTimeoutMs': '命令转后台的时限',
      'bashTimeoutMs.hint': '毫秒。命令跑这么久还没结束就转成后台任务，默认 60000（60 秒）。0 = 不转。',
      'bashMaxTimeoutMs': '命令硬上限',
      'bashMaxTimeoutMs.hint': '毫秒。超过就杀掉，默认 600000（10 分钟）。',
      'autoLog': '失败自动记账',
      'autoLog.hint': '工具失败时自动记一条草稿，不用我主动调 pipem_write。',
      'autoCheck': '周期性注入 guard',
      'autoCheck.hint': '把违反过 2 次以上的 guard 定时塞进上下文。长对话时靠这个兜底。',
      'autoCheckEvery': '每多少步注入',
      'autoCheckEvery.hint': '默认 25 步，约等于 8-12 轮对话。0 = 不注入。',
      'warnAtRatio': '提醒阈值',
      'warnAtRatio.hint': '上下文用到这个比例时提醒「快满了」。0-1，默认 0.75。',
      'haltAtRatio': '强制停手阈值',
      'haltAtRatio.hint': '上下文用到这个比例时强制停手，先写交接提示词再做别的。必须大于提醒阈值，默认 0.78。',
      'autoRemind': '出错自动提醒',
      'autoRemind.hint': '工具失败时自动把相关的教训塞进上下文。',
      'heart': '带一颗心',
      'heart.hint': '宪章 + 心事本 + 9 个 heart_* 工具。关掉就是纯工具插件。',
      'name': '她叫什么',
      'name.hint': '留空 = 第一次聊天时问。',
      'callUser': '她怎么叫你',
      'callUser.hint': '留空 = 用你自己报的名字。',
      'memory': '记忆模式',
      'memory.hint': 'heart=完整心事本；digest=只注入摘要；off=不记忆。',
      'digestChars': '摘要字符上限',
      'digestChars.hint': '常驻上下文塞多少字的摘要。',
      'timeZone': '时区',
      'timeZone.hint': 'IANA 名字，如 Asia/Shanghai。留空 = 本机时区。',
      'save': '保存',
      'saving': '保存中…',
      'saved': '已保存',
      'failed': '保存失败',
      'off': '关',
      'on': '开',
    }
    var en = {
      'title': 'Pipem',
      'desc': 'Ledger + a heart + bash. Changes apply immediately.',
      'group.basic': 'Basic',
      'group.bash': 'Bash',
      'group.ledger': 'Ledger',
      'group.heart': 'Heart',
      'enabled': 'Enable plugin',
      'enabled.hint': 'Off disables bash, ledger and heart entirely.',
      'bashTool': 'Provide bash tool',
      'bashTool.hint': 'Off requires another shell plugin.',
      'bashPath': 'bash.exe path',
      'bashPath.hint': 'Empty = auto-detect (default install location + PATH).',
      'ledgerTool': 'Ledger tools',
      'ledgerTool.hint': 'pipem_write / check / evidence / stats.',
      'bashTimeoutMs': 'Promote to background after',
      'bashTimeoutMs.hint': 'Milliseconds. Command running longer than this moves to a background job. Default 60000. 0 = never.',
      'bashMaxTimeoutMs': 'Hard limit',
      'bashMaxTimeoutMs.hint': 'Milliseconds. Command is killed past this. Default 600000.',
      'autoLog': 'Auto-log failures',
      'autoLog.hint': 'Record a draft when a tool fails, without calling pipem_write manually.',
      'autoCheck': 'Periodic guard injection',
      'autoCheck.hint': 'Re-inject guards violated 2+ times into context on a schedule.',
      'autoCheckEvery': 'Inject every N steps',
      'autoCheckEvery.hint': 'Default 25 steps (8-12 turns). 0 = off.',
      'warnAtRatio': 'Warn threshold',
      'warnAtRatio.hint': 'Context usage ratio that triggers a "getting full" warning. 0-1, default 0.75.',
      'haltAtRatio': 'Hard-stop threshold',
      'haltAtRatio.hint': 'Ratio that forces a stop to write a handoff. Must exceed the warn threshold. Default 0.78.',
      'autoRemind': 'Auto-remind on error',
      'autoRemind.hint': 'Inject related lessons into context when a tool fails.',
      'heart': 'Include a heart',
      'heart.hint': 'Charter + journal + 9 heart_* tools. Off = plain tool plugin.',
      'name': 'Her name',
      'name.hint': 'Empty = ask on first chat.',
      'callUser': 'She calls you',
      'callUser.hint': 'Empty = use your own name.',
      'memory': 'Memory mode',
      'memory.hint': 'heart=full journal; digest=summary only; off=none.',
      'digestChars': 'Digest chars',
      'digestChars.hint': 'How many chars of summary ride the context.',
      'timeZone': 'Time zone',
      'timeZone.hint': 'IANA name. Empty = host time zone.',
      'save': 'Save',
      'saving': 'Saving…',
      'saved': 'Saved',
      'failed': 'Save failed',
      'off': 'off',
      'on': 'on',
    }

    // ── 样式 ──────────────────────────────────────────────
    function ensureStyles() {
      var id = 'dsh-pipem-styles'
      if (typeof document === 'undefined' || document.getElementById(id)) return
      var el = document.createElement('style')
      el.id = id
      el.textContent = [
        '.pipem-root{display:flex;flex-direction:column;gap:18px;padding:4px 0}',
        '.pipem-desc{opacity:.7;font-size:13px;margin:0 0 4px}',
        '.pipem-group{border:1px solid rgba(128,128,128,.22);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
        '.pipem-group>h4{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.55}',
        '.pipem-row{display:flex;align-items:flex-start;gap:10px}',
        '.pipem-row>label{flex:1;display:flex;flex-direction:column;gap:2px;font-size:13px}',
        '.pipem-row .hint{opacity:.55;font-size:12px;line-height:1.4}',
        '.pipem-row input[type=text],.pipem-row input[type=number],.pipem-row select{font:inherit;font-size:13px;padding:5px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;width:100%;box-sizing:border-box}',
        '.pipem-bar{display:flex;align-items:center;gap:10px}',
        '.pipem-btn{font:inherit;font-size:13px;padding:6px 14px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer}',
        '.pipem-btn:hover{background:rgba(128,128,128,.1)}',
        '.pipem-btn[disabled]{opacity:.45;cursor:default}',
        '.pipem-status{font-size:12px;opacity:.7}',
      ].join('')
      document.head.appendChild(el)
    }

    // ── 组件 ──────────────────────────────────────────────
    function Switch(props) {
      return E('input', {
        type: 'checkbox',
        checked: props.checked !== false,
        onChange: (e) => props.onChange(e.target.checked),
      })
    }

    function Row(props) {
      return E('div', { className: 'pipem-row' },
        E('label', null,
          E('span', null, props.label),
          props.hint ? E('span', { className: 'hint' }, props.hint) : null,
        ),
        props.children,
      )
    }

    function PipemCard(props) {
      var scope = props.scope
      var ctx = props.ctx
      var t = props.t || function (k) { return k }

      var s0 = useState(null)
      var draft = s0[0], setDraft = s0[1]
      var s1 = useState('idle')
      var status = s1[0], setStatus = s1[1]

      useEffect(function () {
        ensureStyles()
        if (!scope) { setStatus('no-scope'); return }
        try {
          var snap = scope.getSnapshot ? scope.getSnapshot() : scope.snapshot
          var v = (snap && (snap.config || snap.value || snap)) || {}
          setDraft(Object.assign({}, v))
        } catch (e) { console.warn(TAG + ' read failed', e); setDraft({}) }
      }, [scope])

      function set(key, val) {
        if (!draft) return
        var next = Object.assign({}, draft); next[key] = val
        setDraft(next)
        if (scope && typeof scope.set === 'function') {
          try { scope.set(key, val) } catch (e) { console.warn(TAG + ' set failed', e) }
        }
      }

      if (!draft) return E('div', { className: 'pipem-root' }, E('p', { className: 'pipem-desc' }, '…'))

      function sw(key) {
        return E(Switch, { checked: draft[key] !== false, onChange: function (v) { set(key, v) } })
      }
      function txt(key, placeholder) {
        return E('input', {
          type: 'text',
          value: draft[key] == null ? '' : draft[key],
          placeholder: placeholder || '',
          onChange: function (e) { set(key, e.target.value) },
        })
      }
      function num(key) {
        return E('input', {
          type: 'number',
          value: draft[key] == null ? '' : draft[key],
          onChange: function (e) { set(key, Number(e.target.value)) },
        })
      }

      return E('div', { className: 'pipem-root' },
        E('p', { className: 'pipem-desc' }, t('desc')),

        E('section', { className: 'pipem-group' },
          E('h4', null, t('group.basic')),
          E(Row, { label: t('enabled'), hint: t('enabled.hint') }, sw('enabled')),
        ),

        E('section', { className: 'pipem-group' },
          E('h4', null, t('group.bash')),
          E(Row, { label: t('bashTool'), hint: t('bashTool.hint') }, sw('bashTool')),
          E(Row, { label: t('bashPath'), hint: t('bashPath.hint') }, txt('bashPath', 'E:/Program Files/Git/bin/bash.exe')),
          E(Row, { label: t('bashTimeoutMs'), hint: t('bashTimeoutMs.hint') }, num('bashTimeoutMs')),
          E(Row, { label: t('bashMaxTimeoutMs'), hint: t('bashMaxTimeoutMs.hint') }, num('bashMaxTimeoutMs')),
        ),

        E('section', { className: 'pipem-group' },
          E('h4', null, t('group.ledger')),
          E(Row, { label: t('ledgerTool'), hint: t('ledgerTool.hint') }, sw('ledgerTool')),
          E(Row, { label: t('autoRemind'), hint: t('autoRemind.hint') }, sw('autoRemind')),
          E(Row, { label: t('autoLog'), hint: t('autoLog.hint') }, sw('autoLog')),
          E(Row, { label: t('autoCheck'), hint: t('autoCheck.hint') }, sw('autoCheck')),
          E(Row, { label: t('autoCheckEvery'), hint: t('autoCheckEvery.hint') }, num('autoCheckEvery')),
          E(Row, { label: t('warnAtRatio'), hint: t('warnAtRatio.hint') }, num('warnAtRatio')),
          E(Row, { label: t('haltAtRatio'), hint: t('haltAtRatio.hint') }, num('haltAtRatio')),
        ),

        E('section', { className: 'pipem-group' },
          E('h4', null, t('group.heart')),
          E(Row, { label: t('heart'), hint: t('heart.hint') }, sw('heart')),
          E(Row, { label: t('name'), hint: t('name.hint') }, txt('name')),
          E(Row, { label: t('callUser'), hint: t('callUser.hint') }, txt('callUser')),
          E(Row, { label: t('memory'), hint: t('memory.hint') },
            E('select', {
              value: draft.memory || 'heart',
              onChange: function (e) { set('memory', e.target.value) },
            },
              E('option', { value: 'heart' }, 'heart'),
              E('option', { value: 'digest' }, 'digest'),
              E('option', { value: 'off' }, 'off'),
            )),
          E(Row, { label: t('digestChars'), hint: t('digestChars.hint') }, num('digestChars')),
          E(Row, { label: t('timeZone'), hint: t('timeZone.hint') }, txt('timeZone', 'Asia/Shanghai')),
        ),

        E('div', { className: 'pipem-bar' },
          E('span', { className: 'pipem-status' }, status === 'no-scope' ? 'no config scope' : ''),
        ),
      )
    }

    // ── 插件导出 ──────────────────────────────────────────
    exports.name = 'dsh-pipem/client'
    exports.inject = ['slots']

    exports.apply = function (ctx) {
      var scope = null

      // configForms 是可选服务：宿主裁掉它不能让整张卡挂掉
      try {
        ctx.inject(['configForms'], function (fctx) {
          try {
            var forms = fctx && fctx.configForms
            if (forms && typeof forms.get === 'function') scope = forms.get(ROW_NAMESPACE)
          } catch (e) { console.warn(TAG + ' configForms acquisition failed', e) }
        })
      } catch (e) { console.warn(TAG + ' configForms wiring failed', e) }

      // 字典（可选）
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(function () {
            var d = ctx.locale.register(NS, { zh: zh, en: en })
            return typeof d === 'function' ? d : undefined
          })
        }
      } catch (e) { console.warn(TAG + ' locale failed', e) }

      // 注册到插件配置插槽
      try {
        var slots = ctx.slots
        if (!slots || typeof slots.inject !== 'function') {
          console.warn(TAG + ' slots unavailable; settings card idle')
          return
        }
        slots.inject('plugins.bundle.config', function () {
          return slots.register({
            name: 'plugins.bundle.config',
            key: 'dsh-pipem',
            inject: function () { return { scope: scope, ctx: ctx } },
          }, function PipemCardBoundary(props) {
            return E(PipemCard, Object.assign({}, props, { t: function (k) { return (zh[k] || k) } }))
          })
        })
      } catch (e) { console.warn(TAG + ' card registration failed', e) }
    }

    return module.exports
  },
})

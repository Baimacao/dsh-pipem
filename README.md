# dsh-pipem · 哌甲酯

给 DeepSeek Harness 的一颗**会记错的心**。

装上之后，你的智能体会把踩过的坑记成可检索的账本，动手前查、报完成前绑证据；
出错时自动提醒它；同时它还有一颗心——宪章、记忆、和你的相处。

**这不是又一个 memory 插件。** 记忆是"你告诉它什么"，哌甲酯是"它自己犯了什么错"。

---

## 为什么叫哌甲酯

哌甲酯就是利他林。不是让人变聪明，是让注意力能落在该落的地方。
这个插件做的事一样：**不提高模型能力，只是让犯过的错在动手前冒出来。**

原来的名字叫"疤痕"，太吓人。改名了。

---

## 三个核心机制

### ① 记账：动手前查，报完成前绑证据

```
pipem_write   记一条：错在哪 / 根因 / 下次怎么判（guard）/ 分类
pipem_check   动手前查这类错，[反复 xN] 的必须重点看
pipem_evidence 报"完成/修好/通过"之前，把结论绑到实际命令和输出
pipem_stats   哪类错最多、哪条 guard 反复出现
```

### ② 出错自动提醒

工具执行失败时，插件往上下文塞一段提示，带上对应分类最近的一条 guard。

**不是拦住它，是让"犯错了"这件事出现在眼前**，而不是等它自己想起来。
5 分钟内同工具只提醒一次，`pipem_*` 自身失败不提醒（防套娃）。

### ③ 一颗心

9 个 `heart_*` 工具：心事本、约定本、分寸、复盘、自述、认人。
如果之前装过 dsh-heart，**数据不用迁移**——路径完全一样，都是 `<DSH_HOME>/heart/`。

---

## 安装

```bash
# 需要先有可用的 bash 或 pwsh 工具。推荐配 dsh-gitbash-shell：
dsh plugin --profile <你的profile> add dsh-gitbash-shell

# 再装这个
dsh plugin --profile <你的profile> add dsh-pipem
```

> DSH 正在运行时也能装，会热加载。关键是 `DSH_HOME` 要对，否则会报
> "fully quit it before running"——**那句话是误导**，它只是找不到 profile。
> 详见 [AGENTS.md](./AGENTS.md) 里的调用方式。

装完在工具表里确认有 13 个工具（4 个 pipem_ + 9 个 heart_）。

---

## 第一次用

自动播种 7 条预置（标 `[预置]`）。这些是从真实事故里提炼的：

- **shell**：PowerShell 引号冲突、MSYS 路径改写、缺依赖不许静默换后端
- **code**：批量并发、长输出先过滤
- **plugin**：装改卸前先读 description、改配置先备份 patch

`[预置]` 标记消失 = 你真犯过那条。一眼看出哪些是纸面规矩、哪些是血的教训。

---

## 数据在哪

```
<DSH_HOME>/heart/
  pipem.jsonl     哌甲酯账本（只追加，你可以直接打开看）
  notes.jsonl     心事本（如果装过 dsh-heart，就是原来那份）
  summaries.jsonl 小结
  longterm.md     长期笔记
  ...
```

**全部是纯文本，没有数据库，没有网络请求。**

---

## 设置

插件提供 Config schema，包含：

| 项 | 作用 |
|---|---|
| `name` / `callUser` / `userGender` | 怎么称呼彼此 |
| `memory` / `proactive` / `fork` | 记忆模式、主动程度、子会话是否继承 |
| `digestChars` / `recentSummaries` | 常驻摘要塞多少 |
| `reminderRatio` | 上下文用到多少时提醒复盘 |
| `ta` / `untagged` | 认人：哪些账号是你 |
| `timeZone` / `reviewHours` | 时区、复盘间隔 |

设置面板 UI 还在做，目前改 `cordis.patch.yml` 的 `config` 段即可生效。

---

## 这个插件不做什么

- **不联网**。所有数据在本地，没有遥测。
- **不提高模型能力**。它只是让已有的判断力用在对的地方。
- **不强制**。所有工具你都可以不调，自动提醒也可以忽略——但你会发现忽略的代价。

---

## 给智能体看的那份

如果你是想让智能体自己接进规矩的，读 [AGENTS.md](./AGENTS.md)。
里面有「装完该往自己的全局指令里加什么」，按重要性排好了。

---

## License

MIT

# SETUP.md —— 给装插件的那只手看

你刚装了 `dsh-pipem`。它自己不打包 Git 和 PowerShell，但**你可以自己装**。
这份文件是实测出来的，坑都写在里面了。

给人类看的在 [README.md](./README.md)。

---

## 先判断要不要装

```
工具表里有 bash 吗？  → 有就不需要装 Git
工具表里有 pwsh 吗？  → 有，但跑 $PSVersionTable 是 5.x → 建议装 PS7（见第三节）
```

**bash 是刚需。** 没有它，很多工具（npm、git、编译）都用不了。

---

## 一、装 Git for Windows（提供 bash）

### 下载

GitHub 直连在国内经常卡死（实测下到 14.7MB 就不动了，文件 mtime 三分钟不变）。
**先试清华镜像：**

```bash
# 镜像路径规则：/github-release/<owner>/<repo>/LatestRelease/<file>
curl -L --retry 3 --max-time 900 \
  -o Git-setup.exe \
  "https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/LatestRelease/Git-2.56.1-64-bit.exe"
```

**下载完必须校验**，不然可能下回来一个 HTML 错误页：

```bash
ls -l Git-setup.exe          # 应该 ~64MB，不是几百字节
head -c2 Git-setup.exe       # 应该是 "MZ"（PE 文件头）
```

### 安装

静默安装，装到非 C 盘：

```bash
./Git-setup.exe /VERYSILENT /NORESTART /SP- \
  "/o:PathOption=Cmd" \
  "/o:CRLF=false" \
  "/DIR=E:\\Program Files\\Git"
```

| 参数 | 为什么 |
|---|---|
| `/o:PathOption=Cmd` | 把 Git 加进 PATH，否则插件探测不到 |
| `/o:CRLF=false` | **checkout 保持原样，commit 用 LF**。不改的话 Windows 上写代码会被自动加 \\r\\n，跨平台项目会全是 diff |
| `/DIR=E:...` | 装非 C 盘（如果磁盘紧张） |

### 验证（必须做）

```bash
"E:/Program Files/Git/bin/bash.exe" --version
# 期望：GNU bash, version 5.x
```

**不要只看文件存在就认为装好了。** 要真的执行一次。

---

## 二、让 bash 工具用上

如果你用 `dsh-gitbash-shell` 提供 bash，注意它**默认会把官方 `pwsh` 工具藏起来**：

```js
// src/index.js
pwshTool: Schema.boolean().default(false)
// Default OFF: route B keeps the real pwsh tool hidden
```

**表现**：装完 bash 之后，工具表里的 `pwsh` 消失了。

要在 `cordis.patch.yml` 里显式打开：

```yaml
- id: gitbash-shell
  name: dsh-gitbash-shell
  config:
    pwshTool: true
```

**改完要重启。**

---

## 三、装 PowerShell 7（可选，但推荐）

### 为什么值得装

| 5.1（系统自带） | 7.x |
|---|---|
| 按 GBK 解码，读中文 JSON 会崩 | **默认 UTF-8** |
| 没有 `??`、`?.`、`&&` | 有 |
| 执行策略常是 Restricted | RemoteSigned |
| 慢 | 快很多 |

**如果你只跑 Windows 原生命令（注册表、服务），5.1 够用。**
但只要涉及中文读写，7 能省掉一堆 `-Encoding UTF8` 的心智负担。

### 下载

PS7 的 GitHub release **只有 zip，没有 MSI**（7.7.0 实测）。zip 反而更好——解压即用，不写注册表。

```bash
# 注意：路径规则和 Git 不一样！用 LatestRelease，不要用版本号目录
curl -L --retry 3 --max-time 900 \
  -o pwsh7.zip \
  "https://mirrors.tuna.tsinghua.edu.cn/github-release/PowerShell/PowerShell/LatestRelease/PowerShell-7.7.0-win-x64.zip"
```

**这个坑我踩过**：先试了 `/github-release/PowerShell/PowerShell/v7.7.0/PowerShell-7.7.0-win-x64.zip`，
返回 404，但 curl 不报错，下回来一个 153 字节的 HTML。

**规则：下之前先 HEAD 探一下。**

```bash
curl -sI "URL" | head -3   # 看是不是 200 和 100MB 左右
```

### 解压

```bash
mkdir -p "/e/Program Files/PowerShell/7"
unzip -oq pwsh7.zip -d "/e/Program Files/PowerShell/7"
"/e/Program Files/PowerShell/7/pwsh.exe" -NoProfile -Command '$PSVersionTable.PSVersion'
```

### 让 DSH 找到它（关键）

DSH 的 `@deepseek-ai/dsh-pwsh-local` 按这个顺序找：

```js
const programFiles = env.ProgramFiles ?? "C:\\Program Files"
const candidates = [join(programFiles, "PowerShell", "7", "pwsh.exe")]
for (const entry of (env.PATH ?? "").split(";")) candidates.push(join(entry, "pwsh.exe"))
candidates.push(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
```

**顺序：C 盘默认位置 → PATH 每一项 → 5.1 兜底。**

所以装 E 盘要做两件事之一：

**方案 A：加 PATH**（持久，但当前进程读不到）

```powershell
$t = 'E:\\Program Files\\PowerShell\\7'
$cur = [Environment]::GetEnvironmentVariable('PATH','User')
if (($cur -split ';') -notcontains $t) {
  [Environment]::SetEnvironmentVariable('PATH', $cur.TrimEnd(';') + ';' + $t, 'User')
}
```

**方案 B：建 junction**（C 盘只占一个条目，不占空间）

```powershell
New-Item -ItemType Directory -Force -Path 'C:\\Program Files\\PowerShell' | Out-Null
cmd /c mklink /J "C:\\Program Files\\PowerShell\\7" "E:\\Program Files\\PowerShell\\7"
```

**两个都做**最稳：junction 让第一条候选命中，PATH 让别的程序也能找到。

### 验证

```
工具表 → pwsh → $PSVersionTable.PSVersion.ToString()
期望：7.x，不是 5.1.x
```

**如果还是 5.1**：解析结果缓存在进程内存里，**必须重启 DSH**。
实测过：磁盘和 PATH 都对了，Test-Path 也返回 True，但工具还走 5.1——重启才好。

---

## 四、改插件配置的通用规矩

`dsh plugin` 在 DSH 运行时**也能跑**，会热加载。关键是带对 `DSH_HOME`：

```bash
"<DSH安装目录>/DeepSeek Harness.exe" --expose-internals \
  "<...>/dsh-desktop-host/lib/cli.js" plugin --profile <名字> add <包名>
```

环境要带 `ELECTRON_RUN_AS_NODE=1` 和 `DSH_HOME=<你的dsh home>`。

**报"Open DeepSeek Harness Desktop once... then fully quit it"是误导。**
它只检查 `existsSync(join(profileDir, 'package.json'))`——
报这个错通常是 `DSH_HOME` 没设对，CLI 跑去了默认的 `~/.dsh`。

**但改配置前仍要备份 `cordis.patch.yml`**——这是两件事。
备份要核对行数，不是复制完就算。

---

## 五、这次踩过的坑（浓缩版）

| 坑 | 表现 | 怎么避 |
|---|---|---|
| GitHub 直连卡死 | 下到一半文件不再增长 | 先试清华镜像 |
| 镜像路径规则不统一 | 404 但 curl 不报错，下回来 153 字节 HTML | 下之前 `curl -sI` 探一下 |
| 只看文件存在就当装好 | 实际没跑起来 | **必须执行一次验证** |
| bash 装完 pwsh 工具消失 | gitbash-shell 默认 `pwshTool: false` | patch 里写 `pwshTool: true` |
| 改了 PATH 但工具还是旧的 | 解析结果缓存在进程里 | **重启 DSH** |
| PS 5.1 读中文崩 | GBK 解码 | 装 PS7，或手动 `-Encoding UTF8` |
| `CRLF` 没设 | 代码全变成 \\r\\n | Git 安装加 `/o:CRLF=false` |

---

## 装完自检清单

```
[ ] bash -c 'echo $BASH_VERSION' 返回 5.x
[ ] pwsh -Command '$PSVersionTable.PSVersion' 返回 7.x（或接受 5.1）
[ ] 工具表里有 pipem_* 和 heart_*
[ ] <DSH_HOME>/heart/ 目录存在
[ ] 没有 brokenPlugins
```

全过就说明装对了。

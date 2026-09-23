<#
.SYNOPSIS
  把 dsh ≤0.1.6 的「目录预设」迁移成 dsh ≥0.1.7 的「声明式预设」片段。

.DESCRIPTION
  dsh 0.1.7 把 Agent 预设从「目录里的 agent.cordis.yml 文件」改成了「profile 配置里的声明行」：
  由 @deepseek-ai/dsh-agent-preset-registry 统一管理，每个预设一行 @deepseek-ai/dsh-agent-preset。
  官方明确：注册表**不扫描目录、不接受 preset 路径、没有任何接口接受 YAML 写回**
  —— 所以旧目录预设必须迁移，否则会话日志里记着的 preset ID 找不到定义，**恢复会话会被拒绝**。

  本脚本读取 {DSH_HOME}/.agent-presets/<名字>/agent.cordis.yml，用「整段缩进」的方式转写成
  patch 片段（!!js 标签、块标量、多行字符串全部原样保留），可打印、可写文件、可与现有
  profile 的 cordis.patch.yml 合并。

  ⚠️ 默认**只生成，不落任何线上配置**。启用请手工改名（见 EXAMPLES）。

.PARAMETER DshHome
  dsh 家目录。缺省取环境变量 DSH_HOME，再缺省 ~/.dsh。

.PARAMETER Names
  只迁移指定名字（可多个）。缺省迁移 .agent-presets 下全部目录预设。

.PARAMETER Out
  输出文件路径。给定时写入该文件；不给则只打印到屏幕。

.PARAMETER Merge
  与 <profile 的 cordis.patch.yml> 合并成"原 patch + 迁移片段"（需同时给 -Out）。
  不指定 -Profile 时默认取 web。

.PARAMETER Profile
  合并时使用的 profile 名（缺省 web）。

.EXAMPLE
  # 1) 先看会迁移哪些预设（不写任何文件）
  pwsh -File scripts/migrate-presets-017.ps1

  # 2) 生成"原 patch + 迁移片段"的合并版，随手核对
  pwsh -File scripts/migrate-presets-017.ps1 -Merge -Out "$env:TEMP\cordis.patch.yml.0.1.7-ready"

  # 3) 升级 dsh 到 ≥0.1.7 之后启用（⚠️ 顺序不可反！0.1.6 读不了新声明会加载失败）
  #    cd $env:USERPROFILE\.dsh\profiles\web
  #    Copy-Item cordis.patch.yml cordis.patch.yml.bak-0.1.6
  #    Move-Item cordis.patch.yml.0.1.7-ready cordis.patch.yml -Force
  #    # 然后重启 dsh

.NOTES
  patch 写法两个坑（实测）：
    ① 顶层若是空数组 `[]`，必须先替换掉再追加（直接 append 会 YAML 语法错），本脚本已自动处理；
    ② 新增条目必须用 `- insert:`，写成 `- id:` 会报 `entry not found`。
#>
[CmdletBinding()]
param(
  [string]$DshHome = '',
  [string[]]$Names = @(),
  [string]$Out = '',
  [switch]$Merge,
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

if (-not $DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' } }
$presetRoot = Join-Path $DshHome '.agent-presets'

Write-Host '== dsh 预设迁移：目录版 → 0.1.7 声明式 ==' -ForegroundColor Cyan
Write-Host "DSH 家目录 : $DshHome"
Write-Host "预设目录   : $presetRoot"
Write-Host ''

if (-not (Test-Path -LiteralPath $presetRoot)) {
  Write-Host "预设目录不存在，没什么可迁移的。" -ForegroundColor Yellow
  exit 0
}

# ── 选定要迁移的预设 ──
$targets = @()
foreach ($dir in (Get-ChildItem -LiteralPath $presetRoot -Directory -ErrorAction SilentlyContinue)) {
  $yml = Join-Path $dir.FullName 'agent.cordis.yml'
  if (-not (Test-Path -LiteralPath $yml)) { continue }
  if ($Names.Count -gt 0 -and ($Names -notcontains $dir.Name)) { continue }
  $name = $dir.Name
  $pm = Join-Path $dir.FullName 'preset.yml'
  if (Test-Path -LiteralPath $pm) {
    $m = Select-String -LiteralPath $pm -Pattern '^name:\s*(.*)$' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $name = $m.Matches[0].Groups[1].Value.Trim().Trim('"', "'") }
  }
  $targets += [pscustomobject]@{ Id = $dir.Name; Name = $name; File = $yml; Size = (Get-Item -LiteralPath $yml).Length }
}

if ($targets.Count -eq 0) {
  Write-Host "没找到可迁移的预设（目录里没有 agent.cordis.yml）。" -ForegroundColor Yellow
  exit 0
}

Write-Host ("将迁移 " + $targets.Count + " 个预设：") -ForegroundColor White
foreach ($t in $targets) { Write-Host ("  · " + $t.Id + "  →  展示名「" + $t.Name + "」  (" + $t.Size + " 字节)") }
Write-Host ''

# ── 生成片段（整段缩进 10 空格：位于 config.plugins: 之下）──
$frag = New-Object System.Collections.Generic.List[string]
$frag.Add('# ── dsh 0.1.7 声明式预设：由 ≤0.1.6 的目录预设迁移而来 ──')
$frag.Add('# 用法：整段并入 profile 的 cordis.patch.yml 顶层数组（用 -Merge 可自动拼好）')
$frag.Add('# ⚠️ 仅 dsh ≥0.1.7 可用：0.1.6 不认识 @deepseek-ai/dsh-agent-preset，加了会挂载失败')
$frag.Add('')

foreach ($t in $targets) {
  $frag.Add("# ── " + $t.Name + " (id: " + $t.Id + ") ──")
  $frag.Add('- insert:')
  $frag.Add('    - id: preset-' + $t.Id)
  $frag.Add("      name: '@deepseek-ai/dsh-agent-preset'")
  $frag.Add('      config:')
  $frag.Add('        id: ' + $t.Id)
  $frag.Add('        name: ' + $t.Name)
  $frag.Add('        plugins:')
  foreach ($line in (Get-Content -LiteralPath $t.File)) {
    $frag.Add($(if ($line -eq '') { '' } else { '          ' + $line }))
  }
  $frag.Add('')
}

$fragmentText = ($frag -join [Environment]::NewLine)

if ($Out) {
  if ($Merge) {
    $patch = Join-Path $DshHome (Join-Path 'profiles' (Join-Path $Profile 'cordis.patch.yml'))
    if (-not (Test-Path -LiteralPath $patch)) {
      Write-Host ("合并所需的目标 patch 不存在: " + $patch) -ForegroundColor Red
      exit 1
    }
    $orig = Get-Content -LiteralPath $patch -Raw
    # 顶层是空数组 `[]` → 必须先替换掉，否则追加后语法非法（实测坑①）
    $cleaned = [regex]::Replace($orig, '(?m)^\s*\[\s*\]\s*$', '')
    $merged = $cleaned.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $fragmentText
    Set-Content -LiteralPath $Out -Value $merged -Encoding utf8
    Write-Host ("✅ 已生成合并版（原 patch + 迁移片段）: " + $Out) -ForegroundColor Green
    Write-Host ("   原 patch: " + (Get-Item -LiteralPath $patch).Length + " 字节  →  合并后: " + (Get-Item -LiteralPath $Out).Length + " 字节")
  } else {
    Set-Content -LiteralPath $Out -Value $fragmentText -Encoding utf8
    Write-Host ("✅ 已写出迁移片段: " + $Out) -ForegroundColor Green
  }
  Write-Host ''
  Write-Host '启用步骤（⚠️ 必须先升级 dsh 到 ≥0.1.7）：' -ForegroundColor Yellow
  Write-Host ('  cd ~/.dsh/profiles/' + $Profile)
  Write-Host '  Copy-Item cordis.patch.yml cordis.patch.yml.bak-0.1.6'
  Write-Host ('  Move-Item "' + $Out + '" cordis.patch.yml -Force')
  Write-Host '  # 然后重启 dsh'
} else {
  Write-Host '（未指定 -Out，以下是生成的片段预览）' -ForegroundColor DarkGray
  Write-Host ('-' * 60)
  Write-Host $fragmentText
  Write-Host ('-' * 60)
  Write-Host '提示：加 -Out <路径> 可写出文件；加 -Merge -Out <路径> 可直接生成"原 patch + 片段"的合并版。'
}

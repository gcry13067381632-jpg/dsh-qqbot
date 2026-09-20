<#
.SYNOPSIS
  修复 dsh 0.1.5 → 0.1.6 升级后「自定义预设挂载失败」的问题。

.DESCRIPTION
  dsh 0.1.6 把工作流执行器插件改了名，且**不保留别名**：
      @deepseek-ai/dsh-workflow-worker-thread  →  @deepseek-ai/dsh-workflow-ptc
  从旧版官方预设「复制」出来的自定义预设（~/.dsh/.agent-presets/<名字>/agent.cordis.yml）
  仍然写着旧名，升级后恢复会话时会报：
      preset "xxx" failed to mount: row "workflow-worker-thread"
      names a plugin that cannot be resolved: @deepseek-ai/dsh-workflow-worker-thread

  本脚本扫描预设并给出两类结果：
    ① 可自动改名：workflow-worker-thread → workflow-ptc、dsh-code-runtime → dsh-ptc-runtime
    ② 仅报告（需人工删行）：dsh-code-runtime-worker-thread / dsh-tool-subagent-report / dsh-agent-spine-demo

  默认 dry-run 只检查；加 -Apply 才写回，写前自动备份为 <文件>.bak-dsh016-<时间戳>。

.EXAMPLE
  pwsh -File scripts/fix-dsh-016-presets.ps1            # 只检查（不改任何文件）
  pwsh -File scripts/fix-dsh-016-presets.ps1 -Apply     # 修复（自动备份）
  pwsh -File scripts/fix-dsh-016-presets.ps1 -DshHome "D:\my-dsh" -Apply
#>
[CmdletBinding()]
param(
  # 真正写回（不传则只检测）
  [switch]$Apply,
  # DSH 家目录；缺省用 $env:DSH_HOME，再缺省 ~/.dsh
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'

if (-not $DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' } }
$presetRoot = Join-Path $DshHome '.agent-presets'

Write-Host "== dsh 0.1.6 预设兼容检查 ==" -ForegroundColor Cyan
Write-Host "DSH 家目录 : $DshHome"
Write-Host "预设目录   : $presetRoot"
Write-Host ("模式       : " + $(if ($Apply) { 'APPLY（会写回，自动备份）' } else { 'DRY-RUN（只检查）' }))
Write-Host ""

if (-not (Test-Path -LiteralPath $presetRoot)) {
  Write-Host "预设目录不存在，无需处理。" -ForegroundColor Yellow
  exit 0
}

# ── 规则表 ──
# 改名类：(正则) -> 替换值；用负向断言避免误伤带后缀的包名
$renames = @(
  @{ Pattern = 'dsh-workflow-worker-thread'; Replace = 'dsh-workflow-ptc' },
  @{ Pattern = 'workflow-worker-thread';     Replace = 'workflow-ptc' },
  @{ Pattern = 'dsh-code-runtime(?![\w-])';  Replace = 'dsh-ptc-runtime' }
)
# 移除类：只报告
$removed = @('dsh-code-runtime-worker-thread', 'dsh-tool-subagent-report', 'dsh-agent-spine-demo')

$changedFiles = 0
$reportFiles = 0
$pass = @{
  'dsh-workflow-worker-thread' = 'dsh-workflow-ptc'
  'workflow-worker-thread'     = 'workflow-ptc'
}
$yamlFiles = Get-ChildItem -LiteralPath $presetRoot -Recurse -File -Filter 'agent.cordis.yml' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\.bak' }

if (-not $yamlFiles) {
  Write-Host "没找到任何 agent.cordis.yml。" -ForegroundColor Yellow
  exit 0
}

foreach ($f in $yamlFiles) {
  $lines = @(Get-Content -LiteralPath $f.FullName -Encoding utf8)
  $out = New-Object System.Collections.Generic.List[string]
  $presetName = Split-Path (Split-Path $f.FullName -Parent) -Leaf
  $notes = @()
  $touched = $false

  foreach ($line in $lines) {
    $newLine = $line
    # ⚠️ 注释行不动：预设里常有「v0.1.6 起 xxx 改名为 yyy」这类说明文字，
    #    提到旧名不代表真的引用它（早先版本按整文件匹配会误报）。
    $isComment = $line.TrimStart().StartsWith('#')
    if (-not $isComment) {
      # ① 移除类（只报告）
      foreach ($pkg in $removed) {
        if ($newLine -match [regex]::Escape($pkg)) { $notes += "需人工删行: $pkg" }
      }
      # ② 改名类
      foreach ($r in $renames) {
        if ($newLine -match $r.Pattern) {
          $newLine = [regex]::Replace($newLine, $r.Pattern, $r.Replace)
          $notes += ("改名: " + $r.Pattern + " → " + $r.Replace)
        }
      }
      if ($newLine -ne $line) { $touched = $true }
    }
    $out.Add($newLine)
  }

  $notes = @($notes | Select-Object -Unique)
  if ($notes.Count -eq 0) { continue }

  Write-Host ("[$presetName]") -ForegroundColor White
  $notes | ForEach-Object { Write-Host ("   - " + $_) }
  Write-Host ("   文件: " + $f.FullName)

  if ($touched) {
    if ($Apply) {
      $bak = $f.FullName + '.bak-dsh016-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
      Copy-Item -LiteralPath $f.FullName -Destination $bak -Force
      Set-Content -LiteralPath $f.FullName -Value ($out -join [Environment]::NewLine) -Encoding utf8
      Write-Host ("   ✔ 已修复（备份: " + (Split-Path $bak -Leaf) + "）") -ForegroundColor Green
    } else {
      Write-Host "   → 加 -Apply 即执行修复" -ForegroundColor DarkGray
    }
    $changedFiles++
  } else {
    Write-Host "   （仅注释/无需改动）" -ForegroundColor DarkGray
  }
  $reportFiles++
  Write-Host ""
}

Write-Host "== 结果 ==" -ForegroundColor Cyan
if ($reportFiles -eq 0) {
  Write-Host "✅ 未发现 dsh 0.1.6 不兼容的插件名，预设干净。" -ForegroundColor Green
} else {
  Write-Host ("发现 " + $reportFiles + " 个预设受影响，其中可自动修复 " + $changedFiles + " 个。")
  if (-not $Apply) { Write-Host "（当前是 DRY-RUN，未改动任何文件；确认后加 -Apply 重跑）" -ForegroundColor Yellow }
}
Write-Host ""
Write-Host "提示：改完后重启 dsh（dsh web / dsh --profile <名字>）让预设重新挂载。" -ForegroundColor DarkGray

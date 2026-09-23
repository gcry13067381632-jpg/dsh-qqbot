<#
.SYNOPSIS
  清理 dsh profile 的 cordis.patch.yml 里的**重复键**（同一条目、同一缩进层级的同名键）。

.DESCRIPTION
  起因：本插件早期在写凭据/设置时时曾出现「找不到已存在的键 → 追加一份」，
  导致同一条目里出现重复的 `appId:` / `appSecret:` / `preset:` / `cwd:` / `disabled:`。
  YAML 严格解析器会直接报错：

      YAMLException: duplicated mapping key (26:5)

  重复键在 YAML 里「后者生效」，但宿主解析时**直接抛错**，表现成 dsh 完全启动不了。

  本脚本按「条目块」为单位去重：块内**同一缩进层级**的同名键只保留**最后一个**（YAML 语义），
  删掉前面重复的那些。写回前自动备份、换行逐行保真（patch 可能 LF/CRLF 混用）。

.PARAMETER Patch
  目标 patch 文件。缺省 = $env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml

.PARAMETER WhatIf
  只报告不写回。

.EXAMPLE
  pwsh -File scripts/dedupe-patch.ps1            # 先看看有没有重复
  pwsh -File scripts/dedupe-patch.ps1 -Apply     # 清理（自动备份）
#>
[CmdletBinding()]
param(
  [string]$Patch = '',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if (-not $Patch) { $Patch = Join-Path $env:USERPROFILE '.dsh\profiles\web\cordis.patch.yml' }
if (-not (Test-Path -LiteralPath $Patch)) { Write-Host "找不到 patch: $Patch" -ForegroundColor Red; exit 1 }

Write-Host "== patch 重复键清理 ==" -ForegroundColor Cyan
Write-Host "文件: $Patch"
Write-Host ("模式: " + $(if ($Apply) { 'APPLY（写回 + 备份）' } else { 'DRY-RUN（只看）' }))
Write-Host ''

$raw = Get-Content -LiteralPath $Patch -Raw
$lines = $raw -split "`r`n|`n"

# 拆成「条目块」：以 `- id: <name>` 或 `- insert:` 为界的粗切 + 块内按 (缩进, 键) 去重
$seen = @{}          # key = "<缩进>|<键名>" -> 行索引（最后一次出现）
$drop = New-Object System.Collections.Generic.List[int]
$scope = ''          # 当前所属条目（遇到新的 - id: 就切换）

for ($i = 0; $i -lt $lines.Count; $i++) {
  $l = $lines[$i]
  if ($l.Trim() -eq '' -or $l.TrimStart().StartsWith('#')) { continue }

  $mId = [regex]::Match($l, '^(\s*)-\s*id:\s*(\S+)\s*$')
  if ($mId.Success) { $scope = $mId.Groups[2].Value; $seen = @{}; continue }

  $mK = [regex]::Match($l, '^(\s*)([A-Za-z0-9_-]+):')
  if (-not $mK.Success) { continue }
  $indent = $mK.Groups[1].Value.Length
  $key = $mK.Groups[2].Value
  $sig = "$scope|$indent|$key"

  if ($seen.ContainsKey($sig)) { $drop.Add($seen[$sig]) }   # 前一次出现 → 标记删除（保留最后的）
  $seen[$sig] = $i
}

if ($drop.Count -eq 0) {
  Write-Host '✅ 没有发现重复键。' -ForegroundColor Green
  exit 0
}

Write-Host ("发现 " + $drop.Count + " 行重复键（将删除，保留每键最后一次出现）：") -ForegroundColor Yellow
foreach ($i in $drop) { Write-Host ("  行" + ($i + 1) + ": " + $lines[$i].Trim()) }
Write-Host ''

if (-not $Apply) {
  Write-Host '（DRY-RUN，未改动文件；确认后加 -Apply 重跑）' -ForegroundColor Yellow
  exit 0
}

$bak = $Patch + '.bak-dedupe-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -LiteralPath $Patch -Destination $bak -Force
$out = @()
for ($i = 0; $i -lt $lines.Count; $i++) { if (-not $drop.Contains($i)) { $out += $lines[$i] } }
Set-Content -LiteralPath $Patch -Value ($out -join "`r`n") -Encoding utf8
Write-Host ("✅ 已写回（备份: " + (Split-Path $bak -Leaf) + "）") -ForegroundColor Green
Write-Host ("  行数 " + $lines.Count + " → " + $out.Count)
Write-Host ''
Write-Host '提示：改完请重启 dsh 验证。' -ForegroundColor DarkGray

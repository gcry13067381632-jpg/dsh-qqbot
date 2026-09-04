<#
.SYNOPSIS
  One-click install of @zaofan/dsh-qqbot into a dsh profile (default: web).

.DESCRIPTION
  Simulates how an end user installs this plugin:
    1. pnpm install + build (repo ships no dist)
    2. pnpm pack into a SPACE-FREE temp dir  (avoids path-space arg splitting)
    3. dsh plugin --profile <web> add <tarball>  (real install, not a link)
    4. Prints restart + verification steps.

  Why tarball, not directory add:
    - `add <dir-with-spaces>` breaks on Windows (pnpm splits args at spaces)
    - directory add becomes a pnpm link (junction): the plugin then cannot
      locate the profile dir by code location -> credentials cannot persist.

.EXAMPLE
  .\install.ps1                 # install into profile "web"
  .\install.ps1 -Profile qqbot  # install into another profile
  .\install.ps1 -Clean          # remove leftover node_modules entry first
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot

Write-Host ''
Write-Host '=============================================='
Write-Host '  @zaofan/dsh-qqbot one-click installer'
Write-Host '=============================================='

# ── preflight ──
if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Write-Host '[x] dsh CLI not found. Install it first:' -ForegroundColor Red
  Write-Host '    npm install -g @deepseek-ai/dsh'
  exit 1
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host '[x] pnpm not found. Install it first:' -ForegroundColor Red
  Write-Host '    npm install -g pnpm'
  exit 1
}
if (-not (Test-Path (Join-Path $src 'package.json'))) {
  Write-Host "[x] Cannot find package.json in '$src'." -ForegroundColor Red
  exit 1
}

# ── native command shims ──
# ExecutionPolicy (Restricted by default) blocks pnpm.ps1 / dsh.ps1.
# Invoke the .cmd shims instead - they are not subject to PS script policy.
if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) {
  $pnpm = 'pnpm.cmd'
} else {
  $pnpm = 'pnpm'
}
if (Get-Command dsh.cmd -ErrorAction SilentlyContinue) {
  $dsh = 'dsh.cmd'
} else {
  $dsh = 'dsh'
}

# ── optional clean of leftover installs (see pitfall: switching install methods) ──
if ($Clean) {
  $leftover = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile\node_modules\@zaofan\dsh-qqbot"
  if (Test-Path $leftover) {
    Write-Host "[*] Removing leftover install at $leftover ..."
    Remove-Item $leftover -Recurse -Force
  }
}

# ── build ──
# This is a pnpm repo (pnpm-lock.yaml): `npm install` fails with ERESOLVE
# (peer ranges inconsistent across npm/pnpm lockfiles) - must use pnpm install.
if (-not (Test-Path (Join-Path $src 'dist\index.js'))) {
  Write-Host '[*] dist not found - running pnpm install && pnpm run build ...'
  Push-Location $src
  try {
    & $pnpm install --no-audit --no-fund | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    & $pnpm run build | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'pnpm run build failed' }
  } finally {
    Pop-Location
  }
} else {
  Write-Host '[*] dist found - skipping build'
}

# ── pack into a space-free dir ──
$packDir = Join-Path $env:TEMP 'zaofan-dsh-qqbot-pack'
New-Item -ItemType Directory -Path $packDir -Force | Out-Null
Get-ChildItem $packDir -Filter '*.tgz' | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "[*] packing source (pnpm pack) -> $packDir"
Push-Location $src
try {
  & $pnpm pack --pack-destination $packDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'pnpm pack failed' }
} finally {
  Pop-Location
}
$tgz = Get-ChildItem $packDir -Filter '*.tgz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $tgz) {
  Write-Host '[x] pnpm pack produced no tarball.' -ForegroundColor Red
  exit 1
}
Write-Host "[*] tarball: $($tgz.FullName)"

# ── install into profile ──
Write-Host "[*] $dsh plugin --profile $Profile add <tarball> ..."
& $dsh plugin --profile $Profile add $tgz.FullName
if ($LASTEXITCODE -ne 0) {
  Write-Host '[x] dsh plugin add failed.' -ForegroundColor Red
  exit 1
}

# ── done / next steps ──
Write-Host ''
Write-Host '=============================================='
Write-Host '  Installed. Next steps:'
Write-Host '=============================================='
Write-Host "  1) Restart dsh web:    npx @deepseek-ai/dsh web  (or dsh web)"
Write-Host '  2) Open dsh Web -> Settings -> "QQ bot" page appears = success'
Write-Host '  3) Scan QR / fill AppID+Secret to bind your QQ bot'
Write-Host ''
Write-Host 'Verify: settings page shows "QQ bot"; bot replies in QQ group;'
Write-Host '        edits in the settings page take effect live.'
Write-Host ''
Write-Host 'Note: peer-dependency warnings from pnpm are expected and can be ignored.'

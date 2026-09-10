# 部署同步脚本(2026-09-10 主人教训: 曾只同步 dist, 漏了包根 client/settings-host)
# 用法: pwsh -File deploy.ps1
# 同步内容: dist/ + client/ + settings-host.js + voice-convert.mjs(如存在) → 线上 profile
$ErrorActionPreference = 'Stop'
$src = "D:\newwenjianjia\aiwork\鲸鱼娘\m1\dsh-qqbot-public - 副本"
$dep = "C:\Users\作早饭\.dsh\profiles\web\node_modules\@zaofan\dsh-qqbot"

Write-Host "=== 1/4 构建 ===" -ForegroundColor Cyan
Push-Location $src
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "构建失败, 中止同步" }
Pop-Location

Write-Host "=== 2/4 同步 dist/ ===" -ForegroundColor Cyan
robocopy "$src\dist" "$dep\dist" /IS /IT /E /NFL /NDL /NJH /NJS | Out-Null

Write-Host "=== 3/4 同步 client/(dock 前端 UI) ===" -ForegroundColor Cyan
robocopy "$src\client" "$dep\client" /IS /IT /E /NFL /NDL /NJH /NJS | Out-Null

Write-Host "=== 4/4 同步包根文件 ===" -ForegroundColor Cyan
robocopy "$src" "$dep" settings-host.js /IS /IT /NFL /NDL /NJH /NJS | Out-Null
if (Test-Path "$src\voice-convert.mjs") {
  robocopy "$src" "$dep" voice-convert.mjs /IS /IT /NFL /NDL /NJH /NJS | Out-Null
}

Write-Host ""
Write-Host "=== 校验 ===" -ForegroundColor Green
$c = Get-Content "$dep\client\qqbot-settings.js" -Raw
$h = Get-Content "$dep\settings-host.js" -Raw
$checks = [ordered]@{
  'client: 卡片tab'        = $c.Contains("'card'")
  'client: 存为事件'       = $c.Contains('dk-card-save')
  'client: 群发按钮'       = $c.Contains('dk-roster-send')
  'client: botplay正文'    = $c.Contains('dk-bp-content')
  'host: send-card'        = $h.Contains('chat/send-card')
  'host: botplay-events'   = $h.Contains('group/botplay-events')
  'host: broadcast'        = $h.Contains('group/broadcast/create')
  # 反向校验: 已移除的功能不应残留(2026-09-10 主人定删自动审批策略)
  'host: 审批策略已移除'   = -not $h.Contains('approval_strategy')
  'client: 审批UI已移除'   = -not $c.Contains('dk-ap-create')
}
$fail = 0
foreach ($k in $checks.Keys) {
  if ($checks[$k]) { Write-Host ("  OK   " + $k) -ForegroundColor Green }
  else { Write-Host ("  MISS " + $k) -ForegroundColor Red; $fail++ }
}
Write-Host ""
if ($fail -eq 0) { Write-Host "同步完成, 全部校验通过。记得重启宿主(dsh web)让 client/host 生效。" -ForegroundColor Green }
else { Write-Host "有 $fail 项缺失, 请检查源文件!" -ForegroundColor Red; exit 1 }

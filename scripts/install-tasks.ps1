# 一键注册三个计划任务（登录时自启 + 看门狗每 5 分钟）
# 用法（管理员 PowerShell）：
#   .\scripts\install-tasks.ps1 -Server admin@1.2.3.4 -KeyPath C:\path\to\id_ed25519
param(
  [Parameter(Mandatory = $true)][string]$Server,   # 例如 admin@1.2.3.4
  [Parameter(Mandatory = $true)][string]$KeyPath,  # 私钥路径
  [int]$RemotePort = 18787                         # 云端映射到的端口
)

$root = Split-Path -Parent $PSScriptRoot
$scripts = $PSScriptRoot

# 1) 生成 tunnel.cmd
$tunnel = @"
@echo off
chcp 65001 >nul
set SSH=$env:SystemRoot\System32\OpenSSH\ssh.exe
set KEY=$KeyPath
set HOST=$Server
:loop
"%SSH%" -i "%KEY%" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o BatchMode=yes -N -R ${RemotePort}:127.0.0.1:8787 "%HOST%" >> "$root\tunnel.log" 2>&1
timeout /t 10 /nobreak >nul
goto loop
"@
Set-Content -Path (Join-Path $scripts 'tunnel.cmd') -Value $tunnel -Encoding OEM
Write-Host "已生成 scripts\tunnel.cmd（$Server -> ${RemotePort}:8787）"

# 2) 注册任务
schtasks /Create /TN "DSH-Feed-Node"     /TR "cmd.exe /c `"$scripts\start-node.cmd`""  /SC ONLOGON /RL HIGHEST /F | Out-Null
schtasks /Create /TN "DSH-Feed-Tunnel"   /TR "cmd.exe /c `"$scripts\tunnel.cmd`""      /SC ONLOGON /RL HIGHEST /F | Out-Null
schtasks /Create /TN "DSH-Feed-Watchdog" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$scripts\watchdog.ps1`"" /SC MINUTE /MO 5 /RL HIGHEST /F | Out-Null
Write-Host "已注册 DSH-Feed-Node / DSH-Feed-Tunnel / DSH-Feed-Watchdog"

# 3) 立刻跑一次
schtasks /Run /TN "DSH-Feed-Node"   | Out-Null
Start-Sleep -Seconds 4
schtasks /Run /TN "DSH-Feed-Tunnel" | Out-Null
Start-Sleep -Seconds 6
Write-Host "已启动，试一下: curl http://127.0.0.1:8787/health"

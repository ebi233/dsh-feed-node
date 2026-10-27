# 看门狗：隧道或取数服务掉了就拉起来。由计划任务每 5 分钟跑一次。
$root = Split-Path -Parent $PSScriptRoot
$node = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*src\server.mjs*' -or $_.CommandLine -like '*src/server.mjs*' }
if (-not $node) {
  Start-Process cmd.exe -ArgumentList '/c', (Join-Path $PSScriptRoot 'start-node.cmd') -WindowStyle Hidden
  "[$(Get-Date -Format 'HH:mm:ss')] node 掉了，已重启" | Out-File -Append -Encoding utf8 (Join-Path $root 'watchdog.log')
}
$ssh = Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*-R 18787*' }
if (-not $ssh -and (Test-Path (Join-Path $PSScriptRoot 'tunnel.cmd'))) {
  Start-Process cmd.exe -ArgumentList '/c', (Join-Path $PSScriptRoot 'tunnel.cmd') -WindowStyle Hidden
  "[$(Get-Date -Format 'HH:mm:ss')] tunnel 掉了，已重启" | Out-File -Append -Encoding utf8 (Join-Path $root 'watchdog.log')
}

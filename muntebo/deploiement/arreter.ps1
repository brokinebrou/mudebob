# Arrête le serveur MUDEBO (boucle de relance + processus node)
$port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$n = 0
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*deploiement\serveur.bat*' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++
}
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; $n++ }
}
if ($n) { Write-Host "MUDEBO est arrêté." -ForegroundColor Green } else { Write-Host "MUDEBO n'était pas démarré." }

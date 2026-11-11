# Installation de MUDEBO sur ce poste (sans droits administrateur) :
#  - démarrage automatique et invisible à l'ouverture de la session Windows
#  - raccourcis Bureau et menu Démarrer
#  - démarrage immédiat
$ErrorActionPreference = 'Stop'
$dep = $PSScriptRoot
$racine = Split-Path -Parent $dep
$port = 3000
Set-Location $racine
Write-Host "`n=== Installation de MUDEBO ===`n" -ForegroundColor Green

# 1. Node.js et dépendances
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js n'est pas installé. Installez la version LTS depuis https://nodejs.org puis relancez." -ForegroundColor Red
  exit 1
}
Write-Host "Node.js $(node --version) détecté."
if (-not (Test-Path (Join-Path $racine 'node_modules'))) {
  Write-Host "Installation des dépendances (une seule fois)..."
  npm install --omit=dev
}

# 2. Icône (à partir du logo)
$ico = Join-Path $dep 'mudebo.ico'
if (-not (Test-Path $ico)) {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Image]::FromFile((Join-Path $racine 'public\img\logo.jpg'))
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.Clear([System.Drawing.Color]::White)
  $h = [int](64 * $src.Height / $src.Width); $g.DrawImage($src, 0, [int]((64 - $h) / 2), 64, $h)
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [System.IO.File]::Create($ico); $icon.Save($fs); $fs.Close()
  $g.Dispose(); $bmp.Dispose(); $src.Dispose()
}

# 3. Raccourcis
$sh = New-Object -ComObject WScript.Shell
function Raccourci($chemin, $cible, $arguments, $description) {
  $l = $sh.CreateShortcut($chemin)
  $l.TargetPath = $cible; $l.Arguments = $arguments; $l.WorkingDirectory = $racine
  $l.IconLocation = $ico; $l.Description = $description; $l.Save()
}
$vbs = Join-Path $dep 'mudebo-serveur.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$bureau = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'MUDEBO'
New-Item -ItemType Directory -Force $menu | Out-Null
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

Raccourci (Join-Path $startup 'MUDEBO (serveur).lnk') "$env:SystemRoot\System32\wscript.exe" "`"$vbs`"" 'Démarre le serveur MUDEBO en arrière-plan'
Raccourci (Join-Path $bureau 'MUDEBO.lnk') "$env:SystemRoot\explorer.exe" "http://localhost:$port" 'Ouvrir MUDEBO'
Raccourci (Join-Path $menu 'MUDEBO.lnk') "$env:SystemRoot\explorer.exe" "http://localhost:$port" 'Ouvrir MUDEBO'
Raccourci (Join-Path $menu 'Démarrer le serveur MUDEBO.lnk') "$env:SystemRoot\System32\wscript.exe" "`"$vbs`"" 'Démarre le serveur MUDEBO'
Raccourci (Join-Path $menu 'Arrêter le serveur MUDEBO.lnk') $ps "-NoProfile -ExecutionPolicy Bypass -File `"$dep\arreter.ps1`"" 'Arrête le serveur MUDEBO'
Raccourci (Join-Path $menu 'Sauvegardes MUDEBO.lnk') "$env:SystemRoot\explorer.exe" "`"$racine\data\sauvegardes`"" 'Dossier des sauvegardes'
Raccourci (Join-Path $menu 'Journal du serveur MUDEBO.lnk') "$env:SystemRoot\System32\notepad.exe" "`"$racine\data\logs\serveur.log`"" 'Journal technique du serveur'
Write-Host "Raccourcis créés : Bureau, menu Démarrer > MUDEBO, démarrage automatique."

# 4. Démarrage immédiat
$actif = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $actif) {
  Start-Process "$env:SystemRoot\System32\wscript.exe" "`"$vbs`""
  for ($i = 0; $i -lt 30 -and -not $actif; $i++) { Start-Sleep -Milliseconds 500; $actif = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue }
}
if ($actif) { Write-Host "Serveur démarré." -ForegroundColor Green } else { Write-Host "Le serveur ne répond pas : voir data\logs\serveur.log" -ForegroundColor Red; exit 1 }

# 5. Accès depuis les autres postes du réseau (pare-feu)
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
$regle = Get-NetFirewallRule -DisplayName 'MUDEBO' -ErrorAction SilentlyContinue
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $regle -and $admin) {
  New-NetFirewallRule -DisplayName 'MUDEBO' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private,Domain | Out-Null
  $regle = $true
}
Write-Host "`nAdresse sur ce poste :  http://localhost:$port"
foreach ($ip in $ips) { Write-Host "Depuis le réseau :      http://${ip}:$port" }
if (-not $regle) {
  Write-Host "`nPour l'accès depuis d'autres postes, Windows doit autoriser le port $port." -ForegroundColor Yellow
  Write-Host "Demandez au service informatique (ou lancez en administrateur) :" -ForegroundColor Yellow
  Write-Host "  netsh advfirewall firewall add rule name=MUDEBO dir=in action=allow protocol=TCP localport=$port profile=private,domain"
}
Start-Process "http://localhost:$port"
Write-Host "`nInstallation terminée." -ForegroundColor Green

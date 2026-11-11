# Retire le démarrage automatique et les raccourcis de MUDEBO (les données dans data\ sont conservées)
& (Join-Path $PSScriptRoot 'arreter.ps1')
$liste = @(
  (Join-Path ([Environment]::GetFolderPath('Startup')) 'MUDEBO (serveur).lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MUDEBO.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'MUDEBO')
)
foreach ($c in $liste) { if (Test-Path $c) { Remove-Item $c -Recurse -Force } }
Write-Host "Démarrage automatique et raccourcis retirés. Les données (dossier data) sont conservées." -ForegroundColor Green

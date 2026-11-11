@echo off
rem Serveur MUDEBO en tache de fond : relance automatique en cas d'arret, journal dans data\logs\serveur.log
cd /d "%~dp0.."
if "%PORT%"=="" set PORT=3000
set NODE_ENV=production
if not exist data\logs mkdir data\logs

:boucle
rem Deja demarre (autre instance) : on ne lance rien
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul && exit /b 0
rem Rotation du journal au-dela de 5 Mo
for %%F in (data\logs\serveur.log) do if %%~zF GTR 5000000 move /y data\logs\serveur.log data\logs\serveur-ancien.log >nul
echo [%date% %time%] Demarrage du serveur >> data\logs\serveur.log
node server.js >> data\logs\serveur.log 2>&1
echo [%date% %time%] Serveur arrete (code %errorlevel%), relance dans 10 s >> data\logs\serveur.log
ping -n 11 127.0.0.1 >nul
goto boucle

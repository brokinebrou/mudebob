@echo off
chcp 65001 >nul
title MUDEBO
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des dependances...
  call npm install --omit=dev
)
echo Demarrage de MUDEBO...
start "" http://localhost:3000
node server.js
pause

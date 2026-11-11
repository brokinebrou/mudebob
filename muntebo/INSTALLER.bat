@echo off
chcp 65001 >nul
title Installation de MUDEBO
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploiement\installer.ps1"
pause

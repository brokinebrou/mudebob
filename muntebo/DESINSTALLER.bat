@echo off
chcp 65001 >nul
title Desinstallation de MUDEBO
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploiement\desinstaller.ps1"
pause

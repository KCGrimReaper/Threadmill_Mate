@echo off
rem Threadmill Mate - PC qui garde les videos : relance en administrateur puis regle le partage.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp01-PC-des-videos.ps1"
echo.
pause

@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Wildborn from source.
  echo Download it from https://nodejs.org/ then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Installing Wildborn dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)

echo Starting Wildborn...
call npm start
if errorlevel 1 (
  echo Wildborn failed to start.
  pause
  exit /b 1
)

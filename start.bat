@echo off
setlocal

cd /d "%~dp0"

set "WEB_URL=http://127.0.0.1:5178"
set "SERVER_URL=http://127.0.0.1:8788/health"

echo ========================================
echo  Murder Loop AI - Quick Start
echo ========================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot find npm. Please install Node.js first:
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] node_modules not found. Installing dependencies...
  npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
)

if not exist "apps\server\.env" (
  echo [WARN] apps\server\.env not found. The game can still run with local fallback, but real AI calls need API keys.
  echo.
)

echo [INFO] Starting development servers...
echo [INFO] Web app: %WEB_URL%
echo [INFO] Server health: %SERVER_URL%
echo [INFO] The browser will open after a short delay.
echo [INFO] Press Ctrl+C in this window to stop.
echo.

start "Murder Loop AI Browser" cmd /c "timeout /t 6 /nobreak >nul && start "" "%WEB_URL%""
npm run dev

echo.
echo [INFO] Server stopped.
pause

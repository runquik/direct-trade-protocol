@echo off
setlocal
cd /d "%~dp0sdk"
echo Starting Passport. Keep this window open during your demo.
echo When ready, open http://127.0.0.1:8789 in your browser.
echo Press Ctrl+C here to stop. Restarting resets the fictional companies.
call npx --yes --package=node@22.23.2 node scripts/passport-web.ts
if errorlevel 1 (
  echo.
  echo Startup failed. If the demo is already running, use its existing window.
  echo Otherwise check that npm and the sdk dependencies are installed.
  pause
)

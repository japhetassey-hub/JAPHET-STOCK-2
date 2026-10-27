@echo off
REM Run this on Windows 10/11 with internet (first build downloads Electron and NSIS). Requires Node.js 20 or newer.
node -v || (echo Install Node.js LTS from https://nodejs.org first & exit /b 1)
call npm install || exit /b 1
call npm run dist || exit /b 1
echo.
echo Installer created in: %CD%\dist
dir /b dist\*.exe

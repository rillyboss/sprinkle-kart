@echo off
title Sprinkle Kart
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Sprinkle Kart needs Node.js to run.
  echo   Please install it from https://nodejs.org  then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo   Getting Sprinkle Kart ready for the first time... this takes a minute.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Oh no, the install did not work. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo   Starting Sprinkle Kart! Your browser will open in a moment.
echo   Keep this window open while you play. Close it when you are done.
echo.
call npm run dev
pause

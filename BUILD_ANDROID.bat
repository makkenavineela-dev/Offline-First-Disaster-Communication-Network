@echo off
echo ========================================
echo  RESQ Android Build Script
echo ========================================

cd /d "%~dp0frontend"

echo.
echo [1/4] Pulling latest changes from GitHub...
git pull origin claude/nervous-engelbart

echo.
echo [2/4] Installing npm packages...
call npm install

echo.
echo [3/4] Building www/ folder...
node build_android_assets.js

echo.
echo [4/4] Syncing to Android...
call npx cap sync android

echo.
echo ========================================
echo  BUILD COMPLETE!
echo  Now open Android Studio and:
echo  1. Click Build ^> Clean Project
echo  2. Click Build ^> Rebuild Project
echo  3. Run on your device
echo ========================================
pause

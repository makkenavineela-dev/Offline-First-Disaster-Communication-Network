@echo off
echo ========================================
echo  RESQ Android Build Script
echo ========================================

cd /d "%~dp0frontend"

echo.
echo [1/4] Pulling latest changes from GitHub...
git pull origin main

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
echo [5/5] Clearing Gradle build cache...
cd android
call gradlew clean
cd ..

echo.
echo ========================================
echo  BUILD COMPLETE!
echo  Now open Android Studio and:
echo  1. Click Build ^> Rebuild Project  (NOT just Run — must Rebuild)
echo  2. Run on your device
echo  If still broken: File ^> Invalidate Caches / Restart
echo ========================================
pause

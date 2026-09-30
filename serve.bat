@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   لعبة إنقاذ الروبوت من الحفرة
echo   افتح المتصفح على:  http://localhost:5173
echo   (للمعايرة:  http://localhost:5173/?debug=1 )
echo   لإيقاف الخادم اضغط Ctrl+C
echo ============================================
start "" http://localhost:5173
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 5173
) else (
  npx --yes serve -l 5173 .
)

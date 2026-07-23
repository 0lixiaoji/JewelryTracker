@echo off
chcp 65001 >nul
echo ========================================
echo   JewelryTracker - 安装依赖
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 安装 Python 依赖...
venv\Scripts\pip.exe install opencv-python Pillow numpy
if %errorlevel% neq 0 (
    echo [FAIL] Python 依赖安装失败
    pause
    exit /b 1
)
echo [OK] Python 依赖安装完成

echo.
echo [2/2] 执行图片切分脚本...
venv\Scripts\python.exe scripts\split_images.py
if %errorlevel% neq 0 (
    echo [FAIL] 图片切分失败
    pause
    exit /b 1
)
echo [OK] 图片切分完成

echo.
echo ========================================
echo   安装与切分全部完成！
echo ========================================
pause

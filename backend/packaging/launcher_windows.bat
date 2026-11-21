@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "BASE=%~dp0"
set "DATA=%LOCALAPPDATA%\WaterOps"

:: ===== 首次运行：准备数据目录、种子库、配置 =====
if not exist "%DATA%" mkdir "%DATA%"
if not exist "%DATA%\uploads" mkdir "%DATA%\uploads"
if not exist "%DATA%\water_ops.db" copy /Y "%BASE%seed\water_ops.db" "%DATA%\water_ops.db" >nul

for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "SECRET=%%i"
if not exist "%DATA%\.env" (
  set "DBFWD=%DATA:\=/%"
  >"%DATA%\.env" (
    echo APP_NAME=WaterOps
    echo APP_ENV=prod
    echo DEBUG=false
    echo ENABLE_DOCS=false
    echo JWT_SECRET=!SECRET!
    echo DATABASE_URL=sqlite:///!DBFWD!/water_ops.db
    echo UPLOAD_DIR=!DBFWD!/uploads
    echo BOOTSTRAP_ADMIN_USERNAME=admin
    echo BOOTSTRAP_ADMIN_PASSWORD=admin123
    echo SCADA_MODE=mock
    echo SCADA_AUTO_START=true
    echo AI_ENABLED=false
  )
)

:: ===== 启动后端服务（后台运行，记录 PID）=====
set "FRONTEND_DIST=%BASE%web"
set "OPEN_BROWSER=0"
set "PORT_FILE=%DATA%\runtime.port"
cd /d "%DATA%"

echo ============================================
echo   水务运维平台 - 服务启动中...
echo ============================================

:: 用 PowerShell 启动服务并获取 PID，避免 start /b 拿不到 PID
for /f %%a in ('powershell -NoProfile -Command "$p = Start-Process -FilePath '%BASE%server\water-ops-server.exe' -WorkingDirectory '%DATA%' -WindowStyle Hidden -PassThru; $p.Id"') do set "SERVER_PID=%%a"

if not defined SERVER_PID (
  echo 服务启动失败，请查看日志：%DATA%\server.log
  pause
  exit /b 1
)

:: ===== 轮询端口文件，最多等 60 秒 =====
set "PORT="
for /L %%i in (1,1,60) do (
  if exist "%DATA%\runtime.port" (
    set /p PORT=<"%DATA%\runtime.port"
    goto :ready
  )
  timeout /t 1 /nobreak >nul
)

echo 服务启动超时，请查看日志：%DATA%\server.log
taskkill /F /PID %SERVER_PID% >nul 2>&1
pause
exit /b 1

:ready
echo 服务已启动！
echo.

:: 获取局域网 IP（用于控制台展示）
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LAN_IP=%%i"

echo 本机访问：   http://127.0.0.1:%PORT%
if defined LAN_IP (
  echo 局域网访问： http://%LAN_IP%:%PORT%
) else (
  echo 局域网访问： 请查看本机 IP 地址
)
echo.
echo 桌面已生成「水务运维平台-访问地址.txt」，其他电脑照着输入即可。
echo.

:: 打开浏览器
start "" "http://127.0.0.1:%PORT%"

echo 关闭本窗口或按任意键将停止服务。
pause >nul

:: ===== 停止服务 =====
taskkill /F /PID %SERVER_PID% >nul 2>&1
echo 服务已停止。
endlocal

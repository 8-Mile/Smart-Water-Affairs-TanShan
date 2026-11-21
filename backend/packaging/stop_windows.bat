@echo off
taskkill /F /IM water-ops-server.exe 2>nul
if errorlevel 1 (
  echo 未发现正在运行的服务。
) else (
  echo 服务已停止。
)
pause

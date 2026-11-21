# 在 Windows 机器上构建免安装包（无需 Node/Python 运行环境，仅构建时需要）
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$backend = (Get-Location).Path
$project = Split-Path $backend -Parent
$stage = Join-Path $project "release\WaterOps-Windows"

Write-Host "[1/5] 检查前端构建产物"
if (-not (Test-Path (Join-Path $project "frontend\dist\index.html"))) {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Push-Location (Join-Path $project "frontend")
    npm ci
    npm run build
    Pop-Location
  } else {
    throw "缺少 frontend\dist 且本机无 Node.js：请在任意机器构建前端后复制 dist 目录"
  }
}

Write-Host "[2/5] 准备 Python 构建环境"
$venv = Join-Path $backend ".venv-win"
$python = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $python)) {
  # 必须用 3.10~3.12：3.13 上 pydantic-core 无预编译 wheel，会退化为源码编译并需要 Rust 工具链
  $candidates = @()
  if ($env:PYTHON_BIN) { $candidates += ,@($env:PYTHON_BIN) }
  $candidates += ,@("python")
  $candidates += ,@("py", "-3.12")
  $candidates += ,@("py", "-3.11")
  $chosen = $null
  foreach ($c in $candidates) {
    if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
    $pyArgs = if ($c.Count -gt 1) { $c[1..($c.Count - 1)] } else { @() }
    $ver = & $c[0] @pyArgs -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>$null
    if ($LASTEXITCODE -eq 0 -and $ver -in @("3.10", "3.11", "3.12")) { $chosen = $c; break }
  }
  if (-not $chosen) {
    throw "未找到 Python 3.10~3.12（当前系统 Python 可能是 3.13，pydantic-core 无 wheel）。请安装 Python 3.11。"
  }
  $pyArgs = if ($chosen.Count -gt 1) { $chosen[1..($chosen.Count - 1)] } else { @() }
  & $chosen[0] @pyArgs -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw "创建 Python 虚拟环境失败" }
}
& $python -m pip install -q -r requirements.txt "pyinstaller>=6.10"
if ($LASTEXITCODE -ne 0) { throw "安装构建依赖失败，请检查 requirements.txt 与 Python 版本" }

Write-Host "[3/5] 准备种子数据库"
& $python packaging\prepare_seed.py

Write-Host "[4/5] 打包后端"
& $python -m PyInstaller --noconfirm --clean --onedir --name water-ops-server `
  --paths $backend `
  --collect-submodules app `
  --collect-submodules uvicorn `
  --hidden-import=uvicorn.logging `
  --hidden-import=uvicorn.loops.auto `
  --hidden-import=uvicorn.protocols.http.auto `
  --hidden-import=uvicorn.protocols.websockets.auto `
  --hidden-import=uvicorn.lifespan.on `
  --hidden-import=passlib.handlers.bcrypt `
  --hidden-import=pymysql `
  --hidden-import=openpyxl `
  --hidden-import=email_validator `
  --distpath build\pyinstaller-dist `
  --workpath build\pyinstaller-work `
  --specpath build `
  packaging\entry.py

Write-Host "[5/5] 组装免安装目录"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -Recurse "build\pyinstaller-dist\water-ops-server" (Join-Path $stage "server")
Copy-Item -Recurse (Join-Path $project "frontend\dist") (Join-Path $stage "web")
New-Item -ItemType Directory -Path (Join-Path $stage "seed") | Out-Null
Copy-Item "build\seed\water_ops.db" (Join-Path $stage "seed\water_ops.db")
Copy-Item "packaging\launcher_windows.bat" (Join-Path $stage "启动服务.bat")
Copy-Item "packaging\stop_windows.bat" (Join-Path $stage "停止服务.bat")
Copy-Item "packaging\使用说明.txt" (Join-Path $stage "使用说明.txt")

$zip = Join-Path $project "release\WaterOps-Windows.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force

Write-Host "[6/6] 生成安装程序 setup.exe（需要 Inno Setup）"
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
$setupExe = Join-Path $project "release\WaterOps-Setup-1.0.0.exe"
if ($iscc) {
  Push-Location (Join-Path $backend "packaging")
  & iscc "setup_windows.iss" | Out-Null
  Pop-Location
  if (Test-Path $setupExe) {
    Write-Host "      $setupExe"
  } else {
    Write-Host "      Inno Setup 编译未产出 exe，请检查脚本。"
  }
} else {
  Write-Host "      未检测到 Inno Setup，跳过安装包生成。"
  Write-Host "      免安装包仍可用：$zip"
  Write-Host "      如需 setup.exe，请安装 Inno Setup 6：https://jrsoftware.org/isinfo.php"
}

Write-Host ""
Write-Host "完成："
Write-Host "  免安装目录：$stage"
Write-Host "  免安装压缩包：$zip"
if (Test-Path $setupExe) { Write-Host "  安装包：$setupExe" }
Write-Host ""
Write-Host "交付建议：优先分发 setup.exe（双击自动安装到 Program Files + 桌面快捷方式）"

#!/bin/bash
# 构建 macOS 一键部署包：内置后端二进制 + 前端静态资源 + 种子数据库
set -euo pipefail
cd "$(dirname "$0")/.."
BACKEND_DIR="$(pwd)"
PROJECT_DIR="$(cd .. && pwd)"
VERSION="1.0.0"
ARCH="$(uname -m)"
APP_NAME="水务运维平台"
APP_BUNDLE="$PROJECT_DIR/release/${APP_NAME}.app"
DMG_NAME="WaterOps-${VERSION}-mac-${ARCH}.dmg"

echo "[1/5] 检查前端构建产物"
if [ "${REBUILD_WEB:-0}" = "1" ] || [ ! -f "$PROJECT_DIR/frontend/dist/index.html" ]; then
  (cd "$PROJECT_DIR/frontend" && npm run build)
else
  echo "  复用 frontend/dist（如需重建：REBUILD_WEB=1 重新执行）"
fi

echo "[2/5] 安装/检查 PyInstaller"
if ! .venv/bin/python -m PyInstaller --version >/dev/null 2>&1; then
  .venv/bin/python -m pip install -q "pyinstaller>=6.10"
fi

echo "[3/5] 准备种子数据库"
.venv/bin/python packaging/prepare_seed.py

echo "[4/5] 打包后端为独立可执行程序"
HIDDEN=(--hidden-import=uvicorn.logging --hidden-import=uvicorn.loops.auto
  --hidden-import=uvicorn.protocols.http.auto --hidden-import=uvicorn.protocols.websockets.auto
  --hidden-import=uvicorn.lifespan.on --hidden-import=passlib.handlers.bcrypt
  --hidden-import=pymysql --hidden-import=openpyxl --hidden-import=email_validator)
for mod in uvloop httptools websockets watchfiles; do
  if .venv/bin/python -c "import $mod" >/dev/null 2>&1; then
    HIDDEN+=(--hidden-import=$mod)
  fi
done
.venv/bin/python -m PyInstaller --noconfirm --clean --onedir --name water-ops-server \
  --paths "$BACKEND_DIR" \
  --collect-submodules app \
  --collect-submodules uvicorn \
  "${HIDDEN[@]}" \
  --distpath "$BACKEND_DIR/build/pyinstaller-dist" \
  --workpath "$BACKEND_DIR/build/pyinstaller-work" \
  --specpath "$BACKEND_DIR/build" \
  "$BACKEND_DIR/packaging/entry.py"

echo "[5/5] 组装 .app 并生成 DMG"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp -R "$BACKEND_DIR/build/pyinstaller-dist/water-ops-server" "$APP_BUNDLE/Contents/Resources/server"
cp -R "$PROJECT_DIR/frontend/dist" "$APP_BUNDLE/Contents/Resources/web"
mkdir -p "$APP_BUNDLE/Contents/Resources/seed"
cp "$BACKEND_DIR/build/seed/water_ops.db" "$APP_BUNDLE/Contents/Resources/seed/water_ops.db"

cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</string><string>${APP_NAME}</string>
  <key>CFBundleExecutable</key><string>WaterOps</string>
  <key>CFBundleIdentifier</key><string>com.waterops.platform</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.business</string>
</dict>
</plist>
PLIST

cat > "$APP_BUNDLE/Contents/MacOS/WaterOps" <<'LAUNCHER'
#!/bin/bash
set -e
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
DATA_DIR="$HOME/Library/Application Support/WaterOps"
mkdir -p "$DATA_DIR/uploads"

if [ ! -f "$DATA_DIR/water_ops.db" ]; then
  cp "$RES/seed/water_ops.db" "$DATA_DIR/water_ops.db"
fi

if [ ! -f "$DATA_DIR/.env" ]; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || uuidgen)"
  cat > "$DATA_DIR/.env" <<EOF
APP_NAME=水务运维平台
APP_ENV=prod
DEBUG=false
ENABLE_DOCS=false
JWT_SECRET=$SECRET
DATABASE_URL=sqlite:///$DATA_DIR/water_ops.db
UPLOAD_DIR=$DATA_DIR/uploads
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=admin123
SCADA_MODE=mock
SCADA_AUTO_START=true
AI_ENABLED=false
EOF
fi

cd "$DATA_DIR"
export FRONTEND_DIST="$RES/web"
export OPEN_BROWSER=1
export PORT_FILE="$DATA_DIR/runtime.port"
exec "$RES/server/water-ops-server" >>"$DATA_DIR/server.log" 2>&1
LAUNCHER
chmod +x "$APP_BUNDLE/Contents/MacOS/WaterOps"

if [ -f "$BACKEND_DIR/packaging/AppIcon.icns" ]; then
  cp "$BACKEND_DIR/packaging/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$APP_BUNDLE/Contents/Info.plist" >/dev/null
fi

codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || echo "  跳过签名（不影响本机使用）"

mkdir -p "$PROJECT_DIR/release"
rm -rf "$BACKEND_DIR/build/dmg"
mkdir -p "$BACKEND_DIR/build/dmg"
cp -R "$APP_BUNDLE" "$BACKEND_DIR/build/dmg/"
cp "$BACKEND_DIR/packaging/使用说明.txt" "$BACKEND_DIR/build/dmg/使用说明.txt"
ln -s /Applications "$BACKEND_DIR/build/dmg/Applications"
rm -f "$PROJECT_DIR/release/$DMG_NAME"
hdiutil create -volname "${APP_NAME} ${VERSION}" -srcfolder "$BACKEND_DIR/build/dmg" \
  -ov -format UDZO "$PROJECT_DIR/release/$DMG_NAME" >/dev/null

echo "[6/6] 生成 .pkg 安装包（双击自动安装到 /Applications）"
PKG_NAME="WaterOps-${VERSION}.pkg"
rm -f "$PROJECT_DIR/release/$PKG_NAME"
if productbuild --component "$APP_BUNDLE" /Applications "$PROJECT_DIR/release/$PKG_NAME" >/dev/null 2>&1; then
  echo "  $PROJECT_DIR/release/$PKG_NAME"
else
  echo "  跳过 .pkg（productbuild 不可用或签名问题）"
fi

echo "完成："
echo "  $APP_BUNDLE"
echo "  $PROJECT_DIR/release/$DMG_NAME"
[ -f "$PROJECT_DIR/release/$PKG_NAME" ] && echo "  $PROJECT_DIR/release/$PKG_NAME"
echo ""
echo "交付建议："
echo "  - 优先分发 .pkg（双击自动安装到应用程序）"
echo "  - .dmg 作为备选（手动拖入应用程序）"
echo "  - 首次运行需右键打开（ad-hoc 签名）"

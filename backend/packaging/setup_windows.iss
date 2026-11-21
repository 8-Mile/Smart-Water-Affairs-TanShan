; 水务运维平台 Windows 安装包脚本（Inno Setup）
; 构建前需先运行 build_windows.ps1 产出 release\WaterOps-Windows\ 目录
; 然后用 Inno Setup Compiler 编译本脚本，或由 build_windows.ps1 自动调用

#define MyAppName "水务运维平台"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "WaterOps"
#define MyAppExeName "启动服务.bat"

[Setup]
AppId={{B8E4F2A1-7D3C-4E5F-9A2B-1C3D5E7F9A1B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\WaterOps
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\..\release
OutputBaseFilename=WaterOps-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\server\water-ops-server.exe

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
Source: "..\..\release\WaterOps-Windows\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\启动服务.bat"; WorkingDir: "{app}"; Comment: "启动水务运维平台服务"
Name: "{group}\停止服务"; Filename: "{app}\停止服务.bat"; WorkingDir: "{app}"; Comment: "停止水务运维平台服务"
Name: "{group}\使用说明"; Filename: "{app}\使用说明.txt"; WorkingDir: "{app}"
Name: "{group}\卸载{#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\启动服务.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\启动服务.bat"; Description: "立即启动{#MyAppName}"; Flags: nowait postinstall skipifsilent

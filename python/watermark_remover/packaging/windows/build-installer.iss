; Inno Setup 脚本概要 — 在 Windows 上安装 Inno Setup 后编译
; 前置：pyinstaller packaging/watermark_remover_gui.spec 生成 dist\WatermarkRemover

[Setup]
AppName=Watermark Remover
AppVersion=1.0.0
DefaultDirName={autopf}\WatermarkRemover
DefaultGroupName=Watermark Remover
OutputBaseFilename=WatermarkRemover-Setup
Compression=lzma2
SolidCompression=yes

[Files]
Source: "..\..\dist\WatermarkRemover\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\Watermark Remover"; Filename: "{app}\WatermarkRemover.exe"
Name: "{commondesktop}\Watermark Remover"; Filename: "{app}\WatermarkRemover.exe"

[Run]
Filename: "{app}\WatermarkRemover.exe"; Description: "启动 Watermark Remover"; Flags: postinstall nowait skipifsilent

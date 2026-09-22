# 在桌面创建「我的待办」快捷方式（带应用图标）。
# 由你手动运行：右键本文件 → 使用 PowerShell 运行。

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bat  = Join-Path $root '启动我的待办.bat'
$icon = Join-Path $root 'icons\favicon.ico'

if (-not (Test-Path $bat)) {
    Write-Host "  没找到 启动我的待办.bat，请确认本脚本和它在同一个文件夹。" -ForegroundColor Red
    Read-Host '  按回车关闭'
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop '我的待办.lnk'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath       = $bat
$sc.WorkingDirectory = $root
$sc.Description      = '我的待办 · 日历'
if (Test-Path $icon) { $sc.IconLocation = $icon }
$sc.WindowStyle      = 7          # 最小化运行，减少控制台一闪而过
$sc.Save()

Write-Host ''
Write-Host "  已创建桌面快捷方式：$lnk" -ForegroundColor Green
Write-Host '  双击即可打开应用。'
Write-Host ''
Read-Host '  按回车关闭'

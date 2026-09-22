@echo off
rem LAN launcher: same as the normal launcher, but the server also listens on the
rem LAN so phones and other devices on the same WiFi can open the app and sync.
rem Keep this file pure ASCII (comments included): cmd.exe decodes .bat files with
rem the system ANSI codepage, and any Chinese byte sequence here breaks the script.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Lan

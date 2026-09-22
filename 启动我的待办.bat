@echo off
rem One-click launcher for "My Todo".
rem Keep this file pure ASCII: cmd.exe parses .bat files using the system ANSI
rem codepage, so UTF-8 Chinese here would be mis-decoded and break the script.
rem All real logic (and all Chinese messages) live in launch.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"

# 「我的待办」一键启动：确保本地服务在跑，然后用浏览器「应用模式」开窗
# （没有地址栏和标签页，和独立程序一样）。由 启动我的待办.bat 调用。
#
# 加 -Lan 参数则以局域网模式启动：手机等设备可以通过本机 IP 访问并与这台电脑同步。

param([switch]$Lan)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 8765
$url  = "http://127.0.0.1:$port/"
$usingPython = $false

function Test-AppUp {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Get-LanIp {
    try {
        $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
               Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
               Select-Object -ExpandProperty IPAddressToString
        return ($ips | Select-Object -First 1)
    } catch { return $null }
}

# ---------- 1. 本地服务 ----------
if (-not (Test-AppUp)) {

    $exe = $null; $srvArgs = $null
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $exe = 'node'; $srvArgs = 'server.js'
        if ($Lan) { $env:LAN = '1' }          # server.js 看到它就会监听 0.0.0.0
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        # python 兜底：没有 /api/data，多设备同步用不了，但应用本身照常能用
        $usingPython = $true
        $exe = 'python'
        $srvArgs = if ($Lan) { "-m http.server $port --bind 0.0.0.0" }
                   else       { "-m http.server $port --bind 127.0.0.1" }
    }

    if (-not $exe) {
        Write-Host ''
        Write-Host '  没有找到 Node.js 或 Python，无法启动本地服务。' -ForegroundColor Yellow
        Write-Host '  可以直接双击 index.html 使用（功能完全相同，'
        Write-Host '  只是浏览器不允许在 file:// 下「安装成应用」）。'
        Write-Host ''
        Read-Host '  按回车关闭'
        exit 1
    }

    $mode = if ($Lan) { '局域网模式' } else { '仅本机' }
    Write-Host "  正在启动本地服务（$exe，$mode）…"
    Start-Process -FilePath $exe -ArgumentList $srvArgs -WorkingDirectory $root -WindowStyle Minimized

    $up = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-AppUp) { $up = $true; break }
    }
    if (-not $up) {
        Write-Host '  服务启动超时。请查看任务栏里最小化的服务窗口提示。' -ForegroundColor Red
        Read-Host '  按回车关闭'
        exit 1
    }
    Write-Host '  服务已就绪。' -ForegroundColor Green
}

# ---------- 2. 局域网模式：把手机要用的地址说清楚 ----------
if ($Lan) {
    Write-Host ''
    $ip = Get-LanIp
    if (-not $ip) {
        Write-Host '  没检测到局域网 IP，请确认已连上 WiFi。' -ForegroundColor Yellow
    } else {
        $lanUrl = "http://${ip}:${port}/"
        # 正在跑的服务可能是之前用「仅本机」模式起的，那种手机连不上，实测一下
        $reachable = $false
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $lanUrl -TimeoutSec 2
            $reachable = ($r.StatusCode -eq 200)
        } catch { $reachable = $false }

        if ($reachable) {
            Write-Host '  手机 / 其他设备请用下面这个地址（需连同一个 WiFi）：' -ForegroundColor Cyan
            Write-Host "      $lanUrl" -ForegroundColor Cyan
        } else {
            Write-Host '  手机暂时连不上：正在运行的服务是「仅本机」模式。' -ForegroundColor Yellow
            Write-Host '  请先关掉任务栏里那个最小化的服务窗口，再重新运行本脚本。' -ForegroundColor Yellow
            Write-Host "  之后手机用这个地址： $lanUrl" -ForegroundColor Cyan
        }
    }
    Write-Host ''
    Write-Host '  首次运行 Windows 会弹出防火墙询问，必须点「允许访问」手机才连得上。'
    Write-Host '  注意：局域网内其他设备可以读写你的待办（数据不加密），'
    Write-Host '        请只在可信的网络（比如家里）使用这个模式。'
    if ($usingPython) {
        Write-Host '  提示：当前用的是 Python 兜底服务，多设备同步不可用。' -ForegroundColor Yellow
    }
}

# ---------- 3. 用应用模式开窗 ----------
$candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browser) {
    Start-Process -FilePath $browser -ArgumentList @(
        "--app=$url",
        '--window-size=1200,860',
        '--no-first-run',
        '--no-default-browser-check'
    )
} else {
    # 没装 Edge/Chrome 就用系统默认浏览器
    Start-Process $url
}

if ($Lan) {
    Write-Host ''
    Write-Host '  电脑上的窗口已打开。手机照上面的地址在浏览器里输入即可。' -ForegroundColor Green
    Start-Sleep -Seconds 3
}

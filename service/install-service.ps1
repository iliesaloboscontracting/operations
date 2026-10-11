# One-time setup: installs Operations as a real Windows Service
# ("OperationsServer") using NSSM, so it survives sleep/lock/logoff and
# auto-restarts on crash - unlike a Scheduled Task, which only runs inside
# your interactive logon session and dies whenever the PC goes to sleep.
#
# Run this ONCE from an elevated PowerShell (right-click PowerShell -> Run as
# Administrator), then paste:
#   C:\Users\ilies\Documents\operations\service\install-service.ps1

$nssm = "C:\Users\ilies\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
$svc = "OperationsServer"
$proj = "C:\Users\ilies\Documents\operations"

if (-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Not running elevated. Right-click PowerShell -> Run as Administrator, then run this script again."
    exit 1
}

# Remove any previous attempt so this script is safe to re-run. It's normal
# for these two to report "Can't open service!" on a fresh install - that
# just means there's nothing to remove yet, not a real failure.
& $nssm stop $svc *>$null
& $nssm remove $svc confirm *>$null

& $nssm install $svc "C:\Program Files\nodejs\node.exe" "`"$proj\node_modules\next\dist\bin\next`" start"
if ($LASTEXITCODE -ne 0) {
    Write-Host "nssm install failed (exit $LASTEXITCODE). Stopping here - nothing else was changed."
    exit 1
}
& $nssm set $svc AppDirectory $proj
& $nssm set $svc DisplayName "Operations Server"
& $nssm set $svc Description "Lobos Contracting Operations app (Next.js), production mode on port 3000. Runs as a Windows service so it survives sleep, logoff and reboot, and auto-restarts on crash."
& $nssm set $svc Start SERVICE_AUTO_START
& $nssm set $svc AppExit Default Restart
& $nssm set $svc AppRestartDelay 3000
& $nssm set $svc AppStdout "$proj\service\service-stdout.log"
& $nssm set $svc AppStderr "$proj\service\service-stderr.log"
& $nssm set $svc AppRotateFiles 1
& $nssm set $svc AppRotateBytes 5242880

Start-Service $svc
Start-Sleep -Seconds 6
Write-Host "`n=== Service status ==="
Get-Service $svc | Format-List Name, Status, StartType
Write-Host "=== HTTP check ==="
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 8
    Write-Host "Status: $($r.StatusCode) - it's up."
} catch {
    Write-Host "Request failed: $($_.Exception.Message)"
    Write-Host "Check $proj\service\service-stderr.log for details."
}

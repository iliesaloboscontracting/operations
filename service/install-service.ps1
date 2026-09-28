# One-time setup: installs Operate as a real Windows Service ("OperateServer")
# using NSSM, so it survives sleep/lock/logoff and auto-restarts on crash -
# unlike the old "Operate Server" Scheduled Task, which only ran inside your
# interactive logon session and died whenever the PC went to sleep.
#
# Run this ONCE from an elevated PowerShell (right-click PowerShell -> Run as
# Administrator), then paste:
#   C:\Users\ilies\Documents\job-board\service\install-service.ps1

$nssm = "C:\Users\ilies\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
$svc = "OperateServer"
$proj = "C:\Users\ilies\Documents\job-board"

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
& $nssm set $svc DisplayName "Operate Server"
& $nssm set $svc Description "Lobos Contracting Operate app (Next.js), production mode on port 3000. Runs as a Windows service so it survives sleep, logoff and reboot, and auto-restarts on crash."
& $nssm set $svc Start SERVICE_AUTO_START
& $nssm set $svc AppExit Default Restart
& $nssm set $svc AppRestartDelay 3000
& $nssm set $svc AppStdout "$proj\service\service-stdout.log"
& $nssm set $svc AppStderr "$proj\service\service-stderr.log"
& $nssm set $svc AppRotateFiles 1
& $nssm set $svc AppRotateBytes 5242880

# Stop the old "Operate Server" Scheduled Task and disable it so the two
# don't fight over port 3000. It's left in place (not deleted) in case
# something needs rolling back.
schtasks /end /tn "Operate Server" 2>$null
schtasks /change /tn "Operate Server" /disable 2>$null

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

# Registers "Operations DB Backup" correctly - wake-from-sleep, runs whether
# logged on or not, survives being on battery. Decision D1 (Brief 09, item 1).
# Since 21 Oct 2026 (Ilies) it runs backup-cloud.ps1: downloads the cloud
# server's nightly backup into OneDrive (an off-AWS copy), instead of copying
# the laptop's database, which stopped changing when production moved.
#
# Run this ONCE from an elevated PowerShell (right-click PowerShell -> Run as
# Administrator), then paste:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\ilies\Documents\operations\scripts\register-backup-task.ps1"

$ErrorActionPreference = "Stop"
$taskName = "Operations DB Backup"
$scriptPath = "C:\Users\ilies\Documents\operations\scripts\backup-cloud.ps1"
$keyDir = "C:\ProgramData\OperationsBackup"
$backupDir = "C:\Users\ilies\OneDrive\Operations-Backups"

if (-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Not running elevated. Right-click PowerShell -> Run as Administrator, then run this script again."
    exit 1
}

# SSH key + known hosts for SYSTEM, readable only by SYSTEM and Administrators
# (OpenSSH refuses a key owned by another user).
New-Item -ItemType Directory -Force $keyDir | Out-Null
Copy-Item "C:\Users\ilies\.ssh\lobos_ops_lightsail", "C:\Users\ilies\.ssh\known_hosts" $keyDir -Force
icacls $keyDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
# Files get plain grants - inheritance flags (OI)(CI) only apply to folders,
# and on a file they left it with no access at all (21 Oct 2026).
foreach ($f in "lobos_ops_lightsail", "known_hosts") {
    icacls "$keyDir\$f" /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" | Out-Null
    icacls "$keyDir\$f" /setowner SYSTEM | Out-Null
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopOnIdleEnd `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# SYSTEM so the backup runs whether ilies is logged on or not, and survives
# sleep/lock - same reasoning as the OperationsServer service.
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description "Nightly off-AWS copy of the live Operations data: downloads the cloud server's 1:30am backup (database + tool photos) into OneDrive, checks it, keeps 30 days. Wakes the PC if asleep, retries 3x 10 minutes apart on failure. See scripts/backup-cloud.ps1." `
    | Out-Null

Write-Host "Registered. Triggering it now to confirm it actually works end-to-end..."
$before = (Get-ChildItem $backupDir -Filter "cloud-dev-*.db.gz" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1).LastWriteTime
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 20

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "`nLast Run Time:   $($info.LastRunTime)"
Write-Host "Last Task Result: $($info.LastTaskResult)  (0 = success)"

$after = (Get-ChildItem $backupDir -Filter "cloud-dev-*.db.gz" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1).LastWriteTime
if ($after -and $after -ne $before) {
    Write-Host "Cloud backup downloaded OK ($after)."
} else {
    Write-Host "No new cloud backup yet - check the log below."
}
Write-Host "`n=== backup-log.txt tail ==="
Get-Content (Join-Path $backupDir "backup-log.txt") -Tail 3 -ErrorAction SilentlyContinue

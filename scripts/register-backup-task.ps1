# Registers "Operations DB Backup" correctly - wake-from-sleep, runs whether
# logged on or not, survives being on battery. Decision D1 (Brief 09, item 1).
#
# Run this ONCE from an elevated PowerShell (right-click PowerShell -> Run as
# Administrator), then paste:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\ilies\Documents\operations\scripts\register-backup-task.ps1"

$ErrorActionPreference = "Stop"
$taskName = "Operations DB Backup"
$scriptPath = "C:\Users\ilies\Documents\operations\scripts\backup-db.ps1"
$backupDir = "C:\Users\ilies\OneDrive\Operations-Backups"

if (-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Not running elevated. Right-click PowerShell -> Run as Administrator, then run this script again."
    exit 1
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
    -Description "Nightly backup of Operations' SQLite database to OneDrive (VACUUM INTO + integrity check, 30-day retention). Runs independent of any logon session, wakes the PC if asleep, retries 3x 10 minutes apart on failure. See scripts/backup-db.ps1 / backup-db.ts." `
    | Out-Null

Write-Host "Registered. Triggering it now to confirm it actually works end-to-end..."
$before = Get-ChildItem $backupDir -Filter "dev-*.db" -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 20

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "`nLast Run Time:   $($info.LastRunTime)"
Write-Host "Last Task Result: $($info.LastTaskResult)  (0 = success)"

$after = Get-ChildItem $backupDir -Filter "dev-*.db" -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count
if ($after -gt $before) {
    Write-Host "New backup file appeared ($before -> $after)."
} else {
    Write-Host "No new backup file yet - it may still be running (tsx/npm startup can take a few seconds); check again shortly."
}
Write-Host "`n=== backup-log.txt tail ==="
Get-Content (Join-Path $backupDir "backup-log.txt") -Tail 3 -ErrorAction SilentlyContinue

# One elevated pass covering Brief 09's remaining admin-only steps:
#   1. Register the "Operate DB Backup" task correctly (D1) and self-test it.
#   2. Stop OperateServer so the Next.js patch upgrade (D2) can be built
#      (the running service locks the Prisma engine file otherwise).
# After this, Claude will build and ask you to run Start-Service OperateServer
# in this same window to finish the deploy.

$ErrorActionPreference = "Stop"
if (-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Not running elevated. Right-click PowerShell -> Run as Administrator, then run this script again."
    exit 1
}

Write-Host "=== Step 1: registering the backup task ==="
& "C:\Users\ilies\Documents\job-board\scripts\register-backup-task.ps1"

Write-Host "`n=== Step 2: stopping OperateServer for the build ==="
Stop-Service OperateServer
Get-Service OperateServer | Select-Object Name, Status

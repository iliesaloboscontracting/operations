# Nightly backup of the live Operate database to OneDrive.
# Run by the "Operate DB Backup" Windows Scheduled Task (see scripts/register-backup-task.ps1).
# Copies prisma/dev.db (and any -wal/-shm sidecar files, in case WAL mode is
# ever turned on) to a timestamped file in OneDrive, then prunes backups
# older than 30 days so the folder doesn't grow unbounded.

$ErrorActionPreference = "Stop"

$sourceDir = "C:\Users\ilies\Documents\job-board\prisma"
$backupDir = "C:\Users\ilies\OneDrive\Operate-Backups"
$retentionDays = 30

if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$destPath = Join-Path $backupDir "dev-$stamp.db"

Copy-Item -Path (Join-Path $sourceDir "dev.db") -Destination $destPath -Force

foreach ($sidecar in @("dev.db-wal", "dev.db-shm")) {
    $sidecarPath = Join-Path $sourceDir $sidecar
    if (Test-Path $sidecarPath) {
        Copy-Item -Path $sidecarPath -Destination (Join-Path $backupDir "$sidecar-$stamp") -Force
    }
}

$cutoff = (Get-Date).AddDays(-$retentionDays)
Get-ChildItem -Path $backupDir -Filter "dev-*.db" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force

Write-Output "Backed up dev.db to $destPath"

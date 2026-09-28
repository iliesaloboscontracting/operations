# Nightly backup of the live Operate database to OneDrive.
# Run by the "Operate DB Backup" Windows Scheduled Task (see
# scripts/register-backup-task.ps1). Thin wrapper: sets up the environment,
# then hands off to scripts/backup-db.ts for the actual VACUUM INTO backup,
# integrity check and 30-day prune (see that file for why - a plain file
# copy of a live SQLite database risks a torn/corrupt backup).

$ErrorActionPreference = "Stop"
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$env:DATABASE_URL = "file:C:/Users/ilies/Documents/job-board/prisma/dev.db"
Set-Location "C:\Users\ilies\Documents\job-board"

npx tsx scripts\backup-db.ts
exit $LASTEXITCODE

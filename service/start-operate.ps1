# Starts Operate in production mode. Used by the "Operate Server" Windows
# Scheduled Task so the app survives reboots, logons and (unlike `npm run dev`)
# doesn't depend on any Claude Code session staying open - killing that session
# no longer takes the site down with it.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location "C:\Users\ilies\Documents\job-board"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
npm start

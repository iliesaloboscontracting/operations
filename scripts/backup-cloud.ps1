# Nightly off-AWS copy of the live Operations data (21 Oct 2026, Ilies).
# Since 20 Oct production runs on the cloud server; it backs itself up at
# 1:30am (SQLite .backup + integrity check, plus a tool-photos tar) into
# /srv/operations/backups. This downloads the newest of each into OneDrive so
# a current copy exists outside AWS, checks the database is complete and
# readable before keeping it, and keeps 30 days. Replaces backup-db.ps1, which
# copied the laptop's database - frozen since the move, so its "new" backups
# were stale copies.
#
# Run by the "Operations DB Backup" Windows Scheduled Task as SYSTEM (see
# scripts/register-backup-task.ps1), so it uses this PC's SSH key and
# known_hosts explicitly rather than SYSTEM's own profile.

$ErrorActionPreference = "Stop"
$backupDir = "C:\Users\ilies\OneDrive\Operations-Backups"
$log = Join-Path $backupDir "backup-log.txt"
# As SYSTEM (the scheduled task) use the copy of the key that
# register-backup-task.ps1 puts where only SYSTEM and Administrators can read
# it - OpenSSH won't use a key owned by another user.
$sshDir = if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { "C:\ProgramData\OperationsBackup" } else { "C:\Users\ilies\.ssh" }
$server = "ubuntu@52.64.25.179"
$sshOpts = @("-i", "$sshDir\lobos_ops_lightsail", "-o", "BatchMode=yes", "-o", "UserKnownHostsFile=$sshDir\known_hosts", "-o", "ConnectTimeout=30")
$keepDays = 30

function Write-Log($msg) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), $msg) }

# A downloaded .db.gz is kept only if it unzips to a whole SQLite database.
function Test-DbGz($path) {
  $in = [IO.File]::OpenRead($path)
  try {
    $gz = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $buf = New-Object byte[] 65536
    $total = 0; $head = $null
    while (($n = $gz.Read($buf, 0, $buf.Length)) -gt 0) {
      if (-not $head) { $head = [Text.Encoding]::ASCII.GetString($buf, 0, [Math]::Min(15, $n)) }
      $total += $n
    }
    return ($head -eq "SQLite format 3") -and ($total -gt 100000)
  } catch { return $false } finally { $in.Dispose() }
}

try {
  # Newest database and photos backups on the server (root-owned, so copy to
  # /tmp readable, download, then remove the temporary copies).
  $list = & ssh @sshOpts $server "sudo ls -t /srv/operations/backups"
  if ($LASTEXITCODE -ne 0 -or -not $list) { throw "couldn't list the server's backups (ssh exit $LASTEXITCODE)" }
  $db = @($list | Where-Object { $_ -like "dev-*.db.gz" })[0]
  $photos = @($list | Where-Object { $_ -like "tool-photos-*.tar.gz" })[0]
  if (-not $db -or -not $photos) { throw "no backup files found on the server" }
  & ssh @sshOpts $server "sudo cp /srv/operations/backups/$db /srv/operations/backups/$photos /tmp/ && sudo chmod 644 /tmp/$db /tmp/$photos"
  if ($LASTEXITCODE -ne 0) { throw "couldn't stage $db on the server" }
  try {
    foreach ($f in @($db, $photos)) {
      $dest = Join-Path $backupDir ("cloud-" + $f)
      $part = "$dest.part"
      & scp @sshOpts -q "${server}:/tmp/$f" $part
      if ($LASTEXITCODE -ne 0) { throw "download of $f failed (scp exit $LASTEXITCODE)" }
      if ($f -eq $db -and -not (Test-DbGz $part)) { Remove-Item $part -Force; throw "$f is not a complete database - kept the previous backups" }
      Move-Item $part $dest -Force
      Write-Log ("OK {0} size={1}" -f $dest, (Get-Item $dest).Length)
    }
  } finally {
    & ssh @sshOpts $server "sudo rm -f /tmp/$db /tmp/$photos" | Out-Null
  }

  # Keep 30 days of these cloud copies (only this script's own files).
  Get-ChildItem $backupDir -Filter "cloud-*" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } | Remove-Item -Force
  exit 0
} catch {
  Write-Log ("FAILED cloud backup: {0}" -f $_.Exception.Message)
  exit 1
}

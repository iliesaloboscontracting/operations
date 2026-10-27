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
#
# 24 Oct 2026: the laptop is in standby at 2am most nights, so the task mostly
# runs as a catch-up the moment it wakes - before Wi-Fi is back (23 Oct failed
# that way; Windows' task retry only covers a task that fails to START). So:
# the task now also tries every 2 hours, this script does nothing when today's
# copy is already here, and it waits for the server to be reachable (up to
# ~15 min) instead of giving up on the first timeout.
# -BackupDir is for testing into another folder.

param([string]$BackupDir = "C:\Users\ilies\OneDrive\Operations-Backups")

$ErrorActionPreference = "Stop"
$backupDir = $BackupDir
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
  # Already have ALL of today's copy (the server's 1:30am backup, named by its Sydney date): nothing to do. Keeps the
  # every-2-hours runs free. 28 Oct 2026: this used to look at the database file only, so a run cut off part-way
  # (the laptop went back to sleep after the database and photos) never fetched the rest that day. A run now leaves
  # a "cloud-done-<db name>.txt" marker only once every file is in.
  if (Get-ChildItem $backupDir -Filter ("cloud-done-dev-{0}-*.txt" -f (Get-Date -Format "yyyyMMdd")) -ErrorAction SilentlyContinue) { exit 0 }

  # Newest database and photos backups on the server (root-owned). SEC-010 (27 Oct 2026): each file is streamed with
  # "sudo cat" straight into the local .part file - never staged world-readable in /tmp. ssh's own
  # error text is kept for the log if it fails. A connection failure (ssh
  # exit 255 - often Wi-Fi still reconnecting after sleep) is retried every
  # minute, 15 tries.
  for ($try = 1; $try -le 15; $try++) {
    $tries = $try
    $ErrorActionPreference = "Continue"
    $out = & ssh @sshOpts $server "sudo ls -t /srv/operations/backups" 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 255) { break }
    if ($try -lt 15) { Start-Sleep -Seconds 60 }
  }
  $list = @($out | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
  if ($code -ne 0 -or -not $list) {
    $why = ($out | ForEach-Object { "$_" }) -join " / "
    throw "couldn't list the server's backups after $tries tries (ssh exit $code as $([Security.Principal.WindowsIdentity]::GetCurrent().Name), key dir $sshDir): $why"
  }
  $db = @($list | Where-Object { $_ -like "dev-*.db.gz" })[0]
  $photos = @($list | Where-Object { $_ -like "tool-photos-*.tar.gz" })[0]
  if (-not $db -or -not $photos) { throw "no backup files found on the server" }
  # Uploaded supplier invoices (invoices inbox, 24 Oct 2026) - on the server's
  # backup from that day on, so optional here.
  $invoices = @($list | Where-Object { $_ -like "invoice-files-*.tar.gz" })[0]
  # Lobos Estimating's data (moved to the server 25 Oct 2026) - optional too.
  $estimating = @($list | Where-Object { $_ -like "estimating-*.tar.gz" })[0]
  # Receipt and odometer photos (Receipts, 26 Oct 2026) - optional too.
  $receipts = @($list | Where-Object { $_ -like "receipt-files-*.tar.gz" })[0]
  # Ticket / licence and company document files (Accounts compliance, 27 Oct 2026) - optional too.
  $compliance = @($list | Where-Object { $_ -like "compliance-files-*.tar.gz" })[0]
  $files = @($db, $photos) + @($invoices, $estimating, $receipts, $compliance | Where-Object { $_ })
  # The names come from the server's own listing; anything but a plain file name never reaches a remote command.
  foreach ($f in $files) { if ($f -notmatch '^[A-Za-z0-9._-]+$') { throw "unexpected backup file name on the server: $f" } }
  # Newest set already fully downloaded (e.g. before 1:30am, today's isn't made yet).
  $done = Join-Path $backupDir ("cloud-done-" + ($db -replace '\.db\.gz$', '.txt'))
  if (Test-Path $done) { exit 0 }
  foreach ($f in $files) {
      $dest = Join-Path $backupDir ("cloud-" + $f)
      $part = "$dest.part"
      $errFile = "$part.err"
      # Already in from an earlier, cut-off run: keep it, fetch only what's missing. A half-written .part is dropped.
      if (Test-Path $dest) { continue }
      Remove-Item $part, $errFile -Force -ErrorAction SilentlyContinue
      # Start-Process hands ssh a real file handle for stdout, so the bytes land unchanged (PowerShell's own > would
      # re-encode them as text and corrupt the archive).
      $sshArgs = @($sshOpts | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) + @($server, "`"sudo cat /srv/operations/backups/$f`"")
      $p = Start-Process -FilePath "ssh" -ArgumentList $sshArgs -RedirectStandardOutput $part -RedirectStandardError $errFile -NoNewWindow -PassThru
      $null = $p.Handle # keep the process handle, or ExitCode comes back empty without -Wait
      # A stalled transfer (e.g. the laptop slept mid-download) must not hang the run forever: give up after 20 min.
      if (-not $p.WaitForExit(20 * 60 * 1000)) {
        $p.Kill(); $p.WaitForExit()
        Remove-Item $part, $errFile -Force -ErrorAction SilentlyContinue
        throw "download of $f stalled - stopped after 20 minutes"
      }
      $why = if (Test-Path $errFile) { (Get-Content $errFile -Raw) } else { "" }
      Remove-Item $errFile -Force -ErrorAction SilentlyContinue
      if ($p.ExitCode -ne 0) { Remove-Item $part -Force -ErrorAction SilentlyContinue; throw "download of $f failed (ssh exit $($p.ExitCode)): $why" }
      if ($f -eq $db -and -not (Test-DbGz $part)) { Remove-Item $part -Force; throw "$f is not a complete database - kept the previous backups" }
      # An empty file is a failed backup on the server (27 Oct 2026: the estimating step failed and left 0 bytes,
      # which used to be logged as OK). Never keep it; say so in the log.
      if ((Get-Item $part).Length -eq 0) { Remove-Item $part -Force; Write-Log ("FAILED {0} is empty on the server - not kept" -f $f); continue }
      Move-Item $part $dest -Force
      Write-Log ("OK {0} size={1}" -f $dest, (Get-Item $dest).Length)
  }
  Set-Content -Path $done -Value ("complete " + (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))

  # Keep 30 days of these cloud copies (only this script's own files).
  Get-ChildItem $backupDir -Filter "cloud-*" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } | Remove-Item -Force
  exit 0
} catch {
  Write-Log ("FAILED cloud backup: {0}" -f $_.Exception.Message)
  exit 1
}

# Nightly Skool archive refresh.
#
# Runs `skool all`, which lists every community the saved login belongs to
# and archives each one — no static community list to maintain; joining a
# new community on Skool is enough for it to appear in the next night's
# archive. Output goes to a dated log under scripts\logs\, and the task
# records failure when the CLI exits non-zero (login expired, any community
# or course failed).
#
# Registered in Task Scheduler as "SkoolArchiveNightly" (daily 3:00 AM).

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("nightly-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log([string]$message) {
    "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $message | Tee-Object -FilePath $log -Append
}

# Prefer the mapped drive; fall back to the UNC target so the script also
# works in task sessions that don't carry per-user drive mappings.
$outputRoot = 'Z:\skool_downloads'
if (-not (Test-Path $outputRoot)) { $outputRoot = '\\192.168.50.148\media1\skool_downloads' }
if (-not (Test-Path $outputRoot)) {
    Write-Log 'ERROR: archive target unreachable (Z: not mapped and UNC path unavailable).'
    exit 1
}

# The CLI anchors its own state (.auth, bin/yt-dlp) to the checkout, but run
# from the repo anyway so anything cwd-relative behaves like a manual run.
Set-Location $repo

Write-Log "Starting nightly archive (all account communities) -> $outputRoot"
& node (Join-Path $repo 'bin\skool.js') all -o $outputRoot *>> $log
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Write-Log "FAILED (exit $exitCode) — see log above."
}

# Keep two weeks of logs.
Get-ChildItem $logDir -Filter 'nightly-*.log' |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) |
    Remove-Item -Force -Confirm:$false

Write-Log "Done (exit $exitCode)."
exit $exitCode

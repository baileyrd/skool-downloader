# Nightly Skool archive refresh.
#
# Runs the downloader for every community listed in communities.txt (one
# classroom URL per line, # for comments), appending all output to a dated
# log under scripts\logs\. Continues past per-community failures and exits
# non-zero if any community failed, so Task Scheduler records the result.
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

$communitiesFile = Join-Path $PSScriptRoot 'communities.txt'
if (-not (Test-Path $communitiesFile)) {
    Write-Log "ERROR: $communitiesFile not found."
    exit 1
}
$urls = Get-Content $communitiesFile | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }

# The CLI anchors its own state (.auth, bin/yt-dlp) to the checkout, but run
# from the repo anyway so anything cwd-relative (default downloads/) behaves
# the same as a manual run.
Set-Location $repo

Write-Log "Starting nightly archive: $($urls.Count) communities -> $outputRoot"
$failed = 0
foreach ($url in $urls) {
    Write-Log "=== $url ==="
    & node (Join-Path $repo 'bin\skool.js') $url -o $outputRoot *>> $log
    if ($LASTEXITCODE -ne 0) {
        $failed += 1
        Write-Log "FAILED (exit $LASTEXITCODE): $url"
    }
}

# Keep two weeks of logs.
Get-ChildItem $logDir -Filter 'nightly-*.log' |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) |
    Remove-Item -Force -Confirm:$false

Write-Log "Done. $failed of $($urls.Count) communities failed."
exit ($failed -gt 0 ? 1 : 0)

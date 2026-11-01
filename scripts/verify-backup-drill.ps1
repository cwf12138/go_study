param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reportDirectory = Join-Path $projectRoot '.local/checks'
$reportPath = Join-Path $reportDirectory 'backup-drill-report.json'
[IO.Directory]::CreateDirectory($reportDirectory) | Out-Null
$encoding = New-Object System.Text.UTF8Encoding($false)
function Write-DrillReport($value) {
    [IO.File]::WriteAllText($reportPath, (($value | ConvertTo-Json -Depth 12) + [Environment]::NewLine), $encoding)
}
$runId = [Guid]::NewGuid().ToString('N')
Write-DrillReport @{ schema_version = 1; run_id = $runId; status = 'running'; fixtures_only = $true; production_changed = $false; checked_at = [DateTime]::UtcNow.ToString('o') }
$previousCache = $env:GOCACHE
$success = $false
Push-Location $projectRoot
try {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw 'Go was not found. Install Go 1.22+ before running this drill.' }
    if (-not $env:GOCACHE) { $env:GOCACHE = Join-Path $projectRoot '.studyflow-gocache' }
    # Only the named test runs. It creates its own temporary accounts/directories
    # and starts an isolated loopback HTTP server; it never loads project data/.
    $events = @(& go test -json ./internal/backup -run '^TestRestoreHTTPDrill$' -count=1)
    if ($LASTEXITCODE -ne 0) { throw 'The fixture recovery drill failed; no production data was restored.' }
    $report = $null
    $passed = $false
    foreach ($line in $events) {
        try { $item = $line | ConvertFrom-Json } catch { continue }
        if ($item.Action -eq 'pass' -and $item.Test -eq 'TestRestoreHTTPDrill') { $passed = $true }
        if ($item.Output -match 'D04_FIXTURE_DRILL (\{.*\})') { $report = $Matches[1] | ConvertFrom-Json }
    }
    if (-not $passed -or -not $report -or -not $report.fixtures_only -or $report.production_changed) { throw 'The fixture report was missing or invalid.' }
    $report | Add-Member -NotePropertyName status -NotePropertyValue 'passed'
    $report | Add-Member -NotePropertyName run_id -NotePropertyValue $runId
    Write-DrillReport $report
    $success = $true
    Write-Host 'PASS: isolated backup, verification, restore, two-account HTTP login, references, attachment downloads and restart after save.'
    Write-Host 'Report: .local/checks/backup-drill-report.json (fixtures only; no production restore or Android verification).'
} finally {
    if (-not $success) {
        Write-DrillReport @{ schema_version = 1; run_id = $runId; status = 'failed'; fixtures_only = $true; production_changed = $false; checked_at = [DateTime]::UtcNow.ToString('o'); code = 'fixture_drill_not_completed' }
    }
    $env:GOCACHE = $previousCache
    Pop-Location
}

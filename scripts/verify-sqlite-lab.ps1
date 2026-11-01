param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reportDirectory = Join-Path $projectRoot '.local/checks'
$reportPath = Join-Path $reportDirectory 'sqlite-lab-report.json'
[IO.Directory]::CreateDirectory($reportDirectory) | Out-Null
$encoding = New-Object System.Text.UTF8Encoding($false)
function Write-LabReport($value) {
    [IO.File]::WriteAllText($reportPath, (($value | ConvertTo-Json -Depth 14) + [Environment]::NewLine), $encoding)
}
$runId = [Guid]::NewGuid().ToString('N')
$previousCache = $env:GOCACHE
$previousModules = $env:GOMODCACHE
$previousCGO = $env:CGO_ENABLED
$previousToolchain = $env:GOTOOLCHAIN
$success = $false
Write-LabReport @{ schema_version = 1; run_id = $runId; status = 'running'; fixtures_only = $true; production_changed = $false; all_modules_migrated = $false }
Push-Location (Join-Path $projectRoot 'experiments/sqlite')
try {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw 'Go 1.25+ is required for the isolated SQLite lab.' }
    $goVersion = (& go env GOVERSION) -join ''
    if ($LASTEXITCODE -ne 0 -or $goVersion -notmatch '^go1\.(\d+)' -or [int]$Matches[1] -lt 25) { throw 'Select Go 1.25+ for the lab. The main application requirement is unchanged.' }
    if (-not $env:GOCACHE) { $env:GOCACHE = Join-Path $projectRoot '.studyflow-gocache' }
    if (-not $env:GOMODCACHE) { $env:GOMODCACHE = Join-Path $projectRoot '.local/sqlite-modcache' }
    if (-not $env:GOTOOLCHAIN) { $env:GOTOOLCHAIN = 'local' }
    $env:CGO_ENABLED = '0'
    & go vet ./...
    if ($LASTEXITCODE -ne 0) { throw 'SQLite lab static checks failed.' }
    $events = @(& go test -json ./... -count=1)
    if ($LASTEXITCODE -ne 0) { throw 'SQLite lab tests failed; no production data was migrated.' }
    $report = $null
    $passed = $false
    foreach ($line in $events) {
        try { $item = $line | ConvertFrom-Json } catch { continue }
        if ($item.Action -eq 'pass' -and $item.Test -eq 'TestSQLiteDrill') { $passed = $true }
        if ($item.Output -match 'D05_SQLITE_DRILL (\{.*\})') { $report = $Matches[1] | ConvertFrom-Json }
    }
    if (-not $passed -or -not $report -or -not $report.fixtures_only -or $report.production_changed -or $report.all_modules_migrated) { throw 'SQLite fixture report missing or invalid.' }
    $report | Add-Member -NotePropertyName status -NotePropertyValue 'passed'
    $report | Add-Member -NotePropertyName run_id -NotePropertyValue $runId
    $report | Add-Member -NotePropertyName cgo_enabled -NotePropertyValue $false
    $report | Add-Member -NotePropertyName go_version -NotePropertyValue $goVersion
    Write-LabReport $report
    $success = $true
    Write-Host 'PASS: isolated SQLite conversion, selected repository contract, atomic rollback, idempotency, version conflict, live backup and process-kill recovery.'
    Write-Host 'Report: .local/checks/sqlite-lab-report.json (fixtures only; main API remains on JSON).'
} finally {
    if (-not $success) {
        Write-LabReport @{ schema_version = 1; run_id = $runId; status = 'failed'; fixtures_only = $true; production_changed = $false; all_modules_migrated = $false; code = 'sqlite_lab_not_completed' }
    }
    $env:GOCACHE = $previousCache
    $env:GOMODCACHE = $previousModules
    $env:CGO_ENABLED = $previousCGO
    $env:GOTOOLCHAIN = $previousToolchain
    Pop-Location
}

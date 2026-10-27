param([string]$HTTPAddr = '')
$ErrorActionPreference = 'Stop'
$mobileProject = Split-Path -Parent $PSScriptRoot
$previousSecret = $env:JWT_SECRET
$previousAddress = $env:HTTP_ADDR
try {
    if ([string]::IsNullOrWhiteSpace($env:JWT_SECRET) -or $env:JWT_SECRET -eq 'development-secret-change-me-please') {
        $mobileConfig = Join-Path $mobileProject '.local'
        $mobileKey = Join-Path $mobileConfig 'android-jwt.key'
        if (-not (Test-Path -LiteralPath $mobileKey)) {
            New-Item -ItemType Directory -Force -Path $mobileConfig | Out-Null
            $mobileBytes = New-Object byte[] 32
            $mobileRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $mobileRandom.GetBytes($mobileBytes) } finally { $mobileRandom.Dispose() }
            [IO.File]::WriteAllText($mobileKey, [Convert]::ToBase64String($mobileBytes), (New-Object Text.UTF8Encoding($false)))
            Write-Output 'Created a local signing key in .local/android-jwt.key (not uploaded or included in APK).'
        }
        $env:JWT_SECRET = [IO.File]::ReadAllText($mobileKey).Trim()
    }
    if ($env:JWT_SECRET.Length -lt 24) { throw 'JWT_SECRET must contain at least 24 characters.' }
    if ($HTTPAddr) { $env:HTTP_ADDR = $HTTPAddr }
    Write-Output 'Start the Android app on the same trusted LAN. Keep this server running.'
    Write-Output 'Stop any existing Go server on this port first. This script does not edit firewall rules.'
    Push-Location $mobileProject
    try { & go run ./cmd/api; $mobileExit = $LASTEXITCODE } finally { Pop-Location }
} finally {
    $env:JWT_SECRET = $previousSecret
    $env:HTTP_ADDR = $previousAddress
}
exit $mobileExit

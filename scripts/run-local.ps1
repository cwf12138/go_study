param(
    [switch]$UseSystemProxy,
    [string]$Proxy = "",
    [switch]$UseBigModel,
    [switch]$UpdateBigModelKey
)

$ErrorActionPreference = "Stop"
if ($UseSystemProxy -and $Proxy) { throw "Choose either -UseSystemProxy or -Proxy, not both." }
. (Join-Path $PSScriptRoot 'bigmodel-key.ps1')
$savedBigModelKey = Test-Path -LiteralPath (Get-DaynestBigModelKeyPath) -PathType Leaf

# Process-only network settings. No registry changes, no saved credentials.
if ($UseSystemProxy) {
    $authEndpoint = if ($UseBigModel -or $UpdateBigModelKey -or $env:BIGMODEL_API_KEY -or $savedBigModelKey) {
        [uri]"https://open.bigmodel.cn/api/paas/v4/chat/completions"
    } else {
        [uri]"https://auth.openai.com/.well-known/openid-configuration"
    }
    $systemProxy = [System.Net.WebRequest]::DefaultWebProxy.GetProxy($authEndpoint)
    if (-not $systemProxy -or $systemProxy.AbsoluteUri -eq $authEndpoint.AbsoluteUri) {
        throw "No existing system proxy found. Configure an authorized network connection or pass -Proxy explicitly."
    }
    # Do not silently copy proxy passwords or use PAC scripts as proxy addresses.
    if ($systemProxy.UserInfo -or $systemProxy.Scheme -notin @("http", "https")) {
        throw "This system proxy configuration is not supported by this launcher."
    }
    $Proxy = [System.UriBuilder]::new($systemProxy.Scheme, $systemProxy.Host, $systemProxy.Port).Uri.AbsoluteUri
}
if ($Proxy) {
    $proxyUri = $null
    if (-not [uri]::TryCreate($Proxy, [UriKind]::Absolute, [ref]$proxyUri) -or $proxyUri.Scheme -notin @("http", "https", "socks5", "socks5h") -or -not $proxyUri.Host -or $proxyUri.UserInfo -or $proxyUri.Query -or $proxyUri.Fragment -or $proxyUri.AbsolutePath -ne "/") {
        throw "Proxy must be a valid proxy URL without credentials, query, fragment or path."
    }
    $env:HTTPS_PROXY = $proxyUri.AbsoluteUri
    if (-not $env:NO_PROXY) { $env:NO_PROXY = "localhost,127.0.0.1,::1" }
    Write-Host "Using the selected proxy for HTTPS requests in this terminal. Proxy credentials are not saved."
} else {
    Write-Host "Using existing environment networking settings; Windows system proxy is not auto-imported."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$previousBigModelKey = $env:BIGMODEL_API_KEY
Push-Location -LiteralPath $projectRoot
try {
    $secret = $null
    try {
        if ($UpdateBigModelKey -or ($UseBigModel -and -not $previousBigModelKey -and -not $savedBigModelKey)) {
            $secret = Read-Host 'Enter your BigModel API key' -AsSecureString
            Save-DaynestBigModelKey -Key $secret
            Write-Host 'Saved the BigModel key for this Windows user.'
        } elseif (-not $previousBigModelKey -and $savedBigModelKey) {
            $secret = Get-DaynestBigModelKey
        }
        if ($secret) {
            $env:BIGMODEL_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
        }
    } finally {
        if ($secret) { $secret.Dispose() }
    }
    if ($env:BIGMODEL_API_KEY) {
        Write-Host "Starting Daynest with BigModel for local meal recommendations."
    } else {
        Write-Host "Starting Daynest."
    }
    & go run ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw "Go service exited with code $LASTEXITCODE" }
} finally {
    $env:BIGMODEL_API_KEY = $previousBigModelKey
    Pop-Location
}

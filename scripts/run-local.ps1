param(
    [switch]$UseSystemProxy,
    [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
if ($UseSystemProxy -and $Proxy) { throw "Choose either -UseSystemProxy or -Proxy, not both." }

# Process-only network settings. No registry changes, no saved credentials.
if ($UseSystemProxy) {
    $authEndpoint = [uri]"https://auth.openai.com/.well-known/openid-configuration"
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
Push-Location -LiteralPath $projectRoot
try {
    Write-Host "Starting Daynest. For a new authorization attempt, use Continue with ChatGPT in the app."
    & go run ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw "Go service exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}

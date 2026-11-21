function Get-DaynestBigModelKeyPath {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'Windows LOCALAPPDATA is unavailable.'
    }
    Join-Path $env:LOCALAPPDATA 'Daynest/bigmodel-key.dpapi'
}

function Get-DaynestBigModelKey {
    $path = Get-DaynestBigModelKeyPath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            $encrypted = [IO.File]::ReadAllText($path)
            ConvertTo-SecureString -String $encrypted -ErrorAction Stop
        } catch {
            throw 'Daynest could not read the saved BigModel key. Run the launcher with -UpdateBigModelKey to replace it.'
        }
    }
}

function Save-DaynestBigModelKey {
    param([Parameter(Mandatory)][Security.SecureString]$Key)

    $value = [Net.NetworkCredential]::new('', $Key).Password
    if ($value -notmatch '^\S+$') {
        throw 'Enter the complete BigModel API key without spaces or line breaks.'
    }
    $path = Get-DaynestBigModelKeyPath
    $directory = Split-Path -Parent $path
    [void][IO.Directory]::CreateDirectory($directory)
    $temporary = Join-Path $directory ([Guid]::NewGuid().ToString('N') + '.dpapi.tmp')
    try {
        # With no explicit encryption key, Windows PowerShell uses the current user's DPAPI.
        [IO.File]::WriteAllText($temporary, (ConvertFrom-SecureString -SecureString $Key -ErrorAction Stop))
        if ([IO.File]::Exists($path)) {
            [IO.File]::Replace($temporary, $path, [NullString]::Value)
        } else {
            [IO.File]::Move($temporary, $path)
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

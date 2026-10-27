param([Parameter(Mandatory=$true)][string]$AndroidJar)
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $AndroidJar)) { throw 'AndroidJar must point to an installed platforms/android-XX/android.jar' }
$output = Join-Path $mobileRoot '.java-check'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$sources = @(Get-ChildItem -LiteralPath (Join-Path $mobileRoot 'tests/java-stubs') -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
$sources += @(Join-Path $mobileRoot 'native/DaynestFilesPlugin.java'; Join-Path $mobileRoot 'native/MainActivity.java'; Join-Path $mobileRoot 'tests/NativePolicyCheck.java')
& javac -encoding UTF-8 -cp $AndroidJar -d $output $sources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& java -cp ($output + [IO.Path]::PathSeparator + $AndroidJar) app.daynest.personal.NativePolicyCheck
exit $LASTEXITCODE

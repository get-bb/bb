#requires -Version 7.0
param(
    [ValidatePattern('^[a-zA-Z0-9_.-]+$')][string]$Remote = 'origin',
    [ValidatePattern('^[a-zA-Z0-9_./-]+$')][string]$Branch = 'main',
    [string]$DataDir = $(if ($env:BB_WINDOWS_DATA_DIR) { $env:BB_WINDOWS_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'BBWindows' })
)
$ErrorActionPreference = 'Stop'
$checkout = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $checkout
try {
    $dirty = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Update requires a clean Git checkout.' }
    & git fetch $Remote $Branch
    if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; the running installation was not changed.' }
    & git merge-base --is-ancestor HEAD FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'The update is not a fast-forward; integrate it in a separate branch.' }
    & (Join-Path $PSScriptRoot 'bb.ps1') -Action Stop -DataDir $DataDir
    if ($LASTEXITCODE -ne 0) { throw 'Stop failed.' }
    & git merge --ff-only FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Update failed.' }
    & (Join-Path $PSScriptRoot 'install.ps1') -DataDir $DataDir
    if ($LASTEXITCODE -ne 0) { throw 'Preparation failed; BB remains stopped.' }
    Write-Output 'Updated. Start with the same DataDir, ports, LAN and EnvFile arguments as before.'
} finally { Pop-Location }

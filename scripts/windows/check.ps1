#requires -Version 7.0
param([switch]$Providers)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Native Windows is required.' }
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'This distribution currently targets Windows x64.' }
foreach ($name in @('node.exe', 'git.exe', 'pnpm.cmd', 'pwsh.exe')) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Missing dependency: $name" }
}
$nodeVersion = [version]((& node.exe --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.19.0') { throw 'Node.js 22.19.0 or newer is required.' }
$pnpmVersion = (& pnpm.cmd --version).Trim()
if ($pnpmVersion -ne '9.15.0') { throw "Expected pnpm 9.15.0, found $pnpmVersion. Install the version pinned in package.json." }
# bb-fork(windows): Node cannot resolve a package's "#imports" when its
# package.json path reaches 260 characters, so vitest, vite build, and the
# supervisor build fail in a deep checkout. .npmrc caps pnpm's virtual-store
# directory names at 50, which leaves 260 - 20 (\node_modules\.pnpm\) - 50 -
# 32 (longest package tail) = 158 characters for the checkout path.
$checkoutPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if ($checkoutPath.Length -ge 158) {
    Write-Warning "Checkout path is $($checkoutPath.Length) characters: $checkoutPath"
    Write-Warning "Node cannot resolve '#imports' at 260+ characters, so vitest and vite builds can fail here. Move the checkout to a shorter path and keep BB_DATA_DIR short; see docs/windows.md."
}
if ($Providers) {
    foreach ($name in @('codex', 'claude')) {
        $available = $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
        [pscustomobject]@{ ProviderCommand = $name; OnPath = $available }
    }
}
Write-Output "Dependencies OK: Node $nodeVersion, pnpm $pnpmVersion, PowerShell $($PSVersionTable.PSVersion)"

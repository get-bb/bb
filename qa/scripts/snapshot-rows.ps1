<#
.SYNOPSIS
  Windows twin of scripts/provider-corpus/snapshot-rows.sh: provider-corpus row-snapshot gates.
.DESCRIPTION
  Same interface as the original: compare (default, fails on any diff not in
  the allowlist) or write (mints a new baseline). Requires
  BB_PROVIDER_CORPUS_DIR pointing at a corpus directory with manifest.json
  (defaults to $HOME\.bb\provider-corpus when that manifest exists). Honors
  BB_PROVIDER_CORPUS_ALLOWLIST, BB_PROVIDER_CORPUS_SNAPSHOT_DIR and
  BB_PROVIDER_CORPUS_ROW_CLASSES exactly like the .sh, sets
  BB_PROVIDER_CORPUS_SNAPSHOT to the mode, runs
  turbo run test:provider-corpus --filter=@bb/server from the repo root, then
  prints snapshots/rows-last-run.json and snapshots/perf-last-run.md.
  set -euo pipefail becomes $ErrorActionPreference = 'Stop' plus an explicit
  $LASTEXITCODE check after every native command.
  Reviewed line by line against scripts/provider-corpus/snapshot-rows.sh.
  NOT executed: there is no PowerShell on the Linux machine where this was written.
.EXAMPLE
  qa\scripts\snapshot-rows.ps1 compare
.EXAMPLE
  $env:BB_PROVIDER_CORPUS_ALLOWLIST = 'apps\server\test\provider-corpus\allowlists\<ws>.json'
  qa\scripts\snapshot-rows.ps1 compare
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('write', 'compare')]
    [string]$Mode = 'compare'
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$CorpusDir = $env:BB_PROVIDER_CORPUS_DIR
if ([string]::IsNullOrEmpty($CorpusDir)) {
    $DefaultCorpus = Join-Path $HOME '.bb\provider-corpus'
    if (Test-Path (Join-Path $DefaultCorpus 'manifest.json')) {
        $CorpusDir = $DefaultCorpus
    }
}
if ([string]::IsNullOrEmpty($CorpusDir) -or -not (Test-Path (Join-Path $CorpusDir 'manifest.json'))) {
    Write-Error 'BB_PROVIDER_CORPUS_DIR must point at a corpus directory with manifest.json'
    exit 2
}
$env:BB_PROVIDER_CORPUS_DIR = $CorpusDir
$env:BB_PROVIDER_CORPUS_SNAPSHOT = $Mode

$PnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $PnpmCommand) {
    $PnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
}
if (-not $PnpmCommand) {
    Write-Error 'pnpm is not available on PATH'
    exit 1
}

Push-Location $RepoRoot
try {
    & $PnpmCommand.Source exec turbo run test:provider-corpus --filter=@bb/server
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

$SnapshotsDir = Join-Path $CorpusDir 'snapshots'
$RowsLastRun = Join-Path $SnapshotsDir 'rows-last-run.json'
if (Test-Path $RowsLastRun) {
    Write-Host ''
    Write-Host "Row snapshots: $RowsLastRun"
    Get-Content $RowsLastRun
}
$PerfLastRun = Join-Path $SnapshotsDir 'perf-last-run.md'
if (Test-Path $PerfLastRun) {
    Write-Host ''
    Write-Host "Timeline perf: $PerfLastRun"
    Get-Content $PerfLastRun
}

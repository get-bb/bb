<#
.SYNOPSIS
  Windows twin of .bb-env-setup.sh: provisions the dev environment (pnpm install).
.DESCRIPTION
  Equivalent to the repo-root .bb-env-setup.sh. Every step is logged with the
  [bb-env-setup] prefix and a failing step warns (with its exit code) without
  aborting provisioning, exactly like run_step in the original.
  Deliberate differences from the .sh: the repo root is resolved from this
  script's location instead of assuming the caller cwd, and pnpm is invoked as
  pnpm.cmd explicitly so double-click / non-PATH launches still resolve.
  Reviewed line by line against .bb-env-setup.sh. NOT executed: there is no
  PowerShell on the Linux machine where this was written.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Write-SetupLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[bb-env-setup] $Message"
}

function Invoke-SetupStep {
    param(
        [Parameter(Mandatory = $true)][string]$StepName,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )
    Write-SetupLog "Running: $StepName"
    try {
        & $Action
        if ($LASTEXITCODE -ne 0) {
            Write-SetupLog "Warning: $StepName failed (exit $LASTEXITCODE); continuing provisioning"
        } else {
            Write-SetupLog "Completed: $StepName"
        }
    } catch {
        Write-SetupLog "Warning: $StepName failed ($($_.Exception.Message)); continuing provisioning"
    }
}

$PnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $PnpmCommand) {
    $PnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
}
if (-not $PnpmCommand) {
    Write-SetupLog 'Warning: pnpm is not available; skipping install/build'
    exit 0
}

if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
    Write-SetupLog 'Warning: package.json not found; skipping install/build'
    exit 0
}

Push-Location $RepoRoot
try {
    Invoke-SetupStep 'pnpm install' { & $PnpmCommand.Source install }
} finally {
    Pop-Location
}

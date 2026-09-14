# Merge upstream/main into this fork with the known seams auto-resolved.
#
# Usage: pwsh -NoProfile -File scripts/windows/merge-upstream.ps1 [-Upstream <remote>] [-Branch <branch>]
#
# See "Fork merge conventions" in AGENTS.md for the rules this script implements.

param(
  [string]$Upstream = "upstream",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Set-ForkProtocolVersion {
  # The fork carries a wire delta (hostPlatformSchema gains "windows"), so the
  # protocol version is upstream's version + 1 after every merge.
  $protocolPath = "packages/host-daemon-contract/src/protocol.ts"
  $contractTestPath = "packages/host-daemon-contract/test/contract.test.ts"
  $upstreamSource = & git show "${Upstream}/${Branch}:$protocolPath"
  if ($LASTEXITCODE -ne 0) {
    throw "could not read $protocolPath from ${Upstream}/${Branch}"
  }
  $match = [regex]::Match($upstreamSource, "HOST_DAEMON_PROTOCOL_VERSION = (\d+)")
  if (-not $match.Success) {
    throw "could not find HOST_DAEMON_PROTOCOL_VERSION in ${Upstream}/${Branch}:$protocolPath"
  }
  $resolved = [int]$match.Groups[1].Value + 1
  Write-Host "Resolving protocol version to $resolved (upstream $($match.Groups[1].Value) + 1)"

  foreach ($path in @($protocolPath, $contractTestPath)) {
    if (-not (Test-Path $path)) { continue }
    $contents = Get-Content -Raw -LiteralPath $path
    $updated = [regex]::Replace($contents, "HOST_DAEMON_PROTOCOL_VERSION = \d+", "HOST_DAEMON_PROTOCOL_VERSION = $resolved")
    $updated = [regex]::Replace($updated, "HOST_DAEMON_PROTOCOL_VERSION\)\.toBe\(\d+\)", "HOST_DAEMON_PROTOCOL_VERSION).toBe($resolved)")
    if ($updated -ne $contents) {
      Set-Content -NoNewline -LiteralPath $path -Value $updated
      Invoke-Git add -- $path
    }
  }
}

function Resolve-Lockfile {
  $path = "pnpm-lock.yaml"
  if (-not (Test-Path $path)) { return }
  if ((& git diff --name-only --diff-filter=U -- $path)) {
    Write-Host "Resolving $path from upstream and regenerating with pnpm install"
    Invoke-Git checkout "${Upstream}/${Branch}" -- $path
    Invoke-Git add -- $path
    & pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    Invoke-Git add -- $path
  }
}

function Resolve-PristineUpstreamFiles {
  # These files are kept identical to upstream; fork deltas live in fork-owned
  # files (plugins/bb-fork.json, builtin-registry.fork.ts, ...).
  foreach ($path in @("plugins/bb-official.json")) {
    if ((& git diff --name-only --diff-filter=U -- $path)) {
      Write-Host "Keeping $path identical to upstream"
      Invoke-Git checkout "${Upstream}/${Branch}" -- $path
      Invoke-Git add -- $path
    }
  }
}

Invoke-Git fetch $Upstream
Invoke-Git merge "${Upstream}/${Branch}"

Resolve-Lockfile
Resolve-PristineUpstreamFiles
Set-ForkProtocolVersion

$conflicts = & git diff --name-only --diff-filter=U
if ($conflicts) {
  Write-Host ""
  Write-Host "Unresolved conflicts remain; resolve them and rerun with:"
  Write-Host "  git add <path>; git commit"
  $conflicts | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "Merge complete. Next: pnpm exec turbo run typecheck, then regenerate the marketplace if plugin lists changed."

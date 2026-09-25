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

function Remove-ConflictMarkers {
  # Git leaves the fork's own marker comment in the "ours" block, so keep that
  # side of each conflict; leaving the markers behind would stage broken files.
  param([string]$Text)
  $pattern = [regex]"(?s)<<<<<<< HEAD\r?\n(.*?)(\r?\n)=======\r?\n.*?>>>>>>> [^\r\n]*\r?\n?"
  $keepOurs = [System.Text.RegularExpressions.MatchEvaluator] { param($match) $match.Groups[1].Value + $match.Groups[2].Value }
  return $pattern.Replace($Text, $keepOurs)
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
    $updated = Remove-ConflictMarkers -Text $contents
    $updated = [regex]::Replace($updated, "HOST_DAEMON_PROTOCOL_VERSION = \d+", "HOST_DAEMON_PROTOCOL_VERSION = $resolved")
    $updated = [regex]::Replace($updated, "HOST_DAEMON_PROTOCOL_VERSION\)\.toBe\(\d+\)", "HOST_DAEMON_PROTOCOL_VERSION).toBe($resolved)")
    if ($updated -ne $contents) {
      Set-Content -NoNewline -LiteralPath $path -Value $updated
      Invoke-Git add -- $path
    }
  }
}

function Invoke-PnpmInstall {
  # bb-fork(windows): the fork's .npmrc caps pnpm's virtual-store directory
  # names, and pnpm refuses to reuse a modules dir linked with a different
  # value until that dir is rebuilt.
  param([string]$Label = "pnpm install")
  & pnpm install 2>&1 | Tee-Object -Variable installOutput | Out-Host
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and (($installOutput | Out-String) -match "VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF")) {
    Write-Host "Modules dir uses a different virtual-store-dir-max-length; relinking with pnpm install --force"
    & pnpm install --force 2>&1 | Out-Host
    $exitCode = $LASTEXITCODE
  }
  if ($exitCode -ne 0) { throw "$Label failed" }
}

function Resolve-Lockfile {
  $path = "pnpm-lock.yaml"
  if (-not (Test-Path $path)) { return }
  if ((& git diff --name-only --diff-filter=U -- $path)) {
    Write-Host "Resolving $path from upstream and regenerating with pnpm install"
    Invoke-Git checkout "${Upstream}/${Branch}" -- $path
    Invoke-Git add -- $path
    Invoke-PnpmInstall
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

# bb-fork(windows): exit code 1 means merge conflicts, which this script is
# bb-fork(windows): built to auto-resolve; only harder failures should stop here.
if (Test-Path ".git/MERGE_HEAD") {
  # Resuming a merge left unfinished by an earlier run; git merge would refuse.
  Write-Host "Resuming the in-progress merge"
} else {
  & git merge "${Upstream}/${Branch}"
  if ($LASTEXITCODE -gt 1) {
    throw "git merge ${Upstream}/${Branch} failed with exit code $LASTEXITCODE"
  }
}

Resolve-Lockfile
Resolve-PristineUpstreamFiles
Set-ForkProtocolVersion

$conflicts = & git diff --name-only --diff-filter=U
if ($conflicts) {
  Write-Host ""
  Write-Host "Unresolved conflicts remain; resolve them, then finish the merge with:"
  Write-Host "  git add <path>; git commit"
  Write-Host "Do not rerun this script while a merge is in progress; rerun it on the next upstream update."
  $conflicts | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "Merge complete. Next: pnpm exec turbo run typecheck, then regenerate the marketplace if plugin lists changed."
Write-Host "Restart any running dev instance (pnpm dev:restart-server) so newly bundled upstream plugins are installed."

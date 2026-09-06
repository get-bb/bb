<#
.SYNOPSIS
  Collects Windows QA evidence into qa-evidence/ (host facts + process list).
.DESCRIPTION
  Local equivalent of the evidence steps in .github/workflows/win-native.yml:
  writes 00-host.txt (OS caption/version/architecture, node version/platform/
  arch, PowerShell version) and 90-tasklist.txt (full tasklist) plus
  91-processes.csv (bb / node / electron processes with Id, CPU and working
  set). Run it before installing (baseline) and after closing the app (the
  90/91 files are the proof that no bb/node/electron process survived; see
  qa/CHECKLIST-WIN11.md). The numbered 10/20/30/40 logs are NOT produced here:
  they come from re-running the documented commands with Tee-Object, see
  qa-evidence/README.md.
  Reviewed line by line. NOT executed: there is no PowerShell on the Linux
  machine where this was written.
.EXAMPLE
  qa\scripts\collect-evidence.ps1
.EXAMPLE
  qa\scripts\collect-evidence.ps1 -OutDir C:\bb-test\evidence-dia1
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($OutDir)) {
    $OutDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) 'qa-evidence'
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$HostFile = Join-Path $OutDir '00-host.txt'
'=== OS ===' | Tee-Object $HostFile
Get-CimInstance Win32_OperatingSystem |
    Select-Object Caption, Version, OSArchitecture |
    Out-String |
    Tee-Object -Append $HostFile
'=== node ===' | Tee-Object -Append $HostFile
if (Get-Command node -ErrorAction SilentlyContinue) {
    node -p "process.version + ' ' + process.platform + ' ' + process.arch" |
        Tee-Object -Append $HostFile
} else {
    'node: not on PATH' | Tee-Object -Append $HostFile
}
'=== PowerShell ===' | Tee-Object -Append $HostFile
$PSVersionTable.PSVersion.ToString() | Tee-Object -Append $HostFile

$TasklistFile = Join-Path $OutDir '90-tasklist.txt'
tasklist /FO TABLE | Tee-Object $TasklistFile

$ProcessesFile = Join-Path $OutDir '91-processes.csv'
$Watched = @(Get-Process -Name bb, node, electron -ErrorAction SilentlyContinue)
if ($Watched.Count -gt 0) {
    $Watched |
        Select-Object Name, Id, CPU, WorkingSet64, Path |
        Export-Csv -NoTypeInformation -Path $ProcessesFile
} else {
    'No bb/node/electron processes running.' | Set-Content -Path $ProcessesFile
}

Write-Host "Evidence written to $OutDir"

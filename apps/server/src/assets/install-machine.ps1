param(
  [string]$JoinCode = '',
  [string]$HostId = '',
  [string]$Server = '',
  [string]$MachineCode = '',
  [string]$HostDaemonPort = '',
  [Alias('h')][switch]$Help,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Remaining = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
}

$script:CurlConnectTimeoutSeconds = 10
$script:PackageDownloadTimeoutSeconds = 300
$script:MachineCodeRedeemTimeoutSeconds = 30
$script:DaemonWaitAttempts = 60
$script:WaitProgressEveryAttempts = 5
$script:BbAppAllowScripts = '--allow-scripts=better-sqlite3,node-pty,@parcel/watcher'
$script:GlyphActive = [string][char]0x25CB
$script:GlyphOk = [string][char]0x2713
$script:GlyphFail = [string][char]0x2717
$script:GlyphReady = [string][char]0x25CF
$script:GlyphWarn = '!'
$script:NodeExe = ''
$script:CurlExe = ''
$script:NpmCmd = ''
$script:CurlSilent = $true
$script:PortRegistryDir = ''
$script:HostIdValue = ''

function Write-Usage {
  [Console]::Error.WriteLine('Usage: install.ps1 -JoinCode <code> -HostId <host-id> -Server <url> [-MachineCode <code>] [-HostDaemonPort <port>]')
  [Console]::Error.WriteLine('')
  [Console]::Error.WriteLine('The first three options are required. -MachineCode is required through bb connect.')
  [Console]::Error.WriteLine('By default, the installer assigns this enrolled daemon its own local API port.')
}

function Test-UseColor {
  try {
    return (-not [Console]::IsOutputRedirected) -and $Host.UI.SupportsVirtualTerminal -and [string]::IsNullOrEmpty($env:NO_COLOR)
  } catch {
    return $false
  }
}

$script:UseColor = Test-UseColor

function Format-Color {
  param([string]$Code, [string]$Text)
  if ($script:UseColor) {
    return "$([char]27)[$($Code)m$($Text)$([char]27)[0m"
  }
  return $Text
}

function Format-Bold { param([string]$Text) Format-Color '1' $Text }
function Format-Cyan { param([string]$Text) Format-Color '36' $Text }
function Format-Dim { param([string]$Text) Format-Color '2' $Text }
function Format-Green { param([string]$Text) Format-Color '32' $Text }
function Format-Red { param([string]$Text) Format-Color '31' $Text }
function Format-Yellow { param([string]$Text) Format-Color '33' $Text }

function Write-Step { param([string]$Glyph, [string]$Text) [Console]::WriteLine("  $Glyph  $Text") }
function Write-StepError { param([string]$Glyph, [string]$Text) [Console]::Error.WriteLine("  $Glyph  $Text") }
function Step-Active { param([string]$Text) Write-Step (Format-Dim $script:GlyphActive) $Text }
function Step-Complete { param([string]$Text) Write-Step (Format-Green $script:GlyphOk) $Text }
function Step-Warning { param([string]$Text) Write-StepError (Format-Yellow $script:GlyphWarn) $Text }
function Step-Fail { param([string]$Text) Write-StepError (Format-Red $script:GlyphFail) $Text }
function Write-Detail { param([string]$Text) Write-Step (Format-Dim $Text) '' }
function Write-DetailError { param([string]$Text) Write-StepError (Format-Dim $Text) '' }

function Write-ReadyRow {
  param([string]$Label, [string]$Value)
  Write-Step ' ' "$(Format-Dim ($Label.PadRight(7))) $Value"
}

function Exit-Usage {
  Write-Usage
  exit 2
}

function Exit-Fail {
  param([string]$Message, [string[]]$Details = @(), [int]$Code = 1)
  Step-Fail $Message
  foreach ($detail in $Details) {
    Write-DetailError $detail
  }
  exit $Code
}

function Invoke-NativeCommand {
  param([string]$FilePath, [string[]]$Arguments = @(), [bool]$ShowErrors = $false, [bool]$MergeErrors = $false)
  $ErrorActionPreference = 'Continue'
  if ($MergeErrors) {
    $captured = & $FilePath @Arguments 2>&1
  } elseif ($ShowErrors) {
    $captured = & $FilePath @Arguments
  } else {
    $captured = & $FilePath @Arguments 2>$null
  }
  $code = $LASTEXITCODE
  return @{ ExitCode = $code; Output = ((($captured | ForEach-Object { "$_" }) -join "`n").Trim()) }
}

function Invoke-NodeScript {
  param([string]$ScriptText, [string[]]$ScriptArgs = @(), [string]$StdinText = $null)
  $ErrorActionPreference = 'Continue'
  $nodeExe = Resolve-NodeExe
  $scriptFile = Join-Path ([IO.Path]::GetTempPath()) ('bb-node.' + [IO.Path]::GetRandomFileName() + '.js')
  [IO.File]::WriteAllText($scriptFile, $ScriptText, [System.Text.Encoding]::UTF8)
  try {
    if ($null -ne $StdinText) {
      $captured = $StdinText | & $nodeExe $scriptFile @ScriptArgs 2>$null
    } else {
      $captured = & $nodeExe $scriptFile @ScriptArgs 2>$null
    }
    $code = $LASTEXITCODE
  } finally {
    Remove-Item -LiteralPath $scriptFile -Force -ErrorAction SilentlyContinue
  }
  return @{ ExitCode = $code; Output = ((($captured | ForEach-Object { "$_" }) -join "`n").Trim()) }
}

function Resolve-NodeExe {
  if ($script:NodeExe -ne '') {
    return $script:NodeExe
  }
  $nodeCmd = Get-Command 'node' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $nodeCmd) {
    Exit-Fail 'bb-app requires Node.js 22.19 or newer (22.19, 24, and 26 are tested), but node is not on PATH.'
  }
  $script:NodeExe = $nodeCmd.Source
  return $script:NodeExe
}

function Resolve-CurlExe {
  if ($script:CurlExe -ne '') {
    return $script:CurlExe
  }
  $override = $env:BB_INSTALL_CURL_EXE
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    $script:CurlExe = $override
    return $script:CurlExe
  }
  $curlCmd = Get-Command 'curl.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $curlCmd) {
    Exit-Fail 'Downloading the bb-app package requires curl.exe, but it was not found on PATH.'
  }
  $script:CurlExe = $curlCmd.Source
  return $script:CurlExe
}

function Resolve-NpmCmd {
  if ($script:NpmCmd -ne '') {
    return $script:NpmCmd
  }
  $npmCmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $npmCmd) {
    Exit-Fail 'bb-app installation requires npm.'
  }
  $script:NpmCmd = $npmCmd.Source
  return $script:NpmCmd
}

function Test-ValidPort {
  param([string]$RawPort)
  $result = Invoke-NodeScript 'const rawPort = process.argv[2]; const port = Number(rawPort); process.exit(String(port) === rawPort && Number.isInteger(port) && port >= 1 && port <= 65535 ? 0 : 1);' @($RawPort)
  return ($result.ExitCode -eq 0)
}

function Test-PortAvailable {
  param([string]$Port)
  $result = Invoke-NodeScript 'const net = require("node:net"); const server = net.createServer(); server.once("error", () => process.exit(1)); server.listen({ host: "127.0.0.1", port: Number(process.argv[2]), exclusive: true }, () => { server.close((error) => process.exit(error ? 1 : 0)); });' @($Port)
  return ($result.ExitCode -eq 0)
}

function Test-DaemonStatusMatches {
  param([string]$Port, [string]$ExpectedHostId, [string]$ExpectedServerUrl, [bool]$RequireConnected)
  $requireFlag = 'no'
  if ($RequireConnected) {
    $requireFlag = 'yes'
  }
  $result = Invoke-NodeScript 'const [port, expectedHostId, expectedServerUrl, requireConnected] = process.argv.slice(2); const normalize = (value) => { const url = new URL(String(value)); if (url.hostname === "localhost") url.hostname = "127.0.0.1"; return url.href.replace(/\/$/u, ""); }; void (async () => { const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(750) }); if (!response.ok) process.exit(1); const status = await response.json(); const matches = status && typeof status === "object" && status.hostId === expectedHostId && normalize(status.serverUrl) === normalize(expectedServerUrl) && (requireConnected !== "yes" || status.connected === true); process.exit(matches ? 0 : 1); })().catch(() => process.exit(1));' @($Port, $ExpectedHostId, $ExpectedServerUrl, $requireFlag)
  return ($result.ExitCode -eq 0)
}

function Write-WaitProgress {
  param([int]$Attempt, [string]$Subject)
  if (($Attempt % $script:WaitProgressEveryAttempts) -eq 0) {
    Step-Active "Still waiting for $Subject ($Attempt/$script:DaemonWaitAttempts checks)"
  }
}

function Wait-DaemonConnection {
  param([string]$Subject, [string]$Port, [string]$ExpectedHostId, [string]$ExpectedServerUrl)
  Step-Active "Waiting for $Subject to connect (up to about 2 minutes)"
  $attempts = 0
  while ($attempts -lt $script:DaemonWaitAttempts) {
    if (Test-DaemonStatusMatches -Port $Port -ExpectedHostId $ExpectedHostId -ExpectedServerUrl $ExpectedServerUrl -RequireConnected $true) {
      return $true
    }
    $attempts += 1
    Write-WaitProgress -Attempt $attempts -Subject $Subject
    Start-Sleep -Seconds 1
  }
  return $false
}

function Get-PortReservationOwner {
  param([string]$Port)
  $ownerFile = Join-Path (Join-Path $script:PortRegistryDir $Port) 'data-dir'
  try {
    return ((Get-Content -Path $ownerFile -TotalCount 1 -ErrorAction Stop) | ForEach-Object { "$_" }) -join "`n"
  } catch {
    return ''
  }
}

function Claim-PortForDataDir {
  param([string]$Port, [string]$DataDir)
  $claimDir = Join-Path $script:PortRegistryDir $Port
  try {
    New-Item -ItemType Directory -Path $claimDir -ErrorAction Stop | Out-Null
  } catch {
    return ((Get-PortReservationOwner -Port $Port) -eq $DataDir)
  }
  [IO.File]::WriteAllText((Join-Path $claimDir 'data-dir'), ($DataDir + "`n"), (New-Object Text.UTF8Encoding $false))
  return $true
}

function Release-PortForDataDir {
  param([string]$Port, [string]$DataDir)
  $releaseDir = Join-Path $script:PortRegistryDir $Port
  if ((Get-PortReservationOwner -Port $Port) -eq $DataDir) {
    Remove-Item -Path (Join-Path $releaseDir 'data-dir') -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $releaseDir -Force -ErrorAction SilentlyContinue
  }
}

function Register-ExistingDefaultPorts {
  $machinesRoot = Join-Path $HOME '.bb-machines'
  if (-not (Test-Path -LiteralPath $machinesRoot)) {
    return
  }
  foreach ($entry in Get-ChildItem -LiteralPath $machinesRoot -Directory -ErrorAction SilentlyContinue) {
    $portFile = Join-Path $entry.FullName 'host-daemon-port'
    if (-not (Test-Path -LiteralPath $portFile)) {
      continue
    }
    $existingPort = ((Get-Content -Path $portFile -TotalCount 1 -ErrorAction SilentlyContinue) | ForEach-Object { "$_" }) -join "`n"
    if (-not (Test-ValidPort -RawPort $existingPort)) {
      continue
    }
    $canonical = Invoke-NodeScript 'const fs = require("node:fs"); process.stdout.write(fs.realpathSync(process.argv[2]));' @($entry.FullName)
    if ($canonical.ExitCode -ne 0) {
      continue
    }
    Claim-PortForDataDir -Port $existingPort -DataDir $canonical.Output | Out-Null
  }
}

function Find-AvailableHostDaemonPort {
  param([string]$DataDir)
  $candidate = 38888
  while ($candidate -le 65535) {
    $candidateText = "$candidate"
    if (Claim-PortForDataDir -Port $candidateText -DataDir $DataDir) {
      if (Test-PortAvailable -Port $candidateText) {
        return $candidateText
      }
      Release-PortForDataDir -Port $candidateText -DataDir $DataDir
    }
    $candidate += 1
  }
  Exit-Fail 'Could not find an available host-daemon port.'
  return ''
}

function Test-AuthMatchesHost {
  param([string]$DataDir, [string]$ExpectedHostId)
  $result = Invoke-NodeScript 'const fs = require("node:fs"); const [dataDir, expectedHost] = process.argv.slice(2); const auth = JSON.parse(fs.readFileSync(dataDir + "/auth.json", "utf8")); process.exit(auth.hostId === expectedHost ? 0 : 1);' @($DataDir, $ExpectedHostId)
  return ($result.ExitCode -eq 0)
}

function Test-ConfigMatchesServer {
  param([string]$DataDir, [string]$ExpectedServerUrl)
  $result = Invoke-NodeScript 'const fs = require("node:fs"); const [dataDir, expectedServer] = process.argv.slice(2); const config = JSON.parse(fs.readFileSync(dataDir + "/config.json", "utf8")); const normalize = (value) => String(value).replace(/\/+$/, ""); process.exit(normalize(config.serverUrl) === normalize(expectedServer) ? 0 : 1);' @($DataDir, $ExpectedServerUrl)
  return ($result.ExitCode -eq 0)
}

function Get-ProcessAlive {
  param([int]$ProcessId)
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  return ($null -ne $proc)
}

function Get-ListenerProcessId {
  param([string]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort ([int]$Port) -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $conn) {
      return 0
    }
    return [int]$conn.OwningProcess
  } catch {
    return 0
  }
}

function Start-DetachedDaemonProcess {
  param([string]$WrapperCmd, [string]$LogPath, [string]$WorkingDir)
  $systemCmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $cmdLine = $systemCmd + ' /c ""' + $WrapperCmd + '" < NUL >> "' + $LogPath + '" 2>&1"'
  try {
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine; CurrentDirectory = $WorkingDir } -ErrorAction Stop
  } catch {
    Exit-Fail 'Could not start the bb host daemon.' @($_.Exception.Message)
  }
  if ($created.ReturnValue -ne 0) {
    Exit-Fail 'Could not start the bb host daemon.' @("Win32_Process.Create returned $($created.ReturnValue).")
  }
  return [int]$created.ProcessId
}

function Stop-DaemonProcess {
  param([int]$ProcessId)
  $ErrorActionPreference = 'Continue'
  & taskkill /F /T /PID $ProcessId 2>$null | Out-Null
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      return
    }
    Start-Sleep -Milliseconds 200
  }
}

function Start-HostDaemonProcess {
  param(
    [string]$NodeExe,
    [string[]]$DaemonArgs,
    [string]$LogPath,
    [string]$NpmPrefix,
    [string]$DataDir,
    [string]$PathBbApp
  )
  $previousPrefix = $env:BB_APP_NPM_PREFIX
  $previousDataDir = $env:BB_DATA_DIR
  $env:BB_APP_NPM_PREFIX = $NpmPrefix
  $env:BB_DATA_DIR = $DataDir
  try {
    if ($PathBbApp -ne '') {
      $launchExe = $PathBbApp
    } else {
      $launchExe = $NodeExe
    }
    $quotedArgs = ($DaemonArgs | ForEach-Object { "`"$_`"" }) -join ' '
    $cmdLine = '/c ""' + $launchExe + '" ' + $quotedArgs + ' < NUL >> "' + $LogPath + '" 2>&1"'
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdLine -NoNewWindow -PassThru
    return $proc.Id
  } finally {
    $env:BB_APP_NPM_PREFIX = $previousPrefix
    $env:BB_DATA_DIR = $previousDataDir
  }
}

function Get-ScheduledTaskExists {
  param([string]$TaskName)
  $query = Invoke-NativeCommand -FilePath 'schtasks' -Arguments @('/Query', '/TN', $TaskName, '/FO', 'LIST')
  return ($query.ExitCode -eq 0)
}

function Remove-RunKeyValue {
  param([string]$ValueName)
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $existing = Get-ItemProperty -Path $runKey -Name $ValueName -ErrorAction SilentlyContinue
  if ($null -ne $existing) {
    Remove-ItemProperty -Path $runKey -Name $ValueName -Force -ErrorAction Stop
  }
}

function Install-ScheduledTaskPersistence {
  param(
    [string]$TaskName,
    [string]$WrapperCmd,
    [string]$DataDir,
    [string]$Port,
    [string]$ServerUrl
  )
  $escapedWrapper = [Security.SecurityElement]::Escape($WrapperCmd)
  $escapedDataDir = [Security.SecurityElement]::Escape($DataDir)
  $escapedServer = [Security.SecurityElement]::Escape($ServerUrl)
  $systemCmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $taskLog = Join-Path $DataDir 'logs\host-daemon.log'
  $taskCommand = '/c ""' + $WrapperCmd + '" < NUL >> "' + $taskLog + '" 2>&1"'
  $escapedSystemCmd = [Security.SecurityElement]::Escape($systemCmd)
  $escapedTaskCommand = [Security.SecurityElement]::Escape($taskCommand)
  $taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>bb host daemon for $escapedServer</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>9999</Count>
    </RestartOnFailure>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$escapedSystemCmd</Command>
      <Arguments>$escapedTaskCommand</Arguments>
      <WorkingDirectory>$escapedDataDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
  $xmlPath = Join-Path ([IO.Path]::GetTempPath()) ('bb-task.' + [IO.Path]::GetRandomFileName() + '.xml')
  [IO.File]::WriteAllText($xmlPath, $taskXml, [Text.Encoding]::Unicode)
  if (Get-ScheduledTaskExists -TaskName $TaskName) {
    Invoke-NativeCommand -FilePath 'schtasks' -Arguments @('/End', '/TN', $TaskName) -MergeErrors $true | Out-Null
    $stopDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (([DateTime]::UtcNow -lt $stopDeadline) -and (Get-ListenerProcessId -Port $Port) -ne 0) {
      Start-Sleep -Milliseconds 500
    }
  }
  $staleListener = Get-ListenerProcessId -Port $Port
  if ($staleListener -ne 0) {
    if (Test-DaemonStatusMatches -Port $Port -ExpectedHostId $script:HostIdValue -ExpectedServerUrl $ServerUrl -RequireConnected $false) {
      Stop-DaemonProcess -ProcessId $staleListener
    } else {
      Exit-Fail "Host daemon local API port $Port became unavailable during installation." @('Rerun this command to select a fresh port.')
    }
  }
  try {
    $create = Invoke-NativeCommand -FilePath 'schtasks' -Arguments @('/Create', '/TN', $TaskName, '/XML', $xmlPath, '/F') -MergeErrors $true
    if ($create.ExitCode -ne 0) {
      if ($create.Output -match 'Access is denied') {
        return @{ Kind = 'access-denied' }
      }
      Exit-Fail "Could not register the bb host-daemon scheduled task $TaskName." @("schtasks: $($create.Output)")
    }
  } finally {
    Remove-Item -LiteralPath $xmlPath -Force -ErrorAction SilentlyContinue
  }
  Remove-RunKeyValue -ValueName $TaskName
  $run = Invoke-NativeCommand -FilePath 'schtasks' -Arguments @('/Run', '/TN', $TaskName) -MergeErrors $true
  if ($run.ExitCode -ne 0) {
    Exit-Fail 'The bb host-daemon scheduled task was registered, but it could not be started.' @("schtasks: $($run.Output)")
  }
  if (-not (Wait-DaemonConnection -Subject 'the scheduled task' -Port $Port -ExpectedHostId $script:HostIdValue -ExpectedServerUrl $ServerUrl)) {
    Exit-Fail "The bb host-daemon scheduled task started but did not connect to $ServerUrl." @("See $DataDir\logs\host-daemon.log for the daemon error.")
  }
  return @{ Kind = 'task' }
}

function Install-RunKeyPersistence {
  param(
    [string]$ValueName,
    [string]$WrapperCmd,
    [string]$DataDir,
    [string]$Port,
    [string]$ServerUrl
  )
  if (Get-ScheduledTaskExists -TaskName $ValueName) {
    Exit-Fail "A bb host-daemon scheduled task $ValueName already exists and cannot be managed without elevation." @('Rerun this installer from an elevated PowerShell to replace it, or remove it first with:', "schtasks /Delete /TN '$ValueName' /F")
  }
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  New-ItemProperty -Path $runKey -Name $ValueName -Value "`"$WrapperCmd`"" -PropertyType String -Force -ErrorAction Stop | Out-Null
  if (Test-DaemonStatusMatches -Port $Port -ExpectedHostId $script:HostIdValue -ExpectedServerUrl $ServerUrl -RequireConnected $false) {
    Step-Complete 'Host daemon connected'
    Step-Warning 'Scheduled-task registration was denied; persistence uses your per-user Run key instead.'
    Write-Detail 'The enrolled daemon is already running and stays adopted.'
    return @{ Kind = 'run'; Pid = 0 }
  }
  if (-not (Test-PortAvailable -Port $Port)) {
    Exit-Fail "Host daemon local API port $Port became unavailable during installation." @('Rerun this command to select a fresh port.')
  }
  $daemonLog = Join-Path $DataDir "install-daemon-$Port.log"
  $daemonPid = Start-DetachedDaemonProcess -WrapperCmd $WrapperCmd -LogPath $daemonLog -WorkingDir $DataDir
  if (-not (Wait-DaemonConnection -Subject 'the host daemon' -Port $Port -ExpectedHostId $script:HostIdValue -ExpectedServerUrl $ServerUrl)) {
    Stop-DaemonProcess -ProcessId $daemonPid
    Exit-Fail "The bb host daemon did not connect to $ServerUrl." @("See $daemonLog")
  }
  [IO.File]::WriteAllText((Join-Path $DataDir 'install-daemon.pid'), ("$daemonPid" + "`n"), (New-Object Text.UTF8Encoding $false))
  Step-Complete 'Host daemon connected'
  Step-Warning 'Scheduled-task registration was denied; persistence uses your per-user Run key instead.'
  Write-Detail 'The daemon starts at logon. Restart it after a crash with:'
  Write-Detail "`"$WrapperCmd`""
  return @{ Kind = 'run'; Pid = $daemonPid }
}

if ($Help) {
  Exit-Usage
}
if ($Remaining.Count -gt 0) {
  Step-Fail "Unknown option: $($Remaining[0])"
  Exit-Usage
}
if ([string]::IsNullOrWhiteSpace($JoinCode)) {
  Exit-Usage
}
if ([string]::IsNullOrWhiteSpace($HostId)) {
  Exit-Usage
}
if ([string]::IsNullOrWhiteSpace($Server)) {
  Exit-Usage
}
if ($Server.Contains('"') -or $HostId.Contains('"') -or $JoinCode.Contains('"') -or $MachineCode.Contains('"')) {
  Step-Fail 'Installer arguments must not contain double quotes.'
  exit 2
}

$script:HostIdValue = $HostId
$serverUrl = $Server

[Console]::WriteLine('')
[Console]::WriteLine("  $(Format-Bold 'bb machine setup')")
[Console]::WriteLine('')
Step-Active "Setting up this machine as $HostId for $serverUrl"

$nodeExe = Resolve-NodeExe
$nodeVersionResult = Invoke-NodeScript 'process.stdout.write(process.versions.node)'
$nodeVersion = $nodeVersionResult.Output
$nodeSupported = Invoke-NodeScript 'const parts = process.versions.node.split(".").map(Number); const supported = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 19); process.exit(supported ? 0 : 1);'
if ($nodeSupported.ExitCode -ne 0) {
  Exit-Fail "Node.js $nodeVersion is too old; bb-app requires Node.js 22.19 or newer (22.19, 24, and 26 are tested)."
}

$serverHostResult = Invoke-NodeScript 'const url = new URL(process.argv[2]); process.stdout.write(url.host.replace(/[^a-zA-Z0-9.-]/gu, "-"));' @($serverUrl)
if ($serverHostResult.ExitCode -ne 0) {
  Exit-Fail "Could not parse the server URL $serverUrl."
}
$serverHost = $serverHostResult.Output
$serviceSlug = $serverHost -replace '\.', '-'

$dataDir = $env:BB_DATA_DIR
if ([string]::IsNullOrWhiteSpace($dataDir)) {
  $dataDir = Join-Path (Join-Path $HOME '.bb-machines') $serverHost
}
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dataDir 'logs') -Force | Out-Null
$canonicalResult = Invoke-NodeScript 'const fs = require("node:fs"); process.stdout.write(fs.realpathSync(process.argv[2]));' @($dataDir)
if ($canonicalResult.ExitCode -ne 0) {
  Exit-Fail "Could not resolve the data directory $dataDir."
}
$canonicalDataDir = $canonicalResult.Output
$machineNpmPrefix = Join-Path $canonicalDataDir 'npm'
$bbAppNativeModules = 'better-sqlite3,node-pty,@parcel/watcher'
$bbAppAllowScripts = "--allow-scripts=$bbAppNativeModules"
$script:PortRegistryDir = Join-Path (Join-Path $HOME '.bb-machines') 'host-daemon-ports'
New-Item -ItemType Directory -Path $script:PortRegistryDir -Force | Out-Null

Register-ExistingDefaultPorts

$hostDaemonPortFile = Join-Path $dataDir 'host-daemon-port'
$previousHostDaemonPort = ''
if (Test-Path -LiteralPath $hostDaemonPortFile) {
  $previousHostDaemonPort = ((Get-Content -Path $hostDaemonPortFile -TotalCount 1) | ForEach-Object { "$_" }) -join "`n"
}
$selectedHostDaemonPort = ''
if (-not [string]::IsNullOrWhiteSpace($HostDaemonPort)) {
  if (-not (Test-ValidPort -RawPort $HostDaemonPort)) {
    Step-Fail '--host-daemon-port must be an integer between 1 and 65535.'
    exit 2
  }
  if (-not (Claim-PortForDataDir -Port $HostDaemonPort -DataDir $canonicalDataDir)) {
    Step-Fail "Host daemon local API port $HostDaemonPort is reserved by another bb enrollment."
    Write-DetailError 'Choose another value for -HostDaemonPort and rerun this command.'
    exit 1
  }
  if ((-not (Test-PortAvailable -Port $HostDaemonPort)) -and (-not (Test-DaemonStatusMatches -Port $HostDaemonPort -ExpectedHostId $HostId -ExpectedServerUrl $serverUrl -RequireConnected $false))) {
    Release-PortForDataDir -Port $HostDaemonPort -DataDir $canonicalDataDir
    Step-Fail "Host daemon local API port $HostDaemonPort is already in use."
    Write-DetailError 'Choose another value for -HostDaemonPort and rerun this command.'
    exit 1
  }
  $selectedHostDaemonPort = $HostDaemonPort
} elseif (Test-Path -LiteralPath $hostDaemonPortFile) {
  $storedPort = ((Get-Content -Path $hostDaemonPortFile -TotalCount 1) | ForEach-Object { "$_" }) -join "`n"
  if ((Test-ValidPort -RawPort $storedPort) -and (Claim-PortForDataDir -Port $storedPort -DataDir $canonicalDataDir) -and ((Test-PortAvailable -Port $storedPort) -or (Test-DaemonStatusMatches -Port $storedPort -ExpectedHostId $HostId -ExpectedServerUrl $serverUrl -RequireConnected $false))) {
    $selectedHostDaemonPort = $storedPort
  } else {
    if (Test-ValidPort -RawPort $storedPort) {
      Release-PortForDataDir -Port $storedPort -DataDir $canonicalDataDir
    }
    Step-Warning "Stored host-daemon port $storedPort is unavailable; assigning a new port."
  }
}

if ([string]::IsNullOrWhiteSpace($selectedHostDaemonPort)) {
  $selectedHostDaemonPort = Find-AvailableHostDaemonPort -DataDir $canonicalDataDir
}
[IO.File]::WriteAllText($hostDaemonPortFile, ($selectedHostDaemonPort + "`n"), (New-Object Text.UTF8Encoding $false))
if ((Test-ValidPort -RawPort $previousHostDaemonPort) -and ($previousHostDaemonPort -ne $selectedHostDaemonPort)) {
  Release-PortForDataDir -Port $previousHostDaemonPort -DataDir $canonicalDataDir
}
Step-Complete "Using local host-daemon port $selectedHostDaemonPort"

$packageUrl = "$($serverUrl.TrimEnd('/'))/install/bb-app.tgz"
$packageDir = Join-Path ([IO.Path]::GetTempPath()) ('bb-app.' + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
$packageFile = Join-Path $packageDir 'bb-app.tgz'
$packageHeaders = Join-Path $packageDir 'headers'
$hostArtifactDigestFile = Join-Path $dataDir 'host-artifact.sha256'
$installedArtifactDigest = ''
$prefixBbAppCmd = Join-Path $machineNpmPrefix 'bb-app.cmd'
$prefixBbCmd = Join-Path $machineNpmPrefix 'bb.cmd'
$prefixBundle = Join-Path $machineNpmPrefix 'node_modules\bb-app\host-daemon\dist\daemon-bundle.mjs'
if ((Test-Path -LiteralPath $prefixBbAppCmd) -and (Test-Path -LiteralPath $prefixBbCmd) -and (Test-Path -LiteralPath $prefixBundle)) {
  $digestResult = Invoke-NodeScript 'const fs = require("node:fs"); try { const digest = fs.readFileSync(process.argv[2], "utf8").trim(); if (/^[a-f0-9]{64}$/u.test(digest)) process.stdout.write(digest); } catch {}' @($hostArtifactDigestFile)
  if ($digestResult.ExitCode -eq 0) {
    $installedArtifactDigest = $digestResult.Output
  }
}
$curlExe = Resolve-CurlExe
$script:CurlExe = $curlExe
$script:CurlSilent = $true
try {
  if (-not [Console]::IsErrorRedirected) {
    $script:CurlSilent = $false
  }
} catch {
  $script:CurlSilent = $true
}
$curlOutputMode = '--silent'
if (-not $script:CurlSilent) {
  $curlOutputMode = '--progress-meter'
}
Step-Active 'Downloading the server''s bb-app package (timeout: 5 minutes)'
$packageStatus = '000'
if ($installedArtifactDigest -ne '') {
  $curlConfigFile = Join-Path $packageDir 'curl-config'
  Set-Content -Path $curlConfigFile -Value "header = `"If-None-Match: \`"sha256-$installedArtifactDigest\`"`"" -Encoding ascii
  $download = Invoke-NativeCommand -FilePath $curlExe -Arguments @($curlOutputMode, '--show-error', '--location', '--connect-timeout', "$script:CurlConnectTimeoutSeconds", '--max-time', "$script:PackageDownloadTimeoutSeconds", '-K', $curlConfigFile, '--dump-header', $packageHeaders, '--output', $packageFile, '--write-out', '%{http_code}', $packageUrl) -ShowErrors (-not $script:CurlSilent)
  if ($download.ExitCode -eq 0) {
    $packageStatus = $download.Output
  }
} else {
  $download = Invoke-NativeCommand -FilePath $curlExe -Arguments @($curlOutputMode, '--show-error', '--location', '--connect-timeout', "$script:CurlConnectTimeoutSeconds", '--max-time', "$script:PackageDownloadTimeoutSeconds", '--dump-header', $packageHeaders, '--output', $packageFile, '--write-out', '%{http_code}', $packageUrl) -ShowErrors (-not $script:CurlSilent)
  if ($download.ExitCode -eq 0) {
    $packageStatus = $download.Output
  }
}

$packageDigest = ''
if (Test-Path -LiteralPath $packageHeaders) {
  $digestParse = Invoke-NodeScript 'const fs = require("node:fs"); try { const headers = fs.readFileSync(process.argv[2], "utf8"); const matches = [...headers.matchAll(/^x-bb-artifact-sha256:\s*([a-f0-9]{64})\s*$/gimu)]; const digest = matches.at(-1); if (digest) process.stdout.write(digest[1]); } catch {}' @($packageHeaders)
  if ($digestParse.ExitCode -eq 0) {
    $packageDigest = $digestParse.Output
  }
}

$bbAppJs = ''
$pathBbApp = ''
$bbAppNpmPrefix = ''
$packageStatusCode = 0
[void][int]::TryParse($packageStatus, [ref]$packageStatusCode)
if (($packageStatus -eq '304') -and ($installedArtifactDigest -ne '')) {
  $bbAppNpmPrefix = $machineNpmPrefix
  Step-Complete 'The identical server host artifact is already installed'
} elseif (($packageStatusCode -ge 200) -and ($packageStatusCode -lt 300)) {
  if ($packageDigest -ne '') {
    $downloadedDigestResult = Invoke-NodeScript 'const crypto = require("node:crypto"); const fs = require("node:fs"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[2])).digest("hex"));' @($packageFile)
    $downloadedDigest = $downloadedDigestResult.Output
    if ($downloadedDigest -ne $packageDigest) {
      Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
      Step-Fail 'The downloaded bb host artifact failed SHA-256 verification.'
      Write-DetailError "Expected $packageDigest but received $downloadedDigest."
      exit 1
    }
  }
  $npmCmd = Resolve-NpmCmd
  Step-Complete 'Downloaded the server''s bb-app package'
  Step-Active 'Installing the server''s bb-app build'
  Remove-Item -LiteralPath $hostArtifactDigestFile -Force -ErrorAction SilentlyContinue
  & {
    $ErrorActionPreference = 'Continue'
    & $npmCmd install -g $bbAppAllowScripts --prefix $machineNpmPrefix $packageFile
  }
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
    Exit-Fail 'Could not install bb-app for this machine. Check the npm error above, then rerun this command.'
  }
  $bbAppNpmPrefix = $machineNpmPrefix
  Step-Complete 'Installed the server''s bb-app build'
} else {
  $pathBbAppCmd = Get-Command 'bb-app.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $pathBbAppCmd) {
    $pathBbAppCmd = Get-Command 'bb-app' -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if ($null -ne $pathBbAppCmd) {
    Remove-Item -LiteralPath $hostArtifactDigestFile -Force -ErrorAction SilentlyContinue
    $pathBbApp = $pathBbAppCmd.Source
    if ($packageStatus -eq '404') {
      Step-Warning "The server does not provide its bb-app package; using bb-app at $pathBbApp"
    } else {
      Step-Warning "Could not download the server's bb-app package (HTTP $packageStatus); using bb-app at $pathBbApp"
    }
  } elseif ($packageStatus -eq '404') {
    $npmCmd = Resolve-NpmCmd
    Remove-Item -LiteralPath $hostArtifactDigestFile -Force -ErrorAction SilentlyContinue
    Step-Warning 'The server does not provide its bb-app package'
    Step-Active 'Installing bb-app from the npm registry'
    & {
      $ErrorActionPreference = 'Continue'
      & $npmCmd install -g $bbAppAllowScripts --prefix $machineNpmPrefix bb-app
    }
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
      Exit-Fail 'Could not install bb-app for this machine. Check the npm error above, then rerun this command.'
    }
    $bbAppNpmPrefix = $machineNpmPrefix
    Step-Complete 'Installed bb-app from the npm registry'
  } else {
    Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
    Exit-Fail "Could not download the server's bb-app package from $packageUrl (HTTP $packageStatus)."
  }
}
Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue

if ($bbAppNpmPrefix -ne '') {
  $bbAppJs = Join-Path $bbAppNpmPrefix 'node_modules\bb-app\dist\bb-app.js'
  if (-not (Test-Path -LiteralPath $bbAppJs)) {
    Exit-Fail "npm installed bb-app, but did not create the expected executable at $bbAppJs."
  }
  $bbAppRoot = Join-Path $bbAppNpmPrefix 'node_modules\bb-app'
  $nativeCheck = Invoke-NodeScript 'const root = process.argv[2]; require(root + "/node_modules/node-pty"); require(root + "/node_modules/@parcel/watcher");' @($bbAppRoot)
  if ($nativeCheck.ExitCode -ne 0) {
    Step-Fail 'npm installed bb-app, but its host native add-ons (node-pty, @parcel/watcher) did not load.'
    Write-DetailError "npm did not run their install scripts. Check the npm warnings above. If they mention allowScripts or ignore-scripts, rerun this command with: npm_config_allow_scripts=$bbAppNativeModules npm_config_ignore_scripts=false"
    exit 1
  }
  if (($packageStatusCode -ge 200) -and ($packageStatusCode -lt 300) -and ($packageDigest -ne '')) {
    [IO.File]::WriteAllText($hostArtifactDigestFile, ($packageDigest + "`n"), (New-Object Text.UTF8Encoding $false))
  }
}

if ($MachineCode -ne '') {
  $apexResult = Invoke-NodeScript 'const url = new URL(process.argv[2]); const labels = url.hostname.split("."); if (labels.length < 3) process.exit(2); url.hostname = labels.slice(1).join("."); url.pathname = "/"; url.search = ""; url.hash = ""; process.stdout.write(url.origin);' @($serverUrl)
  if ($apexResult.ExitCode -ne 0) {
    Exit-Fail "Could not derive the bb connect apex from $serverUrl."
  }
  $connectApex = $apexResult.Output
  Step-Active 'Authorizing this machine with bb connect'
  $redeemBodyFile = Join-Path ([IO.Path]::GetTempPath()) ('bb-redeem.' + [IO.Path]::GetRandomFileName() + '.json')
  Set-Content -Path $redeemBodyFile -Value "{`"code`":`"$MachineCode`"}" -Encoding ascii
  try {
    $redeem = Invoke-NativeCommand -FilePath $curlExe -Arguments @('-fsS', '--connect-timeout', "$script:CurlConnectTimeoutSeconds", '--max-time', "$script:MachineCodeRedeemTimeoutSeconds", '-X', 'POST', '-H', 'content-type: application/json', '--data', "@$redeemBodyFile", "$connectApex/api/connect/redeem-machine") -ShowErrors $true
  } finally {
    Remove-Item -LiteralPath $redeemBodyFile -Force -ErrorAction SilentlyContinue
  }
  if ($redeem.ExitCode -ne 0) {
    Exit-Fail 'Could not redeem the bb connect machine code.'
  }
  $redeemApply = Invoke-NodeScript 'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => { const body = JSON.parse(input); if (typeof body.credential !== "string" || body.credential.indexOf("bbcm_") !== 0) { process.exit(2); } if (typeof body.machineId !== "string" || body.machineId.length === 0) { process.exit(2); } const fs = require("node:fs"); const path = require("node:path"); const [dataDir, serverUrl] = process.argv.slice(2); const configPath = path.join(dataDir, "config.json"); let config = {}; try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; } config.serverUrl = serverUrl; config.machineCredential = body.credential; config.connectMachineId = body.machineId; const temporary = configPath + "." + process.pid + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n"); fs.renameSync(temporary, configPath); });' @($dataDir, $serverUrl) -StdinText $redeem.Output
  if ($redeemApply.ExitCode -ne 0) {
    Exit-Fail 'The bb connect machine-code response was invalid.'
  }
  Step-Complete 'Authorized this machine with bb connect'
}

$taskName = "bb-host-daemon-$serviceSlug"
$wrapperCmd = Join-Path $dataDir "$taskName.cmd"
$expandedPath = [Environment]::ExpandEnvironmentVariables($env:PATH)
$wrapperLines = @(
  '@echo off',
  'setlocal',
  "set `"BB_APP_NPM_PREFIX=$bbAppNpmPrefix`"",
  "set `"BB_DATA_DIR=$dataDir`"",
  "set `"PATH=$expandedPath`""
)
if ($bbAppJs -ne '') {
  $wrapperLines += "`"$nodeExe`" `"$bbAppJs`" host-daemon --auto-update --host-daemon-port $selectedHostDaemonPort --server-url `"$serverUrl`""
} else {
  $wrapperLines += "call `"$pathBbApp`" host-daemon --auto-update --host-daemon-port $selectedHostDaemonPort --server-url `"$serverUrl`""
}
[IO.File]::WriteAllLines($wrapperCmd, $wrapperLines, [Text.Encoding]::Default)

$alreadyJoined = $false
$authFile = Join-Path $dataDir 'auth.json'
$configFile = Join-Path $dataDir 'config.json'
if (Test-Path -LiteralPath $authFile) {
  if (-not (Test-AuthMatchesHost -DataDir $dataDir -ExpectedHostId $HostId)) {
    Step-Fail "$dataDir already holds credentials for a different host, not $HostId."
    Write-DetailError "If this machine was removed from the server, delete $dataDir and rerun this command."
    exit 1
  }
  if ((Test-Path -LiteralPath $configFile) -and (Test-ConfigMatchesServer -DataDir $dataDir -ExpectedServerUrl $serverUrl)) {
    $alreadyJoined = $true
    Step-Complete "This machine is already joined to $serverUrl as $HostId"
  }
}

$joinPid = 0
if (-not $alreadyJoined) {
  if ((-not (Test-PortAvailable -Port $selectedHostDaemonPort)) -and (-not (Test-DaemonStatusMatches -Port $selectedHostDaemonPort -ExpectedHostId $HostId -ExpectedServerUrl $serverUrl -RequireConnected $false))) {
    Exit-Fail "Host daemon local API port $selectedHostDaemonPort became unavailable during installation." @('Rerun this command to select a fresh port.')
  }
  $joinLog = Join-Path $dataDir "install-join-$selectedHostDaemonPort.log"
  Step-Active "Joining $serverUrl as $HostId"
  Write-Detail "Join progress is logged to $joinLog"
  $joinArgs = @('host-daemon', 'join', '--auto-update', '--host-daemon-port', $selectedHostDaemonPort, '--join-code', $JoinCode, '--host-id', $HostId, '--server-url', $serverUrl)
  if ($bbAppJs -ne '') {
    $joinArgs = @($bbAppJs) + $joinArgs
  }
  $joinPid = Start-HostDaemonProcess -NodeExe $nodeExe -DaemonArgs $joinArgs -LogPath $joinLog -NpmPrefix $bbAppNpmPrefix -DataDir $dataDir -PathBbApp $pathBbApp
  [IO.File]::WriteAllText((Join-Path $dataDir 'install-daemon.pid'), ("$joinPid" + "`n"), (New-Object Text.UTF8Encoding $false))

  $joined = $false
  $attempts = 0
  Step-Active 'Waiting for the temporary host daemon to connect (up to about 2 minutes)'
  while ($attempts -lt $script:DaemonWaitAttempts) {
    if ((Test-Path -LiteralPath $authFile) -and (Test-AuthMatchesHost -DataDir $dataDir -ExpectedHostId $HostId) -and (Test-DaemonStatusMatches -Port $selectedHostDaemonPort -ExpectedHostId $HostId -ExpectedServerUrl $serverUrl -RequireConnected $true)) {
      $joined = $true
      break
    }
    if (-not (Get-ProcessAlive -ProcessId $joinPid)) {
      Step-Fail "bb host daemon exited before it connected to $serverUrl."
      Write-DetailError "See $joinLog"
      exit 1
    }
    $attempts += 1
    Write-WaitProgress -Attempt $attempts -Subject 'the temporary host daemon'
    Start-Sleep -Seconds 1
  }
  if (-not $joined) {
    Stop-DaemonProcess -ProcessId $joinPid
    Step-Fail "Timed out waiting for host daemon $HostId to connect to $serverUrl."
    Write-DetailError "See $joinLog"
    exit 1
  }
  Step-Complete 'Joined successfully'
}

if ($env:BB_INSTALL_SKIP_SERVICE -eq '1') {
  if (($joinPid -eq 0) -and (-not (Test-DaemonStatusMatches -Port $selectedHostDaemonPort -ExpectedHostId $HostId -ExpectedServerUrl $serverUrl -RequireConnected $false))) {
    if (-not (Test-PortAvailable -Port $selectedHostDaemonPort)) {
      Exit-Fail "Host daemon local API port $selectedHostDaemonPort became unavailable during installation." @('Rerun this command to select a fresh port.')
    }
    $daemonLog = Join-Path $dataDir "install-daemon-$selectedHostDaemonPort.log"
    Step-Active 'Starting the host daemon'
    Write-Detail "Host daemon output is logged to $daemonLog"
    $joinPid = Start-DetachedDaemonProcess -WrapperCmd $wrapperCmd -LogPath $daemonLog -WorkingDir $dataDir
    [IO.File]::WriteAllText((Join-Path $dataDir 'install-daemon.pid'), ("$joinPid" + "`n"), (New-Object Text.UTF8Encoding $false))
    if (-not (Wait-DaemonConnection -Subject 'the host daemon' -Port $selectedHostDaemonPort -ExpectedHostId $HostId -ExpectedServerUrl $serverUrl)) {
      Stop-DaemonProcess -ProcessId $joinPid
      Step-Fail "The bb host daemon did not connect to $serverUrl."
      Write-DetailError "See $daemonLog"
      exit 1
    }
    Step-Complete 'Host daemon connected'
  }
  if ($joinPid -ne 0) {
    Step-Warning "Service installation skipped; daemon PID $joinPid is still running."
  } else {
    Step-Warning 'Service installation skipped; the daemon is already running.'
  }
  exit 0
}

if ($joinPid -ne 0) {
  Stop-DaemonProcess -ProcessId $joinPid
}
Remove-Item -LiteralPath (Join-Path $dataDir 'install-daemon.pid') -Force -ErrorAction SilentlyContinue

Step-Active 'Installing the persistent bb host daemon service'

if ($env:BB_INSTALL_FORCE_RUNKEY -eq '1') {
  $persistence = @{ Kind = 'access-denied' }
} else {
  $persistence = Install-ScheduledTaskPersistence -TaskName $taskName -WrapperCmd $wrapperCmd -DataDir $dataDir -Port $selectedHostDaemonPort -ServerUrl $serverUrl
}
if ($persistence.Kind -eq 'access-denied') {
  if ($env:BB_INSTALL_FORCE_RUNKEY -ne '1') {
    Step-Warning 'Registering a scheduled task requires elevation; persistence uses your per-user Run key instead.'
  }
  $runResult = Install-RunKeyPersistence -ValueName $taskName -WrapperCmd $wrapperCmd -DataDir $dataDir -Port $selectedHostDaemonPort -ServerUrl $serverUrl
  if (($runResult.Kind -eq 'run') -and ($runResult.Pid -ne 0)) {
    Step-Warning "Service installation used the Run key; daemon PID $($runResult.Pid) is still running."
  }
  if (($runResult.Kind -eq 'run') -and ($runResult.Pid -eq 0)) {
    Step-Warning 'Service installation used the Run key; the enrolled daemon is already running.'
  }
  $serviceDesc = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\$taskName"
} else {
  $serviceDesc = "Scheduled task \$taskName"
}

Step-Complete 'Installed and started the persistent host daemon'
[Console]::WriteLine('')
Write-Step (Format-Green $script:GlyphReady) (Format-Bold 'bb machine is ready')
[Console]::WriteLine('')
Write-ReadyRow 'server' (Format-Cyan $serverUrl)
Write-ReadyRow 'daemon' "http://127.0.0.1:$selectedHostDaemonPort"
Write-ReadyRow 'data' $dataDir
Write-ReadyRow 'service' $serviceDesc
[Console]::WriteLine('')
if ($persistence.Kind -eq 'task') {
  Write-Detail 'Starts at logon. If the daemon stops, restart it with:'
  Write-Detail "schtasks /Run /TN '$taskName'"
  Write-Detail "Uninstall: schtasks /Delete /TN '$taskName' /F"
} else {
  Write-Detail 'Starts at logon.'
  Write-Detail "Uninstall: Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name '$taskName'"
}

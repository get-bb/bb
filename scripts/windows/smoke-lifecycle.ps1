#requires -Version 7.0
param(
    [ValidateRange(1024, 65535)][int]$ServerPort = 49886,
    [ValidateRange(1024, 65535)][int]$DaemonPort = 49887
)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'bb.ps1'
$data = Join-Path ([IO.Path]::GetTempPath()) ('bb-windows-smoke-' + [Guid]::NewGuid().ToString('N'))
$common = @{ DataDir = $data; ServerPort = $ServerPort; DaemonPort = $DaemonPort }
function Get-ListenerId([int]$Port) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($listeners.Count -ne 1) { throw "Expected one listener at port $Port, found $($listeners.Count)." }
    return $listeners[0]
}
function Wait-NewListener([int]$Port, [int]$Previous) {
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        try { $current = Get-ListenerId $Port; if ($current -ne $Previous) { return $current } } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "Port $Port did not recover."
}
try {
    $starters = @()
    for ($index = 0; $index -lt 3; $index++) {
        $arguments = @('-NoProfile', '-File', ('"' + $launcher + '"'), '-Action', 'Start', '-DataDir', ('"' + $data + '"'), '-ServerPort', $ServerPort, '-DaemonPort', $DaemonPort)
        $starters += Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
    }
    foreach ($starter in $starters) {
        if (-not $starter.WaitForExit(90000) -or $starter.ExitCode -ne 0) { throw 'Concurrent startup failed.' }
        $starter.Dispose()
    }
    $serverId = Get-ListenerId $ServerPort
    $daemonId = Get-ListenerId $DaemonPort
    $runtime = Get-Content -LiteralPath (Join-Path $data 'bb-app-runtime.json') -Raw | ConvertFrom-Json
    foreach ($component in @(@{ Name = 'server'; Id = $serverId; Port = $ServerPort }, @{ Name = 'host-daemon'; Id = $daemonId; Port = $DaemonPort })) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($component.Id)"
        if ($process.ParentProcessId -ne $runtime.pid) { throw 'Listener is not a direct child of the isolated test runtime.' }
        Stop-Process -Id $component.Id
        $replacement = Wait-NewListener $component.Port $component.Id
        Write-Output "$($component.Name) crash recovery passed ($($component.Id) -> $replacement)."
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($runtime.pid)"
    if ($process.CommandLine -notlike '*scripts/windows/runtime.mjs*') { throw 'Unexpected runtime identity.' }
    $serverId = Get-ListenerId $ServerPort
    $daemonId = Get-ListenerId $DaemonPort
    Stop-Process -Id $runtime.pid
    [void](Wait-NewListener $ServerPort $serverId)
    [void](Wait-NewListener $DaemonPort $daemonId)
    & $launcher -Action Stop @common
    if ($LASTEXITCODE -ne 0) { throw 'Stop failed.' }
    foreach ($port in @($ServerPort, $DaemonPort)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port remains occupied after stop." }
    }
    & $launcher -Action Start @common
    if ($LASTEXITCODE -ne 0) { throw 'Restart failed.' }
    [void](Get-ListenerId $ServerPort)
    [void](Get-ListenerId $DaemonPort)
    Write-Output 'PASS: concurrent start, service crashes, runtime crash, stop, restart.'
} finally {
    & $launcher -Action Stop @common
    Write-Output "Isolated test evidence: $data"
}

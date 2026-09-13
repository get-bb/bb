#requires -Version 7.0
param(
    [ValidateSet('Start', 'Stop', 'Status', 'Supervise')][string]$Action = 'Start',
    [string]$DataDir = $(if ($env:BB_WINDOWS_DATA_DIR) { $env:BB_WINDOWS_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'BBWindows' }),
    [ValidateRange(1024, 65535)][int]$ServerPort = 38886,
    [ValidateRange(1024, 65535)][int]$DaemonPort = 38887,
    [switch]$Lan,
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This launcher requires Windows.' }
if ($ServerPort -eq $DaemonPort) { throw 'Server and daemon ports must differ.' }
$checkout = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$DataDir = [IO.Path]::GetFullPath($DataDir)
$identity = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($DataDir.ToLowerInvariant())))
$mutexName = "Global\BBWindows-$identity"
$mutex = [Threading.Mutex]::new($false, $mutexName)
$owned = $false
try {
    try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
    $stopFile = Join-Path $DataDir 'windows-stop-request'
    if ($Action -eq 'Status') {
        if ($owned) { Write-Output 'Stopped'; exit 1 }
        Write-Output "Supervisor running; http://127.0.0.1:$ServerPort"
        exit 0
    }
    if ($Action -eq 'Stop') {
        if ($owned) { Write-Output 'Already stopped'; exit 0 }
        [IO.File]::WriteAllText($stopFile, 'stop')
        try { $owned = $mutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { throw 'BB has not stopped within 30 seconds; inspect its Windows supervisor log.' }
        Write-Output 'Stopped'
        exit 0
    }
    if (-not $owned) { Write-Output 'BB is already running or stopping.'; exit 0 }
    foreach ($artifact in @('apps/server/dist/index.js', 'apps/host-daemon/dist/daemon-bundle.mjs', 'apps/host-daemon/dist/bb', 'apps/app/dist/index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $checkout $artifact))) { throw "Missing $artifact; run scripts/windows/install.ps1 first." }
    }
    if ($Action -eq 'Start') {
        foreach ($port in @($ServerPort, $DaemonPort)) {
            $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
            try { $probe.Start() } finally { $probe.Stop() }
        }
        $mutex.ReleaseMutex()
        $owned = $false
        $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', ('"' + $PSCommandPath + '"'), '-Action', 'Supervise', '-DataDir', ('"' + $DataDir + '"'), '-ServerPort', $ServerPort, '-DaemonPort', $DaemonPort)
        if ($Lan) { $arguments += '-Lan' }
        if ($EnvFile) { $arguments += @('-EnvFile', ('"' + [IO.Path]::GetFullPath($EnvFile) + '"')) }
        $supervisor = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList $arguments -WorkingDirectory $checkout -WindowStyle Hidden -PassThru
        for ($attempt = 0; $attempt -lt 80; $attempt++) {
            if ($supervisor.HasExited -and $supervisor.ExitCode -ne 0) { throw "Supervisor exited with code $($supervisor.ExitCode)." }
            try {
                $response = Invoke-WebRequest "http://127.0.0.1:$ServerPort/" -TimeoutSec 1 -SkipHttpErrorCheck
                if ($response.StatusCode -eq 200) {
                    $daemonProbe = [Net.Sockets.TcpClient]::new()
                    try {
                        if ($daemonProbe.ConnectAsync('127.0.0.1', $DaemonPort).Wait(500) -and $daemonProbe.Connected) { Write-Output "BB: http://127.0.0.1:$ServerPort"; exit 0 }
                    } finally { $daemonProbe.Dispose() }
                }
            } catch { }
            Start-Sleep -Milliseconds 500
        }
        throw 'BB did not become ready; inspect the Windows supervisor log.'
    }
    New-Item -ItemType Directory -Force $DataDir | Out-Null
    if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowsJob.cs')
    $env:BB_DATA_DIR = $DataDir
    $env:BB_SERVER_BIND_HOST = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
    $env:BB_TELEMETRY = 'false'
    $env:NODE_ENV = 'production'
    $env:PATH = (($env:PATH -split ';' | Select-Object -Unique) -join ';')
    $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
    $logPath = Join-Path $DataDir 'windows-supervisor.log'
    while (-not (Test-Path -LiteralPath $stopFile)) {
        $job = [BbWindowsJob]::new()
        $child = [Diagnostics.Process]::new()
        $outputFile = $null
        $errorFile = $null
        try {
            $child.StartInfo.FileName = $nodeCommand
            $child.StartInfo.WorkingDirectory = $checkout
            $child.StartInfo.UseShellExecute = $false
            $child.StartInfo.CreateNoWindow = $true
            $child.StartInfo.RedirectStandardInput = $true
            $child.StartInfo.RedirectStandardOutput = $true
            $child.StartInfo.RedirectStandardError = $true
            if ($EnvFile) { $child.StartInfo.ArgumentList.Add('--env-file=' + [IO.Path]::GetFullPath($EnvFile)) }
            foreach ($argument in @('--conditions=source', '--import', 'tsx', 'scripts/windows/runtime.mjs', '--server-port', "$ServerPort", '--host-daemon-port', "$DaemonPort")) { $child.StartInfo.ArgumentList.Add($argument) }
            [void]$child.Start()
            $job.Assign($child.Handle)
            $child.StandardInput.WriteLine('start')
            $child.StandardInput.Flush()
            $outputFile = [IO.File]::Open((Join-Path $DataDir 'windows-runtime.out.log'), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $errorFile = [IO.File]::Open((Join-Path $DataDir 'windows-runtime.err.log'), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $stdout = $child.StandardOutput.BaseStream.CopyToAsync($outputFile)
            $stderr = $child.StandardError.BaseStream.CopyToAsync($errorFile)
            $stoppingAt = $null
            while (-not $child.WaitForExit(250)) {
                if (Test-Path -LiteralPath $stopFile) {
                    if ($null -eq $stoppingAt) { $stoppingAt = [DateTime]::UtcNow }
                    if (([DateTime]::UtcNow - $stoppingAt).TotalSeconds -ge 20) { $job.Dispose(); break }
                }
            }
            $job.Dispose()
            $child.WaitForExit()
            $stdout.GetAwaiter().GetResult()
            $stderr.GetAwaiter().GetResult()
            Add-Content -LiteralPath $logPath -Value "$([DateTime]::UtcNow.ToString('o')) Exit: $($child.ExitCode)"
        } finally {
            $job.Dispose()
            if ($child.Id -and -not $child.HasExited) { $child.Kill($true) }
            $child.Dispose()
            if ($outputFile) { $outputFile.Dispose() }
            if ($errorFile) { $errorFile.Dispose() }
        }
        if (-not (Test-Path -LiteralPath $stopFile)) { Start-Sleep -Seconds 3 }
    }
} catch {
    if ($Action -eq 'Supervise' -and $owned) {
        New-Item -ItemType Directory -Force $DataDir | Out-Null
        Add-Content -LiteralPath (Join-Path $DataDir 'windows-supervisor.error.log') -Value "$([DateTime]::UtcNow.ToString('o')) $($_.Exception.Message)"
    }
    throw
} finally {
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}

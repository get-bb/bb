param([ValidateSet('baseline','candidate')][string]$Mode)
$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path $env:RUNNER_TEMP 'dependency-proof'
New-Item -ItemType Directory -Force $fixtureRoot | Out-Null
$env:RUNNER_TEMP = $fixtureRoot
$disk = Join-Path $fixtureRoot 'bb-dependencies.vhdx'
$baseline = Join-Path $env:GITHUB_WORKSPACE '.github/benchmarks/dependency-disk-baseline.ps1'
$candidate = Join-Path $env:GITHUB_WORKSPACE '.github/actions/windows-dependency-cache/disk.ps1'
$target = if ($Mode -eq 'baseline') { $baseline } else { $candidate }
$env:GITHUB_ENV = Join-Path $fixtureRoot 'env.txt'
$env:GITHUB_OUTPUT = Join-Path $fixtureRoot 'output.txt'
function Invoke-Operation([string]$Operation, [string]$Wrapper = '') {
  Clear-Content $env:GITHUB_ENV -ErrorAction SilentlyContinue
  Clear-Content $env:GITHUB_OUTPUT -ErrorAction SilentlyContinue
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  if ($Wrapper) {
    $wrapperFile = Join-Path $fixtureRoot 'wrapper.ps1'
    ("Import-Module Storage`n" + $Wrapper + "`n& '$target' -Operation '$Operation'") | Set-Content $wrapperFile
    & pwsh -NoLogo -NoProfile -File $wrapperFile | Out-Host
  } else {
    & pwsh -NoLogo -NoProfile -File $target -Operation $Operation | Out-Host
  }
  if ($LASTEXITCODE -ne 0) { throw "Script exited $LASTEXITCODE" }
  Write-Host "PROOF $Mode $Operation elapsed=$($timer.Elapsed.TotalSeconds)"
}
function Assert-Active {
  if (!(Select-String -Path $env:GITHUB_OUTPUT -SimpleMatch 'active=true' -Quiet)) { throw 'Expected active=true' }
  $image = Get-DiskImage -ImagePath $disk
  $partition = Get-Partition -DriveLetter P
  if (!$image.Attached -or $partition.DiskNumber -ne ($image | Get-Disk).Number) { throw 'Wrong P: owner' }
  if (!(Select-String -Path $env:GITHUB_ENV -SimpleMatch 'npm_config_store_dir=P:\store' -Quiet)) { throw 'Missing store env' }
  if (!(Select-String -Path $env:GITHUB_ENV -SimpleMatch 'npm_config_virtual_store_dir=P:\virtual-store' -Quiet)) { throw 'Missing virtual store env' }
}
function Assert-Inactive {
  if (!(Select-String -Path $env:GITHUB_OUTPUT -SimpleMatch 'active=false' -Quiet)) { throw 'Expected active=false' }
  if ((Get-Content $env:GITHUB_ENV -ErrorAction SilentlyContinue)) { throw 'Fallback exported dependency env' }
  if ((Get-DiskImage -ImagePath $disk).Attached) { throw 'Failed mount leaked attached image' }
}
try {
  if (Test-Path 'P:\') { throw 'P: occupied before fixture; refusing to touch it' }
  @("create vdisk file=`"$disk`" maximum=256 type=expandable") | Set-Content (Join-Path $fixtureRoot 'empty.txt')
  & diskpart /s (Join-Path $fixtureRoot 'empty.txt') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Empty fixture creation failed' }
  Start-Sleep -Seconds 15
  Invoke-Operation 'mount'
  $attached = (Get-DiskImage -ImagePath $disk).Attached
  Write-Host "PROOF unpartitioned attachedAfterFailure=$attached"
  if ($Mode -eq 'baseline') {
    if (!$attached) { throw 'Expected baseline attached-image leak did not reproduce' }
    if (!(Select-String -Path $env:GITHUB_OUTPUT -SimpleMatch 'active=false' -Quiet)) { throw 'Baseline unexpected outcome' }
    Write-Host 'PROOF baseline cleanup defect reproduced with real VHD'
    exit 0
  }
  Assert-Inactive
  Remove-Item $disk
  Start-Sleep -Seconds 15
  Invoke-Operation 'create'
  Assert-Active
  New-Item -ItemType Directory 'P:\store', 'P:\virtual-store' | Out-Null
  'owned-sentinel' | Set-Content 'P:\store\sentinel.txt'
  Invoke-Operation 'mount'
  if (!(Select-String -Path $env:GITHUB_OUTPUT -SimpleMatch 'active=false' -Quiet)) { throw 'Duplicate mount should fall back' }
  if (!(Get-DiskImage -ImagePath $disk).Attached) { throw 'Duplicate mount detached existing image' }
  if ((Get-Content 'P:\store\sentinel.txt') -ne 'owned-sentinel') { throw 'Duplicate mount changed sentinel' }
  if ((Get-Content $env:GITHUB_ENV -ErrorAction SilentlyContinue)) { throw 'Duplicate mount exported dependency env' }
  Write-Host 'PROOF duplicate mount preserves pre-existing owned drive'
  Invoke-Operation 'detach'
  for ($iteration = 0; $iteration -lt 8; $iteration++) {
    Invoke-Operation 'mount'
    Assert-Active
    if ((Get-Content 'P:\store\sentinel.txt') -ne 'owned-sentinel') { throw 'Sentinel mismatch' }
    "cycle-$iteration" | Set-Content 'P:\virtual-store\write.txt'
    Invoke-Operation 'detach'
    if ((Get-DiskImage -ImagePath $disk).Attached) { throw 'Detach failed' }
  }
  $transientAssignment = @'
$script:assignments = 0
function global:Set-Partition {
  [CmdletBinding()]
  param([Parameter(ValueFromPipeline)]$InputObject, [char]$NewDriveLetter)
  process {
    $script:assignments++
    Write-Host "PROOF assignment attempt=$script:assignments"
    if ($script:assignments -le 2) { throw 'Diagnostic transient volume assignment failure' }
    Storage\Set-Partition -InputObject $InputObject -NewDriveLetter $NewDriveLetter
  }
}
'@
  Invoke-Operation 'mount' $transientAssignment
  Assert-Active
  Invoke-Operation 'detach'
  $transientVolume = @'
$script:lookups = 0
function global:Get-Volume {
  [CmdletBinding()]
  param([Parameter(ValueFromPipeline)]$Partition)
  process {
    $script:lookups++
    Write-Host "PROOF volume lookup=$script:lookups"
    if ($script:lookups -gt 2) { Storage\Get-Volume -Partition $Partition }
  }
}
'@
  Invoke-Operation 'mount' $transientVolume
  Assert-Active
  Invoke-Operation 'detach'
  $permanentAssignment = @'
function global:Set-Partition {
  [CmdletBinding()]
  param([Parameter(ValueFromPipeline)]$InputObject, [char]$NewDriveLetter)
  process { throw 'Diagnostic persistent assignment failure' }
}
'@
  Invoke-Operation 'mount' $permanentAssignment
  Assert-Inactive
  Invoke-Operation 'mount'
  Assert-Active
  Remove-Item 'P:\virtual-store' -Recurse
  Invoke-Operation 'detach'
  Invoke-Operation 'mount'
  Assert-Inactive
  Mount-DiskImage -ImagePath $disk -NoDriveLetter | Out-Null
  $mountedDisk = Get-DiskImage -ImagePath $disk | Get-Disk
  Get-Partition -DiskNumber $mountedDisk.Number -PartitionNumber 1 | Set-Partition -NewDriveLetter P
  New-Item -ItemType Directory 'P:\virtual-store' | Out-Null
  Dismount-DiskImage -ImagePath $disk | Out-Null
  $collisionRoot = Join-Path $fixtureRoot 'collision'
  New-Item -ItemType Directory $collisionRoot | Out-Null
  $collisionDisk = Join-Path $collisionRoot 'bb-dependencies.vhdx'
  Copy-Item $disk $collisionDisk
  Invoke-Operation 'mount'
  Assert-Active
  try {
    $env:RUNNER_TEMP = $collisionRoot
    Invoke-Operation 'mount'
    if (!(Select-String -Path $env:GITHUB_OUTPUT -SimpleMatch 'active=false' -Quiet)) { throw 'Collision should fall back' }
    if ((Get-DiskImage -ImagePath $collisionDisk).Attached) { throw 'Collision attached another image' }
    if ((Get-Content 'P:\store\sentinel.txt') -ne 'owned-sentinel') { throw 'Collision changed sentinel' }
    if ((Get-Partition -DriveLetter P).DiskNumber -ne (Get-DiskImage -ImagePath $disk | Get-Disk).Number) { throw 'Collision changed owner' }
  } finally { $env:RUNNER_TEMP = $fixtureRoot }
  Invoke-Operation 'detach'
  Write-Host 'PROOF candidate lifecycle, recovery, bounded failure, invalid stores, and collision passed'
} finally {
  foreach ($imagePath in @($disk, (Join-Path $fixtureRoot 'collision/bb-dependencies.vhdx'))) {
    if ((Get-DiskImage -ImagePath $imagePath -ErrorAction SilentlyContinue).Attached) { Dismount-DiskImage -ImagePath $imagePath | Out-Null }
  }
}

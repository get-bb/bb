param([Parameter(Mandatory)][ValidateSet('create', 'mount', 'detach')][string]$Operation)

$ErrorActionPreference = 'Stop'
$disk = Join-Path $env:RUNNER_TEMP 'bb-dependencies.vhdx'
$script = Join-Path $env:RUNNER_TEMP 'bb-dependency-disk.txt'

function Invoke-DiskPart([string[]]$Commands) {
  $Commands | Set-Content $script
  & diskpart /s $script
  if ($LASTEXITCODE -ne 0) { throw "diskpart exited with code $LASTEXITCODE" }
}

function Dismount-Dependencies {
  Dismount-DiskImage -ImagePath $disk
  if ((Get-DiskImage -ImagePath $disk).Attached) {
    throw 'Dependency disk is still attached; refusing to cache it'
  }
}

if ($Operation -eq 'detach') {
  Dismount-Dependencies
  exit 0
}

$mountAttempted = $false
try {
  if (Test-Path 'P:\') { throw 'Drive P: is already occupied' }
  if ($Operation -eq 'create' -and (Test-Path $disk)) { throw 'Dependency image already exists' }
  $mountAttempted = $true
  if ($Operation -eq 'create') {
    Invoke-DiskPart @(
      "create vdisk file=`"$disk`" maximum=16384 type=expandable",
      "select vdisk file=`"$disk`"",
      'attach vdisk',
      'create partition primary',
      'format fs=ntfs quick label=bb-dependencies'
    )
  } else {
    Mount-DiskImage -ImagePath $disk -NoDriveLetter
  }
  $assignment = [System.Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    try {
      $image = Get-DiskImage -ImagePath $disk
      if (!$image.Attached) { throw 'Dependency image is not attached' }
      $mountedDisk = $image | Get-Disk
      $partition = Get-Partition -DiskNumber $mountedDisk.Number -PartitionNumber 1
      if (!($partition | Get-Volume)) { throw 'Dependency volume is not ready' }
      $partition | Set-Partition -NewDriveLetter P
      break
    } catch {
      if ($assignment.Elapsed.TotalSeconds -ge 10) { throw }
      Start-Sleep -Milliseconds 200
    }
  }
  $image = Get-DiskImage -ImagePath $disk
  $partition = Get-Partition -DriveLetter P
  if (!$image.Attached -or $partition.DiskNumber -ne ($image | Get-Disk).Number) {
    throw 'Drive P: does not belong to the dependency image'
  }
  if ($Operation -eq 'mount' -and (!(Test-Path 'P:\store') -or !(Test-Path 'P:\virtual-store'))) {
    throw 'Dependency image is missing its pnpm stores'
  }
  'npm_config_store_dir=P:\store' | Out-File -Append $env:GITHUB_ENV
  'npm_config_virtual_store_dir=P:\virtual-store' | Out-File -Append $env:GITHUB_ENV
  'active=true' | Out-File -Append $env:GITHUB_OUTPUT
} catch {
  Write-Host "::warning::Dependency disk unavailable; using a fresh install. $($_.Exception.Message)"
  if ($mountAttempted -and (Get-DiskImage -ImagePath $disk -ErrorAction SilentlyContinue).Attached) {
    try { Dismount-Dependencies } catch { Write-Host "::warning::Could not detach unused dependency disk: $($_.Exception.Message)" }
  }
  'active=false' | Out-File -Append $env:GITHUB_OUTPUT
}
exit 0

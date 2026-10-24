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
  Invoke-DiskPart @("select vdisk file=`"$disk`"", 'detach vdisk')
  if ((Get-DiskImage -ImagePath $disk).Attached) {
    throw 'Dependency disk is still attached; refusing to cache it'
  }
}

if ($Operation -eq 'detach') {
  Dismount-Dependencies
  exit 0
}

$attached = $false
try {
  if (Test-Path 'P:\') { throw 'Drive P: is already occupied' }
  $commands = @()
  if ($Operation -eq 'create') {
    if (Test-Path $disk) { throw 'Dependency image already exists' }
    $commands += "create vdisk file=`"$disk`" maximum=16384 type=expandable"
  }
  $commands += "select vdisk file=`"$disk`""
  $commands += 'attach vdisk'
  if ($Operation -eq 'create') {
    $commands += 'create partition primary'
    $commands += 'format fs=ntfs quick label=bb-dependencies'
  } else {
    $commands += 'select partition 1'
  }
  $commands += 'assign letter=P'
  Invoke-DiskPart $commands
  $image = Get-DiskImage -ImagePath $disk
  $attached = $image.Attached
  $partition = Get-Partition -DriveLetter P
  if (!$attached -or $partition.DiskNumber -ne ($image | Get-Disk).Number) {
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
  if ($attached) {
    try { Dismount-Dependencies } catch { Write-Host "::warning::Could not detach unused dependency disk: $($_.Exception.Message)" }
  }
  'active=false' | Out-File -Append $env:GITHUB_OUTPUT
}
exit 0

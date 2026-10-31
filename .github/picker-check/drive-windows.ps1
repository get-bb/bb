param([string]$Action, [string]$Target, [string]$Shots)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
$auto = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]

function Save-Screen([string]$Name) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save((Join-Path $Shots "windows-$Action-$Name.png"))
  $graphics.Dispose(); $bitmap.Dispose()
}

function Find-Named($Parent, [string]$Name, $Scope) {
  $condition = New-Object System.Windows.Automation.PropertyCondition($auto::NameProperty, $Name)
  return $Parent.FindFirst($Scope, $condition)
}

$dialog = $null
for ($i = 0; $i -lt 60 -and $null -eq $dialog; $i++) {
  Start-Sleep -Milliseconds 500
  $dialog = Find-Named $auto::RootElement "Browse For Folder" $scope::Children
}
if ($null -eq $dialog) { Save-Screen "missing"; throw "Folder dialog did not open" }
Start-Sleep -Seconds 1
Save-Screen "open"

$shell = New-Object -ComObject WScript.Shell
$null = $shell.AppActivate("Browse For Folder")
Start-Sleep -Milliseconds 500
$tree = Find-Named $dialog "Navigation Pane" $scope::Descendants
if ($null -ne $tree) { try { $tree.SetFocus() } catch { Write-Host "Tree focus skipped: $_" } }
Start-Sleep -Milliseconds 300

if ($Action -eq "pick") {
  [System.Windows.Forms.SendKeys]::SendWait("Documents")
  Start-Sleep -Seconds 1
  Save-Screen "selected"
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
} else {
  [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
}
Start-Sleep -Seconds 1

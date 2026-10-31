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

if ($Action -eq "pick") {
  $leaf = "Documents"
  $item = $null
  for ($i = 0; $i -lt 20 -and $null -eq $item; $i++) {
    $item = Find-Named $dialog $leaf $scope::Descendants
    if ($null -eq $item) { Start-Sleep -Milliseconds 500 }
  }
  if ($null -eq $item) {
    Save-Screen "notfound"
    $all = $dialog.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($element in $all) { Write-Host ("UIA {0} | {1} | {2}" -f $element.Current.ControlType.ProgrammaticName, $element.Current.Name, $element.Current.ClassName) }
    throw "Folder $leaf is not in the dialog tree"
  }
  $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
  Start-Sleep -Milliseconds 500
  Save-Screen "selected"
  $button = Find-Named $dialog "OK" $scope::Descendants
} else {
  $button = Find-Named $dialog "Cancel" $scope::Descendants
}
$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

Add-Type -AssemblyName System.Drawing
$path = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\aura-screen-static-background.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)

function IsBorder([int]$x,[int]$y) {
  $c = $bmp.GetPixel($x,$y)
  return ($c.R -gt 55 -and $c.R -ge $c.B -and ($c.R+$c.G) -gt 90)
}

# Sample across first suspected bar row - find rising edges
foreach ($y in 340,346,350,354,390,394,398) {
  $edges=@(); $prev=$false
  for ($x=450; $x -le 640; $x++) {
    $on = IsBorder $x $y
    if ($on -and -not $prev) { $edges += $x }
    $prev=$on
  }
  Write-Output ("y={0} risingEdges={1} count={2}" -f $y, ($edges -join ','), $edges.Count)
}

$bmp.Dispose()

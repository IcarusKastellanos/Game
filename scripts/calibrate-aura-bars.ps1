Add-Type -AssemblyName System.Drawing
$path = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\aura-screen-static-background.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$W = $bmp.Width; $H = $bmp.Height

function Lum([int]$x,[int]$y) {
  $c = $bmp.GetPixel([Math]::Min([Math]::Max($x,0),$W-1), [Math]::Min([Math]::Max($y,0),$H-1))
  return [int](0.3*$c.R + 0.59*$c.G + 0.11*$c.B)
}
function IsEdge([int]$x,[int]$y) {
  # gold/copper outline for segment boxes
  $c = $bmp.GetPixel([Math]::Min([Math]::Max($x,0),$W-1), [Math]::Min([Math]::Max($y,0),$H-1))
  return ($c.R -gt 70 -and $c.R -ge $c.B -and ($c.R+$c.G) -gt 110 -and ($c.R+$c.G+$c.B) -lt 420)
}

# Find horizontal runs of edge pixels in core column (x 450-640, y 300-520)
Write-Output "--- horizontal edge density by y (core col) ---"
for ($y=300; $y -le 520; $y++) {
  $hits=0
  for ($x=460; $x -le 630; $x++) { if (IsEdge $x $y) { $hits++ } }
  if ($hits -ge 18) { Write-Output "y=$y hits=$hits" }
}

Write-Output "--- horizontal edge density by y (mental cols 640-800) ---"
for ($y=300; $y -le 520; $y++) {
  $hits=0
  for ($x=640; $x -le 800; $x++) { if (IsEdge $x $y) { $hits++ } }
  if ($hits -ge 8) { Write-Output "y=$y hits=$hits" }
}

Write-Output "--- left viz interior emptiness: sample L at grid ---"
for ($y=60; $y -le 320; $y+=20) {
  $line = "y=$y "
  for ($x=60; $x -le 420; $x+=40) {
    $line += ("{0,3} " -f (Lum $x $y))
  }
  Write-Output $line
}

Write-Output "--- close button bright box ---"
for ($y=0; $y -lt 55; $y++) {
  $hits=0; $minx=9999; $maxx=0
  for ($x=940; $x -lt 1024; $x++) {
    $c=$bmp.GetPixel($x,$y)
    if (($c.R+$c.G+$c.B) -gt 200) {
      $hits++; if ($x -lt $minx){$minx=$x}; if ($x -gt $maxx){$maxx=$x}
    }
  }
  if ($hits -gt 5) { Write-Output "y=$y bright=$hits x=$minx..$maxx" }
}

$bmp.Dispose()

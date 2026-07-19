Add-Type -AssemblyName System.Drawing
$path = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\aura-screen-static-background.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)

function IsGold([int]$x, [int]$y) {
  $c = $bmp.GetPixel([Math]::Min([Math]::Max($x, 0), $bmp.Width - 1), [Math]::Min([Math]::Max($y, 0), $bmp.Height - 1))
  return ($c.R -gt 80 -and $c.R -gt $c.B + 15 -and ($c.R + $c.G) -gt 130)
}

Write-Output ("W={0} H={1}" -f $bmp.Width, $bmp.Height)
Write-Output "--- gold density by y in right panel x520-970 ---"
for ($y = 60; $y -le 330; $y++) {
  $hits = 0
  for ($x = 520; $x -le 970; $x += 2) {
    if (IsGold $x $y) { $hits++ }
  }
  if ($hits -ge 14) { Write-Output ("y={0} hits={1}" -f $y, $hits) }
}

Write-Output "--- left edge of right panel gold by x at y=100 ---"
for ($x = 480; $x -le 560; $x++) {
  if (IsGold $x 100) { Write-Output ("x={0}" -f $x) }
}

$bmp.Dispose()

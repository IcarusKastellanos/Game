Add-Type -AssemblyName System.Drawing
$path = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\aura-screen-static-background.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$W = $bmp.Width

function Lum([int]$x, [int]$y) {
  $c = $bmp.GetPixel($x, $y)
  return [int](0.3 * $c.R + 0.59 * $c.G + 0.11 * $c.B)
}
function IsMark([int]$x, [int]$y) {
  $c = $bmp.GetPixel($x, $y)
  # gold frame OR bright glyph
  $bright = ($c.R + $c.G + $c.B) -gt 200
  $gold = ($c.R -gt 95 -and $c.R -gt $c.B + 15 -and ($c.R + $c.G) -gt 150)
  return ($bright -or $gold)
}

# Find densest 36x36 window in top-right
$best = 0; $bx = 0; $by = 0
$win = 36
for ($y = 2; $y -le 50; $y += 2) {
  for ($x = 900; $x -le ($W - $win - 2); $x += 2) {
    $hits = 0
    for ($dy = 0; $dy -lt $win; $dy += 2) {
      for ($dx = 0; $dx -lt $win; $dx += 2) {
        if (IsMark ($x + $dx) ($y + $dy)) { $hits++ }
      }
    }
    if ($hits -gt $best) { $best = $hits; $bx = $x; $by = $y }
  }
}
Write-Output ("window origin={0},{1} hits={2}" -f $bx, $by, $best)

# Refine exact bbox inside that window (+padding)
$minX = 9999; $maxX = -1; $minY = 9999; $maxY = -1
for ($y = [Math]::Max(0, $by - 4); $y -lt ($by + $win + 8); $y++) {
  for ($x = [Math]::Max(880, $bx - 8); $x -lt ($bx + $win + 12); $x++) {
    if ($x -ge $W) { continue }
    if (IsMark $x $y) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
Write-Output ("bbox={0},{1} {2}x{3}" -f $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))

# ASCII around detected area
$cx = [int](($minX + $maxX) / 2)
$cy = [int](($minY + $maxY) / 2)
Write-Output ("center={0},{1}" -f $cx, $cy)
for ($y = $minY - 2; $y -le $maxY + 2; $y++) {
  $line = ("{0,3} " -f $y)
  for ($x = $minX - 2; $x -le $maxX + 2; $x++) {
    if ($x -lt 0 -or $x -ge $W -or $y -lt 0) { $line += " "; continue }
    if (IsMark $x $y) {
      if ((Lum $x $y) -gt 140) { $line += "#" } else { $line += "+" }
    } else { $line += "." }
  }
  Write-Output $line
}

$bmp.Dispose()
@{ x = $minX; y = $minY; width = ($maxX - $minX + 1); height = ($maxY - $minY + 1) } | ConvertTo-Json | Set-Content "C:\Users\gjern\OneDrive\Desktop\Game\scripts\_close-bbox.json"

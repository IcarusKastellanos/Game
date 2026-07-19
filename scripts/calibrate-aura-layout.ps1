Add-Type -AssemblyName System.Drawing
$path = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\aura-screen-static-background.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$W = $bmp.Width
$H = $bmp.Height
Write-Output "W=$W H=$H"

function IsGold([int]$x, [int]$y) {
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $W -or $y -ge $H) { return $false }
  $c = $bmp.GetPixel($x, $y)
  # copper/gold: warm and brighter than deep violet bg
  return ($c.R -gt 90 -and $c.R -gt $c.B + 20 -and ($c.R + $c.G) -gt 140)
}

function IsBright([int]$x, [int]$y) {
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $W -or $y -ge $H) { return $false }
  $c = $bmp.GetPixel($x, $y)
  return (($c.R + $c.G + $c.B) -gt 180)
}

$GX=48; $GY=28
$cw = [Math]::Floor($W/$GX); $ch = [Math]::Floor($H/$GY)
for ($gy=0; $gy -lt $GY; $gy++) {
  $line = ("{0,3} " -f ($gy*$ch))
  for ($gx=0; $gx -lt $GX; $gx++) {
    $hits=0; $n=0
    for ($dy=1; $dy -lt $ch-1; $dy+=2) {
      for ($dx=1; $dx -lt $cw-1; $dx+=2) {
        $n++
        if (IsBright ($gx*$cw+$dx) ($gy*$ch+$dy)) { $hits++ }
      }
    }
    $r = $hits / [Math]::Max(1,$n)
    if ($r -gt 0.12) { $line += "#" }
    elseif ($r -gt 0.04) { $line += "+" }
    elseif ($r -gt 0.015) { $line += ":" }
    else { $line += "." }
  }
  Write-Output $line
}

# Find close button: bright cluster near top-right
$closeX=0; $closeY=0; $maxHits=0
for ($y=10; $y -lt 80; $y+=2) {
  for ($x=900; $x -lt 1010; $x+=2) {
    $hits=0
    for ($dy=-8; $dy -le 8; $dy++) {
      for ($dx=-8; $dx -le 8; $dx++) {
        if (IsBright ($x+$dx) ($y+$dy)) { $hits++ }
      }
    }
    if ($hits -gt $maxHits) { $maxHits=$hits; $closeX=$x; $closeY=$y }
  }
}
Write-Output "close hotspot ~ $closeX,$closeY hits=$maxHits"

# Horizontal scan for gold vertical dividers between attribute columns around y=400
Write-Output "--- gold density along y=400 ---"
$line2=""
for ($x=400; $x -lt 1000; $x+=8) {
  $hits=0
  for ($dy=-20; $dy -le 40; $dy+=2) {
    if (IsGold $x ($y=400+$dy)) { $hits++ }
  }
  if ($hits -gt 4) { $line2 += "|" } elseif ($hits -gt 1) { $line2 += ":" } else { $line2 += "." }
}
Write-Output $line2

# Find leftmost/rightmost bright at mid-left panel (viz corners)
Write-Output "--- left panel bright extremes y=90..260 ---"
$minX=9999; $maxX=0; $minY=9999; $maxY=0
for ($y=80; $y -lt 280; $y+=3) {
  for ($x=20; $x -lt 480; $x+=3) {
    if (IsGold $x $y) {
      if ($x -lt $minX) { $minX=$x }; if ($x -gt $maxX) { $maxX=$x }
      if ($y -lt $minY) { $minY=$y }; if ($y -gt $maxY) { $maxY=$y }
    }
  }
}
Write-Output "left gold bbox: $minX,$minY -> $maxX,$maxY"

$minX=9999; $maxX=0; $minY=9999; $maxY=0
for ($y=70; $y -lt 300; $y+=3) {
  for ($x=480; $x -lt 1000; $x+=3) {
    if (IsGold $x $y) {
      if ($x -lt $minX) { $minX=$x }; if ($x -gt $maxX) { $maxX=$x }
      if ($y -lt $minY) { $minY=$y }; if ($y -gt $maxY) { $maxY=$y }
    }
  }
}
Write-Output "right-top gold bbox: $minX,$minY -> $maxX,$maxY"

$minX=9999; $maxX=0; $minY=9999; $maxY=0
for ($y=300; $y -lt 520; $y+=3) {
  for ($x=430; $x -lt 1000; $x+=3) {
    if (IsGold $x $y -or (IsBright $x $y)) {
      if ($x -lt $minX) { $minX=$x }; if ($x -gt $maxX) { $maxX=$x }
      if ($y -lt $minY) { $minY=$y }; if ($y -gt $maxY) { $maxY=$y }
    }
  }
}
Write-Output "bottom-right content bbox: $minX,$minY -> $maxX,$maxY"

$bmp.Dispose()

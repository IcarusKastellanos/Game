Add-Type -AssemblyName System.Drawing
$path = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\aura-screen-static-background.png"
$out = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\_layout-debug.png"
$bmp = New-Object System.Drawing.Bitmap $path
$g = [System.Drawing.Graphics]::FromImage($bmp)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 255, 40, 40), 1)
$pen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 40, 255, 80), 1)
$pen3 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 80, 160, 255), 1)

function Box($p, $x,$y,$w,$h) { $g.DrawRectangle($p, $x, $y, $w, $h) }

# Proposed zones — iterate until they match the image empty areas
Box $pen 58 76 372 218          # viz
Box $pen 528 96 448 118         # overview values
Box $pen 528 226 448 58         # status
Box $pen 968 12 46 40           # close

# Core values / bars
$coreYs = @(330,376,422,468)
$barYs = @(346,392,438,484)
foreach ($i in 0..3) {
  Box $pen2 470 $barYs[$i] 150 10
  $g.DrawLine($pen3, 470, $coreYs[$i], 612, $coreYs[$i])
}

# Mental values
$my = @(342,366,390,414,438,462,486)
foreach ($y in $my) { $g.DrawEllipse($pen3, 780, ($y-3), 6, 6) }

# Technical values
$ty = @(336,358,380,402,424,446,468,490)
foreach ($y in $ty) { $g.DrawEllipse($pen3, 962, ($y-3), 6, 6) }

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $pen.Dispose(); $pen2.Dispose(); $pen3.Dispose()
Write-Output "wrote $out"

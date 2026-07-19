Add-Type -AssemblyName System.Drawing
$path = "C:\Users\gjern\OneDrive\Desktop\Game\client\public\assets\ui\aura-screen\aura-screen-static-background.png"
$bmp = [System.Drawing.Bitmap]::FromFile($path)

# Mid-right panel: find rows that are horizontally consistent (thin rule across empty area)
Write-Output "--- horizontal line candidates (consistent mid brightness change) ---"
for ($y = 90; $y -le 310; $y++) {
  $samples = @()
  for ($x = 560; $x -le 920; $x += 8) {
    $c = $bmp.GetPixel($x, $y)
    $samples += [int](0.3 * $c.R + 0.59 * $c.G + 0.11 * $c.B)
  }
  $avg = ($samples | Measure-Object -Average).Average
  $max = ($samples | Measure-Object -Maximum).Maximum
  $min = ($samples | Measure-Object -Minimum).Minimum
  # thin gold/copper rule: elevated average vs neighbors, low variance
  if ($avg -gt 18 -and $avg -lt 55 -and ($max - $min) -lt 28) {
    Write-Output ("y={0} avg={1:N1} span={2}" -f $y, $avg, ($max - $min))
  }
}

# Compare consecutive rows to find jump (divider)
Write-Output "--- row avg delta ---"
$prev = 0
for ($y = 90; $y -le 310; $y++) {
  $sum = 0; $n = 0
  for ($x = 560; $x -le 920; $x += 4) {
    $c = $bmp.GetPixel($x, $y)
    $sum += 0.3 * $c.R + 0.59 * $c.G + 0.11 * $c.B
    $n++
  }
  $avg = $sum / $n
  $delta = [Math]::Abs($avg - $prev)
  if ($y -gt 90 -and $delta -gt 4) {
    Write-Output ("y={0} avg={1:N1} d={2:N1}" -f $y, $avg, $delta)
  }
  $prev = $avg
}

$bmp.Dispose()

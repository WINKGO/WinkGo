param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true)]
  [string]$IconPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedIcon = (Resolve-Path -LiteralPath $IconPath).Path
$matched = $false
$lastMismatch = "No executable icon was found in $resolvedExecutable"

# signtool and antivirus scanners can keep the previous PE resource view alive
# briefly after packaging. Let the signed file settle before the strict check.
Start-Sleep -Seconds 15

for ($attempt = 1; $attempt -le 5 -and -not $matched; $attempt += 1) {
  $verificationCopy = Join-Path ([System.IO.Path]::GetTempPath()) ("winkgo-icon-audit-{0}.exe" -f [guid]::NewGuid())
  $embeddedIcon = $null
  $expectedIcon = $null
  $embeddedBitmap = $null
  $expectedBitmap = $null
  try {
    Copy-Item -LiteralPath $resolvedExecutable -Destination $verificationCopy
    $embeddedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($verificationCopy)
    $expectedIcon = [System.Drawing.Icon]::new($resolvedIcon, 32, 32)
    if ($null -eq $embeddedIcon) { continue }

    $embeddedBitmap = $embeddedIcon.ToBitmap()
    $expectedBitmap = $expectedIcon.ToBitmap()
    if ($embeddedBitmap.Width -ne $expectedBitmap.Width -or $embeddedBitmap.Height -ne $expectedBitmap.Height) {
      $lastMismatch = "Executable icon dimensions do not match the WINK GO source icon."
      continue
    }

    $matched = $true
    :pixels for ($y = 0; $y -lt $expectedBitmap.Height; $y += 1) {
      for ($x = 0; $x -lt $expectedBitmap.Width; $x += 1) {
        if ($embeddedBitmap.GetPixel($x, $y).ToArgb() -ne $expectedBitmap.GetPixel($x, $y).ToArgb()) {
          $lastMismatch = "Executable icon does not match resources/app.ico at pixel ($x, $y)."
          $matched = $false
          break pixels
        }
      }
    }
  } finally {
    if ($null -ne $embeddedBitmap) { $embeddedBitmap.Dispose() }
    if ($null -ne $expectedBitmap) { $expectedBitmap.Dispose() }
    if ($null -ne $embeddedIcon) { $embeddedIcon.Dispose() }
    if ($null -ne $expectedIcon) { $expectedIcon.Dispose() }
    Remove-Item -LiteralPath $verificationCopy -Force -ErrorAction SilentlyContinue
  }
  if (-not $matched -and $attempt -lt 5) { Start-Sleep -Milliseconds 500 }
}

if (-not $matched) { throw $lastMismatch }

Write-Host "Verified WINK GO executable icon: $resolvedExecutable"

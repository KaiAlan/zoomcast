$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskAssets = Join-Path $taskRoot 'src\renderer\public\backgrounds'
New-Item -ItemType Directory -Force $taskAssets | Out-Null
$taskSources = Get-Content (Join-Path $taskRoot 'tools\background-sources.json') -Raw | ConvertFrom-Json
function Fetch-Background($url, $destination) {
  for ($attempt = 0; $attempt -lt 4; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing $url -OutFile ($destination + '.part') -TimeoutSec 45
      Move-Item ($destination + '.part') $destination -Force
      return
    } catch { if ($attempt -eq 3) { throw }; Write-Output ('Retrying ' + $destination) }
  }
}
foreach ($image in $taskSources) {
  $full = Join-Path $taskAssets ($image.id + '.jpg')
  $thumb = Join-Path $taskAssets ($image.id + '-thumb.jpg')
  if (!(Test-Path $full)) { Fetch-Background ($image.original + '?fm=jpg&fit=crop&crop=entropy&w=3840&h=2160&q=90') $full }
  if (!(Test-Path $thumb)) { Fetch-Background ($image.original + '?fm=jpg&fit=crop&crop=entropy&w=360&h=203&q=80') $thumb }
  Write-Output ($image.label + ': ' + (Get-Item $full).Length)
}

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$fixture = Join-Path (Get-Location) 'tmp\caption-validation\recording'
New-Item -ItemType Directory -Force -Path $fixture | Out-Null
Copy-Item 'tests\fixtures\basic\*' $fixture -Force
Remove-Item (Join-Path $fixture 'project.json') -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speech.SetOutputToWaveFile((Join-Path $fixture 'speech.wav'))
$speech.Speak('Hello. This is a caption test for our screen recorder.')
$speech.Dispose()
$manifest = Get-Content (Join-Path $fixture 'manifest.json') -Raw | ConvertFrom-Json
$manifest.id = 'caption-validation'
$manifest.audio = @(@{role='mic';file='speech.wav';codec='pcm_s16le';startOffsetMs=142})
[System.IO.File]::WriteAllText((Join-Path $fixture 'manifest.json'), ($manifest | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))

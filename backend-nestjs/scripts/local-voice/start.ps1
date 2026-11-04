param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('stt', 'vad', 'tts')]
    [string]$Service
)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '..\..\.local-voice'
$python = Join-Path $runtime 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Run setup.ps1 before starting local voice services.' }
$ports = @{ stt = 8001; vad = 8002; tts = 8003 }
$listener = Get-NetTCPConnection -State Listen -LocalPort $ports[$Service] -ErrorAction SilentlyContinue
if ($listener) { throw "Port $($ports[$Service]) is already in use. No existing process was stopped." }
& $python (Join-Path $PSScriptRoot 'server.py') --service $Service --directory (Join-Path $runtime 'models')
if ($LASTEXITCODE -ne 0) { throw "The $Service voice service exited with an error." }

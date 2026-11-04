$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '..\..\.local-voice'
$python = Join-Path $runtime 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    & python -m venv (Join-Path $runtime 'venv')
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local voice Python environment.' }
}
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Local voice dependency installation failed.' }
& $python (Join-Path $PSScriptRoot 'download_models.py') --directory (Join-Path $runtime 'models')
if ($LASTEXITCODE -ne 0) { throw 'Voice model download failed. Run setup again to resume.' }
Write-Output 'Local voice setup complete. Run start.ps1 in three terminals with -Service stt, vad, and tts.'

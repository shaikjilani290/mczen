$ErrorActionPreference = 'Stop'
$frontendRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'frontend'
if (-not (Test-Path (Join-Path $frontendRoot 'package.json'))) {
    throw "Frontend package.json was not found at $frontendRoot."
}

Write-Host 'Starting the local Vite website on http://127.0.0.1:5174.'
Push-Location $frontendRoot
try {
    & npm.cmd run dev
    if ($LASTEXITCODE -ne 0) { throw "Vite exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
}

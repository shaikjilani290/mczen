$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $backendRoot '.env'

if (-not (Test-Path $envFile)) {
    throw "Local backend .env is missing. Copy .env.example to .env and configure a loopback MySQL connection."
}

$settings = @{}
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        } elseif ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $settings[$Matches[1]] = $value
    }
}

$dbHost = $settings['DB_HOST']
if ($dbHost -notin @('127.0.0.1', 'localhost', '::1')) {
    throw 'Refusing to start local backend: DB_HOST in .env must be loopback.'
}
$dbPort = 3306
if ($settings['DB_PORT']) {
    $parsedPort = 0
    if (-not [int]::TryParse($settings['DB_PORT'], [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
        throw 'DB_PORT in .env must be a valid TCP port.'
    }
    $dbPort = $parsedPort
}
if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port $dbPort -InformationLevel Quiet)) {
    throw "Local MySQL is not accepting TCP connections on 127.0.0.1:$dbPort."
}

$env:NODE_ENV = 'development'
$env:PORT = if ($settings['PORT']) { $settings['PORT'] } else { '3000' }
$env:MCZEN_ALLOW_LOCAL_INGESTION = '1'
$env:MCZEN_ALLOW_DEV_HEADER = '0'
$env:MCZEN_EXPOSE_DEV_AUTH_TOKENS = '0'
$env:OLLAMA_FALLBACK_ENABLED = 'false'

Write-Host "Starting local NestJS API on port $($env:PORT); Ollama fallback is disabled."
Push-Location $backendRoot
try {
    & npm.cmd run start:dev
    if ($LASTEXITCODE -ne 0) { throw "NestJS exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
}

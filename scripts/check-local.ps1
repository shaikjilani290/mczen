param(
    [string]$ApiBaseUrl = 'http://127.0.0.1:3000',
    [string]$WebsiteBaseUrl = 'http://127.0.0.1:5174'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $repositoryRoot 'backend-nestjs\.env'
$settings = @{}

if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            $settings[$Matches[1]] = $Matches[2].Trim()
        }
    }
}

function Test-TcpPort([string]$HostName, [int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $result = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(1200)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-HttpEndpoint([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
        return "$($response.StatusCode)"
    } catch {
        if ($_.Exception.Response) { return "$([int]$_.Exception.Response.StatusCode)" }
        return 'unavailable'
    }
}

function Get-LocalServicePort([string]$Setting, [int]$DefaultPort) {
    $configured = [Environment]::GetEnvironmentVariable($Setting)
    if (-not $configured) { $configured = $settings[$Setting] }
    if (-not $configured) { return $DefaultPort }
    try {
        $uri = [Uri]$configured
        if ($uri.IsAbsoluteUri -and $uri.Host -in @('127.0.0.1', 'localhost', '::1')) {
            return $uri.Port
        }
    } catch {
        return $null
    }
    return $null
}

$mysqlPort = 3306
if ($settings['DB_PORT'] -match '^\d+$') {
    $mysqlPort = [int]$settings['DB_PORT']
}

$readyUrl = $ApiBaseUrl.TrimEnd('/') + '/api/health/ready'
Write-Host "NestJS readiness: $(Test-HttpEndpoint $readyUrl)"
Write-Host "Website HTTP: $(Test-HttpEndpoint ($WebsiteBaseUrl.TrimEnd('/') + '/'))"
Write-Host "MySQL loopback TCP ($mysqlPort): $(if (Test-TcpPort '127.0.0.1' $mysqlPort) { 'available' } else { 'unavailable' })"
foreach ($service in @(
    @{ Name = 'Whisper STT'; Setting = 'VOICE_STT_URL'; DefaultPort = 8001 },
    @{ Name = 'Silero VAD'; Setting = 'VOICE_VAD_URL'; DefaultPort = 8002 },
    @{ Name = 'Piper TTS'; Setting = 'VOICE_TTS_URL'; DefaultPort = 8003 },
    @{ Name = 'Dhvaani TTS'; Setting = 'DHVAANI_TTS_URL'; DefaultPort = 28003 }
)) {
    $port = Get-LocalServicePort $service.Setting $service.DefaultPort
    if ($null -eq $port) {
        Write-Host "$($service.Name): non-loopback or invalid local configuration; not probed"
        continue
    }
    $status = if (Test-TcpPort '127.0.0.1' $port) { 'available' } else { 'unavailable' }
    Write-Host "$($service.Name) loopback TCP ($port): $status"
}
Write-Host "Ollama TCP (11434): $(if (Test-TcpPort '127.0.0.1' 11434) { 'available' } else { 'stopped' })"

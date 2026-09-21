# PORQUÊ: setup idempotente no Windows. Equivalente ao bin/setup.sh.
# Uso: bin/setup.ps1 [-E2E]  (-E2E instala browsers do Playwright, pesado)
param([switch]$E2E)
$ErrorActionPreference = 'Stop'

function Invoke-Npm {
  # PORQUÊ: npm escreve warnings no stderr e o PS 5.1 com Stop abortaria neles.
  # Consome as linhas e falha só no exit code real.
  param([Parameter(Mandatory = $true)][string[]]$NpmArgs, [Parameter(Mandatory = $true)][string]$Step)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & npm @NpmArgs 2>&1 | ForEach-Object { Write-Output "$_" }
    if ($LASTEXITCODE -ne 0) { throw "$Step falhou com exit $LASTEXITCODE" }
  } finally {
    $ErrorActionPreference = $previous
  }
}

foreach ($cmd in @('node', 'npm')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd não encontrado no PATH (recebido: vazio, esperado: instalado)"
  }
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root

Write-Output "[setup] node $(node -v), npm $(npm -v)"
Write-Output "[setup] instalando deps da API (npm ci)..."
Invoke-Npm -NpmArgs @('ci') -Step 'npm ci da API'

if (Test-Path -LiteralPath (Join-Path $root 'panel')) {
  Write-Output "[setup] instalando deps do painel (npm ci)..."
  Invoke-Npm -NpmArgs @('ci', '--prefix', 'panel') -Step 'npm ci do painel'
}

if ($E2E) {
  Write-Output "[setup] instalando browsers do Playwright (painel)..."
  Invoke-Npm -NpmArgs @('--prefix', 'panel', 'exec', 'playwright', 'install', '--with-deps', 'chromium') -Step 'playwright install'
}

Write-Output "[setup] ok. Próximo: npm run verify"

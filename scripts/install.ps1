#Requires -Version 5.1
param(
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

function Test-Cmd {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "monkeyDcode Windows installer" -ForegroundColor Cyan
Write-Host ""

Write-Host "Checking dependencies..."
if (-not (Test-Cmd "bun")) {
    Write-Host "Bun not found. Install from https://bun.sh" -ForegroundColor Red
    exit 1
}
Write-Host ("OK Bun {0}" -f (bun --version)) -ForegroundColor Green

if (-not (Test-Cmd "git")) {
    Write-Host "Git not found." -ForegroundColor Red
    exit 1
}
Write-Host "OK Git" -ForegroundColor Green

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    if (-not (Test-Path $InstallDir)) {
        Write-Host "Cloning repository to $InstallDir ..."
        git clone https://github.com/STRAW-HAT-DEV/monkeyDcode.git $InstallDir
    } else {
        Write-Host "Updating repository at $InstallDir ..."
        git -C $InstallDir pull --ff-only
    }
    $SourceDir = (Resolve-Path $InstallDir).Path
}

Write-Host ""
Write-Host "Source: $SourceDir"
Write-Host "Running bun install..."
Push-Location $SourceDir
bun install
Pop-Location

if (Test-Cmd "python") {
    Write-Host "Setting up Python bridge..."
    if (-not (Test-Cmd "uv")) {
        Write-Host "uv not found. Installing uv..."
        irm https://astral.sh/uv/install.ps1 | iex
        $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    }

    $toolsDir = Join-Path $SourceDir "tools"
    Push-Location $toolsDir
    uv venv | Out-Null
    uv sync
    Pop-Location
}

$binDir = Join-Path $env:USERPROFILE ".local\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$mdcBin = Join-Path $SourceDir "bin\mdc"
$mdcCmd = Join-Path $binDir "mdc.cmd"
@(
    "@echo off",
    "bun `"$mdcBin`" %*"
) | Set-Content -Encoding ASCII $mdcCmd

$monkeyCmd = Join-Path $binDir "monkeydcode.cmd"
@(
    "@echo off",
    "bun `"$mdcBin`" %*"
) | Set-Content -Encoding ASCII $monkeyCmd

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
    Write-Host "Added $binDir to user PATH. Open a new terminal." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Open a NEW PowerShell terminal, then run:"
Write-Host "  mdc"
Write-Host "  mdc setup"
Write-Host ""

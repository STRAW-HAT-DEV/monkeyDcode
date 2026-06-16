#Requires -Version 5.1
<#
.SYNOPSIS
    Install monkeyDcode on Windows — global `mdc` command (like `claude` for Claude Code).

.EXAMPLE
    git clone https://github.com/STRAW-HAT-DEV/monkeyDcode.git
    cd monkeyDcode
    .\scripts\install.ps1
#>
param(
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  monkeyDcode — Installing..." -ForegroundColor Cyan
Write-Host ""

function Test-Cmd($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host "Checking dependencies..."
if (-not (Test-Cmd bun)) {
    Write-Host "  X Bun not found — https://bun.sh" -ForegroundColor Red
    exit 1
}
Write-Host "  OK Bun $(bun --version)" -ForegroundColor Green

if (-not (Test-Cmd git)) {
    Write-Host "  X Git not found" -ForegroundColor Red
    exit 1
}
Write-Host "  OK Git" -ForegroundColor Green

if ($InstallDir -eq "") {
    $SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    if (-not (Test-Path $InstallDir)) {
        git clone https://github.com/STRAW-HAT-DEV/monkeyDcode.git $InstallDir
    } else {
        git -C $InstallDir pull --ff-only
    }
    $SourceDir = (Resolve-Path $InstallDir).Path
}

Write-Host ""
Write-Host "Source: $SourceDir"
Write-Host "bun install..."
Push-Location $SourceDir
bun install

if (Test-Cmd python) {
    Write-Host "Python bridge..."
    if (-not (Test-Cmd uv)) {
        Write-Host "  Installing uv..."
        irm https://astral.sh/uv/install.ps1 | iex
        $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    }
    Push-Location (Join-Path $SourceDir "tools")
    uv venv 2>$null; uv sync
    Pop-Location
}
Pop-Location

$BinDir = Join-Path $env:USERPROFILE ".local\bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$MdcBin = Join-Path $SourceDir "bin\mdc"
$mdcWrapper = Join-Path $BinDir "mdc.cmd"
@"
@echo off
bun "$MdcBin" %*
"@ | Set-Content -Encoding ASCII $mdcWrapper

$monkeyWrapper = Join-Path $BinDir "monkeydcode.cmd"
@"
@echo off
bun "$MdcBin" %*
"@ | Set-Content -Encoding ASCII $monkeyWrapper

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$BinDir", "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "Added $BinDir to user PATH" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! Open a new terminal and run:" -ForegroundColor Green
Write-Host "  mdc          # start agent (first run: model setup)" -ForegroundColor Cyan
Write-Host "  mdc setup    # change API key / provider" -ForegroundColor Cyan
Write-Host "  mdc doctor   # check deps" -ForegroundColor Cyan
Write-Host ""

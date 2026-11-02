# Guild Board setup
#
# Prepares this checkout to run Guild Board: the Python packages, the interface, and a desktop shortcut
# that starts Guild Board. Run it once after the checkout, and again after every update.
#
# Run it from this folder with:
#     powershell -ExecutionPolicy Bypass -File setup.ps1
# Add -DryRun to list the steps without running them.
#
# It changes nothing outside this folder except the shortcut on the desktop.

param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Step([string]$What, [scriptblock]$Run) {
    Write-Output "- $What"
    if ($DryRun) {
        Write-Output ("    " + $Run.ToString().Trim())
        return
    }
    $global:LASTEXITCODE = 0
    & $Run
    if ($LASTEXITCODE -ne 0) {
        Write-Output "This step did not work (exit code $LASTEXITCODE). The steps after it were not run."
        exit 1
    }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Output "uv is not installed. Install it from https://docs.astral.sh/uv/ and run this script again."
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Output "Node.js is not installed. Install version 22 from https://nodejs.org/ and run this script again."
    exit 1
}

# The running program's files are about to be replaced. These call it directly: `uv run` would sync first,
# and meet the running program's files.
$guildboard = Join-Path $PSScriptRoot '.venv\Scripts\guildboard.exe'
if (Test-Path -LiteralPath $guildboard) {
    Step 'Quit Guild Board, if it is running' { & $guildboard --quit }
    Step 'Quit the demo, if it is running' { & $guildboard --demo --quit }
}

Step 'Install the Python packages' { uv sync }
Step 'Install the packages of the interface' { npm ci --prefix web }
Step 'Build the interface' { npm run build --prefix web }
Step 'Make the desktop shortcut' { uv run python -m guildboard.shell.startup desktop }

Write-Output 'Guild Board is ready. Start it from the shortcut on the desktop.'

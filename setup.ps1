# Guild Board setup
#
# Prepares this checkout to run Guild Board: the Python packages, the interface, the Electron shell (the window), a copy
# of Electron's program named for Guild Board, and a desktop shortcut that starts it. Run it once after the checkout, and
# again after every update.
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

# Electron's own program, which runs the shell's folder in this checkout, and its copy named for Guild Board, which a step
# below makes in shell\app-dev and the desktop shortcut starts. Either is a window program: PowerShell would not wait for
# it, so it is started with Start-Process and waited for, and its exit code is kept.
$electron = Join-Path $PSScriptRoot 'shell\node_modules\electron\dist\electron.exe'
$branded = Join-Path $PSScriptRoot 'shell\app-dev\electron.exe'

# The program that asks a running Guild Board to quit: the copy named for Guild Board when there is one, since a Guild
# Board started from the desktop shortcut runs from it; else Electron's own program; else none.
function Find-ShellProgram([string]$Checkout) {
    foreach ($program in 'shell\app-dev\electron.exe', 'shell\node_modules\electron\dist\electron.exe') {
        $path = Join-Path $Checkout $program
        if (Test-Path -LiteralPath $path) { return $path }
    }
    return $null
}
$quitter = Find-ShellProgram $PSScriptRoot
function Invoke-Shell([string[]]$Arguments) {
    $run = Start-Process -FilePath $quitter -ArgumentList $Arguments -WorkingDirectory $PSScriptRoot -Wait -PassThru -WindowStyle Hidden
    $global:LASTEXITCODE = $run.ExitCode
}

# The running program's files are about to be replaced. These call the shell directly: `uv run` would sync first,
# and meet the running program's files. Both steps are always listed; on a fresh checkout neither program is there yet (npm
# fetches Electron's on first use), and then there is nothing running from them to quit.
Step 'Quit Guild Board, if it is running' {
    if ($quitter) { Invoke-Shell @('shell', '--quit') }
}
Step 'Quit the demo, if it is running' {
    if ($quitter) { Invoke-Shell @('shell', '--demo', '--quit') }
}
# A Guild Board of the Qt kind, run from this folder's .venv, cannot be asked to quit, and uv sync would meet its loaded files.
if ((Test-Path -LiteralPath (Join-Path $PSScriptRoot '.venv')) -and -not $quitter) {
    Write-Output 'If Guild Board is running from this folder, quit it from its tray icon first.'
    # The sync below removes PySide6 from under a Qt Guild Board that may still be running: wait for the player.
    if (-not $DryRun) { Read-Host 'Press Enter when Guild Board is closed' | Out-Null }
}

Step 'Install the Python packages' { uv sync }
Step 'Install the packages of the interface' { npm ci --prefix web }
Step 'Build the interface' { npm run build --prefix web }
Step 'Install the packages of the shell' { npm ci --prefix shell }
# npm ci can leave Electron's own program unfetched; it is fetched here when it is missing.
Step 'Fetch the Electron program, if npm left it out' {
    if (-not (Test-Path -LiteralPath $electron)) { node (Join-Path $PSScriptRoot 'shell\node_modules\electron\install.js') }
}
# Electron's own program says "Electron" in Task Manager, on the taskbar and on the tray's balloons. Its copy in
# shell\app-dev says "Guild Board" and has Guild Board's icon. The copy keeps the name electron.exe, by which Electron knows
# that it runs a checkout, so the shell still starts the core from .venv. It is made again only when Electron's version or
# the icon changes.
Step 'Make a copy of the Electron program named for Guild Board' {
    node (Join-Path $PSScriptRoot 'shell\scripts\make-app-dev.mjs')
}
Step 'Build the shell' { npm run build --prefix shell }
Step 'Make the desktop shortcut' {
    # The shortcut starts the copy of Electron named for Guild Board on the shell's folder, from this checkout; it uses the
    # shell's icon.
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Guild Board.lnk'))
    $link.TargetPath = $branded
    $link.Arguments = 'shell'
    $link.WorkingDirectory = $PSScriptRoot
    $link.IconLocation = (Join-Path $PSScriptRoot 'shell\assets\icon.ico') + ',0'
    $link.Description = 'Guild Board'
    $link.Save()
}

Write-Output 'Guild Board is ready. Start it from the shortcut on the desktop.'

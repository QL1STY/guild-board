# Sets up Genshin Optimizer (GO) for tools/go-reference: a checkout at the pinned commit, outside the repository, with its
# packages installed, and Node 24 (portable, nothing installed system-wide) beside it. About 3.2 GB in all.
#
#   powershell -ExecutionPolicy Bypass -File tools\go-reference\setup.ps1
#
# GB_GO_DIR names the checkout (default %LOCALAPPDATA%\guildboard-dev\go). It fetches GO from GitHub and Node from
# nodejs.org, at a developer's request only; the app never runs this. Node's zip is checked against nodejs.org's
# SHASUMS256.txt before it is unpacked. The steps are those of the research (go-engine.md, section 1).
$ErrorActionPreference = 'Stop'

$Commit = '2c13fc40c4694fd8beae513493c4c8a7537173c6'   # run.py's PINNED
$NodeVersion = 'v24.22.3'                               # GO's .nvmrc says 24; its preinstall refuses any other major
$GoDir = if ($env:GB_GO_DIR) { $env:GB_GO_DIR } else { Join-Path $env:LOCALAPPDATA 'guildboard-dev\go' }
$Parent = Split-Path -Parent $GoDir
New-Item -ItemType Directory -Force $Parent | Out-Null

# 1. GO at the pinned commit
if (-not (Test-Path (Join-Path $GoDir '.git'))) {
    Write-Host "Cloning Genshin Optimizer $Commit into $GoDir"
    git init --quiet $GoDir
    git -C $GoDir remote add origin https://github.com/frzyc/genshin-optimizer.git
}
git -C $GoDir fetch --depth 1 origin $Commit
if ($LASTEXITCODE -ne 0) { throw "Could not fetch $Commit" }
git -C $GoDir checkout --quiet --force $Commit
if ($LASTEXITCODE -ne 0) { throw "Could not check out $Commit" }
$Head = (git -C $GoDir rev-parse HEAD).Trim()
if ($Head -ne $Commit) { throw "$GoDir is at $Head, not $Commit" }

# 2. Node 24, portable, checked against SHASUMS256.txt
$NodeName = "node-$NodeVersion-win-x64"
$NodeDir = Join-Path $Parent $NodeName
if (-not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
    $Zip = Join-Path $Parent "$NodeName.zip"
    $Sums = Join-Path $Parent "SHASUMS256-$NodeVersion.txt"
    Write-Host "Downloading Node $NodeVersion"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NodeVersion/$NodeName.zip" -OutFile $Zip
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -OutFile $Sums
    $Line = Select-String -Path $Sums -Pattern ("  " + [regex]::Escape("$NodeName.zip") + "$") | Select-Object -First 1
    if (-not $Line) { throw "SHASUMS256.txt names no $NodeName.zip" }
    $Expected = ($Line.Line -split '\s+')[0].ToLower()
    $Actual = (Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLower()
    if ($Expected -ne $Actual) { Remove-Item $Zip -Force; throw "Node's zip does not match SHASUMS256.txt ($Actual, not $Expected)" }
    Expand-Archive -Path $Zip -DestinationPath $Parent -Force
    Remove-Item $Zip -Force
}

# 3. GO's packages with its own Yarn (3.4.1, committed in the checkout; the package cache is committed too)
$env:PATH = "$NodeDir;$env:PATH"
$env:CYPRESS_INSTALL_BINARY = '0'
Push-Location $GoDir
try {
    & (Join-Path $NodeDir 'node.exe') .yarn/releases/yarn-3.4.1.cjs install
    if ($LASTEXITCODE -ne 0) { throw "yarn install failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Host "Ready: $GoDir with Node $NodeVersion in $NodeDir. Next: uv run python tools/go-reference/run.py kits"

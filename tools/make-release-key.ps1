# Guild Board release key
#
# Makes, once, the key that signs every release of Guild Board (tools/sign-release.ps1). Installed copies offer an update only
# when its installer carries that key's signature (selfupdate.py). The key's private half goes into a file of its own,
# outside this repository, which never goes to GitHub, into a log or into a release; its public half is printed, for
# the app to pin. Run it from this folder with:
#     powershell -ExecutionPolicy Bypass -File tools\make-release-key.ps1
# It writes the key to .guildboard\release-key.pem in your user folder, or to the file -Path names, and refuses a file
# that is already there: installed copies trust one key, and a new one would leave them unable to update.

param([string]$Path = (Join-Path $env:USERPROFILE '.guildboard\release-key.pem'))

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-signing.ps1')

$full = [IO.Path]::GetFullPath($Path)
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if ($full.StartsWith("$repository\", [StringComparison]::OrdinalIgnoreCase)) {
    Write-Output "$full is inside this repository, where the key could be committed. Choose a file outside it."
    exit 1
}
if (Test-Path -LiteralPath $full) {
    Write-Output "$full is already there. A release key is made once; this one was kept as it is."
    exit 1
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $full) | Out-Null
$point = New-ReleaseKey $full

Write-Output "The release key is in $full."
Write-Output ''
Write-Output 'Put this line in place of RELEASE_KEY in src\guildboard\selfupdate.py and in tests\test_handsoff.py:'
Write-Output "RELEASE_KEY = `"$point`""
Write-Output ''
Write-Output 'Tell the release scripts where the key is, for this Windows user, and open a new window afterwards:'
Write-Output "    [Environment]::SetEnvironmentVariable('GUILDBOARD_RELEASE_KEY', '$full', 'User')"
Write-Output ''
Write-Output 'Keep a copy of the file somewhere safe that is not this PC and not GitHub, such as a USB stick.'
Write-Output 'Without it no installed copy can update itself again until it is installed again by hand.'

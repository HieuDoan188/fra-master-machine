param([Parameter(Mandatory=$true)][string]$TeamWorkspace)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'scripts/install.mjs') --team-workspace $TeamWorkspace
if ($LASTEXITCODE -ne 0) { throw 'TEAM_PACK_INSTALL_FAILED' }

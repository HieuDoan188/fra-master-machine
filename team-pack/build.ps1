# Builds the deliverable ZIP + SHA256 after testing the pack in a clean workspace.
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
param([string]$OutDir = (Join-Path $PSScriptRoot '..\dist'))
$ErrorActionPreference = 'Stop'

$info = Get-Content (Join-Path $PSScriptRoot 'team-pack-info.json') -Raw | ConvertFrom-Json
$name = "team-pack-$($info.teamId)-$($info.version)"

Write-Host '1/4 Brain unit tests + smoke tests (mock game server) + simulator'
& node --test (Join-Path $PSScriptRoot 'test/brain.test.mjs') (Join-Path $PSScriptRoot 'test/e2e.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'TESTS_FAILED' }
& node (Join-Path $PSScriptRoot 'test/simulate.mjs')

Write-Host '2/4 Clean install + checker'
$tw = Join-Path ([IO.Path]::GetTempPath()) ("mtm-build-" + [guid]::NewGuid().ToString('N'))
try {
  & (Join-Path $PSScriptRoot 'install.ps1') -TeamWorkspace $tw
  & node (Join-Path $PSScriptRoot 'scripts/check-distribution.mjs') --team-workspace $tw
  if ($LASTEXITCODE -ne 0) { throw 'CHECK_FAILED' }
  & (Join-Path $PSScriptRoot 'install.ps1') -TeamWorkspace $tw   # reinstall must be idempotent
  & node (Join-Path $PSScriptRoot 'scripts/check-distribution.mjs') --team-workspace $tw
  if ($LASTEXITCODE -ne 0) { throw 'REINSTALL_CHECK_FAILED' }
} finally {
  Remove-Item -LiteralPath $tw -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '3/4 Stage source (no logs, caches or credentials)'
$stage = Join-Path ([IO.Path]::GetTempPath()) ("mtm-stage-" + [guid]::NewGuid().ToString('N'))
$pack = Join-Path $stage $name
New-Item -ItemType Directory -Force $pack | Out-Null
foreach ($item in Get-ChildItem -LiteralPath $PSScriptRoot -Force) {
  if ($item.Name -in @('node_modules', '.env')) { continue }
  Copy-Item -LiteralPath $item.FullName -Destination $pack -Recurse -Force
}
# Ship only the empty log placeholder.
Get-ChildItem (Join-Path $pack 'logs') -File | Where-Object { $_.Name -ne 'MATCH_ID.progress.ndjson' } | Remove-Item -Force
Set-Content -LiteralPath (Join-Path $pack 'logs/MATCH_ID.progress.ndjson') -Value $null -NoNewline
$leak = Get-ChildItem -LiteralPath $pack -Recurse -File | Where-Object { $_.Name -ne 'build.ps1' } | Select-String -Pattern '(?i)(ghp_|github_pat_|sk-[a-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY)' -List
if ($leak) { throw "Possible credential in pack: $($leak.Path -join ', ')" }

Write-Host '4/4 Zip + checksum'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$zip = Join-Path (Resolve-Path $OutDir) "$name.zip"
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $pack -DestinationPath $zip
Remove-Item -LiteralPath $stage -Recurse -Force
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $name.zip"
Write-Host "Built $zip"
Write-Host "SHA256 $hash"

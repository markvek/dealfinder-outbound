$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 22.13 or newer from https://nodejs.org, then rerun this installer.'
}
$nodeVersion = (& node.exe --version).Trim().TrimStart('v').Split('.')
if ($LASTEXITCODE -ne 0 -or [int]$nodeVersion[0] -lt 22 -or ([int]$nodeVersion[0] -eq 22 -and [int]$nodeVersion[1] -lt 13)) {
    throw 'Node.js 22.13 or newer is required.'
}
& npm.cmd --prefix agent ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection.' }
& node.exe agent/cli.mjs setup
if ($LASTEXITCODE -ne 0) { throw 'Setup did not finish. Fix the reported issue and rerun this installer.' }
& node.exe agent/cli.mjs schedule
if ($LASTEXITCODE -ne 0) { throw 'Scheduling failed. Run npm.cmd --prefix agent run schedule to retry.' }

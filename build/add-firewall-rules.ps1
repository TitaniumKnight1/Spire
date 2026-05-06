# Run once in an elevated PowerShell to allow Spire / aria2c BitTorrent traffic in dev (Electron + aria2c + ports 6881-6889).
# Packaged installs add rules via NSIS / first-launch netsh when elevated.

$ruleName = "Spire Dev"
$electronCmd = Get-Command electron -ErrorAction SilentlyContinue
if ($electronCmd) {
    $electronPath = $electronCmd.Source
    netsh advfirewall firewall add rule name="$ruleName - App TCP" dir=in action=allow program="$electronPath" protocol=TCP enable=yes profile=any
    netsh advfirewall firewall add rule name="$ruleName - App UDP" dir=in action=allow program="$electronPath" protocol=UDP enable=yes profile=any
}

netsh advfirewall firewall add rule name="$ruleName - Ports TCP" dir=in action=allow protocol=TCP localport=6881-6889 enable=yes profile=any
netsh advfirewall firewall add rule name="$ruleName - Ports UDP" dir=in action=allow protocol=UDP localport=6881-6889 enable=yes profile=any

$aria2Path = $null
$repoAria2 = Join-Path (Split-Path $PSScriptRoot -Parent) "binaries\aria2c.exe"
if (Test-Path $repoAria2) {
    $aria2Path = (Resolve-Path $repoAria2).Path
}
if (-not $aria2Path) {
    $cmd = Get-Command aria2c.exe -ErrorAction SilentlyContinue
    if ($cmd) { $aria2Path = $cmd.Source }
}
if ($aria2Path) {
    netsh advfirewall firewall add rule name="Spire aria2c - App TCP" dir=in action=allow program="$aria2Path" protocol=TCP enable=yes profile=any 2>$null
    netsh advfirewall firewall add rule name="Spire aria2c - App UDP" dir=in action=allow program="$aria2Path" protocol=UDP enable=yes profile=any 2>$null
}

Write-Host "Firewall rules added. Restart Spire and try a magnet link." -ForegroundColor Green

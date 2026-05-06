param()
$ErrorActionPreference = "Continue"
try {
    [Console]::TreatControlCAsInput = $false
} catch {
    # Non-interactive hosts have no console handle
}

$global:SpireDevJobs = @()
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    $j = $global:SpireDevJobs
    if ($j -and $j.Count -gt 0) {
        Stop-Job -Job $j -ErrorAction SilentlyContinue
        Remove-Job -Job $j -Force -ErrorAction SilentlyContinue
    }
}

function Write-StreamLine {
    param(
        [Parameter(Mandatory = $true)][string]$Kind,
        [Parameter(Mandatory = $true)][object]$Item
    )

    if ($Item -is [System.Management.Automation.ErrorRecord]) {
        $errText = $Item.ToString()
        # Chromium/Electron writes DevTools CDP noise to stderr; PowerShell treats it as NativeCommandError.
        if ($errText -match '(?i)Autofill\.(enable|setAddresses)|ERROR:CONSOLE') {
            foreach ($ln in ($errText -split "`n")) {
                if (-not [string]::IsNullOrWhiteSpace($ln)) {
                    Write-Host ('[{0}] {1}' -f $Kind, $ln.Trim()) -ForegroundColor DarkGray
                }
            }
            return
        }
        $parts = [System.Collections.Generic.List[string]]::new()
        [void]$parts.Add($errText)
        if ($Item.Exception) {
            [void]$parts.Add('Exception: ' + $Item.Exception.ToString())
        }
        if ($Item.ScriptStackTrace) {
            [void]$parts.Add('ScriptStackTrace: ' + $Item.ScriptStackTrace.Trim())
        }
        if ($Item.InvocationInfo -and $Item.InvocationInfo.PositionMessage) {
            [void]$parts.Add('Position: ' + $Item.InvocationInfo.PositionMessage.Trim())
        }
        $text = ($parts | Where-Object { $_ -and $_.Trim() } | Select-Object -Unique) -join "`n"
        if ([string]::IsNullOrWhiteSpace($text)) { return }
        foreach ($ln in ($text -split "`n")) {
            if (-not [string]::IsNullOrWhiteSpace($ln)) {
                Write-Host ('[{0}:err] {1}' -f $Kind, $ln.Trim()) -ForegroundColor Red
            }
        }
        return
    }

    $line = if ($Item -is [string]) { $Item } else { ($Item | Out-String).TrimEnd() }
    $line = $line.TrimEnd("`r", "`n")
    if ([string]::IsNullOrWhiteSpace($line)) { return }

    if ($line -match '(?i)Autofill\.(enable|setAddresses)|ERROR:CONSOLE') {
        Write-Host ('[{0}] {1}' -f $Kind, $line) -ForegroundColor DarkGray
        return
    }

    if ($line -match 'error\s+TS') {
        Write-Host ('[{0}] {1}' -f $Kind, $line) -ForegroundColor Red
        return
    }
    if ($line -match 'ready' -or $line.Contains([char]0x2713)) {
        Write-Host ('[{0}] {1}' -f $Kind, $line) -ForegroundColor Green
        return
    }

    $fc = if ($Kind -eq 'vite') { 'DarkCyan' } else { 'DarkGray' }
    Write-Host ('[{0}] {1}' -f $Kind, $line) -ForegroundColor $fc
}

function Receive-JobItems {
    param($Job)
    $chunk = Receive-Job -Job $Job -ErrorAction SilentlyContinue
    if ($null -eq $chunk) { return @() }
    if ($chunk -isnot [array]) { return @($chunk) }
    return $chunk
}

function Drain-Jobs {
    param(
        [Parameter(Mandatory = $true)]$JobEntries
    )
    foreach ($entry in $JobEntries) {
        $name = $entry.Name
        $job = $entry.Job
        foreach ($item in (Receive-JobItems -Job $job)) {
            Write-StreamLine -Kind $name -Item $item
        }
    }
}

function Write-ElectronJobDiagnostics {
    param($Job)
    Write-Host ''
    Write-Host '[electron:fatal] Electron job ended in Failed state.' -ForegroundColor Red
    if ($Job.JobStateInfo -and $null -ne $Job.JobStateInfo.Reason) {
        Write-Host ('[electron:fatal] JobStateInfo.Reason: {0}' -f $Job.JobStateInfo.Reason) -ForegroundColor Red
    }
    $remaining = Receive-Job -Job $Job -ErrorAction SilentlyContinue
    if ($null -ne $remaining) {
        if ($remaining -isnot [array]) { $remaining = @($remaining) }
        foreach ($item in $remaining) {
            Write-StreamLine -Kind 'electron' -Item $item
        }
    }
    Write-Host '[electron:fatal] End of failure diagnostics.' -ForegroundColor Red
    Write-Host ''
}

function Stop-AllSpireJobs {
    param($EntryList)
    if (-not $EntryList -or $EntryList.Count -eq 0) { return }
    $list = @($EntryList | ForEach-Object { $_.Job })
    Stop-Job -Job $list -ErrorAction SilentlyContinue
    Remove-Job -Job $list -Force -ErrorAction SilentlyContinue
    $global:SpireDevJobs = @()
}

# --- 1) Initial build (synchronous, inline output) ---
Write-Host ""
Write-Host '  Spire Dev - building main...' -ForegroundColor Cyan
Write-Host ""

& npm run build:main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Build failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Build OK" -ForegroundColor Green
Write-Host '  Starting jobs (tsc, vite)...' -ForegroundColor DarkGray
Write-Host ""

$repoRoot = (Get-Location).Path

$jobTsc = Start-Job -Name 'tsc' -ScriptBlock {
    param($Root)
    Set-Location -LiteralPath $Root
    npm run dev:main 2>&1
} -ArgumentList $repoRoot

$jobVite = Start-Job -Name 'vite' -ScriptBlock {
    param($Root)
    Set-Location -LiteralPath $Root
    npm run dev:vite 2>&1
} -ArgumentList $repoRoot

$global:SpireDevJobs = @($jobTsc, $jobVite)

$waitJobs = @(
    @{ Name = 'tsc'; Job = $jobTsc }
    @{ Name = 'vite'; Job = $jobVite }
)

# --- 3) Wait for Vite; drain tsc + vite while waiting ---
Write-Host '  Waiting for Vite on :5174...' -ForegroundColor DarkGray
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Drain-Jobs -JobEntries $waitJobs
    try {
        Invoke-WebRequest 'http://localhost:5174' -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null
        $ready = $true
        break
    } catch {}
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    Write-Host ""
    Write-Host '  Vite did not start within 20s. Check [vite] / [vite:err] lines above.' -ForegroundColor Red
    Stop-AllSpireJobs -EntryList $waitJobs
    exit 1
}

# One more drain before header
Drain-Jobs -JobEntries $waitJobs

# --- Header (after Vite ready, before electron) ---
Clear-Host
Write-Host '+------------------------------+' -ForegroundColor Cyan
Write-Host '|  Spire - Dev Server Active   |' -ForegroundColor White
Write-Host '+------------------------------+' -ForegroundColor Cyan
Write-Host 'Vite   -> http://localhost:5174'
Write-Host 'App    -> Electron window'
Write-Host 'Stop   -> Close the Spire window or press Ctrl+C'
Write-Host ""

# --- 4) Start electron job ---
# Run Electron via cmd so Chromium stderr (e.g. DevTools CDP quirks) stays plain stdout text in the job —
# avoids PowerShell turning every native stderr write into an ErrorRecord + red stack noise.
$jobElectron = Start-Job -Name 'electron' -ScriptBlock {
    param($Root)
    Set-Location -LiteralPath $Root
    cmd.exe /c 'set SPIRE_VITE_DEV_SERVER_URL=http://localhost:5174&& npx --no-install electron .'
} -ArgumentList $repoRoot

$global:SpireDevJobs = @($jobTsc, $jobVite, $jobElectron)

$mothershipJobs = @(
    @{ Name = 'tsc'; Job = $jobTsc }
    @{ Name = 'vite'; Job = $jobVite }
    @{ Name = 'electron'; Job = $jobElectron }
)

$electronOnly = @(@{ Name = 'electron'; Job = $jobElectron })
$swStartup = [System.Diagnostics.Stopwatch]::StartNew()
while ($swStartup.ElapsedMilliseconds -lt 3000) {
    Drain-Jobs -JobEntries $electronOnly
    Start-Sleep -Milliseconds 120
}

# --- 5) Mothership loop until electron ends ---
try {
    while ($true) {
        Start-Sleep -Milliseconds 300
        Drain-Jobs -JobEntries $mothershipJobs

        $es = $jobElectron.State
        if ($es -in @('Completed', 'Failed', 'Stopped')) {
            Drain-Jobs -JobEntries $mothershipJobs
            if ($es -eq 'Failed') {
                Write-ElectronJobDiagnostics -Job $jobElectron
            }
            break
        }
    }
} finally {
    Write-Host ""
    Write-Host '  Shutting down.' -ForegroundColor Yellow
    Stop-AllSpireJobs -EntryList $mothershipJobs
}

exit 0

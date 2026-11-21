# Windows: run once in an Administrator PowerShell from the worker folder (e.g. C:\worker).
# Registers a Scheduled Task that starts the worker at boot, before anyone logs in, and restarts it
# every minute if it stops (up to 999 times). Uses only built-in Windows features.
$ErrorActionPreference = 'Stop'
$dir = (Get-Location).Path
$python = Join-Path $dir '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "No virtual environment at $python. Follow README.md 'Install' first." }

$action   = New-ScheduledTaskAction -Execute $python -Argument '-u transcribe_worker.py' -WorkingDirectory $dir
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'TranscribeWorker' -Action $action -Trigger $trigger -Settings $settings `
  -User 'NT AUTHORITY\SYSTEM' -RunLevel Highest -Force | Out-Null

# A GPU PC that sleeps stops transcribing.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Start-ScheduledTask -TaskName 'TranscribeWorker'
Write-Host 'TranscribeWorker installed and started. Check Super admin > Transcription: this PC should show Online within a minute.'

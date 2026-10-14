# electron/smtc/smtcHelper.ps1
# Long-running Windows PowerShell 5.1 helper: polls the system media sessions (SMTC) and prints one
# JSON line to stdout whenever any session changes. Spotify, browsers (YouTube) and most players
# publish here. smtcMonitor.cjs prepends `$ParentPid = <pid>` and runs it via -EncodedCommand, so the
# helper exits on its own when Folia is gone.
#
# Each line: { sessions: [{ appId, title, artist, album, status, positionMs, durationMs, updatedAtMs }], currentAppId }
# positionMs is the position Windows measured at updatedAtMs (unix ms); callers extrapolate from there.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (-not $task.Wait(2000)) { return $null }
    $task.Result
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = Await ($managerType::RequestAsync()) $managerType
if ($null -eq $manager) {
    [Console]::Error.WriteLine('SMTC manager unavailable')
    exit 2
}

function ToUnixMs([DateTimeOffset]$value) {
    $ms = $value.ToUnixTimeMilliseconds()
    if ($ms -lt 0) { return 0 }
    $ms
}

$lastLine = ''
while ($true) {
    if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }

    $sessions = @()
    foreach ($session in $manager.GetSessions()) {
        try {
            $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
            $timeline = $session.GetTimelineProperties()
            $playback = $session.GetPlaybackInfo()
            $sessions += [ordered]@{
                appId       = $session.SourceAppUserModelId
                title       = if ($props) { $props.Title } else { '' }
                artist      = if ($props) { $props.Artist } else { '' }
                album       = if ($props) { $props.AlbumTitle } else { '' }
                status      = "$($playback.PlaybackStatus)".ToLowerInvariant()
                positionMs  = [math]::Round($timeline.Position.TotalMilliseconds)
                durationMs  = [math]::Round($timeline.EndTime.TotalMilliseconds)
                updatedAtMs = ToUnixMs $timeline.LastUpdatedTime
            }
        } catch {
            # A session can vanish between GetSessions and the reads; skip it this round.
        }
    }

    $current = $manager.GetCurrentSession()
    $line = [ordered]@{
        sessions     = $sessions
        currentAppId = if ($current) { $current.SourceAppUserModelId } else { $null }
    } | ConvertTo-Json -Compress -Depth 4

    if ($line -ne $lastLine) {
        [Console]::Out.WriteLine($line)
        [Console]::Out.Flush()
        $lastLine = $line
    }

    Start-Sleep -Milliseconds 400
}

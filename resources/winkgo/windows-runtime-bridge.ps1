$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$notificationWorkerMode = $args.Count -ge 1 -and [string]$args[0] -eq '-NotificationWorker'
$controlWorkerMode = $args.Count -ge 1 -and [string]$args[0] -eq '-ControlWorker'
$notificationWorkerParentId = if ($notificationWorkerMode -and $args.Count -ge 2) {
  [int]$args[1]
} else {
  0
}

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class WinkGoBridgeInputQueue {
  private static readonly BlockingCollection<string> Lines =
    new BlockingCollection<string>();
  private static int started;
  private static volatile bool ended;

  public static bool Ended {
    get { return ended && Lines.Count == 0; }
  }

  public static void Start() {
    if (Interlocked.Exchange(ref started, 1) != 0) return;
    var thread = new Thread(() => {
      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
          Lines.Add(line);
        }
      } finally {
        ended = true;
      }
    });
    thread.IsBackground = true;
    thread.Name = "WINK GO bridge input";
    thread.Start();
  }

  public static string Poll() {
    string line;
    return Lines.TryTake(out line) ? line : null;
  }
}

public static class WinkGoNotificationWorker {
  private static readonly ConcurrentQueue<string> Lines =
    new ConcurrentQueue<string>();
  private static Process process;

  public static bool Start(string scriptPath) {
    if (process != null && !process.HasExited) return true;
    var info = new ProcessStartInfo {
      FileName = "powershell.exe",
      Arguments =
        "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" +
        scriptPath.Replace("\"", "\\\"") +
        "\" -NotificationWorker " +
        Process.GetCurrentProcess().Id,
      UseShellExecute = false,
      CreateNoWindow = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      StandardOutputEncoding = System.Text.Encoding.UTF8,
      StandardErrorEncoding = System.Text.Encoding.UTF8
    };
    process = new Process { StartInfo = info, EnableRaisingEvents = true };
    process.OutputDataReceived += (sender, args) => {
      if (!string.IsNullOrWhiteSpace(args.Data)) Lines.Enqueue(args.Data);
    };
    process.ErrorDataReceived += (sender, args) => {
      if (!string.IsNullOrWhiteSpace(args.Data)) {
        var safe = args.Data.Replace("\\", "\\\\").Replace("\"", "\\\"");
        Lines.Enqueue(
          "{\"type\":\"runtime-warning\",\"scope\":\"notification\",\"message\":\"" +
          safe + "\"}"
        );
      }
    };
    if (!process.Start()) return false;
    process.BeginOutputReadLine();
    process.BeginErrorReadLine();
    return true;
  }

  public static string Poll() {
    string line;
    return Lines.TryDequeue(out line) ? line : null;
  }

  public static void Stop() {
    var current = process;
    process = null;
    if (current == null) return;
    try {
      if (!current.HasExited) current.Kill();
    } catch {
    }
    current.Dispose();
  }
}

public static class WinkGoWindowCaptureNative {
  private delegate bool EnumWindowCallback(IntPtr window, IntPtr parameter);

  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct Point {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetWindowRect(IntPtr window, out Rect rect);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool PrintWindow(IntPtr window, IntPtr deviceContext, uint flags);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetForegroundWindow(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool BringWindowToTop(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ShowWindowAsync(IntPtr window, int command);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetCursorPos(out Point point);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  private static extern void mouse_event(
    uint flags,
    uint x,
    uint y,
    uint data,
    UIntPtr extraInfo
  );

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsIconic(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool EnumWindows(EnumWindowCallback callback, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  public static IntPtr FindLargestWindow(int[] processIds) {
    var targets = new HashSet<uint>();
    foreach (var processId in processIds) {
      if (processId > 0) targets.Add((uint)processId);
    }
    var best = IntPtr.Zero;
    long bestArea = 0;
    EnumWindows((window, parameter) => {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (!targets.Contains(processId)) return true;
      Rect rect;
      if (!GetWindowRect(window, out rect)) return true;
      var width = rect.Right - rect.Left;
      var height = rect.Bottom - rect.Top;
      var area = (long)width * height;
      if (width >= 500 && height >= 300 && area > bestArea) {
        best = window;
        bestArea = area;
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  private static int[] SodaProcessIds() {
    var processes = Process.GetProcessesByName("SodaMusic");
    var ids = new int[processes.Length];
    for (var index = 0; index < processes.Length; index++) {
      ids[index] = processes[index].Id;
    }
    return ids;
  }

  public static bool ClickSodaTransport(string action) {
    var window = FindLargestWindow(SodaProcessIds());
    if (window == IntPtr.Zero) return false;
    Rect rect;
    if (!GetWindowRect(window, out rect)) return false;
    var width = rect.Right - rect.Left;
    var height = rect.Bottom - rect.Top;
    if (width < 640 || height < 420) return false;

    var previousForeground = GetForegroundWindow();
    Point previousCursor;
    GetCursorPos(out previousCursor);
    try {
      ShowWindowAsync(window, 9);
      BringWindowToTop(window);
      SetForegroundWindow(window);
      // Chromium music clients can ignore a click that arrives in the same
      // scheduler slice as the foreground change. Give the real transport bar
      // enough time to become interactive before pressing it.
      Thread.Sleep(110);

      var scaleX = Math.Max(0.75, Math.Min(2.0, width / 1100.0));
      var scaleY = Math.Max(0.75, Math.Min(2.0, height / 720.0));
      var xOffset = 0.0;
      switch ((action ?? string.Empty).ToLowerInvariant()) {
        case "play_pause":
        case "play":
        case "pause":
          break;
        case "next":
          xOffset = 87.0 * scaleX;
          break;
        case "previous":
          xOffset = -87.0 * scaleX;
          break;
        default:
          return false;
      }

      var x = rect.Left + (int)Math.Round(width * 0.5 + xOffset);
      var y = rect.Top + height - (int)Math.Round(44.0 * scaleY);
      SetCursorPos(x, y);
      mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
      mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
      Thread.Sleep(140);
      return true;
    } finally {
      SetCursorPos(previousCursor.X, previousCursor.Y);
      if (previousForeground != IntPtr.Zero && previousForeground != window) {
        SetForegroundWindow(previousForeground);
      }
    }
  }
}

public static class WinkGoMediaKeyNative {
  [DllImport("user32.dll", SetLastError = true)]
  private static extern void keybd_event(
    byte virtualKey,
    byte scanCode,
    uint flags,
    UIntPtr extraInfo
  );

  public static bool Send(string action) {
    byte virtualKey;
    switch ((action ?? string.Empty).ToLowerInvariant()) {
      case "play_pause":
      case "play":
      case "pause":
        virtualKey = 0xB3;
        break;
      case "next":
        virtualKey = 0xB0;
        break;
      case "previous":
        virtualKey = 0xB1;
        break;
      default:
        return false;
    }
    keybd_event(virtualKey, 0, 0, UIntPtr.Zero);
    keybd_event(virtualKey, 0, 0x0002, UIntPtr.Zero);
    return true;
  }

  public static bool SendSoda(string action) {
    // Soda Music 3.x does not expose an SMTC session and ignores the generic
    // Windows media keys. Its visible transport controls are stable across
    // window sizes, so click the real button and restore the user's foreground
    // window/cursor immediately afterwards.
    return WinkGoWindowCaptureNative.ClickSodaTransport(action);
  }
}

enum WinkGoAudioDataFlow {
  Render,
  Capture,
  All,
  Count
}

enum WinkGoAudioRole {
  Console,
  Multimedia,
  Communications,
  Count
}

[Flags]
enum WinkGoAudioClassContext : uint {
  All = 23
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class WinkGoMmDeviceEnumeratorComObject {
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
interface IWinkGoMmDeviceEnumerator {
  int EnumAudioEndpoints(WinkGoAudioDataFlow flow, uint stateMask, out object devices);
  int GetDefaultAudioEndpoint(
    WinkGoAudioDataFlow flow,
    WinkGoAudioRole role,
    out IWinkGoMmDevice device
  );
  int GetDevice(string id, out IWinkGoMmDevice device);
  int RegisterEndpointNotificationCallback(IntPtr callback);
  int UnregisterEndpointNotificationCallback(IntPtr callback);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
interface IWinkGoMmDevice {
  int Activate(
    ref Guid interfaceId,
    WinkGoAudioClassContext classContext,
    IntPtr activationParameters,
    [MarshalAs(UnmanagedType.IUnknown)] out object instance
  );
  int OpenPropertyStore(int access, out IntPtr properties);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetState(out int state);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
interface IWinkGoAudioSessionManager2 {
  int GetAudioSessionControl(ref Guid sessionId, uint flags, out IntPtr control);
  int GetSimpleAudioVolume(ref Guid sessionId, uint flags, out IntPtr volume);
  int GetSessionEnumerator(out IWinkGoAudioSessionEnumerator sessions);
  int RegisterSessionNotification(IntPtr notification);
  int UnregisterSessionNotification(IntPtr notification);
  int RegisterDuckNotification(string sessionId, IntPtr notification);
  int UnregisterDuckNotification(IntPtr notification);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
interface IWinkGoAudioSessionEnumerator {
  int GetCount(out int count);
  int GetSession(int index, out IWinkGoAudioSessionControl control);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
interface IWinkGoAudioSessionControl {
  int GetState(out int state);
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  int SetDisplayName(string name, ref Guid context);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
  int SetIconPath(string path, ref Guid context);
  int GetGroupingParam(out Guid grouping);
  int SetGroupingParam(ref Guid grouping, ref Guid context);
  int RegisterAudioSessionNotification(IntPtr notification);
  int UnregisterAudioSessionNotification(IntPtr notification);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
interface IWinkGoAudioSessionControl2 {
  int GetState(out int state);
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  int SetDisplayName(string name, ref Guid context);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
  int SetIconPath(string path, ref Guid context);
  int GetGroupingParam(out Guid grouping);
  int SetGroupingParam(ref Guid grouping, ref Guid context);
  int RegisterAudioSessionNotification(IntPtr notification);
  int UnregisterAudioSessionNotification(IntPtr notification);
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetProcessId(out uint processId);
  int IsSystemSoundsSession();
  int SetDuckingPreference(bool optOut);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
interface IWinkGoAudioMeterInformation {
  int GetPeakValue(out float peak);
  int GetMeteringChannelCount(out int count);
  int GetChannelsPeakValues(int count, [Out] float[] peaks);
  int QueryHardwareSupport(out int supportMask);
}

public static class WinkGoAudioActivityProbe {
  public static float ReadProcessPeak(string processName) {
    object managerObject = null;
    IWinkGoMmDevice device = null;
    IWinkGoAudioSessionEnumerator sessions = null;
    var maximumPeak = 0.0f;

    try {
      var deviceEnumerator =
        (IWinkGoMmDeviceEnumerator)new WinkGoMmDeviceEnumeratorComObject();
      Marshal.ThrowExceptionForHR(
        deviceEnumerator.GetDefaultAudioEndpoint(
          WinkGoAudioDataFlow.Render,
          WinkGoAudioRole.Multimedia,
          out device
        )
      );

      var managerId = typeof(IWinkGoAudioSessionManager2).GUID;
      Marshal.ThrowExceptionForHR(
        device.Activate(
          ref managerId,
          WinkGoAudioClassContext.All,
          IntPtr.Zero,
          out managerObject
        )
      );
      var manager = (IWinkGoAudioSessionManager2)managerObject;
      Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));

      int count;
      Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
      for (var index = 0; index < count; index++) {
        IWinkGoAudioSessionControl control = null;
        try {
          if (sessions.GetSession(index, out control) != 0 || control == null) {
            continue;
          }
          var control2 = (IWinkGoAudioSessionControl2)control;
          uint processId;
          if (control2.GetProcessId(out processId) != 0 || processId == 0) {
            continue;
          }
          string actualProcessName;
          try {
            actualProcessName =
              System.Diagnostics.Process.GetProcessById((int)processId).ProcessName;
          } catch {
            continue;
          }
          if (!actualProcessName.Equals(processName, StringComparison.OrdinalIgnoreCase)) {
            continue;
          }

          float peak;
          if (((IWinkGoAudioMeterInformation)control).GetPeakValue(out peak) == 0) {
            maximumPeak = Math.Max(maximumPeak, peak);
          }
        } finally {
          if (control != null) {
            Marshal.ReleaseComObject(control);
          }
        }
      }
      return maximumPeak;
    } finally {
      if (sessions != null) {
        Marshal.ReleaseComObject(sessions);
      }
      if (managerObject != null) {
        Marshal.ReleaseComObject(managerObject);
      }
      if (device != null) {
        Marshal.ReleaseComObject(device);
      }
    }
  }
}
'@

$script:asTaskMethod = (
  [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    }
)[0]

function Wait-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)] $Operation,
    [Parameter(Mandatory = $true)] [Type] $ResultType,
    [int] $TimeoutMilliseconds = 6000
  )

  $method = $script:asTaskMethod.MakeGenericMethod($ResultType)
  $task = $method.Invoke($null, @($Operation))
  if (-not $task.Wait($TimeoutMilliseconds)) {
    throw 'WINRT_OPERATION_TIMEOUT'
  }
  return $task.Result
}

function Write-BridgeEvent {
  param([Parameter(Mandatory = $true)] $Payload)

  $json = $Payload | ConvertTo-Json -Compress -Depth 8
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Write-CommandResult {
  param(
    [string] $RequestId,
    [bool] $Ok,
    $Data = $null,
    [string] $ErrorMessage = ''
  )

  if ([string]::IsNullOrWhiteSpace($RequestId)) {
    return
  }
  Write-BridgeEvent @{
    type = 'command-result'
    requestId = $RequestId
    ok = $Ok
    data = $Data
    error = $ErrorMessage
  }
}

function Get-UnixMilliseconds {
  return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Copy-OrderedDictionary {
  param([Parameter(Mandatory = $true)] $Source)

  $copy = [ordered]@{}
  foreach ($entry in $Source.GetEnumerator()) {
    $copy[$entry.Key] = $entry.Value
  }
  return $copy
}

function Close-WinRtResource {
  param($Resource)

  if ($null -eq $Resource) {
    return
  }
  try {
    if ($Resource -is [System.IDisposable]) {
      $Resource.Dispose()
      return
    }
  } catch {
    return
  }
  try {
    if ($null -ne $Resource.PSObject.Methods['Close']) {
      $Resource.Close()
    }
  } catch {
    # Some WinRT projections expose neither IDisposable nor Close to
    # PowerShell. Let the runtime release those COM wrappers safely.
  }
}

function Limit-Text {
  param(
    [AllowNull()] [string] $Value,
    [int] $MaximumLength
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }
  $trimmed = $Value.Trim()
  if ($trimmed.Length -le $MaximumLength) {
    return $trimmed
  }
  return $trimmed.Substring(0, $MaximumLength)
}

$script:mediaEnabled = $false
$script:mediaTarget = 'system'
$script:notificationEnabled = $false
$script:mediaManager = $null
$script:lastMediaJson = ''
$script:lastTrackKey = ''
$script:lastCoverUrl = ''
$script:mediaAppIconCache = @{}
$script:mediaMetadataCoverCache = @{}
$script:lastDedicatedMusicAudioActiveAt = @{}
$script:lastSyntheticMusicAudioActiveAt = [DateTime]::MinValue
$script:lastMediaManagerRefreshAt = [DateTime]::MinValue
$script:nextCoverRetryAt = [DateTime]::UtcNow
$script:nextPlaybackPollAt = [DateTime]::UtcNow
$script:nextMediaPollAt = [DateTime]::UtcNow
$script:mediaTransitionPollUntil = [DateTime]::MinValue
$script:nextNotificationPollAt = [DateTime]::UtcNow
$script:listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
$script:notificationAccess = [string]$script:listener.GetAccessStatus()
$script:notificationCaptureStartedAt = Get-UnixMilliseconds
$script:seenNotificationKeys = [System.Collections.Generic.HashSet[string]]::new()
$script:seenNotificationOrder = [System.Collections.Generic.Queue[string]]::new()
$script:latestMedia = $null
$script:latestNotification = $null
$script:activeMediaSession = $null

function Get-MediaManager {
  if ($null -ne $script:mediaManager) {
    return $script:mediaManager
  }

  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $script:mediaManager = Wait-WinRtOperation (
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  ) $managerType
  return $script:mediaManager
}

function Test-DedicatedMusicApp {
  param([string] $AppId)

  if ([string]::IsNullOrWhiteSpace($AppId)) {
    return $false
  }

  $normalizedAppId = $AppId.ToLowerInvariant()
  $musicAppMarkers = @(
    'cloudmusic',
    'netease',
    'neteasemusic',
    'music.163',
    'com.netease',
    '网易云',
    'qqmusic',
    'qq music',
    'tencent.qqmusic',
    'com.tencent.qqmusic',
    'qq音乐',
    'kugou',
    'kugoumusic',
    '酷狗',
    'kuwo',
    'kuwomusic',
    '酷我',
    'spotify',
    'applemusic',
    'apple music',
    'itunes',
    'lx-music',
    'lxmusic',
    'musicbee',
    'foobar2000',
    'aimp',
    'winamp',
    'soda',
    'sodamusic',
    'luna.music',
    'lunamusic',
    'bytedance.music',
    'com.bytedance.music',
    'qishui',
    '汽水',
    'migu',
    '咪咕',
    'qianqian',
    '千千',
    'echomusic',
    'echo music',
    '洛雪'
  )

  foreach ($marker in $musicAppMarkers) {
    if ($normalizedAppId.Contains($marker)) {
      return $true
    }
  }
  return $false
}

function Test-MediaTargetMatch {
  param(
    [string] $AppId,
    [string] $Target
  )

  $normalizedTarget = if ([string]::IsNullOrWhiteSpace($Target)) { 'system' } else { $Target.ToLowerInvariant() }
  if ($normalizedTarget -eq 'system') {
    return $true
  }
  $normalizedAppId = $AppId.ToLowerInvariant()
  $targetMarkers = @{
    netease = @('cloudmusic', 'netease', 'music.163', 'com.netease', '网易云')
    spotify = @('spotify')
    apple = @('applemusic', 'apple music', 'itunes', 'appleinc.applemusic')
    qqmusic = @('qqmusic', 'qq music', 'tencent.qqmusic', 'com.tencent.qqmusic', 'qq音乐')
    kugou = @('kugou', '酷狗')
    echo = @('echomusic', 'echo music')
    'lx-music' = @('lx-music', 'lxmusic', 'lx music', '洛雪')
  }
  if (-not $targetMarkers.ContainsKey($normalizedTarget)) {
    return $true
  }
  foreach ($marker in @($targetMarkers[$normalizedTarget])) {
    if ($normalizedAppId.Contains([string]$marker)) {
      return $true
    }
  }
  return $false
}

function Test-AnyDedicatedMusicProcessRunning {
  foreach ($processName in @(
    'cloudmusic',
    'QQMusic',
    'SodaMusic',
    'KuGou',
    'KuGouMusic',
    'KwMusic',
    'KuwoMusic',
    'Spotify',
    'AppleMusic',
    'iTunes',
    'lx-music-desktop',
    'lx-music',
    'MusicBee',
    'foobar2000',
    'AIMP',
    'winamp',
    'MIGUMUSIC',
    'MiguMusic',
    'TTPlayer',
    'QianQianMusic',
    'EchoMusic'
  )) {
    if ($null -ne (Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      return $true
    }
  }
  return $false
}

function Get-BestMediaSession {
  param([bool]$AllowManagerRefresh = $true)

  $manager = Get-MediaManager
  $sessions = @($manager.GetSessions())
  if ($sessions.Count -eq 0) {
    $script:mediaManager = $null
    return $null
  }

  $currentAppId = ''
  try {
    $current = $manager.GetCurrentSession()
    if ($null -ne $current) {
      $currentAppId = [string]$current.SourceAppUserModelId
    }
  } catch {
    $currentAppId = ''
  }

  $bestSession = $null
  $bestScore = -1
  $hasDedicatedMusicSession = $false
  foreach ($session in $sessions) {
    $score = 0
    $appId = [string]$session.SourceAppUserModelId
    if (-not (Test-MediaTargetMatch $appId $script:mediaTarget)) {
      continue
    }
    $reportedPlaying = $false
    $isPlaying = $false
    $isPaused = $false
    try {
      $status = [string]$session.GetPlaybackInfo().PlaybackStatus
      $reportedPlaying = $status -eq 'Playing'
      $isPaused = $status -eq 'Paused'
      $isPlaying = Resolve-MediaPlayingState $appId $reportedPlaying
    } catch {
      $reportedPlaying = $false
      $isPlaying = $false
      $isPaused = $false
    }

    $isDedicatedMusicApp = Test-DedicatedMusicApp $appId
    $hasDedicatedMusicSession = $hasDedicatedMusicSession -or $isDedicatedMusicApp
    if ($isPlaying) {
      # A real, audible music player must beat stale browser/video sessions.
      # Windows often keeps Bilibili or a browser tab as the "current" SMTC
      # session after NetEase/QQ Music starts playing.
      $score += $(if ($isDedicatedMusicApp) { 1200 } else { 600 })
    } elseif ($isPaused) {
      $score += $(if ($isDedicatedMusicApp) { 80 } else { 30 })
    }

    # A dedicated player may report Paused for a short time while its Core
    # Audio stream is already active. Resolve-MediaPlayingState promotes that
    # session above browsers/video apps, but never promotes an idle process.
    if ($isDedicatedMusicApp) {
      $score += 100
    }

    # Current-session status is only a tie-breaker; it must never override an
    # actively playing dedicated music application.
    if (-not [string]::IsNullOrWhiteSpace($currentAppId) -and $appId -eq $currentAppId) {
      $score += 20
    }
    if ($score -gt $bestScore) {
      $bestScore = $score
      $bestSession = $session
    }
  }

  # Windows occasionally keeps a manager created before an Electron music
  # player registered SMTC. If only a browser/video session is visible while
  # a supported player process exists, recreate the manager at a bounded rate.
  # This is intentionally throttled so an idle player does not add UI load.
  if (
    $AllowManagerRefresh -and
    -not $hasDedicatedMusicSession -and
    (Test-AnyDedicatedMusicProcessRunning) -and
    ([DateTime]::UtcNow - $script:lastMediaManagerRefreshAt).TotalSeconds -ge 5
  ) {
    $script:lastMediaManagerRefreshAt = [DateTime]::UtcNow
    $script:mediaManager = $null
    return Get-BestMediaSession $false
  }
  return $bestSession
}

function Resolve-MediaPlayingState {
  param(
    [string] $AppId,
    [bool] $ReportedPlaying
  )

  $normalizedAppId = $AppId.ToLowerInvariant()
  if (-not (Test-DedicatedMusicApp $AppId)) {
    return $ReportedPlaying
  }

  try {
    # Some NetEase/Soda/QQ Music builds publish SMTC state late or keep a
    # stale state after pause. Core Audio is used as a short, process-scoped
    # correction so professional music players beat browser/video sessions.
    $peak = 0.0
    foreach ($processName in @(Get-MediaProcessCandidates $AppId)) {
      $peak = [Math]::Max(
        $peak,
        [double][WinkGoAudioActivityProbe]::ReadProcessPeak([string]$processName)
      )
    }
    $now = [DateTime]::UtcNow
    if ($peak -gt 0.0008) {
      $script:lastDedicatedMusicAudioActiveAt[$normalizedAppId] = $now
      return $true
    }
    if (
      $script:lastDedicatedMusicAudioActiveAt.ContainsKey($normalizedAppId) -and
      ($now - [DateTime]$script:lastDedicatedMusicAudioActiveAt[$normalizedAppId]).TotalMilliseconds -lt 850
    ) {
      return $true
    }

    # NetEase 3.x is known to remain "Playing" indefinitely after pause, so
    # its audio state is authoritative. Other players usually publish a valid
    # SMTC state; keep that value when their audio meter is temporarily quiet.
    if ($normalizedAppId.Contains('cloudmusic') -or $normalizedAppId.Contains('netease')) {
      return $false
    }
    return $ReportedPlaying
  } catch {
    return $ReportedPlaying
  }
}

function Read-MediaCoverDataUrl {
  param($Properties)

  $reader = $null
  $stream = $null
  try {
    $thumbnail = $Properties.Thumbnail
    if ($null -eq $thumbnail) {
      return ''
    }
    $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
    # NetEase Cloud Music often publishes the title before its thumbnail
    # stream is ready. Metadata is still emitted first; artwork is retried on
    # a bounded interval below, so this slightly larger timeout does not stall
    # every media poll.
    $stream = Wait-WinRtOperation ($thumbnail.OpenReadAsync()) $streamType 1800
    if ($null -eq $stream -or $stream.Size -le 0 -or $stream.Size -gt 1572864) {
      return ''
    }
    $inputStream = $stream.GetInputStreamAt(0)
    $reader = [Windows.Storage.Streams.DataReader]::new($inputStream)
    $loaded = Wait-WinRtOperation ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) 1800
    if ($loaded -le 0) {
      return ''
    }
    $bytes = [byte[]]::new([int]$loaded)
    $reader.ReadBytes($bytes)
    $contentType = [string]$stream.ContentType
    if ([string]::IsNullOrWhiteSpace($contentType)) {
      $contentType = 'image/jpeg'
    }
    return "data:$contentType;base64,$([Convert]::ToBase64String($bytes))"
  } catch {
    return ''
  } finally {
    Close-WinRtResource $reader
    Close-WinRtResource $stream
  }
}

function Get-MediaProcessCandidates {
  param([string] $AppId)

  $normalizedAppId = $AppId.ToLowerInvariant()
  $groups = @(
    @{ markers = @('cloudmusic', 'netease', 'neteasemusic', 'music.163', 'com.netease', '网易云'); processes = @('cloudmusic') },
    @{ markers = @('qqmusic', 'qq music', 'tencent.qqmusic', 'com.tencent.qqmusic', 'qq音乐'); processes = @('QQMusic') },
    @{ markers = @('sodamusic', 'soda music', 'soda', 'luna.music', 'lunamusic', 'bytedance.music', 'com.bytedance.music', 'qishui', '汽水'); processes = @('SodaMusic') },
    @{ markers = @('kugou', '酷狗'); processes = @('KuGou', 'KuGouMusic') },
    @{ markers = @('kuwo', '酷我'); processes = @('KwMusic', 'KuwoMusic') },
    @{ markers = @('spotify'); processes = @('Spotify') },
    @{ markers = @('applemusic', 'apple music'); processes = @('AppleMusic') },
    @{ markers = @('itunes'); processes = @('iTunes') },
    @{ markers = @('lx-music', 'lxmusic', '洛雪'); processes = @('lx-music-desktop', 'lx-music') },
    @{ markers = @('musicbee'); processes = @('MusicBee') },
    @{ markers = @('foobar'); processes = @('foobar2000') },
    @{ markers = @('aimp'); processes = @('AIMP') },
    @{ markers = @('winamp'); processes = @('winamp') },
    @{ markers = @('migu', '咪咕'); processes = @('MIGUMUSIC', 'MiguMusic') },
    @{ markers = @('qianqian', '千千'); processes = @('TTPlayer', 'QianQianMusic') },
    @{ markers = @('echomusic', 'echo music'); processes = @('EchoMusic') },
    @{ markers = @('com.bilibili', 'bilibili', '哔哩哔哩'); processes = @('bilibili', 'bilibiliPC') },
    @{ markers = @('qqlive', '腾讯视频'); processes = @('QQLive') },
    @{ markers = @('msedge'); processes = @('msedge') },
    @{ markers = @('chrome'); processes = @('chrome') },
    @{ markers = @('firefox'); processes = @('firefox') }
  )

  $candidates = [System.Collections.Generic.List[string]]::new()
  foreach ($group in $groups) {
    $matches = $false
    foreach ($marker in $group.markers) {
      if ($normalizedAppId.Contains([string]$marker)) {
        $matches = $true
        break
      }
    }
    if ($matches) {
      foreach ($processName in $group.processes) {
        if (-not $candidates.Contains([string]$processName)) {
          $candidates.Add([string]$processName)
        }
      }
    }
  }

  $fileName = [System.IO.Path]::GetFileNameWithoutExtension($AppId)
  if (
    -not [string]::IsNullOrWhiteSpace($fileName) -and
    $fileName -match '^[\p{L}\p{N}_.-]+$' -and
    -not $candidates.Contains($fileName)
  ) {
    $candidates.Add($fileName)
  }
  return @($candidates)
}

function Test-WinkGoBitmapHasVisibleContent {
  param([System.Drawing.Bitmap] $Bitmap)

  if ($null -eq $Bitmap -or $Bitmap.Width -le 0 -or $Bitmap.Height -le 0) {
    return $false
  }

  $stepX = [Math]::Max(1, [int][Math]::Floor($Bitmap.Width / 16.0))
  $stepY = [Math]::Max(1, [int][Math]::Floor($Bitmap.Height / 16.0))
  $sampleCount = 0
  $visibleCount = 0
  $minimumLuma = 255.0
  $maximumLuma = 0.0
  for ($y = 0; $y -lt $Bitmap.Height; $y += $stepY) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += $stepX) {
      $pixel = $Bitmap.GetPixel($x, $y)
      $sampleCount += 1
      if ($pixel.A -lt 24) {
        continue
      }
      $visibleCount += 1
      $luma = (0.2126 * $pixel.R) + (0.7152 * $pixel.G) + (0.0722 * $pixel.B)
      $minimumLuma = [Math]::Min($minimumLuma, $luma)
      $maximumLuma = [Math]::Max($maximumLuma, $luma)
    }
  }

  if ($sampleCount -le 0 -or $visibleCount -lt 2) {
    return $false
  }
  $visibleCoverage = $visibleCount / [double]$sampleCount
  if ($visibleCoverage -lt 0.98) {
    return $true
  }
  return ($maximumLuma - $minimumLuma) -ge 8.0
}

function Read-ProcessIconDataUrl {
  param([string[]] $ProcessNames)

  foreach ($processName in $ProcessNames) {
    $processes = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
      $icon = $null
      $bitmap = $null
      $memory = $null
      try {
        $executablePath = [string]$process.Path
        if ([string]::IsNullOrWhiteSpace($executablePath) -or -not [System.IO.File]::Exists($executablePath)) {
          continue
        }
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($executablePath)
        if ($null -eq $icon) {
          continue
        }
        $bitmap = $icon.ToBitmap()
        if (-not (Test-WinkGoBitmapHasVisibleContent $bitmap)) {
          continue
        }
        $memory = [System.IO.MemoryStream]::new()
        $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $memory.ToArray()
        if ($bytes.Length -le 128 -or $bytes.Length -gt 524288) {
          continue
        }
        return "data:image/png;base64,$([Convert]::ToBase64String($bytes))"
      } catch {
        continue
      } finally {
        if ($null -ne $memory) { $memory.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        if ($null -ne $icon) { $icon.Dispose() }
      }
    }
  }
  return ''
}

function Read-MediaAppIconDataUrl {
  param([string] $AppId)

  if ([string]::IsNullOrWhiteSpace($AppId)) {
    return ''
  }
  if ($script:mediaAppIconCache.ContainsKey($AppId)) {
    $cached = $script:mediaAppIconCache[$AppId]
    if ($cached -is [hashtable]) {
      if ([DateTime]::UtcNow -lt [DateTime]$cached.expiresAt) {
        return [string]$cached.iconUrl
      }
      $script:mediaAppIconCache.Remove($AppId)
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$cached)) {
      return [string]$cached
    } else {
      $script:mediaAppIconCache.Remove($AppId)
    }
  }

  $iconUrl = Read-ProcessIconDataUrl (Get-MediaProcessCandidates $AppId)
  # Never cache an early miss for the lifetime of the bridge. Electron music
  # players often publish SMTC before the process path/icon becomes readable.
  $script:mediaAppIconCache[$AppId] = @{
    iconUrl = $iconUrl
    expiresAt = [DateTime]::UtcNow.AddSeconds(
      $(if ([string]::IsNullOrWhiteSpace($iconUrl)) { 5 } else { 43200 })
    )
  }
  return $iconUrl
}

function Normalize-MediaLookupText {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $normalized = $Value.Trim()
  $normalized = [Regex]::Replace(
    $normalized,
    '[（(][^）)]*(?:cover|翻唱|remix|live|伴奏)[^）)]*[）)]',
    '',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  $normalized = [Regex]::Replace(
    $normalized,
    '\s*[-–—]\s*(?:live|remix|伴奏).*$',
    '',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  # Player titles frequently append uploader/version labels in one or more
  # parenthetical groups. They are useful in the UI, but make cross-player
  # artwork matching unnecessarily brittle.
  while ($normalized -match '\s*[（(][^）)]{1,48}[）)]\s*$') {
    $normalized = [Regex]::Replace($normalized, '\s*[（(][^）)]{1,48}[）)]\s*$', '')
  }
  return $normalized.Trim()
}

function Get-MediaLookupScore {
  param(
    $Song,
    [string]$Title,
    [string]$Artist
  )

  $candidateTitle = Normalize-MediaLookupText ([string]$Song.name)
  $requestedTitle = Normalize-MediaLookupText $Title
  if ([string]::IsNullOrWhiteSpace($candidateTitle) -or [string]::IsNullOrWhiteSpace($requestedTitle)) {
    return 0
  }

  $score = 0
  if ($candidateTitle.Equals($requestedTitle, [StringComparison]::OrdinalIgnoreCase)) {
    $score += 120
  } elseif (
    $candidateTitle.IndexOf($requestedTitle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $requestedTitle.IndexOf($candidateTitle, [StringComparison]::OrdinalIgnoreCase) -ge 0
  ) {
    $score += 55
  } else {
    return 0
  }

  $requestedArtist = (Normalize-MediaLookupText $Artist).Replace(' ', '')
  if (-not [string]::IsNullOrWhiteSpace($requestedArtist)) {
    $candidateArtists = @(
      $Song.artists |
        ForEach-Object { (Normalize-MediaLookupText ([string]$_.name)).Replace(' ', '') }
    )
    foreach ($candidateArtist in $candidateArtists) {
      if ($candidateArtist.Equals($requestedArtist, [StringComparison]::OrdinalIgnoreCase)) {
        $score += 80
        break
      }
      if (
        $candidateArtist.IndexOf($requestedArtist, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $requestedArtist.IndexOf($candidateArtist, [StringComparison]::OrdinalIgnoreCase) -ge 0
      ) {
        $score += 35
        break
      }
    }
  }
  return $score
}

function Read-MusicMetadataCoverDataUrl {
  param(
    [string]$AppId,
    [string]$Title,
    [string]$Artist
  )

  if (
    -not (Test-DedicatedMusicApp $AppId) -or
    [string]::IsNullOrWhiteSpace($Title)
  ) {
    return ''
  }

  $searchTitle = Normalize-MediaLookupText $Title
  $searchArtist = Normalize-MediaLookupText $Artist
  $cacheKey = "$($AppId.ToLowerInvariant())|$($searchTitle.ToLowerInvariant())|$($searchArtist.ToLowerInvariant())"
  if ($script:mediaMetadataCoverCache.ContainsKey($cacheKey)) {
    $cached = $script:mediaMetadataCoverCache[$cacheKey]
    if ([DateTime]::UtcNow -lt $cached.expiresAt) {
      return [string]$cached.coverUrl
    }
    $script:mediaMetadataCoverCache.Remove($cacheKey)
  }

  $coverDataUrl = ''
  try {
    $headers = @{
      'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WINK-GO/1.0'
      'Referer' = 'https://music.163.com/'
    }
    $query = [Uri]::EscapeDataString("$searchTitle $searchArtist")
    $searchUri = "https://music.163.com/api/search/get/web?csrf_token=&s=$query&type=1&offset=0&total=true&limit=20"
    $search = Invoke-RestMethod -Uri $searchUri -Headers $headers -TimeoutSec 4
    $songs = @($search.result.songs)
    if ($songs.Count -eq 0) {
      return ''
    }

    $bestScore = 0
    $song = $null
    foreach ($candidate in $songs) {
      $candidateScore = Get-MediaLookupScore $candidate $searchTitle $searchArtist
      if ($candidateScore -gt $bestScore) {
        $bestScore = $candidateScore
        $song = $candidate
      }
    }
    if ($null -eq $song -or $bestScore -lt 100) {
      return ''
    }

    $detailPayload = [Uri]::EscapeDataString("[{`"id`":$([long]$song.id)}]")
    $detailUri = "https://music.163.com/api/v3/song/detail?c=$detailPayload"
    $detail = Invoke-RestMethod -Uri $detailUri -Headers $headers -TimeoutSec 4
    $coverUri = [string]$detail.songs[0].al.picUrl
    if ([string]::IsNullOrWhiteSpace($coverUri)) {
      return ''
    }
    $webClient = [System.Net.WebClient]::new()
    try {
      foreach ($headerName in $headers.Keys) {
        $webClient.Headers[$headerName] = [string]$headers[$headerName]
      }
      $coverBytes = $webClient.DownloadData("${coverUri}?param=160y160")
    } finally {
      $webClient.Dispose()
    }
    if ($null -eq $coverBytes -or $coverBytes.Length -le 128 -or $coverBytes.Length -gt 1048576) {
      return ''
    }
    $coverDataUrl = "data:image/jpeg;base64,$([Convert]::ToBase64String([byte[]]$coverBytes))"
    return $coverDataUrl
  } catch {
    return ''
  } finally {
    # A failed lookup is usually a race with newly published metadata. Retry
    # quickly instead of leaving the island without artwork for 90 seconds.
    $ttl = if ([string]::IsNullOrWhiteSpace($coverDataUrl)) { 6 } else { 43200 }
    $script:mediaMetadataCoverCache[$cacheKey] = @{
      coverUrl = $coverDataUrl
      expiresAt = [DateTime]::UtcNow.AddSeconds($ttl)
    }
  }
}

function Read-SodaQueueCoverDataUrl {
  param(
    [string]$AppId,
    [string]$Title,
    [string]$Artist
  )

  $normalizedAppId = $AppId.ToLowerInvariant()
  if (
    -not (
      $normalizedAppId.Contains('sodamusic') -or
      $normalizedAppId.Contains('soda music') -or
      $normalizedAppId.Contains('luna.music') -or
      $normalizedAppId.Contains('lunamusic') -or
      $normalizedAppId.Contains('bytedance.music') -or
      $normalizedAppId.Contains('com.bytedance.music') -or
      $normalizedAppId.Contains('qishui') -or
      $normalizedAppId.Contains('汽水')
    ) -or
    [string]::IsNullOrWhiteSpace($Title)
  ) {
    return ''
  }

  $searchTitle = Normalize-MediaLookupText $Title
  $searchArtist = Normalize-MediaLookupText $Artist
  $cacheKey = "soda|$($searchTitle.ToLowerInvariant())|$($searchArtist.ToLowerInvariant())"
  if ($script:mediaMetadataCoverCache.ContainsKey($cacheKey)) {
    $cached = $script:mediaMetadataCoverCache[$cacheKey]
    if ([DateTime]::UtcNow -lt $cached.expiresAt) {
      return [string]$cached.coverUrl
    }
    $script:mediaMetadataCoverCache.Remove($cacheKey)
  }

  $coverDataUrl = ''
  $fileStream = $null
  $gzipStream = $null
  $reader = $null
  $webClient = $null
  try {
    $queuePath = Join-Path $env:APPDATA 'SodaMusic\LunaStorage\QueueCache'
    if (-not (Test-Path -LiteralPath $queuePath -PathType Leaf)) {
      return ''
    }

    $fileStream = [IO.File]::Open(
      $queuePath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::ReadWrite
    )
    $signature = New-Object byte[] 4
    if ($fileStream.Read($signature, 0, 4) -ne 4) {
      return ''
    }
    if ([Text.Encoding]::ASCII.GetString($signature) -ne 'LUNA') {
      return ''
    }

    $gzipStream = New-Object IO.Compression.GZipStream(
      $fileStream,
      [IO.Compression.CompressionMode]::Decompress
    )
    $reader = New-Object IO.StreamReader($gzipStream, [Text.Encoding]::UTF8)
    $queue = $reader.ReadToEnd() | ConvertFrom-Json

    $bestScore = 0
    $bestSavedAt = 0
    $bestTrack = $null
    foreach ($queueProperty in $queue.PSObject.Properties) {
      $queueValue = $queueProperty.Value
      $lastPlayedKey = [string]$queueValue.lastPlayedKey
      $savedAt = [long]$queueValue.savedAt
      foreach ($playable in @($queueValue.playables)) {
        $track = $playable.track
        if ($null -eq $track) {
          continue
        }
        $candidateTitle = Normalize-MediaLookupText ([string]$track.name)
        if (-not $candidateTitle.Equals($searchTitle, [StringComparison]::OrdinalIgnoreCase)) {
          continue
        }

        $score = 120
        $candidateArtists = @(
          $track.artists |
            ForEach-Object { (Normalize-MediaLookupText ([string]$_.name)).Replace(' ', '') }
        )
        $requestedArtist = $searchArtist.Replace(' ', '')
        if (-not [string]::IsNullOrWhiteSpace($requestedArtist)) {
          foreach ($candidateArtist in $candidateArtists) {
            if ($candidateArtist.Equals($requestedArtist, [StringComparison]::OrdinalIgnoreCase)) {
              $score += 80
              break
            }
            if (
              $candidateArtist.IndexOf($requestedArtist, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
              $requestedArtist.IndexOf($candidateArtist, [StringComparison]::OrdinalIgnoreCase) -ge 0
            ) {
              $score += 35
              break
            }
          }
        }
        if ([string]$playable.key -eq $lastPlayedKey) {
          $score += 30
        }
        if ($score -gt $bestScore -or ($score -eq $bestScore -and $savedAt -gt $bestSavedAt)) {
          $bestScore = $score
          $bestSavedAt = $savedAt
          $bestTrack = $track
        }
      }
    }

    if ($null -eq $bestTrack -or $bestScore -lt 120) {
      return ''
    }
    $cover = $bestTrack.album.url_cover
    $coverUri = [string]$cover.uri
    $coverPrefix = [string]$cover.template_prefix
    $coverBase = [string]@($cover.urls)[0]
    if (
      [string]::IsNullOrWhiteSpace($coverUri) -or
      [string]::IsNullOrWhiteSpace($coverPrefix) -or
      [string]::IsNullOrWhiteSpace($coverBase)
    ) {
      return ''
    }

    $coverUrl = "$coverBase$coverUri~$coverPrefix-resize:200:200.image"
    $webClient = New-Object System.Net.WebClient
    $webClient.Headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WINK-GO/1.0'
    $webClient.Headers['Referer'] = 'https://qishui.douyin.com/'
    $coverBytes = $webClient.DownloadData($coverUrl)
    if ($null -eq $coverBytes -or $coverBytes.Length -le 128 -or $coverBytes.Length -gt 1048576) {
      return ''
    }
    $mimeType = if ($coverBytes[0] -eq 0x89 -and $coverBytes[1] -eq 0x50) {
      'image/png'
    } else {
      'image/jpeg'
    }
    $coverDataUrl = "data:$mimeType;base64,$([Convert]::ToBase64String([byte[]]$coverBytes))"
    return $coverDataUrl
  } catch {
    return ''
  } finally {
    if ($null -ne $webClient) {
      $webClient.Dispose()
    }
    if ($null -ne $reader) {
      $reader.Dispose()
    }
    if ($null -ne $gzipStream) {
      $gzipStream.Dispose()
    }
    if ($null -ne $fileStream) {
      $fileStream.Dispose()
    }
    $ttl = if ([string]::IsNullOrWhiteSpace($coverDataUrl)) { 6 } else { 43200 }
    $script:mediaMetadataCoverCache[$cacheKey] = @{
      coverUrl = $coverDataUrl
      expiresAt = [DateTime]::UtcNow.AddSeconds($ttl)
    }
  }
}

function Read-SodaWindowCoverDataUrl {
  param([string]$AppId)

  $normalizedAppId = $AppId.ToLowerInvariant()
  if (
    -not (
      $normalizedAppId.Contains('sodamusic') -or
      $normalizedAppId.Contains('soda music') -or
      $normalizedAppId.Contains('luna.music') -or
      $normalizedAppId.Contains('lunamusic') -or
      $normalizedAppId.Contains('bytedance.music') -or
      $normalizedAppId.Contains('com.bytedance.music') -or
      $normalizedAppId.Contains('qishui') -or
      $normalizedAppId.Contains('汽水')
    )
  ) {
    return ''
  }

  $fullBitmap = $null
  $fullGraphics = $null
  $coverBitmap = $null
  $coverGraphics = $null
  $memory = $null
  try {
    $processIds = @(
      Get-MediaProcessCandidates $AppId |
        ForEach-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue } |
        ForEach-Object { [int]$_.Id }
    )
    $window = [WinkGoWindowCaptureNative]::FindLargestWindow([int[]]$processIds)
    if ($window -eq [IntPtr]::Zero) {
      return ''
    }

    $rect = New-Object WinkGoWindowCaptureNative+Rect
    if (-not [WinkGoWindowCaptureNative]::GetWindowRect($window, [ref]$rect)) {
      return ''
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $coverSize = [int][Math]::Round([Math]::Min($width * 0.265, $height * 0.405))
    $coverX = [int][Math]::Round($width * 0.286)
    $coverY = [int][Math]::Round($height * 0.18)
    if (
      $coverSize -lt 96 -or
      $coverX -lt 0 -or
      $coverY -lt 0 -or
      $coverX + $coverSize -gt $width -or
      $coverY + $coverSize -gt $height
    ) {
      return ''
    }

    $fullBitmap = [System.Drawing.Bitmap]::new(
      $width,
      $height,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $fullGraphics = [System.Drawing.Graphics]::FromImage($fullBitmap)
    $deviceContext = $fullGraphics.GetHdc()
    try {
      if (-not [WinkGoWindowCaptureNative]::PrintWindow($window, $deviceContext, 2)) {
        return ''
      }
    } finally {
      $fullGraphics.ReleaseHdc($deviceContext)
    }

    $coverBitmap = [System.Drawing.Bitmap]::new(
      192,
      192,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $coverGraphics = [System.Drawing.Graphics]::FromImage($coverBitmap)
    $coverGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $coverGraphics.DrawImage(
      $fullBitmap,
      [System.Drawing.Rectangle]::new(0, 0, 192, 192),
      [System.Drawing.Rectangle]::new($coverX, $coverY, $coverSize, $coverSize),
      [System.Drawing.GraphicsUnit]::Pixel
    )

    $minimumLuma = 255
    $maximumLuma = 0
    for ($sampleY = 8; $sampleY -lt 192; $sampleY += 24) {
      for ($sampleX = 8; $sampleX -lt 192; $sampleX += 24) {
        $pixel = $coverBitmap.GetPixel($sampleX, $sampleY)
        $luma = [int](($pixel.R + $pixel.G + $pixel.B) / 3)
        $minimumLuma = [Math]::Min($minimumLuma, $luma)
        $maximumLuma = [Math]::Max($maximumLuma, $luma)
      }
    }
    if ($maximumLuma - $minimumLuma -lt 12) {
      return ''
    }

    $memory = [System.IO.MemoryStream]::new()
    $coverBitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bytes = $memory.ToArray()
    if ($bytes.Length -le 256 -or $bytes.Length -gt 1048576) {
      return ''
    }
    return "data:image/jpeg;base64,$([Convert]::ToBase64String($bytes))"
  } catch {
    return ''
  } finally {
    if ($null -ne $memory) { $memory.Dispose() }
    if ($null -ne $coverGraphics) { $coverGraphics.Dispose() }
    if ($null -ne $coverBitmap) { $coverBitmap.Dispose() }
    if ($null -ne $fullGraphics) { $fullGraphics.Dispose() }
    if ($null -ne $fullBitmap) { $fullBitmap.Dispose() }
  }
}

function Read-NetEaseWindowCoverDataUrl {
  param([string]$AppId)

  $normalizedAppId = $AppId.ToLowerInvariant()
  if (
    -not (
      $normalizedAppId.Contains('cloudmusic') -or
      $normalizedAppId.Contains('netease') -or
      $normalizedAppId.Contains('music.163') -or
      $normalizedAppId.Contains('com.netease')
    )
  ) {
    return ''
  }

  $fullBitmap = $null
  $fullGraphics = $null
  $coverBitmap = $null
  $coverGraphics = $null
  $memory = $null
  try {
    $processIds = @(
      Get-Process -Name 'cloudmusic' -ErrorAction SilentlyContinue |
        ForEach-Object { [int]$_.Id }
    )
    $window = [WinkGoWindowCaptureNative]::FindLargestWindow([int[]]$processIds)
    if ($window -eq [IntPtr]::Zero) {
      return ''
    }

    $rect = New-Object WinkGoWindowCaptureNative+Rect
    if (-not [WinkGoWindowCaptureNative]::GetWindowRect($window, [ref]$rect)) {
      return ''
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $scale = [Math]::Max(0.8, [Math]::Min(2.0, (($width / 1101.0) + ($height / 752.0)) * 0.5))
    $coverSize = [int][Math]::Round(62.0 * $scale)
    $coverX = [int][Math]::Round(29.0 * $scale)
    $coverY = $height - [int][Math]::Round(70.0 * $scale)
    if ($coverX -lt 0 -or $coverY -lt 0 -or $coverX + $coverSize -gt $width -or $coverY + $coverSize -gt $height) {
      return ''
    }

    $fullBitmap = [System.Drawing.Bitmap]::new(
      $width,
      $height,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $fullGraphics = [System.Drawing.Graphics]::FromImage($fullBitmap)
    $deviceContext = $fullGraphics.GetHdc()
    try {
      if (-not [WinkGoWindowCaptureNative]::PrintWindow($window, $deviceContext, 2)) {
        return ''
      }
    } finally {
      $fullGraphics.ReleaseHdc($deviceContext)
    }

    $coverBitmap = [System.Drawing.Bitmap]::new(
      $coverSize,
      $coverSize,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $coverGraphics = [System.Drawing.Graphics]::FromImage($coverBitmap)
    $coverGraphics.DrawImage(
      $fullBitmap,
      [System.Drawing.Rectangle]::new(0, 0, $coverSize, $coverSize),
      [System.Drawing.Rectangle]::new($coverX, $coverY, $coverSize, $coverSize),
      [System.Drawing.GraphicsUnit]::Pixel
    )
    $minimumLuma = 255
    $maximumLuma = 0
    $sampleStep = [Math]::Max(1, [int]($coverSize / 8))
    for ($sampleY = 0; $sampleY -lt $coverSize; $sampleY += $sampleStep) {
      for ($sampleX = 0; $sampleX -lt $coverSize; $sampleX += $sampleStep) {
        $pixel = $coverBitmap.GetPixel($sampleX, $sampleY)
        $luma = [int](($pixel.R + $pixel.G + $pixel.B) / 3)
        $minimumLuma = [Math]::Min($minimumLuma, $luma)
        $maximumLuma = [Math]::Max($maximumLuma, $luma)
      }
    }
    if ($maximumLuma - $minimumLuma -lt 8) {
      return ''
    }
    $memory = [System.IO.MemoryStream]::new()
    $coverBitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $memory.ToArray()
    if ($bytes.Length -le 128 -or $bytes.Length -gt 1048576) {
      return ''
    }
    return "data:image/png;base64,$([Convert]::ToBase64String($bytes))"
  } catch {
    return ''
  } finally {
    if ($null -ne $memory) { $memory.Dispose() }
    if ($null -ne $coverGraphics) { $coverGraphics.Dispose() }
    if ($null -ne $coverBitmap) { $coverBitmap.Dispose() }
    if ($null -ne $fullGraphics) { $fullGraphics.Dispose() }
    if ($null -ne $fullBitmap) { $fullBitmap.Dispose() }
  }
}

function Read-NotificationAppIconDataUrl {
  param($AppInfo)

  $reader = $null
  $stream = $null
  $memory = $null
  $image = $null
  $bitmap = $null
  try {
    if ($null -eq $AppInfo -or $null -eq $AppInfo.DisplayInfo) {
      return ''
    }
    $size = New-Object Windows.Foundation.Size
    $size.Width = 64
    $size.Height = 64
    $reference = $AppInfo.DisplayInfo.GetLogo($size)
    if ($null -eq $reference) {
      return ''
    }
    $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
    $stream = Wait-WinRtOperation ($reference.OpenReadAsync()) $streamType
    if ($null -eq $stream -or $stream.Size -le 0 -or $stream.Size -gt 524288) {
      return ''
    }
    $inputStream = $stream.GetInputStreamAt(0)
    $reader = [Windows.Storage.Streams.DataReader]::new($inputStream)
    $loaded = Wait-WinRtOperation ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
    if ($loaded -le 0) {
      return ''
    }
    $bytes = [byte[]]::new([int]$loaded)
    $reader.ReadBytes($bytes)
    $memory = [System.IO.MemoryStream]::new($bytes, $false)
    $image = [System.Drawing.Image]::FromStream($memory)
    $bitmap = [System.Drawing.Bitmap]::new($image)
    if (-not (Test-WinkGoBitmapHasVisibleContent $bitmap)) {
      return ''
    }
    $contentType = [string]$stream.ContentType
    if ([string]::IsNullOrWhiteSpace($contentType)) {
      $contentType = 'image/png'
    }
    return "data:$contentType;base64,$([Convert]::ToBase64String($bytes))"
  } catch {
    return ''
  } finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $image) { $image.Dispose() }
    if ($null -ne $memory) { $memory.Dispose() }
    Close-WinRtResource $reader
    Close-WinRtResource $stream
  }
}

function Read-SodaPlaybackStateFromWindow {
  $bitmap = $null
  $graphics = $null
  try {
    $processIds = @(
      Get-Process -Name 'SodaMusic' -ErrorAction SilentlyContinue |
        ForEach-Object { [int]$_.Id }
    )
    if ($processIds.Count -eq 0) {
      return $null
    }
    $window = [WinkGoWindowCaptureNative]::FindLargestWindow([int[]]$processIds)
    if ($window -eq [IntPtr]::Zero) {
      return $null
    }
    $rect = New-Object WinkGoWindowCaptureNative+Rect
    if (-not [WinkGoWindowCaptureNative]::GetWindowRect($window, [ref]$rect)) {
      return $null
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 640 -or $height -lt 420) {
      return $null
    }

    $scaleX = [Math]::Max(0.75, [Math]::Min(2.0, $width / 1100.0))
    $scaleY = [Math]::Max(0.75, [Math]::Min(2.0, $height / 720.0))
    $scale = [Math]::Max(
      0.75,
      [Math]::Min(2.0, ($scaleX + $scaleY) * 0.5)
    )
    $sampleSize = [int][Math]::Round(72.0 * $scale)
    $sampleSize = [Math]::Max(48, [Math]::Min(108, $sampleSize))
    $centerX = [int][Math]::Round($width * 0.5)
    $centerY = $height - [int][Math]::Round(44.0 * $scaleY)
    $left = [Math]::Max(0, $centerX - [int]($sampleSize / 2))
    $top = [Math]::Max(0, $centerY - [int]($sampleSize / 2))
    if ($left + $sampleSize -gt $width -or $top + $sampleSize -gt $height) {
      return $null
    }

    # PrintWindow can block indefinitely inside Chromium-based music clients,
    # which used to stop the entire media/notification bridge after one poll.
    # Only inspect the tiny visible transport-button crop when Soda is the
    # foreground window. When it is hidden/minimized, keep the last known state.
    if (
      -not [WinkGoWindowCaptureNative]::IsWindowVisible($window) -or
      [WinkGoWindowCaptureNative]::IsIconic($window) -or
      [WinkGoWindowCaptureNative]::GetForegroundWindow() -ne $window
    ) {
      return $null
    }
    $bitmap = [System.Drawing.Bitmap]::new(
      $sampleSize,
      $sampleSize,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen(
      $rect.Left + $left,
      $rect.Top + $top,
      0,
      0,
      [System.Drawing.Size]::new($sampleSize, $sampleSize),
      [System.Drawing.CopyPixelOperation]::SourceCopy
    )

    $activeColumns = [System.Collections.Generic.List[int]]::new()
    $brightCount = 0
    for ($x = 0; $x -lt $sampleSize; $x++) {
      $columnCount = 0
      for ($y = 0; $y -lt $sampleSize; $y++) {
        $pixel = $bitmap.GetPixel($x, $y)
        if ($pixel.R -gt 180 -and $pixel.G -gt 180 -and $pixel.B -gt 180) {
          $columnCount++
          $brightCount++
        }
      }
      if ($columnCount -ge 2) {
        $activeColumns.Add($x)
      }
    }
    if ($activeColumns.Count -eq 0) {
      return $null
    }

    $clusters = [System.Collections.Generic.List[object]]::new()
    $start = $activeColumns[0]
    $previous = $start
    foreach ($column in @($activeColumns | Select-Object -Skip 1)) {
      if ($column -gt $previous + 2) {
        $clusters.Add(@($start, $previous))
        $start = $column
      }
      $previous = $column
    }
    $clusters.Add(@($start, $previous))

    $centerMin = [int][Math]::Round($sampleSize * 0.20)
    $centerMax = [int][Math]::Round($sampleSize * 0.80)
    $compact = $true
    foreach ($cluster in $clusters) {
      $clusterWidth = [int]$cluster[1] - [int]$cluster[0] + 1
      if (
        [int]$cluster[0] -lt $centerMin -or
        [int]$cluster[1] -gt $centerMax -or
        $clusterWidth -gt [int][Math]::Round($sampleSize * 0.40)
      ) {
        $compact = $false
        break
      }
    }
    if (
      -not $compact -or
      $brightCount -lt 20 -or
      $brightCount -gt [int][Math]::Round($sampleSize * $sampleSize * 0.35)
    ) {
      return $null
    }

    # Two separated bright bars are the pause glyph shown while playing.
    # One compact cluster is the triangle shown while paused.
    return [bool]($clusters.Count -ge 2)
  } catch {
    return $null
  } finally {
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
  }
}

function Read-SodaCurrentTrackSnapshot {
  $fileStream = $null
  $gzipStream = $null
  $reader = $null
  try {
    if ($null -eq (Get-Process -Name 'SodaMusic' -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      return $null
    }

    $queuePath = Join-Path $env:APPDATA 'SodaMusic\LunaStorage\QueueCache'
    if (-not (Test-Path -LiteralPath $queuePath -PathType Leaf)) {
      return $null
    }
    $fileStream = [IO.File]::Open(
      $queuePath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::ReadWrite
    )
    $signature = New-Object byte[] 4
    if ($fileStream.Read($signature, 0, 4) -ne 4) {
      return $null
    }
    if ([Text.Encoding]::ASCII.GetString($signature) -ne 'LUNA') {
      return $null
    }

    $gzipStream = New-Object IO.Compression.GZipStream(
      $fileStream,
      [IO.Compression.CompressionMode]::Decompress
    )
    $reader = New-Object IO.StreamReader($gzipStream, [Text.Encoding]::UTF8)
    $queue = $reader.ReadToEnd() | ConvertFrom-Json

    $bestSavedAt = [long]::MinValue
    $bestTrack = $null
    foreach ($queueProperty in $queue.PSObject.Properties) {
      $queueValue = $queueProperty.Value
      $savedAt = [long]$queueValue.savedAt
      $lastPlayedKey = [string]$queueValue.lastPlayedKey
      $candidate = $null
      foreach ($playable in @($queueValue.playables)) {
        if ($null -eq $playable.track) {
          continue
        }
        if ([string]$playable.key -eq $lastPlayedKey) {
          $candidate = $playable.track
          break
        }
      }
      if ($null -eq $candidate) {
        $candidate = @($queueValue.playables | Where-Object { $null -ne $_.track } | Select-Object -Last 1).track
      }
      if ($null -ne $candidate -and $savedAt -gt $bestSavedAt) {
        $bestSavedAt = $savedAt
        $bestTrack = $candidate
      }
    }
    if ($null -eq $bestTrack) {
      return $null
    }

    $title = Limit-Text ([string]$bestTrack.name) 180
    if ([string]::IsNullOrWhiteSpace($title)) {
      return $null
    }
    $artist = Limit-Text (
      (@($bestTrack.artists | ForEach-Object { [string]$_.name }) | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
      }) -join ' / '
    ) 140
    $albumTitle = Limit-Text ([string]$bestTrack.album.name) 140

    $windowPlaying = Read-SodaPlaybackStateFromWindow
    $isPlaying = if ($null -ne $windowPlaying) {
      [bool]$windowPlaying
    } elseif (
      $null -ne $script:latestMedia -and
      ([string]$script:latestMedia.appId).Contains('SodaMusic')
    ) {
      [bool]$script:latestMedia.isPlaying
    } else {
      # The queue is current and the player is running. Prefer a usable first
      # snapshot over a blank island when Windows cannot capture a minimized
      # player; the next visible-window poll corrects the state.
      $true
    }

    $coverUrl = ''
    $cover = $bestTrack.album.url_cover
    $coverUri = [string]$cover.uri
    $coverPrefix = [string]$cover.template_prefix
    $coverBase = [string]@($cover.urls)[0]
    if (
      -not [string]::IsNullOrWhiteSpace($coverUri) -and
      -not [string]::IsNullOrWhiteSpace($coverPrefix) -and
      -not [string]::IsNullOrWhiteSpace($coverBase)
    ) {
      # Keep the signed player artwork URL. The renderer can load HTTPS
      # artwork without blocking media detection on a network download.
      $coverUrl = "$coverBase$coverUri~$coverPrefix-resize:200:200.image"
    }

    return [ordered]@{
      appId = 'SodaMusic!WinkGoSynthetic'
      title = $title
      artist = $artist
      albumTitle = $albumTitle
      isPlaying = [bool]$isPlaying
      canPlayPause = $true
      canGoNext = $true
      canGoPrevious = $true
      coverUrl = $coverUrl
      appIconUrl = ''
      updatedAt = Get-UnixMilliseconds
    }
  } catch {
    return $null
  } finally {
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $gzipStream) { $gzipStream.Dispose() }
    if ($null -ne $fileStream) { $fileStream.Dispose() }
  }
}

function Publish-PreparedMediaSnapshot {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $trackKey = "$($Snapshot.appId)|$($Snapshot.title)|$($Snapshot.artist)"
  if ($trackKey -ne $script:lastTrackKey) {
    $script:lastTrackKey = $trackKey
    $script:mediaTransitionPollUntil = [DateTime]::MinValue
  }
  $comparison = Copy-OrderedDictionary $Snapshot
  $comparison.updatedAt = 0
  $comparisonJson = $comparison | ConvertTo-Json -Compress -Depth 5
  if ($comparisonJson -eq $script:lastMediaJson) {
    return
  }
  $script:lastMediaJson = $comparisonJson
  $script:lastCoverUrl = [string]$Snapshot.coverUrl
  $script:latestMedia = $Snapshot
  Write-BridgeEvent @{ type = 'media-snapshot'; data = $Snapshot }
}

function Publish-MediaSnapshot {
  if (-not $script:mediaEnabled) {
    return
  }

  try {
    # Soda Music 3.x can play through a real Core Audio process without
    # registering an SMTC session. Its signed QueueCache still contains the
    # exact current title, artist and artwork, so synthesize a media session
    # instead of falling back to a stale browser/Bilibili entry.
    $syntheticSoda = Read-SodaCurrentTrackSnapshot
    # A playing Soda process is already a complete, verified media source.
    # Publish it before asking Windows for SMTC sessions: stale browser/Bilibili
    # sessions can take seconds to resolve and previously blocked Soda from ever
    # reaching the island even though its audio and queue were current.
    if (
      $null -ne $syntheticSoda -and
      (
        [bool]$syntheticSoda.isPlaying -or
        (
          $null -ne $script:latestMedia -and
          ([string]$script:latestMedia.appId).Contains('SodaMusic')
        )
      )
    ) {
      $script:activeMediaSession = $null
      Publish-PreparedMediaSnapshot $syntheticSoda
      return
    }

    $session = Get-BestMediaSession
    if ($null -ne $syntheticSoda) {
      $useSyntheticSoda = [bool]$syntheticSoda.isPlaying
      if (-not $useSyntheticSoda -and $null -eq $session) {
        $useSyntheticSoda = $true
      }
      if (-not $useSyntheticSoda -and $null -ne $session) {
        try {
          $sessionAppId = [string]$session.SourceAppUserModelId
          $sessionStatus = [string]$session.GetPlaybackInfo().PlaybackStatus
          $sessionIsPlaying = $sessionStatus -eq 'Playing'
          $useSyntheticSoda =
            -not (Test-DedicatedMusicApp $sessionAppId) -and
            -not $sessionIsPlaying
        } catch {
          $useSyntheticSoda = $true
        }
      }
      # Preserve the selected dedicated player while paused. This prevents a
      # dormant browser session from replacing Soda immediately after pause.
      if (
        -not $useSyntheticSoda -and
        $null -ne $script:latestMedia -and
        ([string]$script:latestMedia.appId).Contains('SodaMusic')
      ) {
        $useSyntheticSoda = $true
      }
      if ($useSyntheticSoda) {
        $script:activeMediaSession = $null
        Publish-PreparedMediaSnapshot $syntheticSoda
        return
      }
    }
    if ($null -eq $session) {
      $script:activeMediaSession = $null
      if (-not [string]::IsNullOrWhiteSpace($script:lastMediaJson)) {
        $script:lastMediaJson = ''
        $script:lastTrackKey = ''
        $script:lastCoverUrl = ''
        $script:nextCoverRetryAt = [DateTime]::UtcNow
        $script:latestMedia = $null
        Write-BridgeEvent @{ type = 'media-snapshot'; data = $null }
      }
      return
    }
    $script:activeMediaSession = $session

    $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
    $properties = Wait-WinRtOperation ($session.TryGetMediaPropertiesAsync()) $propertiesType
    $title = Limit-Text ([string]$properties.Title) 180
    if ([string]::IsNullOrWhiteSpace($title)) {
      return
    }

    $artist = Limit-Text ([string]$properties.Artist) 140
    $albumTitle = Limit-Text ([string]$properties.AlbumTitle) 140
    $appId = Limit-Text ([string]$session.SourceAppUserModelId) 220
    $playbackInfo = $session.GetPlaybackInfo()
    $reportedPlaying = ([string]$playbackInfo.PlaybackStatus) -eq 'Playing'
    $isPlaying = Resolve-MediaPlayingState $appId $reportedPlaying
    $controls = $playbackInfo.Controls
    $appIconUrl = Read-MediaAppIconDataUrl $appId
    $trackKey = "$appId|$title|$artist"
    $trackChanged = $trackKey -ne $script:lastTrackKey
    if ($trackChanged) {
      $script:lastTrackKey = $trackKey
      $script:lastCoverUrl = ''
      $script:nextCoverRetryAt = [DateTime]::UtcNow
      # A next/previous command can complete before the player publishes its
      # new metadata. Stop the temporary fast poll as soon as the new track is
      # actually visible, rather than leaving the old title/cover on the island.
      $script:mediaTransitionPollUntil = [DateTime]::MinValue
    }
    $needsCoverRefresh =
      [string]::IsNullOrWhiteSpace($script:lastCoverUrl) -and
      [DateTime]::UtcNow -ge $script:nextCoverRetryAt

    $snapshot = [ordered]@{
      appId = $appId
      title = $title
      artist = $artist
      albumTitle = $albumTitle
      isPlaying = $isPlaying
      canPlayPause = [bool]($controls.IsPlayEnabled -or $controls.IsPauseEnabled)
      canGoNext = [bool]$controls.IsNextEnabled
      canGoPrevious = [bool]$controls.IsPreviousEnabled
      coverUrl = $script:lastCoverUrl
      appIconUrl = $appIconUrl
      updatedAt = Get-UnixMilliseconds
    }
    $comparison = Copy-OrderedDictionary $snapshot
    $comparison.updatedAt = 0
    $comparisonJson = $comparison | ConvertTo-Json -Compress -Depth 5
    if ($comparisonJson -ne $script:lastMediaJson) {
      $script:lastMediaJson = $comparisonJson
      $script:latestMedia = $snapshot
      Write-BridgeEvent @{ type = 'media-snapshot'; data = $snapshot }
    }

    # Publish playable metadata first, then enrich it with artwork. This
    # mirrors the original WINK GO runtime and prevents media detection from
    # appearing broken when a player exposes a slow thumbnail stream.
    if ($needsCoverRefresh) {
      $script:nextCoverRetryAt = [DateTime]::UtcNow.AddSeconds(4)
      # Soda Music currently publishes title/artist through SMTC but often
      # exposes an empty or stale thumbnail object. Its signed local queue is
      # the exact source of truth for the active track and artwork, so resolve
      # that first. The helper is a no-op for every other media application.
      $coverUrl = Read-SodaQueueCoverDataUrl $appId $title $artist
      if ([string]::IsNullOrWhiteSpace($coverUrl)) {
        $coverUrl = Read-MediaCoverDataUrl $properties
      }
      if ([string]::IsNullOrWhiteSpace($coverUrl)) {
        $coverUrl = Read-MusicMetadataCoverDataUrl $appId $title $artist
      }
      if ([string]::IsNullOrWhiteSpace($coverUrl)) {
        $coverUrl = Read-SodaWindowCoverDataUrl $appId
      }
      if ([string]::IsNullOrWhiteSpace($coverUrl)) {
        $coverUrl = Read-NetEaseWindowCoverDataUrl $appId
      }
      if (-not [string]::IsNullOrWhiteSpace($coverUrl)) {
        $script:lastCoverUrl = $coverUrl
        $snapshot.coverUrl = $coverUrl
        $snapshot.updatedAt = Get-UnixMilliseconds
        $comparison = Copy-OrderedDictionary $snapshot
        $comparison.updatedAt = 0
        $script:lastMediaJson = $comparison | ConvertTo-Json -Compress -Depth 5
        $script:latestMedia = $snapshot
        Write-BridgeEvent @{ type = 'media-snapshot'; data = $snapshot }
      }
    }
  } catch {
    $script:mediaManager = $null
    Write-BridgeEvent @{
      type = 'runtime-warning'
      scope = 'media'
      message = Limit-Text $_.Exception.Message 240
    }
  }
}

function Publish-MediaPlaybackState {
  if (
    -not $script:mediaEnabled -or
    $null -eq $script:latestMedia -or
    $null -eq $script:activeMediaSession
  ) {
    return
  }

  try {
    # Playback state changes much more frequently than title/artwork metadata.
    # Reading only GetPlaybackInfo keeps pause/play synchronization responsive
    # without repeatedly opening the album-art stream.
    $playbackInfo = $script:activeMediaSession.GetPlaybackInfo()
    $isPlaying = Resolve-MediaPlayingState (
      [string]$script:latestMedia.appId
    ) (([string]$playbackInfo.PlaybackStatus) -eq 'Playing')
    if ([bool]$script:latestMedia.isPlaying -eq $isPlaying) {
      return
    }

    $snapshot = Copy-OrderedDictionary $script:latestMedia
    $snapshot.isPlaying = $isPlaying
    $snapshot.updatedAt = Get-UnixMilliseconds
    $comparison = Copy-OrderedDictionary $snapshot
    $comparison.updatedAt = 0
    $script:lastMediaJson = $comparison | ConvertTo-Json -Compress -Depth 5
    $script:latestMedia = $snapshot
    Write-BridgeEvent @{ type = 'media-snapshot'; data = $snapshot }
  } catch {
    # The full metadata poll will reacquire the active session. Clearing this
    # reference prevents a closed player session from leaving artwork spinning.
    $script:activeMediaSession = $null
    $script:nextMediaPollAt = [DateTime]::UtcNow
  }
}

function Invoke-MediaControl {
  param([string] $Action)

  if (
    $null -ne $script:latestMedia -and
    ([string]$script:latestMedia.appId).Contains('WinkGoSynthetic')
  ) {
    if (
      ($Action -eq 'play' -and [bool]$script:latestMedia.isPlaying) -or
      ($Action -eq 'pause' -and -not [bool]$script:latestMedia.isPlaying)
    ) {
      return $true
    }
    $controlled = if (
      ([string]$script:latestMedia.appId).StartsWith(
        'SodaMusic',
        [System.StringComparison]::OrdinalIgnoreCase
      )
    ) {
      [WinkGoMediaKeyNative]::SendSoda($Action)
    } else {
      [WinkGoMediaKeyNative]::Send($Action)
    }
    if (-not $controlled) {
      throw 'UNSUPPORTED_MEDIA_ACTION'
    }
    $now = [DateTime]::UtcNow
    if ($null -ne $script:latestMedia) {
      $snapshot = Copy-OrderedDictionary $script:latestMedia
      switch ($Action) {
        'play_pause' { $snapshot.isPlaying = -not [bool]$snapshot.isPlaying }
        'play' { $snapshot.isPlaying = $true }
        'pause' { $snapshot.isPlaying = $false }
      }
      $snapshot.updatedAt = Get-UnixMilliseconds
      $comparison = Copy-OrderedDictionary $snapshot
      $comparison.updatedAt = 0
      $script:lastMediaJson = $comparison | ConvertTo-Json -Compress -Depth 5
      $script:latestMedia = $snapshot
      Write-BridgeEvent @{ type = 'media-snapshot'; data = $snapshot }
    }
    $script:nextPlaybackPollAt = $now.AddMilliseconds(60)
    $script:mediaTransitionPollUntil = $now.AddSeconds(6)
    $script:nextMediaPollAt = $now.AddMilliseconds(120)
    return $true
  }

  $session = Get-BestMediaSession
  if ($null -eq $session) {
    if ([WinkGoMediaKeyNative]::Send($Action)) {
      $script:nextMediaPollAt = [DateTime]::UtcNow.AddMilliseconds(120)
      return $true
    }
    throw 'MEDIA_SESSION_NOT_FOUND'
  }

  $operation = switch ($Action) {
    'play_pause' { $session.TryTogglePlayPauseAsync() }
    'play' { $session.TryPlayAsync() }
    'pause' { $session.TryPauseAsync() }
    'next' { $session.TrySkipNextAsync() }
    'previous' { $session.TrySkipPreviousAsync() }
    default { throw 'UNSUPPORTED_MEDIA_ACTION' }
  }
  $result = Wait-WinRtOperation $operation ([bool])
  if (-not $result) {
    throw 'MEDIA_CONTROL_REJECTED'
  }
  $now = [DateTime]::UtcNow
  $script:activeMediaSession = $session
  $script:nextPlaybackPollAt = $now.AddMilliseconds(60)
  if ($Action -eq 'next' -or $Action -eq 'previous') {
    # NetEase Cloud Music and several other SMTC providers acknowledge the
    # skip command before exposing the new title and artwork. Poll metadata
    # briefly at interactive speed so the island follows the real player.
    $script:mediaTransitionPollUntil = $now.AddSeconds(6)
    $script:nextMediaPollAt = $now.AddMilliseconds(120)
  } else {
    $script:nextMediaPollAt = $now
  }
  return $true
}

function Remember-NotificationKey {
  param([string] $Key)

  if ($script:seenNotificationKeys.Add($Key)) {
    $script:seenNotificationOrder.Enqueue($Key)
  }
  while ($script:seenNotificationOrder.Count -gt 512) {
    $expired = $script:seenNotificationOrder.Dequeue()
    $script:seenNotificationKeys.Remove($expired) | Out-Null
  }
}

function Sync-NotificationBaseline {
  try {
    $listType = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]
    $notifications = Wait-WinRtOperation (
      $script:listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)
    ) $listType
    foreach ($notification in @($notifications)) {
      $appUserModelId = [string]$notification.AppInfo.AppUserModelId
      $createdAt = $notification.CreationTime.ToUnixTimeMilliseconds()
      Remember-NotificationKey "$appUserModelId|$($notification.Id)|$createdAt"
    }
  } catch {
    # Baseline synchronization is best effort. The next poll remains bounded.
  }
}

function Publish-NewNotifications {
  if (-not $script:notificationEnabled) {
    return
  }

  try {
    $script:notificationAccess = [string]$script:listener.GetAccessStatus()
    if ($script:notificationAccess -ne 'Allowed') {
      return
    }

    $listType = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]
    $notifications = Wait-WinRtOperation (
      $script:listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)
    ) $listType
    $orderedNotifications = @($notifications) | Sort-Object { $_.CreationTime.ToUnixTimeMilliseconds() }
    $delivered = 0

    foreach ($notification in $orderedNotifications) {
      $appName = Limit-Text ([string]$notification.AppInfo.DisplayInfo.DisplayName) 80
      $appUserModelId = Limit-Text ([string]$notification.AppInfo.AppUserModelId) 220
      $createdAt = $notification.CreationTime.ToUnixTimeMilliseconds()
      $key = "$appUserModelId|$($notification.Id)|$createdAt"
      if ($script:seenNotificationKeys.Contains($key)) {
        continue
      }
      Remember-NotificationKey $key
      if ($createdAt -lt $script:notificationCaptureStartedAt) {
        continue
      }
      if ([string]::IsNullOrWhiteSpace($appName) -and [string]::IsNullOrWhiteSpace($appUserModelId)) {
        continue
      }

      $binding = $notification.Notification.Visual.GetBinding('ToastGeneric')
      if ($null -eq $binding) {
        continue
      }
      $texts = @($binding.GetTextElements() | ForEach-Object { Limit-Text ([string]$_.Text) 512 })
      $texts = @($texts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
      if ($texts.Count -eq 0) {
        continue
      }
      $title = Limit-Text $texts[0] 180
      $body = ''
      if ($texts.Count -gt 1) {
        $body = Limit-Text (($texts[1..($texts.Count - 1)] -join ' ')) 512
      }
      $payload = [ordered]@{
        id = $key
        appName = $(if ([string]::IsNullOrWhiteSpace($appName)) { '微信' } else { $appName })
        title = $title
        body = $body
        appUserModelId = $appUserModelId
        iconUrl = Read-NotificationAppIconDataUrl $notification.AppInfo
        createdAt = $createdAt
      }
      $script:latestNotification = $payload
      Write-BridgeEvent @{ type = 'notification'; data = $payload }
      $delivered += 1
      if ($delivered -ge 8) {
        break
      }
    }
  } catch {
    Write-BridgeEvent @{
      type = 'runtime-warning'
      scope = 'notification'
      message = Limit-Text $_.Exception.Message 240
    }
  }
}

function Request-NotificationAccess {
  $status = [string]$script:listener.GetAccessStatus()
  if ($status -eq 'Unspecified') {
    $resultType = [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]
    $status = [string](Wait-WinRtOperation ($script:listener.RequestAccessAsync()) $resultType 30000)
  }
  $script:notificationAccess = $status
  return $status
}

function Get-RuntimeState {
  return [ordered]@{
    available = $true
    mediaEnabled = $script:mediaEnabled
    notificationEnabled = $script:notificationEnabled
    notificationAccess = $script:notificationAccess
    media = $script:latestMedia
    notification = $script:latestNotification
  }
}

function Handle-BridgeCommand {
  param($Command)

  $requestId = [string]$Command.requestId
  try {
    switch ([string]$Command.type) {
      'configure' {
        $wasNotificationEnabled = $script:notificationEnabled
        $nextMediaTarget = [string]$Command.mediaTarget
        if ([string]::IsNullOrWhiteSpace($nextMediaTarget)) {
          $nextMediaTarget = 'system'
        }
        $mediaTargetChanged = $nextMediaTarget -ne $script:mediaTarget
        $script:mediaTarget = $nextMediaTarget
        $script:mediaEnabled = [bool]$Command.mediaEnabled
        $script:notificationEnabled = [bool]$Command.notificationEnabled
        if ($mediaTargetChanged) {
          $hadMedia = $null -ne $script:latestMedia
          $script:lastMediaJson = ''
          $script:lastTrackKey = ''
          $script:lastCoverUrl = ''
          $script:nextCoverRetryAt = [DateTime]::UtcNow
          $script:latestMedia = $null
          $script:activeMediaSession = $null
          $script:mediaManager = $null
          if ($hadMedia) {
            Write-BridgeEvent @{ type = 'media-snapshot'; data = $null }
          }
        }
        if ($script:mediaEnabled) {
          $script:nextPlaybackPollAt = [DateTime]::UtcNow
          $script:nextMediaPollAt = [DateTime]::UtcNow
        } elseif (-not [string]::IsNullOrWhiteSpace($script:lastMediaJson)) {
          $script:lastMediaJson = ''
          $script:lastTrackKey = ''
          $script:lastCoverUrl = ''
          $script:nextCoverRetryAt = [DateTime]::UtcNow
          $script:latestMedia = $null
          $script:activeMediaSession = $null
          Write-BridgeEvent @{ type = 'media-snapshot'; data = $null }
        }
        if ($script:notificationEnabled -and -not $wasNotificationEnabled) {
          $script:notificationCaptureStartedAt = Get-UnixMilliseconds
          $script:seenNotificationKeys.Clear()
          $script:seenNotificationOrder.Clear()
          [WinkGoNotificationWorker]::Start($PSCommandPath) | Out-Null
        } elseif (-not $script:notificationEnabled -and $wasNotificationEnabled) {
          [WinkGoNotificationWorker]::Stop()
        }
        Write-CommandResult $requestId $true (Get-RuntimeState)
      }
      'get-state' {
        $script:notificationAccess = [string]$script:listener.GetAccessStatus()
        Write-CommandResult $requestId $true (Get-RuntimeState)
      }
      'media-control' {
        $controlled = Invoke-MediaControl ([string]$Command.action)
        Write-CommandResult $requestId $controlled @{ controlled = $controlled }
      }
      'request-notification-access' {
        $status = Request-NotificationAccess
        Write-CommandResult $requestId ($status -eq 'Allowed') @{ status = $status }
      }
      'shutdown' {
        Write-CommandResult $requestId $true @{ stopped = $true }
        return $false
      }
      default {
        throw 'UNKNOWN_BRIDGE_COMMAND'
      }
    }
  } catch {
    Write-CommandResult $requestId $false $null (Limit-Text $_.Exception.Message 320)
  }
  return $true
}

if ($controlWorkerMode) {
  # Transport commands deliberately run in a process that never reads media
  # metadata or artwork. Those probes can block in third-party players, while
  # hardware media keys and Soda's visible transport buttons remain immediate.
  $keepControlRunning = $true
  [WinkGoBridgeInputQueue]::Start()
  while ($keepControlRunning) {
    $line = [WinkGoBridgeInputQueue]::Poll()
    if ($null -ne $line) {
      if (-not [string]::IsNullOrWhiteSpace($line)) {
        $requestId = ''
        try {
          $command = $line | ConvertFrom-Json
          $requestId = [string]$command.requestId
          switch ([string]$command.type) {
            'media-control' {
              $action = [string]$command.action
              $appId = [string]$command.appId
              $isSoda = (
                $appId.IndexOf('SodaMusic', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $appId.IndexOf('Soda Music', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $appId.IndexOf('qishui', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $appId.IndexOf('汽水', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
              )
              $controlled = if ($isSoda) {
                [WinkGoMediaKeyNative]::SendSoda($action)
              } else {
                [WinkGoMediaKeyNative]::Send($action)
              }
              if (-not $controlled -and $isSoda) {
                $controlled = [WinkGoMediaKeyNative]::Send($action)
              }
              if (-not $controlled) {
                throw 'UNSUPPORTED_MEDIA_ACTION'
              }
              Write-CommandResult $requestId $true @{ controlled = $true }
            }
            'shutdown' {
              Write-CommandResult $requestId $true @{ stopped = $true }
              $keepControlRunning = $false
            }
            default {
              throw 'UNKNOWN_CONTROL_COMMAND'
            }
          }
        } catch {
          Write-CommandResult $requestId $false $null (Limit-Text $_.Exception.Message 320)
        }
      }
    } elseif ([WinkGoBridgeInputQueue]::Ended) {
      break
    } else {
      Start-Sleep -Milliseconds 10
    }
  }
  exit
}

if ($notificationWorkerMode) {
  $script:notificationEnabled = $true
  $script:notificationCaptureStartedAt = Get-UnixMilliseconds
  $script:seenNotificationKeys.Clear()
  $script:seenNotificationOrder.Clear()
  while ($true) {
    if ($notificationWorkerParentId -gt 0) {
      $parent = Get-Process -Id $notificationWorkerParentId -ErrorAction SilentlyContinue
      if ($null -eq $parent) {
        break
      }
    }
    Publish-NewNotifications
    Start-Sleep -Milliseconds 900
  }
  exit
}

Write-BridgeEvent @{
  type = 'ready'
  data = Get-RuntimeState
}

$keepRunning = $true
[WinkGoBridgeInputQueue]::Start()
while ($keepRunning) {
  $line = [WinkGoBridgeInputQueue]::Poll()
  if ($null -ne $line) {
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      try {
        $command = $line | ConvertFrom-Json
        $keepRunning = Handle-BridgeCommand $command
      } catch {
        Write-BridgeEvent @{
          type = 'runtime-warning'
          scope = 'command'
          message = Limit-Text $_.Exception.Message 240
        }
      }
    }
  } elseif ([WinkGoBridgeInputQueue]::Ended) {
    break
  }

  $now = [DateTime]::UtcNow
  while ($true) {
    $notificationLine = [WinkGoNotificationWorker]::Poll()
    if ([string]::IsNullOrWhiteSpace($notificationLine)) {
      break
    }
    try {
      $notificationEvent = $notificationLine | ConvertFrom-Json
      if ([string]$notificationEvent.type -eq 'notification') {
        $script:latestNotification = $notificationEvent.data
      }
      Write-BridgeEvent $notificationEvent
    } catch {
      Write-BridgeEvent @{
        type = 'runtime-warning'
        scope = 'notification'
        message = Limit-Text $_.Exception.Message 240
      }
    }
  }
  if ($script:mediaEnabled -and $now -ge $script:nextPlaybackPollAt) {
    Publish-MediaPlaybackState
    $script:nextPlaybackPollAt = $now.AddMilliseconds(180)
  }
  if ($script:mediaEnabled -and $now -ge $script:nextMediaPollAt) {
    Publish-MediaSnapshot
    $mediaPollDelay = if (
      [DateTime]::UtcNow -lt $script:mediaTransitionPollUntil
    ) {
      180
    } else {
      1250
    }
    $script:nextMediaPollAt = [DateTime]::UtcNow.AddMilliseconds($mediaPollDelay)
  }
  Start-Sleep -Milliseconds 90
}

[WinkGoNotificationWorker]::Stop()

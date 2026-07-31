; Modified from AionUI by WINK GO contributors in 2026.
!ifndef WINKGO_INSTALLER_PROCESS_CONTROL_NSH
!define WINKGO_INSTALLER_PROCESS_CONTROL_NSH

Var /GLOBAL WinkGoStopResult
Var /GLOBAL WinkGoLockerResult
Var /GLOBAL WinkGoLockerList
Var /GLOBAL WinkGoLockerListZh
Var /GLOBAL WinkGoLockerListEn
Var /GLOBAL WinkGoLockerListFile
Var /GLOBAL WinkGoCurrentOutDir

!macro WINKGO_FIND_APP_PROCESS _RETURN
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$ownedPrefix = $$instDir.TrimEnd('\') + '\'; \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = $$psProc.ParentProcessId; \
    function Test-WinkGoOwnedProcess($$proc) { \
      $$path = $$proc.ExecutablePath; \
      if (-not $$path) { $$path = $$proc.Path } \
      if (-not $$path) { return $$false } \
      try { $$full = [System.IO.Path]::GetFullPath($$path) } catch { return $$false } \
      return $$proc.ProcessId -ne $$installerPid -and $$full.StartsWith($$ownedPrefix, [System.StringComparison]::CurrentCultureIgnoreCase) \
    } \
    $$hits = @(Get-CimInstance -ClassName Win32_Process | Where-Object { Test-WinkGoOwnedProcess $$_ }); \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-find'; ownedPrefix = $$ownedPrefix; installerPid = $$installerPid; hits = $$hits.Count; owned = ($$hits.Count -gt 0) }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    if ($$hits.Count -gt 0) { $$hitPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-find-hits'; processes = @($$hits | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,Path,CommandLine) }; Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$hitPayload | ConvertTo-Json -Compress -Depth 10); exit 0 } \
    exit 1 \
  }"`
  Pop ${_RETURN}
!macroend

; Installer/upgrade preflight. Ask any running WINK GO window to close first so it
; can flush local state, then force only the remaining WINK GO-owned processes.
; The exact-name fallback also covers upgrades from the legacy WinkGo executable;
; unrelated Electron applications are never selected.
!macro WINKGO_CLOSE_RUNNING_APP_FOR_INSTALL
  DetailPrint "正在检查并关闭旧版 WINK GO..."
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$names = @('WINK-GO.exe', 'WinkGo.exe'); \
    $$instDir = ''; \
    try { if ('$INSTDIR') { $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR').TrimEnd('\') + '\' } } catch { $$instDir = '' }; \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = if ($$psProc) { [int]$$psProc.ParentProcessId } else { 0 }; \
    function Get-WinkGoTargets { \
      @((Get-CimInstance -ClassName Win32_Process) | Where-Object { \
        $$proc = $$_; \
        $$path = if ($$proc.ExecutablePath) { [string]$$proc.ExecutablePath } else { [string]$$proc.Path }; \
        $$ownedPath = $$false; \
        if ($$instDir -and $$path) { try { $$ownedPath = [System.IO.Path]::GetFullPath($$path).StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) } catch {} }; \
        [int]$$proc.ProcessId -ne $$installerPid -and (($$names -contains [string]$$proc.Name) -or $$ownedPath) \
      }) \
    }; \
    $$targets = @(Get-WinkGoTargets); \
    $$initial = @($$targets | ForEach-Object { [ordered]@{ pid = [int]$$_.ProcessId; name = [string]$$_.Name; path = [string]$$_.ExecutablePath } }); \
    foreach ($$target in $$targets) { \
      try { $$process = [System.Diagnostics.Process]::GetProcessById([int]$$target.ProcessId); [void]$$process.CloseMainWindow() } catch {} \
    }; \
    $$deadline = [DateTime]::UtcNow.AddSeconds(2); \
    do { Start-Sleep -Milliseconds 100; $$remaining = @(Get-WinkGoTargets) } while ($$remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $$deadline); \
    foreach ($$target in $$remaining) { $$id = [int]$$target.ProcessId; Stop-Process -Id $$id -Force -ErrorAction SilentlyContinue }; \
    $$deadline = [DateTime]::UtcNow.AddSeconds(3); \
    do { Start-Sleep -Milliseconds 100; $$remaining = @(Get-WinkGoTargets) } while ($$remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $$deadline); \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'install-preflight-close'; targets = $$initial; remaining = @($$remaining | Select-Object ProcessId,Name,ExecutablePath); result = if ($$remaining.Count -eq 0) { 'closed' } else { 'failed' } }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    if ($$remaining.Count -eq 0) { exit 0 } else { exit 1 } \
  }"`
  Pop $WinkGoStopResult
  ${If} $WinkGoStopResult != 0
    !insertmacro WINKGO_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS ${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} "install-preflight-close remaining-processes" "${WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_EN}" "${WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH}" "${WINKGO_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${WINKGO_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}" "WINK GO process did not exit after graceful and forced close attempts." "WINK GO 进程在正常退出和强制结束后仍未关闭。"
  ${EndIf}
!macroend

!macro WINKGO_STOP_APP_PROCESSES
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$ownedPrefix = $$instDir.TrimEnd('\') + '\'; \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = $$psProc.ParentProcessId; \
    function Test-WinkGoOwnedProcess($$proc) { \
      $$path = $$proc.ExecutablePath; \
      if (-not $$path) { $$path = $$proc.Path } \
      if (-not $$path) { return $$false } \
      try { $$full = [System.IO.Path]::GetFullPath($$path) } catch { return $$false } \
      return $$proc.ProcessId -ne $$installerPid -and $$full.StartsWith($$ownedPrefix, [System.StringComparison]::CurrentCultureIgnoreCase) \
    } \
    $$all = @(Get-CimInstance -ClassName Win32_Process); \
    $$owned = @($$all | Where-Object { Test-WinkGoOwnedProcess $$_ }); \
    $$ids = @($$owned | ForEach-Object { [int]$$_.ProcessId }); \
    $$frontier = @($$ids); \
    while ($$frontier.Count -gt 0) { \
      $$children = @($$all | Where-Object { $$frontier -contains [int]$$_.ParentProcessId -and [int]$$_.ProcessId -ne [int]$$installerPid } | Where-Object { Test-WinkGoOwnedProcess $$_ }); \
      $$childIds = @($$children | ForEach-Object { [int]$$_.ProcessId }); \
      $$ids = @($$ids + $$childIds | Select-Object -Unique); \
      $$frontier = $$childIds; \
    } \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-stop'; ids = @($$ids); result = 'start' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    foreach ($$id in ($$ids | Sort-Object -Descending)) { Stop-Process -Id $$id -Force -ErrorAction SilentlyContinue } \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-stop'; ids = @($$ids); result = 'done' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    exit 0 \
  }"`
  Pop $WinkGoStopResult
!macroend

!macro WINKGO_QUERY_LOCKERS_INLINE_LEGACY _TARGET_PATH _RETURN
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$targetPath = '${_TARGET_PATH}'; \
    $$currentOutDir = '$WinkGoCurrentOutDir'; \
    $$lockerListPath = '$PLUGINSDIR\winkgo-rm-lockers.txt'; \
    [System.IO.File]::WriteAllText($$lockerListPath, '', (New-Object System.Text.UTF8Encoding $$false)); \
    try { \
    function Test-WinkGoSamePath($$left, $$right) { \
      if ([string]::IsNullOrWhiteSpace($$left) -or [string]::IsNullOrWhiteSpace($$right)) { return $$false }; \
      try { \
        $$leftFull = [System.IO.Path]::GetFullPath($$left).TrimEnd('\'); \
        $$rightFull = [System.IO.Path]::GetFullPath($$right).TrimEnd('\'); \
        return [string]::Equals($$leftFull, $$rightFull, [System.StringComparison]::CurrentCultureIgnoreCase) \
      } catch { return $$false } \
    } \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = if ($$psProc) { [int]$$psProc.ParentProcessId } else { 0 }; \
    $$installerSelfLock = (Test-WinkGoSamePath $$currentOutDir $$targetPath) -or (Test-WinkGoSamePath $$currentOutDir $$instDir); \
      $$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('dXNpbmcgU3lzdGVtOyB1c2luZyBTeXN0ZW0uVGV4dDsgdXNpbmcgU3lzdGVtLlJ1bnRpbWUuSW50ZXJvcFNlcnZpY2VzOyBuYW1lc3BhY2UgQWlvblVpLlJlc3RhcnRNYW5hZ2VyIHsgcHVibGljIGVudW0gUk1fQVBQX1RZUEUgeyBSbVVua25vd25BcHAgPSAwLCBSbU1haW5XaW5kb3cgPSAxLCBSbU90aGVyV2luZG93ID0gMiwgUm1TZXJ2aWNlID0gMywgUm1FeHBsb3JlciA9IDQsIFJtQ29uc29sZSA9IDUsIFJtQ3JpdGljYWwgPSAxMDAwIH0gW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXSBwdWJsaWMgc3RydWN0IFJNX1VOSVFVRV9QUk9DRVNTIHsgcHVibGljIGludCBkd1Byb2Nlc3NJZDsgcHVibGljIFN5c3RlbS5SdW50aW1lLkludGVyb3BTZXJ2aWNlcy5Db21UeXBlcy5GSUxFVElNRSBQcm9jZXNzU3RhcnRUaW1lOyB9IFtTdHJ1Y3RMYXlvdXQoTGF5b3V0S2luZC5TZXF1ZW50aWFsLCBDaGFyU2V0ID0gQ2hhclNldC5Vbmljb2RlKV0gcHVibGljIHN0cnVjdCBSTV9QUk9DRVNTX0lORk8geyBwdWJsaWMgUk1fVU5JUVVFX1BST0NFU1MgUHJvY2VzczsgW01hcnNoYWxBcyhVbm1hbmFnZWRUeXBlLkJ5VmFsVFN0ciwgU2l6ZUNvbnN0ID0gMjU2KV0gcHVibGljIHN0cmluZyBzdHJBcHBOYW1lOyBbTWFyc2hhbEFzKFVubWFuYWdlZFR5cGUuQnlWYWxUU3RyLCBTaXplQ29uc3QgPSA2NCldIHB1YmxpYyBzdHJpbmcgc3RyU2VydmljZVNob3J0TmFtZTsgcHVibGljIFJNX0FQUF9UWVBFIEFwcGxpY2F0aW9uVHlwZTsgcHVibGljIHVpbnQgQXBwU3RhdHVzOyBwdWJsaWMgdWludCBUU1Nlc3Npb25JZDsgW01hcnNoYWxBcyhVbm1hbmFnZWRUeXBlLkJvb2wpXSBwdWJsaWMgYm9vbCBiUmVzdGFydGFibGU7IH0gcHVibGljIHN0YXRpYyBjbGFzcyBOYXRpdmUgeyBbRGxsSW1wb3J0KCJyc3RydG1nci5kbGwiLCBDaGFyU2V0PUNoYXJTZXQuVW5pY29kZSldIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGludCBSbVN0YXJ0U2Vzc2lvbihvdXQgdWludCBwU2Vzc2lvbkhhbmRsZSwgaW50IGR3U2Vzc2lvbkZsYWdzLCBTdHJpbmdCdWlsZGVyIHN0clNlc3Npb25LZXkpOyBbRGxsSW1wb3J0KCJyc3RydG1nci5kbGwiLCBDaGFyU2V0PUNoYXJTZXQuVW5pY29kZSldIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGludCBSbVJlZ2lzdGVyUmVzb3VyY2VzKHVpbnQgZHdTZXNzaW9uSGFuZGxlLCBVSW50MzIgbkZpbGVzLCBzdHJpbmdbXSByZ3NGaWxlbmFtZXMsIFVJbnQzMiBuQXBwbGljYXRpb25zLCBJbnRQdHIgcmdBcHBsaWNhdGlvbnMsIFVJbnQzMiBuU2VydmljZXMsIHN0cmluZ1tdIHJnc1NlcnZpY2VOYW1lcyk7IFtEbGxJbXBvcnQoInJzdHJ0bWdyLmRsbCIpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBpbnQgUm1HZXRMaXN0KHVpbnQgZHdTZXNzaW9uSGFuZGxlLCBvdXQgdWludCBwblByb2NJbmZvTmVlZGVkLCByZWYgdWludCBwblByb2NJbmZvLCBbSW4sIE91dF0gUk1fUFJPQ0VTU19JTkZPW10gcmdBZmZlY3RlZEFwcHMsIHJlZiB1aW50IGxwZHdSZWJvb3RSZWFzb25zKTsgW0RsbEltcG9ydCgicnN0cnRtZ3IuZGxsIildIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGludCBSbUVuZFNlc3Npb24odWludCBwU2Vzc2lvbkhhbmRsZSk7IH0gfQ==')); \
      Add-Type -TypeDefinition $$source -ErrorAction Stop; \
      $$session = [uint32]0; $$key = New-Object System.Text.StringBuilder 64; \
      $$result = [WinkGo.RestartManager.Native]::RmStartSession([ref]$$session, 0, $$key); \
      if ($$result -ne 0) { throw \"RmStartSession=$$result\" } \
      try { \
        $$ERROR_MORE_DATA = 234; \
        $$ERROR_ACCESS_DENIED = 5; \
        $$resources = @(); \
        if ($$targetPath -and (Test-Path -LiteralPath $$targetPath -PathType Leaf)) { \
          $$resources = @([System.IO.Path]::GetFullPath($$targetPath)); \
        } elseif ($$targetPath -and (Test-Path -LiteralPath $$targetPath -PathType Container)) { \
          $$root = [System.IO.Path]::GetFullPath($$targetPath); \
          $$topLevel = @(Get-ChildItem -LiteralPath $$root -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $$_.FullName }); \
          $$knownRelative = @('${WINKGO_APP_EXECUTABLE_FILENAME}', '${UNINSTALL_FILENAME}', 'resources\app.asar', 'resources\app-update.yml', 'resources\bundled-winkgo-core\win32-x64\winkgo-core.exe'); \
          $$known = @($$knownRelative | ForEach-Object { Join-Path $$root $$_ } | Where-Object { Test-Path -LiteralPath $$_ -PathType Leaf }); \
          $$resources = @($$topLevel + $$known | Where-Object { $$_ -and $$_.Trim().Length -gt 0 } | Select-Object -Unique | Select-Object -First 512); \
        } \
        $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-query-start'; target = $$targetPath; resources = $$resources.Count; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
        Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
        if ($$resources.Count -eq 0) { \
          if ($$installerSelfLock -and $$installerPid -gt 0) { \
            $$lockerText = 'WINK GO installer(' + $$installerPid + ')'; \
            [System.IO.File]::WriteAllText($$lockerListPath, $$lockerText, (New-Object System.Text.UTF8Encoding $$false)); \
            $$selfLockers = @([pscustomobject]@{ name = 'WINK GO installer'; pid = [int]$$installerPid }); \
            $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = 0; count = 1; blockingProcesses = @($$selfLockers); fallbackReason = 'installer-self-lock'; message = 'The installer process is using the install directory as its current output directory.'; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$true }; \
            Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 10); \
            exit 0 \
          }; \
          $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = 0; count = 0; blockingProcesses = @(); fallbackReason = 'restart-manager-no-resources'; message = 'Restart Manager had no existing files to query for this path.'; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
          exit 1 \
        } \
        for ($$i = 0; $$i -lt $$resources.Count; $$i += 256) { \
          $$end = [Math]::Min($$i + 255, $$resources.Count - 1); \
          $$chunk = [string[]]$$resources[$$i..$$end]; \
          $$result = [WinkGo.RestartManager.Native]::RmRegisterResources($$session, [uint32]$$chunk.Count, $$chunk, 0, [IntPtr]::Zero, 0, $$null); \
          if ($$result -ne 0) { throw \"RmRegisterResources=$$result\" } \
        } \
        $$needed = [uint32]0; $$count = [uint32]0; $$reasons = [uint32]0; \
        for ($$attempt = 0; $$attempt -lt 6; $$attempt++) { \
          if ($$attempt -gt 0) { Start-Sleep -Milliseconds (50 * $$attempt) } \
          $$needed = [uint32]0; $$count = [uint32]0; $$reasons = [uint32]0; \
          $$result = [WinkGo.RestartManager.Native]::RmGetList($$session, [ref]$$needed, [ref]$$count, $$null, [ref]$$reasons); \
          if ($$result -ne $$ERROR_ACCESS_DENIED) { break } \
        } \
        if ($$result -ne 0 -and $$result -ne 234) { throw \"RmGetList=$$result\" } \
        $$lockers = @(); \
        if ($$result -eq $$ERROR_MORE_DATA -or $$needed -gt 0) { \
          for ($$attempt = 0; $$attempt -lt 6; $$attempt++) { \
            if ($$attempt -gt 0) { Start-Sleep -Milliseconds (50 * $$attempt) } \
            $$count = $$needed; \
            $$apps = New-Object 'WinkGo.RestartManager.RM_PROCESS_INFO[]' $$count; \
            $$result = [WinkGo.RestartManager.Native]::RmGetList($$session, [ref]$$needed, [ref]$$count, $$apps, [ref]$$reasons); \
            if ($$result -ne $$ERROR_ACCESS_DENIED -and $$result -ne $$ERROR_MORE_DATA) { break } \
          } \
          if ($$result -ne 0) { throw \"RmGetList=$$result\" } \
          $$lockers = @($$apps | Select-Object -First $$count | Where-Object { $$_.Process.dwProcessId -gt 0 } | ForEach-Object { \
            $$name = $$_.strAppName; \
            if (-not $$name) { $$proc = Get-Process -Id $$_.Process.dwProcessId -ErrorAction SilentlyContinue; if ($$proc) { $$name = $$proc.ProcessName } } \
            if (-not $$name) { $$name = 'unknown' } \
            [pscustomobject]@{ name = $$name; pid = [int]$$_.Process.dwProcessId } \
          }); \
        } \
        if ($$lockers.Count -eq 0 -and $$installerSelfLock -and $$installerPid -gt 0) { $$lockers = @([pscustomobject]@{ name = 'WINK GO installer'; pid = [int]$$installerPid }) }; \
        $$lockerText = @($$lockers | ForEach-Object { $$_.name + '(' + $$_.pid + ')' }) -join ', '; \
        [System.IO.File]::WriteAllText($$lockerListPath, $$lockerText, (New-Object System.Text.UTF8Encoding $$false)); \
        $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = $$resources.Count; count = $$needed; blockingProcesses = @($$lockers); fallbackReason = ''; message = ''; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
        if ($$installerSelfLock -and $$lockers.Count -gt 0) { $$payload.fallbackReason = 'installer-self-lock'; $$payload.message = 'The installer process is using the install directory as its current output directory.' } elseif ($$lockers.Count -eq 0) { $$payload.fallbackReason = 'restart-manager-no-process'; $$payload.message = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' }; \
        Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 10); \
        if ($$lockers.Count -gt 0) { exit 0 } else { exit 1 } \
      } finally { [void][WinkGo.RestartManager.Native]::RmEndSession($$session) } \
    } catch { \
      $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-error'; target = $$targetPath; error = $$_.Exception.Message }; \
      Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
      exit 1 \
    } \
  }"`
  Pop ${_RETURN}
!macroend

!macro WINKGO_QUERY_LOCKERS _TARGET_PATH _RETURN
  InitPluginsDir
  File /oname=$PLUGINSDIR\winkgo-query-lockers.ps1 "${PROJECT_DIR}\resources\windows\support\query-lockers.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\winkgo-query-lockers.ps1" -LogPath "$WinkGoSessionLogPath" -InstDir "$INSTDIR" -TargetPath "${_TARGET_PATH}" -LockerListPath "$PLUGINSDIR\winkgo-rm-lockers.txt" -Session "$WinkGoSessionId" -Version "${VERSION}" -Arch "${WINKGO_TARGET_ARCH}" -Updated "$WinkGoIsUpdated" -CurrentOutDir "$WinkGoCurrentOutDir"`
  Pop ${_RETURN}
!macroend

!macro WINKGO_CAPTURE_FAILED_PATH_LOCKERS _FAILED_PATH
  !insertmacro WINKGO_QUERY_LOCKERS "${_FAILED_PATH}" $WinkGoLockerResult
  StrCpy $WinkGoLockerList ""
  ClearErrors
  SetDetailsPrint none
  FileOpen $WinkGoLockerListFile "$PLUGINSDIR\winkgo-rm-lockers.txt" r
  ${IfNot} ${Errors}
    FileRead $WinkGoLockerListFile $WinkGoLockerList
    FileClose $WinkGoLockerListFile
  ${EndIf}
  SetDetailsPrint lastused
  ${If} $WinkGoLockerList == ""
    ${If} $WinkGoLockerResult == 0
      StrCpy $WinkGoLockerList "${WINKGO_MSG_UNKNOWN_PROCESS_EN}"
      StrCpy $WinkGoLockerListZh "${WINKGO_MSG_UNKNOWN_PROCESS_ZH}"
      StrCpy $WinkGoLockerListEn "${WINKGO_MSG_UNKNOWN_PROCESS_EN}"
    ${Else}
      StrCpy $WinkGoLockerList "${WINKGO_MSG_LOCKER_UNKNOWN_EN}"
      StrCpy $WinkGoLockerListZh "${WINKGO_MSG_LOCKER_UNKNOWN_ZH}"
      StrCpy $WinkGoLockerListEn "${WINKGO_MSG_LOCKER_UNKNOWN_EN}"
    ${EndIf}
  ${Else}
    StrCpy $WinkGoLockerListZh "$WinkGoLockerList"
    StrCpy $WinkGoLockerListEn "$WinkGoLockerList"
  ${EndIf}
!macroend

!macro WINKGO_PROMPT_FAILED_PATH_LOCKERS _FAILED_PATH _PHASE _RETRY_LABEL _CANCEL_LABEL _CONTINUE_LABEL
  !insertmacro WINKGO_CAPTURE_FAILED_PATH_LOCKERS "${_FAILED_PATH}"
  ${If} $WinkGoLockerResult == 0
    ${IfNot} ${Silent}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${WINKGO_MSG_FILE_OR_FOLDER_IN_USE_ZH}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${WINKGO_MSG_APPLICATION_USING_IT_ZH}$\r$\n$WinkGoLockerListZh$\r$\n$\r$\n${WINKGO_MSG_CLOSE_LISTED_RETRY_ZH}$\r$\n$\r$\n${WINKGO_MSG_INSTALLER_LOG_ZH}:$\r$\n$WinkGoSessionLogPath$\r$\n$\r$\n${WINKGO_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${WINKGO_MSG_FILE_OR_FOLDER_IN_USE_EN}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${WINKGO_MSG_APPLICATION_USING_IT_EN}$\r$\n$WinkGoLockerListEn$\r$\n$\r$\n${WINKGO_MSG_CLOSE_LISTED_RETRY_EN}$\r$\n$\r$\n${WINKGO_MSG_INSTALLER_LOG_EN}:$\r$\n$WinkGoSessionLogPath" /SD IDCANCEL IDRETRY ${_RETRY_LABEL} IDCANCEL ${_CANCEL_LABEL}
    ${EndIf}
  ${EndIf}
  Goto ${_CONTINUE_LABEL}
!macroend

!macro WINKGO_WRITE_INSTALLER_LAST_FAILURE_MARKER
  Push $9
  ${If} $WinkGoIsUpdated == "1"
    ${If} ${Silent}
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
        $$ErrorActionPreference = 'Stop'; \
        $$appDir = Join-Path $$env:APPDATA 'WINK GO'; \
        $$marker = Join-Path $$appDir 'installer-last-failure.json'; \
        $$log = '$WinkGoSessionLogPath'; \
        if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
        try { \
          New-Item -ItemType Directory -Path $$appDir -Force | Out-Null; \
          $$payload = [ordered]@{ \
            schemaVersion = 1; \
            kind = 'app-cannot-be-closed'; \
            phase = 'customCheckAppRunning'; \
            silent = $$true; \
            updated = $$true; \
            retryCount = 3; \
            instDir = '$INSTDIR'; \
            logPath = $$log; \
            at = (Get-Date -Format o) \
          }; \
          $$json = $$payload | ConvertTo-Json -Compress -Depth 4; \
          [System.IO.File]::WriteAllText($$marker, $$json, (New-Object System.Text.UTF8Encoding $$false)); \
          $$logPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'marker-write'; result = 'ok'; path = $$marker; marker = $$payload }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$logPayload | ConvertTo-Json -Compress -Depth 8) \
        } catch { \
          $$logPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'marker-write'; result = 'failed'; path = $$marker; error = $$_.Exception.Message }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$logPayload | ConvertTo-Json -Compress -Depth 8) \
        } \
      }"`
      Pop $9
    ${EndIf}
  ${EndIf}
  Pop $9
!macroend

!macro customCheckAppRunning
  Var /GLOBAL WinkGoCheckResult
  Var /GLOBAL WinkGoCloseRetries
  InitPluginsDir
  !insertmacro WINKGO_SESSION_BEGIN

  !insertmacro WINKGO_WAIT_FOR_UPDATED_APP_EXIT
  !insertmacro WINKGO_FIND_APP_PROCESS $WinkGoCheckResult
  ${If} $WinkGoCheckResult == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK winkgo_do_stop_process
    !insertmacro WINKGO_CLEAR_ACTIVE_INSTALLER_MARKER
    Quit

    winkgo_do_stop_process:
      DetailPrint "$(appClosing)"
      !insertmacro WINKGO_STOP_APP_PROCESSES
      StrCpy $WinkGoCloseRetries 0

    winkgo_wait_for_close:
      Sleep 1000
      !insertmacro WINKGO_FIND_APP_PROCESS $WinkGoCheckResult
      ${If} $WinkGoCheckResult == 0
        IntOp $WinkGoCloseRetries $WinkGoCloseRetries + 1
        ${If} $WinkGoCloseRetries > 10
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH}$\r$\n$\r$\n${WINKGO_MSG_MAY_USE_INSTALL_DIR_ZH}$\r$\n$INSTDIR$\r$\n$\r$\n${WINKGO_MSG_RETRY_AFTER_CLOSING_DIR_ZH}$\r$\n$\r$\n${WINKGO_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_EN}$\r$\n$\r$\n${WINKGO_MSG_MAY_USE_INSTALL_DIR_EN}$\r$\n$INSTDIR$\r$\n$\r$\n${WINKGO_MSG_RETRY_AFTER_CLOSING_DIR_EN}" /SD IDCANCEL IDRETRY winkgo_wait_for_close
          !insertmacro WINKGO_WRITE_INSTALLER_LAST_FAILURE_MARKER
          !insertmacro WINKGO_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS ${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=app-cannot-be-closed retryCount=$WinkGoCloseRetries instDir=$INSTDIR" "${WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_EN}" "${WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH}" "${WINKGO_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${WINKGO_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}" "app-cannot-be-closed retryCount=$WinkGoCloseRetries instDir=$INSTDIR" "app-cannot-be-closed retryCount=$WinkGoCloseRetries instDir=$INSTDIR"
        ${Else}
          !insertmacro WINKGO_STOP_APP_PROCESSES
          Goto winkgo_wait_for_close
        ${EndIf}
      ${EndIf}
  ${EndIf}

!macroend

!endif

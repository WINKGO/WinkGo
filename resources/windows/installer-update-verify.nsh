; Modified from AionUI by WINK GO contributors in 2026.
!ifndef WINKGO_INSTALLER_UPDATE_VERIFY_NSH
!define WINKGO_INSTALLER_UPDATE_VERIFY_NSH

Var /GLOBAL WinkGoUninstallHadErrors
Var /GLOBAL WinkGoUninstallLogResult
Var /GLOBAL WinkGoVerifyResourceResult
Var /GLOBAL WinkGoUpdatedAppExitWaitResult
Var /GLOBAL WinkGoActiveMarkerExecResult
Var /GLOBAL WinkGoActiveMarkerResult

!define WINKGO_ACTIVE_INSTALLER_MARKER "winkgo-installer-active.marker"

!macro WINKGO_BRING_UPDATED_INSTALLER_TO_FRONT
  ${If} ${isUpdated}
    BringToFront
    !insertmacro WINKGO_SLOG "event=updated-installer-foreground action=bring-to-front"
  ${EndIf}
!macroend

!macro WINKGO_WAIT_FOR_UPDATED_APP_EXIT
  ${If} ${isUpdated}
    !insertmacro WINKGO_SLOG "event=updated-app-exit-wait phase=start"
    StrCpy $WinkGoUpdatedAppExitWaitResult "0"

    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      $$deadline = (Get-Date).AddSeconds(10); \
      $$target = [System.IO.Path]::GetFullPath((Join-Path '$INSTDIR' '${WINKGO_APP_EXECUTABLE_FILENAME}')); \
      do { \
        $$hits = @(Get-CimInstance -ClassName Win32_Process | Where-Object { \
          $$path = $$_.ExecutablePath; \
          if (-not $$path) { $$path = $$_.Path } \
          $$_.Name -ieq '${WINKGO_APP_EXECUTABLE_FILENAME}' -and $$path -and \
          [string]::Equals([System.IO.Path]::GetFullPath($$path), $$target, [System.StringComparison]::CurrentCultureIgnoreCase) \
        }); \
        if ($$hits.Count -eq 0) { exit 0 }; \
        Start-Sleep -Milliseconds 500; \
      } while ((Get-Date) -lt $$deadline); \
      exit 1 \
    }"`
    Pop $WinkGoUpdatedAppExitWaitResult

    ${If} $WinkGoUpdatedAppExitWaitResult != 0
      !insertmacro WINKGO_SLOG "event=updated-app-exit-wait phase=timeout action=stop"
      !insertmacro WINKGO_STOP_APP_PROCESSES
    ${EndIf}

    !insertmacro WINKGO_SLOG "event=updated-app-exit-wait phase=done result=$WinkGoUpdatedAppExitWaitResult"
  ${EndIf}
!macroend

!macro WINKGO_RECORD_ACTIVE_INSTALLER_MARKER
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${WINKGO_ACTIVE_INSTALLER_MARKER}'; \
    if (-not (Test-Path -LiteralPath $$marker)) { Write-Output 'missing'; exit 0 }; \
    $$item = Get-Item -LiteralPath $$marker; \
    if ($$item.LastWriteTime -lt (Get-Date).AddHours(-2)) { Write-Output 'stale'; exit 0 }; \
    Write-Output 'active' \
  }"`
  Pop $WinkGoActiveMarkerExecResult
  Pop $WinkGoActiveMarkerResult
  ${If} $WinkGoActiveMarkerResult == "active"
    !insertmacro WINKGO_SLOG "event=installer-active-marker state=active"
  ${ElseIf} $WinkGoActiveMarkerResult == "stale"
    !insertmacro WINKGO_SLOG "event=installer-active-marker state=stale"
  ${Else}
    !insertmacro WINKGO_SLOG "event=installer-active-marker state=missing"
  ${EndIf}
!macroend

!macro WINKGO_WRITE_ACTIVE_INSTALLER_MARKER
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${WINKGO_ACTIVE_INSTALLER_MARKER}'; \
    Set-Content -LiteralPath $$marker -Encoding UTF8 -Value ('pid=' + $$PID + ';session=$WinkGoSessionId;started=' + (Get-Date -Format o)) \
  }"`
  Pop $WinkGoActiveMarkerResult
!macroend

!macro WINKGO_CLEAR_ACTIVE_INSTALLER_MARKER
  !ifndef BUILD_UNINSTALLER
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      Remove-Item -LiteralPath (Join-Path $$env:TEMP '${WINKGO_ACTIVE_INSTALLER_MARKER}') -Force \
    }"`
    Pop $WinkGoActiveMarkerResult
  !endif
!macroend

!macro WINKGO_OVERRIDE_SINGLE_INSTANCE
!macroend

!macro WINKGO_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
  !pragma warning disable 6030
  LangString appCannotBeClosed 1033 "${WINKGO_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${WINKGO_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${WINKGO_MSG_APP_CANNOT_BE_CLOSED_EN}"
  LangString appCannotBeClosed 2052 "${WINKGO_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${WINKGO_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${WINKGO_MSG_APP_CANNOT_BE_CLOSED_EN}"
  !pragma warning default 6030
!macroend

!macro WINKGO_INSTALLER_CUSTOM_HEADER
  !insertmacro WINKGO_OVERRIDE_SINGLE_INSTANCE
  !insertmacro WINKGO_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
!macroend

!macro WINKGO_RELEASE_INSTALL_DIR_OUTDIR
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  StrCpy $WinkGoCurrentOutDir "$PLUGINSDIR"
!macroend

; Resolve the machine's real native architecture (arm64 / x64 / x86) for diagnostics.
; Backed by IsWow64Process2 (via x64.nsh), so it reports the true hardware arch even when
; the installer runs under x86/x64 emulation. Replaces the old hardcoded "non-arm64" detail.
!macro WINKGO_DETECT_NATIVE_ARCH _OUT
  ${If} ${IsNativeARM64}
    StrCpy ${_OUT} "arm64"
  ${ElseIf} ${RunningX64}
    StrCpy ${_OUT} "x64"
  ${Else}
    StrCpy ${_OUT} "x86"
  ${EndIf}
!macroend

!macro WINKGO_INSTALLER_PREINIT
  !ifdef BUILD_UNINSTALLER
    StrCpy $WinkGoSessionId ""
    StrCpy $WinkGoIsUpdated "0"
    StrCpy $WinkGoSessionLogResult ""
    StrCpy $WinkGoSessionLogPath "$TEMP\${WINKGO_FALLBACK_LOG}"
    StrCpy $WinkGoUninstallHadErrors "0"
    StrCpy $WinkGoUninstallLogResult ""
    StrCpy $WinkGoVerifyResourceResult ""
    StrCpy $WinkGoUpdatedAppExitWaitResult ""
    StrCpy $WinkGoActiveMarkerExecResult ""
    StrCpy $WinkGoActiveMarkerResult ""
    StrCpy $WinkGoStopResult ""
    StrCpy $WinkGoLockerListZh ""
    StrCpy $WinkGoLockerListEn ""
  !else
    !insertmacro WINKGO_RELEASE_INSTALL_DIR_OUTDIR
    !insertmacro WINKGO_SESSION_BEGIN
    !insertmacro WINKGO_SLOG "event=installer-outdir-release outDir=$WinkGoCurrentOutDir instDir=$INSTDIR"
    ; Guard target/machine architecture as early as possible: this runs before customInit's
    ; registry heal/clear/repair, so a wrong-arch installer aborts without mutating an existing
    ; correct-arch install's registry or uninstaller state. (Sentry ELECTRON-3BX / code E1040)
    !insertmacro WINKGO_ASSERT_TARGET_ARCH
    !insertmacro WINKGO_BRING_UPDATED_INSTALLER_TO_FRONT
    !insertmacro WINKGO_RECORD_ACTIVE_INSTALLER_MARKER
    !insertmacro WINKGO_WRITE_ACTIVE_INSTALLER_MARKER
  !endif
!macroend

!macro WINKGO_VERIFY_REQUIRED_FILE _PATH _LABEL
  ${IfNot} ${FileExists} "${_PATH}"
    !insertmacro WINKGO_LOG_EVENT "verify-required-file missing label=${_LABEL} path=${_PATH}"
    !insertmacro WINKGO_FAIL_UX \
      "${WINKGO_E_CORE_APP_FILES_INCOMPLETE}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "${WINKGO_MSG_VERIFY_REQUIRED_FILE_ZH} ${_LABEL}" \
      "${WINKGO_MSG_VERIFY_REQUIRED_FILE_EN} ${_LABEL}" \
      "${WINKGO_MSG_VERIFY_REQUIRED_FILE_ACTION_ZH}" \
      "${WINKGO_MSG_VERIFY_REQUIRED_FILE_ACTION_EN}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}"
  ${EndIf}
!macroend

!macro WINKGO_VERIFY_CORE_APP_FILES
  !insertmacro WINKGO_LOG_EVENT "verify-install start instDir=$INSTDIR"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\${WINKGO_APP_EXECUTABLE_FILENAME}" "${WINKGO_APP_EXECUTABLE_FILENAME}"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\ffmpeg.dll" "ffmpeg.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\libEGL.dll" "libEGL.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\libGLESv2.dll" "libGLESv2.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\d3dcompiler_47.dll" "d3dcompiler_47.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\dxcompiler.dll" "dxcompiler.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\dxil.dll" "dxil.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\vk_swiftshader.dll" "vk_swiftshader.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\vulkan-1.dll" "vulkan-1.dll"
  !insertmacro WINKGO_VERIFY_REQUIRED_FILE "$INSTDIR\resources\app.asar" "resources\app.asar"
!macroend

!macro WINKGO_VERIFY_BUNDLED_WINKGO_CORE_RESOURCES _RUNTIME_KEY
  InitPluginsDir
  File "/oname=$PLUGINSDIR\verify-bundled-winkgo-core-install.ps1" "${PROJECT_DIR}\resources\windows\support\verify-bundled-winkgo-core-install.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\verify-bundled-winkgo-core-install.ps1" -InstallDir "$INSTDIR" -RuntimeKey "${_RUNTIME_KEY}" -LogPath "$WinkGoSessionLogPath"`
  Pop $WinkGoVerifyResourceResult

  ${If} $WinkGoVerifyResourceResult != 0
    !insertmacro WINKGO_FAIL_UX \
      "${WINKGO_E_BUNDLED_WINKGO_CORE_INCOMPLETE}" \
      "event=session-end result=fail code=${WINKGO_E_BUNDLED_WINKGO_CORE_INCOMPLETE} detail=bundled-winkgo-core-incomplete runtime=${_RUNTIME_KEY} result=$WinkGoVerifyResourceResult" \
      "${WINKGO_MSG_BUNDLED_WINKGO_CORE_INCOMPLETE_ZH}" \
      "${WINKGO_MSG_BUNDLED_WINKGO_CORE_INCOMPLETE_EN}" \
      "${WINKGO_MSG_BUNDLED_WINKGO_CORE_INCOMPLETE_ACTION_ZH}" \
      "${WINKGO_MSG_BUNDLED_WINKGO_CORE_INCOMPLETE_ACTION_EN}" \
      "bundled-winkgo-core-incomplete runtime=${_RUNTIME_KEY} result=$WinkGoVerifyResourceResult instDir=$INSTDIR" \
      "bundled-winkgo-core-incomplete runtime=${_RUNTIME_KEY} result=$WinkGoVerifyResourceResult instDir=$INSTDIR"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro WINKGO_VERIFY_CORE_APP_FILES
  !insertmacro WINKGO_VERIFY_BUNDLED_WINKGO_CORE_RESOURCES "${WINKGO_RUNTIME_KEY}"
  !insertmacro WINKGO_LOG_EVENT "verify-install ok instDir=$INSTDIR"
  !insertmacro WINKGO_CLEAR_ACTIVE_INSTALLER_MARKER
  !insertmacro WINKGO_SESSION_SUCCESS
!macroend

!endif

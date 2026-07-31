; Modified from AionUI by WINK GO contributors in 2026.
!ifndef WINKGO_INSTALLER_REMOVE_REGISTRY_NSH
!define WINKGO_INSTALLER_REMOVE_REGISTRY_NSH

!macro WINKGO_CLEAR_INSTALL_REGISTRY _REASON
  DeleteRegKey SHCTX "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHCTX "${INSTALL_REGISTRY_KEY}"
  !insertmacro WINKGO_LOG_EVENT "event=registry-clear reason=${_REASON} uninstallKey=${UNINSTALL_REGISTRY_KEY} installKey=${INSTALL_REGISTRY_KEY}"
!macroend

!macro WINKGO_LOG_ATOMIC_REMOVE_FAILURE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$failed = '$WinkGoAtomicFailedPath'; \
    $$instDir = '$INSTDIR'; \
    $$oldInstallDir = '$WinkGoAtomicStagingDir'; \
    $$relative = $$failed; \
    if ($$failed.StartsWith($$instDir, [System.StringComparison]::CurrentCultureIgnoreCase)) { $$relative = $$failed.Substring($$instDir.Length).TrimStart('\') }; \
    $$tempCandidate = if ($$relative -and $$relative -ne $$failed) { Join-Path $$oldInstallDir $$relative } else { '' }; \
    $$kind = if ($$tempCandidate.Length -ge 260) { 'likely-long-path' } else { 'unknown' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-atomic-failed'; kind = $$kind; pathLength = $$failed.Length; tempCandidateLength = $$tempCandidate.Length; atomicFailedPath = $$failed; tempCandidate = $$tempCandidate }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $9
  Pop $9
!macroend

!macro WINKGO_LOG_REMOVE_FAILURE_JSON _PHASE _FATAL _FAILED_PATH _EXTRA_FIELDS
  !insertmacro WINKGO_LOG_JSON_EVENT "failure" "$$lockerText = '$WinkGoLockerList'; $$processes = @(); if ($$lockerText -and $$lockerText -notlike 'Windows did not identify*' -and $$lockerText -ne 'unknown process') { $$processes = @($$lockerText -split ',\s*' | Where-Object { $$_ } | ForEach-Object { if ($$_ -match '^(.*)\(([0-9]+)\)$$') { [ordered]@{ name = $$Matches[1]; pid = [int]$$Matches[2] } } else { [ordered]@{ name = $$_; pid = $$null } } }) }; $$payload.code = '${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED}'; $$payload.phase = '${_PHASE}'; $$payload.failedPath = '${_FAILED_PATH}'; $$payload.blockingProcesses = @($$processes); if ($$lockerText -like 'WINK GO installer(*)') { $$payload.fallbackReason = 'installer-self-lock'; $$payload.message = 'The installer process is using the install directory as its current output directory.' } elseif ($$processes.Count -eq 0) { $$payload.fallbackReason = 'restart-manager-no-process'; $$payload.message = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' } else { $$payload.fallbackReason = ''; $$payload.message = '' }; $$payload.fatal = ('${_FATAL}' -eq '1'); ${_EXTRA_FIELDS}"
!macroend

!macro WINKGO_REMOVE_INSTALL_DIR
  StrCpy $WinkGoRemoveResidueCount "0"
  ${If} $WinkGoRemoveResidueRoot == ""
    StrCpy $WinkGoRemoveResidueRoot "$INSTDIR"
  ${EndIf}
  StrCpy $WinkGoRemoveFirstFailedPath ""
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'Continue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$path = [System.IO.Path]::GetFullPath('$WinkGoRemoveResidueRoot'); \
    $$firstFailedFile = '$PLUGINSDIR\winkgo-remove-first-failed.txt'; \
    Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value ''; \
    function Write-InstallerLog($$message) { $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$WinkGoSessionId'; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-log'; message = $$message }; if ($$message -match '(^|\s)event=([^\s]+)') { $$payload.event = $$Matches[2] }; Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) } \
    function Convert-LongPath($$itemPath) { if ($$itemPath.StartsWith('\\')) { return '\\?\UNC\' + $$itemPath.TrimStart('\') } return '\\?\' + $$itemPath } \
    function Remove-WithRetries($$item, $$isDir) { \
      $$delays = @(200,500,1000); \
      for ($$i = 0; $$i -lt $$delays.Count; $$i++) { \
        try { \
          if ($$isDir) { [System.IO.Directory]::Delete((Convert-LongPath $$item), $$false) } else { [System.IO.File]::Delete((Convert-LongPath $$item)) } \
          return $$true \
        } catch { \
          if ($$i -lt $$delays.Count - 1) { Start-Sleep -Milliseconds $$delays[$$i] } else { Write-InstallerLog ('event=remove-resilient-leftover path=' + $$item + ' attempts=3 error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); return $$false } \
        } \
      } \
      return $$false \
    } \
    try { \
      if (-not (Test-Path -LiteralPath $$path)) { Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); exit 0 } \
      $$failed = New-Object System.Collections.Generic.List[string]; \
      foreach ($$file in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$file.FullName $$false)) { $$failed.Add($$file.FullName) } } \
      foreach ($$dir in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$dir.FullName $$true)) { $$failed.Add($$dir.FullName) } } \
      if (-not (Remove-WithRetries $$path $$true)) { $$failed.Add($$path) } \
      Write-InstallerLog ('event=remove-resilient-summary failedCount=' + $$failed.Count + ' root=' + $$path); \
      if ($$failed.Count -gt 0) { Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value $$failed[0]; exit $$failed.Count } \
      Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); \
      exit 0 \
    } catch { \
      Write-InstallerLog ('remove-longpath result=1 instDir=' + $$path + ' error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); \
      exit 1 \
    } \
  }"`
  Pop $WinkGoRemoveDirResult

  ClearErrors
  SetDetailsPrint none
  FileOpen $WinkGoRemoveFirstFailedFile "$PLUGINSDIR\winkgo-remove-first-failed.txt" r
  ${IfNot} ${Errors}
    FileRead $WinkGoRemoveFirstFailedFile $WinkGoRemoveFirstFailedPath
    FileClose $WinkGoRemoveFirstFailedFile
  ${EndIf}
  SetDetailsPrint lastused

  ${If} $WinkGoRemoveDirResult == "error"
    !insertmacro WINKGO_LOG_EVENT "event=remove-longpath fallback=RMDir reason=no-powershell root=$INSTDIR"
    RMDir /r "$WinkGoRemoveResidueRoot"
    ${If} ${FileExists} "$WinkGoRemoveResidueRoot\*.*"
      StrCpy $WinkGoRemoveDirResult "1"
    ${Else}
      StrCpy $WinkGoRemoveDirResult "0"
    ${EndIf}
  ${EndIf}

  ${If} $WinkGoRemoveDirResult != 0
    StrCpy $WinkGoRemoveResidueCount $WinkGoRemoveDirResult
  ${EndIf}
!macroend

!macro customRemoveFiles
  !insertmacro WINKGO_LOG_EVENT "remove-start instDir=$INSTDIR"
  Var /GLOBAL WinkGoRemoveDirResult
  Var /GLOBAL WinkGoAtomicFailedPath
  Var /GLOBAL WinkGoAtomicRemoveSucceeded
  Var /GLOBAL WinkGoAtomicStagingDir
  Var /GLOBAL WinkGoRemoveResidueCount
  Var /GLOBAL WinkGoRemoveResidueRoot
  Var /GLOBAL WinkGoRemoveFirstFailedPath
  Var /GLOBAL WinkGoRemoveFirstFailedFile
  StrCpy $WinkGoAtomicFailedPath ""
  StrCpy $WinkGoAtomicRemoveSucceeded "0"
  StrCpy $WinkGoAtomicStagingDir ""
  StrCpy $WinkGoRemoveResidueCount "0"
  StrCpy $WinkGoRemoveResidueRoot "$INSTDIR"
  StrCpy $WinkGoRemoveFirstFailedPath ""

  SetOutPath $TEMP
  StrCpy $WinkGoCurrentOutDir "$TEMP"

  ${if} ${isUpdated}
    StrCpy $WinkGoAtomicStagingDir "$INSTDIR.__old"
    ${If} ${FileExists} "$WinkGoAtomicStagingDir\*.*"
      StrCpy $WinkGoRemoveResidueRoot "$WinkGoAtomicStagingDir"
      !insertmacro WINKGO_LOG_EVENT "remove-stale-staging start root=$WinkGoRemoveResidueRoot"
      !insertmacro WINKGO_REMOVE_INSTALL_DIR
      StrCpy $WinkGoRemoveResidueRoot "$INSTDIR"
    ${EndIf}

    winkgo_retry_atomic_rename:
      ClearErrors
      Rename "$INSTDIR" "$WinkGoAtomicStagingDir"
    ${if} ${Errors}
      DetailPrint "Atomic update cleanup failed before replacing previous installation: $INSTDIR"
      StrCpy $WinkGoAtomicFailedPath "$INSTDIR"
      !insertmacro WINKGO_LOG_ATOMIC_REMOVE_FAILURE
      !insertmacro WINKGO_CAPTURE_FAILED_PATH_LOCKERS "$WinkGoAtomicFailedPath"
      ${IfNot} ${Silent}
        !insertmacro WINKGO_PROMPT_FAILED_PATH_LOCKERS "$WinkGoAtomicFailedPath" "atomic-failed" winkgo_retry_atomic_rename winkgo_cancel_atomic_rename winkgo_continue_atomic_failed
        winkgo_cancel_atomic_rename:
      ${EndIf}
      winkgo_continue_atomic_failed:
      !insertmacro WINKGO_LOG_REMOVE_FAILURE_JSON "atomic-failed" "1" "$WinkGoAtomicFailedPath" "$$payload.atomicFailedPath = '$WinkGoAtomicFailedPath'"
      !insertmacro WINKGO_LOG_EVENT "code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 degraded=none firstFailed=$WinkGoAtomicFailedPath atomicFailedPath=$WinkGoAtomicFailedPath"
      !insertmacro WINKGO_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro WINKGO_FAIL_REPORTABLE_BILINGUAL ${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 firstFailed=$WinkGoAtomicFailedPath lockers=$WinkGoLockerList" "${WINKGO_MSG_REPLACE_LOCKED_EN}" "${WINKGO_MSG_REPLACE_LOCKED_ZH}" "${WINKGO_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${WINKGO_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
    ${else}
      !insertmacro WINKGO_LOG_EVENT "remove-atomic result=0 staging=$WinkGoAtomicStagingDir"
      StrCpy $WinkGoAtomicRemoveSucceeded "1"
      StrCpy $WinkGoRemoveResidueRoot "$WinkGoAtomicStagingDir"
    ${endif}
  ${endif}

  winkgo_retry_remove_install_dir:
    !insertmacro WINKGO_REMOVE_INSTALL_DIR
  ${if} $WinkGoRemoveDirResult != 0
    !insertmacro WINKGO_CAPTURE_FAILED_PATH_LOCKERS "$WinkGoRemoveFirstFailedPath"
    ${if} $WinkGoAtomicRemoveSucceeded == "1"
      ${IfNot} ${Silent}
        !insertmacro WINKGO_PROMPT_FAILED_PATH_LOCKERS "$WinkGoRemoveFirstFailedPath" "residual-delete-failed" winkgo_retry_remove_install_dir winkgo_cancel_remove_after_rm winkgo_continue_after_rm
        winkgo_cancel_remove_after_rm:
          !insertmacro WINKGO_LOG_REMOVE_FAILURE_JSON "residual-delete-failed" "1" "$WinkGoRemoveFirstFailedPath" "$$payload.residueRoot = '$WinkGoRemoveResidueRoot'; $$payload.failedCount = '$WinkGoRemoveResidueCount'; $$payload.removeDirResult = '$WinkGoRemoveDirResult'; $$payload.atomicSucceeded = ('$WinkGoAtomicRemoveSucceeded' -eq '1')"
          !insertmacro WINKGO_LOG_EVENT "code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 residueRoot=$WinkGoRemoveResidueRoot failedCount=$WinkGoRemoveResidueCount firstFailed=$WinkGoRemoveFirstFailedPath removeDirResult=$WinkGoRemoveDirResult removeResidueCount=$WinkGoRemoveResidueCount atomicFailedPath=$WinkGoAtomicFailedPath atomicSucceeded=$WinkGoAtomicRemoveSucceeded"
          !insertmacro WINKGO_FAIL_REPORTABLE_BILINGUAL ${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 firstFailed=$WinkGoRemoveFirstFailedPath lockers=$WinkGoLockerList" "${WINKGO_MSG_PREVIOUS_FILE_OPEN_EN}" "${WINKGO_MSG_PREVIOUS_FILE_OPEN_ZH}" "${WINKGO_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${WINKGO_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
      ${EndIf}
      winkgo_continue_after_rm:
      DetailPrint `WinkGo previous installation had locked residual files; continuing after atomic cleanup succeeded: $INSTDIR`
      !insertmacro WINKGO_LOG_EVENT "code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed degraded=continue fatal=0 residueRoot=$WinkGoRemoveResidueRoot failedCount=$WinkGoRemoveResidueCount firstFailed=$WinkGoRemoveFirstFailedPath removeDirResult=$WinkGoRemoveDirResult removeResidueCount=$WinkGoRemoveResidueCount atomicFailedPath=$WinkGoAtomicFailedPath atomicSucceeded=$WinkGoAtomicRemoveSucceeded"
    ${else}
      DetailPrint `Can't safely remove previous installation without atomic cleanup proof: $INSTDIR`
      ${IfNot} ${Silent}
        !insertmacro WINKGO_PROMPT_FAILED_PATH_LOCKERS "$WinkGoRemoveFirstFailedPath" "residual-delete-failed-no-atomic-proof" winkgo_retry_remove_install_dir winkgo_cancel_remove_no_atomic winkgo_continue_remove_no_atomic
        winkgo_cancel_remove_no_atomic:
      ${EndIf}
      winkgo_continue_remove_no_atomic:
      !insertmacro WINKGO_LOG_REMOVE_FAILURE_JSON "residual-delete-failed-no-atomic-proof" "1" "$WinkGoRemoveFirstFailedPath" "$$payload.residueRoot = '$WinkGoRemoveResidueRoot'; $$payload.failedCount = '$WinkGoRemoveResidueCount'; $$payload.removeDirResult = '$WinkGoRemoveDirResult'; $$payload.atomicSucceeded = ('$WinkGoAtomicRemoveSucceeded' -eq '1')"
      !insertmacro WINKGO_LOG_EVENT "code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof degraded=none fatal=1 residueRoot=$WinkGoRemoveResidueRoot failedCount=$WinkGoRemoveResidueCount firstFailed=$WinkGoRemoveFirstFailedPath removeDirResult=$WinkGoRemoveDirResult removeResidueCount=$WinkGoRemoveResidueCount atomicFailedPath=$WinkGoAtomicFailedPath atomicSucceeded=$WinkGoAtomicRemoveSucceeded"
      !insertmacro WINKGO_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro WINKGO_FAIL_REPORTABLE_BILINGUAL ${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof fatal=1 firstFailed=$WinkGoRemoveFirstFailedPath removeDirResult=$WinkGoRemoveDirResult lockers=$WinkGoLockerList" "${WINKGO_MSG_REMOVE_PREVIOUS_DIR_EN}" "${WINKGO_MSG_REMOVE_PREVIOUS_DIR_ZH}" "${WINKGO_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${WINKGO_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}"
    ${endif}
  ${else}
    !insertmacro WINKGO_LOG_EVENT "remove-final errors=0 instDir=$INSTDIR removeDirResult=$WinkGoRemoveDirResult removeResidueCount=$WinkGoRemoveResidueCount removeResidueRoot=$WinkGoRemoveResidueRoot atomicFailedPath=$WinkGoAtomicFailedPath atomicSucceeded=$WinkGoAtomicRemoveSucceeded"
  ${endif}
!macroend

!macro customUnInit
  !insertmacro WINKGO_LOG_EVENT "uninit instDir=$INSTDIR"
!macroend

!macro customUnInstall
  !insertmacro WINKGO_LOG_EVENT "uninstall-section start instDir=$INSTDIR"
!macroend

!endif

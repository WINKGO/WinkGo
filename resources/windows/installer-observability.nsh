; Modified from AionUI by WINK GO contributors in 2026.
!ifndef WINKGO_INSTALLER_OBSERVABILITY_NSH
!define WINKGO_INSTALLER_OBSERVABILITY_NSH

!define WINKGO_APP_EXECUTABLE_FILENAME "WINK-GO.exe"
!define WINKGO_FALLBACK_LOG "winkgo-installer-${VERSION}-fallback-log.jsonl"

!pragma warning disable 6001
Var /GLOBAL WinkGoSessionId
Var /GLOBAL WinkGoIsUpdated
Var /GLOBAL WinkGoSessionLogResult
Var /GLOBAL WinkGoSessionLogPath

!macro WINKGO_SESSION_HEADER
  !insertmacro WINKGO_SLOG "event=header arch=${WINKGO_TARGET_ARCH} updated=$WinkGoIsUpdated instDir=$INSTDIR version=${VERSION} log=$WinkGoSessionLogPath detail=customHeader"
!macroend

!macro WINKGO_SLOG _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$session = '$WinkGoSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro WINKGO_LOG_EVENT _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$session = '$WinkGoSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro WINKGO_LOG_JSON_EVENT _EVENT _JSON_FIELDS
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$WinkGoSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${WINKGO_FALLBACK_LOG}' }; \
    $$session = '$WinkGoSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${WINKGO_TARGET_ARCH}'; updated = ('$WinkGoIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = '${_EVENT}' }; \
    ${_JSON_FIELDS}; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro WINKGO_SESSION_BEGIN
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "--installer-log=" $R8
  ${IfNot} ${Errors}
    StrCpy $WinkGoSessionLogPath $R8
  ${EndIf}
  ClearErrors
  ${GetOptions} $R9 "--installer-session=" $R8
  ${IfNot} ${Errors}
    StrCpy $WinkGoSessionId $R8
  ${EndIf}

  ${If} $WinkGoSessionLogPath == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$id = '$WinkGoSessionId'; if (-not $$id) { $$id = [guid]::NewGuid().ToString('N').Substring(0,12) }; $$stamp = Get-Date -Format 'yyyyMMdd'; $$name = 'winkgo-installer-${VERSION}-' + $$stamp + '-log.jsonl'; $$log = Join-Path $$env:TEMP $$name; [Console]::Out.Write($$id + '|' + $$log)"`
    Pop $WinkGoSessionLogResult
    Pop $WinkGoSessionLogResult
    StrCpy $WinkGoSessionId $WinkGoSessionLogResult 12
    StrCpy $WinkGoSessionLogPath $WinkGoSessionLogResult 1024 13
  ${ElseIf} $WinkGoSessionId == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "[Console]::Out.Write([guid]::NewGuid().ToString('N').Substring(0,12))"`
    Pop $WinkGoSessionLogResult
    Pop $WinkGoSessionLogResult
    StrCpy $WinkGoSessionId $WinkGoSessionLogResult
  ${EndIf}

  ClearErrors
  ${GetOptions} $R9 "--updated" $R8
  StrCpy $WinkGoIsUpdated "0"
  ${IfNot} ${Errors}
    StrCpy $WinkGoIsUpdated "1"
  ${EndIf}

  !insertmacro WINKGO_SLOG "event=session-begin detail=preInit"
!macroend

!macro WINKGO_LOG_EXTRACT_RESULT _METHOD
  ${IfNot} ${FileExists} "$INSTDIR\${WINKGO_APP_EXECUTABLE_FILENAME}"
    !insertmacro WINKGO_FAIL_UX \
      "${WINKGO_E_EXTRACT_FAILED}" \
      "event=extract result=fail method=${_METHOD} missing=${WINKGO_APP_EXECUTABLE_FILENAME}" \
      "${WINKGO_MSG_EXTRACT_FAILED_ZH}" \
      "${WINKGO_MSG_EXTRACT_FAILED_EN}" \
      "${WINKGO_MSG_EXTRACT_FAILED_ACTION_ZH}" \
      "${WINKGO_MSG_EXTRACT_FAILED_ACTION_EN}" \
      "extract result=fail method=${_METHOD} missing=${WINKGO_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR" \
      "extract result=fail method=${_METHOD} missing=${WINKGO_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR"
  ${Else}
    !insertmacro WINKGO_SLOG "event=extract result=ok method=${_METHOD} detail=customFiles_${WINKGO_TARGET_ARCH}"
  ${EndIf}
!macroend

!macro WINKGO_SESSION_SUCCESS
  !insertmacro WINKGO_SLOG "event=session-end result=success detail=customInstall"
!macroend

!endif

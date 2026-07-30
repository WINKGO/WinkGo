; ARM64 architecture entry for the NSIS installer.

!include "x64.nsh"

!define WINKGO_TARGET_ARCH "arm64"
!define WINKGO_RUNTIME_KEY "win32-arm64"
!define WINKGO_EXTRACT_METHOD "zip"

!addincludedir "${PROJECT_DIR}\resources\windows"
!include "installer-common.nsh"

!macro customHeader
  !insertmacro WINKGO_INSTALLER_CUSTOM_HEADER
!macroend

!macro preInit
  !insertmacro WINKGO_INSTALLER_PREINIT
!macroend

!macro customFiles_arm64
  !insertmacro WINKGO_LOG_EXTRACT_RESULT "zip"
!macroend

; Architecture guard. Inserted from WINKGO_INSTALLER_PREINIT (preInit) so it runs before any
; registry mutation, replacing the old .onVerifyInstDir placement which fired after customInit
; had already healed/cleared/repaired an existing install's registry. (Sentry ELECTRON-3BX)
!macro WINKGO_ASSERT_TARGET_ARCH
  Var /GLOBAL WinkGoActualArch
  ${IfNot} ${IsNativeARM64}
    !insertmacro WINKGO_DETECT_NATIVE_ARCH $WinkGoActualArch
    !insertmacro WINKGO_FAIL_UX \
      "${WINKGO_E_ARCH_MISMATCH}" \
      "target=arm64 actual=$WinkGoActualArch" \
      "${WINKGO_MSG_ARCH_MISMATCH_ZH}" \
      "${WINKGO_MSG_ARCH_MISMATCH_EN}" \
      "${WINKGO_MSG_ARCH_MISMATCH_ACTION_ZH}" \
      "${WINKGO_MSG_ARCH_MISMATCH_ACTION_EN}" \
      "target=arm64 actual=$WinkGoActualArch" \
      "target=arm64 actual=$WinkGoActualArch"
  ${EndIf}
!macroend

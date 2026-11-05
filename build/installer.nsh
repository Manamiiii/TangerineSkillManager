; Keep the application leaf separate from the shared family directory.
!include LogicLib.nsh
!searchreplace TSM_LEAF "${PRODUCT_FILENAME}" " " ""
!define /ifndef TSM_FRESH_DIR "$LOCALAPPDATA\Tangerine\Apps\${TSM_LEAF}"

!macro refuseMaintenance reason
  !ifmacrodef reportFixtureRefusal
    !insertmacro reportFixtureRefusal "${reason}"
  !endif
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONEXCLAMATION "安装目录或登记信息不匹配，请保留现场并检查安装位置。"
  ${EndIf}
  SetErrorLevel 3
  Quit
!macroend

!macro checkAppDirectory
  ; The NSIS instruction requires an existing path. Win32 also resolves a not-yet-created leaf.
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .R1, p 0)i.R2'
  ${If} $R2 == 0
  ${OrIf} $R2 >= ${NSIS_MAX_STRLEN}
  ${OrIf} $R1 != $INSTDIR
    !insertmacro refuseMaintenance canonical
  ${EndIf}
  ${GetFileName} "$INSTDIR" $R2
  ${If} $INSTDIR != "$LOCALAPPDATA\Programs\Tangerine\${TSM_LEAF}"
  ${AndIf} $INSTDIR != "$LOCALAPPDATA\Tangerine\Apps\${TSM_LEAF}"
  ${AndIf} $R2 != "${APP_FILENAME}"
    !insertmacro refuseMaintenance app-leaf
  ${EndIf}
  ; Reject redirected/junction ancestors before passing a directory to NSIS recursive removal.
  StrCpy $R2 $INSTDIR
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w R2)i.R3'
    ${If} $R3 != -1
      IntOp $R3 $R3 & 0x400
      ${If} $R3 != 0
        !insertmacro refuseMaintenance link
      ${EndIf}
    ${EndIf}
    ${GetParent} "$R2" $R3
    ${If} $R3 == ""
    ${OrIf} $R3 == $R2
      ${ExitDo}
    ${EndIf}
    StrCpy $R2 $R3
  ${Loop}
!macroend

; The upstream upgrade walker descends into child directories. Check links before it runs.
!ifdef BUILD_UNINSTALLER
  !define TSM_VERIFY_TREE un.tsmVerifyTree
!else
  !define TSM_VERIFY_TREE tsmVerifyTree
!endif
Function ${TSM_VERIFY_TREE}
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  ClearErrors
  FindFirst $1 $2 "$0\*"
  ${If} ${Errors}
    !insertmacro refuseMaintenance enumerate
  ${EndIf}
  ${DoWhile} $2 != ""
    ${If} $2 != "."
    ${AndIf} $2 != ".."
      System::Call 'kernel32::GetFileAttributesW(w "$0\$2")i.r3'
      IntOp $4 $3 & 0x400
      ${If} $3 == -1
      ${OrIf} $4 != 0
        !insertmacro refuseMaintenance tree-link
      ${EndIf}
      IntOp $4 $3 & 0x10
      ${If} $4 != 0
        Push "$0\$2"
        Call ${TSM_VERIFY_TREE}
      ${EndIf}
    ${EndIf}
    FindNext $1 $2
  ${Loop}
  FindClose $1
  ClearErrors
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro checkRegistration
  ReadRegStr $R4 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R5 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R4 != $INSTDIR
  ${OrIf} $R5 != '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser'
  ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${OrIfNot} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
    !insertmacro refuseMaintenance registration
  ${EndIf}
  Push "$INSTDIR"
  Call ${TSM_VERIFY_TREE}
!macroend

!macro customInit
  !ifmacrodef checkFixtureEnvironment
    !insertmacro checkFixtureEnvironment
  !endif
  ${If} $installMode != CurrentUser
    !insertmacro refuseMaintenance scope
  ${EndIf}
  ReadRegStr $R4 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R5 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  !insertmacro GetDParameter $R0
  StrCpy $R6 $R0
  ${If} $R4 == ""
    StrCpy $INSTDIR "${TSM_FRESH_DIR}"
    !insertmacro checkAppDirectory
    ${If} $R5 != ""
    ${OrIf} ${FileExists} "$INSTDIR\*.*"
      !insertmacro refuseMaintenance occupied
    ${EndIf}
  ${Else}
    StrCpy $INSTDIR $R4
    !insertmacro checkAppDirectory
    !insertmacro checkRegistration
  ${EndIf}
  ${If} $R6 != ""
  ${AndIf} $R6 != $INSTDIR
    !insertmacro refuseMaintenance override
  ${EndIf}
!macroend

; initMultiUser already selected the current user. Do not let the assisted page recompute INSTDIR.
!macro customInstallMode
  Abort
!macroend

!macro customUnInstall
  !ifmacrodef checkFixtureEnvironment
    !insertmacro checkFixtureEnvironment
  !endif
  !insertmacro checkAppDirectory
  !insertmacro checkRegistration
!macroend

; Never terminate a running manager during install, upgrade or uninstall.
; Fail closed if the process inventory itself fails. 603 means no matching process.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 != 603
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "请先退出 Tangerine Skill Manager，再重试安装或卸载。无法确认程序已退出时，本操作会停止。$\r$\nPlease close Tangerine Skill Manager before installing or uninstalling."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

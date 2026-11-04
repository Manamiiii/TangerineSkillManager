!if "${APP_ID}" != "org.tangerineskillmanager.installeracceptance"
  !error "This include is restricted to the acceptance installer."
!endif

; Model the previous default without depending on /D command-line quoting.
!if "${VERSION}" == "0.0.9"
  !define TSM_FRESH_DIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
!endif

!macro reportFixtureRefusal reason
  FileOpen $1 "$TEMP\fixture-refusal.log" a
  FileWrite $1 "${reason}$\r$\n"
  FileClose $1
!macroend

!macro checkFixtureEnvironment
  ReadEnvStr $R1 TSM_FIXTURE_LOCAL
  ${If} $R1 == ""
  ${OrIf} $R1 != $LOCALAPPDATA
    SetErrorLevel 4
    Quit
  ${EndIf}
!macroend

!include "${BUILD_RESOURCES_DIR}\installer.nsh"

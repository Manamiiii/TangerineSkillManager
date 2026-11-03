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

; Explorer owns this shortcut, so it can launch the recorder after Quit.
; The app must not register the same keys with globalShortcut.
!define ZOOMCAST_RECORD_KEY "R"
; Native verification uses a separate identity and keys, leaving the real app alone.
!if "${APP_ID}" == "dev.zoomcast.shortcut-smoke"
  !undef ZOOMCAST_RECORD_KEY
  !define ZOOMCAST_RECORD_KEY "F12"
!endif

!macro customInstall
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME} Recorder.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--record" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "CONTROL|ALT|${ZOOMCAST_RECORD_KEY}" "Open the Zoomcast recorder"
  WinShell::SetLnkAUMI "$SMPROGRAMS\${PRODUCT_NAME} Recorder.lnk" "${APP_ID}"
  ; Record the actual installation scope (current user or all users).
  FileOpen $0 "$INSTDIR\record-shortcut.path" w
  FileWriteUTF16LE $0 "$SMPROGRAMS\${PRODUCT_NAME} Recorder.lnk$\r$\nCtrl+Alt+${ZOOMCAST_RECORD_KEY}"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\${PRODUCT_NAME} Recorder.lnk"
  Delete "$INSTDIR\record-shortcut.path"
!macroend

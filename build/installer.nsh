; Register the steamdeals:// link scheme at install time, so the website can hand a basket to the
; app before it has ever been launched. SHCTX is HKCU for per-user installs and HKLM for per-machine.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\steamdeals" "" "URL:Steam Deals"
  WriteRegStr SHCTX "Software\Classes\steamdeals" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\steamdeals\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\steamdeals\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\steamdeals"
!macroend

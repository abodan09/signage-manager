; Custom NSIS hooks for Signage Manager installer
;
; Fix for the upgrade error "Failed to uninstall old application files ... : 2"
; (Italian: "Impossibile disinstallare i vecchi file dell'applicazione ... : 2").
;
; Root cause: while the app is running (or its files are transiently locked,
; e.g. by antivirus), the previous version's uninstaller cannot rename the old
; files, aborts with exit code 2, and electron-builder's handleUninstallResult
; then shows the error dialog and quits the installer.
;
; Layer 1 - customInit: in silent mode (auto-update) force-close every running
; instance of the app before anything else runs, and wait until the processes
; are actually gone so no file locks remain.
;
; Layer 2 - customUnInstallCheck / customUnInstallCheckCurrentUser: these are
; electron-builder's official hooks that REPLACE the abort-on-failure handling
; after the old uninstaller runs. If the old uninstaller still fails, log and
; continue - the extraction step overwrites the old files in place, which is
; safe because Layer 1 already released all locks.

!macro customInit
  ${If} ${Silent}
    DetailPrint `Closing running ${PRODUCT_NAME}...`
    nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
    Pop $R9

    ; wait (max ~10s) until no process with the app's image name remains
    StrCpy $R8 0
    customInitWaitLoop:
      IntOp $R8 $R8 + 1
      IntCmp $R8 20 customInitKillDone 0 customInitKillDone
      nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" | %SYSTEMROOT%\System32\find.exe "${APP_EXECUTABLE_FILENAME}"`
      Pop $R9
      ; find.exe returns 0 when the process name was found -> still running
      StrCmp $R9 "0" 0 customInitKillDone
      Sleep 500
      Goto customInitWaitLoop
    customInitKillDone:
    ClearErrors
  ${EndIf}
!macroend

!macro customUnInstallCheck
  ${If} ${Errors}
    DetailPrint `Old uninstaller could not be launched - continuing installation.`
  ${ElseIf} $R0 != 0
    DetailPrint `Old uninstaller exited with code $R0 - continuing installation anyway.`
  ${EndIf}
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  ${If} ${Errors}
    DetailPrint `Old uninstaller could not be launched - continuing installation.`
  ${ElseIf} $R0 != 0
    DetailPrint `Old uninstaller exited with code $R0 - continuing installation anyway.`
  ${EndIf}
  ClearErrors
!macroend

; Runs after the new files were extracted and registered. Versions before
; 1.5.2 shipped unpacked (asar disabled) as resources\app; the app now ships
; as resources\app.asar. If the old uninstaller failed (and we continued),
; the stale unpacked directory would linger - remove it. No-op on fresh
; installs and when the old uninstaller cleaned up normally.
!macro customInstall
  RMDir /r "$INSTDIR\resources\app"
!macroend

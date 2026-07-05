; Custom NSIS hooks for Signage Manager installer
;
; Fix for upgrade failure "Cannot uninstall old application files ... : 2":
; if a previous install left a registry entry but its uninstaller exe no
; longer exists on disk, electron-builder's upgrade step aborts with
; Windows error 2 (ERROR_FILE_NOT_FOUND). Clear such stale entries in
; .onInit so the installer proceeds as a fresh install instead.

!macro customInit
  ; --- per-user install (default for this app) ---
  ClearErrors
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.signage.manager" "InstallLocation"
  IfErrors check_hklm
  StrCmp $R0 "" check_hklm
  IfFileExists "$R0\Uninstall Signage Manager.exe" check_hklm
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.signage.manager"

  check_hklm:
  ; --- per-machine install (in case an old version was installed for all users) ---
  ClearErrors
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.signage.manager" "InstallLocation"
  IfErrors init_done
  StrCmp $R0 "" init_done
  IfFileExists "$R0\Uninstall Signage Manager.exe" init_done
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.signage.manager"

  init_done:
!macroend

; Custom NSIS macros for Out Loud installer.
; `electron-builder` invokes this via `nsis.include` in electron-builder.json.

; Out Loud bundles onnxruntime-node, whose native binary (onnxruntime_binding.node)
; depends on the Microsoft Visual C++ 2015-2022 Runtime. Fresh Windows installs
; do not include it, so we ship VC++ Redistributable and run it silently as part
; of our install. The redist installer is idempotent: re-running on a system that
; already has it is a quick no-op (exit code 1638).
!macro customInstall
  DetailPrint "Installing Microsoft Visual C++ Redistributable (required by TTS engine)..."
  ; $PLUGINSDIR is a temp directory NSIS auto-cleans when the installer exits,
  ; so we don't leave the 25 MB redist sitting in the user's install dir.
  SetOutPath "$PLUGINSDIR"
  File "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
  ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $0
  ${If} $0 = 0
    DetailPrint "Visual C++ Redistributable installed successfully."
  ${ElseIf} $0 = 3010
    DetailPrint "Visual C++ Redistributable installed (system restart required to fully activate)."
  ${ElseIf} $0 = 1638
    DetailPrint "Visual C++ Redistributable already up to date."
  ${ElseIf} $0 = 1641
    DetailPrint "Visual C++ Redistributable installed (system will reboot)."
  ${Else}
    DetailPrint "Visual C++ Redistributable installer returned code $0; continuing anyway."
  ${EndIf}
!macroend

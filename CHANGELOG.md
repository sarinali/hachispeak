# Changelog

All notable user-facing changes to Out Loud. See `git log` for the full
history.

## 1.0.2 — 2026-05-23

### Cross-platform packaging fixes

- **macOS and Windows**: ship every transitive dependency. The previous
  release shipped `onnxruntime-node` without its `onnxruntime-common` peer,
  which made TTS fail at startup on every platform that got past the
  Gatekeeper / SmartScreen wall. The installer now bundles the full
  dependency tree via electron-builder's automatic production-deps resolver.
- **macOS and Windows**: resolve `ffmpeg-static` and embedded model paths
  to their real on-disk location under `app.asar.unpacked`. Reads via
  `fs.readFile` worked through Electron's asar layer, but `child_process.spawn`
  (used to launch ffmpeg) bypasses asar and was failing silently with ENOENT
  on `speed != 1` or MP3 export.

### macOS

- **Code signing**: builds are now signed with our Apple Developer ID
  (`Developer ID Application: Julia Kafarska (8Y2UTZ2NBZ)`) and hardened
  runtime is enabled. The misleading "Out Loud.app is damaged and can't be
  opened" message is gone. First launch now shows the standard "macOS cannot
  verify the developer" dialog — right-click → **Open** once and macOS
  remembers. No more Terminal commands needed.
- _Notarization is temporarily disabled while Apple's notary service works
  through a backlog. We'll re-enable it in 1.0.3 — at that point first
  launch will open with no prompt at all._
- **Quit crash**: fixed `SIGABRT` on quit caused by V8 tearing down the
  Node environment before the TTS worker finished releasing its ONNX
  session. The main process now hard-terminates the worker before quit so
  the OS reclaims native resources cleanly instead of joining a thread
  mid-finalize.

### Windows

- **TTS engine now loads on fresh Windows installs**. The Out Loud installer
  bundles the Microsoft Visual C++ 2015-2022 Redistributable and installs
  it silently as part of setup. Previously, fresh Windows installs without
  the redistributable failed to load `onnxruntime_binding.node` with the
  cryptic `ERR_DLOPEN_FAILED` / "Cannot find the specified module" error.
- **Window UX**: stopped applying `titleBarStyle: "hiddenInset"` and the
  invisible drag region on Windows. They're macOS-only constructs that were
  fighting Windows' native title bar and causing the "jumpy / fighting with
  the user" feel on first launch.
- **Error visibility**: TTS errors now surface as a red banner in the UI
  with the worker stack trace and platform info, instead of being silently
  logged. Makes future Windows / cross-platform bugs much easier to report.

### Internal

- Tray-app PATH prefix `/opt/homebrew/bin:/usr/local/bin` is now applied
  only on macOS so Windows PATH isn't corrupted.
- Release CI workflow consumes signing secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and the optional
  Windows pair) so the same signed-and-bundled artifacts you can build
  locally are what ships from CI.

## 1.0.0 — 2026-04-22

Initial public release.

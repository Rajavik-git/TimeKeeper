# Native recognition backup

The inactive `native-recognition.tar.gz` archive preserves selected source files from commit `d575502e9d5018c3a36333ba479eaa2a2cddb6cd`.

It includes the Rust foreground-window watcher and filter, the original host startup, the floating pill and simulator, application recognition and decision services, and the original pill interaction tests. It contains Git-tracked source only. No credentials or captured data are included.

List the files with `tar -tzf backups/native-recognition-d575502/native-recognition.tar.gz`. Extract into a separate directory for comparison. Restoring host or pill files directly would overwrite newer integration work.

The active application no longer starts the native window watcher, calls window recognition, runs the fictional browser simulator, or accepts countdown proposals. Screenpipe's JEV workflow owns automatic transitions. The pill reads accepted periods and questions through the application API. Manual case answers, validation, undo, navigation, sizing, and backend lifecycle remain active.

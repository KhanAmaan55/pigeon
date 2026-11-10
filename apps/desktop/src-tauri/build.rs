fn main() {
    // Declaring the app's own commands generates an `allow-<command>` permission for each, so
    // capabilities/default.json must grant them explicitly (nothing is allowed implicitly).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "http_send",
            "http_cancel",
            "save_file",
            "smoke_report",
        ]),
    ))
    .expect("failed to run tauri-build");
}

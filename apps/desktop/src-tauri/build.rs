fn main() {
    // Declaring the app's own commands generates an `allow-<command>` permission for each, so
    // capabilities/default.json must grant them explicitly (nothing is allowed implicitly).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "http_send",
            "http_cancel",
            "save_file",
            "smoke_report",
            "project_pick_folder",
            "project_create",
            "project_reopen",
            "project_fs_read",
            "project_fs_write",
            "project_fs_stat",
            "project_fs_list",
            "project_fs_mkdirp",
            "project_fs_remove",
            "project_fs_rename",
            "project_watch",
            "project_unwatch",
            "app_state_read",
            "app_state_write",
            "app_state_backup",
            "secrets_read",
            "secrets_write",
            "oauth_begin",
            "oauth_complete",
        ]),
    ))
    .expect("failed to run tauri-build");
}

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_status", "list_sources", "start_recording", "stop_recording", "list_recordings",
            ]),
        ),
    )
    .expect("Tauri build configuration is invalid");
}

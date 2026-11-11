#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod controller;
mod domain;
mod storage;
use controller::{Controller, Request};
use domain::{AppError, Source, StartRequest, Status};
use tauri::{Manager, State, WebviewWindow};

fn authorize(window: &WebviewWindow) -> Result<(), AppError> {
    if window.label() != "main" { return Err(AppError::new("permission", "This window cannot control recording.")); }
    Ok(())
}
#[tauri::command]
async fn get_status(window: WebviewWindow, state: State<'_, Controller>) -> Result<Status, AppError> {
    authorize(&window)?;
    state.call(Request::Status).await
}
#[tauri::command]
async fn list_sources(window: WebviewWindow, state: State<'_, Controller>) -> Result<Vec<Source>, AppError> {
    authorize(&window)?;
    state.call(Request::Sources).await
}
#[tauri::command]
async fn start_recording(window: WebviewWindow, state: State<'_, Controller>, request: StartRequest) -> Result<Status, AppError> {
    authorize(&window)?;
    state.call(|reply| Request::Start(request, reply)).await
}
#[tauri::command]
async fn stop_recording(window: WebviewWindow, state: State<'_, Controller>) -> Result<Status, AppError> {
    authorize(&window)?;
    state.call(Request::Stop).await
}
#[tauri::command]
async fn list_recordings(window: WebviewWindow, state: State<'_, Controller>) -> Result<Vec<storage::Recording>, AppError> {
    authorize(&window)?;
    state.call(Request::Library).await
}
fn main() {
    let result = tauri::Builder::default()
        .setup(|app| {
            let parent = app.path().app_local_data_dir()?;
            // The OS app-data parent may not exist on first launch.
            if let Some(base) = parent.parent() { std::fs::create_dir_all(base)?; }
            let storage = storage::Storage::initialize(parent)
                .map_err(|e| std::io::Error::other(e.message))?;
            let helper = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/chripify-capture")
            } else { app.path().resource_dir()?.join("binaries/chripify-capture") };
            app.manage(Controller::new(storage, helper));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_status, list_sources, start_recording, stop_recording, list_recordings])
        .on_window_event(|window, event| {
            // Closing the main window while capture is active is blocked. Stop explicitly first.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let handle = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<Controller>();
                    if let Ok(status) = state.call(Request::Status).await {
                        if matches!(status.phase, domain::Phase::Idle | domain::Phase::Completed | domain::Phase::Failed | domain::Phase::Cancelled) {
                            handle.exit(0);
                        }
                    }
                });
            }
        })
        .run(tauri::generate_context!());
    if result.is_err() { eprintln!("Chripify could not initialize. Check local storage and application installation."); }
}

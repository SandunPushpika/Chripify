use crate::{domain::{AppError, Phase, Source, StartRequest, Status}, storage::{Recording, Storage}};
use serde::Deserialize;
use std::{path::PathBuf, process::Stdio, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines}, process::{Child, ChildStdout, Command}, sync::{mpsc, oneshot}};

const MIN_FREE_BYTES: u64 = 512 * 1024 * 1024;
type Reply<T> = oneshot::Sender<Result<T, AppError>>;

pub enum Request {
    Status(Reply<Status>), Sources(Reply<Vec<Source>>), Start(StartRequest, Reply<Status>),
    Stop(Reply<Status>), Library(Reply<Vec<Recording>>),
}

#[derive(Clone)]
pub struct Controller { sender: mpsc::Sender<Request> }
impl Controller {
    pub fn new(storage: Storage, helper: PathBuf) -> Self {
        let (sender, receiver) = mpsc::channel(16);
        tauri::async_runtime::spawn(run(receiver, storage, helper));
        Self { sender }
    }
    pub async fn call<T>(&self, request: impl FnOnce(Reply<T>) -> Request) -> Result<T, AppError> {
        let (tx, rx) = oneshot::channel();
        self.sender.try_send(request(tx)).map_err(|_| AppError::new("busy", "Recorder is busy. Try again shortly."))?;
        tokio::time::timeout(Duration::from_secs(30), rx).await
            .map_err(|_| AppError::new("timeout", "Recorder did not respond in time."))?
            .map_err(|_| AppError::new("unavailable", "Recorder is shutting down."))?
    }
}

struct Active {
    child: Child,
    stdout: Lines<BufReader<ChildStdout>>,
    id: String,
    path: PathBuf,
    created_at: u64,
    deadline: Option<Instant>,
}

#[derive(Deserialize)]
struct Event { event: String, code: Option<String>, sources: Option<Vec<Source>> }

fn native_error(event: Option<&Event>) -> AppError {
    match event.and_then(|e| e.code.as_deref()) {
        Some("permission_denied") => AppError::new("permission", "Screen Recording permission was denied. Review macOS System Settings."),
        Some("encoder_failed") => AppError::new("encoder", "The native encoder failed. Any partial file has been retained."),
        Some("capture_interrupted") => AppError::new("interrupted", "Screen capture was interrupted. Check your display and OS permissions."),
        Some("unsupported_platform") => AppError::new("unsupported_platform", "Screen capture requires macOS 15 or later."),
        _ => AppError::platform(),
    }
}

async fn disk_space(storage: Storage) -> Result<u64, AppError> {
    tokio::task::spawn_blocking(move || storage.free_bytes()).await.map_err(|_| AppError::storage())?
}

async fn sources(helper: &PathBuf) -> Result<Vec<Source>, AppError> {
    if !cfg!(target_os = "macos") { return Err(AppError::new("unsupported_platform", "Capture is currently implemented for macOS 15+ only.")); }
    let mut command = Command::new(helper);
    command.arg("--list").stdin(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(20), command.output()).await
        .map_err(|_| AppError::new("timeout", "Display permission request timed out. Grant access in System Settings and retry."))?
        .map_err(|_| AppError::platform())?;
    if output.stdout.len() > 16 * 1024 { return Err(AppError::platform()); }
    let event: Event = serde_json::from_slice(&output.stdout).map_err(|_| AppError::platform())?;
    if event.code.as_deref() == Some("permission_denied") {
        return Err(AppError::new("permission", "Allow Screen Recording in macOS System Settings, then retry."));
    }
    if !output.status.success() || event.event != "sources" { return Err(AppError::platform()); }
    let sources = event.sources.ok_or_else(AppError::platform)?;
    if sources.len() > 64 { return Err(AppError::platform()); }
    Ok(sources)
}

async fn begin(storage: &Storage, helper: &PathBuf, request: &StartRequest) -> Result<Active, AppError> {
    if disk_space(storage.clone()).await? < MIN_FREE_BYTES {
        return Err(AppError::new("low_disk", "At least 512 MiB of free space is required."));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let local_storage = storage.clone();
    let local_id = id.clone();
    let path = tokio::task::spawn_blocking(move || local_storage.allocate(&local_id)).await
        .map_err(|_| AppError::storage())??;
    let mut child = Command::new(helper)
        .arg(request.display_id.to_string()).arg(&path).arg(request.fps.to_string())
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .kill_on_drop(true).spawn().map_err(|_| AppError::platform())?;
    let stdout = child.stdout.take().ok_or_else(AppError::platform)?;
    Ok(Active { child, stdout: BufReader::new(stdout).lines(), id, path,
        created_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        deadline: Some(Instant::now() + Duration::from_secs(20)) })
}

async fn stop(active: &mut Active) -> Result<(), AppError> {
    let stdin = active.child.stdin.as_mut().ok_or_else(AppError::platform)?;
    tokio::time::timeout(Duration::from_secs(2), stdin.write_all(b"stop\n")).await
        .map_err(|_| AppError::platform())?.map_err(|_| AppError::platform())?;
    active.deadline = Some(Instant::now() + Duration::from_secs(15));
    Ok(())
}

async fn fail(active: &mut Option<Active>, status: &mut Status, error: AppError) {
    if let Some(mut recording) = active.take() {
        // Reap on every failure path. Partial media is retained for explicit recovery.
        let _ = recording.child.kill().await;
        let _ = recording.child.wait().await;
    }
    // Failure paths belong to active states; retain any impossible-state error explicitly.
    if let Err(invalid_state) = status.advance(Phase::Failed) {
        status.error = Some(invalid_state);
        return;
    }
    status.error = Some(error);
}

async fn run(mut receiver: mpsc::Receiver<Request>, storage: Storage, helper: PathBuf) {
    let mut status = Status::default();
    let mut active: Option<Active> = None;
    let mut available_sources = Vec::new();
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    loop {
        tokio::select! {
            request = receiver.recv() => {
                let Some(request) = request else {
                    if let Some(mut session) = active.take() {
                        let _ = stop(&mut session).await;
                        if tokio::time::timeout(Duration::from_secs(15), session.child.wait()).await.is_err() {
                            let _ = session.child.kill().await;
                        }
                    }
                    return;
                };
                match request {
                    Request::Status(reply) => { let _ = reply.send(Ok(status.clone())); },
                    Request::Sources(reply) => {
                        if reply.is_closed() { continue; }
                        let result = if active.is_some() { Err(AppError::new("invalid_state", "Stop recording before refreshing displays.")) }
                            else { sources(&helper).await };
                        match &result {
                            Ok(list) => available_sources = list.clone(),
                            Err(_) => available_sources.clear(),
                        }
                        let _ = reply.send(result);
                    },
                    Request::Start(request, reply) => {
                        // A timed-out renderer request must never start recording later from the queue.
                        if reply.is_closed() { continue; }
                        let result = async {
                            request.validate(&available_sources)?;
                            let next = status.phase.transition(Phase::Preparing)?;
                            let mut session = begin(&storage, &helper, &request).await?;
                            if reply.is_closed() {
                                let _ = session.child.kill().await;
                                return Err(AppError::new("cancelled", "The recording request expired."));
                            }
                            active = Some(session);
                            status = Status { phase: next, started_at: None, error: None };
                            Ok(status.clone())
                        }.await;
                        let _ = reply.send(result);
                    },
                    Request::Stop(reply) => {
                        let result = if status.phase == Phase::Finalizing || status.phase == Phase::Completed {
                            Ok(status.clone())
                        } else if status.phase == Phase::Recording {
                            if let Some(ref mut session) = active {
                                match stop(session).await {
                                    Ok(()) => { status.advance(Phase::Finalizing).map(|()| status.clone()) },
                                    Err(e) => { fail(&mut active, &mut status, e.clone()).await; Err(e) },
                                }
                            } else { Err(AppError::platform()) }
                        } else { Err(AppError::new("invalid_state", "Recording has not started.")) };
                        let _ = reply.send(result);
                    },
                    Request::Library(reply) => {
                        let local = storage.clone();
                        let result = tokio::task::spawn_blocking(move || local.list()).await
                            .map_err(|_| AppError::storage()).and_then(|r| r);
                        let _ = reply.send(result);
                    },
                }
            },
            line = async {
                match active.as_mut() {
                    Some(session) => session.stdout.next_line().await,
                    None => std::future::pending().await,
                }
            } => {
                let event = match line {
                    Ok(Some(line)) if line.len() <= 4096 => serde_json::from_str::<Event>(&line).ok(),
                    _ => None,
                };
                match event.as_ref().map(|e| e.event.as_str()) {
                    Some("recording") if status.phase == Phase::Preparing => {
                        if let Err(error) = status.advance(Phase::Recording) {
                            fail(&mut active, &mut status, error).await;
                            continue;
                        }
                        if let Some(ref mut session) = active {
                            session.deadline = None;
                            status.started_at = Some(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs());
                        }
                    },
                    Some("finished") if status.phase == Phase::Finalizing => {
                        if let Some(mut session) = active.take() {
                            let exited = tokio::time::timeout(Duration::from_secs(3), session.child.wait()).await;
                            let result = if matches!(exited, Ok(Ok(exit)) if exit.success()) {
                                let local = storage.clone();
                                tokio::task::spawn_blocking(move || local.complete(&session.id, session.created_at, &session.path)).await
                                    .map_err(|_| AppError::storage()).and_then(|r| r)
                            } else {
                                let _ = session.child.kill().await;
                                Err(AppError::platform())
                            };
                            match result {
                                Ok(()) => {
                                    if let Err(error) = status.advance(Phase::Completed) {
                                        fail(&mut active, &mut status, error).await;
                                    }
                                },
                                Err(e) => fail(&mut active, &mut status, e).await,
                            }
                        }
                    },
                    _ => fail(&mut active, &mut status, native_error(event.as_ref())).await,
                }
            },
            _ = tick.tick(), if active.is_some() => {
                let expired = active.as_ref().and_then(|a| a.deadline).is_some_and(|d| Instant::now() >= d);
                if expired { fail(&mut active, &mut status, AppError::new("timeout", "Capture timed out. Any partial file has been retained.")).await; }
                else if status.phase == Phase::Recording {
                    match disk_space(storage.clone()).await {
                        Ok(bytes) if bytes >= MIN_FREE_BYTES => {},
                        _ => {
                            if let Some(ref mut session) = active {
                                if stop(session).await.is_ok() {
                                    if let Err(error) = status.advance(Phase::Finalizing) {
                                        fail(&mut active, &mut status, error).await;
                                    } else {
                                        status.error = Some(AppError::new("low_disk", "Recording stopped because free space is low."));
                                    }
                                } else { fail(&mut active, &mut status, AppError::storage()).await; }
                            }
                        },
                    }
                }
            }
        }
    }
}

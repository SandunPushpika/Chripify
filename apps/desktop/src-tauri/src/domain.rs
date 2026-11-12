use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Preparing,
    Recording,
    Paused,
    Finalizing,
    Completed,
    Failed,
    Cancelled,
}

impl Phase {
    pub fn transition(self, next: Self) -> Result<Self, AppError> {
        use Phase::*;
        if matches!((self, next),
            (Idle | Completed | Failed | Cancelled, Preparing)
            | (Preparing, Recording | Failed | Cancelled)
            | (Recording, Paused | Finalizing | Failed)
            | (Paused, Recording | Finalizing | Failed)
            | (Finalizing, Completed | Failed)) {
            Ok(next)
        } else {
            Err(AppError::new("invalid_state", "This action is unavailable in the current recording state."))
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct AppError { pub code: String, pub message: String }
impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self { code: code.into(), message: message.into() }
    }

    pub fn storage() -> Self { Self::new("storage", "Local storage is unavailable. Check disk space and folder permissions.") }
    pub fn platform() -> Self { Self::new("platform", "Capture is unavailable. Check macOS Screen Recording permission and restart the app.") }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source { pub id: u32, pub width: u32, pub height: u32 }

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StartRequest { pub display_id: u32, pub fps: u32 }
impl StartRequest {
    pub fn validate(&self, sources: &[Source]) -> Result<(), AppError> {
        if ![15, 30, 60].contains(&self.fps) || !sources.iter().any(|s| s.id == self.display_id) {
            return Err(AppError::new("validation", "Refresh displays and select a supported frame rate."));
        }
        Ok(())
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    pub started_at: Option<u64>,
    pub error: Option<AppError>,
}

impl Status {
    pub fn advance(&mut self, next: Phase) -> Result<(), AppError> {
        self.phase = self.phase.transition(next)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lifecycle_and_overlap() {
        let mut p = Phase::Idle;
        for next in [Phase::Preparing, Phase::Recording, Phase::Finalizing, Phase::Completed] {
            p = p.transition(next).unwrap();
        }
        assert!(Phase::Recording.transition(Phase::Preparing).is_err());
        assert!(Phase::Preparing.transition(Phase::Completed).is_err());
        assert!(Phase::Idle.transition(Phase::Finalizing).is_err());
    }

    #[test]
    fn validates_boundary() {
        let sources = [Source { id: 1, width: 1920, height: 1080 }];
        assert!(StartRequest { display_id: 1, fps: 30 }.validate(&sources).is_ok());
        assert!(StartRequest { display_id: 2, fps: 30 }.validate(&sources).is_err());
        assert!(StartRequest { display_id: 1, fps: 300 }.validate(&sources).is_err());
        assert!(serde_json::from_str::<StartRequest>(r#"{"displayId":1,"fps":30,"path":"/tmp/a"}"#).is_err());
    }
}

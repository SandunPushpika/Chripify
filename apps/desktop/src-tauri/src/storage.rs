use crate::domain::AppError;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};

#[derive(Clone)]
pub struct Storage { root: PathBuf }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub created_at: u64,
    pub bytes: u64,
    pub path: String,
    pub missing: bool,
}

fn private_directory(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => return Err(AppError::storage()),
        Ok(_) => {},
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)] {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path).map_err(|_| AppError::storage())?;
        },
        Err(_) => return Err(AppError::storage()),
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| AppError::storage())?;
    }
    Ok(())
}

impl Storage {
    pub fn initialize(root: PathBuf) -> Result<Self, AppError> {
        private_directory(&root)?;
        let storage = Self { root };
        let db = storage.open()?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS recordings (
          id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, bytes INTEGER NOT NULL);
          PRAGMA user_version=1;").map_err(|_| AppError::storage())?;
        Ok(storage)
    }
    fn open(&self) -> Result<Connection, AppError> {
        let path = self.root.join("library.sqlite3");
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(AppError::storage());
        }
        Connection::open(path).map_err(|_| AppError::storage())
    }
    pub fn allocate(&self, id: &str) -> Result<PathBuf, AppError> {
        // Validate even internally generated identifiers before constructing paths.
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| AppError::storage())?;
        if parsed.hyphenated().to_string() != id { return Err(AppError::storage()); }
        let folder = self.root.join(id);
        // Atomic create: never adopt an existing session directory, including a raced-in symlink.
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)] {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&folder).map_err(|_| AppError::storage())?;
        Ok(folder.join("recording.mp4"))
    }
    pub fn free_bytes(&self) -> Result<u64, AppError> {
        fs2::available_space(&self.root).map_err(|_| AppError::storage())
    }
    pub fn complete(&self, id: &str, created_at: u64, path: &Path) -> Result<(), AppError> {
        let meta = fs::symlink_metadata(path).map_err(|_| AppError::storage())?;
        if !meta.is_file() || meta.len() == 0 { return Err(AppError::storage()); }
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| AppError::storage())?;
        }
        fs::File::open(path).and_then(|f| f.sync_all()).map_err(|_| AppError::storage())?;
        self.open()?.execute("INSERT INTO recordings (id, created_at, bytes) VALUES (?1, ?2, ?3)
          ON CONFLICT(id) DO NOTHING", params![id, created_at, meta.len()]).map_err(|_| AppError::storage())?;
        Ok(())
    }
    pub fn list(&self) -> Result<Vec<Recording>, AppError> {
        let db = self.open()?;
        let mut stmt = db.prepare("SELECT id, created_at, bytes FROM recordings ORDER BY created_at DESC LIMIT 200")
            .map_err(|_| AppError::storage())?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            // Corrupt metadata must never become a filesystem path.
            if !uuid::Uuid::parse_str(&id).is_ok_and(|uuid| uuid.hyphenated().to_string() == id) {
                return Err(rusqlite::Error::InvalidQuery);
            }
            let path = self.root.join(&id).join("recording.mp4");
            Ok(Recording { id, created_at: row.get(1)?, bytes: row.get(2)?,
                missing: !fs::symlink_metadata(&path).is_ok_and(|m| m.is_file()),
                path: path.to_string_lossy().into_owned() })
        }).map_err(|_| AppError::storage())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|_| AppError::storage())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestFolder(PathBuf);
    impl TestFolder {
        fn new() -> Self { Self(std::env::temp_dir().join(format!("chripify-test-{}", uuid::Uuid::new_v4()))) }
    }
    impl Drop for TestFolder {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }
    #[test]
    fn rejects_traversal_and_preexisting_sessions() {
        let folder = TestFolder::new();
        let storage = Storage::initialize(folder.0.clone()).unwrap();
        assert!(storage.allocate("../escape").is_err());
        let id = uuid::Uuid::new_v4().to_string();
        assert!(storage.allocate(&id).is_ok());
        assert!(storage.allocate(&id).is_err());
    }
    #[test]
    fn completes_idempotently_and_detects_missing_media() {
        let folder = TestFolder::new();
        let storage = Storage::initialize(folder.0.clone()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let path = storage.allocate(&id).unwrap();
        assert!(storage.complete(&id, 10, &path).is_err());
        fs::write(&path, b"test-file-not-real-media").unwrap();
        storage.complete(&id, 10, &path).unwrap();
        storage.complete(&id, 10, &path).unwrap();
        let records = storage.list().unwrap();
        assert_eq!(records.len(), 1);
        assert!(!records[0].missing);
        fs::remove_file(path).unwrap();
        assert!(storage.list().unwrap()[0].missing);
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_root_and_protects_directory() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};
        let folder = TestFolder::new();
        let link = TestFolder::new();
        let storage = Storage::initialize(folder.0.clone()).unwrap();
        assert_eq!(fs::metadata(&storage.root).unwrap().permissions().mode() & 0o777, 0o700);
        symlink(&folder.0, &link.0).unwrap();
        assert!(Storage::initialize(link.0.clone()).is_err());
        fs::remove_file(&link.0).unwrap();
    }
}

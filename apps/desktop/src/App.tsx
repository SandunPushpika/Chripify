import { useEffect, useState } from 'react';
import { canStart, elapsed, isDesktop } from './contracts';
import { useRecorder } from './useRecorder';

type Page = 'recorder' | 'library' | 'settings';
function Glyph({ type }: { type: 'record' | 'library' | 'settings' | 'shield' | 'screen' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {type === 'record' && (
        <>
          <rect x="3" y="5" width="13" height="14" rx="3" />
          <path d="m16 10 5-3v10l-5-3z" />
        </>
      )}
      {type === 'library' && (
        <>
          <rect x="3" y="6" width="18" height="15" rx="3" />
          <path d="M7 3h10M10 11l5 3-5 3z" />
        </>
      )}
      {type === 'settings' && (
        <>
          <path d="M4 7h16M4 17h16" />
          <circle cx="9" cy="7" r="3" />
          <circle cx="15" cy="17" r="3" />
        </>
      )}
      {type === 'shield' && (
        <>
          <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}
      {type === 'screen' && (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M12 17v4m-5 0h10" />
        </>
      )}
    </svg>
  );
}
export function App() {
  const recorder = useRecorder();
  const [page, setPage] = useState<Page>('recorder');
  const [sourceId, setSourceId] = useState(0);
  const [fps, setFps] = useState(30);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('chripify-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('chripify-theme', theme);
    } catch {
      /* Appearance remains usable when WebView storage is unavailable. */
    }
  }, [theme]);
  useEffect(() => {
    if (recorder.status.phase !== 'recording') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [recorder.status.phase]);
  const selected = recorder.sources.find((s) => s.id === sourceId) ?? recorder.sources[0];
  const ready = canStart(recorder.status.phase);
  const recording = recorder.status.phase === 'recording';
  const list = recorder.recordings.filter((item) =>
    `${item.id} ${new Date(item.createdAt * 1000).toLocaleString()}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('recorder');
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            c<span />
          </span>
          chripify<span className="beta">LOCAL</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(['recorder', 'library', 'settings'] as const).map((p) => (
            <button
              key={p}
              className={`nav-item ${page === p ? 'selected' : ''}`}
              aria-current={page === p ? 'page' : undefined}
              onClick={() => setPage(p)}
            >
              <Glyph type={p === 'recorder' ? 'record' : p} />
              {p === 'recorder' ? 'Studio' : p === 'library' ? 'Recordings' : 'Settings'}
              {p === 'library' && <span className="count">{recorder.recordings.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <Glyph type="shield" />
            <strong>Yours. Only yours.</strong>
            <p>Your screen stays on your device. No accounts. No uploads.</p>
          </div>
          <div className="version">
            <span className="green-dot" />
            Local workspace<span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{' '}
            <strong>
              {page === 'recorder' ? 'Studio' : page === 'library' ? 'Recordings' : 'Settings'}
            </strong>
          </span>
          <div className="topbar-actions">
            {recording && (
              <button
                className="persistent-stop"
                aria-label="Stop recording and save"
                disabled={recorder.busy}
                onClick={() => {
                  void recorder.stop();
                }}
              >
                <span className="record-dot" />
                <span aria-hidden="true">Stop · {elapsed(recorder.status.startedAt, now)}</span>
              </button>
            )}
            {(recorder.status.phase === 'preparing' || recorder.status.phase === 'finalizing') && (
              <span role="status">
                {recorder.status.phase === 'preparing' ? 'Preparing capture…' : 'Saving recording…'}
              </span>
            )}
            <span className="local-badge">
              <Glyph type="shield" />
              100% local
            </span>
          </div>
        </header>
        <div className="content">
          {!isDesktop() && (
            <div className="preview-banner">
              Interface preview · Native recording is available in the macOS desktop app.
            </div>
          )}
          {recorder.error && (
            <div role="alert" className="error-banner">
              {recorder.error}
            </div>
          )}
          {page === 'recorder' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAKE SOMETHING WORTH SHARING</div>
                  <h1>Your screen. Your story.</h1>
                  <p>A little less meeting. A little more showing.</p>
                </div>
                <span className="status-pill" role="status">
                  <span className={recording ? 'record-dot' : 'green-dot'} />
                  {recording
                    ? 'Recording'
                    : recorder.status.phase === 'preparing'
                    ? 'Preparing…'
                    : recorder.status.phase === 'finalizing'
                    ? 'Saving…'
                    : 'Ready when you are'}
                </span>
              </div>
              <section className="studio-card" aria-label="Screen recorder">
                <div className="card-heading">
                  <span>
                    <Glyph type="screen" />
                    Screen recording
                  </span>
                  <span className="subtle">VIDEO ONLY · FIRST RELEASE</span>
                </div>
                <div className={`capture-stage ${recording ? 'is-recording' : ''}`}>
                  <div className="stage-grid" />
                  <div className="screen-illustration">
                    <div className="mini-top">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="mini-content">
                      <div className="mini-side" />
                      <div className="mini-lines">
                        <i />
                        <i />
                        <div className="mini-blocks">
                          <b />
                          <b />
                          <b />
                        </div>
                      </div>
                    </div>
                    <div className="play-emblem">
                      <Glyph type="record" />
                    </div>
                  </div>
                  <h2>
                    {recording
                      ? 'You’re on. Make it yours.'
                      : recorder.status.phase === 'completed'
                      ? 'That’s a wrap.'
                      : 'Great ideas start here.'}
                  </h2>
                  <p>
                    {recording
                      ? 'Your selected display is being saved locally.'
                      : recorder.status.phase === 'completed'
                      ? 'Your recording has been saved to your local library.'
                      : 'Choose a display, hit record, and let your screen do the talking.'}
                  </p>
                  <span className="stage-note">
                    {recording
                      ? elapsed(recorder.status.startedAt, now)
                      : 'No live preview · Your display is captured at recording time'}
                  </span>
                </div>
                <div className="capture-options">
                  <div className="field">
                    <label htmlFor="display">Capture source</label>
                    <div className="source-row">
                      <select
                        id="display"
                        disabled={!ready || recorder.busy || !recorder.sources.length}
                        value={selected?.id ?? ''}
                        onChange={(e) => setSourceId(Number(e.target.value))}
                      >
                        <option value="" disabled>
                          Choose your display
                        </option>
                        {recorder.sources.map((s, i) => (
                          <option key={s.id} value={s.id}>
                            Display {i + 1} · {s.width} × {s.height}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-button"
                        title="Find displays and request screen permission"
                        aria-label="Find displays and request screen permission"
                        disabled={!ready || recorder.busy || !isDesktop()}
                        onClick={() => {
                          void recorder.refreshSources();
                        }}
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                  <div className="field fps">
                    <label htmlFor="fps">Frame rate</label>
                    <select
                      id="fps"
                      value={fps}
                      disabled={!ready || recorder.busy}
                      onChange={(e) => setFps(Number(e.target.value))}
                    >
                      <option value={15}>15 fps</option>
                      <option value={30}>30 fps</option>
                      <option value={60}>60 fps</option>
                    </select>
                  </div>
                </div>
                <div className="record-footer">
                  <span>
                    <span className="small-lock">◇</span>Saved privately on this Mac
                  </span>
                  <button
                    className={`record-button ${recording ? 'stop-button' : ''}`}
                    disabled={
                      recorder.busy || (!recording && (!ready || !selected || !isDesktop()))
                    }
                    onClick={() => {
                      if (recording) void recorder.stop();
                      else if (selected) void recorder.start(selected.id, fps);
                    }}
                  >
                    <span className={recording ? 'stop-icon' : 'button-record-dot'} />
                    {recording
                      ? 'Stop & save'
                      : recorder.status.phase === 'finalizing'
                      ? 'Finalizing…'
                      : recorder.status.phase === 'preparing'
                      ? 'Preparing…'
                      : 'Start recording'}
                  </button>
                </div>
              </section>
              <div className="below-studio">
                <div>
                  <Glyph type="shield" />
                  <span>
                    <strong>Privacy comes standard.</strong> No cloud. No tracking. Just your ideas.
                  </span>
                </div>
                <span>H.264 / MP4 · Up to 1080p</span>
              </div>
              <section className="recent">
                <div className="section-heading">
                  <h2>
                    Recent recordings <span>{recorder.recordings.length}</span>
                  </h2>
                  <button className="text-button" onClick={() => setPage('library')}>
                    View library <span>↗</span>
                  </button>
                </div>
                {recorder.recordings.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Glyph type="library" />
                    </div>
                    <strong>A home for your next big idea</strong>
                    <p>Your recordings will appear here. Create your first one above.</p>
                  </div>
                ) : (
                  <div className="recording-list">
                    {recorder.recordings.slice(0, 3).map((item) => (
                      <article key={item.id}>
                        <Glyph type="record" />
                        <div>
                          <strong>Screen recording</strong>
                          <p>{new Date(item.createdAt * 1000).toLocaleString()}</p>
                        </div>
                        <span>{(item.bytes / 1024 / 1024).toFixed(1)} MB</span>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          {page === 'library' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">STORED ON YOUR DEVICE</div>
                  <h1>Your recordings</h1>
                  <p>A private space for everything you’ve captured.</p>
                </div>
              </div>
              <label className="search-label" htmlFor="search">
                Search by date or recording ID
              </label>
              <input
                id="search"
                className="search"
                placeholder="Search recordings…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="recording-list">
                {list.length === 0 && (
                  <div className="empty-state">
                    <Glyph type="library" />
                    <h2>No recordings found</h2>
                    <p>
                      {query
                        ? 'Try a different search.'
                        : 'Record your first screen from the Studio.'}
                    </p>
                  </div>
                )}
                {list.map((item) => (
                  <article className="library-item" key={item.id}>
                    <Glyph type="record" />
                    <div>
                      <strong>
                        Screen recording · {new Date(item.createdAt * 1000).toLocaleString()}
                      </strong>
                      <p className="file-path">{item.path}</p>
                      <p>
                        {item.missing
                          ? 'File missing or unavailable'
                          : 'Open this local path in Finder to play your recording.'}
                      </p>
                    </div>
                    <span>{(item.bytes / 1024 / 1024).toFixed(1)} MB</span>
                  </article>
                ))}
              </div>
            </>
          )}
          {page === 'settings' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">KEEP IT PERSONAL</div>
                  <h1>Settings</h1>
                  <p>Simple by design. Private by default.</p>
                </div>
              </div>
              <section className="settings-card">
                <h2>Appearance</h2>
                <label htmlFor="theme">Color theme</label>
                <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
                <h2>Local storage</h2>
                <p>
                  Recordings and SQLite metadata are stored in this app’s private macOS Application
                  Support directory. Custom save locations are planned.
                </p>
                <h2>Current capabilities</h2>
                <p>
                  macOS 15+ display capture, visible cursor, H.264 video, and local recording
                  metadata. Audio, window capture, pause, webcam overlays, background effects, and
                  Chrome integration are not yet available.
                </p>
                <h2>Screen Recording permission</h2>
                <p>
                  Use the refresh button in Studio to discover displays and request access. If
                  denied, open System Settings → Privacy &amp; Security → Screen &amp; System Audio
                  Recording, allow Chripify, and restart.
                </p>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

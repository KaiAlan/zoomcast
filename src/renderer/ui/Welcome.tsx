import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingSummary } from "../../shared/api";
import { folderPath, recordingLabel as recordingTitle, visibleRecordings } from "../../shared/library/filter";
import type { LibraryScope, LibrarySort, LibraryState, RecordingFolder } from "../../shared/library/types";
import { Icon } from "./Icon";
import "./library.css";

type Props = { onOpen: (dir: string) => void; error: string | null };
const mb = (bytes: number): string => bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
const duration = (ms?: number) => ms === undefined ? "—" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function RecordingPreview({ recording }: { recording: RecordingSummary }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect();
      void window.zoomcast.library.thumbnail(recording.id).then(src => {
        if (!cancelled) { setImage(src); setFailed(src === null); }
      }).catch(() => { if (!cancelled) setFailed(true); });
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [recording.id]);
  return <span className="recording-preview" ref={ref}>
    {image && !failed ? <img src={image} alt={`Preview of ${recordingTitle(recording)}`} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span className="preview-placeholder"><Icon name="play" size={28}/><span>{failed ? "Preview unavailable" : "Loading preview…"}</span></span>}
    <span className="preview-play"><Icon name="play" size={22}/></span>
    <span className="preview-duration">{duration(recording.durationMs)}</span>
    {recording.unclean && <span className="warning-badge preview-warning">Interrupted</span>}
  </span>;
}
function FolderTree({ folders, parentId = null, depth = 0, scope, recordings, select }: { folders: RecordingFolder[]; parentId?: string | null; depth?: number; scope: LibraryScope; recordings: RecordingSummary[]; select: (scope: LibraryScope) => void }) {
  return <>{folders.filter(f => f.parentId === parentId).sort((a,b) => a.name.localeCompare(b.name)).map(f => <div key={f.id}>
    <button type="button" className={`library-nav-item ${typeof scope === "object" && scope.folderId === f.id ? "selected" : ""}`} style={{ paddingLeft: 12 + depth * 15 }} onClick={() => select({ folderId: f.id })}><Icon name="folder" size={17}/><span>{f.name}</span><small>{recordings.filter(r => r.folderId === f.id && !r.archived).length}</small></button>
    <FolderTree folders={folders} parentId={f.id} depth={depth + 1} scope={scope} recordings={recordings} select={select}/>
  </div>)}</>;
}
function NewFolderDialog({ parentName, onCreate, onClose }: { parentName: string; onCreate: (name: string) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector("input")?.focus(); }, []);
  return <dialog className="library-dialog" ref={dialog} onCancel={e => { if (saving) e.preventDefault(); else onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); setSaving(true); setError(null); void onCreate(name).catch(err => { setError(String(err)); setSaving(false); }); }}>
      <div className="dialog-heading"><h2>New folder</h2><button type="button" className="icon-button" aria-label="Close new folder" disabled={saving} onClick={onClose}><Icon name="close"/></button></div>
      <p>Create a folder in {parentName}.</p>
      <label htmlFor="folder-name">Folder name</label><input id="folder-name" value={name} maxLength={80} required placeholder="e.g. Tutorials" onChange={e => setName(e.target.value)} />
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="quiet-action" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="primary-action" disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create folder"}</button></div>
    </form>
  </dialog>;
}
export function Welcome({ onOpen, error }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState<LibraryState>({ recordings: [], folders: [] });
  const [scope, setScope] = useState<LibraryScope>(() => {
    try {
      const saved = localStorage.getItem("zoomcast.library.scope");
      if (saved?.startsWith("folder:")) return { folderId: saved.slice(7) };
      if (saved === "archive" || saved === "unfiled") return saved;
    } catch { /* Use All recordings if storage is unavailable. */ }
    return "all";
  });
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [view, setView] = useState<"gallery" | "list">(() => { try { return localStorage.getItem("zoomcast.library.view") === "list" ? "list" : "gallery"; } catch { return "gallery"; } });
  const [notice, setNotice] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState("");
  const [recording, setRecording] = useState(false);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setLibrary(await window.zoomcast.library.get()); }
    catch (err) { setNotice(String(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    void window.zoomcast.recordHotkey().then(setHotkey);
    void window.zoomcast.isRecording().then(setRecording);
    const offs = [window.zoomcast.recording.onStarted(() => setRecording(true)), window.zoomcast.recording.onStopped(() => { setRecording(false); void refresh(); }), window.zoomcast.recording.onError(setNotice)];
    return () => { for (const off of offs) off(); };
  }, [refresh]);
  useEffect(() => {
    if (!loading && typeof scope === "object" && !library.folders.some(f => f.id === scope.folderId)) setScope("all");
  }, [loading, scope, library.folders]);
  const folderId = typeof scope === "object" ? scope.folderId : null;
  const currentPath = folderId ? folderPath(library.folders, folderId) : [];
  const title = currentPath.at(-1)?.name ?? (scope === "archive" ? "Archive" : scope === "unfiled" ? "Unfiled recordings" : "Your recordings");
  const filtered = visibleRecordings(library.recordings, scope, query, sort);
  const childFolders = scope === "archive" || scope === "unfiled" ? [] : library.folders.filter(f => f.parentId === folderId).sort((a,b) => a.name.localeCompare(b.name));
  const chooseScope = (next: LibraryScope) => { setScope(next); setMoving(null); setQuery(""); try { localStorage.setItem("zoomcast.library.scope", typeof next === "object" ? `folder:${next.folderId}` : next); } catch { /* Navigation works without storage. */ } };
  const changeView = (next: "gallery" | "list") => { setView(next); try { localStorage.setItem("zoomcast.library.view", next); } catch { /* View still changes without local storage. */ } };
  const mutate = async (id: string, action: () => Promise<void>, message: string) => {
    setBusy(id); setNotice(null);
    try { await action(); setMoving(null); await refresh(); setNotice(message); }
    catch (err) { setNotice(String(err)); }
    finally { setBusy(null); }
  };
  const startRecording = () => {
    setNotice(null);
    void (recording ? window.zoomcast.toggleRecording() : window.zoomcast.library.recordInFolder(folderId)).catch(err => setNotice(String(err)));
  };
  return <main className="library-page library-organized">
    <header className="library-header"><div className="brand"><span className="brand-mark" aria-hidden="true"/>zoomcast</div><div className="library-header-actions"><button type="button" className="quiet-action" onClick={() => void window.zoomcast.openSettings()}><Icon name="settings" size={16}/>Settings</button><button type="button" className="primary-action" onClick={startRecording}><span className="record-dot"/>{recording ? "Recording controls" : folderId ? "Record in this folder" : "New recording"}</button></div></header>
    <div className="library-layout">
      <aside className="library-sidebar" aria-label="Recording folders">
        <div className="library-nav-heading">LIBRARY</div>
        <button type="button" className={`library-nav-item ${scope === "all" ? "selected" : ""}`} onClick={() => chooseScope("all")}><Icon name="gallery" size={17}/><span>All recordings</span><small>{library.recordings.filter(r => !r.archived).length}</small></button>
        <button type="button" className={`library-nav-item ${scope === "unfiled" ? "selected" : ""}`} onClick={() => chooseScope("unfiled")}><Icon name="list" size={17}/><span>Unfiled</span><small>{library.recordings.filter(r => !r.archived && !r.folderId).length}</small></button>
        <button type="button" className={`library-nav-item ${scope === "archive" ? "selected" : ""}`} onClick={() => chooseScope("archive")}><Icon name="archive" size={17}/><span>Archive</span><small>{library.recordings.filter(r => r.archived).length}</small></button>
        <div className="library-nav-heading folders-heading"><span>FOLDERS</span><button type="button" className="icon-button" aria-label="New folder" title={folderId ? `New subfolder in ${title}` : "New folder"} onClick={() => setCreating(true)}><Icon name="plus" size={16}/></button></div>
        <FolderTree folders={library.folders} recordings={library.recordings} scope={scope} select={chooseScope}/>
        {!library.folders.length && <p className="folder-help">Create folders to keep your takes together.</p>}
        <div className="library-sidebar-footer"><button type="button" className="quiet-action" onClick={() => void window.zoomcast.pickBundle().then(dir => { if (dir) onOpen(dir); }).catch(err => setNotice(String(err)))}><Icon name="folder" size={16}/>Open recording…</button><p>{hotkey ? `${hotkey} opens recording controls` : "Recording controls are in the system tray."}</p></div>
      </aside>
      <section className="library-content" aria-labelledby="library-title">
        <nav className="library-breadcrumb" aria-label="Folder path"><button type="button" onClick={() => chooseScope("all")}>Library</button>{currentPath.map(f => <span key={f.id}> / <button type="button" onClick={() => chooseScope({ folderId: f.id })}>{f.name}</button></span>)}{scope === "archive" && <span> / Archive</span>}{scope === "unfiled" && <span> / Unfiled</span>}</nav>
        <div className="library-title-row"><div><h1 id="library-title">{title}</h1><p>{filtered.length} {filtered.length === 1 ? "recording" : "recordings"} · {mb(filtered.reduce((sum,r) => sum + r.sizeBytes, 0))}{scope === "archive" ? " · Restore a take whenever you need it." : " · Ready for your next story."}</p></div><button type="button" className="quiet-action" onClick={() => setCreating(true)}><Icon name="plus" size={16}/>New folder</button></div>
        <div className="library-toolbar"><div className="library-search-wrap"><Icon name="search" size={17}/><input className="library-search" type="search" aria-label="Search recordings" placeholder="Search recordings…" value={query} onChange={e => setQuery(e.target.value)}/></div><label className="library-sort"><span>Sort by</span><select aria-label="Sort recordings" value={sort} onChange={e => setSort(e.target.value as LibrarySort)}><option value="recent">Recent first</option><option value="oldest">Oldest first</option><option value="name">Name (A–Z)</option><option value="duration">Longest first</option><option value="size">Largest first</option></select></label><fieldset className="library-view-toggle"><legend className="sr-only">Recording view</legend><button type="button" title="Gallery view" aria-label="Gallery view" aria-pressed={view === "gallery"} onClick={() => changeView("gallery")}><Icon name="gallery" size={18}/></button><button type="button" title="List view" aria-label="List view" aria-pressed={view === "list"} onClick={() => changeView("list")}><Icon name="list" size={19}/></button></fieldset></div>
        {(notice || error) && <div className="library-notice" role={error ? "alert" : "status"}>{error || notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><Icon name="close" size={14}/></button></div>}
        {childFolders.length > 0 && !query && <div className="library-folder-grid">{childFolders.map(f => <button type="button" key={f.id} className="library-folder-card" onClick={() => chooseScope({ folderId: f.id })}><span className="folder-card-icon"><Icon name="folder" size={24}/></span><span><strong>{f.name}</strong><small>{library.recordings.filter(r => r.folderId === f.id && !r.archived).length} recordings</small></span></button>)}</div>}
        {loading ? <div className="empty-state" role="status">Loading recordings…</div> : filtered.length === 0 ? <div className="library-empty"><Icon name={scope === "archive" ? "archive" : "folder"} size={35}/><h2>{query ? "No recordings match your search." : scope === "archive" ? "Nothing archived yet" : "No recordings here yet"}</h2><p>{query ? "Try a different search." : scope === "archive" ? "Hover over a recording and choose Archive to store it here." : folderId ? "Record a new take here or move recordings into this folder." : "Start a new recording or open an existing take."}</p>{scope !== "archive" && !query && <button type="button" className="primary-action" onClick={startRecording}>{folderId ? "Record in this folder" : "New recording"}</button>}</div> : <div className={`recording-collection ${view}`} data-view={view}>
          {filtered.map(r => <article className="recording-card" data-recording-id={r.id} key={r.id} aria-label={`Recording ${recordingTitle(r)}`}>
            <button type="button" className="recording-open" onClick={() => onOpen(r.dir)} aria-label={`Open recording ${recordingTitle(r)}`}><RecordingPreview recording={r}/><span className="recording-info"><span className="recording-name">{recordingTitle(r)}</span><span className="recording-meta">{r.hasWebcam ? "Screen + webcam" : "Screen"}{r.audioTracks ? " · Audio" : ""} · {mb(r.sizeBytes)}</span><span className="recording-folder-label">{r.folderId ? folderPath(library.folders, r.folderId).map(f => f.name).join(" / ") : "Unfiled"}</span></span></button>
            <div className="recording-card-actions"><button type="button" title={r.archived ? "Restore recording" : "Move to archive"} aria-label={r.archived ? "Restore recording" : "Archive recording"} disabled={busy !== null} onClick={() => void mutate(r.id, () => window.zoomcast.library.archive(r.id, !r.archived), r.archived ? "Recording restored." : "Recording moved to Archive.")}><Icon name={r.archived ? "undo" : "archive"} size={17}/></button><button type="button" title="Move to folder" aria-label="Move recording" aria-expanded={moving === r.id} disabled={busy !== null} onClick={() => setMoving(moving === r.id ? null : r.id)}><Icon name="move" size={17}/></button><button type="button" className="delete-action" title="Delete to Recycle Bin" aria-label="Delete recording" disabled={busy !== null} onClick={() => void mutate(r.id, () => window.zoomcast.library.delete(r.id), "Recording moved to the Recycle Bin.")}><Icon name="trash" size={17}/></button></div>
            {moving === r.id && <div className="recording-move-panel"><label>Move to folder<select aria-label="Move recording to folder" value={r.folderId ?? ""} disabled={busy !== null} onChange={e => void mutate(r.id, () => window.zoomcast.library.move(r.id, e.target.value || null), "Recording moved.")}><option value="">Unfiled (Library)</option>{library.folders.map(f => <option key={f.id} value={f.id}>{folderPath(library.folders, f.id).map(p => p.name).join(" / ")}</option>)}</select></label>{!library.folders.length && <button type="button" className="quiet-action" onClick={() => setCreating(true)}>Create a folder</button>}<button type="button" className="icon-button" aria-label="Close folder picker" onClick={() => setMoving(null)}><Icon name="close" size={14}/></button></div>}
          </article>)}
        </div>}
      </section>
    </div>
    {creating && <NewFolderDialog parentName={folderId ? title : "Library"} onClose={() => setCreating(false)} onCreate={async name => { const folder = await window.zoomcast.library.createFolder(name, folderId); await refresh(); chooseScope({ folderId: folder.id }); setCreating(false); setNotice(`Created “${folder.name}”.`); }}/>}
  </main>;
}

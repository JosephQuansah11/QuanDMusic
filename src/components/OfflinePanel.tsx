import { useEffect, useState } from 'react';
import type { ProjectMeta } from '../state/idb';

export interface OfflinePanelProps {
  projects: ProjectMeta[];
  online: boolean;
  currentProjectId: string | null;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSave: () => void;
  hasScore: boolean;
  onRefresh: () => void;
  onExportAll: () => void;
}

export function OfflinePanel({
  projects,
  online,
  currentProjectId,
  onOpenProject,
  onDeleteProject,
  onSave,
  hasScore,
  onRefresh,
  onExportAll,
}: OfflinePanelProps) {
  const [cached, setCached] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    void navigator.serviceWorker.getRegistration().then((registration) => setCached(Boolean(registration)));
  }, []);

  return (
    <div className="stack">
      <section className="panel">
        <h1 className="title">Offline and on your device</h1>
        <p className="muted">
          QuanDMusic is a progressive web app. The interface, the analysis engine, the engraver, the synthesizer and your
          projects all run locally. Nothing is uploaded anywhere.
        </p>
        <ul className="lines">
          <li>Connection: {online ? 'online (the app still works if you go offline)' : 'offline, everything still works'}</li>
          <li>App shell cached for offline use: {cached ? 'yes' : 'not yet (reload once online)'}</li>
          <li>Projects on this device: {projects.length}</li>
        </ul>
        <div className="row wrap gap">
          <button type="button" className="primary" onClick={onSave} disabled={!hasScore}>
            Save the current project
          </button>
          <button type="button" className="ghost" onClick={onRefresh}>
            Refresh the list
          </button>
          <button type="button" className="ghost" onClick={onExportAll} disabled={!hasScore}>
            Export the current score
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Stored projects</h2>
        {projects.length === 0 ? (
          <p className="muted">Nothing stored yet. Import a song, then press save.</p>
        ) : (
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button type="button" className="link strong" onClick={() => onOpenProject(project.id)}>
                  {project.name}
                </button>
                {project.id === currentProjectId && <span className="badge">open</span>}
                <span className="muted small">
                  {project.source} · {new Date(project.updatedAt).toLocaleString()}
                </span>
                <button type="button" className="link danger" onClick={() => onDeleteProject(project.id)}>
                  delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Taking it to a music stand</h2>
        <ol className="tips">
          <li>Export the part as MusicXML and open it in any notation app, or print it.</li>
          <li>Download the part as a WAV guide track and put it on your phone.</li>
          <li>Practise from the Practice tab: loop bars, slow down, mute your own part.</li>
          <li>Install the app (browser menu, then Install or Add to Home Screen) for a full-screen offline workspace.</li>
        </ol>
      </section>
    </div>
  );
}

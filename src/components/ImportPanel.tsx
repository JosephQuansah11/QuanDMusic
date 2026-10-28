import { useRef, useState } from 'react';
import type { ProjectMeta } from '../state/idb';

export interface ImportPanelProps {
  onFile: (file: File) => void;
  onDemo: () => void;
  onDemoAudio: () => void;
  onPasteMusicXml: (xml: string) => void;
  projects: ProjectMeta[];
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  busy: { stage: string; ratio: number } | null;
  online: boolean;
  hasScore: boolean;
  onOpenScore: () => void;
}

export function ImportPanel({
  onFile,
  onDemo,
  onDemoAudio,
  onPasteMusicXml,
  projects,
  onOpenProject,
  onDeleteProject,
  busy,
  online,
  hasScore,
  onOpenScore,
}: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [xml, setXml] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  return (
    <div className="stack">
      <section className="panel hero">
        <h1>Split any song into Soprano, Alto, Tenor and Bass</h1>
        <p>
          Upload a recording, a MIDI file or MusicXML. QuanDMusic finds the four voice parts, writes them as a score in
          solfège (<strong>d r m f s l ti do</strong>) or letter names, keeps the exact rhythm and tempo, transposes to a
          comfortable key, and shows you how to play your part on your instrument.
        </p>
        <p className="muted">
          Everything is analysed on this device and saved locally, so it keeps working with no connection.
        </p>
      </section>

      <section className="panel">
        <div
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mid,.midi,.musicxml,.xml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = '';
            }}
          />
          <span className="dropzone-icon" aria-hidden="true">
            &#9834;
          </span>
          <strong>Drop a song here or click to choose a file</strong>
          <span className="muted">audio (mp3, wav, m4a, ogg), MIDI (.mid) or MusicXML (.musicxml, .xml)</span>
        </div>

        <div className="row wrap gap">
          <button type="button" className="ghost" onClick={onDemo} disabled={Boolean(busy)}>
            Open the demo chorale
          </button>
          <button type="button" className="ghost" onClick={onDemoAudio} disabled={Boolean(busy)}>
            Analyse a synthesized performance
          </button>
          <button type="button" className="ghost" onClick={() => setShowPaste((value) => !value)}>
            {showPaste ? 'Hide MusicXML paste' : 'Paste MusicXML'}
          </button>
          {hasScore && (
            <button type="button" className="primary" onClick={onOpenScore}>
              Back to the score
            </button>
          )}
        </div>

        {showPaste && (
          <div className="stack">
            <textarea
              className="code"
              rows={6}
              placeholder="<score-partwise> ... </score-partwise>"
              value={xml}
              onChange={(event) => setXml(event.target.value)}
            />
            <button
              type="button"
              className="primary"
              disabled={!xml.trim() || Boolean(busy)}
              onClick={() => onPasteMusicXml(xml)}
            >
              Read this MusicXML
            </button>
          </div>
        )}

        <p className="muted small">
          {online
            ? 'Online now. Once a project is open, everything keeps working offline.'
            : 'You are offline. Uploads, analysis, the score and the instrument guide all still work.'}
        </p>
      </section>

      {projects.length > 0 && (
        <section className="panel">
          <h2>Saved on this device</h2>
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button type="button" className="link strong" onClick={() => onOpenProject(project.id)}>
                  {project.name}
                </button>
                <span className="muted small">
                  {project.source} &middot; {new Date(project.updatedAt).toLocaleString()}
                </span>
                <button type="button" className="link danger" onClick={() => onDeleteProject(project.id)}>
                  delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

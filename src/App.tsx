import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScorePlayer } from './audio/player';
import { analyzeInWorker } from './dsp/analyzeClient';
import { parseMidi, midiToScore } from './import/midi';
import { musicXmlToScore } from './import/musicxml';
import { detectFileType, downloadBlob, downloadText } from './utils/files';
import { DEMO_SCORE } from './core/demo';
import { renderDemoAudio, renderScoreToPcm } from './audio/voiceSynth';
import { encodeWav } from './audio/wav';
import { exportFileName, exportMusicXml } from './core/musicxmlExport';
import { cloneScore, transposeScore, beatsPerMeasure, totalBeats, type PartId, type Score } from './core/score';
import { keyName } from './core/keys';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectMeta } from './state/idb';
import { DEFAULT_UI, type TabId, type Transport, type UiState } from './state/ui';
import { ImportPanel } from './components/ImportPanel';
import { ScorePanel } from './components/ScorePanel';
import { PracticePanel } from './components/PracticePanel';
import { InstrumentPanel } from './components/InstrumentPanel';
import { OfflinePanel } from './components/OfflinePanel';

const TABS: { id: TabId; label: string }[] = [
  { id: 'import', label: 'Upload' },
  { id: 'score', label: 'Score' },
  { id: 'practice', label: 'Practice' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'offline', label: 'Offline' },
];

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export default function App() {
  const [score, setScore] = useState<Score | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('import');
  const [ui, setUi] = useState<UiState>(DEFAULT_UI);
  const [busy, setBusy] = useState<{ stage: string; ratio: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [original, setOriginal] = useState<{ name: string; buffer: AudioBuffer } | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [isPlaying, setIsPlaying] = useState(false);
  const [beat, setBeat] = useState(0);

  const playerRef = useRef<ScorePlayer | null>(null);
  const originalRef = useRef<AudioBuffer | null>(null);

  const getPlayer = useCallback((): ScorePlayer => {
    if (!playerRef.current) playerRef.current = new ScorePlayer();
    return playerRef.current;
  }, []);

  const viewScore = useMemo(() => (score ? transposeScore(score, ui.transpose) : null), [score, ui.transpose]);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [refreshProjects]);

  useEffect(() => {
    const player = getPlayer();
    return player.onUpdate((position, playing) => {
      setBeat(position);
      setIsPlaying(playing);
    });
  }, [getPlayer]);

  // A new score stops playback; mix changes must not.
  useEffect(() => {
    if (!viewScore) return;
    getPlayer().setScore(viewScore);
    setBeat(0);
  }, [viewScore, getPlayer]);

  // Mix settings are applied live, without interrupting playback.
  useEffect(() => {
    const player = getPlayer();
    player.setMetronome(ui.metronome);
    player.setDrone(ui.drone);
    player.setSolo(ui.solo);
    for (const id of ['S', 'A', 'T', 'B'] as PartId[]) player.setPartMuted(id, ui.muted[id]);
    player.setOriginalVolume(ui.originalVolume);
    player.setOriginalMuted(!ui.showOriginal);
  }, [ui.metronome, ui.drone, ui.solo, ui.muted, ui.showOriginal, ui.originalVolume, getPlayer]);

  useEffect(() => {
    originalRef.current = original?.buffer ?? null;
  }, [original]);

  useEffect(() => {
    if (!viewScore) return;
    const bpm = beatsPerMeasure(viewScore.timeSignature);
    const total = totalBeats(viewScore);
    const player = getPlayer();
    if (ui.loopMeasures) {
      player.setLoop({
        start: Math.max(0, (ui.loopMeasures.start - 1) * bpm),
        end: Math.min(total + bpm, ui.loopMeasures.end * bpm),
      });
    } else {
      player.setLoop(null);
    }
  }, [ui.loopMeasures, viewScore, getPlayer]);

  const finishImport = useCallback(
    async (nextScore: Score, audio?: { name: string; buffer: AudioBuffer }) => {
      setScore(nextScore);
      setUi((current) => ({ ...DEFAULT_UI, instrumentId: current.instrumentId }));
      setOriginal(audio ? { name: audio.name, buffer: audio.buffer } : null);
      setBeat(0);
      setError(null);
      setTab('score');
      try {
        const id = await saveProject(nextScore);
        setProjectId(id);
        await refreshProjects();
      } catch {
        setNotice('This project could not be stored on the device, but you can still use it now.');
      };
    },
    [refreshProjects],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setNotice(null);
      setBusy({ stage: 'Reading the file', ratio: 0.02 });
      try {
        const kind = await detectFileType(file);
        if (kind === 'midi') {
          const parsed = parseMidi(await file.arrayBuffer());
          await finishImport(midiToScore(parsed, { title: stripExtension(file.name) }));
        } else if (kind === 'musicxml') {
          const text = await file.text();
          // MusicXML usually carries its own title; the file name is the fallback.
          const parsed = musicXmlToScore(text);
          if (parsed.title === 'Imported MusicXML') parsed.title = stripExtension(file.name);
          await finishImport(parsed);
        } else if (kind === 'audio') {
          const player = getPlayer();
          setBusy({ stage: 'Decoding audio', ratio: 0.05 });
          const buffer = await player.decodeFile(file);
          const pcm = ScorePlayer.toMonoPcm(buffer);
          const result = await analyzeInWorker(pcm, buffer.sampleRate, stripExtension(file.name), (progress) =>
            setBusy(progress),
          );
          await finishImport(result.score, { name: file.name, buffer });
        } else {
          throw new Error(
            'Unsupported file. Upload audio (mp3, wav, m4a, ogg), MIDI (.mid) or uncompressed MusicXML (.musicxml/.xml).',
          );
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong while importing this file.');
      } finally {
        setBusy(null);
      }
    },
    [finishImport, getPlayer],
  );

  const handlePasteMusicXml = useCallback(
    async (xml: string) => {
      setError(null);
      setBusy({ stage: 'Reading MusicXML', ratio: 0.4 });
      try {
        await finishImport(musicXmlToScore(xml));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'That did not look like MusicXML.');
      } finally {
        setBusy(null);
      }
    },
    [finishImport],
  );

  const loadDemo = useCallback(async () => {
    setError(null);
    await finishImport(cloneScore(DEMO_SCORE));
  }, [finishImport]);

  const analyzeDemoAudio = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy({ stage: 'Rendering the demo performance', ratio: 0.05 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const pcm = renderDemoAudio(22050);
      setBusy({ stage: 'Analysing the demo performance', ratio: 0.15 });
      const result = await analyzeInWorker(pcm, 22050, 'QuanD Demo Chorale (analysed)', (progress) =>
        setBusy(progress),
      );
      await finishImport(result.score);
      setNotice(
        `Analysed the demo audio: ${result.detectedNoteCount} notes, ${Math.round(result.score.tempo)} BPM, ${
          result.onsets
        } onsets, key ${keyName(result.key)}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The demo could not be analysed.');
    } finally {
      setBusy(null);
    }
  }, [finishImport]);

  const play = useCallback(
    (fromBeat?: number, countInBeats?: number) => {
      if (!viewScore) return;
      const player = getPlayer();
      player.setScore(viewScore);
      player.setTempoScale(ui.tempoScale);
      player.setMetronome(ui.metronome);
      player.setDrone(ui.drone);
      player.setSolo(ui.solo);
      for (const id of ['S', 'A', 'T', 'B'] as PartId[]) player.setPartMuted(id, ui.muted[id]);
      player.setOriginalVolume(ui.originalVolume);
      player.setOriginalMuted(!ui.showOriginal);
      const bpm = beatsPerMeasure(viewScore.timeSignature);
      player.setLoop(
        ui.loopMeasures
          ? { start: Math.max(0, (ui.loopMeasures.start - 1) * bpm), end: ui.loopMeasures.end * bpm }
          : null,
      );
      void player.play(fromBeat ?? beat, countInBeats ?? 0, ui.showOriginal ? originalRef.current : null);
    },
    [viewScore, beat, ui, getPlayer],
  );

  const transport: Transport = useMemo(
    () => ({
      isPlaying,
      beat,
      play,
      pause: () => getPlayer().pause(),
      stop: () => {
        getPlayer().stop();
        setBeat(0);
      },
      seek: (target: number) => {
        getPlayer().seek(target);
        setBeat(target);
      },
    }),
    [isPlaying, beat, play, getPlayer],
  );

  const handleLoadProject = useCallback(
    async (id: string) => {
      setBusy({ stage: 'Opening project', ratio: 0.5 });
      try {
        const stored = await loadProject(id);
        if (!stored) throw new Error('That project could not be found on this device.');
        setScore(stored);
        setProjectId(id);
        setUi(DEFAULT_UI);
        setOriginal(null);
        setBeat(0);
        setTab('score');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open the project.');
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      await deleteProject(id);
      if (id === projectId) {
        setScore(null);
        setProjectId(null);
        setTab('import');
      }
      await refreshProjects();
    },
    [projectId, refreshProjects],
  );

  const handleSaveProject = useCallback(async () => {
    if (!viewScore) return;
    try {
      const id = await saveProject(viewScore, projectId ?? undefined);
      setProjectId(id);
      await refreshProjects();
      setNotice('Saved on this device for offline practice.');
    } catch {
      setError('Storage is unavailable in this browser.');
    }
  }, [viewScore, projectId, refreshProjects]);

  const handleExportXml = useCallback(
    (part?: PartId) => {
      if (!viewScore) return;
      downloadText(exportMusicXml(viewScore, part ? { parts: [part] } : {}), exportFileName(viewScore, part));
    },
    [viewScore],
  );

  const handleDownloadWav = useCallback(
    (part: PartId) => {
      if (!viewScore) return;
      const pcm = renderScoreToPcm(viewScore, [part], { sampleRate: 44100 });
      const name = `${viewScore.title.replace(/[^\w\- ]+/g, '')} - ${part}.wav`;
      downloadBlob(new Blob([encodeWav(pcm, 44100)], { type: 'audio/wav' }), name);
    },
    [viewScore],
  );

  const updateUi = useCallback((patch: Partial<UiState>) => setUi((current) => ({ ...current, ...patch })), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            &#9835;
          </span>
          <span>
            <strong>QuanDMusic</strong>
            <small>Every part, every key, every instrument</small>
          </span>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'tab active' : 'tab'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="status">
          <span className={online ? 'dot online' : 'dot offline'} aria-hidden="true" />
          {online ? 'Online' : 'Offline'}
          {score && <span className="status-title">{score.title}</span>}
        </div>
      </header>

      {busy && (
        <div className="progress-strip" role="status" aria-live="polite">
          <div className="progress-bar" style={{ width: `${Math.round((busy.ratio ?? 0) * 100)}%` }} />
          <span>{busy.stage}&hellip;</span>
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="banner notice">
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="content">
        {tab === 'import' && (
          <ImportPanel
            onFile={handleFile}
            onDemo={() => void loadDemo()}
            onDemoAudio={() => void analyzeDemoAudio()}
            onPasteMusicXml={handlePasteMusicXml}
            projects={projects}
            onOpenProject={handleLoadProject}
            onDeleteProject={handleDeleteProject}
            busy={busy}
            online={online}
            hasScore={Boolean(score)}
            onOpenScore={() => setTab('score')}
          />
        )}

        {tab !== 'import' && !viewScore && (
          <section className="panel empty">
            <h2>Nothing loaded yet</h2>
            <p>Upload a song, open a MIDI or MusicXML file, or try the demo chorale.</p>
            <button type="button" className="primary" onClick={() => setTab('import')}>
              Go to upload
            </button>
          </section>
        )}

        {tab === 'score' && viewScore && (
          <ScorePanel
            score={viewScore}
            ui={ui}
            onUiChange={updateUi}
            transport={transport}
            onExportXml={handleExportXml}
            onDownloadWav={handleDownloadWav}
            onSave={handleSaveProject}
            originalName={original?.name ?? null}
          />
        )}

        {tab === 'practice' && viewScore && (
          <PracticePanel
            score={viewScore}
            ui={ui}
            onUiChange={updateUi}
            transport={transport}
            onDownloadWav={handleDownloadWav}
            originalName={original?.name ?? null}
          />
        )}

        {tab === 'instrument' && viewScore && (
          <InstrumentPanel score={viewScore} ui={ui} onUiChange={updateUi} transport={transport} />
        )}

        {tab === 'offline' && (
          <OfflinePanel
            projects={projects}
            online={online}
            currentProjectId={projectId}
            onOpenProject={handleLoadProject}
            onDeleteProject={handleDeleteProject}
            onSave={handleSaveProject}
            hasScore={Boolean(viewScore)}
            onRefresh={() => void refreshProjects()}
            onExportAll={() => handleExportXml()}
          />
        )}
      </main>

      {viewScore && (
        <footer className="transport">
          <button type="button" className="primary" onClick={() => (isPlaying ? transport.pause() : play())}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => transport.stop()}>
            Stop
          </button>
          <span className="position">
            bar {Math.floor(beat / beatsPerMeasure(viewScore.timeSignature)) + 1} &middot;{' '}
            {Math.round(beat * 10) / 10} beats
          </span>
          <label className="inline">
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={ui.tempoScale}
              onChange={(event) => updateUi({ tempoScale: Number(event.target.value) })}
            />
            <span>{Math.round(viewScore.tempo * ui.tempoScale)} BPM</span>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={ui.metronome}
              onChange={(event) => updateUi({ metronome: event.target.checked })}
            />
            Metronome
          </label>
        </footer>
      )}
    </div>
  );
}

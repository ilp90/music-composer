import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/authContext';
import { AudioEngine } from './audioEngine';
import { CAMERA_ERROR_MESSAGES, CameraError, getCameraStream, stopStream } from './camera';
import { wedgeName, type PlayMode, type Wedge } from './circleOfFifths';
import { ComposeControls } from './ComposeControls';
import { ComposeStage } from './ComposeStage';
import type { HandTrackingStatus } from './useHandTracking';
import { useRecording } from './useRecording';

type Phase =
  | { name: 'idle' }
  | { name: 'starting' }
  | { name: 'running'; engine: AudioEngine; stream: MediaStream | null }
  | { name: 'error'; message: string };

export function ComposePage() {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [mode, setMode] = useState<PlayMode>('note');
  const [opacityPercent, setOpacityPercent] = useState(40);
  const [trackingStatus, setTrackingStatus] = useState<HandTrackingStatus>('off');
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const { state: auth } = useAuth();
  const stageRef = useRef<HTMLDivElement>(null);
  const recording = useRecording(
    phase.name === 'running' ? phase.engine : null,
    phase.name === 'running' ? phase.stream : null,
    stageRef,
    auth.status === 'authenticated' ? auth.user.id : null,
  );

  // Release the camera and audio when leaving the page.
  const running = useRef<{ engine: AudioEngine; stream: MediaStream | null } | null>(null);
  useEffect(
    () => () => {
      if (running.current?.stream) stopStream(running.current.stream);
      running.current?.engine.dispose();
    },
    [],
  );

  async function start(withCamera: boolean) {
    setPhase({ name: 'starting' });
    // Unlock audio first, while the click still counts as a user gesture.
    const enginePromise = AudioEngine.start();
    try {
      const stream = withCamera ? await getCameraStream() : null;
      const engine = await enginePromise;
      running.current = { engine, stream };
      setPhase({ name: 'running', engine, stream });
    } catch (err) {
      void enginePromise.then((e) => e.dispose()).catch(() => {});
      const message =
        err instanceof CameraError
          ? CAMERA_ERROR_MESSAGES[err.kind]
          : 'Audio couldn’t be started. Please try again.';
      setPhase({ name: 'error', message });
    }
  }

  const onPlayed = useCallback(
    (wedge: Wedge) => setLastPlayed(`${wedgeName(wedge)}${mode === 'chord' ? ' chord' : ''}`),
    [mode],
  );

  if (phase.name !== 'running') {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-5 p-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Compose</h1>
        <p className="max-w-md text-slate-400">
          Your camera shows a circle of fifths over you. Point at a key with your index finger to
          play it — or tap it.
        </p>
        {phase.name === 'error' && (
          <p
            role="alert"
            className="max-w-md rounded-lg border border-rose-900 bg-rose-950/60 px-4 py-3 text-sm text-rose-300"
          >
            {phase.message}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => start(true)}
            disabled={phase.name === 'starting'}
            className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
          >
            {phase.name === 'starting'
              ? 'Starting…'
              : phase.name === 'error'
                ? 'Try again'
                : 'Start'}
          </button>
          {phase.name === 'error' && (
            <button
              type="button"
              onClick={() => start(false)}
              className="rounded-lg border border-slate-700 px-6 py-3 transition hover:bg-slate-800"
            >
              Play without camera
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          You’ll be asked to allow the camera and microphone.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Compose</h1>
      {/* Controls sit below the camera, not over it, so they never hide the bottom keys. */}
      <div ref={stageRef} className="relative min-h-0 flex-1">
        <ComposeStage
          stream={phase.stream}
          engine={phase.engine}
          mode={mode}
          opacity={opacityPercent / 100}
          onPlayed={onPlayed}
          onTrackingStatus={setTrackingStatus}
          recorder={recording.recorder}
        />
      </div>
      <ComposeControls
        mode={mode}
        onModeChange={setMode}
        opacityPercent={opacityPercent}
        onOpacityChange={setOpacityPercent}
        trackingStatus={trackingStatus}
        lastPlayed={lastPlayed}
        recording={recording}
      />
    </main>
  );
}

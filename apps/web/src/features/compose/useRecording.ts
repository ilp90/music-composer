import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { saveRecording } from '../recordings/uploadQueue';
import type { AudioEngine } from './audioEngine';
import { isRecordingSupported, SessionRecorder, type RecordingResult } from './recorder';

interface Session {
  recorder: SessionRecorder;
  audio: { dispose(): void };
}

export interface RecordingControls {
  supported: boolean;
  /** The active recorder (the stage composites frames into it), or null when not recording. */
  recorder: SessionRecorder | null;
  elapsedMs: number;
  notice: string | null;
  toggle(): void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Last resort when the browser can't store the recording for upload: give it to the user directly. */
function downloadToDevice({ blob, mimeType }: RecordingResult) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `music-composer-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${
      mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
    }`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Record/stop for the compose view (SPEC §2.3): a toggle (also the R key), an elapsed timer, and
 * an automatic stop at the 5-minute limit. Finished recordings are saved locally, then uploaded.
 */
export function useRecording(
  engine: AudioEngine | null,
  stream: MediaStream | null,
  stageRef: RefObject<HTMLElement | null>,
  userId: string | null,
): RecordingControls {
  const [supported] = useState(isRecordingSupported);
  const [session, setSession] = useState<Session | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);

  async function stop(reason: 'user' | 'limit' | 'leave') {
    const current = sessionRef.current;
    if (!current) return;
    sessionRef.current = null;
    if (reason !== 'leave') setSession(null);

    const result = await current.recorder.stop();
    current.audio.dispose();
    if (result.blob.size === 0) {
      if (reason !== 'leave') setNotice('Nothing was recorded. Please try again.');
      return;
    }
    try {
      await saveRecording(userId!, result);
      if (reason !== 'leave') {
        setNotice(
          `${reason === 'limit' ? 'Reached the 5-minute limit. ' : ''}Saved — uploading to My recordings.`,
        );
      }
    } catch {
      downloadToDevice(result);
      if (reason !== 'leave') {
        setNotice(
          'This browser couldn’t keep the recording for upload, so it was downloaded instead.',
        );
      }
    }
  }

  function start() {
    const stage = stageRef.current;
    if (!engine || !stage || !userId || sessionRef.current) return;
    const audio = engine.createRecordingAudio(stream);
    try {
      const recorder = new SessionRecorder(
        { width: stage.clientWidth, height: stage.clientHeight },
        audio.stream,
        () => void stop('limit'),
      );
      sessionRef.current = { recorder, audio };
      setSession(sessionRef.current);
      setElapsedMs(0);
      setNotice(null);
    } catch {
      audio.dispose();
      setNotice('Recording couldn’t start in this browser.');
    }
  }

  function toggle() {
    if (sessionRef.current) void stop('user');
    else start();
  }
  const onShortcut = useEffectEvent(toggle);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => setElapsedMs(session.recorder.elapsedMs()), 250);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!supported || !engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      onShortcut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [supported, engine]);

  // Leaving the page mid-recording still saves what was recorded.
  const stopOnLeave = useEffectEvent(() => void stop('leave'));
  useEffect(() => () => stopOnLeave(), []);

  return { supported, recorder: session?.recorder ?? null, elapsedMs, notice, toggle };
}

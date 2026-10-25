import { MAX_RECORDING_MS } from '@mc/shared';
import { Link } from 'react-router';
import type { PlayMode } from './circleOfFifths';
import type { HandTrackingStatus } from './useHandTracking';
import type { RecordingControls } from './useRecording';

const TRACKING_LABEL: Record<HandTrackingStatus, string> = {
  off: 'Tap or click a key to play',
  loading: 'Loading hand tracking…',
  ready: 'Point with your index finger',
  unavailable: 'Hand tracking unavailable — tap or click a key',
};

interface ComposeControlsProps {
  mode: PlayMode;
  onModeChange(mode: PlayMode): void;
  opacityPercent: number;
  onOpacityChange(percent: number): void;
  trackingStatus: HandTrackingStatus;
  lastPlayed: string | null;
  recording: RecordingControls;
}

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ComposeControls({
  mode,
  onModeChange,
  opacityPercent,
  onOpacityChange,
  trackingStatus,
  lastPlayed,
  recording,
}: ComposeControlsProps) {
  const isRecording = recording.recorder !== null;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-t border-slate-800 p-2 sm:p-3">
      <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-2 py-1 text-sm text-slate-200">
        {recording.supported && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={recording.toggle}
              aria-pressed={isRecording}
              aria-keyshortcuts="R"
              title="Record / stop (R)"
              className={`flex items-center gap-2 rounded-lg px-4 py-1.5 font-medium text-white transition ${
                isRecording ? 'bg-slate-700 hover:bg-slate-600' : 'bg-rose-600 hover:bg-rose-500'
              }`}
            >
              <span
                aria-hidden="true"
                className={
                  isRecording ? 'size-3 rounded-sm bg-white' : 'size-3 rounded-full bg-white'
                }
              />
              {isRecording ? 'Stop' : 'Record'}
            </button>
            {isRecording && (
              <span
                className="flex items-center gap-2 tabular-nums text-rose-300"
                data-testid="recording-timer"
              >
                <span
                  aria-hidden="true"
                  className="size-2 animate-pulse rounded-full bg-rose-500"
                />
                <span className="sr-only">Recording, </span>
                {formatTime(recording.elapsedMs)} / {formatTime(MAX_RECORDING_MS)}
              </span>
            )}
          </div>
        )}

        <div
          role="radiogroup"
          aria-label="Play mode"
          className="flex rounded-lg border border-slate-700 p-0.5"
        >
          {(['note', 'chord'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => onModeChange(value)}
              className={`rounded-md px-3 py-1 capitalize transition ${
                mode === value ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-3">
          <span className="whitespace-nowrap">Chart opacity</span>
          <input
            type="range"
            min={20}
            max={80}
            step={5}
            value={opacityPercent}
            onChange={(e) => onOpacityChange(Number(e.target.value))}
            className="w-28 accent-indigo-500"
          />
          <span className="w-9 tabular-nums text-slate-400">{opacityPercent}%</span>
        </label>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 text-slate-400">
          <span className="truncate" data-testid="tracking-status">
            {TRACKING_LABEL[trackingStatus]}
          </span>
          <span
            role="status"
            aria-live="polite"
            className="min-w-24 text-right font-medium text-slate-100"
            data-testid="last-played"
          >
            {lastPlayed ?? ''}
          </span>
        </div>
      </div>
      {recording.notice && (
        <p role="status" className="text-sm text-slate-300" data-testid="recording-notice">
          {recording.notice}{' '}
          <Link to="/recordings" className="text-indigo-400 hover:underline">
            My recordings
          </Link>
        </p>
      )}
      {!recording.supported && (
        <p className="text-xs text-slate-500">Recording isn’t supported in this browser.</p>
      )}
    </div>
  );
}

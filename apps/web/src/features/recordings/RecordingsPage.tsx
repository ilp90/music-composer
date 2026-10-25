import { RecordingPage, RecordingUrl, type Recording } from '@mc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/apiClient';
import { useAuth } from '../auth/authContext';
import { formatDate, formatDuration, formatSize } from './format';
import type { LocalRecording } from './localStore';
import { discardLocalRecording, retryLocalRecording } from './uploadQueue';
import { useLocalRecordings } from './useLocalRecordings';

const cardClass =
  'flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60';
const buttonClass =
  'rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800 disabled:opacity-60';

function startDownload(url: string) {
  Object.assign(document.createElement('a'), { href: url }).click();
}

function UploadedCard({ recording }: { recording: Recording }) {
  const queryClient = useQueryClient();
  const playback = useQuery({
    queryKey: ['recording-url', recording.id],
    queryFn: () => api.get(`/recordings/${recording.id}/url`, RecordingUrl),
    staleTime: 50 * 60 * 1000, // signed URLs last an hour
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/recordings/${recording.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recordings'] }),
  });
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      startDownload(
        (await api.get(`/recordings/${recording.id}/url?download=1`, RecordingUrl)).url,
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className={cardClass} data-testid="recording-card">
      <video
        controls
        preload="metadata"
        className="aspect-video w-full bg-black"
        {...(playback.data && { src: playback.data.url })}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="text-sm">
          <p className="font-medium">{formatDate(recording.createdAt)}</p>
          <p className="text-slate-400">
            {formatDuration(recording.durationMs)} · {formatSize(recording.sizeBytes)}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={download} disabled={downloading} className={buttonClass}>
            Download
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm('Delete this recording? This can’t be undone.')) remove.mutate();
            }}
            className={`${buttonClass} text-rose-300`}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
      {remove.isError && (
        <p className="px-3 pb-3 text-sm text-rose-400">Couldn’t delete. Try again.</p>
      )}
    </li>
  );
}

function LocalCard({ item }: { item: LocalRecording }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Preview straight from the local copy until it's uploaded.
  useEffect(() => {
    const url = URL.createObjectURL(item.blob);
    if (videoRef.current) videoRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [item.blob]);

  function download() {
    const url = URL.createObjectURL(item.blob);
    Object.assign(document.createElement('a'), {
      href: url,
      download: `music-composer-${item.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.${
        item.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
      }`,
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <li className={cardClass} data-testid="local-recording-card">
      <video ref={videoRef} controls preload="metadata" className="aspect-video w-full bg-black" />
      <div className="flex flex-col gap-2 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{formatDate(item.createdAt)}</p>
          <p className="text-slate-400">
            {formatDuration(item.durationMs)} · {formatSize(item.blob.size)}
          </p>
        </div>
        {item.failure ? (
          <>
            <p role="alert" className="text-rose-300">
              Not uploaded: {item.failure}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void retryLocalRecording(item)}
                className={buttonClass}
              >
                Retry
              </button>
              <button type="button" onClick={download} className={buttonClass}>
                Download
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Discard this recording? It was never uploaded.')) {
                    void discardLocalRecording(item.localId);
                  }
                }}
                className={`${buttonClass} text-rose-300`}
              >
                Discard
              </button>
            </div>
          </>
        ) : (
          <p className="text-amber-300" data-testid="upload-status">
            {navigator.onLine ? 'Uploading…' : 'Waiting for a connection to upload'}
          </p>
        )}
      </div>
    </li>
  );
}

export function RecordingsPage() {
  const { state } = useAuth();
  const userId = state.status === 'authenticated' ? state.user.id : '';
  const local = useLocalRecordings(userId);
  const uploaded = useInfiniteQuery({
    queryKey: ['recordings'],
    queryFn: ({ pageParam }) =>
      api.get(
        `/recordings?limit=12${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        RecordingPage,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const recordings = uploaded.data?.pages.flatMap((p) => p.items) ?? [];
  const isEmpty =
    !uploaded.isPending && !uploaded.isError && recordings.length === 0 && local.length === 0;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">My recordings</h1>

        {uploaded.isError && (
          <p
            role="alert"
            className="rounded-lg border border-rose-900 bg-rose-950/60 px-4 py-3 text-sm text-rose-300"
          >
            Couldn’t load your recordings.{' '}
            {local.length > 0 && 'Recordings on this device are shown below. '}
            <button type="button" onClick={() => void uploaded.refetch()} className="underline">
              Try again
            </button>
          </p>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-slate-400">
            <p>No recordings yet.</p>
            <Link
              to="/compose"
              className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500"
            >
              Start composing
            </Link>
          </div>
        )}

        {uploaded.isPending && local.length === 0 && (
          <p role="status" className="text-slate-400">
            Loading…
          </p>
        )}

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {local.map((item) => (
            <LocalCard key={item.localId} item={item} />
          ))}
          {recordings.map((recording) => (
            <UploadedCard key={recording.id} recording={recording} />
          ))}
        </ul>

        {uploaded.hasNextPage && (
          <button
            type="button"
            onClick={() => void uploaded.fetchNextPage()}
            disabled={uploaded.isFetchingNextPage}
            className={`${buttonClass} self-center`}
          >
            {uploaded.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </main>
  );
}

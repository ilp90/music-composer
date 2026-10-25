import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { onRecordingUploaded, processUploads } from './uploadQueue';

const RETRY_INTERVAL_MS = 30_000;

/**
 * Keeps the local upload queue moving while the user is signed in: on start (recordings left over
 * from a previous visit), when the connection comes back, and periodically. Renders nothing.
 */
export function UploadQueueRunner({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const run = () => void processUploads(userId);
    run();
    window.addEventListener('online', run);
    const timer = setInterval(run, RETRY_INTERVAL_MS);
    const unsubscribe = onRecordingUploaded(
      () => void queryClient.invalidateQueries({ queryKey: ['recordings'] }),
    );
    return () => {
      window.removeEventListener('online', run);
      clearInterval(timer);
      unsubscribe();
    };
  }, [userId, queryClient]);

  return null;
}

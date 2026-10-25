import { useEffect, useState } from 'react';
import { indexedDbStore, onLocalRecordingsChange, type LocalRecording } from './localStore';

/** The user's recordings still in the local upload queue; re-read whenever the queue changes. */
export function useLocalRecordings(userId: string): LocalRecording[] {
  const [items, setItems] = useState<LocalRecording[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      indexedDbStore
        .listForUser(userId)
        .then((list) => !cancelled && setItems(list))
        .catch(() => !cancelled && setItems([]));
    void load();
    const unsubscribe = onLocalRecordingsChange(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  return items;
}

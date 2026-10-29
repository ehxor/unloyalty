import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

/**
 * Subscribe to a Dexie query that re-runs whenever the tables it read change.
 * Returns undefined while loading; have the query return null for "not found".
 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<{ v: T } | undefined>(undefined);
  useEffect(() => {
    setValue(undefined);
    const subscription = liveQuery(query).subscribe({
      next: (v) => setValue({ v }),
      error: (err: unknown) => console.error('liveQuery failed', err),
    });
    return () => subscription.unsubscribe();
  }, deps);
  return value?.v;
}

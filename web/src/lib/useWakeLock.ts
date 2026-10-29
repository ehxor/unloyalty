import { useEffect } from 'preact/hooks';

/** Keep the screen on while mounted. Best effort: unsupported or refused requests are ignored. */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let active = true;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (active) sentinel = lock;
        else void lock.release();
      } catch {
        // Low battery, permissions policy, or not supported in this context.
      }
    };
    // The browser drops the lock when the page is hidden; take it again on return.
    const onVisibility = () => void acquire();

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}

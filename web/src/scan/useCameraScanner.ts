import type { RefObject } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PendingBarcode } from '../pending';
import { CameraError, startCamera, type CameraSession } from './camera';
import { decodeImage } from './decoder';

export type ScannerPhase = 'starting' | 'scanning' | 'paused' | 'detected' | 'error';

export interface CameraScanner {
  phase: ScannerPhase;
  error: CameraError | null;
  /** Shown when the camera sees a barcode it can't use (unsupported format, binary data). */
  hint: string | null;
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
}

/** Longest side of the frame handed to the decoder; larger frames cost time without helping. */
const MAX_FRAME_SIDE = 1280;
/** Minimum gap between decodes, to spare the battery. */
const MIN_DECODE_INTERVAL_MS = 100;
/** A read is accepted once seen twice within this window, filtering out 1D misreads. */
const CONFIRM_WINDOW_MS = 1500;
/** How long the "got it" flash shows before handing over. */
const DETECTED_DELAY_MS = 250;

type VideoWithFrameCallback = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/**
 * Run the rear camera into `videoRef` and decode frames until a barcode is read twice in a row.
 * The camera is released when the page is hidden and on unmount, and reacquired when visible again.
 */
export function useCameraScanner(videoRef: RefObject<HTMLVideoElement | null>, onDetected: (barcode: PendingBarcode) => void): CameraScanner {
  const [phase, setPhase] = useState<ScannerPhase>('starting');
  const [error, setError] = useState<CameraError | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const sessionRef = useRef<CameraSession | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    if (!video) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let generation = 0;
    let done = false;
    let lastKey: string | null = null;
    let lastSeenAt = 0;
    let lastDecodeAt = 0;

    const stop = () => {
      generation++;
      sessionRef.current?.stop();
      sessionRef.current = null;
      setTorchOn(false);
    };

    const decodeFrame = async (): Promise<boolean> => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!ctx || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || w === 0 || h === 0) return false;
      const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const results = await decodeImage(ctx.getImageData(0, 0, canvas.width, canvas.height), { maxNumberOfSymbols: 1 });
      const hit = results.find((r) => r.ok);
      if (!hit || !hit.ok) {
        const unusable = results.find((r) => !r.ok);
        if (unusable && !unusable.ok) setHint(unusable.error);
        return false;
      }
      const key = `${hit.format}\u0000${hit.value}`;
      const now = performance.now();
      const confirmed = key === lastKey && now - lastSeenAt < CONFIRM_WINDOW_MS;
      lastKey = key;
      lastSeenAt = now;
      if (!confirmed) return false;
      navigator.vibrate?.(50);
      setPhase('detected');
      setTimeout(() => onDetectedRef.current({ format: hit.format, value: hit.value }), DETECTED_DELAY_MS);
      return true;
    };

    const loop = (gen: number) => {
      const next = () => {
        if (gen !== generation) return;
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => void tick());
        else setTimeout(() => void tick(), MIN_DECODE_INTERVAL_MS);
      };
      const tick = async () => {
        if (gen !== generation) return;
        const now = performance.now();
        if (now - lastDecodeAt < MIN_DECODE_INTERVAL_MS) return next();
        lastDecodeAt = now;
        try {
          if (await decodeFrame()) {
            done = true;
            stop();
            return;
          }
        } catch (err) {
          console.error('frame decode failed', err);
        }
        next();
      };
      next();
    };

    const start = async () => {
      if (done || document.visibilityState !== 'visible') return;
      const gen = ++generation;
      setPhase('starting');
      try {
        const session = await startCamera(video);
        if (gen !== generation) {
          session.stop();
          return;
        }
        sessionRef.current = session;
        setTorchSupported(session.torchSupported);
        setError(null);
        setPhase('scanning');
        loop(gen);
      } catch (err) {
        if (gen !== generation) return;
        setError(err instanceof CameraError ? err : new CameraError('failed', String(err)));
        setPhase('error');
      }
    };

    const onVisibility = () => {
      if (done) return;
      if (document.visibilityState === 'visible') void start();
      else {
        stop();
        setPhase('paused');
      }
    };

    void start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [videoRef]);

  const toggleTorch = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const next = !torchOn;
    session.setTorch(next).then(
      () => setTorchOn(next),
      () => setTorchSupported(false),
    );
  }, [torchOn]);

  return { phase, error, hint, torchSupported, torchOn, toggleTorch };
}

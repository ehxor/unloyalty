export type CameraErrorKind = 'unsupported' | 'denied' | 'not-found' | 'in-use' | 'failed';

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<CameraErrorKind, string> = {
  unsupported: 'This browser can’t use the camera here. The camera needs the app to be opened over HTTPS.',
  denied: 'Camera access is blocked. Allow it in your browser or phone settings, or use a photo or type the number instead.',
  'not-found': 'No camera was found on this device.',
  'in-use': 'The camera is being used by another app. Close it and try again.',
  failed: 'The camera couldn’t be started.',
};

function classify(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', MESSAGES.denied);
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', MESSAGES['not-found']);
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('in-use', MESSAGES['in-use']);
    default:
      return new CameraError('failed', MESSAGES.failed);
  }
}

export interface CameraSession {
  readonly track: MediaStreamTrack;
  readonly torchSupported: boolean;
  setTorch(on: boolean): Promise<void>;
  stop(): void;
}

/** Torch is a non-standard constraint (Chrome on Android); absent from the DOM typings. */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

/** Open the rear camera into `video`. Rejects with a CameraError the UI can show as-is. */
export async function startCamera(video: HTMLVideoElement): Promise<CameraSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', MESSAGES.unsupported);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    throw classify(err);
  }
  const track = stream.getVideoTracks()[0];
  const stop = () => {
    for (const t of stream.getTracks()) t.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };
  if (!track) {
    stop();
    throw new CameraError('not-found', MESSAGES['not-found']);
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch (err) {
    stop();
    throw classify(err);
  }

  const torchSupported = (track.getCapabilities?.() as TorchCapabilities | undefined)?.torch === true;
  return {
    track,
    torchSupported,
    async setTorch(on: boolean) {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    },
    stop,
  };
}

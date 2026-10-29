import { fileURLToPath } from 'node:url';

/** What the fake camera shows (Code 128). */
export const CAMERA_BARCODE = 'CAM-12345';
export const CAMERA_VIDEO = fileURLToPath(new URL('../../test-results/.camera/barcode.mjpeg', import.meta.url));

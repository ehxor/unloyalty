import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import bwipjs from 'bwip-js/node';
import sharp from 'sharp';
import { CAMERA_BARCODE, CAMERA_VIDEO } from './camera';

/**
 * Build the Motion-JPEG file Chromium plays as its fake camera
 * (--use-file-for-fake-video-capture): a barcode held in front of the lens.
 */
export default async function globalSetup(): Promise<void> {
  const barcode = await bwipjs.toBuffer({
    bcid: 'code128',
    text: CAMERA_BARCODE,
    scale: 3,
    height: 12,
    paddingwidth: 10,
    paddingheight: 10,
    backgroundcolor: 'FFFFFF',
  });
  const frame = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#d8d8d0' } })
    .composite([{ input: barcode, gravity: 'center' }])
    .jpeg({ quality: 90 })
    .toBuffer();
  await mkdir(dirname(CAMERA_VIDEO), { recursive: true });
  await writeFile(CAMERA_VIDEO, Buffer.concat(Array.from({ length: 30 }, () => frame)));
}

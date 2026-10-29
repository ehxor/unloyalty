import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// `pnpm icons` regenerates public/icons/* from icon.svg; the PNGs are committed.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#1f6f5c' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#1f6f5c' } },
  },
  images: ['public/icons/icon.svg'],
});

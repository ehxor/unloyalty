let lastMs = 0;
let lastSeq = 0;

/**
 * RFC 9562 UUIDv7: 48-bit Unix ms timestamp, version 7, 12-bit counter (rand_a) for
 * monotonic ordering within the same millisecond, variant 10, 62 random bits.
 */
export function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Date.now();
  if (ms <= lastMs) {
    lastSeq++;
    if (lastSeq > 0xfff) {
      lastMs++;
      lastSeq = 0;
    }
    ms = lastMs;
  } else {
    lastMs = ms;
    lastSeq = bytes[6]! & 0x07; // random start, leaves headroom for increments
  }
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (lastSeq >> 8);
  bytes[7] = lastSeq & 0xff;
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

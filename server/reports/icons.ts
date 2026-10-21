import zlib from 'node:zlib';
import type { Severity } from '../../shared/types.js';

/**
 * Severity icons for exported reports, drawn here (no third-party artwork): a filled red disc for
 * priority issues, a filled amber disc for other issues and an amber ring for warnings — the same
 * language as the severity dots in the app. Rendered at 2× (40 px) so they stay crisp in Word and PDF.
 */
const SIZE = 40;
const COLORS: Record<Severity, [number, number, number]> = { priority: [0xc4, 0x32, 0x1d], other: [0xe0, 0x8a, 0x00], warning: [0xe0, 0x8a, 0x00] };

function png(width: number, height: number, rgba: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function draw(severity: Severity): Buffer {
  const [r, g, b] = COLORS[severity];
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const c = SIZE / 2;
  const outer = SIZE / 2 - 1;
  const inner = severity === 'warning' ? outer - 5 : -1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 4×4 supersampling for smooth edges.
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const d = Math.hypot(x + (sx + 0.5) / 4 - c, y + (sy + 0.5) / 4 - c);
          if (d <= outer && d >= inner) cover++;
        }
      }
      const i = (y * SIZE + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = Math.round((cover / 16) * 255);
    }
  }
  return png(SIZE, SIZE, buf);
}

const cache = new Map<Severity, Buffer>();
export function severityIcon(severity: Severity): Buffer {
  let b = cache.get(severity);
  if (!b) {
    b = draw(severity);
    cache.set(severity, b);
  }
  return b;
}

export const SEVERITY_ICON_LABEL: Record<Severity, string> = { priority: 'Priority issue', other: 'Other issue', warning: 'Warning' };

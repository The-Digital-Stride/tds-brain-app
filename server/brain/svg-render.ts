/**
 * Draws one SVG to WebP in its own process, so the app can kill it at a hard time limit (plan
 * decision 7, security review): a tiny SVG can take the image library many seconds, and a render
 * in the app's own process would hold the threads its file reads share.
 *
 * Run as `node svg-render.ts <width> <max height> <max pixels>`. The SVG's bytes come on stdin,
 * never a path, so it cannot draw neighbouring files; the WebP goes to stdout. Any failure exits 1.
 */
import sharp from 'sharp';

const MAX_INPUT = 1024 * 1024;

async function main(): Promise<void> {
  const [width, height, pixels] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(pixels)) {
    throw new Error('bad arguments');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > MAX_INPUT) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  sharp.concurrency(1);
  const out = await sharp(Buffer.concat(chunks), { limitInputPixels: pixels, failOn: 'error' })
    .autoOrient()
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(out, (err) => (err ? reject(err) : resolve())),
  );
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
